"""CAP-010… tests: cancel / stop a running Pi-mic capture (DELETE /capture).

One mic, so one capture at a time, tracked by the server. Cancel kills the
recording and saves nothing; stop ends it early and keeps what was recorded.
Both must be safe at any moment: with nothing running, twice, or just as the
recording finishes. Never a stuck mic, a half-written clip or a false "busy".

The "mic" here is a stub script (conftest rec_stub("mic")) that holds a kernel
file lock while it records, the way the real device is held, and answers
SIGINT the way arecord does. Never the real ~/bin/rec.
"""

from __future__ import annotations

import os
import threading
import time

import pytest

import main as main_module


def _alive(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


class Running:
    """A POST /capture running in a thread, so the test can act meanwhile."""

    def __init__(self, client, seconds, tmp_path, wait_for_mic=True):
        self.out = {}
        self.pidfile = tmp_path / "mic.pid"
        if self.pidfile.exists():
            self.pidfile.unlink()
        self.thread = threading.Thread(
            target=lambda: self.out.update(res=client.post(f"/capture?duration={seconds}")))
        self.thread.start()
        if wait_for_mic:
            deadline = time.monotonic() + 10
            while not self.pidfile.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            assert self.pidfile.exists(), "the stub mic never started"
            time.sleep(0.15)

    @property
    def pid(self):
        return int(self.pidfile.read_text())

    def result(self, timeout=30):
        self.thread.join(timeout)
        assert not self.thread.is_alive(), "POST /capture never answered"
        return self.out["res"]


@pytest.fixture
def mic(signed_in, monkeypatch, rec_stub, tmp_path, isolated_backend):
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("mic")))
    _main, db, _storage = isolated_backend
    return signed_in, db, tmp_path


def _stored(db):
    with db.SessionLocal() as s:
        rows = s.query(db.Clip).count()
    return rows, len(list(db.AUDIO_DIR.iterdir())), len(list(db.FEATURES_DIR.iterdir()))


def _idle():
    return main_module._capture is None


def test_CAP_010_cancel_mid_recording_frees_the_mic_and_saves_nothing(mic):
    """Cancel during a 20 s recording: the capture answers at once with
    {"cancelled": true}, the recorder is dead, no clip or file exists, and a
    new capture started straight after works (no false "busy")."""
    c, db, tmp = mic
    run = Running(c, 20, tmp)
    pid = run.pid
    t0 = time.monotonic()
    res = c.delete("/capture?action=cancel")
    assert res.status_code == 200 and res.json() == {"active": True, "action": "cancel"}

    # Immediately, with no pause: the mic must already be free.
    again = c.post("/capture?duration=1")
    assert again.status_code == 200 and again.json()["features"], again.text

    first = run.result()
    assert first.status_code == 200
    assert first.json() == {"cancelled": True, "reason": "cancelled"}
    assert time.monotonic() - t0 < 10          # nowhere near the 20 s it asked for
    assert not _alive(pid)
    assert _stored(db) == (1, 1, 1)            # only the second capture's clip
    assert [r["id"] for r in c.get("/history").json()] == [again.json()["id"]]
    assert _idle()


def test_CAP_011_cancel_with_nothing_running_is_a_harmless_no_op(mic):
    c, db, tmp = mic
    for action in ("cancel", "stop"):
        res = c.delete(f"/capture?action={action}")
        assert res.status_code == 200 and res.json() == {"active": False, "action": None}
    assert c.delete("/capture").json() == {"active": False, "action": None}   # default = cancel
    assert _stored(db) == (0, 0, 0) and _idle()
    assert c.post("/capture?duration=1").status_code == 200                   # and nothing is stuck


