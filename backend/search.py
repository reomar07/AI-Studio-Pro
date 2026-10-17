from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class SearchMixin:
    def _tokenize(self, text):
        # punctuation becomes a SPACE (self.user_name.get() -> self user name get) and camelCase is split
        text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
        text = re.sub(r"[^\w]+|_", " ", text)
        return text.lower().split()


    def attach_workspace(self):
        try:
            dialog_type = getattr(webview.FileDialog, 'FOLDER', getattr(webview, 'FOLDER_DIALOG', 2))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type))
            if not result: return None
            folder_path = result[0]
            js_toast(f"Scanning {os.path.basename(folder_path)}...")
            threading.Thread(target=self._index_folder, args=(folder_path,), daemon=True).start()
            return os.path.basename(folder_path)
        except Exception:
            return None


    def _index_folder(self, folder_path):
        try:
            self.bm25_engine = None
            name = os.path.basename(folder_path)
            exclude_dirs = {'.gradle', '.idea', 'build', 'node_modules', '.git', 'intermediates', '__pycache__', '.venv', 'venv', 'dist', '.next', 'vendor'}
            text_exts = {'kt', 'kts', 'py', 'md', 'txt', 'java', 'xml', 'json', 'csv', 'html', 'css', 'js', 'ts', 'tsx', 'jsx',
                         'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bat', 'ps1', 'sql',
                         'yml', 'yaml', 'toml', 'ini', 'cfg', 'gradle', 'properties', 'rst', 'tex'}
            docs, meta = [], []   # built locally and swapped in at the end, so searches never see half-built data

            for root, dirs, files in os.walk(folder_path):
                dirs[:] = [d for d in dirs if d not in exclude_dirs]
                for file in files:
                    ext = file.rsplit('.', 1)[-1].lower() if '.' in file else ''
                    path = os.path.join(root, file)
                    rel = os.path.relpath(path, folder_path)
                    text = ""
                    if file.lower().endswith(('.min.js', '.min.css', '.map')): continue   # minified libraries are just noise
                    try:
                        if os.path.getsize(path) > MAX_WORKSPACE_FILE_BYTES and ext != 'pdf': continue
                    except OSError: continue
                    if ext in text_exts:
                        try:
                            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                                text = f.read()
                        except Exception: pass
                    elif ext == 'pdf':
                        try:
                            with pymupdf.open(path) as pdf:
                                text = "\n".join(page.get_text() for page in pdf)
                        except Exception: pass

                    if text:
                        buf, size = [], 0
                        for line in text.splitlines():
                            line = line[:1000]
                            if size + len(line) > 1200 and buf:
                                docs.append("\n".join(buf)); meta.append({"filename": rel})
                                buf, size = buf[-3:], sum(len(x) for x in buf[-3:])
                            buf.append(line); size += len(line) + 1
                        if buf and "".join(buf).strip():
                            docs.append("\n".join(buf)); meta.append({"filename": rel})

            if docs:
                engine = BM25Okapi([self._tokenize(d) or ["_"] for d in docs])
                self.workspace_docs, self.workspace_meta, self.workspace_name = docs, meta, name
                self.bm25_engine = engine
                js_toast(f"Indexed {len(docs)} chunks successfully.")
            else:
                self.workspace_docs, self.workspace_meta, self.workspace_name = [], [], name
                js_toast("No readable text files found.")
        except Exception as e:
            js_toast(f"Indexing error: {str(e)[:120]}")

