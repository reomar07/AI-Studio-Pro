from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class HistoryMixin:
    def rename_chat(self, chat_id, title):
        title = re.sub(r"<[^>]*>", "", str(title or "")).strip()[:80]
        chat = self.history.get(chat_id)
        if not chat or not title: return False
        for node in chat.get("nodes", {}).values():
            if node.get("parent") is None: node["title"] = title
        self._save_json(HISTORY_FILE, self.history)
        return True


    def export_all_chats(self):
        try:
            payload = {"app": "AI Studio Pro", "version": 1, "history": self.history, "metadata": self.metadata, "settings": self.chat_settings}
            dialog_type = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 1))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, save_filename="ai_studio_backup.json"))
            if not result: return False
            with open(result[0], "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            js_toast(f"Backup saved: {result[0]}")
            return True
        except Exception as e:
            js_toast(f"Export failed: {str(e)[:120]}")
            return False


    def import_chats(self):
        """Adds chats from a backup file. Existing chats are never overwritten."""
        try:
            dialog_type = getattr(webview.FileDialog, 'OPEN', getattr(webview, 'OPEN_DIALOG', 0))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, allow_multiple=False, file_types=("JSON files (*.json)", "All files (*.*)")))
            if not result: return 0
            with open(result[0], "r", encoding="utf-8") as f:
                data = json.load(f)
            incoming = data.get("history") if isinstance(data, dict) and "history" in data else data
            if not isinstance(incoming, dict): raise ValueError("This file is not an AI Studio Pro backup.")
            metadata = data.get("metadata", {}) if isinstance(data, dict) else {}
            settings = data.get("settings", {}) if isinstance(data, dict) else {}
            added = skipped = 0
            for cid, chat in incoming.items():
                if not self._valid_chat(chat):
                    skipped += 1; continue
                new_id = str(cid) if _ID_RE.match(str(cid)) else f"chat_{int(time.time() * 1000)}_{added}"
                if new_id in self.history:
                    if json.dumps(self.history[new_id], sort_keys=True) == json.dumps(chat, sort_keys=True): continue   # already here
                    new_id = f"chat_{int(time.time() * 1000)}_{added}"
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
        except Exception as e:
            js_toast(f"Import failed: {str(e)[:120]}")
            return 0


    def _migrate_history_to_trees(self):
        dirty = False
        for cid, chat_data in list(self.history.items()):
            if isinstance(chat_data, list):
                dirty = True
                new_chat = {"nodes": {}, "current_node": None}
                prev_id = None
                for m in chat_data:
                    nid = "msg_" + os.urandom(4).hex()
                    m["id"] = nid
                    m["parent"] = prev_id
                    m["children"] = []
                    new_chat["nodes"][nid] = m
                    if prev_id: new_chat["nodes"][prev_id]["children"].append(nid)
                    prev_id = nid
                new_chat["current_node"] = prev_id
                self.history[cid] = new_chat
        if dirty: self._save_json(HISTORY_FILE, self.history)


    def _get_linear_branch(self, chat_data):
        if not chat_data or not chat_data.get("current_node"): return []
        nodes = chat_data["nodes"]
        curr = chat_data["current_node"]
        path = []
        while curr and curr in nodes:
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


    def _add_node(self, chat_id, role, content, display_text, title, is_image_mode, files=None, image=None):
        chat = self.history[chat_id]
        nid = "msg_" + os.urandom(4).hex()
        pid = chat.get("current_node")
        msg = {
            "id": nid, "parent": pid, "children": [], "role": role, 
            "content": content, "display_text": display_text, "title": title, "is_image_mode": is_image_mode,
            "files": files or [], "image": image
        }
        chat["nodes"][nid] = msg
        if pid and pid in chat["nodes"]: chat["nodes"][pid]["children"].append(nid)
        chat["current_node"] = nid
        return nid


    def switch_branch(self, chat_id, msg_id, direction):
        chat = self.history.get(chat_id)
        if not chat or msg_id not in chat["nodes"]: return False
        msg = chat["nodes"][msg_id]
        pid = msg["parent"]
        if not pid: return False
        siblings = chat["nodes"][pid]["children"]
        idx = siblings.index(msg_id)
        new_idx = (idx + direction) % len(siblings)
        curr = siblings[new_idx]
        while chat["nodes"][curr]["children"]:
            curr = chat["nodes"][curr]["children"][-1]
        chat["current_node"] = curr
        self._save_json(HISTORY_FILE, self.history)
        return True


    @staticmethod
    def _public(messages):
        return [{k: v for k, v in m.items() if k not in ("llm_text", "ctx_sources")} for m in messages]


    def get_history(self):
        out = {}
        for cid, cdata in list(self.history.items()):
            try: out[cid] = self._public(self._get_linear_branch(cdata))
            except Exception: continue      # one damaged chat must never break the whole app
        return out


    @staticmethod
    def _valid_chat(chat):
        """True only for a well-formed chat tree with plain ids (used when importing backups)."""
        try:
            nodes = chat.get("nodes")
            if not isinstance(nodes, dict) or not nodes: return False
            for nid, n in nodes.items():
                if not _ID_RE.match(str(nid)) or not isinstance(n, dict): return False
                if n.get("role") not in ("user", "assistant", "system"): return False
                if n.get("id", nid) != nid: return False
                if "parent" not in n: return False
                p = n.get("parent")
                if p is not None and p not in nodes: return False
                kids = n.get("children")
                if not isinstance(kids, list) or any(k not in nodes for k in kids): return False
            cur = chat.get("current_node")
            return cur is None or cur in nodes
        except Exception:
            return False


    def get_metadata(self): return self.metadata


    def get_chat_settings(self, chat_id): return self.chat_settings.get(chat_id, {})


    def get_prompts(self): return self.prompts


    def save_prompt(self, title, content, prompt_id=None):
        if prompt_id:
            for p in self.prompts:
                if p["id"] == prompt_id:
                    p["title"], p["content"] = title, content
                    break
        else:
            self.prompts.append({"id": f"p_{os.urandom(4).hex()}", "title": title, "content": content})
        self._save_json(PROMPTS_FILE, self.prompts)
        return self.prompts


    def delete_prompt(self, prompt_id):
        self.prompts = [p for p in self.prompts if p["id"] != prompt_id]
        self._save_json(PROMPTS_FILE, self.prompts)
        return self.prompts


    def start_new_chat(self, is_image_mode=False):
        self.current_chat_id = f"chat_{int(time.time() * 1000)}"
        self.session_files.clear()
        return self.current_chat_id


    def set_current_chat(self, chat_id): 
        self.current_chat_id = chat_id


    def toggle_pin_chat(self, chat_id):
        if chat_id not in self.metadata: self.metadata[chat_id] = {}
        self.metadata[chat_id]["pinned"] = not self.metadata[chat_id].get("pinned", False)
        self._save_json(METADATA_FILE, self.metadata)
        return self.metadata[chat_id]["pinned"]


    def delete_chat(self, chat_id):
        for store, file_path in [(self.history, HISTORY_FILE), (self.chat_settings, SETTINGS_FILE), (self.metadata, METADATA_FILE)]:
            if chat_id in store:
                del store[chat_id]
                self._save_json(file_path, store)
        self._remove_attachment_folder(chat_id)
        return True


    def clear_all_chats(self):
        self.history, self.chat_settings, self.metadata = {}, {}, {}
        self._save_json(HISTORY_FILE, self.history); self._save_json(SETTINGS_FILE, self.chat_settings); self._save_json(METADATA_FILE, self.metadata)
        self.session_files.clear()
        try: shutil.rmtree(ATTACH_DIR, ignore_errors=True)
        except Exception: pass
        return True


    def rewind_chat(self, chat_id, msg_id):
        chat = self.history.get(chat_id)
        if chat and msg_id in chat["nodes"]:
            chat["current_node"] = chat["nodes"][msg_id].get("parent")
            self._save_json(HISTORY_FILE, self.history)
        return True

