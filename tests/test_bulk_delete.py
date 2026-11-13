"""BULK-* tests: POST /history/delete (multi-select delete in History).

Owner-checked per ID: a browser can only delete its own clips, and IDs that
are someone else's, unknown or repeated are skipped without comment.
"""

from __future__ import annotations


def _upload(c, audio_factory, freq=440.0):
    path = audio_factory.tone(duration=0.5, freq=freq, amp=0.5, name="bulk")
    with open(path, "rb") as f:
        res = c.post("/upload", files={"file": ("b.wav", f, "audio/wav")})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _files(db, clip_id):
    return [db.AUDIO_DIR / f"{clip_id}.opus", db.FEATURES_DIR / f"{clip_id}.json"]


def test_BULK_001_only_the_callers_clips_are_deleted(client, other_client, audio_factory, isolated_backend):
    """Browser A sends its own IDs mixed with browser B's: A's clips go (rows
    and both files), B's are untouched, and the count is A's only."""
    _main, db, _storage = isolated_backend
    mine = [_upload(client, audio_factory, 400.0 + 10 * i) for i in range(3)]
    theirs = [_upload(other_client, audio_factory, 600.0 + 10 * i) for i in range(2)]

    res = client.post("/history/delete", json={"ids": [mine[0], theirs[0], mine[2], theirs[1]]})
    assert res.status_code == 200
    assert res.json() == {"deleted": 2}

    assert [r["id"] for r in client.get("/history").json()] == [mine[1]]
    assert sorted(r["id"] for r in other_client.get("/history").json()) == sorted(theirs)
    for gone in (mine[0], mine[2]):
        assert not any(p.exists() for p in _files(db, gone))
        assert client.get(f"/history/{gone}").status_code == 404
    for kept in (mine[1], *theirs):
        assert all(p.exists() for p in _files(db, kept))
    with db.SessionLocal() as s:
        assert s.query(db.Clip).count() == 3


def test_BULK_002_unknown_repeated_and_empty_lists(client, audio_factory):
    """Unknown IDs and repeats don't inflate the count or raise; an empty list
    deletes nothing; the answer is the same shape either way, so it never
    reveals which IDs exist."""
    a, b = _upload(client, audio_factory), _upload(client, audio_factory, 500.0)
    assert client.post("/history/delete", json={"ids": []}).json() == {"deleted": 0}
    assert client.post("/history/delete", json={"ids": ["nope", "0" * 32]}).json() == {"deleted": 0}
    assert client.post("/history/delete", json={"ids": [a, a, "nope", a]}).json() == {"deleted": 1}
    assert [r["id"] for r in client.get("/history").json()] == [b]
    assert client.post("/history/delete", json={"ids": [a, b]}).json() == {"deleted": 1}
    assert client.get("/history").json() == []


def test_BULK_003_limits_and_bad_bodies(client, audio_factory):
    a = _upload(client, audio_factory)
    assert client.post("/history/delete", json={"ids": ["x"] * 101}).status_code == 422
    assert client.post("/history/delete", json={"ids": "not-a-list"}).status_code == 422
    assert client.post("/history/delete", json={}).status_code == 422
    assert client.post("/history/delete", json={"ids": ["x"] * 100}).json() == {"deleted": 0}
    assert [r["id"] for r in client.get("/history").json()] == [a]      # none of that touched it


def test_BULK_004_a_browser_with_no_cookie_deletes_nothing(client, audio_factory, isolated_backend):
    _main, db, _storage = isolated_backend
    a = _upload(client, audio_factory)
    client.cookies.clear()
    res = client.post("/history/delete", json={"ids": [a]})
    assert res.status_code == 200 and res.json() == {"deleted": 0}
    assert "echo_vid=" in res.headers["set-cookie"]
    assert all(p.exists() for p in _files(db, a))
