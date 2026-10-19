"""Persistent model favorites and recent-model shortcuts."""
MAX_FAVORITE_MODELS = 20
MAX_RECENT_MODELS = 5

class ModelPreferencesMixin:
    def _model_preferences(self):
        favorites = self.config.setdefault("favorite_models", [])
        recents = self.config.setdefault("recent_models", [])
        if not isinstance(favorites, list): self.config["favorite_models"] = favorites = []
        if not isinstance(recents, list): self.config["recent_models"] = recents = []
        def clean(items):
            seen, out = set(), []
            for item in items:
                if isinstance(item, str) and item.strip() and item not in seen:
                    seen.add(item); out.append(item)
            return out
        self.config["favorite_models"] = clean(favorites)[:MAX_FAVORITE_MODELS]
        self.config["recent_models"] = clean(recents)[:MAX_RECENT_MODELS]
        return self.config["favorite_models"], self.config["recent_models"]

    def get_model_preferences(self):
        favorites, recents = self._model_preferences()
        return {"ok": True, "favorites": favorites, "recents": recents}

    def toggle_model_favorite(self, model_id):
        if not isinstance(model_id, str) or not model_id.strip():
            return {"ok": False, "error": "invalid_model", "favorites": [], "recents": []}
        model_id = model_id.strip()
        favorites, recents = self._model_preferences()
        if model_id in favorites: favorites.remove(model_id)
        else:
            favorites.insert(0, model_id)
            del favorites[MAX_FAVORITE_MODELS:]
        self._write_config()
        return {"ok": True, "favorite": model_id in favorites, "favorites": favorites, "recents": recents}

    def record_model_selection(self, model_id):
        if not isinstance(model_id, str) or not model_id.strip():
            return {"ok": False, "error": "invalid_model", "favorites": [], "recents": []}
        model_id = model_id.strip()
        favorites, recents = self._model_preferences()
        if model_id in recents: recents.remove(model_id)
        recents.insert(0, model_id)
        del recents[MAX_RECENT_MODELS:]
        self._write_config()
        return {"ok": True, "favorites": favorites, "recents": recents}
