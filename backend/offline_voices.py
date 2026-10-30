"""Offline neural voices (Piper). Voices are downloaded on demand into the app's data folder.
The Piper engine itself is optional (pip install piper-tts); nothing is sent anywhere when speaking."""
import base64
import importlib.util
import io
import json
import os
import threading
import urllib.request
import wave
from .shared import DATA_DIR

VOICES_DIR = os.path.join(DATA_DIR, "offline_voices")
VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
VOICE_CATALOG = [
    {"id": "en_US-lessac-medium", "lang": "en", "label": "English (US) - Lessac", "folder": "en/en_US/lessac/medium", "size_mb": 63},
    {"id": "fr_FR-upmc-medium", "lang": "fr", "label": "French - UPMC", "folder": "fr/fr_FR/upmc/medium", "size_mb": 77},
    {"id": "ar_JO-kareem-medium", "lang": "ar", "label": "Arabic - Kareem", "folder": "ar/ar_JO/kareem/medium", "size_mb": 63},
]
MIN_MODEL_BYTES = 5000000
MAX_SPEAK_CHARS = 1500
_state = {}                    # voice id -> {"state": "downloading"/"error", "done": bytes, "total": bytes, "error": text}
_state_lock = threading.Lock()
_loaded = {}                   # voice id -> loaded Piper voice
_speak_lock = threading.Lock()


def voice_entry(voice_id):
    return next((v for v in VOICE_CATALOG if v["id"] == voice_id), None)


def voice_paths(voice_id):
    return os.path.join(VOICES_DIR, voice_id + ".onnx"), os.path.join(VOICES_DIR, voice_id + ".onnx.json")


def voice_installed(voice_id):
    model, config = voice_paths(voice_id)
    try:
        return os.path.getsize(model) >= MIN_MODEL_BYTES and os.path.getsize(config) > 100
    except OSError:
        return False


def engine_installed():
    try:
        return importlib.util.find_spec("piper") is not None
    except Exception:
        return False


def _download_file(url, target, voice_id):
    if not url.startswith(VOICE_BASE_URL): raise ValueError("Unexpected download address.")
    part = target + ".part"
    request = urllib.request.Request(url, headers={"User-Agent": "AIStudioPro"})
    with urllib.request.urlopen(request, timeout=30) as response, open(part, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        with _state_lock:
            entry = _state.setdefault(voice_id, {})
            entry["total"] = entry.get("total", 0) + total
        while True:
            block = response.read(256 * 1024)
            if not block: break
            out.write(block)
            with _state_lock: _state[voice_id]["done"] = _state[voice_id].get("done", 0) + len(block)
    os.replace(part, target)


def run_voice_download(voice_id):
    entry = voice_entry(voice_id)
    model, config = voice_paths(voice_id)
    try:
        os.makedirs(VOICES_DIR, exist_ok=True)
        base = VOICE_BASE_URL + entry["folder"] + "/" + voice_id + ".onnx"
        _download_file(base + ".json", config, voice_id)
        with open(config, "r", encoding="utf-8") as fh: json.load(fh)          # must be valid JSON
        _download_file(base, model, voice_id)
        if os.path.getsize(model) < MIN_MODEL_BYTES: raise ValueError("The downloaded voice file is too small.")
        with _state_lock: _state.pop(voice_id, None)
    except Exception as e:
        for path in (model, config, model + ".part", config + ".part"):
            try: os.remove(path)
            except OSError: pass
        with _state_lock: _state[voice_id] = {"state": "error", "error": str(e)[:150] or "Download failed."}


class OfflineVoicesMixin:
    def offline_voices_status(self):
        with _state_lock: states = {k: dict(v) for k, v in _state.items()}
        voices = []
        for v in VOICE_CATALOG:
            st = states.get(v["id"], {})
            downloading = st.get("state") == "downloading"
            total = st.get("total") or 0
            voices.append({"id": v["id"], "lang": v["lang"], "label": v["label"], "size_mb": v["size_mb"], "installed": voice_installed(v["id"]),
                           "downloading": downloading, "progress": round(min(0.99, st.get("done", 0) / total) if (downloading and total) else 0, 3), "error": st.get("error", "") if st.get("state") == "error" else ""})
        have = engine_installed()
        return {"engine": have, "folder": VOICES_DIR, "voices": voices,
                "hint": "" if have else "The Piper speech engine is not installed. In the same Python that runs this app, run: pip install piper-tts  (then restart the app). The packaged .exe needs it added when it is built."}

    def offline_voice_download(self, voice_id):
        if not voice_entry(voice_id): return {"ok": False, "message": "Unknown voice."}
        if voice_installed(voice_id): return {"ok": True, "message": "Already installed."}
        with _state_lock:
            if _state.get(voice_id, {}).get("state") == "downloading": return {"ok": True, "message": "Already downloading."}
            _state[voice_id] = {"state": "downloading", "done": 0, "total": 0}
        threading.Thread(target=run_voice_download, args=(voice_id,), daemon=True).start()
        return {"ok": True, "message": "Download started."}

    def offline_voice_delete(self, voice_id):
        if not voice_entry(voice_id): return {"ok": False, "message": "Unknown voice."}
        with _state_lock:
            if _state.get(voice_id, {}).get("state") == "downloading": return {"ok": False, "message": "Wait for the download to finish."}
            _state.pop(voice_id, None)
        with _speak_lock: _loaded.pop(voice_id, None)
        for path in voice_paths(voice_id):
            try: os.remove(path)
            except OSError: pass
        return {"ok": True}

    def offline_voice_speak(self, text, voice_id, rate=1.0):
        """Returns one short piece of speech as a WAV data address. Runs fully on this computer."""
        try:
            if not voice_entry(voice_id) or not voice_installed(voice_id): return {"ok": False, "error": "This voice is not installed."}
            if not engine_installed(): return {"ok": False, "error": "The Piper speech engine is not installed."}
            text = " ".join(str(text or "").split())[:MAX_SPEAK_CHARS]
            if not text: return {"ok": False, "error": "There is no text to read."}
            try: speed = min(2.0, max(0.5, float(rate)))
            except (TypeError, ValueError): speed = 1.0
            with _speak_lock:
                voice = _loaded.get(voice_id)
                if voice is None:
                    from piper import PiperVoice
                    voice = _loaded[voice_id] = PiperVoice.load(voice_paths(voice_id)[0])
                config = None
                try:
                    from piper import SynthesisConfig
                    config = SynthesisConfig(length_scale=1.0 / speed)
                except ImportError:
                    pass
                buffer = io.BytesIO()
                with wave.open(buffer, "wb") as wav:
                    if config is not None: voice.synthesize_wav(text, wav, syn_config=config)
                    else: voice.synthesize_wav(text, wav)
            return {"ok": True, "audio": "data:audio/wav;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": str(e)[:150] or "The voice could not speak this text."}
