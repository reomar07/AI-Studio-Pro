"""Backup, stored-history and attachment safety tests.

Everything runs in disposable folders with a stub provider and stub window layer: no GUI,
real credentials, network access or real user data. The repository's real history.py,
documents.py and data_safety.py are copied into a temporary package and exercised together.
"""
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

ROOT = Path(__file__).resolve().parents[1]
_serial = 0


def stub_shared_source(data_dir):
    return f"""
import base64, json, os, re, shutil, time
from types import SimpleNamespace
DATA_DIR = {str(data_dir)!r}
ATTACH_DIR = os.path.join(DATA_DIR, "attachments")
HISTORY_FILE = "history"
METADATA_FILE = "metadata"
SETTINGS_FILE = "settings"
PROMPTS_FILE = "prompts"
_ID_RE = re.compile(r"^[\\w.-]{{1,80}}$")
_STATUS_PREFIX_RE = re.compile(r"^$")
TOASTS = []
def js_toast(message): TOASTS.append(str(message))
DIALOG = {{"paths": []}}
webview = SimpleNamespace(FileDialog=SimpleNamespace(OPEN=0, SAVE=1, FOLDER=2),
                          windows=[SimpleNamespace(create_file_dialog=lambda *a, **k: DIALOG["paths"])])
class OpenAI:
    def __init__(self, **kwargs):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
    def _create(self, **kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Short title"))])
"""


def load_package(tmp):
    global _serial
    _serial += 1
    name = f"ds_backend_{_serial}"
    package = Path(tmp) / name
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "shared.py").write_text(stub_shared_source(Path(tmp) / "AIStudioPro"), encoding="utf-8")
    for module in ("history", "documents", "data_safety"):
        shutil.copy2(ROOT / "backend" / f"{module}.py", package / f"{module}.py")
    sys.path.insert(0, str(tmp))
    importlib.invalidate_caches()
    modules = {m: importlib.import_module(f"{name}.{m}") for m in ("shared", "history", "documents", "data_safety")}
    return name, modules


def node(nid, role, parent=None, children=()):
    return {"id": nid, "role": role, "parent": parent, "children": list(children),
            "content": nid, "display_text": nid, "title": "Original" if parent is None else ""}


def good_chat():
    return {"nodes": {"m1": node("m1", "user", None, ["m2", "m3"]),
                      "m2": node("m2", "assistant", "m1"), "m3": node("m3", "assistant", "m1")},
            "current_node": "m3"}


def cyclic_chats():
    return {
        "self_parent": {"nodes": {"loop": node("loop", "user", "loop", ["loop"])}, "current_node": "loop"},
        "two_node_cycle": {"nodes": {"a": node("a", "user", "b", ["b"]), "b": node("b", "assistant", "a", ["a"])}, "current_node": "a"},
        "child_loop": {"nodes": {"r": node("r", "user", None, ["x", "y"]), "x": node("x", "assistant", "r", ["z"]),
                                 "y": node("y", "assistant", "r"), "z": node("z", "user", "x", ["x"])}, "current_node": "y"},
    }


def finishes(fn, timeout=3):
    box = {}
    def run():
        try: box["value"] = fn()
        except BaseException as error: box["error"] = error
    thread = threading.Thread(target=run, daemon=True)
    thread.start(); thread.join(timeout)
    if thread.is_alive(): raise AssertionError("Operation did not finish; possible infinite loop.")
    if "error" in box: raise box["error"]
    return box.get("value")


def snapshot(folder):
    base = Path(folder)
    return {str(p.relative_to(base)): p.read_bytes() for p in sorted(base.rglob("*")) if p.is_file()}


class DataSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.name, self.mods = load_package(self.temp.name)
        self.addCleanup(self._unload)
        shared, history, documents, safety = (self.mods[m] for m in ("shared", "history", "documents", "data_safety"))
        class Engine(safety.DataSafetyMixin, history.HistoryMixin, documents.DocumentsMixin):
            def __init__(self):
                self.history, self.metadata, self.chat_settings, self.prompts = {}, {}, {}, []
                self.session_files, self.saved = {}, []
            def _save_json(self, path, data): self.saved.append(path)
            @staticmethod
            def _clean_title(raw, prompt): return str(raw).strip()
        self.engine = Engine()
        self.data = Path(shared.DATA_DIR)
        self.attach = Path(shared.ATTACH_DIR)
        (self.attach / "chat_a").mkdir(parents=True)
        (self.attach / "chat_b").mkdir(parents=True)
        (self.data / "chat_history.json").write_text("important chats", encoding="utf-8")
        (self.attach / "chat_a" / "a.txt").write_text("A", encoding="utf-8")
        (self.attach / "chat_b" / "b.txt").write_text("B", encoding="utf-8")
        self.seed = snapshot(self.data)

    def _unload(self):
        for key in [k for k in sys.modules if k == self.name or k.startswith(self.name + ".")]:
            del sys.modules[key]
        if self.temp.name in sys.path: sys.path.remove(self.temp.name)

    # ---- R1: attachment folders and imported chat ids -------------------------------------
    def test_path_special_ids_have_no_attachment_folder(self):
        safety = self.mods["data_safety"]
        for bad in ["..", ".", "...", "", "chat.", "CON", "nul.txt", "LPT1", "x" * 121]:
            self.assertIsNone(safety.attachment_folder_name(bad), bad)
            self.assertIsNone(safety.attachment_folder(bad), bad)
        self.assertEqual(safety.attachment_folder_name("chat_1730000000000"), "chat_1730000000000")
        self.assertEqual(safety.attachment_folder_name("../x"), ".._x")
        self.assertEqual(Path(safety.attachment_folder("chat_a")), (self.attach / "chat_a").resolve())

    def test_cleanup_never_touches_data_folder_or_other_chats(self):
        for bad in ["..", ".", "CON"]:
            self.engine._remove_attachment_folder(bad)
            self.engine.delete_chat(bad)
            self.assertEqual(snapshot(self.data), self.seed, bad)
        self.engine.delete_chat("chat_a")
        remaining = snapshot(self.data)
        self.assertNotIn(os.path.join("attachments", "chat_a", "a.txt"), remaining)
        self.assertEqual(remaining[os.path.join("attachments", "chat_b", "b.txt")], b"B")
        self.assertEqual(remaining["chat_history.json"], b"important chats")

    def test_symlinked_attachment_folder_cannot_delete_outside_files(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir(); (outside / "keep.txt").write_text("keep", encoding="utf-8")
        try: os.symlink(outside, self.attach / "chat_link", target_is_directory=True)
        except (OSError, NotImplementedError): self.skipTest("Symbolic links are unavailable here.")
        self.engine._remove_attachment_folder("chat_link")
        self.assertEqual((outside / "keep.txt").read_text(encoding="utf-8"), "keep")

    def test_attachments_are_saved_only_for_safe_ids(self):
        payload = {"name": "note.txt", "data": "data:text/plain;base64,aGk="}
        path = self.engine._save_attachment("chat_a", dict(payload))
        self.assertEqual(Path(path).read_bytes(), b"hi")
        self.assertEqual(Path(path).parent.resolve(), (self.attach / "chat_a").resolve())
        before = snapshot(self.data)
        for bad in ["..", ".", "CON", ""]:
            self.assertIsNone(self.engine._save_attachment(bad, dict(payload)), bad)
        self.assertEqual(snapshot(self.data), before)

    def test_import_regenerates_path_special_ids_and_keeps_normal_ones(self):
        backup = {"history": {"..": good_chat(), ".": good_chat(), "chat_ok": good_chat(), "a/b": good_chat(), "CON": good_chat(),
                              "cyclic": cyclic_chats()["two_node_cycle"]},
                  "metadata": {"..": {"pinned": True}, "chat_ok": {"pinned": False}},
                  "settings": {".": {"temperature": 1}}}
        path = Path(self.temp.name) / "backup.json"
        path.write_text(json.dumps(backup), encoding="utf-8")
        self.mods["shared"].DIALOG["paths"] = [str(path)]
        self.assertEqual(self.engine.import_chats(), 5)
        history = self.engine.history
        self.assertIn("chat_ok", history)
        self.assertTrue({"..", ".", "a/b", "CON", "cyclic"}.isdisjoint(history))
        self.assertEqual(len(history), 5)
        safety = self.mods["data_safety"]
        self.assertTrue(all(safety.chat_id_is_safe(cid) for cid in history))
        self.assertEqual(self.engine.metadata["chat_ok"], {"pinned": False})
        self.assertEqual(sum(1 for v in self.engine.metadata.values() if v == {"pinned": True}), 1)
        self.assertNotIn("..", self.engine.metadata)
        self.assertEqual(sum(1 for v in self.engine.chat_settings.values() if v == {"temperature": 1}), 1)
        self.assertIn("Imported 5 chat(s).", self.mods["shared"].TOASTS[-1])
        self.assertIn("Skipped 1", self.mods["shared"].TOASTS[-1])
        for cid in list(history): self.engine.delete_chat(cid)
        self.assertEqual(snapshot(self.data), self.seed)

    def test_reimporting_the_same_backup_adds_nothing(self):
        data = {"history": {"chat_ok": good_chat()}}
        self.assertEqual(self.engine._import_chat_data(data), 1)
        self.assertEqual(self.engine._import_chat_data(deepcopy_json(data)), 0)
        self.assertEqual(list(self.engine.history), ["chat_ok"])
        self.assertEqual(self.mods["shared"].TOASTS[-1], "Nothing new to import.")

    # ---- R3: cyclic or inconsistent chat trees ---------------------------------------------
    def test_validator_accepts_real_branching_chat_and_rejects_loops(self):
        valid = self.engine._valid_chat
        self.assertTrue(valid(good_chat()))
        empty = good_chat(); empty["current_node"] = None
        self.assertTrue(valid(empty))
        for name, chat in cyclic_chats().items():
            self.assertFalse(valid(chat), name)

    def test_validator_rejects_inconsistent_or_malformed_trees(self):
        valid = self.engine._valid_chat
        def mutated(change):
            chat = good_chat(); change(chat["nodes"]); return chat
        cases = {
            "parent missing child": lambda n: n["m1"].update(children=["m2"]),
            "child names another parent": lambda n: n["m2"].update(parent="m3"),
            "duplicate children": lambda n: n["m1"].update(children=["m2", "m2", "m3"]),
            "unknown child": lambda n: n["m1"].update(children=["m2", "m3", "ghost"]),
            "unhashable child": lambda n: n["m1"].update(children=[["m2"], "m3"]),
            "bad role": lambda n: n["m2"].update(role="tool"),
            "id mismatch": lambda n: n["m2"].update(id="other"),
            "missing parent key": lambda n: n["m2"].pop("parent"),
        }
        for label, change in cases.items():
            self.assertFalse(valid(mutated(change)), label)
        bad_current = good_chat(); bad_current["current_node"] = "ghost"
        for value in (None, [], {"nodes": {}}, {"nodes": []}, bad_current):
            self.assertFalse(valid(value))

    def test_branch_walk_matches_original_for_valid_chats_and_raises_for_loops(self):
        chat = good_chat()
        original = self.mods["history"].HistoryMixin._get_linear_branch(self.engine, chat)
        self.assertEqual(self.engine._get_linear_branch(chat), original)
        self.assertEqual([m["id"] for m in original], ["m1", "m3"])
        for name in ("self_parent", "two_node_cycle"):
            with self.assertRaises(ValueError, msg=name):
                finishes(lambda c=cyclic_chats()[name]: self.engine._get_linear_branch(c))

    def test_one_looping_chat_does_not_break_history_loading(self):
        self.engine.history = {"good": good_chat(), "bad": cyclic_chats()["self_parent"]}
        result = finishes(self.engine.get_history)
        self.assertEqual(list(result), ["good"])
        self.assertEqual(result["good"][-1]["id"], "m3")

    def test_branch_switching_still_works_and_stops_on_loops(self):
        self.engine.history = {"c": good_chat(), "bad": cyclic_chats()["child_loop"]}
        self.assertTrue(self.engine.switch_branch("c", "m3", -1))
        self.assertEqual(self.engine.history["c"]["current_node"], "m2")
        self.assertIn("history", self.engine.saved)
        self.assertFalse(finishes(lambda: self.engine.switch_branch("bad", "y", -1)))
        self.assertEqual(self.engine.history["bad"]["current_node"], "y")

    def test_title_generation_updates_valid_chats_and_stops_on_loops(self):
        self.engine.history = {"good": good_chat(), "bad": cyclic_chats()["self_parent"]}
        profile = {"api_key": "test", "base_url": "http://localhost", "model_name": "m"}
        finishes(lambda: self.engine._generate_title_thread("good", "prompt", profile))
        self.assertEqual(self.engine.history["good"]["nodes"]["m1"]["title"], "Short title")
        before = json.dumps(self.engine.history["bad"], sort_keys=True)
        finishes(lambda: self.engine._generate_title_thread("bad", "prompt", profile))
        self.assertEqual(json.dumps(self.engine.history["bad"], sort_keys=True), before)

    def test_import_skips_looping_chats_but_keeps_valid_ones(self):
        data = {"history": {"good": good_chat(), "bad": cyclic_chats()["two_node_cycle"]}}
        self.assertEqual(finishes(lambda: self.engine._import_chat_data(data)), 1)
        self.assertEqual(list(self.engine.history), ["good"])
        self.assertIn("Skipped 1", self.mods["shared"].TOASTS[-1])

    # ---- wiring ----------------------------------------------------------------------------
    def test_engine_places_safety_mixin_ahead_of_history_and_documents(self):
        tree = ast.parse((ROOT / "backend" / "engine.py").read_text(encoding="utf-8"))
        engine = next(c for c in tree.body if isinstance(c, ast.ClassDef) and c.name == "ChatEngine")
        bases = [ast.unparse(b) for b in engine.bases]
        self.assertEqual(bases[0], "DataSafetyMixin")
        for later in ("HistoryMixin", "DocumentsMixin", "GenerationMixin"):
            self.assertLess(bases.index("DataSafetyMixin"), bases.index(later))
        self.assertTrue(any(isinstance(n, ast.ImportFrom) and n.module == "data_safety" for n in tree.body))
        self.assertTrue(any(isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "send_prompt_stream" for t in n.targets)
                            for n in engine.body))


def deepcopy_json(value):
    return json.loads(json.dumps(value))


if __name__ == "__main__":
    unittest.main()
