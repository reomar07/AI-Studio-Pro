"""Start AI Studio Pro. Feature implementations live in backend/."""
from backend.shared import *
from backend.engine import ChatEngine

if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    app_cache_dir = os.path.join(DATA_DIR, 'webview_cache')
    os.makedirs(app_cache_dir, exist_ok=True)
    ensure_vendor_files()
    engine = ChatEngine()
    webview.create_window('AI Studio Pro', INDEX_FILE, js_api=engine, width=1250, height=850, background_color='#1c1c1e')
    webview.start(http_server=True, private_mode=False, storage_path=app_cache_dir, debug=False)
