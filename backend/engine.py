from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE
from .storage import StorageMixin
from .profiles import ProfilesMixin
from .history import HistoryMixin
from .documents import DocumentsMixin
from .search import SearchMixin
from .generation import GenerationMixin
from .spelling import SpellingMixin
from .model_preferences import ModelPreferencesMixin
from .chat_models import ChatModelMemoryMixin
from .chat_generation import ChatModelGenerationMixin
from .data_safety import DataSafetyMixin

class ChatEngine(DataSafetyMixin, StorageMixin, ProfilesMixin, HistoryMixin, DocumentsMixin, SearchMixin, GenerationMixin, SpellingMixin, ModelPreferencesMixin, ChatModelMemoryMixin, ChatModelGenerationMixin):
    _chat_model_metadata_file = METADATA_FILE
    send_prompt_stream = ChatModelGenerationMixin.send_chat_prompt_stream

    def __init__(self):
        self.file_lock = threading.Lock()
        self.stream_lock = threading.Lock()
        self.stream_chunk = ""
        self.stream_is_done = False
        self.stream_error = None
        self.stream_gen = 0
        self.keyring_problem = ""
        self.keys_locked = False
        
        self.config = self._load_and_migrate_config()
        self.history = self._load_json(HISTORY_FILE, {})
        self._migrate_history_to_trees()
        self._repair_bad_titles()
        self.chat_settings = self._load_json(SETTINGS_FILE, {})
        self.metadata = self._load_json(METADATA_FILE, {})
        self.prompts = self._load_json(PROMPTS_FILE, [])
        
        for _cid in [c for c, d in self.history.items() if isinstance(d, dict) and not d.get("nodes")]:
            del self.history[_cid]  # drop empty leftover chats from older versions
        self.current_chat_id = f"chat_{int(time.time() * 1000)}"

        self.is_aborted = False
        self.active_stream = None
        self.workspace_name = None
        self.workspace_docs = []
        self.workspace_meta = []
        self.bm25_engine = None
        self.session_files = {}
