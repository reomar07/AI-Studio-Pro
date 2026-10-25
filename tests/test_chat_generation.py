"""Execute the repository worker with mocked providers/history, no GUI or network."""
import ast
from copy import deepcopy
import json
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from backend.chat_models import ChatModelMemoryMixin

ROOT = Path(__file__).resolve().parents[1]

def load_worker():
    tree = ast.parse((ROOT / "backend/generation.py").read_text(encoding="utf-8"))
    worker = next(c for c in tree.body if isinstance(c, ast.ClassDef) and c.name == "GenerationMixin")
    namespace = {"threading": threading, "json": json, "SETTINGS_FILE": "settings", "HISTORY_FILE": "history", "LOCAL_HOSTS": ("localhost", "127.0.0.1"), "APP_NOTE": "test app", "friendly_error": lambda error: "simulated provider failure"}
    exec(compile(ast.Module(body=[worker], type_ignores=[]), "generation.py", "exec"), namespace)
    return namespace

def load_dispatcher(worker):
    tree = ast.parse((ROOT / "backend/chat_generation.py").read_text(encoding="utf-8"))
    tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom) or n.module != "generation"]
    namespace = {"GenerationMixin": worker}
    exec(compile(tree, "chat_generation.py", "exec"), namespace)
    return namespace

