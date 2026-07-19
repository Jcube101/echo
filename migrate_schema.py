"""Echo — feature-schema migration runner (Part 0).

The ONE supported way to bring stored data up to the current extraction schema
after an extraction-logic change. Re-extracts every stored clip from its on-disk
audio, rewrites the feature JSON WITH the current `schema_version` stamp, and
updates the clips-table column — for BOTH the DB-tracked history clips and the
permanent sample library. Idempotent; safe to re-run.

Workflow whenever you change extraction output (per CLAUDE.md):
  1. bump extraction.FEATURE_SCHEMA_VERSION
  2. python migrate_schema.py          # re-extract + re-stamp everything
  3. python schema_audit.py            # must report zero stale

Audio files and DB identities are never touched — only the feature JSON payload
and the schema_version column.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extraction as ex  # noqa: E402
import db  # noqa: E402
import samples as sample_lib  # noqa: E402
import schema_audit  # noqa: E402

VERSION = ex.FEATURE_SCHEMA_VERSION


def _migrate_one(audio_path: Path, feat_path: Path) -> int:
    features = ex.extract_features(str(audio_path))
    spectrogram = ex.compute_spectrogram(str(audio_path))
    feat_path.write_text(json.dumps(
        {"schema_version": VERSION, "features": features, "spectrogram": spectrogram}))
    return len(features)


def migrate_history() -> None:
    db.init_db()
    with db.SessionLocal() as session:
        rows = session.query(db.Clip).all()
        print(f"history clips: {len(rows)}")
        for clip in rows:
            audio = db.ROOT / clip.audio_path
            feat = db.ROOT / clip.feature_path
            if not audio.exists():
                print(f"  SKIP {clip.id}: no audio on disk")
                continue
            try:
                n = _migrate_one(audio, feat)
                clip.schema_version = VERSION
                print(f"  OK   {clip.id}: {n} pts -> v{VERSION}")
            except Exception as e:  # noqa: BLE001
                print(f"  FAIL {clip.id}: {e}")
        session.commit()


def migrate_samples() -> None:
    manifest = sample_lib._load_manifest()
    print(f"sample clips: {len(manifest)}")
    for entry in manifest:
        audio = sample_lib.AUDIO_DIR / entry.get("audio_file", "")
        feat = sample_lib.FEATURES_DIR / entry.get("feature_file", "")
        if not audio.exists():
            print(f"  SKIP {entry.get('id')}: no audio on disk")
            continue
        try:
            n = _migrate_one(audio, feat)
            print(f"  OK   {entry.get('id')}: {n} pts -> v{VERSION}")
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL {entry.get('id')}: {e}")


if __name__ == "__main__":
    print(f"=== migrating stored features to schema v{VERSION} ===")
    migrate_history()
    migrate_samples()
    print("\n=== post-migration audit ===")
    sys.exit(schema_audit._print())
