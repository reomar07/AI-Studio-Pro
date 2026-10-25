"""Opt-in chat backups, compatible with Import chats. No providers or attachment copies."""
import hashlib
import json
import math
import os
import re
import threading
import time
import webbrowser
from .shared import DATA_DIR

BACKUP_DIR = os.path.join(DATA_DIR, "backups")
SETTINGS_FILE = os.path.join(DATA_DIR, "backup_settings.json")
INTERVALS = (6, 12, 24, 72, 168)
_LOCK = threading.RLock()
_NAME = re.compile(r"backup_\d{8}_\d{6}(?:_\d{1,3})?\.json\Z")
NOTE = ("Backups run only while this app is open: on startup and about every 30 minutes when due. "
        "These plain JSON files contain chats, per-chat metadata and settings. Attachments, saved images, "
        "provider profiles/API keys and the snippet library are not copied. Restore with Import chats in Provider Setup; "
        "import adds chats and does not overwrite existing ones. Keep another copy outside this computer for disk failure protection.")


def _defaults():
    return dict(enabled=False, interval_hours=24, keep=7, last_run=0, last_hash="", last_status="")


def _load():
    result = _defaults()
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f: raw = json.load(f)
        if not isinstance(raw, dict): raise ValueError("Invalid settings")
    except FileNotFoundError:
        return result, ""
    except Exception:
        return result, "Backup settings could not be read. Automatic backups remain off; save valid settings to continue."
    result["enabled"] = raw.get("enabled") is True
    for key, valid in (("interval_hours", INTERVALS), ("keep", range(1, 31))):
        value = raw.get(key)
        if type(value) is int and value in valid: result[key] = value
    stamp = raw.get("last_run")
    if type(stamp) in (int, float) and math.isfinite(stamp) and stamp >= 0: result["last_run"] = stamp
    for key in ("last_hash", "last_status"):
        if isinstance(raw.get(key), str): result[key] = raw[key][:300]
    return result, ""


def _write(path, text):
    temp = path + ".tmp_" + os.urandom(6).hex()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(temp, "w", encoding="utf-8") as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        os.replace(temp, path)
        return True
    except Exception:
        try: os.remove(temp)
        except OSError: pass
        return False


def _files():
    rows = []
    try:
        with os.scandir(BACKUP_DIR) as entries:
            for e in entries:
                if not _NAME.fullmatch(e.name) or not e.is_file(follow_symlinks=False): continue
                try:
                    s = e.stat(follow_symlinks=False)
                    rows.append(dict(name=e.name, size=s.st_size, modified=s.st_mtime))
                except OSError: pass
    except OSError: pass
    return sorted(rows, key=lambda r: (r["modified"], r["name"]), reverse=True)


def _payload(engine):
    data = dict(app="AI Studio Pro", version=1, history=engine.history,
                metadata=engine.metadata, settings=engine.chat_settings)
    for attempt in range(5):
        try: return json.dumps(data, ensure_ascii=False, sort_keys=True)
        except RuntimeError:
            if attempt == 4: raise
            time.sleep(0.05)


def _result(ok=True, ran=False, message="", **extra):
    return dict(ok=ok, ran=ran, message=message, **extra)


