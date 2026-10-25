"""Token-use summary tests. Disposable folders only: no network, real providers or real chats."""
import ast
import importlib
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
_serial = 0


def load_package(tmp):
    global _serial
    _serial += 1
    name = f"usage_pkg_{_serial}"
    package = Path(tmp) / name
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "shared.py").write_text(f"DATA_DIR = {str(Path(tmp) / 'AIStudioPro')!r}\n", encoding="utf-8")
    (package / "generation.py").write_text(
        "class GenerationMixin:\n    behavior = None\n"
        "    def _stream_worker(context, gen, prompt, files, params):\n        GenerationMixin.behavior(context)\n", encoding="utf-8")
    for module in ("usage_log", "chat_generation"):
        shutil.copy2(ROOT / "backend" / f"{module}.py", package / f"{module}.py")
    sys.path.insert(0, str(tmp))
    importlib.invalidate_caches()
    return name, {m: importlib.import_module(f"{name}.{m}") for m in ("shared", "generation", "usage_log", "chat_generation")}


def node(nid, role, **extra):
    return {"id": nid, "role": role, "parent": None, "children": [], "content": extra.pop("content", nid), **extra}


class UsageSummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.name, self.mods = load_package(self.temp.name)
        self.addCleanup(self._unload)
        usage, chatgen = self.mods["usage_log"], self.mods["chat_generation"]
        class Engine(chatgen.ChatModelGenerationMixin, usage.UsageLogMixin):
            def __init__(self):
                self.history = {"c": {"nodes": {"old": node("old", "assistant", usage={"prompt": 1, "completion": 1}, model="old-model")}, "current_node": "old"}}
                self.stream_lock = threading.Lock()
                self.is_aborted = False
                self._chat_model_worker_running = True
                self.emitted = []
            def _emit(self, gen, **kwargs): self.emitted.append(kwargs)
        self.engine = Engine()
        self.usage = usage

    def _unload(self):
        for key in [k for k in sys.modules if k == self.name or k.startswith(self.name + ".")]:
            del sys.modules[key]
        if self.temp.name in sys.path: sys.path.remove(self.temp.name)

    def record(self, *nodes, chat="c"):
        known = self.engine._usage_known_node_ids(chat)
        for n in nodes: self.engine.history[chat]["nodes"][n["id"]] = n
        return self.engine._usage_record_new_replies(chat, known)

    def test_provider_numbers_are_recorded_and_old_replies_are_not_recounted(self):
        self.assertEqual(self.record(node("u1", "user"), node("a1", "assistant", usage={"prompt": 120, "completion": 30}, model="m1")), 1)
        summary = self.engine.get_usage_summary()
        self.assertTrue(summary["ok"])
        day = summary["days"][0]
        self.assertEqual((day["replies"], day["reported_replies"], day["reported_prompt"], day["reported_completion"]), (1, 1, 120, 30))
        self.assertEqual((day["estimated_replies"], day["estimated_completion"]), (0, 0))
        self.assertEqual(day["models"][0]["model"], "m1")
        self.assertEqual(summary["totals"]["reported_prompt"], 120)

    def test_missing_provider_numbers_are_estimated_and_never_added_to_reported(self):
        self.record(node("a1", "assistant", usage={"prompt": 10, "completion": 5}, model="m"),
                    node("a2", "assistant", content="x" * 41, model="m"))
        totals = self.engine.get_usage_summary()["totals"]
        self.assertEqual((totals["reported_prompt"], totals["reported_completion"]), (10, 5))
        self.assertEqual((totals["estimated_replies"], totals["estimated_completion"]), (1, 11))

    def test_errors_user_messages_and_non_numbers_are_ignored_safely(self):
        self.assertEqual(self.record(node("u", "user"), node("e", "assistant", is_error=True, content="boom"),
                                     node("bad", "assistant", usage={"prompt": "many", "completion": True}, content="abcd")), 1)
        day = self.engine.get_usage_summary()["days"][0]
        self.assertEqual((day["reported_replies"], day["estimated_replies"], day["estimated_completion"]), (0, 1, 1))

    def test_picture_replies_are_counted_without_token_numbers(self):
        self.record(node("img", "assistant", image="data:image/png;base64," + "A" * 4000, content="![x](data:...)", model="image-model"))
        day = self.engine.get_usage_summary()["days"][0]
        self.assertEqual((day["replies"], day["images"], day["estimated_completion"], day["reported_replies"]), (1, 1, 0, 0))

    def test_days_are_separate_and_the_window_is_respected(self):
        for stamp in ("2026-10-20", "2026-10-24", "2026-10-25"):
            with mock.patch.object(self.usage, "_today", return_value=stamp):
                self.record(node("r" + stamp, "assistant", usage={"prompt": 1, "completion": 2}, model="m"))
        with mock.patch.object(self.usage, "_today", return_value="2026-10-25"):
            two = self.engine.get_usage_summary(2)
            wide = self.engine.get_usage_summary(14)
        self.assertEqual([d["day"] for d in two["days"]], ["2026-10-25", "2026-10-24"])
        self.assertEqual([d["day"] for d in wide["days"]], ["2026-10-25", "2026-10-24", "2026-10-20"])
        self.assertEqual(wide["totals"]["replies"], 3)

    def test_arguments_are_clamped(self):
        with mock.patch.object(self.usage, "_today", return_value="2026-10-25"):
            self.record(node("a", "assistant", usage={"completion": 1}))
            for value in (0, -5, "x", None, 500, True):
                self.assertTrue(self.engine.get_usage_summary(value)["ok"], value)
            self.assertEqual(len(self.engine.get_usage_summary(0)["days"]), 1)

    def test_only_the_newest_days_are_kept(self):
        base = {f"2020-{m:02d}-{d:02d}": {"replies": 1} for m in range(1, 13) for d in range(1, 29)}
        base.update({f"2021-{m:02d}-{d:02d}": {"replies": 1} for m in range(1, 13) for d in range(1, 29)})
        Path(self.usage.USAGE_FILE).parent.mkdir(parents=True, exist_ok=True)
        Path(self.usage.USAGE_FILE).write_text(json.dumps({"days": base}), encoding="utf-8")
        self.record(node("a", "assistant", usage={"completion": 1}))
        saved = json.loads(Path(self.usage.USAGE_FILE).read_text(encoding="utf-8"))["days"]
        self.assertEqual(len(saved), self.usage.KEEP_DAYS)
        self.assertIn(self.usage._today(), saved)
        self.assertNotIn("2020-01-01", saved)

    def test_damaged_file_is_set_aside_then_recording_continues(self):
        path = Path(self.usage.USAGE_FILE); path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json", encoding="utf-8")
        first = self.engine.get_usage_summary()
        self.assertTrue(first["ok"]); self.assertIn("could not be read", first["warning"]); self.assertEqual(first["days"], [])
        self.assertEqual(len(list(path.parent.glob("usage_summary.json.corrupt_*.bak"))), 1)
        self.assertEqual(self.engine.get_usage_summary()["warning"], "")
        self.assertEqual(self.record(node("a", "assistant", usage={"prompt": 3, "completion": 4})), 1)
        self.assertEqual(self.engine.get_usage_summary()["totals"]["reported_completion"], 4)

    def test_odd_file_content_is_cleaned_instead_of_crashing(self):
        path = Path(self.usage.USAGE_FILE); path.parent.mkdir(parents=True, exist_ok=True)
        today = self.usage._today()
        path.write_text(json.dumps({"days": {today: {"replies": "lots", "reported": 5, "models": {"m": 7}}, "not-a-day": {}}}), encoding="utf-8")
        summary = self.engine.get_usage_summary()
        self.assertTrue(summary["ok"]); self.assertEqual(summary["days"][0]["replies"], 0)

    def test_write_failure_never_raises_and_the_summary_still_works(self):
        with mock.patch.object(self.usage.os, "replace", side_effect=OSError("read only")):
            self.assertEqual(self.record(node("a", "assistant", usage={"completion": 1})), 0)
        self.assertEqual(list(Path(self.usage.USAGE_FILE).parent.glob("*.tmp_*")), [])
        self.assertTrue(self.engine.get_usage_summary()["ok"])

    def test_no_message_text_or_chat_ids_are_stored(self):
        self.record(node("a", "assistant", content="TOP SECRET reply text", usage={"prompt": 1, "completion": 1}, model="m"))
        stored = Path(self.usage.USAGE_FILE).read_text(encoding="utf-8")
        for forbidden in ("TOP SECRET", '"c"', "chat"):
            self.assertNotIn(forbidden, stored)

    # ---- hook inside the generation dispatcher ---------------------------------------------
    def run_worker(self, behavior):
        chatgen, generation = self.mods["chat_generation"], self.mods["generation"]
        generation.GenerationMixin.behavior = staticmethod(behavior)
        context = type("Context", (), {"current_chat_id": "c"})()
        self.engine._run_chat_bound_worker(context, 1, "hello", [], {})

    def test_finished_reply_is_counted_and_the_worker_flag_is_released(self):
        def behavior(context):
            self.engine.history["c"]["nodes"].update({"u": node("u", "user"), "a": node("a", "assistant", usage={"prompt": 9, "completion": 8}, model="m")})
        self.run_worker(behavior)
        self.assertFalse(self.engine._chat_model_worker_running)
        self.assertEqual(self.engine.get_usage_summary()["totals"]["reported_completion"], 8)

    def test_worker_failure_still_counts_nothing_extra_and_releases_the_flag(self):
        def behavior(context): raise RuntimeError("provider failed")
        self.run_worker(behavior)
        self.assertFalse(self.engine._chat_model_worker_running)
        self.assertEqual(self.engine.get_usage_summary()["totals"]["replies"], 0)
        self.assertIn("could not complete", self.engine.emitted[-1]["error"])

    def test_a_usage_recording_problem_never_blocks_the_next_reply(self):
        with mock.patch.object(self.engine, "_usage_record_new_replies", side_effect=RuntimeError("disk")):
            self.run_worker(lambda context: None)
        self.assertFalse(self.engine._chat_model_worker_running)

    def test_engines_without_usage_support_still_work(self):
        chatgen, generation = self.mods["chat_generation"], self.mods["generation"]
        class Plain(chatgen.ChatModelGenerationMixin):
            def __init__(self): self.stream_lock = threading.Lock(); self.is_aborted = False; self._chat_model_worker_running = True
            def _emit(self, *a, **k): pass
        generation.GenerationMixin.behavior = staticmethod(lambda context: None)
        plain = Plain()
        plain._run_chat_bound_worker(type("C", (), {"current_chat_id": "c"})(), 1, "p", [], {})
        self.assertFalse(plain._chat_model_worker_running)

    # ---- repository wiring -----------------------------------------------------------------
    def test_engine_includes_usage_mixin_and_method_names_stay_unique(self):
        tree = ast.parse((ROOT / "backend" / "engine.py").read_text(encoding="utf-8"))
        engine = next(c for c in tree.body if isinstance(c, ast.ClassDef) and c.name == "ChatEngine")
        self.assertIn("UsageLogMixin", [ast.unparse(b) for b in engine.bases])
        self.assertTrue(any(isinstance(n, ast.ImportFrom) and n.module == "usage_log" for n in tree.body))
        seen = {}
        for file in sorted((ROOT / "backend").glob("*.py")):
            if file.name in ("shared.py", "document_export.py"): continue
            for cls in ast.parse(file.read_text(encoding="utf-8")).body:
                if isinstance(cls, ast.ClassDef):
                    for fn in cls.body:
                        if isinstance(fn, ast.FunctionDef):
                            self.assertNotIn(fn.name, seen, f"{fn.name} is defined in {file.name} and {seen.get(fn.name)}")
                            seen[fn.name] = file.name


if __name__ == "__main__":
    unittest.main()
