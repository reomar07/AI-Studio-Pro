import json, tempfile, unittest
from pathlib import Path
from backend.model_preferences import ModelPreferencesMixin, MAX_FAVORITE_MODELS, MAX_RECENT_MODELS

class FakeEngine(ModelPreferencesMixin):
    def __init__(self):
        self.config = {}
        self.saved = []
    def _write_config(self): self.saved.append(json.loads(json.dumps(self.config)))

class ModelPreferenceTests(unittest.TestCase):
    def setUp(self): self.engine = FakeEngine()

    def test_defaults_and_normalization(self):
        self.engine.config = {"favorite_models": ["", "m1", "m1", 7], "recent_models": "bad"}
        result = self.engine.get_model_preferences()
        self.assertEqual(result["favorites"], ["m1"])
        self.assertEqual(result["recents"], [])
        self.assertEqual(self.engine.config["recent_models"], [])

    def test_favorite_toggle_order_and_limit(self):
        for i in range(MAX_FAVORITE_MODELS + 2): self.engine.toggle_model_favorite(f"m{i}")
        self.assertEqual(self.engine.get_model_preferences()["favorites"], [f"m{i}" for i in range(MAX_FAVORITE_MODELS + 1, 1, -1)])
        result = self.engine.toggle_model_favorite("m10")
        self.assertFalse(result["favorite"])
        self.assertNotIn("m10", result["favorites"])
        result = self.engine.toggle_model_favorite("m10")
        self.assertTrue(result["favorite"])
        self.assertEqual(result["favorites"][0], "m10")

    def test_recent_selection_deduplicates_and_limits(self):
        for model in ["a", "b", "c", "d", "e", "f", "b"]:
            self.engine.record_model_selection(model)
        self.assertEqual(self.engine.get_model_preferences()["recents"], ["b", "f", "e", "d", "c"])

    def test_invalid_model_is_rejected(self):
        for method in (self.engine.toggle_model_favorite, self.engine.record_model_selection):
            self.assertFalse(method("  ")["ok"])
            self.assertFalse(method(None)["ok"])

if __name__ == "__main__": unittest.main()
