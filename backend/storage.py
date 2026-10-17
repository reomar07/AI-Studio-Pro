from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class StorageMixin:
    def _load_json(self, path, default):
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f: return json.load(f)
            except Exception:
                try: shutil.copy2(path, f"{path}.corrupt_{int(time.time())}.bak")  # never silently destroy a broken file
                except Exception: pass
        return default


    def _save_json(self, path, data):
        with self.file_lock:
            temp_path = f"{path}.tmp_{os.urandom(2).hex()}"
            try:
                text = None
                for _ in range(5):  # data may be changing in another thread; just retry
                    try:
                        text = json.dumps(data, indent=2, ensure_ascii=False)
                        break
                    except RuntimeError:
                        time.sleep(0.05)
                if text is None: raise RuntimeError("data kept changing while saving")
                with open(temp_path, "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(temp_path, path)
            except Exception as e:
                print(f"Error saving {path}: {e}")
                if os.path.exists(temp_path):
                    try: os.remove(temp_path)
                    except: pass

