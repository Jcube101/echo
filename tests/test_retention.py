"""RET-* tests: the three retention rules (docs/LAUNCH.md §1, decision L6).

  - per browser: newest 20 clips        (RETENTION_PER_OWNER)
  - site-wide:   500 clips or 1 GB      (RETENTION_GLOBAL_CLIPS / _BYTES)
  - inactivity:  not opened for 30 days (RETENTION_INACTIVE_DAYS)

Limits are lowered with monkeypatch so a handful of synthetic clips is enough.
Fully sandboxed (temp data dir + temp SQLite). The site-wide count rule's
eviction order is also covered by STO-001/002.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone


def _upload(c, audio_factory, freq=440.0):
    path = audio_factory.tone(duration=0.5, freq=freq, amp=0.5, name="ret")
    with open(path, "rb") as f:
        res = c.post("/upload", files={"file": ("r.wav", f, "audio/wav")})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _files(db, clip_id):
    return [db.AUDIO_DIR / f"{clip_id}.opus", db.FEATURES_DIR / f"{clip_id}.json"]


def _age(db, clip_id, days, column="last_seen_at"):
    with db.SessionLocal() as s:
        setattr(s.get(db.Clip, clip_id), column,
                datetime.now(timezone.utc) - timedelta(days=days))
        s.commit()


def _ids(db):
    with db.SessionLocal() as s:
        return {c.id for c in s.query(db.Clip).all()}


def test_RET_001_per_browser_limit_only_trims_that_browser(client, other_client, audio_factory, isolated_backend, monkeypatch):
    """Past RETENTION_PER_OWNER a browser loses its own oldest clip (row and
    both files); another browser's clips are untouched."""
    _main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_PER_OWNER", 2)

    theirs = _upload(other_client, audio_factory, 300.0)  # oldest clip on the site
    mine = [_upload(client, audio_factory, 400.0 + 10 * i) for i in range(3)]

    assert [r["id"] for r in client.get("/history").json()] == [mine[2], mine[1]]
    assert not any(p.exists() for p in _files(db, mine[0]))
    assert [r["id"] for r in other_client.get("/history").json()] == [theirs]
    assert all(p.exists() for p in _files(db, theirs))


def test_RET_002_default_limits_match_decision_L6(isolated_backend):
    _main, db, storage = isolated_backend
    assert (db.RETENTION_PER_OWNER, db.RETENTION_GLOBAL_CLIPS,
            db.RETENTION_GLOBAL_BYTES, db.RETENTION_INACTIVE_DAYS) == (20, 500, 1024 ** 3, 30)
    assert storage.RETENTION_PER_OWNER == 20


def test_RET_003_site_wide_size_cap_deletes_oldest_first(client, other_client, audio_factory, isolated_backend, monkeypatch):
    """When clip data passes RETENTION_GLOBAL_BYTES, the oldest clips go,
    whoever owns them, until usage is back under the cap."""
    _main, db, storage = isolated_backend
    oldest = _upload(other_client, audio_factory, 300.0)
    newer = [_upload(client, audio_factory, 400.0 + 10 * i) for i in range(2)]

    monkeypatch.setattr(storage, "RETENTION_GLOBAL_BYTES", storage.data_usage_bytes() - 1)
    report = storage.run_retention()

    assert report["cap_deleted"] == 1
    assert _ids(db) == set(newer)
    assert not any(p.exists() for p in _files(db, oldest))
    assert storage.data_usage_bytes() <= storage.RETENTION_GLOBAL_BYTES


def test_RET_004_site_wide_cap_applies_on_upload_across_browsers(client, other_client, audio_factory, isolated_backend, monkeypatch):
    """The 500-clip cap is site-wide: a new upload from one browser evicts the
    site's oldest clip even when it is another browser's."""
    _main, db, storage = isolated_backend
    monkeypatch.setattr(storage, "RETENTION_GLOBAL_CLIPS", 2)
    oldest = _upload(other_client, audio_factory, 300.0)
    a = _upload(client, audio_factory, 400.0)
    b = _upload(client, audio_factory, 410.0)
    assert _ids(db) == {a, b}
    assert not any(p.exists() for p in _files(db, oldest))


