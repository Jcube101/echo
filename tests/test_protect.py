"""PROT-* tests: protecting the Pi (docs/LAUNCH.md §3).

One analysis at a time with a friendly 503, upload rate limits per browser
and per IP (429), and the hardening around untrusted files. Fully sandboxed;
limits and waits are lowered with monkeypatch so nothing here is slow.
"""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import TEST_BASE_URL, set_cookie
from ratelimit import RateLimiter


def _post(c, audio_factory, freq=440.0, **kw):
    path = audio_factory.tone(duration=0.5, freq=freq, amp=0.5, name="prot")
    with open(path, "rb") as f:
        return c.post("/upload", files={"file": ("p.wav", f, "audio/wav")}, **kw)


# --- rate limiter (unit) ------------------------------------------------------

def test_PROT_001_limiter_windows_keys_and_refund():
    rl = RateLimiter([(3, 3600), (5, 86400)])
    t = 1_000_000.0
    assert all(rl.hit(["ip:a"], now=t + i) is None for i in range(3))
    refused = rl.hit(["ip:a"], now=t + 10)
    assert (refused.limit, refused.window_s) == (3, 3600)
    assert 3585 <= refused.retry_after_s <= 3600      # when the first one ages out
    assert rl.hit(["ip:b"], now=t + 10) is None       # another key is unaffected

    # A refused request isn't recorded, and any refusing key blocks the request.
    assert rl.hit(["ip:fresh", "ip:a"], now=t + 11) is not None
    assert rl.hit(["ip:fresh"], now=t + 11) is None

    # An hour later the hourly window is clear, until the daily limit (5) bites.
    assert rl.hit(["ip:a"], now=t + 3700) is None
    assert rl.hit(["ip:a"], now=t + 3701) is None
    daily = rl.hit(["ip:a"], now=t + 3702)
    assert (daily.limit, daily.window_s) == (5, 86400)
    assert rl.hit(["ip:a"], now=t + 86400 + 5) is None

    rl2 = RateLimiter([(1, 3600)])
    assert rl2.hit(["k"], now=t) is None
    rl2.refund(["k"])
    assert rl2.hit(["k"], now=t + 1) is None


def test_PROT_002_default_limits_are_10_per_hour_30_per_day(isolated_backend):
    main, _db, _storage = isolated_backend
    assert (main.UPLOADS_PER_HOUR, main.UPLOADS_PER_DAY) == (10, 30)
    assert main.upload_limiter.limits == [(10, 3600), (30, 86400)]


# --- rate limit on /upload ----------------------------------------------------

def test_PROT_003_upload_429_plain_message_before_any_work(client, other_client, audio_factory, isolated_backend, monkeypatch):
    """Past the limit /upload answers 429 with a plain-language message and a
    Retry-After, without running the pipeline. The limit is per IP too, so a
    second browser on the same address is also turned away."""
    main, _db, _storage = isolated_backend
    monkeypatch.setattr(main, "upload_limiter", RateLimiter([(2, 3600), (30, 86400)]))
    assert _post(client, audio_factory).status_code == 200
    assert _post(client, audio_factory, 450.0).status_code == 200

    def no_work(*a, **k):
        raise AssertionError("a rate-limited upload must not be processed")
    monkeypatch.setattr(main, "process_audio", no_work)

    res = _post(client, audio_factory, 460.0)
    assert res.status_code == 429
    assert res.json()["detail"].startswith("You've reached the upload limit (2 per hour). Try again in about ")
    assert 1 <= int(res.headers["retry-after"]) <= 3600
    assert "echo_vid=" in res.headers["set-cookie"]

    assert _post(other_client, audio_factory, 470.0).status_code == 429  # same IP
    assert len(client.get("/history").json()) == 2


def test_PROT_004_limit_follows_the_browser_across_ip_addresses(isolated_backend, audio_factory, monkeypatch):
    """Through the tunnel (requests arrive from localhost) the same browser is
    limited even when its IP address changes; a new browser on a new address
    is not."""
    from fastapi.testclient import TestClient
    main, _db, _storage = isolated_backend
    monkeypatch.setattr(main, "upload_limiter", RateLimiter([(1, 3600)]))
    with TestClient(main.app, base_url=TEST_BASE_URL, client=("127.0.0.1", 50000)) as c:
        first = _post(c, audio_factory, headers={"CF-Connecting-IP": "203.0.113.1"})
        assert first.status_code == 200
        vid = first.cookies["echo_vid"]
        assert _post(c, audio_factory, headers={"CF-Connecting-IP": "203.0.113.2"}).status_code == 429
        c.cookies.clear()  # a different browser…
        assert _post(c, audio_factory, headers={"CF-Connecting-IP": "203.0.113.1"}).status_code == 429  # …same IP
        assert _post(c, audio_factory, headers={"CF-Connecting-IP": "203.0.113.3"}).status_code == 200
        set_cookie(c, "echo_vid", vid)
        assert _post(c, audio_factory, headers={"CF-Connecting-IP": "203.0.113.4"}).status_code == 429


