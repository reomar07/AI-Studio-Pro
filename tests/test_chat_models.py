"""Unit tests with disposable JSON storage; no GUI, credential vault or network."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from copy import deepcopy
from backend.chat_models import ChatModelMemoryMixin

class MemoryHarness(ChatModelMemoryMixin):
    def __init__(self, path):
        self._chat_model_metadata_file = path
        self.history = {"chat_a": {}, "chat_b": {}}
        self.current_chat_id = "chat_new"
        self.metadata = self._load_json(path, {})
        self.config = {"active_profile_id": "cloud", "profiles": {
            "cloud": {"model_name": "default-model", "image_model": "image-a", "api_key": "test-secret", "base_url": "https://provider.invalid"},
            "local": {"model_name": "local-default", "image_model": "", "api_key": "local-test", "base_url": "http://localhost:1234/v1"}}}
    def _save_json(self, path, value):
        tmp = Path(str(path) + ".tmp")
        tmp.write_text(json.dumps(value), encoding="utf-8")
        tmp.replace(path)
    def _load_json(self, path, default):
        return json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else deepcopy(default)

class ChatModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "metadata.json"
        self.api = MemoryHarness(self.path)

    def test_legacy_chat_uses_current_profile_without_migration(self):
        result = self.api.get_chat_model_binding("chat_a")
        self.assertTrue(result["ok"])
        self.assertFalse(result["remembered"])
        self.assertEqual(result["binding"]["model_name"], "default-model")
        self.assertFalse(self.path.exists())

    def test_two_chats_restore_distinct_choices_after_reload(self):
        self.assertTrue(self.api.set_chat_model_binding("chat_a", "cloud", "model-a")["ok"])
        self.assertTrue(self.api.set_chat_model_binding("chat_b", "cloud", "model-b")["ok"])
        reloaded = MemoryHarness(self.path)
        self.assertEqual(reloaded.get_chat_model_binding("chat_a")["binding"]["model_name"], "model-a")
        self.assertEqual(reloaded.get_chat_model_binding("chat_b")["binding"]["model_name"], "model-b")
        self.assertEqual(reloaded.config["profiles"]["cloud"]["model_name"], "default-model")

    def test_metadata_preserved_and_credentials_never_serialized(self):
        self.api.metadata["chat_a"] = {"pinned": True, "tags": ["work"]}
        self.api.set_chat_model_binding("chat_a", "cloud", "custom/model", "custom-image")
        stored = json.loads(self.path.read_text())
        self.assertTrue(stored["chat_a"]["pinned"])
        self.assertEqual(stored["chat_a"]["tags"], ["work"])
        self.assertEqual(set(stored["chat_a"]["model_binding"]), {"profile_id", "model_name", "image_model"})
        self.assertNotIn("test-secret", self.path.read_text())
        self.assertNotIn("provider.invalid", self.path.read_text())
        profile = self.api._resolve_chat_model_profile("chat_a")
        self.assertEqual(profile["api_key"], "test-secret")
        self.assertEqual(profile["model_name"], "custom/model")
        self.assertEqual(profile["image_model"], "custom-image")
        profile["api_key"] = "changed-copy"
        self.assertEqual(self.api.config["profiles"]["cloud"]["api_key"], "test-secret")

    def test_deleted_profile_never_falls_back(self):
        self.api.set_chat_model_binding("chat_a", "cloud", "saved")
        del self.api.config["profiles"]["cloud"]
        self.api.config["active_profile_id"] = "local"
        self.assertEqual(self.api.get_chat_model_binding("chat_a")["error"], "missing_profile")
        with self.assertRaises(ValueError): self.api._resolve_chat_model_profile("chat_a")
        self.assertTrue(self.api.set_chat_model_binding("chat_a", "local", "replacement")["ok"])

    def test_invalid_inputs_do_not_write(self):
        for args in [("unknown", "cloud", "m"), ("../chat", "cloud", "m"), ("chat_a", "missing", "m"), ("chat_a", "cloud", ""), ("chat_a", "cloud", " m"), ("chat_a", "cloud", "m\n"), ("chat_a", "cloud", None), ("chat_a", "cloud", "m" * 513)]:
            self.assertFalse(self.api.set_chat_model_binding(*args)["ok"], args)
        self.assertFalse(self.path.exists())

    def test_new_chat_can_save_before_first_message(self):
        result = self.api.set_chat_model_binding("chat_new", "local", "local-choice")
        self.assertTrue(result["ok"])
        self.assertEqual(result["binding"]["image_model"], "")

    def test_silent_write_failure_retains_previous_choice(self):
        self.api.set_chat_model_binding("chat_a", "cloud", "before")
        with patch.object(self.api, "_save_json", return_value=None):
            result = self.api.set_chat_model_binding("chat_a", "cloud", "after")
        self.assertEqual(result["error"], "save_failed")
        self.assertEqual(self.api.get_chat_model_binding("chat_a")["binding"]["model_name"], "before")
        with patch.object(self.api, "_save_json", side_effect=OSError("read only")):
            self.assertEqual(self.api.set_chat_model_binding("chat_b", "local", "m")["error"], "save_failed")
        self.assertNotIn("chat_b", self.api.metadata)

    def test_imported_binding_projects_only_identifiers_and_rejects_damage(self):
        self.api.metadata["chat_a"] = {"model_binding": {"profile_id": "cloud", "model_name": "m", "api_key": "injected"}}
        self.assertNotIn("api_key", self.api.get_chat_model_binding("chat_a")["binding"])
        self.assertEqual(self.api._resolve_chat_model_profile("chat_a")["api_key"], "test-secret")
        for damaged in [None, "oops", {"profile_id": [], "model_name": "m"}]:
            self.api.metadata["chat_a"] = {"model_binding": damaged}
            self.assertEqual(self.api.get_chat_model_binding("chat_a")["error"], "invalid_binding")

if __name__ == "__main__": unittest.main()
