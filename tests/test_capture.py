"""CAP-* tests: the Pi mic capture guards (LEARNINGS.md "Pi mic capture hang").

A capture once left the browser waiting for minutes with nothing in the log.
These cover what was added so that can't happen silently again: rec is killed
(with everything it started) when it overruns; each failure has a clear
message and a machine-readable reason; the duration can come from the URL so
the request needs no body; and every /capture request leaves a timeline in
the log with no IP address, visitor ID or token in it.

Never the real ~/bin/rec or the real mic: throwaway stub scripts only.
"""

from __future__ import annotations

import logging
import os
import time

import pytest

import main as main_module


def _alive(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


def test_CAP_001_duration_from_the_url_needs_no_body(signed_in, monkeypatch, rec_stub):
    """POST /capture?duration=2 with no body at all records (what the app
    sends); the JSON body form still works; the URL wins if both are given;
    out-of-range values are refused either way."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    seen = []
    real = main_module._run_rec
    monkeypatch.setattr(main_module, "_run_rec",
                        lambda cmd, t: seen.append((cmd[-1], t)) or real(cmd, t))

    res = signed_in.post("/capture?duration=2")
    assert res.status_code == 200 and res.json()["features"]
    assert res.request.headers.get("content-length", "0") == "0"
    assert signed_in.post("/capture", json={"duration": 3}).status_code == 200
    assert signed_in.post("/capture?duration=4", json={"duration": 9}).status_code == 200
    assert signed_in.post("/capture").status_code == 200           # default 5 s
    assert [s for s, _ in seen] == ["2", "3", "4", "5"]

    assert signed_in.post("/capture?duration=61").status_code == 422
    assert signed_in.post("/capture?duration=0").status_code == 422
    assert signed_in.post("/capture?duration=abc").status_code == 422


def test_CAP_002_rec_gets_the_recording_time_plus_ten_seconds(signed_in, monkeypatch, rec_stub):
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    limits = []
    real = main_module._run_rec
    monkeypatch.setattr(main_module, "_run_rec",
                        lambda cmd, t: limits.append(t) or real(cmd, t))
    assert main_module.REC_GRACE_S == 10
    assert signed_in.post("/capture?duration=7").status_code == 200
    assert limits == [17]


def test_CAP_003_overrunning_rec_is_killed_with_everything_it_started(signed_in, monkeypatch, rec_stub, tmp_path):
    """A rec that never finishes: after duration + grace the script AND the
    process it started are killed (the real wrapper is a shell script that
    starts arecord; killing only the script would leave the mic held), and the
    answer is a clear 504, well inside the time the request was given."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("hang")))
    monkeypatch.setattr(main_module, "REC_GRACE_S", 0.5)
    t0 = time.monotonic()
    res = signed_in.post("/capture?duration=1")
    took = time.monotonic() - t0
    assert res.status_code == 504
    assert res.json()["detail"].startswith("The Pi mic didn\'t finish a 1 s recording")
    assert "so it was stopped" in res.json()["detail"]
    assert res.headers["x-echo-error"] == "mic_timeout"
    assert took < 8

    child = int((tmp_path / "hang_child.pid").read_text())
    deadline = time.monotonic() + 5
    while _alive(child) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive(child), "the process rec started must not outlive the kill"

    # The mic route still works afterwards.
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    assert signed_in.post("/capture?duration=2").status_code == 200


@pytest.mark.parametrize("behavior,code,words", [
    ("busy", "mic_busy", "The Pi mic is busy"),
    ("fail", "mic_not_found", "couldn\'t open its mic"),
    ("empty", "mic_failed", "Mic capture failed"),
])
def test_CAP_004_each_mic_failure_has_a_message_and_a_reason(signed_in, monkeypatch, rec_stub, behavior, code, words):
    """Busy mic, mic that can\'t be opened (unplugged / card number changed)
    and a recording with no audio are each a 503 with a plain message and an
    X-Echo-Error reason the app turns into a specific notice. Reported, never
    retried or worked around (CLAUDE.md)."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub(behavior)))
    calls = []
    real = main_module._run_rec
    monkeypatch.setattr(main_module, "_run_rec", lambda c, t: calls.append(1) or real(c, t))
    res = signed_in.post("/capture?duration=2")
    assert res.status_code == 503
    assert words in res.json()["detail"]
    assert res.headers["x-echo-error"] == code
    assert len(calls) == 1


def test_CAP_005_wrapper_missing_is_mic_not_found(signed_in, monkeypatch):
    monkeypatch.setattr(main_module, "REC_WRAPPER", "/definitely/not/here/rec")
    res = signed_in.post("/capture?duration=2")
    assert res.status_code == 503 and res.headers["x-echo-error"] == "mic_not_found"


def test_CAP_006_every_capture_leaves_a_timeline_with_nothing_personal(signed_in, monkeypatch, rec_stub, caplog, access_gate):
    """Request received -> body complete -> rec started -> rec ended ->
    analysis -> response sent -> response complete, each with seconds since
    the headers arrived. No IP address, visitor ID, cookie or token."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    with caplog.at_level(logging.INFO, logger="echo.capture"):
        res = signed_in.post("/capture?duration=2")
    assert res.status_code == 200
    lines = [r.getMessage() for r in caplog.records if r.name == "echo.capture"]
    steps = ["request received: POST", "request body complete (0 bytes)", "rec started (2 s, limit 12 s)",
             "rec ended (exit 0,", "analysis started", "analysis finished",
             "response 200 sent", "response complete"]
    positions = [next(i for i, l in enumerate(lines) if s in l) for s in steps]
    assert positions == sorted(positions), lines
    ids = {l.split()[1] for l in lines}
    assert len(ids) == 1 and len(ids.pop()) == 6          # one random ID per request
    assert all(l.split()[2].startswith("+") and l.split()[2].endswith("s") for l in lines)
    first = lines[positions[0]]
    assert "access header present" in first and "content-length=" in first and "query=yes" in first

    text = "\n".join(lines)
    assert signed_in.cookies["echo_vid"] not in text
    assert signed_in.headers["Cf-Access-Jwt-Assertion"] not in text
    assert "testclient" not in text and "127.0.0.1" not in text


def test_CAP_007_refused_and_failed_captures_are_logged_too(client, signed_in, monkeypatch, rec_stub, caplog):
    """A capture with no token (404), and one whose rec is killed, both leave
    their own timeline; other routes leave none."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("hang")))
    monkeypatch.setattr(main_module, "REC_GRACE_S", 0.3)
    with caplog.at_level(logging.INFO, logger="echo.capture"):
        token = signed_in.headers.pop("Cf-Access-Jwt-Assertion")
        assert signed_in.post("/capture?duration=1").status_code == 404
        signed_in.headers["Cf-Access-Jwt-Assertion"] = token
        assert signed_in.post("/capture?duration=1").status_code == 504
        signed_in.get("/history")
        signed_in.get("/api/me")
    lines = [r.getMessage() for r in caplog.records if r.name == "echo.capture"]
    assert any("access header absent" in l for l in lines)
    assert any("response 404 sent" in l for l in lines)
    assert any("rec killed: ran past its limit" in l for l in lines)
    assert any("response 504 sent" in l for l in lines)
    assert len({l.split()[1] for l in lines}) == 2
    assert not any("/history" in l or "/api/me" in l for l in lines)
