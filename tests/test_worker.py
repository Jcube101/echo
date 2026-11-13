"""WORK-* tests: the analysis worker process (analysis_worker.py).

The rest of the suite analyses clips in a thread (ECHO_ANALYSIS_MODE=thread,
set in conftest). These tests run production's mode: a real, separate worker
process, started by the app, fed over a pipe, killed when a job overruns and
replaced when it dies. Fully sandboxed (temp data dir); synthetic audio.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time

import pytest

from conftest import ROOT, TEST_BASE_URL, _reload_backend


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    # A killed child stays a zombie until reaped; that isn't "alive".
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


def _wait_dead(pid: int, timeout=10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def worker_app(tmp_path, monkeypatch):
    """(client, main, db) for an isolated app in worker-process mode."""
    from fastapi.testclient import TestClient
    monkeypatch.setenv("ECHO_ANALYSIS_MODE", "process")
    main = _reload_backend(tmp_path / "data", monkeypatch)
    import db
    assert main.ANALYSIS_MODE == "process"
    with TestClient(main.app, base_url=TEST_BASE_URL) as c:
        yield c, main, db
    assert not main._workers  # shutdown stopped them


def _upload(c, audio_factory, freq=440.0):
    path = audio_factory.tone(duration=0.6, freq=freq, amp=0.5, name="work")
    with open(path, "rb") as f:
        return c.post("/upload", files={"file": ("w.wav", f, "audio/wav")})


def _leftovers(db):
    with db.SessionLocal() as s:
        rows = s.query(db.Clip).count()
    return rows, len(list(db.AUDIO_DIR.iterdir())), len(list(db.FEATURES_DIR.iterdir()))


def test_WORK_001_upload_runs_in_a_separate_long_lived_process(worker_app, audio_factory):
    """The app starts one worker at startup; uploads are analysed there (not
    in the web process), the same worker serves the next clip, and the clip
    is stored and owned exactly as in-process."""
    c, main, db = worker_app
    assert len(main._workers) == main.MAX_CONCURRENT_EXTRACTIONS == 1
    pid = main._workers[0].pid
    assert pid and pid != os.getpid() and _alive(pid)

    first = _upload(c, audio_factory)
    assert first.status_code == 200, first.text
    data = first.json()
    assert data["features"] and data["spectrogram"]
    assert data["audio_url"] == f"/audio/{data['id']}.opus"
    assert _upload(c, audio_factory, 500.0).status_code == 200
    assert main._workers[0].pid == pid               # reused, not respawned

    assert [r["id"] for r in c.get("/history").json()][-1] == data["id"]
    with db.SessionLocal() as s:
        assert s.get(db.Clip, data["id"]).owner_id == c.cookies["echo_vid"]
    assert c.get(data["audio_url"]).status_code == 200


def test_WORK_002_bad_file_is_the_same_422_across_the_process_boundary(worker_app, audio_factory):
    c, main, db = worker_app
    pid = main._workers[0].pid
    res = c.post("/upload", files={"file": ("junk.bin", audio_factory.junk_bytes(), "application/octet-stream")})
    assert res.status_code == 422
    assert res.json() == {"detail": "Could not read audio — unsupported or corrupt file."}
    assert main._workers[0].pid == pid               # a bad file doesn't cost the worker
    assert _leftovers(db) == (0, 0, 0)


def test_WORK_003_overrunning_job_is_killed_and_the_worker_replaced(worker_app, audio_factory, monkeypatch):
    """A job past ANALYSIS_TIMEOUT_S: the worker process is killed (SIGKILL,
    it could be stuck in native code), the visitor gets a clear 422, nothing
    is left on disk or in the DB, and the next upload gets a fresh worker."""
    c, main, db = worker_app
    assert main.ANALYSIS_TIMEOUT_S == 60.0
    old = main._workers[0].pid
    monkeypatch.setattr(main, "ANALYSIS_TIMEOUT_S", 0.05)  # the worker is still warming up
    res = _upload(c, audio_factory)
    assert res.status_code == 422
    assert res.json() == {"detail": main.TOO_SLOW_MESSAGE}
    assert _wait_dead(old)
    assert _leftovers(db) == (0, 0, 0)

    monkeypatch.setattr(main, "ANALYSIS_TIMEOUT_S", 60.0)
    assert _upload(c, audio_factory, 500.0).status_code == 200
    new = main._workers[0].pid
    assert new and new != old and _alive(new)


def test_WORK_004_worker_dying_mid_job_is_a_500_and_it_recovers(worker_app, audio_factory):
    """If the worker dies while it has a job (a crash in an audio library, the
    OOM killer), the site stays up: that upload gets a plain 500, nothing is
    left behind, and the next upload works on a new worker."""
    c, main, db = worker_app
    old = main._workers[0].pid
    out = {}
    t = threading.Thread(target=lambda: out.update(res=_upload(c, audio_factory)))
    t.start()
    time.sleep(0.3)            # the job is in the pipe; the worker is warming up
    os.kill(old, signal.SIGKILL)
    t.join(30)
    assert out["res"].status_code == 500
    assert out["res"].json() == {"detail": main.CRASHED_MESSAGE}
    assert c.get("/api/health").status_code == 200
    assert _leftovers(db) == (0, 0, 0)

    assert _upload(c, audio_factory, 500.0).status_code == 200
    assert main._workers[0].pid != old


def test_WORK_005_worker_stops_with_the_app(tmp_path, monkeypatch, audio_factory):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("ECHO_ANALYSIS_MODE", "process")
    main = _reload_backend(tmp_path / "data", monkeypatch)
    with TestClient(main.app, base_url=TEST_BASE_URL):
        pid = main._workers[0].pid
        assert _alive(pid)
    assert _wait_dead(pid)


def test_WORK_006_process_mode_is_the_default(tmp_path):
    """With no ECHO_ANALYSIS_MODE set (production), analysis runs in the
    worker process; only the explicit value "thread" opts out."""
    env = {k: v for k, v in os.environ.items() if k != "ECHO_ANALYSIS_MODE"}
    env["ECHO_DATA_DIR"] = str(tmp_path / "d")
    code = "import main; print(main.ANALYSIS_MODE)"
    run = lambda e: subprocess.run([sys.executable, "-W", "ignore", "-c", code], cwd=ROOT,
                                   env=e, capture_output=True, text=True, timeout=120).stdout.strip()
    assert run(env) == "process"
    assert run({**env, "ECHO_ANALYSIS_MODE": "anything-else"}) == "process"
    assert run({**env, "ECHO_ANALYSIS_MODE": "thread"}) == "thread"