class BackupScheduleMixin:
    def get_backup_settings(self):
        with _LOCK:
            settings, warning = _load()
            rows = _files()
        return dict(ok=True, **settings, warning=warning, folder=BACKUP_DIR, backups=rows[:40],
                    backup_count=len(rows), intervals=list(INTERVALS), min_keep=1, max_keep=30, note=NOTE)

    def set_backup_settings(self, enabled, interval_hours, keep):
        if type(enabled) is not bool or type(interval_hours) is not int or interval_hours not in INTERVALS or type(keep) is not int or keep not in range(1, 31):
            return _result(False, message="Choose a listed interval and keep between 1 and 30 backups.")
        with _LOCK:
            settings, _ = _load()
            settings.update(enabled=enabled, interval_hours=interval_hours, keep=keep)
            ok = _write(SETTINGS_FILE, json.dumps(settings))
        return _result(ok, message="Backup settings saved." if ok else "Settings could not be saved. Previous settings were kept.")

    def _backup_perform(self, force):
        with _LOCK:
            settings, _ = _load()
            now = time.time()
            last = settings["last_run"]
            if not force and (not settings["enabled"] or (last > 0 and now >= last and now - last < settings["interval_hours"] * 3600)):
                return _result(reason="not_due")
            if getattr(self, "_chat_model_worker_running", False):
                return _result(message="Wait until the current reply finishes, then back up again.", reason="busy")
            try:
                text = _payload(self)
                data = json.loads(text)
                if not data["history"]: return _result(message="No chats to back up yet.", reason="empty")
                validator = getattr(self, "_valid_chat", None)
                if validator and any(not validator(chat) for chat in data["history"].values()):
                    return _result(False, message="Some chat data is invalid. Older backups were kept; no new backup was made.")
                digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
                rows = _files()
                if digest == settings["last_hash"] and rows:
                    # Only skip if an existing file actually contains this snapshot.
                    for row in rows:
                        try:
                            with open(os.path.join(BACKUP_DIR, row["name"]), encoding="utf-8") as f:
                                if json.load(f) != data: continue
                            settings.update(last_run=now, last_status="No changes since the last backup.")
                            _write(SETTINGS_FILE, json.dumps(settings))
                            return _result(message=settings["last_status"], reason="unchanged")
                        except (OSError, ValueError): continue
                stem = time.strftime("backup_%Y%m%d_%H%M%S", time.localtime(now))
                name = None
                for n in range(1000):
                    candidate = stem + ("_" + str(n) if n else "") + ".json"
                    if not os.path.lexists(os.path.join(BACKUP_DIR, candidate)):
                        name = candidate; break
                if name is None: return _result(False, message="Too many backups in the same second.")
                path = os.path.join(BACKUP_DIR, name)
                if not _write(path, text): return _result(False, message="Backup could not be saved. Check disk space and folder permissions.")
                try:
                    with open(path, encoding="utf-8") as f:
                        if json.load(f) != data: raise ValueError("Backup readback mismatch")
                except Exception:
                    try: os.remove(path)
                    except OSError: pass
                    return _result(False, message="Backup did not verify; older copies were kept.")
                # Protect the verified new file even if the computer clock moved backward.
                others = [r for r in _files() if r["name"] != name]
                removed, failed = 0, 0
                base = os.path.realpath(BACKUP_DIR)
                for row in others[settings["keep"] - 1:]:
                    old = os.path.join(BACKUP_DIR, row["name"])
                    if os.path.islink(old) or os.path.dirname(os.path.realpath(old)) != base: continue
                    try: os.remove(old); removed += 1
                    except OSError: failed += 1
                message = "Saved " + name + " with " + str(len(data["history"])) + " chat(s)."
                if failed: message += " Some older copies could not be removed."
                settings.update(last_run=now, last_hash=digest, last_status=message)
                if not _write(SETTINGS_FILE, json.dumps(settings)): message += " Schedule state could not be saved; the next check may repeat."
                return _result(ran=True, name=name, chats=len(data["history"]), removed=removed, message=message)
            except Exception:
                return _result(False, message="Backup could not be completed. Older copies were kept.")

    def run_backup_now(self):
        return self._backup_perform(True)

    def run_backup_if_due(self):
        return self._backup_perform(False)

    def open_backup_folder(self):
        try:
            os.makedirs(BACKUP_DIR, exist_ok=True)
            if hasattr(os, "startfile"): os.startfile(BACKUP_DIR)
            else:
                from pathlib import Path
                webbrowser.open(Path(BACKUP_DIR).resolve().as_uri())
            return True
        except Exception:
            return False