class ChatGenerationTests(unittest.TestCase):
    def setUp(self):
        self.worker = load_worker()
        self.dispatch = load_dispatcher(self.worker["GenerationMixin"])
        self.pending, self.connections, self.text_calls, self.image_calls = [], [], [], []
        pending, connections, texts, images = self.pending, self.connections, self.text_calls, self.image_calls
        class DeferredThread:
            def __init__(self, target, args=(), **kwargs): self.target, self.args = target, args
            def start(self): pending.append(self)
            def run(self): self.target(*self.args)
        self.dispatch["threading"] = SimpleNamespace(Thread=DeferredThread)
        class Stream(list):
            def close(self): self.closed = True
        class Client:
            def __init__(self, **kwargs):
                connections.append(kwargs)
                self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.complete))
                self.images = SimpleNamespace(generate=self.image)
            def complete(self, **kwargs):
                texts.append(kwargs)
                return Stream([SimpleNamespace(usage=None, choices=[SimpleNamespace(delta=SimpleNamespace(content="reply"))])])
            def image(self, **kwargs):
                images.append(kwargs)
                return SimpleNamespace(data=[SimpleNamespace(url="data:image/png;base64,dGVzdA==")])
        self.worker["OpenAI"] = Client
        dispatcher = self.dispatch["ChatModelGenerationMixin"]
        class Engine(dispatcher, ChatModelMemoryMixin):
            def __init__(self):
                self.stream_lock = threading.Lock()
                self.stream_gen = 0
                self.stream_chunk, self.stream_error = "", None
                self.stream_is_done, self.is_aborted = False, False
                self.current_chat_id = "chat_a"
                self.history = {"chat_a": {"nodes": {}, "current_node": None}, "chat_b": {"nodes": {}, "current_node": None}}
                self.metadata, self.chat_settings, self.disk = {}, {}, {}
                self._chat_model_metadata_file = "metadata"
                self.config = {"active_profile_id": "cloud", "profiles": {
                    "cloud": {"api_key": "cloud-secret", "base_url": "https://provider.invalid/v1", "model_name": "global-model", "image_model": "global-image"},
                    "local": {"api_key": "local-secret", "base_url": "http://localhost:1234/v1", "model_name": "local-default", "image_model": "local-image"}}}
            def _save_json(self, path, value): self.disk[path] = deepcopy(value)
            def _load_json(self, path, default): return deepcopy(self.disk.get(path, default))
            def _emit(self, gen, chunk=None, error=None, done=False):
                if gen != self.stream_gen: return
                if chunk: self.stream_chunk += chunk
                if error: self.stream_error = error
                if done: self.stream_is_done = True
            def _add_node(self, cid, role, content, display_text, title, mode, **extra):
                chat = self.history[cid]; nid = "m" + str(len(chat["nodes"]))
                chat["nodes"][nid] = dict(id=nid, role=role, content=content, display_text=display_text, parent=chat["current_node"], **extra)
                chat["current_node"] = nid
                return nid
            def _get_linear_branch(self, chat): return list(chat["nodes"].values())
            def _turn_content(self, message, limit=None): return message["content"]
            def _generate_title_thread(self, *args): pass
            def _auto_store_image(self, *args): pass
        self.engine = Engine()
        self.engine.set_chat_model_binding("chat_a", "local", "remembered-a", "remembered-image")
        self.engine.set_chat_model_binding("chat_b", "cloud", "remembered-b")

    def run_pending(self):
        while self.pending: self.pending.pop(0).run()

    def test_actual_worker_uses_chat_model_and_correct_credentials(self):
        before = deepcopy(self.engine.config)
        self.assertTrue(self.engine.send_chat_prompt_stream("hello", [], {"temperature": 0.2})["ok"])
        self.run_pending()
        self.assertEqual(self.connections[0]["base_url"], "http://localhost:1234/v1")
        self.assertEqual(self.connections[0]["api_key"], "local-secret")
        self.assertEqual(self.text_calls[0]["model"], "remembered-a")
        self.assertEqual(self.engine.config, before)
        self.assertTrue(self.engine.stream_is_done)
        self.assertFalse(self.engine._chat_model_worker_running)
        self.assertNotIn("local-secret", json.dumps(self.engine.disk))

    def test_delayed_worker_keeps_original_chat_profile_and_settings(self):
        params = {"temperature": 0.2}
        self.engine.send_chat_prompt_stream("hello", [], params)
        self.engine.current_chat_id = "chat_b"
        self.engine.config["profiles"]["local"]["api_key"] = "changed-secret"
        self.engine.set_chat_model_binding("chat_a", "cloud", "changed-model")
        params["temperature"] = 1.8
        self.run_pending()
        self.assertEqual(self.connections[0]["api_key"], "local-secret")
        self.assertEqual(self.text_calls[0]["model"], "remembered-a")
        self.assertEqual(self.text_calls[0]["temperature"], 0.2)
        self.assertEqual(len(self.engine.history["chat_b"]["nodes"]), 0)
        self.assertEqual(len(self.engine.history["chat_a"]["nodes"]), 2)

    def test_regeneration_uses_saved_binding_without_new_user_message(self):
        self.engine._add_node("chat_a", "user", "original", "original", "", False)
        self.engine.send_chat_prompt_stream(None, None, {"regenerate": True})
        self.run_pending()
        self.assertEqual(self.text_calls[0]["model"], "remembered-a")
        messages = list(self.engine.history["chat_a"]["nodes"].values())
        self.assertEqual([m["role"] for m in messages], ["user", "assistant"])
        self.assertEqual(self.text_calls[0]["messages"][-1]["content"], "original")

    def test_image_generation_uses_saved_image_model(self):
        self.engine.send_chat_prompt_stream("draw", [], {"is_image_mode": True})
        self.run_pending()
        self.assertEqual(self.image_calls[0]["model"], "remembered-image")
        self.assertEqual(self.connections[0]["api_key"], "local-secret")
        self.assertEqual(self.text_calls, [])
        self.assertTrue(self.engine.stream_is_done)

    def test_deleted_profile_blocks_before_any_provider_call(self):
        del self.engine.config["profiles"]["local"]
        result = self.engine.send_chat_prompt_stream("private", [], {})
        self.assertFalse(result["ok"])
        self.assertEqual(self.pending, [])
        self.assertEqual(self.connections, [])
        self.assertTrue(self.engine.stream_is_done)
        self.assertIn("saved provider/model", self.engine.stream_error)
        self.assertNotIn("private", self.engine.stream_error)

    def test_legacy_chat_binds_once_and_save_failure_blocks_generation(self):
        self.engine.current_chat_id = "chat_new"
        with patch.object(self.engine, "_save_json", return_value=None):
            self.assertFalse(self.engine.send_chat_prompt_stream("hello", [], {})["ok"])
        self.assertEqual(self.pending, [])
        self.assertTrue(self.engine.send_chat_prompt_stream("hello", [], {})["ok"])
        self.assertTrue(self.engine.get_chat_model_binding("chat_new")["remembered"])
        self.run_pending()
        self.assertEqual(self.text_calls[0]["model"], "global-model")

    def test_busy_and_cancel_before_start_do_not_send(self):
        self.engine.send_chat_prompt_stream("first", [], {})
        gen = self.engine.stream_gen
        self.assertEqual(self.engine.send_chat_prompt_stream("second", [], {})["error"], "generation_busy")
        self.assertEqual(self.engine.stream_gen, gen)
        self.engine.is_aborted = True
        self.run_pending()
        self.assertEqual(self.connections, [])
        self.assertTrue(self.engine.stream_is_done)
        self.assertFalse(self.engine._chat_model_worker_running)

    def test_early_provider_failure_finishes_without_leaking_exception(self):
        self.worker["OpenAI"] = lambda **kwargs: (_ for _ in ()).throw(RuntimeError("local-secret"))
        self.engine.send_chat_prompt_stream("hello", [], {})
        self.run_pending()
        self.assertTrue(self.engine.stream_is_done)
        self.assertNotIn("local-secret", self.engine.stream_error)
        self.assertFalse(self.engine._chat_model_worker_running)

    def test_binding_change_during_dispatch_cannot_mix_profile_id_and_credentials(self):
        original = self.engine.get_chat_model_binding
        def read_then_change(chat_id):
            result = original(chat_id)
            self.engine.metadata[chat_id]["model_binding"] = {"profile_id": "cloud", "model_name": "changed", "image_model": "changed-image"}
            return result
        with patch.object(self.engine, "get_chat_model_binding", side_effect=read_then_change):
            self.assertTrue(self.engine.send_chat_prompt_stream("hello", [], {})["ok"])
        self.run_pending()
        self.assertEqual(self.connections[0]["api_key"], "local-secret")
        self.assertEqual(self.text_calls[0]["model"], "remembered-a")

    def test_engine_routes_existing_api_to_bound_dispatcher(self):
        tree = ast.parse((ROOT / "backend/engine.py").read_text(encoding="utf-8"))
        engine = next(c for c in tree.body if isinstance(c, ast.ClassDef) and c.name == "ChatEngine")
        assignment = next(n for n in engine.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "send_prompt_stream" for t in n.targets))
        self.assertEqual(ast.unparse(assignment.value), "ChatModelGenerationMixin.send_chat_prompt_stream")

if __name__ == "__main__": unittest.main()