@pytest.mark.parametrize("peer,header,expected", [
    ("127.0.0.1", "203.0.113.9", "203.0.113.9"),   # cloudflared on this machine
    ("::1", "203.0.113.9", "203.0.113.9"),
    ("127.0.0.1", None, "127.0.0.1"),
    ("192.168.1.50", "203.0.113.9", "192.168.1.50"),  # LAN client faking the header
    ("192.168.1.50", None, "192.168.1.50"),
])
def test_PROT_005_cf_connecting_ip_trusted_only_from_localhost(isolated_backend, peer, header, expected):
    main, _db, _storage = isolated_backend
    req = SimpleNamespace(client=SimpleNamespace(host=peer),
                          headers={"cf-connecting-ip": header} if header else {})
    assert main._client_ip(req) == expected


# --- one analysis at a time ---------------------------------------------------

def test_PROT_006_busy_gives_friendly_503_and_server_stays_responsive(client, audio_factory, isolated_backend, monkeypatch):
    """While one clip is being analysed, a second upload waits BUSY_WAIT_S and
    then gets 503 "Echo is busy…" with Retry-After: 15. It is not charged
    against the rate limit, other routes keep answering meanwhile, and the
    first upload finishes normally."""
    main, _db, storage = isolated_backend
    assert main.MAX_CONCURRENT_EXTRACTIONS == 1 and main.BUSY_WAIT_S == 20.0
    monkeypatch.setattr(main, "BUSY_WAIT_S", 0.3)
    monkeypatch.setattr(main, "upload_limiter", RateLimiter([(2, 3600)]))

    started, release, running = threading.Event(), threading.Event(), []
    real = storage.process_audio

    def slow(*a, **k):
        running.append(1)
        started.set()
        assert release.wait(20)
        return real(*a, **k)
    monkeypatch.setattr(main, "process_audio", slow)

    first = {}
    path = audio_factory.tone(duration=0.5, freq=440.0, amp=0.5, name="first")

    def go():
        with open(path, "rb") as f:
            first["res"] = client.post("/upload", files={"file": ("a.wav", f, "audio/wav")})
    t = threading.Thread(target=go)
    t.start()
    try:
        assert started.wait(10)
        t0 = time.monotonic()
        assert client.get("/api/health").status_code == 200   # event loop is free
        assert time.monotonic() - t0 < 1.0

        busy = _post(client, audio_factory, 500.0)
        assert busy.status_code == 503
        assert busy.json() == {"detail": "Echo is busy — try again in a moment."}
        assert busy.headers["retry-after"] == "15"
        assert len(running) == 1                               # never two at once
    finally:
        release.set()
        t.join(30)
    assert first["res"].status_code == 200

    # The 503 was refunded: with a limit of 2, this second real upload is allowed.
    assert _post(client, audio_factory, 510.0).status_code == 200
    assert _post(client, audio_factory, 520.0).status_code == 429


def test_PROT_007_concurrency_setting_is_clamped_to_1_or_2(monkeypatch):
    import main
    for raw, expected in [("5", 2), ("2", 2), ("0", 1), ("-3", 1), ("junk", 1)]:
        monkeypatch.setenv("ECHO_MAX_CONCURRENT_EXTRACTIONS", raw)
        assert main._env_int("ECHO_MAX_CONCURRENT_EXTRACTIONS", 1, 1, 2) == expected
    monkeypatch.delenv("ECHO_MAX_CONCURRENT_EXTRACTIONS")
    assert main._env_int("ECHO_MAX_CONCURRENT_EXTRACTIONS", 1, 1, 2) == 1


# --- untrusted files ----------------------------------------------------------