def test_CAP_012_stop_keeps_what_was_recorded(mic):
    """Stop during a 20 s recording: the recorder is interrupted (SIGINT), the
    shorter recording it leaves is analysed and saved as a normal clip."""
    c, db, tmp = mic
    run = Running(c, 20, tmp)
    t0 = time.monotonic()
    res = c.delete("/capture?action=stop")
    assert res.json() == {"active": True, "action": "stop"}
    clip = run.result()
    assert clip.status_code == 200, clip.text
    data = clip.json()
    assert "cancelled" not in data and data["features"]
    assert data["duration_s"] == pytest.approx(1.5, abs=0.2)     # the interrupted take, not 20 s
    assert time.monotonic() - t0 < 10
    assert not _alive(run.pid)
    assert _stored(db) == (1, 1, 1)
    row = c.get("/history").json()[0]
    assert (row["id"], row["source_type"]) == (data["id"], "pi_mic")
    assert _idle()


def test_CAP_013_stop_too_early_saves_nothing(mic):
    """Stopped with under a second recorded: treated as a cancel, with a
    reason, rather than analysing a sliver."""
    c, db, tmp = mic
    (tmp / "mic.tiny").write_text("1")
    run = Running(c, 20, tmp)
    assert c.delete("/capture?action=stop").json()["action"] == "stop"
    res = run.result()
    assert res.status_code == 200 and res.json() == {"cancelled": True, "reason": "too_short"}
    assert _stored(db) == (0, 0, 0) and _idle()
    assert c.post("/capture?duration=1").status_code == 200


def test_CAP_014_a_second_cancel_or_stop_changes_nothing(mic):
    c, db, tmp = mic
    run = Running(c, 20, tmp)
    assert c.delete("/capture?action=stop").json() == {"active": True, "action": "stop"}
    # While the stopped take is still being handled: both repeats are no-ops.
    repeats = [c.delete("/capture?action=stop").json(), c.delete("/capture?action=cancel").json()]
    clip = run.result()
    assert all(r["action"] is None for r in repeats)
    assert clip.status_code == 200 and clip.json()["features"]     # the stop still stood
    assert _stored(db) == (1, 1, 1) and _idle()

    run = Running(c, 20, tmp)
    assert c.delete("/capture").json()["action"] == "cancel"
    assert c.delete("/capture").json() == {"active": False, "action": None}
    assert c.delete("/capture?action=stop").json() == {"active": False, "action": None}
    assert run.result().json()["cancelled"] is True
    assert _stored(db) == (1, 1, 1) and _idle()


def test_CAP_015_stop_or_cancel_after_the_recording_has_finished(mic, monkeypatch, isolated_backend):
    """Arriving during the analysis, when rec has already exited: stop does
    nothing and the clip is saved; cancel throws the clip away, and the mic is
    available to a new capture at once."""
    c, db, tmp = mic
    _main, _db, storage = isolated_backend
    analysing, release = threading.Event(), threading.Event()
    real = storage.process_audio

    def slow(*a, **k):
        analysing.set()
        assert release.wait(20)
        return real(*a, **k)
    monkeypatch.setattr(main_module, "process_audio", slow)

    run = Running(c, 1, tmp)
    assert analysing.wait(10)
    assert c.delete("/capture?action=stop").json() == {"active": True, "action": None}
    release.set()
    saved = run.result()
    assert saved.status_code == 200 and saved.json()["features"]
    assert _stored(db) == (1, 1, 1)

    analysing.clear(); release.clear()
    run = Running(c, 1, tmp)
    assert analysing.wait(10)
    assert c.delete("/capture?action=cancel").json() == {"active": True, "action": "cancel"}
    assert _idle()                               # the mic is handed on straight away
    monkeypatch.setattr(main_module, "process_audio", real)
    release.set()
    gone = run.result()
    assert gone.status_code == 200 and gone.json() == {"cancelled": True, "reason": "cancelled"}
    assert _stored(db) == (1, 1, 1)              # still only the first clip
    assert c.post("/capture?duration=1").status_code == 200


