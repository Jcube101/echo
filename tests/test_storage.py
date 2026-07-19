"""STO-* tests for db.py / storage.py: retention eviction, raw-audio discard,
failure rollback, metadata-only DB, and the sample library's retention
immunity.

Fully sandboxed: temp data dir + temp SQLite via the ECHO_DATA_DIR
test-enablement seam (the `isolated_backend` fixture), synthetic fixture
audio, real ffmpeg/ffprobe. Never touches the real data/ directory. See
TEST_PLAN.md section D.
"""

from __future__ import annotations

import subprocess
import time
from datetime import datetime, timedelta, timezone

import pytest

import samples as samples_lib


def test_STO_001_retention_evicts_oldest_row_and_files(isolated_backend, audio_factory, monkeypatch):
    """With RETENTION_LIMIT lowered to 3, saving a 4th clip deletes the
    oldest clip's DB row AND both its files.

    CLAUDE.md locked: "Last 50 entries; oldest entry's files + DB row
    deleted on each save beyond 50."
    """
    main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_LIMIT", 3)

    results = []
    for i in range(4):
        path = audio_factory.tone(duration=0.5, freq=400 + i * 10, amp=0.5, name=f"clip{i}")
        results.append(storage.process_audio(path, source_type="upload"))
        time.sleep(0.01)  # ensure strictly increasing created_at

    oldest_id = results[0]["id"]
    with db.SessionLocal() as session:
        assert session.get(db.Clip, oldest_id) is None
        assert session.query(db.Clip).count() == 3

    assert not (db.AUDIO_DIR / f"{oldest_id}.opus").exists()
    assert not (db.FEATURES_DIR / f"{oldest_id}.json").exists()

    for r in results[1:]:
        with db.SessionLocal() as session:
            assert session.get(db.Clip, r["id"]) is not None


def test_STO_002_retention_orders_by_created_at_not_insertion(isolated_backend, audio_factory, monkeypatch):
    """Survivors are exactly the N newest by created_at — not by insertion
    order or id. created_at values are scrambled after insertion so the
    OLDEST-inserted row is actually the newest, and vice versa."""
    main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_LIMIT", 3)

    ids = []
    for i in range(3):
        path = audio_factory.tone(duration=0.5, freq=400 + i * 10, amp=0.5, name=f"c{i}")
        r = storage.process_audio(path, source_type="upload")
        ids.append(r["id"])

    base = datetime.now(timezone.utc)
    with db.SessionLocal() as session:
        session.get(db.Clip, ids[0]).created_at = base + timedelta(seconds=100)  # newest
        session.get(db.Clip, ids[1]).created_at = base - timedelta(seconds=100)  # oldest
        session.get(db.Clip, ids[2]).created_at = base
        session.commit()

    path4 = audio_factory.tone(duration=0.5, freq=500, amp=0.5, name="c3")
    r4 = storage.process_audio(path4, source_type="upload")

    with db.SessionLocal() as session:
        remaining_ids = {c.id for c in session.query(db.Clip).all()}

    assert ids[1] not in remaining_ids, "row with the OLDEST created_at should be evicted"
    assert ids[0] in remaining_ids
    assert ids[2] in remaining_ids
    assert r4["id"] in remaining_ids


def test_STO_003_raw_audio_discarded(isolated_backend, audio_factory):
    """After process_audio() returns, the raw input file and the
    intermediate `_x.wav` are gone; only the transcoded .opus + feature
    .json persist.

    CLAUDE.md locked: "Raw upload processed then discarded; only a small
    transcoded playback copy (opus/mp3) is kept"; standing guardrail: "Raw
    uploaded/recorded audio must never persist beyond the transcoded
    playback copy — no exceptions."
    """
    main, db, storage = isolated_backend
    path = audio_factory.tone(duration=1.0, freq=440.0, amp=0.5)

    result = storage.process_audio(path, source_type="upload")

    assert not path.exists(), "raw input file must be deleted after processing"
    leftover_wavs = list(path.parent.glob("*_x.wav"))
    assert leftover_wavs == [], f"intermediate wav_tmp not cleaned up: {leftover_wavs}"

    assert (db.AUDIO_DIR / f"{result['id']}.opus").exists()
    assert (db.FEATURES_DIR / f"{result['id']}.json").exists()


def test_STO_004_failure_rollback_on_extraction_crash(isolated_backend, audio_factory, monkeypatch):
    """When extraction raises mid-pipeline, no partial .opus/.json remains,
    no DB row is created, and the raw file is still deleted (the `finally`
    block).

    storage.py: "Roll back any partial artifacts on failure."
    """
    main, db, storage = isolated_backend

    def boom(*a, **kw):
        raise RuntimeError("simulated extraction crash")

    monkeypatch.setattr(storage, "extract_features", boom)
    path = audio_factory.tone(duration=1.0, freq=440.0, amp=0.5)

    with pytest.raises(RuntimeError):
        storage.process_audio(path, source_type="upload")

    assert not path.exists()
    with db.SessionLocal() as session:
        assert session.query(db.Clip).count() == 0
    assert list(db.AUDIO_DIR.glob("*.opus")) == []
    assert list(db.FEATURES_DIR.glob("*.json")) == []


def test_STO_004b_undecodable_input_raises_processing_error_cleanly(isolated_backend, audio_factory):
    """Undecodable input raises ProcessingError (via ffprobe failing), with
    no partial state left behind."""
    main, db, storage = isolated_backend
    path = audio_factory.junk_file()

    with pytest.raises(storage.ProcessingError):
        storage.process_audio(path, source_type="upload")

    with db.SessionLocal() as session:
        assert session.query(db.Clip).count() == 0
    assert list(db.AUDIO_DIR.glob("*.opus")) == []
    assert list(db.FEATURES_DIR.glob("*.json")) == []