def test_PROT_008_oversized_upload_refused_before_the_body_is_read(client, isolated_backend, monkeypatch):
    """A Content-Length past the 20 MB limit is a 413 from the guard, before
    FastAPI spools the body to disk; an upload with no length is a 411."""
    main, _db, _storage = isolated_backend
    made = []
    monkeypatch.setattr(main.tempfile, "mkdtemp", lambda *a, **k: made.append(1) or "/nonexistent")
    big = {"content-length": str(main.MAX_UPLOAD_BYTES + main.UPLOAD_FORM_OVERHEAD + 1),
           "content-type": "multipart/form-data; boundary=x"}
    res = client.post("/upload", content=b"tiny", headers=big)
    assert res.status_code == 413 and "20 MB" in res.json()["detail"]

    def chunks():
        yield b"--x--\r\n"
    res = client.post("/upload", content=chunks(),
                      headers={"content-type": "multipart/form-data; boundary=x"})
    assert res.status_code == 411
    assert not made


def test_PROT_009_ffmpeg_calls_are_bounded_and_never_read_stdin(isolated_backend, audio_factory, monkeypatch):
    """Every ffprobe/ffmpeg call carries a 30 s timeout and a closed stdin
    (ffmpeg also gets -nostdin); a call that times out is a clean
    ProcessingError (a 422), not a crash."""
    _main, _db, storage = isolated_backend
    assert storage.FFMPEG_TIMEOUT_S == 30
    calls, real_run = [], subprocess.run

    def spy(cmd, **kw):
        calls.append((cmd, kw))
        return real_run(cmd, **kw)
    monkeypatch.setattr(storage.subprocess, "run", spy)
    storage.process_audio(audio_factory.tone(duration=0.5, name="ok"), source_type="upload")

    assert [Path(c[0]).name for c, _ in calls] == ["ffprobe", "ffmpeg", "ffmpeg"]
    for cmd, kw in calls:
        assert kw["timeout"] == 30 and kw["stdin"] == subprocess.DEVNULL
        if cmd[0] == "ffmpeg":
            assert cmd[1] == "-nostdin"

    def hang(cmd, **kw):
        if cmd[0] == "ffmpeg":
            raise subprocess.TimeoutExpired(cmd, kw["timeout"])
        return real_run(cmd, **kw)
    monkeypatch.setattr(storage.subprocess, "run", hang)
    with pytest.raises(storage.ProcessingError, match="took too long"):
        storage.process_audio(audio_factory.tone(duration=0.5, name="slow"), source_type="upload")
    assert not list(storage.AUDIO_DIR.glob("*.opus"))[1:]  # only the first clip's copy


def test_PROT_010_file_without_audio_is_refused_before_decoding(client, isolated_backend, tmp_path, monkeypatch):
    """A real video with no audio track: ffprobe finds no audio stream, so
    Echo answers 422 and never runs ffmpeg on it."""
    _main, _db, storage = isolated_backend
    silent = tmp_path / "silent.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "testsrc=duration=1:size=64x64:rate=5", "-an",
                    "-pix_fmt", "yuv420p", str(silent)], check=True, timeout=60)

    def no_decode(args):
        raise AssertionError("ffmpeg must not run on a file with no audio stream")
    monkeypatch.setattr(storage, "_run_ffmpeg", no_decode)
    with open(silent, "rb") as f:
        res = client.post("/upload", files={"file": ("silent.mp4", f, "video/mp4")})
    assert res.status_code == 422
    assert res.json() == {"detail": "That file has no audio track."}


def test_PROT_011_temp_dir_removed_on_success_and_on_every_failure(client, audio_factory, isolated_backend, monkeypatch):
    """The upload's temp dir is gone after a success, an undecodable file, an
    empty file, an over-size body and a crash in the pipeline."""
    main, _db, _storage = isolated_backend
    made, real_mkdtemp = [], main.tempfile.mkdtemp

    def tracking(*a, **k):
        d = real_mkdtemp(*a, **k)
        made.append(Path(d))
        return d
    monkeypatch.setattr(main.tempfile, "mkdtemp", tracking)

    assert _post(client, audio_factory).status_code == 200
    assert client.post("/upload", files={"file": ("j.bin", audio_factory.junk_bytes(), "application/octet-stream")}).status_code == 422
    assert client.post("/upload", files={"file": ("e.wav", b"", "audio/wav")}).status_code == 400
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1000)  # streamed size cap, past the guard's slack
    assert client.post("/upload", files={"file": ("b.wav", b"\0" * 5000, "audio/wav")}).status_code == 413

    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 20 * 1024 * 1024)

    def crash(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(main, "process_audio", crash)
    with pytest.raises(RuntimeError):
        _post(client, audio_factory, 450.0)

    assert len(made) == 5
    assert not any(d.exists() for d in made)
