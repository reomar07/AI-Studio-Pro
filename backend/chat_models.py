"""Per-chat model bindings. Credentials stay exclusively in provider profiles."""
from copy import deepcopy
import re

class ChatModelMemoryMixin:
    def _chat_model_valid_id(self, value, limit=512):
        return isinstance(value, str) and 0 < len(value) <= limit and value == value.strip() and not any(ord(c) < 32 or ord(c) == 127 for c in value)

    def _chat_model_exists(self, chat_id):
        return isinstance(chat_id, str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", chat_id)) and (chat_id in self.history or chat_id == self.current_chat_id)

    def get_chat_model_binding(self, chat_id):
        if not self._chat_model_exists(chat_id):
            return {"ok": False, "error": "unknown_chat", "message": "Choose an existing chat or start a new one."}
        meta = self.metadata.get(chat_id, {})
        if not isinstance(meta, dict):
            return {"ok": False, "error": "invalid_binding", "message": "Chat metadata is damaged. Select the provider and model again."}
        remembered = "model_binding" in meta
        profiles = self.config.get("profiles", {})
        if not isinstance(profiles, dict): profiles = {}
        if remembered:
            saved = meta["model_binding"]
            if not isinstance(saved, dict):
                return {"ok": False, "error": "invalid_binding", "message": "The saved model choice is invalid. Select the provider and model again."}
            # Project only identifiers; never return extra fields from imported data.
            binding = {name: saved.get(name, "") for name in ("profile_id", "model_name", "image_model")}
        else:
            pid = self.config.get("active_profile_id", "default")
            profile = profiles.get(pid, {}) if isinstance(pid, str) else {}
            if not isinstance(profile, dict): profile = {}
            binding = {"profile_id": pid, "model_name": profile.get("model_name", ""), "image_model": profile.get("image_model", "")}
        if not self._chat_model_valid_id(binding["profile_id"], 128) or not self._chat_model_valid_id(binding["model_name"]) or (binding["image_model"] != "" and not self._chat_model_valid_id(binding["image_model"])):
            return {"ok": False, "error": "invalid_binding", "message": "Select a valid provider and model for this chat."}
        if not isinstance(profiles.get(binding["profile_id"]), dict):
            return {"ok": False, "error": "missing_profile", "remembered": remembered, "binding": binding, "message": "This chat's provider profile is missing. Choose a replacement explicitly; no fallback will be used."}
        return {"ok": True, "remembered": remembered, "binding": binding}

    def set_chat_model_binding(self, chat_id, profile_id, model_id, image_model_id=None):
        if not self._chat_model_exists(chat_id):
            return {"ok": False, "error": "unknown_chat"}
        if not self._chat_model_valid_id(profile_id, 128) or not self._chat_model_valid_id(model_id):
            return {"ok": False, "error": "invalid_model"}
        profiles = self.config.get("profiles", {})
        profile = profiles.get(profile_id) if isinstance(profiles, dict) else None
        if not isinstance(profile, dict):
            return {"ok": False, "error": "missing_profile", "message": "Choose an existing provider profile."}
        image_model = profile.get("image_model", "") if image_model_id is None else image_model_id
        if image_model != "" and not self._chat_model_valid_id(image_model):
            return {"ok": False, "error": "invalid_model"}
        binding = {"profile_id": profile_id, "model_name": model_id, "image_model": image_model}
        existed = chat_id in self.metadata
        previous = deepcopy(self.metadata.get(chat_id))
        updated = deepcopy(previous) if isinstance(previous, dict) else {}
        updated["model_binding"] = binding
        self.metadata[chat_id] = updated
        try:
            self._save_json(self._chat_model_metadata_file, self.metadata)
            stored = self._load_json(self._chat_model_metadata_file, {})
            if stored.get(chat_id, {}).get("model_binding") != binding:
                raise OSError("Model binding was not persisted")
        except Exception:
            if existed: self.metadata[chat_id] = previous
            else: self.metadata.pop(chat_id, None)
            return {"ok": False, "error": "save_failed", "message": "Could not save this chat's model choice. The previous choice was kept."}
        return {"ok": True, "remembered": True, "binding": deepcopy(binding)}

    def _resolve_chat_model_profile(self, chat_id):
        result = self.get_chat_model_binding(chat_id)
        if not result["ok"]:
            raise ValueError(result.get("message", "Select a valid model for this chat."))
        binding = result["binding"]
        profile = deepcopy(self.config["profiles"][binding["profile_id"]])
        profile["model_name"] = binding["model_name"]
        profile["image_model"] = binding["image_model"]
        return profile
