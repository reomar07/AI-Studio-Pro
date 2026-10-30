"""Remember the attached workspace folder so its search index can be rebuilt or cleared."""
import os
import threading
from .shared import js_toast
from .search import SearchMixin


class WorkspaceIndexMixin:
    _workspace_index_lock = threading.Lock()   # one scan at a time
    _workspace_index_epoch = 0                 # raised by Clear, so a scan that was running at that moment is discarded
    workspace_path = None
    workspace_indexing = False

    def _index_folder_remembered(self, folder_path):
        epoch = self._workspace_index_epoch
        with WorkspaceIndexMixin._workspace_index_lock:
            self.workspace_path = folder_path
            self.workspace_indexing = True
            try:
                SearchMixin._index_folder(self, folder_path)
            finally:
                self.workspace_indexing = False
            if self._workspace_index_epoch != epoch:      # Clear was pressed while this scan ran
                self._wipe_workspace_index()

    def _wipe_workspace_index(self):
        self.bm25_engine = None
        self.workspace_docs, self.workspace_meta = [], []
        self.workspace_name = None
        self.workspace_path = None

    def workspace_index_status(self):
        docs, meta = list(getattr(self, "workspace_docs", None) or []), list(getattr(self, "workspace_meta", None) or [])
        path = self.workspace_path
        return {
            "attached": bool(path),
            "name": getattr(self, "workspace_name", None) or (os.path.basename(path) if path else ""),
            "chunks": len(docs),
            "files": len({m.get("filename") for m in meta if isinstance(m, dict)}),
            "indexing": bool(self.workspace_indexing),
        }

    def rebuild_workspace_index(self):
        path = self.workspace_path
        if self.workspace_indexing:
            return {"ok": False, "message": "The folder is already being scanned."}
        if not path:
            return {"ok": False, "message": "No folder is attached. Use the Folder button first."}
        if not os.path.isdir(path):
            return {"ok": False, "message": "The folder no longer exists or cannot be reached."}
        js_toast(f"Rebuilding the index for {os.path.basename(path)}...")
        threading.Thread(target=self._index_folder, args=(path,), daemon=True).start()
        return {"ok": True, "message": "Scan started."}

    def clear_workspace_index(self):
        self._workspace_index_epoch += 1
        self._wipe_workspace_index()
        js_toast("Workspace index cleared. Your files were not changed.")
        return {"ok": True}
