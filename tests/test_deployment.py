"""HW-* tests: real hardware, live systemd service, and public-tunnel checks.

Every test in this file is opt-in only (pytest markers: hardware,
requires_sudo, tunnel) and is EXCLUDED from a default `pytest` run by
pyproject.toml's addopts. None of them spin up the isolated sandboxed app
from conftest.py — they talk to the REAL, already-running `echo` service
(on the Pi, via localhost or the public tunnel), because that's the thing
being verified.

Run only when Job is present to babysit:
    pytest -m hardware          # HW-001 (real Pi USB mic via ~/bin/rec)
    pytest -m requires_sudo     # HW-003, HW-004 (restarts the LIVE service)
    pytest -m tunnel            # HW-005, HW-006 (public URL; HW-006 writes
                                 # one real clip to production history)
    pytest -m "hardware or requires_sudo or tunnel"

Never modifies ~/bin/rec or ~/.asoundrc, never calls arecord directly, never
uses a sudo command outside CLAUDE.md's 8-command allowlist, and never runs
`sudo -n systemctl status` (not allowlisted — see LEARNINGS.md). See
TEST_PLAN.md section G.
"""

from __future__ import annotations

import os
import subprocess
import time

import httpx
import pytest

LIVE_BASE_URL = os.environ.get("ECHO_LIVE_BASE_URL", "http://127.0.0.1:8014")
PUBLIC_BASE_URL = os.environ.get("ECHO_PUBLIC_BASE_URL", "https://echo.job-joseph.com")


def _wait_for_health(base_url: str, timeout_s: float = 30.0) -> bool:
    """Poll GET /api/health until it returns 200 or the timeout elapses."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url}/api/health", timeout=3.0)
            if r.status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(1.0)
    return False


@pytest.mark.hardware
def test_HW_001_real_pi_mic_capture():
    """POST /capture against the LIVE service on the real Pi, using the
    real ~/bin/rec exactly as the app does — never modified, never bypassed
    to arecord (CLAUDE.md hardware rules).

    If this fails with "audio open error" (ALSA card shift), that is Job's
    fix per CLAUDE.md — this test asserts-and-surfaces the failure, it does
    NOT retry or attempt any workaround.
    """
    res = httpx.post(f"{LIVE_BASE_URL}/capture", json={"duration": 3}, timeout=30.0)
    assert res.status_code == 200, (
        f"capture failed ({res.status_code}): {res.text[:300]} — "
        "if this is an ALSA card-shift ('audio open error'), that's Job's "
        "fix per CLAUDE.md; do not attempt to work around it here"
    )
    data = res.json()
    assert data["features"]
    assert data["duration_s"] == pytest.approx(3.0, abs=1.0)

    hist = httpx.get(f"{LIVE_BASE_URL}/history", timeout=10.0).json()
    assert any(r["id"] == data["id"] and r["source_type"] == "pi_mic" for r in hist)


@pytest.mark.requires_sudo
def test_HW_003_systemd_restart_recovery():
    """sudo -n systemctl restart echo (in the allowlist), then poll
    GET /api/health until it recovers, then confirm /history still returns
    data. Status checks use plain `systemctl is-active echo` — NEVER
    `sudo -n systemctl status` (LEARNINGS.md: not allowlisted, would hang an
    unattended run).

    Restarts the LIVE service — babysat runs only.
    """
    proc = subprocess.run(["sudo", "-n", "systemctl", "restart", "echo"],
                           capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"restart failed: {proc.stderr}"

    assert _wait_for_health(LIVE_BASE_URL, timeout_s=30.0), "service did not become healthy after restart"

    active = subprocess.run(["systemctl", "is-active", "echo"],
                             capture_output=True, text=True, timeout=10)
    assert active.stdout.strip() == "active"

    hist = httpx.get(f"{LIVE_BASE_URL}/history", timeout=10.0)
    assert hist.status_code == 200


@pytest.mark.requires_sudo
def test_HW_004_systemd_stop_start_cycle():
    """sudo -n systemctl stop echo -> port stops answering -> sudo -n
    systemctl start echo -> health returns. Confirms the unit file survives
    a cold start, not just a restart.

    Restarts the LIVE service — babysat runs only.
    """
    stop = subprocess.run(["sudo", "-n", "systemctl", "stop", "echo"],
                           capture_output=True, text=True, timeout=30)
    assert stop.returncode == 0, f"stop failed: {stop.stderr}"

    time.sleep(2.0)
    stopped = False
    try:
        httpx.get(f"{LIVE_BASE_URL}/api/health", timeout=3.0)
    except httpx.HTTPError:
        stopped = True
    assert stopped, "service still answering after systemctl stop"

    start = subprocess.run(["sudo", "-n", "systemctl", "start", "echo"],
                            capture_output=True, text=True, timeout=30)
    assert start.returncode == 0, f"start failed: {start.stderr}"

    assert _wait_for_health(LIVE_BASE_URL, timeout_s=30.0), "service did not come up after cold start"

    active = subprocess.run(["systemctl", "is-active", "echo"],
                             capture_output=True, text=True, timeout=10)
    assert active.stdout.strip() == "active"


@pytest.mark.tunnel
def test_HW_005_public_smoke():
    """Read-only public smoke test: GET https://echo.job-joseph.com/history
    -> 200 JSON; / -> 200 containing <title>Echo; /samples -> the 3
    samples. Writes nothing.

    SPEC.md deployment: "Done when curl https://echo.job-joseph.com/history
    returns real data."
    """
    hist = httpx.get(f"{PUBLIC_BASE_URL}/history", timeout=15.0)
    assert hist.status_code == 200
    assert isinstance(hist.json(), list)

    root = httpx.get(f"{PUBLIC_BASE_URL}/", timeout=15.0)
    assert root.status_code == 200
    assert "<title>Echo" in root.text

    samples_res = httpx.get(f"{PUBLIC_BASE_URL}/samples", timeout=15.0)
    assert samples_res.status_code == 200
    assert len(samples_res.json()) == 3


@pytest.mark.tunnel
def test_HW_006_public_upload_within_edge_budget(audio_factory):
    """POST a ~20s fixture clip to the public /upload, asserting a 200
    response well under Cloudflare's ~100s edge timeout (guards the
    Cloudflare-524 regression the pyin speed fix bought margin against).

    Side effect (accepted by Job, 2026-07-18, per TEST_PLAN.md): adds one
    real clip to production history; it ages out via the normal 50-entry
    retention rule, the same accepted side effect as Session 5's checks.

    LEARNINGS.md: "Cloudflare's edge enforces a ~100s origin-response limit
    (HTTP 524) on the free plan, and it is not configurable."
    """
    path = audio_factory.tone(duration=20.0, freq=600.0, amp=0.5, name="public_edge_check")
    start = time.monotonic()
    with open(path, "rb") as f:
        res = httpx.post(f"{PUBLIC_BASE_URL}/upload",
                          files={"file": ("edge_check.wav", f, "audio/wav")},
                          timeout=95.0)
    elapsed = time.monotonic() - start

    assert res.status_code == 200, f"public upload failed ({res.status_code}): {res.text[:300]}"
    assert elapsed < 90.0, f"round-trip took {elapsed:.1f}s — too close to the ~100s edge limit"
    assert res.json()["features"]
