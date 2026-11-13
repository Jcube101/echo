"""PRIV-* tests: private history per browser (docs/LAUNCH.md §1, decision L1).

Each TestClient has its own cookie jar, so `client` and `other_client` are two
separate browsers on the same isolated app (temp data dir + temp SQLite).
Synthetic audio only. See TEST_PLAN.md section "Privacy".
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from conftest import set_cookie

HEX32 = re.compile(r"[0-9a-f]{32}")


def _upload(c, audio_factory, name="clip.wav", freq=440.0):
    path = audio_factory.tone(duration=0.6, freq=freq, amp=0.5, name="priv")
    with open(path, "rb") as f:
        res = c.post("/upload", files={"file": (name, f, "audio/wav")})
    assert res.status_code == 200, res.text
    return res.json()


def _set_cookie_header(res) -> str:
    cookies = [v for k, v in res.headers.multi_items() if k.lower() == "set-cookie"]
    assert len(cookies) == 1, cookies
    return cookies[0]


def test_PRIV_001_cookie_minted_with_the_right_flags(client):
    """A request without a cookie gets `echo_vid` = 32 hex chars, HttpOnly,
    Secure, SameSite=Lax, Path=/, Max-Age one year (LAUNCH.md §1)."""
    res = client.get("/history")
    assert res.status_code == 200
    header = _set_cookie_header(res)
    vid = re.match(r"echo_vid=([^;]+)", header).group(1)
    assert HEX32.fullmatch(vid)
    flags = {p.strip().lower() for p in header.split(";")[1:]}
    assert {"httponly", "secure", "samesite=lax", "path=/",
            f"max-age={365 * 24 * 3600}"} <= flags


def test_PRIV_002_cookie_kept_and_refreshed_bad_cookie_replaced(client):
    """A valid cookie is kept (and re-sent so Max-Age restarts); a malformed
    one is replaced with a fresh ID."""
    first = client.get("/history")
    vid = first.cookies["echo_vid"]
    again = client.get("/history")
    assert again.cookies["echo_vid"] == vid          # same browser, same ID
    assert "max-age" in _set_cookie_header(again).lower()  # refreshed

    for bad in ("not-a-valid-id", "A" * 32, "0" * 31, "0" * 33):
        set_cookie(client, "echo_vid", bad)
        res = client.get("/history")
        fresh = res.cookies["echo_vid"]
        assert fresh != bad and HEX32.fullmatch(fresh), bad

    # A well-formed ID sent by hand is honoured (proves the cookie is read).
    set_cookie(client, "echo_vid", vid)
    assert client.get("/history").cookies["echo_vid"] == vid


def test_PRIV_003_cookie_only_on_clip_routes(client_with_frontend):
    """Static files, samples and the health check never carry Set-Cookie
    (Cloudflare won't edge-cache a response that sets one); the app page and
    clip routes do."""
    c = client_with_frontend
    for path in ("/", "/assets/app.js", "/samples", "/api/health"):
        res = c.get(path)
        assert res.status_code == 200, path
        assert "set-cookie" not in res.headers, path
    for path in ("/app", "/history"):
        assert "echo_vid=" in c.get(path).headers.get("set-cookie", ""), path


def test_PRIV_004_two_browsers_cannot_see_each_others_clips(client, other_client, audio_factory):
    """Browser B can't list, open or play browser A's clip, and gets the same
    404 as for a clip that doesn't exist."""
    a = _upload(client, audio_factory, "a.wav")
    b = _upload(other_client, audio_factory, "b.wav", freq=660.0)

    assert [r["id"] for r in client.get("/history").json()] == [a["id"]]
    assert [r["id"] for r in other_client.get("/history").json()] == [b["id"]]

    assert client.get(f"/history/{a['id']}").status_code == 200
    assert client.get(a["audio_url"]).status_code == 200

    wrong = other_client.get(f"/history/{a['id']}")
    missing = other_client.get(f"/history/{'0' * 32}")
    assert wrong.status_code == missing.status_code == 404
    assert wrong.json() == missing.json() == {"detail": "Clip not found."}

    wrong_audio = other_client.get(a["audio_url"])
    missing_audio = other_client.get(f"/audio/{'0' * 32}.opus")
    assert wrong_audio.status_code == missing_audio.status_code == 404
    assert wrong_audio.json() == missing_audio.json()

    # No cookie at all is just another browser.
    client.cookies.clear()
    assert client.get(f"/history/{a['id']}").status_code == 404
    assert client.get("/history").json() == []


def test_PRIV_005_delete_owner_only_and_files_gone(client, other_client, audio_factory, isolated_backend):
    """DELETE /history/{id}: another browser gets 404 and nothing changes; the
    owner gets 204, and the row, the playback copy and the feature file are
    gone."""
    _main, db, _storage = isolated_backend
    a = _upload(client, audio_factory)
    with db.SessionLocal() as s:
        clip = s.get(db.Clip, a["id"])
        files = [db.ROOT / clip.audio_path, db.ROOT / clip.feature_path]
    assert all(p.exists() for p in files)

    res = other_client.delete(f"/history/{a['id']}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Clip not found."}
    assert all(p.exists() for p in files)

    res = client.delete(f"/history/{a['id']}")
    assert res.status_code == 204
    assert not any(p.exists() for p in files)
    with db.SessionLocal() as s:
        assert s.get(db.Clip, a["id"]) is None
    assert client.get(f"/history/{a['id']}").status_code == 404
    assert client.get(a["audio_url"]).status_code == 404
    assert client.delete(f"/history/{a['id']}").status_code == 404


def test_PRIV_006_new_clip_ids_are_full_uuids(client, audio_factory):
    """New clip IDs are a full uuid4 hex (32 chars), and the playback file is
    named after the clip, so both URLs are unguessable."""
    a = _upload(client, audio_factory)
    assert HEX32.fullmatch(a["id"])
    assert a["audio_url"] == f"/audio/{a['id']}.opus"


def test_PRIV_007_owner_and_last_seen_recorded_and_refreshed(client, audio_factory, isolated_backend):
    """The clip row records its browser's ID; last_seen_at is set at creation
    and moves forward when the clip is opened (the 30-day rule reads it)."""
    _main, db, _storage = isolated_backend
    a = _upload(client, audio_factory)
    vid = client.cookies["echo_vid"]
    old = datetime.now(timezone.utc) - timedelta(days=10)
    with db.SessionLocal() as s:
        clip = s.get(db.Clip, a["id"])
        assert clip.owner_id == vid
        assert clip.last_seen_at is not None
        clip.last_seen_at = old
        s.commit()

    client.get("/history")  # listing isn't "opening"
    with db.SessionLocal() as s:
        seen = s.get(db.Clip, a["id"]).last_seen_at.replace(tzinfo=timezone.utc)
    assert abs((seen - old).total_seconds()) < 1

    client.get(f"/history/{a['id']}")
    with db.SessionLocal() as s:
        seen = s.get(db.Clip, a["id"]).last_seen_at.replace(tzinfo=timezone.utc)
    assert datetime.now(timezone.utc) - seen < timedelta(minutes=1)


def test_PRIV_008_columns_added_to_existing_db(tmp_path, monkeypatch):
    """A clips table from before ownership gets owner_id (NULL), last_seen_at
    (set to now, so nothing becomes "inactive" on the spot) and the owner_id
    index on startup. Idempotent across restarts."""
    from fastapi.testclient import TestClient
    from conftest import TEST_BASE_URL, _reload_backend

    data = tmp_path / "data"
    data.mkdir()
    con = sqlite3.connect(data / "echo.sqlite")
    con.execute("CREATE TABLE clips (id VARCHAR PRIMARY KEY, created_at DATETIME, "
                "source_type VARCHAR, duration_s FLOAT, feature_path VARCHAR, "
                "audio_path VARCHAR, schema_version INTEGER, source_name VARCHAR)")
    con.execute("INSERT INTO clips VALUES ('old1', '2026-01-01 10:00:00', 'upload', "
                "1.0, 'f.json', 'a.opus', 2, NULL)")
    con.commit()
    con.close()

    for _ in range(2):  # second start must not fail or re-stamp
        main = _reload_backend(data, monkeypatch)
        with TestClient(main.app, base_url=TEST_BASE_URL) as c:
            assert c.get("/history").json() == []

    con = sqlite3.connect(data / "echo.sqlite")
    cols = {r[1] for r in con.execute("PRAGMA table_info(clips)")}
    assert {"owner_id", "last_seen_at"} <= cols
    owner, seen = con.execute(
        "SELECT owner_id, last_seen_at FROM clips WHERE id='old1'").fetchone()
    indexes = {r[1] for r in con.execute("PRAGMA index_list(clips)")}
    con.close()
    assert owner is None
    assert seen is not None and seen > "2026-11-01"
    assert "ix_clips_owner_id" in indexes


def test_PRIV_009_capture_belongs_to_the_browser_that_asked(client, other_client, monkeypatch, rec_stub, signed_in):
    """A Pi-mic capture lands in the requesting browser's history only."""
    import main as main_module
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    res = client.post("/capture", json={"duration": 2})
    assert res.status_code == 200
    cid = res.json()["id"]
    assert [r["id"] for r in client.get("/history").json()] == [cid]
    assert other_client.get("/history").json() == []
    assert other_client.get(f"/history/{cid}").status_code == 404


@pytest.mark.parametrize("name", ["noext", "x.opus", ".opus"])
def test_PRIV_010_audio_unknown_names_are_404(client, name):
    """/audio file names that don't map to one of this browser's clips are a
    plain 404 (the path-traversal 400s are API-013)."""
    assert client.get(f"/audio/{name}").status_code == 404
