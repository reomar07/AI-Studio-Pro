"""Accurate provider endpoint classification for the web-search disclosure."""
import ipaddress
from .web_pages import WebPagesMixin


def provider_host_is_loopback(host):
    host = str(host or "").lower().rstrip(".")
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class WebPrivacyMixin:
    def _privacy_provider_notice(self, chat_id=None):
        try:
            notice = dict(WebPagesMixin.web_provider_notice(self, chat_id))
        except Exception:
            return {"profile": "Unknown provider", "host": "", "model": "", "is_local": False}
        notice["is_local"] = provider_host_is_loopback(notice.get("host"))
        return notice
