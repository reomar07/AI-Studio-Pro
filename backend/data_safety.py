"""Safety guards for backups, stored chat trees and per-chat attachment folders.

This mixin is placed ahead of HistoryMixin and DocumentsMixin in ChatEngine, so the
methods below take precedence without rewriting those larger modules.
"""
import base64
import json
import os
import re
import shutil
import time

from .shared import ATTACH_DIR, HISTORY_FILE, METADATA_FILE, SETTINGS_FILE, OpenAI, js_toast, webview

_PLAIN_ID_RE = re.compile(r"^[\w.-]{1,80}$")
_ROLES = ("user", "assistant", "system")
_WINDOWS_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def attachment_folder_name(chat_id):
    """Folder name for a chat's attachments, or None when the id cannot be used safely.

    Normal ids keep the exact name older versions used, so existing attachments stay reachable.
    """
    name = re.sub(r"[^\w.-]", "_", str(chat_id))
    if not name or len(name) > 120 or name in (".", "..") or name.endswith("."):
        return None
    if name.split(".", 1)[0].lower() in _WINDOWS_RESERVED:
        return None
    return name


def attachment_folder(chat_id):
    """Absolute attachment folder strictly inside ATTACH_DIR, or None."""
    name = attachment_folder_name(chat_id)
    if name is None:
        return None
    base = os.path.realpath(ATTACH_DIR)
    folder = os.path.realpath(os.path.join(base, name))
    try:
        if folder == base or os.path.commonpath([folder, base]) != base:
            return None
    except ValueError:
        return None
    return folder


def chat_id_is_safe(chat_id):
    text = str(chat_id)
    return bool(_PLAIN_ID_RE.match(text)) and attachment_folder_name(text) == text


