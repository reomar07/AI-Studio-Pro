import os
import sys
import time
import string
import json
import base64
import threading
import webview
import pymupdf
import subprocess
import tempfile
import webbrowser
import textwrap
import copy
import shutil
import re
import urllib.request
import html as html_lib
import io
import openai
from openai import OpenAI
try:
    import keyring
except Exception:
    keyring = None
from rank_bm25 import BM25Okapi
from ddgs import DDGS

try:
    import docx
except ImportError:
    docx = None

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Private data (API keys, chats) lives in your user folder, NOT next to index.html,
# because the built-in web server serves everything that sits next to index.html.
DATA_DIR = os.path.join(os.path.expanduser("~"), "AIStudioPro")
os.makedirs(DATA_DIR, exist_ok=True)

DATA_FILENAMES = ["universal_config.json", "chat_history.json", "chat_settings.json", "chat_metadata.json", "prompts.json"]
for _name in DATA_FILENAMES:  # one-time migration of your existing data
    _old, _new = os.path.join(BASE_DIR, _name), os.path.join(DATA_DIR, _name)
    if os.path.exists(_old) and not os.path.exists(_new):
        try: shutil.copy2(_old, _new)
        except Exception: pass

CONFIG_FILE = os.path.join(DATA_DIR, "universal_config.json")
HISTORY_FILE = os.path.join(DATA_DIR, "chat_history.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "chat_settings.json")
METADATA_FILE = os.path.join(DATA_DIR, "chat_metadata.json")
PROMPTS_FILE = os.path.join(DATA_DIR, "prompts.json")
INDEX_FILE = os.path.join(BASE_DIR, "index.html")

MAX_DOC_CHARS = 200000
MAX_WORKSPACE_FILE_BYTES = 1000000
BINARY_EXTS = {"zip","rar","7z","exe","dll","xlsx","xls","pptx","ppt","doc","mp3","mp4","mov","avi","mkv","wav","iso","bin","heic","tif","tiff","psd","svg"}
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")
KEYRING_SERVICE = "AIStudioPro"
APP_VERSION = "1.2.1"     # must match PAGE_VERSION in index.html
ATTACH_DIR = os.path.join(DATA_DIR, "attachments")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
MAX_PDF_IMAGE_PAGES = 6
RISKY_EXTS = {"exe", "bat", "cmd", "com", "scr", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "lnk", "jar", "reg", "hta", "cpl", "dll"}
APP_NOTE = ("[App note] You are chatting inside a desktop app that can only show text. You cannot create, attach, upload or send files, "
            "and you cannot give download links. Never claim that you generated a file (PDF, Word, Excel, image...) or that it is 'ready' or 'attached'. "
            "When the user wants a document, write its complete content as normal text, Markdown or a Markdown table, and tell them to press the "
            "'Export' button under your reply to save it as PDF, Word, HTML or Markdown. Code or data files (csv, json, py, html...) should be written "
            "inside a fenced code block, which has its own Save button.")
BAD_TITLE_STARTS = ("here's a thinking", "here is a thinking", "thinking process", "okay, let", "okay let", "let me ", "the user ", "first, ", "<think")

VENDOR_DIR = os.path.join(BASE_DIR, "vendor")
VENDOR_FILES = {
    "tailwind.js": "https://cdn.tailwindcss.com",
    "marked.min.js": "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
    "purify.min.js": "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js",
    "highlight.min.js": "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
    "github-dark.min.css": "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css",
}


def ensure_vendor_files():
    """Download the page libraries once into the 'vendor' folder so the app works offline afterwards.
    If a download is impossible right now, a tiny stand-in file loads the library from the internet instead."""
    try: os.makedirs(VENDOR_DIR, exist_ok=True)
    except Exception: return
    offline = False
    for name, url in VENDOR_FILES.items():
        path = os.path.join(VENDOR_DIR, name)
        try:
            if os.path.exists(path) and os.path.getsize(path) > 3000: continue   # already downloaded
        except OSError: pass
        ok = False
        if not offline:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as r: data = r.read()
                head = data[:200].lstrip().lower()
                if len(data) > 3000 and not head.startswith(b"<!doctype html") and not head.startswith(b"<html"):
                    tmp = path + ".tmp"
                    with open(tmp, "wb") as f: f.write(data)
                    os.replace(tmp, path)
                    ok = True
            except Exception:
                offline = True    # no point trying the others right now
        if not ok:
            try:
                stub = (f'@import url("{url}");' if name.endswith(".css")
                        else f"document.write('<script src=\"{url}\"><\\/script>');")
                with open(path, "w", encoding="utf-8") as f: f.write(stub)
            except Exception: pass


def friendly_error(e):
    """Turn a technical API error into a sentence a normal person can act on."""
    A = openai
    if isinstance(e, A.AuthenticationError):
        msg = "Your API key was rejected. Open Settings, re-check the key for the active profile, and make sure it belongs to this provider."
    elif isinstance(e, A.PermissionDeniedError):
        msg = "Your key is not allowed to use this model or feature. Try another model, or check your provider account."
    elif isinstance(e, A.NotFoundError):
        msg = "The provider does not know this model or address. Check the Model ID and the Base URL in Settings."
    elif isinstance(e, A.RateLimitError):
        msg = "Too many requests, or your credit/quota ran out. Wait a minute, or check the billing page of your provider."
    elif isinstance(e, A.APITimeoutError):
        msg = "The provider took too long to answer (over 2 minutes). Try again, or pick a faster model."
    elif isinstance(e, A.APIConnectionError):
        msg = "Could not reach the provider. Check your internet connection and the Base URL (for LM Studio: make sure its local server is running)."
    elif isinstance(e, A.BadRequestError):
        msg = "The provider refused this request. Common causes: the conversation is too long, a file or image type the model cannot read, or a setting it does not support. Try a new chat or lower the Context Limit."
    elif isinstance(e, A.APIStatusError) and getattr(e, "status_code", 0) >= 500:
        msg = "The provider is having problems right now. Try again in a moment."
    else:
        msg = "Something went wrong while talking to the provider."
    detail = str(e).replace("`", "'")[:300]
    return f"**{msg}**\n\n*Technical details:* `{detail}`"


def js_toast(message):
    """Safely show a toast in the page (properly escaped)."""
    try:
        webview.windows[0].evaluate_js("showToast(" + json.dumps(str(message)) + ")")
    except Exception:
        pass

DEFAULT_PROFILES = {
    "active_profile_id": "default",
    "profiles": {
        "default": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "", "model_name": "google/gemini-2.0-flash-001", "image_model": "dall-e-3", "custom_headers": ""},
        "local_gguf": {"name": "Local (LM Studio)", "base_url": "http://localhost:1234/v1", "api_key": "lm-studio", "model_name": "local-model", "image_model": "", "custom_headers": ""}
    }
}


from .document_export import _ID_RE, _STATUS_PREFIX_RE, html_to_docx_bytes, build_html_document
