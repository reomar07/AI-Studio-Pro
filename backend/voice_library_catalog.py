"""Additional Piper models; register with the existing download and speech backend."""
from .offline_voices import VOICE_CATALOG

ADDITIONAL_VOICES = [
    {"id": "en_US-hfc_female-medium", "lang": "en", "label": "English (US) - HFC Female (medium)", "folder": "en/en_US/hfc_female/medium", "size_mb": 64},
    {"id": "fr_FR-tom-medium", "lang": "fr", "label": "French - Tom (medium)", "folder": "fr/fr_FR/tom/medium", "size_mb": 64},
    {"id": "ar_JO-kareem-low", "lang": "ar", "label": "Arabic - Kareem (low quality variant)", "folder": "ar/ar_JO/kareem/low", "size_mb": 64},
]
for entry in VOICE_CATALOG:
    if entry["id"].endswith("-medium") and "(medium)" not in entry["label"]:
        entry["label"] += " (medium)"
for entry in ADDITIONAL_VOICES:
    if not any(old["id"] == entry["id"] for old in VOICE_CATALOG):
        VOICE_CATALOG.append(dict(entry))