def test_CAP_016_cancel_before_the_recorder_has_started(mic, monkeypatch):
    """A cancel that lands before rec exists means rec never runs."""
    c, db, tmp = mic
    gate, real = threading.Event(), main_module._run_rec

    def held(cmd, t):
        assert gate.wait(10)
        return real(cmd, t)
    monkeypatch.setattr(main_module, "_run_rec", held)
    run = Running(c, 20, tmp, wait_for_mic=False)
    deadline = time.monotonic() + 5
    while _idle() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert c.delete("/capture").json() == {"active": True, "action": "cancel"}
    gate.set()
    res = run.result()
    assert res.json() == {"cancelled": True, "reason": "cancelled"}
    assert not (tmp / "mic.pid").exists()        # the mic was never opened
    assert _stored(db) == (0, 0, 0) and _idle()


def test_CAP_017_cancel_and_stop_racing_the_end_of_the_recording(mic):
    """Fire stop/cancel at every offset around the moment a 1 s recording
    ends. Whatever wins, the capture answers, the server is idle afterwards,
    no recorder is left running, files and rows agree, and the next capture
    is never told the mic is busy."""
    c, db, tmp = mic
    outcomes = set()
    for i, action in enumerate(["cancel", "stop"] * 9):
        run = Running(c, 1, tmp)
        time.sleep(max(0.0, 0.55 + 0.04 * (i // 2)))       # 0.70 s … 1.02 s after the mic opened
        fired = [c.delete(f"/capture?action={action}").json()]
        fired.append(c.delete(f"/capture?action={action}").json())   # and a duplicate
        res = run.result()
        assert res.status_code == 200, res.text
        body = res.json()
        outcomes.add("cancelled" if body.get("cancelled") else "clip")
        assert fired[1]["action"] is None
        assert not _alive(run.pid)
        assert _idle()
        rows, audio, feats = _stored(db)
        assert rows == audio == feats
        nxt = c.post("/capture?duration=1")
        assert nxt.status_code == 200, nxt.text            # never a false "busy"
        for row in c.get("/history").json():
            assert c.delete(f"/history/{row['id']}").status_code == 204
    assert outcomes == {"cancelled", "clip"}               # both sides of the race were hit
    assert _stored(db) == (0, 0, 0)
    assert not list(tmp.glob("echo_cap_*"))


def test_CAP_018_only_one_capture_at_a_time(mic):
    """A second capture while one is running is refused at once with the
    "busy" reason, and the first one is unaffected."""
    c, db, tmp = mic
    run = Running(c, 2, tmp)
    t0 = time.monotonic()
    second = c.post("/capture?duration=1")
    assert second.status_code == 503 and time.monotonic() - t0 < 1
    assert second.headers["x-echo-error"] == "mic_busy"
    assert "already running" in second.json()["detail"]
    first = run.result()
    assert first.status_code == 200 and first.json()["features"]
    assert _stored(db) == (1, 1, 1) and _idle()


def test_CAP_019_cancel_is_owner_only_and_takes_its_action_from_the_url(mic, client):
    c, db, tmp = mic
    run = Running(c, 3, tmp)
    token = c.headers.pop("Cf-Access-Jwt-Assertion")
    try:
        refused = c.delete("/capture?action=cancel")
        assert refused.status_code == 404 and refused.json() == {"detail": "Not Found"}
    finally:
        c.headers["Cf-Access-Jwt-Assertion"] = token
    assert c.delete("/capture?action=explode").status_code == 422
    assert _alive(run.pid)                       # neither of those touched the recording
    assert run.result().json()["features"]


def test_CAP_020_cancel_and_stop_are_in_the_trace(mic, caplog):
    import logging
    c, db, tmp = mic
    with caplog.at_level(logging.INFO, logger="echo.capture"):
        run = Running(c, 20, tmp)
        c.delete("/capture?action=cancel")
        run.result()
        c.delete("/capture?action=stop")
    lines = [r.getMessage() for r in caplog.records if r.name == "echo.capture"]
    assert any("request received: DELETE" in l for l in lines)
    assert any("cancel: recording killed" in l for l in lines)
    assert any("owner asked to cancel" in l for l in lines)
    assert any("stop: nothing is running" in l for l in lines)
    assert c.cookies["echo_vid"] not in "\n".join(lines)
