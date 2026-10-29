"""Record creation times for new messages only; do not migrate or date older history."""
from datetime import datetime, timezone
from .history import HistoryMixin


class MessageTimestampsMixin:
    def _timestamp_add_node(self, chat_id, role, content, display_text, title, is_image_mode, files=None, image=None):
        try:
            stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        except Exception:
            stamp = None  # A clock problem must not prevent sending a message.
        node_id = HistoryMixin._add_node(self, chat_id, role, content, display_text, title, is_image_mode, files=files, image=image)
        node = self.history.get(chat_id, {}).get("nodes", {}).get(node_id)
        if stamp and isinstance(node, dict):
            node.setdefault("created_at", stamp)
        return node_id

    # Keep method definitions unique for the existing refactor regression test.
    _add_node = _timestamp_add_node
