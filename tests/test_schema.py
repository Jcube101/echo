"""SCHEMA-* tests for the feature-schema versioning system (Part 0).

Two guardrails, both tied to a concrete contract:

- The extractor's declared FEATURE_FIELDS must match what extract_features
  actually emits — otherwise the audit's field-set check would silently drift
  from reality.
- A freshly stored clip must be reported CURRENT by the audit, and a clip
  written under an older version/field-set must be reported STALE — the
  enforcement that turns "forgot to migrate" into a red test rather than
  silent data drift.

Fully sandboxed: synthetic audio + the isolated temp-data-dir backend, same as
the rest of the suite. Never touches the real data/ directory.
"""

from __future__ import annotations

import json
from pathlib import Path

import extraction
import schema_audit


def test_SCHEMA_001_feature_fields_contract(audio_factory):
    """extract_features emits EXACTLY the declared FEATURE_FIELDS on every
    frame — so the audit's key-set comparison reflects real output.

    extraction.FEATURE_FIELDS docstring: "The EXACT per-frame keys the
    extractor is contracted to emit … tests/test_schema.py asserts
    extract_features actually emits exactly these."
    """
    path = audio_factory.chirp(duration=1.5, f0=300.0, f1=2500.0, amp=0.6)
    feats = extraction.extract_features(str(path))
    assert feats
    want = set(extraction.FEATURE_FIELDS)
    for f in feats:
        assert set(f.keys()) == want, f"frame keys {set(f.keys())} != {want}"


def test_SCHEMA_002_fresh_clip_is_current(isolated_backend, audio_factory):
    """A clip written by the current pipeline stamps the current version into
    both the feature JSON and the clips row, and the audit reports it CURRENT.
    """
    main, db, storage = isolated_backend
    path = audio_factory.tone(duration=0.6, freq=500.0, amp=0.6)
    res = storage.process_audio(path, source_type="upload")

    # DB column stamped
    with db.SessionLocal() as session:
        clip = session.get(db.Clip, res["id"])
        assert clip.schema_version == extraction.FEATURE_SCHEMA_VERSION

    # JSON payload stamped
    payload = json.loads((db.ROOT / clip.feature_path).read_text())
    assert payload["schema_version"] == extraction.FEATURE_SCHEMA_VERSION

    # Audit agrees: this clip is current, nothing stale from it.
    audit = schema_audit.audit_all()
    match = [d for d in audit["details"] if d["id"] == res["id"]]
    assert match and match[0]["current"], match


def test_SCHEMA_003_audit_flags_stale_version(isolated_backend, audio_factory):
    """A stored payload written under an OLD version (or with a mismatched
    field set) is reported STALE — the check that a forgotten migration turns
    the audit red instead of drifting silently.
    """
    main, db, storage = isolated_backend
    path = audio_factory.tone(duration=0.6, freq=500.0, amp=0.6)
    res = storage.process_audio(path, source_type="upload")

    with db.SessionLocal() as session:
        clip = session.get(db.Clip, res["id"])
        feat_path = db.ROOT / clip.feature_path

    # Rewrite the payload as if an older extraction had produced it.
    payload = json.loads(feat_path.read_text())
    payload["schema_version"] = extraction.FEATURE_SCHEMA_VERSION - 1
    feat_path.write_text(json.dumps(payload))

    audit = schema_audit.audit_all()
    match = [d for d in audit["details"] if d["id"] == res["id"]]
    assert match and not match[0]["current"]
    assert res["id"] in audit["stale_ids"]
    assert audit["stale"] >= 1


def test_SCHEMA_004_audit_flags_field_drift(isolated_backend, audio_factory):
    """Even with a matching version tag, a payload whose per-frame fields differ
    from FEATURE_FIELDS is STALE — this is what catches "changed the fields but
    forgot to bump the version".
    """
    main, db, storage = isolated_backend
    path = audio_factory.tone(duration=0.6, freq=500.0, amp=0.6)
    res = storage.process_audio(path, source_type="upload")

    with db.SessionLocal() as session:
        clip = session.get(db.Clip, res["id"])
        feat_path = db.ROOT / clip.feature_path

    payload = json.loads(feat_path.read_text())
    for frame in payload["features"]:
        frame.pop("tonality", None)  # drop a field, keep the current version tag
    feat_path.write_text(json.dumps(payload))

    audit = schema_audit.audit_all()
    match = [d for d in audit["details"] if d["id"] == res["id"]]
    assert match and not match[0]["current"]
    assert "tonality" in match[0]["reason"]


def test_SCHEMA_005_real_data_is_current():
    """Every clip stored in the REAL data dir + sample library is on the current
    schema. Skips when nothing is stored (fresh checkout / bare CI). On the Pi
    this is the live gate: it goes red the moment extraction changes without a
    migration having been run.

    Runs against real paths on purpose (no isolated fixture) — this is the
    "real check that returns a real answer, not a claim" from the Part 0 spec.
    """
    import importlib
    import db
    importlib.reload(db)  # ensure real (non-fixture) paths, whatever ran before

    audit = schema_audit.audit_all()
    if audit["total"] == 0:
        import pytest
        pytest.skip("no stored clips in this environment")
    assert audit["stale"] == 0, (
        f"{audit['stale']} stale clip(s): {audit['stale_ids']} — "
        f"run `python migrate_schema.py`")
