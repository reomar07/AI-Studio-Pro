"""Local, word-only spelling suggestions. No provider or network calls."""
from functools import lru_cache
import threading
import unicodedata
try:
    from spellchecker import SpellChecker
except ImportError:
    SpellChecker = None

_LOCK = threading.Lock()

@lru_cache(maxsize=2)
def _checker(language):
    return SpellChecker(language=language, distance=1)

class SpellingMixin:
    def get_spelling_suggestions(self, word, language="en"):
        if language not in ("en", "fr"):
            return {"ok": False, "suggestions": [], "message": "Choose English or French."}
        if not isinstance(word, str):
            return {"ok": False, "suggestions": [], "message": "Select one word."}
        word = unicodedata.normalize("NFC", word)
        if not 2 <= len(word) <= 32 or not any(c.isalpha() for c in word) or any(c not in "'-’" and "LATIN" not in unicodedata.name(c, "") for c in word):
            return {"ok": False, "suggestions": [], "message": "Select one English or French word (2-32 characters)."}
        if SpellChecker is None:
            return {"ok": False, "suggestions": [], "message": "Spelling dictionaries are missing. Install requirements.txt and rebuild the app."}
        try:
            with _LOCK:
                engine = _checker(language)
        except Exception as error:
            print(f"Spelling dictionary initialization failed: {type(error).__name__}: {error}")
            return {"ok": False, "error": "dictionary_load", "suggestions": [], "message": f"Dictionary initialization failed ({type(error).__name__}). See the VS Code terminal for details."}
        try:
            key = word.lower().replace("’", "'")
            with _LOCK:
                known = bool(engine.known([key]))
                candidates = [] if known else sorted(engine.candidates(key) or [], key=lambda c: (-engine.word_usage_frequency(c), c))[:5]
            if word.isupper(): candidates = [c.upper() for c in candidates]
            elif word.istitle(): candidates = [c.title() for c in candidates]
            return {"ok": True, "known": known, "suggestions": candidates, "message": "Already in this dictionary." if known else "No close suggestions." if not candidates else "Choose a replacement:"}
        except Exception as error:
            print(f"Spelling suggestion processing failed: {type(error).__name__}: {error}")
            return {"ok": False, "error": "suggestion_processing", "suggestions": [], "message": f"Dictionary loaded, but suggestions failed ({type(error).__name__}). See the VS Code terminal for details."}
