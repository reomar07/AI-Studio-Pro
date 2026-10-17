from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class ProfilesMixin:
    def _keyring_ok(self):
        if keyring is None:
            self.keyring_problem = "the 'keyring' package is not installed for this copy of Python"
            return False
        try:
            keyring.get_password(KEYRING_SERVICE, "__probe__")
            self.keyring_problem = ""
            return True
        except Exception as e:
            self.keyring_problem = f"Windows Credential Manager could not be reached: {str(e)[:80]}"
            return False


    def _load_and_migrate_config(self):
        data = self._load_json(CONFIG_FILE, None)
        if not data or "profiles" not in data:
            data = copy.deepcopy(DEFAULT_PROFILES)
            self.keys_in_keyring = False
            self.config = data
            self._write_config()
            return data
        use_keyring = self._keyring_ok()
        stored_ids = set(data.get("keyring_profiles", []))
        for pid, prof in data.get("profiles", {}).items():
            if use_keyring and pid in stored_ids and not prof.get("api_key"):
                try: prof["api_key"] = keyring.get_password(KEYRING_SERVICE, f"profile:{pid}") or ""
                except Exception: pass
        active = data.get("profiles", {}).get(data.get("active_profile_id", "default"), {})
        if active: data["api_key"] = active.get("api_key", "")
        self.keys_in_keyring = use_keyring
        self.keys_locked = bool(stored_ids) and not use_keyring   # keys exist in Credential Manager but this copy cannot read them
        self.config = data
        if use_keyring: self._write_config()    # moves any old plain-text keys into the secure store
        return data


    def _write_config(self):
        """Save settings. API keys go to the Windows Credential Manager when possible, otherwise into the file."""
        data = copy.deepcopy(self.config)
        previous = set(self.config.get("keyring_profiles", []))
        stored, use_keyring = [], self._keyring_ok()
        for pid, prof in data.get("profiles", {}).items():
            key = prof.get("api_key", "")
            if use_keyring:
                try:
                    if key: keyring.set_password(KEYRING_SERVICE, f"profile:{pid}", key)
                    else:
                        try: keyring.delete_password(KEYRING_SERVICE, f"profile:{pid}")
                        except Exception: pass
                    prof["api_key"] = ""
                    stored.append(pid)
                except Exception:
                    use_keyring = False            # could not store securely: keep the key in the file instead
        if use_keyring:
            data["api_key"] = ""
            for pid in previous - set(data.get("profiles", {}).keys()):   # deleted profiles
                try: keyring.delete_password(KEYRING_SERVICE, f"profile:{pid}")
                except Exception: pass
        if use_keyring:
            data["keyring_profiles"] = stored
        else:   # keep the marker for keys that still live in Credential Manager, so the .exe can find them again
            data["keyring_profiles"] = [pid for pid in previous if pid in data.get("profiles", {}) and not data["profiles"][pid].get("api_key")]
        self.keys_in_keyring = use_keyring
        self.config["keyring_profiles"] = data["keyring_profiles"]
        self._save_json(CONFIG_FILE, data)


    def key_storage_info(self):
        if getattr(self, "keys_in_keyring", False):
            return {"secure": True, "text": "🔒 Your API keys are stored in Windows Credential Manager (not in a file)."}
        why = f" ({self.keyring_problem})" if self.keyring_problem else ""
        if self.keys_locked:
            return {"secure": False, "text": f"⚠️ Your keys are stored in Windows Credential Manager, but this copy of the app cannot reach it{why}. Run the .exe, or install it with: pip install keyring (in the same Python that VS Code uses)."}
        return {"secure": False, "text": f"⚠️ Secure storage is not available{why} - keys are saved in a file in your AIStudioPro folder."}


    def get_config(self): return self.config


    def list_models(self):
        """Ask the active provider which models it offers (used by the model picker)."""
        try:
            active_id = self.config.get("active_profile_id", "default")
            profile = self.config.get("profiles", {}).get(active_id, {})
            api_key, base_url = profile.get("api_key") or "", profile.get("base_url") or ""
            if not api_key and not any(h in base_url for h in LOCAL_HOSTS):
                return {"ok": False, "error": "no API key yet", "models": []}
            raw = (profile.get("custom_headers") or "").strip()
            headers = None
            if raw.startswith("{"):
                try: headers = json.loads(raw)
                except Exception: pass
            client = OpenAI(base_url=base_url or None, api_key=api_key or "not-needed", default_headers=headers, timeout=15.0)
            seen, models = set(), []
            for m in client.models.list():
                mid = getattr(m, "id", None)
                if not mid or mid in seen: continue
                seen.add(mid)
                name = getattr(m, "name", None) or (getattr(m, "model_extra", None) or {}).get("name") or mid
                models.append({"id": str(mid), "name": str(name)})
                if len(models) >= 2000: break
            models.sort(key=lambda x: x["name"].lower())
            return {"ok": True, "models": models}
        except Exception as e:
            return {"ok": False, "error": str(e)[:150], "models": []}


    def save_config(self, cfg):
        self.config.update(cfg)
        active_id = self.config.get("active_profile_id", "default")
        profile = self.config.get("profiles", {}).get(active_id, {})
        if profile:
            self.config["api_key"] = profile.get("api_key", "")
            self.config["base_url"] = profile.get("base_url", "")
            self.config["model_name"] = profile.get("model_name", "")
            self.config["image_model"] = profile.get("image_model", "dall-e-3")
        self._write_config()
        return True

