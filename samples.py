"""Echo — in-app sample library (Part D).

A PERMANENT, curated store of example clips (one bird per species) that ships
with the app so someone with no sound to hand can still see the visualization.

Deliberately independent of the `clips` table and its 50-entry retention: these
live as static files under `samples/` and are NEVER in the DB, so the retention
cleanup in storage.py cannot evict them. Seeded by verification/seed_samples.py.

Attribution (species / recordist / license / source URL) rides in samples.json
and is served to the UI, because publishing these CC BY-NC-SA recordings
publicly requires visible credit.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAMPLES_DIR = ROOT / "samples"
AUDIO_DIR = SAMPLES_DIR / "audio"
FEATURES_DIR = SAMPLES_DIR / "features"
MANIFEST = SAMPLES_DIR / "samples.json"


def _load_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    try:
        data = json.loads(MANIFEST.read_text())
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


# Fields safe to expose in the list (everything except internal file names).
_SUMMARY_KEYS = ("id", "species", "sci_name", "recordist", "license",
                 "license_url", "source_url", "xc_id", "duration_s")


def list_samples() -> list[dict]:
    """Attribution + metadata for every sample (no heavy feature payload)."""
    return [{k: s.get(k) for k in _SUMMARY_KEYS} for s in _load_manifest()]


def get_sample(sample_id: str) -> dict | None:
    """Full payload for one sample: metadata + features + spectrogram + audio_url.
    Returns None if the id is unknown or its feature file is missing."""
    entry = next((s for s in _load_manifest() if s.get("id") == sample_id), None)
    if entry is None:
        return None
    feat_file = FEATURES_DIR / entry.get("feature_file", "")
    if not feat_file.exists():
        return None
    payload = json.loads(feat_file.read_text())
    if isinstance(payload, list):
        features, spectrogram = payload, None
    else:
        features = payload.get("features", [])
        spectrogram = payload.get("spectrogram")
    summary = {k: entry.get(k) for k in _SUMMARY_KEYS}
    return {**summary, "features": features, "spectrogram": spectrogram,
            "audio_url": f"/samples/audio/{entry['audio_file']}"}