class DataSafetyMixin:
    @staticmethod
    def _valid_chat(chat):
        """True only for a well-formed, acyclic chat tree (used for backups and stored history)."""
        try:
            nodes = chat.get("nodes")
            if not isinstance(nodes, dict) or not nodes:
                return False
            for nid, n in nodes.items():
                if not _PLAIN_ID_RE.match(str(nid)) or not isinstance(n, dict):
                    return False
                if n.get("role") not in _ROLES or n.get("id", nid) != nid or "parent" not in n:
                    return False
                parent = n.get("parent")
                if parent is not None and (parent not in nodes or parent == nid):
                    return False
                kids = n.get("children")
                if not isinstance(kids, list) or len(set(kids)) != len(kids):
                    return False
                if any(k not in nodes or k == nid for k in kids):
                    return False
            for nid, n in nodes.items():
                for kid in n["children"]:
                    if nodes[kid].get("parent") != nid:
                        return False
                parent = n.get("parent")
                if parent is not None and nid not in nodes[parent]["children"]:
                    return False
            done = set()
            for start in nodes:
                walking, cur = set(), start
                while cur is not None and cur not in done:
                    if cur in walking:
                        return False
                    walking.add(cur)
                    cur = nodes[cur].get("parent")
                done |= walking
            current = chat.get("current_node")
            return current is None or current in nodes
        except Exception:
            return False

    def _get_linear_branch(self, chat_data):
        if not chat_data or not chat_data.get("current_node"):
            return []
        nodes = chat_data["nodes"]
        curr = chat_data["current_node"]
        path, seen = [], set()
        while curr and curr in nodes:
            if curr in seen:
                raise ValueError("Chat history contains a loop.")
            seen.add(curr)
            path.append(curr)
            curr = nodes[curr]["parent"]
        path.reverse()
        linear = []
        for nid in path:
            msg = dict(nodes[nid])
            pid = msg["parent"]
            if pid and pid in nodes:
                siblings = nodes[pid]["children"]
                msg["branch_count"] = len(siblings)
                msg["branch_index"] = siblings.index(nid) + 1
            else:
                msg["branch_count"] = 1
                msg["branch_index"] = 1
            linear.append(msg)
        return linear

    def switch_branch(self, chat_id, msg_id, direction):
        chat = self.history.get(chat_id)
        if not chat or msg_id not in chat["nodes"]:
            return False
        msg = chat["nodes"][msg_id]
        pid = msg["parent"]
        if not pid:
            return False
        siblings = chat["nodes"][pid]["children"]
        idx = siblings.index(msg_id)
        new_idx = (idx + direction) % len(siblings)
        curr, seen = siblings[new_idx], set()
        while chat["nodes"][curr]["children"]:
            if curr in seen:
                return False
            seen.add(curr)
            curr = chat["nodes"][curr]["children"][-1]
        chat["current_node"] = curr
        self._save_json(HISTORY_FILE, self.history)
        return True

    def _generate_title_thread(self, chat_id, prompt_text, profile):
        try:
            custom_headers_raw = (profile.get("custom_headers") or "").strip()
            headers = json.loads(custom_headers_raw) if custom_headers_raw.startswith("{") else None
            client = OpenAI(base_url=profile.get("base_url") or None, api_key=profile.get("api_key") or "none", default_headers=headers, timeout=60.0)
            response = client.chat.completions.create(
                model=profile.get("model_name") or "gpt-4o",
                messages=[{"role": "system", "content": "Summarize this user request in 2 to 4 words. Respond ONLY with the title. No quotes, no punctuation."}, {"role": "user", "content": str(prompt_text)[:500]}],
                max_tokens=40, temperature=0.3
            )
            title = self._clean_title(response.choices[0].message.content, prompt_text)
            chat = self.history.get(chat_id)
            if chat and chat.get("current_node"):
                curr, seen = chat["current_node"], set()
                while chat["nodes"][curr]["parent"]:
                    if curr in seen:
                        return
                    seen.add(curr)
                    curr = chat["nodes"][curr]["parent"]
                chat["nodes"][curr]["title"] = title
                self._save_json(HISTORY_FILE, self.history)
        except Exception:
            pass

    def _remove_attachment_folder(self, chat_id):
        try:
            folder = attachment_folder(chat_id)
            if folder and os.path.isdir(folder):
                shutil.rmtree(folder, ignore_errors=True)
        except Exception:
            pass

    def _save_attachment(self, chat_id, f):
        """Keeps a copy of a file the user sent, only inside that chat's own attachment folder."""
        try:
            data_url = f.get("data", "")
            if "," not in data_url:
                return None
            folder = attachment_folder(chat_id)
            if folder is None:
                return None
            raw = base64.b64decode(data_url.split(",", 1)[1])
            if len(raw) > 60 * 1024 * 1024:
                return None
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"{int(time.time() * 1000)}_{self._safe_filename(f.get('name'))}")
            with open(path, "wb") as fh:
                fh.write(raw)
            return path
        except Exception:
            return None

    def _unused_chat_id(self):
        base = f"chat_{int(time.time() * 1000)}"
        candidate, n = base, 0
        while candidate in self.history:
            n += 1
            candidate = f"{base}_{n}"
        return candidate

    def import_chats(self):
        """Adds chats from a backup file. Existing chats are never overwritten."""
        try:
            dialog_type = getattr(webview.FileDialog, 'OPEN', getattr(webview, 'OPEN_DIALOG', 0))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, allow_multiple=False, file_types=("JSON files (*.json)", "All files (*.*)")))
            if not result:
                return 0
            with open(result[0], "r", encoding="utf-8") as f:
                data = json.load(f)
            return self._import_chat_data(data)
        except Exception as e:
            js_toast(f"Import failed: {str(e)[:120]}")
            return 0

    def _import_chat_data(self, data):
        incoming = data.get("history") if isinstance(data, dict) and "history" in data else data
        if not isinstance(incoming, dict):
            raise ValueError("This file is not an AI Studio Pro backup.")
        metadata = data.get("metadata", {}) if isinstance(data, dict) else {}
        settings = data.get("settings", {}) if isinstance(data, dict) else {}
        if not isinstance(metadata, dict): metadata = {}
        if not isinstance(settings, dict): settings = {}
        added = skipped = 0
        for cid, chat in incoming.items():
            if not self._valid_chat(chat):
                skipped += 1
                continue
            new_id = str(cid) if chat_id_is_safe(cid) else self._unused_chat_id()
            if new_id in self.history:
                if json.dumps(self.history[new_id], sort_keys=True) == json.dumps(chat, sort_keys=True):
                    continue   # already here
                new_id = self._unused_chat_id()
            self.history[new_id] = chat
            if isinstance(metadata.get(cid), dict): self.metadata[new_id] = metadata[cid]
            if isinstance(settings.get(cid), dict): self.chat_settings[new_id] = settings[cid]
            added += 1
        if added:
            self._save_json(HISTORY_FILE, self.history); self._save_json(METADATA_FILE, self.metadata); self._save_json(SETTINGS_FILE, self.chat_settings)
        if added or skipped:
            js_toast(f"Imported {added} chat(s)." + (f" Skipped {skipped} damaged or unsafe chat(s)." if skipped else ""))
        else:
            js_toast("Nothing new to import.")
        return added
