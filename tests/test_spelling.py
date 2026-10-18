import unittest
from unittest.mock import patch
from backend import spelling

class FakeDictionary:
    def known(self, words): return set(words) & {"hello", "bonjour"}
    def candidates(self, word): return {"hello", "help"} if word == "helllo" else {"bonjour"}
    def word_usage_frequency(self, word): return {"hello": 0.9, "help": 0.1, "bonjour": 1}.get(word, 0)

class SpellingTests(unittest.TestCase):
    def setUp(self): self.api = spelling.SpellingMixin()

    def test_invalid_inputs(self):
        for word in (None, "", "x", "two words", "https://example.com", "token_123", "x"*33, "مرحبا"):
            self.assertFalse(self.api.get_spelling_suggestions(word, "en")["ok"])
        self.assertFalse(self.api.get_spelling_suggestions("hello", "ar")["ok"])

    def test_frequency_case_and_known(self):
        with patch.object(spelling, "SpellChecker", object), patch.object(spelling, "_checker", return_value=FakeDictionary()):
            self.assertEqual(self.api.get_spelling_suggestions("Helllo")["suggestions"], ["Hello", "Help"])
            self.assertEqual(self.api.get_spelling_suggestions("HELLLO")["suggestions"], ["HELLO", "HELP"])
            self.assertTrue(self.api.get_spelling_suggestions("bonjour", "fr")["known"])

    def test_missing_package(self):
        with patch.object(spelling, "SpellChecker", None):
            self.assertFalse(self.api.get_spelling_suggestions("hello")["ok"])

    def test_packaged_dictionaries_load(self):
        self.assertIsNotNone(spelling.SpellChecker)
        self.assertTrue(self.api.get_spelling_suggestions("hello", "en")["known"])
        self.assertTrue(self.api.get_spelling_suggestions("bonjour", "fr")["known"])

    def test_real_library_ranks_actual_corrections(self):
        self.assertIsNotNone(spelling.SpellChecker)
        # Real SpellChecker, controlled word frequencies: exercises candidates and ranking, not just known words.
        engine = spelling.SpellChecker(language=None, distance=1)
        engine.word_frequency.load_json({"hello": 100, "help": 10, "bonjour": 80})
        with patch.object(spelling, "_checker", return_value=engine):
            result = self.api.get_spelling_suggestions("Helllo", "en")
            self.assertTrue(result["ok"], result)
            self.assertIn("Hello", result["suggestions"])
            french = self.api.get_spelling_suggestions("Bonjor", "fr")
            self.assertTrue(french["ok"], french)
            self.assertIn("Bonjour", french["suggestions"])

    def test_loading_and_processing_errors_are_distinct(self):
        with patch.object(spelling, "SpellChecker", object):
            with patch.object(spelling, "_checker", side_effect=OSError("test load failure")):
                result = self.api.get_spelling_suggestions("helllo")
                self.assertEqual(result["error"], "dictionary_load")
            with patch.object(spelling, "_checker", return_value=object()):
                result = self.api.get_spelling_suggestions("helllo")
                self.assertEqual(result["error"], "suggestion_processing")
