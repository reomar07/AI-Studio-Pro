"""Chat tags live in metadata beside pins and model bindings; no chat files are moved."""
from copy import deepcopy
import threading
import unicodedata

MAX_TAGS = 8
MAX_TAG_LENGTH = 32
_TAG_LOCK = threading.RLock()


def _tag_normalize(value):
    if not isinstance(value, str) or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("Use plain text tag names.")
    name = unicodedata.normalize("NFC", " ".join(value.split())).casefold()
    name = unicodedata.normalize("NFC", name)
    if not 1 <= len(name) <= MAX_TAG_LENGTH or "," in name:
        raise ValueError("Each tag must be 1-32 characters, without commas or control characters.")
    return name


def _tag_read(value):
    if not isinstance(value, list): return []
    found = set()
    for item in value[:MAX_TAGS]:
        try: found.add(_tag_normalize(item))
        except ValueError: pass
    return sorted(found)


class ChatTagsMixin:
    def _tag_target_exists(self, chat_id):
        return (isinstance(chat_id, str) and 0 < len(chat_id) <= 128
                and isinstance(self.history, dict)
                and (chat_id in self.history or chat_id == self.current_chat_id))

    def get_chat_tags(self, chat_id):
        with _TAG_LOCK:
            if not self._tag_target_exists(chat_id):
                return {"ok": False, "error": "unknown_chat", "message": "Choose an existing chat."}
            if not isinstance(self.metadata, dict) or not isinstance(self.metadata.get(chat_id, {}), dict):
                return {"ok": False, "error": "invalid_metadata", "message": "This chat's metadata could not be read."}
            return {"ok": True, "tags": _tag_read(self.metadata.get(chat_id, {}).get("tags")),
                    "max_tags": MAX_TAGS, "max_length": MAX_TAG_LENGTH}

    def get_chat_tag_index(self):
        with _TAG_LOCK:
            if not isinstance(self.history, dict) or not isinstance(self.metadata, dict):
                return {"ok": False, "message": "Chat tags could not be read."}
            chats, counts = {}, {}
            for chat_id in list(self.history):
                meta = self.metadata.get(chat_id, {})
                names = _tag_read(meta.get("tags")) if isinstance(meta, dict) else []
                chats[chat_id] = names
                for name in names: counts[name] = counts.get(name, 0) + 1
            return {"ok": True, "chats": chats,
                    "tags": [{"name": name, "count": counts[name]} for name in sorted(counts)]}

    def set_chat_tags(self, chat_id, tags):
        if not isinstance(tags, list) or len(tags) > MAX_TAGS:
            return {"ok": False, "error": "invalid_tags", "message": "Use up to eight tags for a chat."}
        try: normalized = sorted({_tag_normalize(value) for value in tags})
        except ValueError as error:
            return {"ok": False, "error": "invalid_tags", "message": str(error)}
        with _TAG_LOCK:
            if not self._tag_target_exists(chat_id):
                return {"ok": False, "error": "unknown_chat", "message": "Choose an existing chat."}
            if not isinstance(self.metadata, dict) or not isinstance(self.metadata.get(chat_id, {}), dict):
                return {"ok": False, "error": "invalid_metadata", "message": "Damaged chat metadata was left unchanged."}
            existed = chat_id in self.metadata
            meta = self.metadata.setdefault(chat_id, {})
            had_tags, previous = "tags" in meta, deepcopy(meta.get("tags"))
            meta["tags"] = normalized
            try:
                self._save_json(self._chat_tags_metadata_file, self.metadata)
                saved = self._load_json(self._chat_tags_metadata_file, None)
                if not isinstance(saved, dict) or saved.get(chat_id, {}).get("tags") != normalized:
                    raise OSError("Tag save did not verify")
            except Exception:
                # Restore only this field; never roll back pins, model choices or another chat.
                live = self.metadata.get(chat_id)
                if isinstance(live, dict):
                    if had_tags: live["tags"] = previous
                    else: live.pop("tags", None)
                    if not existed and not live: self.metadata.pop(chat_id, None)
                return {"ok": False, "error": "save_failed",
                        "message": "Tags could not be verified on disk. Reopen the chat before retrying."}
            return {"ok": True, "tags": normalized[:], "max_tags": MAX_TAGS, "max_length": MAX_TAG_LENGTH}