def test_RET_005_inactive_clips_deleted_after_30_days(client, audio_factory, isolated_backend):
    """A clip not opened for more than 30 days is deleted with its files; one
    inside the window stays; opening a clip resets its clock; a legacy row
    with no last_seen_at falls back to created_at."""
    _main, db, storage = isolated_backend
    stale, fresh, reopened, legacy = (_upload(client, audio_factory, 400.0 + 10 * i)
                                      for i in range(4))
    _age(db, stale, 31)
    _age(db, fresh, 29)
    _age(db, reopened, 45)
    assert client.get(f"/history/{reopened}").status_code == 200
    _age(db, legacy, 40, column="created_at")
    with db.SessionLocal() as s:
        s.get(db.Clip, legacy).last_seen_at = None
        s.commit()

    report = storage.run_retention()

    assert report["inactive_deleted"] == 2
    assert _ids(db) == {fresh, reopened}
    for gone in (stale, legacy):
        assert not any(p.exists() for p in _files(db, gone))
    assert all(p.exists() for p in _files(db, fresh))


def test_RET_006_inactivity_rule_runs_at_startup_and_on_upload(client, audio_factory, isolated_backend):
    """The 30-day rule runs when the app starts and again on every upload."""
    from fastapi.testclient import TestClient
    from conftest import TEST_BASE_URL
    main, db, _storage = isolated_backend

    first = _upload(client, audio_factory, 400.0)
    _age(db, first, 31)
    with TestClient(main.app, base_url=TEST_BASE_URL):  # a fresh start
        pass
    assert first not in _ids(db)

    second = _upload(client, audio_factory, 410.0)
    _age(db, second, 31)
    third = _upload(client, audio_factory, 420.0)
    assert _ids(db) == {third}


def test_RET_007_daily_pass_keeps_running(isolated_backend, monkeypatch):
    """The in-process loop calls the retention pass again after each interval
    (24 h in production), and one failing pass doesn't stop it."""
    from fastapi.testclient import TestClient
    main, _db, _storage = isolated_backend
    calls = []

    def fake_pass():
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("one bad pass")

    assert main.RETENTION_INTERVAL_S == 24 * 3600
    monkeypatch.setattr(main, "RETENTION_INTERVAL_S", 0.05)
    monkeypatch.setattr(main, "run_retention", fake_pass)
    with TestClient(main.app):
        deadline = time.monotonic() + 5
        while len(calls) < 4 and time.monotonic() < deadline:
            time.sleep(0.05)
    assert len(calls) >= 4  # startup + repeats, past the failing one


def test_RET_008_warning_logged_past_80_percent_of_a_cap(client, audio_factory, isolated_backend, monkeypatch, caplog):
    """The pass logs a warning once clip data passes 80% of either site-wide
    cap, and stays quiet below it. The message carries counts only."""
    _main, _db, storage = isolated_backend
    for i in range(3):
        _upload(client, audio_factory, 400.0 + 10 * i)

    with caplog.at_level(logging.WARNING, logger="echo.storage"):
        storage.run_retention()
    assert not caplog.records

    monkeypatch.setattr(storage, "RETENTION_GLOBAL_CLIPS", 3)  # 3 of 3 > 80%
    with caplog.at_level(logging.WARNING, logger="echo.storage"):
        storage.run_retention()
    assert any("past 80% of its cap" in r.getMessage() for r in caplog.records)
    assert client.cookies["echo_vid"] not in caplog.text

    caplog.clear()
    monkeypatch.setattr(storage, "RETENTION_GLOBAL_CLIPS", 500)
    monkeypatch.setattr(storage, "RETENTION_GLOBAL_BYTES",
                        int(storage.data_usage_bytes() / 0.9))  # at 90% of the size cap
    with caplog.at_level(logging.WARNING, logger="echo.storage"):
        storage.run_retention()
    assert any("past 80% of its cap" in r.getMessage() for r in caplog.records)