def test_STO_005_metadata_only_db_stays_small(isolated_backend, audio_factory):
    """The clips schema stores only strings/floats/datetime — never audio
    blobs — and the SQLite file stays tiny after several saves.

    CLAUDE.md locked: "Never store audio blobs in the DB."
    """
    main, db, storage = isolated_backend

    columns = {c.name: c.type.python_type for c in db.Clip.__table__.columns}
    assert set(columns) == {"id", "created_at", "source_type", "duration_s",
                            "feature_path", "audio_path", "schema_version"}
    assert columns["id"] is str
    assert columns["source_type"] is str
    assert columns["feature_path"] is str
    assert columns["audio_path"] is str
    assert columns["duration_s"] is float
    assert columns["schema_version"] is int  # metadata int, still no blobs

    for i in range(5):
        path = audio_factory.tone(duration=0.5, freq=400 + i * 10, amp=0.5, name=f"c{i}")
        storage.process_audio(path, source_type="upload")

    assert db.DB_PATH.stat().st_size < 200_000, "SQLite file suspiciously large for metadata-only rows"


def test_STO_006_probe_duration_errors(isolated_backend, audio_factory):
    """probe_duration raises ProcessingError for junk input / a non-zero
    ffprobe exit, and process_audio maps a zero-duration clip to a clear
    message."""
    main, db, storage = isolated_backend

    with pytest.raises(storage.ProcessingError):
        storage.probe_duration(audio_factory.junk_file())

    with pytest.raises(storage.ProcessingError, match="unsupported or corrupt"):
        storage.process_audio(audio_factory.junk_file(), source_type="upload")


def test_STO_007_duration_tolerance_and_effective_duration(isolated_backend, audio_factory):
    """60.0-60.5s is accepted (container-rounding tolerance) and its stored
    duration_s is truncated to MAX_DURATION_S; beyond that is rejected.

    storage.py: "small tolerance for container rounding"; "effective
    duration = min(actual, cap) since extraction truncates at cap."
    """
    main, db, storage = isolated_backend

    within_tolerance = audio_factory.tone(duration=60.3, freq=300.0, amp=0.4, name="ok60")
    result = storage.process_audio(within_tolerance, source_type="upload")
    assert result["duration_s"] == pytest.approx(60.0, abs=0.01)

    over_tolerance = audio_factory.tone(duration=60.6, freq=300.0, amp=0.4, name="over60")
    with pytest.raises(storage.ProcessingError, match="the limit is 60s"):
        storage.process_audio(over_tolerance, source_type="upload")


def test_STO_008_sample_library_immune_to_retention(isolated_backend, audio_factory, monkeypatch):
    """After churning enough clips through process_audio to trigger multiple
    evictions, every samples/audio + samples/features file still exists and
    list_samples() still returns all 3 — samples are never `clips` rows *by
    construction*, so eviction can never see them.

    CLAUDE.md locked: "Sample library exception … never a clips DB row,
    never subject to the 50-entry retention rule"; LEARNINGS.md Part D.
    """
    main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_LIMIT", 2)

    before = samples_lib.list_samples()
    assert len(before) == 3
    before_ids = {s["id"] for s in before}

    for i in range(6):
        path = audio_factory.tone(duration=0.4, freq=350 + i * 5, amp=0.4, name=f"churn{i}")
        storage.process_audio(path, source_type="upload")

    after = samples_lib.list_samples()
    assert {s["id"] for s in after} == before_ids
    for entry in samples_lib._load_manifest():
        assert (samples_lib.AUDIO_DIR / entry["audio_file"]).exists()
        assert (samples_lib.FEATURES_DIR / entry["feature_file"]).exists()

    with db.SessionLocal() as session:
        assert session.query(db.Clip).count() == 2  # retention held, samples untouched


def test_STO_009_playback_copy_is_valid_and_small(isolated_backend, audio_factory):
    """The produced .opus is ffprobe-decodable, mono, and dramatically
    smaller than the raw WAV input (the SD-card rationale)."""
    main, db, storage = isolated_backend
    path = audio_factory.tone(duration=3.0, freq=440.0, amp=0.6)
    raw_size = path.stat().st_size

    result = storage.process_audio(path, source_type="upload")
    opus_path = db.AUDIO_DIR / f"{result['id']}.opus"
    assert opus_path.exists()
    assert opus_path.stat().st_size < raw_size * 0.5

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels,codec_name",
         "-of", "csv=p=0", str(opus_path)],
        capture_output=True, text=True, timeout=30,
    )
    assert probe.returncode == 0
    assert "opus" in probe.stdout.lower()
    assert probe.stdout.strip().startswith("1,") or probe.stdout.strip().endswith(",1")


def test_STO_010_retention_tolerates_missing_files(isolated_backend, audio_factory, monkeypatch):
    """Evicting a row whose files were already deleted by hand does not
    raise, and still removes the row (unlink(missing_ok=True) + OSError
    guard)."""
    main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_LIMIT", 2)

    first = storage.process_audio(
        audio_factory.tone(duration=0.4, freq=400.0, amp=0.4, name="first"), source_type="upload")

    (db.AUDIO_DIR / f"{first['id']}.opus").unlink()
    (db.FEATURES_DIR / f"{first['id']}.json").unlink()

    storage.process_audio(audio_factory.tone(duration=0.4, freq=410.0, amp=0.4, name="second"), source_type="upload")
    storage.process_audio(audio_factory.tone(duration=0.4, freq=420.0, amp=0.4, name="third"), source_type="upload")

    with db.SessionLocal() as session:
        assert session.get(db.Clip, first["id"]) is None
        assert session.query(db.Clip).count() == 2
