"""Daily token-use summary.

Only per-day totals are kept (no message text, chat ids or file names). Numbers the provider
reported are kept apart from rough estimates, so the two are never silently added together.
"""
import json
import math
import os
import re
import threading
import time
from datetime import date, timedelta

from .shared import DATA_DIR

USAGE_FILE = os.path.join(DATA_DIR, "usage_summary.json")
KEEP_DAYS = 400
MAX_MODELS_PER_DAY = 20
NOTE = ("Reported numbers come from your provider. Estimated numbers are about one token per four characters of a "
        "reply (your prompt size is unknown) and are kept separate. This is a usage guide, not a bill.")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LOCK = threading.Lock()


def _today():
    return time.strftime("%Y-%m-%d")


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _optional_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _empty_model():
    return {"replies": 0, "images": 0, "reported_prompt": 0, "reported_completion": 0, "estimated_completion": 0}


def _empty_day():
    return {"replies": 0, "images": 0,
            "reported": {"replies": 0, "prompt": 0, "completion": 0},
            "estimated": {"replies": 0, "completion": 0}, "models": {}}


def _clean_day(raw):
    """Rebuild a day record from untrusted file content so every number is a plain count."""
    raw = raw if isinstance(raw, dict) else {}
    reported = raw.get("reported") if isinstance(raw.get("reported"), dict) else {}
    estimated = raw.get("estimated") if isinstance(raw.get("estimated"), dict) else {}
    models = {}
    source = raw.get("models") if isinstance(raw.get("models"), dict) else {}
    for name, entry in list(source.items())[:MAX_MODELS_PER_DAY + 1]:
        entry = entry if isinstance(entry, dict) else {}
        models[str(name)[:120]] = {key: _count(entry.get(key)) for key in _empty_model()}
    return {"replies": _count(raw.get("replies")), "images": _count(raw.get("images")),
            "reported": {"replies": _count(reported.get("replies")), "prompt": _count(reported.get("prompt")), "completion": _count(reported.get("completion"))},
            "estimated": {"replies": _count(estimated.get("replies")), "completion": _count(estimated.get("completion"))},
            "models": models}


def _load():
    """Returns (data, warning). A damaged file is set aside, never silently overwritten."""
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and isinstance(data.get("days"), dict):
            return data, ""
        raise ValueError("unexpected layout")
    except FileNotFoundError:
        return {"days": {}}, ""
    except Exception:
        try:
            os.replace(USAGE_FILE, f"{USAGE_FILE}.corrupt_{int(time.time())}.bak")
        except Exception:
            pass
        return {"days": {}}, "The saved usage file could not be read, so a new one was started. The old file was kept as a .bak copy."


def _write(data):
    temp = f"{USAGE_FILE}.tmp_{os.urandom(2).hex()}"
    try:
        os.makedirs(os.path.dirname(USAGE_FILE), exist_ok=True)
        with open(temp, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.replace(temp, USAGE_FILE)
        return True
    except Exception:
        try:
            os.remove(temp)
        except Exception:
            pass
        return False


def _add_reply(day, node):
    model = str(node.get("model") or "unknown")[:120]
    entries = day["models"]
    if model not in entries and len(entries) >= MAX_MODELS_PER_DAY:
        model = "other models"
    entry = entries.setdefault(model, _empty_model())
    day["replies"] += 1
    entry["replies"] += 1
    if node.get("image"):   # picture replies carry no token numbers
        day["images"] += 1
        entry["images"] += 1
        return
    usage = node.get("usage") if isinstance(node.get("usage"), dict) else {}
    prompt, completion = _optional_count(usage.get("prompt")), _optional_count(usage.get("completion"))
    if prompt is not None or completion is not None:
        day["reported"]["replies"] += 1
        day["reported"]["prompt"] += prompt or 0
        day["reported"]["completion"] += completion or 0
        entry["reported_prompt"] += prompt or 0
        entry["reported_completion"] += completion or 0
        return
    text = node.get("content")
    estimate = math.ceil(len(text) / 4) if isinstance(text, str) else 0
    day["estimated"]["replies"] += 1
    day["estimated"]["completion"] += estimate
    entry["estimated_completion"] += estimate


class UsageLogMixin:
    def _usage_known_node_ids(self, chat_id):
        chat = self.history.get(chat_id)
        nodes = chat.get("nodes") if isinstance(chat, dict) else None
        return set(nodes) if isinstance(nodes, dict) else set()

    def _usage_record_new_replies(self, chat_id, known_ids):
        """Counts assistant replies that appeared since known_ids was taken. Returns how many were saved."""
        chat = self.history.get(chat_id)
        nodes = chat.get("nodes") if isinstance(chat, dict) else None
        if not isinstance(nodes, dict):
            return 0
        fresh = [n for nid, n in list(nodes.items())
                 if nid not in known_ids and isinstance(n, dict) and n.get("role") == "assistant" and not n.get("is_error")]
        if not fresh:
            return 0
        with _LOCK:
            data, _ = _load()
            key = _today()
            day = _clean_day(data["days"].get(key))
            for node in fresh:
                _add_reply(day, node)
            data["days"][key] = day
            for old in sorted(data["days"])[:-KEEP_DAYS]:
                del data["days"][old]
            return len(fresh) if _write(data) else 0

    def get_usage_summary(self, days=14):
        try:
            try:
                days = int(days)
            except (TypeError, ValueError):
                days = 14
            days = max(1, min(90, days))
            with _LOCK:
                data, warning = _load()
            today = _today()
            first = (date.fromisoformat(today) - timedelta(days=days - 1)).isoformat()
            rows, totals = [], {"replies": 0, "images": 0, "reported_replies": 0, "reported_prompt": 0,
                                "reported_completion": 0, "estimated_replies": 0, "estimated_completion": 0}
            for key in sorted(data["days"], reverse=True):
                if not _DAY_RE.match(str(key)) or key < first:
                    continue
                day = _clean_day(data["days"][key])
                row = {"day": key, "replies": day["replies"], "images": day["images"],
                       "reported_replies": day["reported"]["replies"], "reported_prompt": day["reported"]["prompt"],
                       "reported_completion": day["reported"]["completion"],
                       "estimated_replies": day["estimated"]["replies"], "estimated_completion": day["estimated"]["completion"],
                       "models": [{"model": name, **values} for name, values in day["models"].items()]}
                rows.append(row)
                for field in totals:
                    totals[field] += row[field]
            return {"ok": True, "today": today, "days": rows, "totals": totals, "note": NOTE, "warning": warning}
        except Exception:
            return {"ok": False, "message": "The token summary could not be read."}
