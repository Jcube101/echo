"""API-* integration tests for main.py's FastAPI surface.

Fully sandboxed: FastAPI TestClient against an isolated app (temp data dir +
temp SQLite, via the isolated_backend/client fixtures), synthetic fixture
audio, real ffmpeg. /capture is tested via a throwaway stub script
monkeypatched into main.REC_WRAPPER — the real ~/bin/rec is never read,
modified, or invoked. See TEST_PLAN.md section C.
"""

from __future__ import annotations

import inspect
import subprocess

import pytest

import main as main_module


def test_API_001_upload_happy_path(client, audio_factory):
    """POST /upload happy path: 200 with {id, features, spectrogram,
    duration_s, audio_url}; features pass the world-box/amplitude gates;
    audio_url points at /audio/{id}.opus.

    SPEC.md: "POST /upload | Accepts an audio file … Runs extraction, saves
    a history row + a transcoded playback copy, returns {id, features}."
    """
    path = audio_factory.tone(duration=1.5, freq=440.0, amp=0.5)
    with open(path, "rb") as f:
        res = client.post("/upload", files={"file": ("clip.wav", f, "audio/wav")})
    assert res.status_code == 200
    data = res.json()
    assert {"id", "features", "spectrogram", "duration_s", "audio_url"} <= set(data)
    assert data["audio_url"] == f"/audio/{data['id']}.opus"

    feats = data["features"]
    assert feats
    for axis in ("pitch", "timbre", "motion"):
        vals = [f[axis] for f in feats]
        assert min(vals) >= -3 - 1e-6 and max(vals) <= 3 + 1e-6
    amps = [f["amplitude"] for f in feats]
    assert min(amps) >= 0.0 and max(amps) <= 1.0


def test_API_002_upload_20mb_limit(client, audio_factory):
    """A 21 MB body returns 413 with the "20 MB limit" detail. The cap is
    enforced by counting bytes as they're streamed to disk chunk-by-chunk
    (see main.upload's source), not by reading any client-supplied
    Content-Length header — TestClient's in-process transport can't easily
    misrepresent Content-Length to prove this dynamically, so the source is
    checked directly for the streaming-read pattern and the absence of any
    header-based size check.

    CLAUDE.md locked: "Max upload size | 20 MB (server-side enforced, clear
    error beyond it)." VERIFICATION_LOG Phase 2: "size enforced by streaming
    to disk with a hard cap, not trusting Content-Length."
    """
    big = audio_factory.raw_bytes_of(21 * 1024 * 1024)
    res = client.post("/upload", files={"file": ("big.wav", big, "audio/wav")})
    assert res.status_code == 413
    assert "20 MB" in res.json()["detail"]

    src = inspect.getsource(main_module.upload)
    assert "MAX_UPLOAD_BYTES" in src
    assert "while chunk := await file.read(" in src, "expected the chunked-read streaming pattern"
    assert "headers[" not in src and "headers.get(" not in src, "size check must not read any request header"


def test_API_003_upload_empty_file(client):
    """An empty upload returns 400 "Empty upload."."""
    res = client.post("/upload", files={"file": ("empty.wav", b"", "audio/wav")})
    assert res.status_code == 400
    assert "Empty upload" in res.json()["detail"]


def test_API_004_upload_undecodable_junk(client, audio_factory):
    """Undecodable junk bytes return 422 "Could not read audio…".

    VERIFICATION_LOG Phase 2: "Undecodable junk → HTTP 422."
    """
    junk = audio_factory.junk_bytes()
    res = client.post("/upload", files={"file": ("junk.bin", junk, "application/octet-stream")})
    assert res.status_code == 422
    assert "Could not read audio" in res.json()["detail"]


def test_API_005_upload_60s_limit(client, audio_factory):
    """A 61s clip is rejected (422); a 60.3s clip (within the container-
    rounding tolerance) is accepted with duration_s truncated to 60.0.

    CLAUDE.md locked: "Max clip duration | 60 seconds (all input paths)."
    """
    long_path = audio_factory.tone(duration=61.0, freq=300.0, amp=0.4, name="toolong")
    with open(long_path, "rb") as f:
        res = client.post("/upload", files={"file": ("long.wav", f, "audio/wav")})
    assert res.status_code == 422

    ok_path = audio_factory.tone(duration=60.3, freq=300.0, amp=0.4, name="ok60")
    with open(ok_path, "rb") as f:
        res2 = client.post("/upload", files={"file": ("ok.wav", f, "audio/wav")})
    assert res2.status_code == 200
    assert res2.json()["duration_s"] == pytest.approx(60.0, abs=0.05)


def test_API_006_upload_video_extracts_audio_track(client, audio_factory, tmp_path):
    """A video file with an audio track is accepted — ffmpeg's `-vn` in
    storage.py extracts just the audio.

    SPEC.md: "or a video whose audio is extracted with ffmpeg first."
    """
    wav = audio_factory.tone(duration=1.5, freq=440.0, amp=0.5)
    video = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1.5",
         "-i", str(wav), "-shortest",
         "-c:v", "libx264", "-c:a", "aac", str(video)],
        check=True, timeout=30,
    )
    with open(video, "rb") as f:
        res = client.post("/upload", files={"file": ("clip.mp4", f, "video/mp4")})
    assert res.status_code == 200
    assert res.json()["features"]


def test_API_007_history_list_shape_and_order(client, audio_factory):
    """GET /history: rows newest-first, each exactly {id, created_at,
    source_type, duration_s} — no feature payload, no paths leaked.

    SPEC.md: "GET /history | List of {id, created_at, source_type,
    duration_s}, newest first."
    """
    ids = []
    for i in range(2):
        path = audio_factory.tone(duration=0.6, freq=400 + i * 20, amp=0.5, name=f"h{i}")
        with open(path, "rb") as f:
            res = client.post("/upload", files={"file": (f"h{i}.wav", f, "audio/wav")})
        ids.append(res.json()["id"])

    hist = client.get("/history")
    assert hist.status_code == 200
    rows = hist.json()
    assert len(rows) == 2
    assert rows[0]["id"] == ids[-1]  # newest first
    for row in rows:
        assert set(row) == {"id", "created_at", "source_type", "duration_s"}


def test_API_008_history_item_full_payload(client, audio_factory):
    """GET /history/{id}: summary keys + features + spectrogram + audio_url.

    SPEC.md: "GET /history/{id} | Full feature JSON + playback audio URL."
    """
    path = audio_factory.tone(duration=0.8, freq=440.0, amp=0.5)
    with open(path, "rb") as f:
        upload_res = client.post("/upload", files={"file": ("x.wav", f, "audio/wav")})
    clip_id = upload_res.json()["id"]

    res = client.get(f"/history/{clip_id}")
    assert res.status_code == 200
    data = res.json()
    assert set(data) == {"id", "created_at", "source_type", "duration_s", "features", "spectrogram", "audio_url"}
    assert data["audio_url"] == f"/audio/{clip_id}.opus"
    assert data["features"]


def test_API_009_history_item_not_found(client):
    """GET /history/{unknown} -> 404 "Clip not found."."""
    res = client.get("/history/does-not-exist")
    assert res.status_code == 404
    assert "Clip not found" in res.json()["detail"]


def test_API_010_history_item_features_gone(client, audio_factory):
    """GET /history/{id} whose feature file was deleted on disk -> 410
    "Clip features gone."."""
    import db
    path = audio_factory.tone(duration=0.6, freq=440.0, amp=0.5)
    with open(path, "rb") as f:
        upload_res = client.post("/upload", files={"file": ("x.wav", f, "audio/wav")})
    clip_id = upload_res.json()["id"]

    (db.FEATURES_DIR / f"{clip_id}.json").unlink()
    res = client.get(f"/history/{clip_id}")
    assert res.status_code == 410
    assert "Clip features gone" in res.json()["detail"]


def test_API_011_history_item_backward_compat_plain_array(client, audio_factory):
    """A feature file stored as a plain JSON array (pre-spectrogram era) is
    served with features populated and spectrogram: null.

    LEARNINGS.md: "Backward-compat: /history/{id} still reads the older
    plain-array files (spectrogram = null)."
    """
    import db
    import json
    path = audio_factory.tone(duration=0.6, freq=440.0, amp=0.5)
    with open(path, "rb") as f:
        upload_res = client.post("/upload", files={"file": ("x.wav", f, "audio/wav")})
    clip_id = upload_res.json()["id"]
    feats = upload_res.json()["features"]

    feat_file = db.FEATURES_DIR / f"{clip_id}.json"
    feat_file.write_text(json.dumps(feats))  # old format: bare array

    res = client.get(f"/history/{clip_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["features"] == feats
    assert data["spectrogram"] is None


def test_API_012_audio_file_serving(client, audio_factory):
    """GET /audio/{file}: 200 audio/ogg for an existing opus; 404 for a
    missing one."""
    path = audio_factory.tone(duration=0.6, freq=440.0, amp=0.5)
    with open(path, "rb") as f:
        upload_res = client.post("/upload", files={"file": ("x.wav", f, "audio/wav")})
    clip_id = upload_res.json()["id"]

    res = client.get(f"/audio/{clip_id}.opus")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/ogg"

    assert client.get("/audio/does-not-exist.opus").status_code == 404


@pytest.mark.parametrize("path", [
    "/audio/..bad",       # literal ".." substring in a single path segment
    "/audio/%2e%2e",      # percent-encoded dot-segment (bypasses URL dot-normalization)
    "/samples/audio/..bad",
    "/samples/audio/%2e%2e",
])
def test_API_013_path_traversal_guard(client, path):
    """Path-traversal attempts on /audio and /samples/audio return 400 "Bad
    filename." — the DB and manifest must never be servable this way.

    (An embedded, unencoded "/" — e.g. foo%2Fbar decoded — can never reach
    this route at all: Starlette's single-segment {filename} path param
    structurally can't match a value containing "/", so those requests 404
    at the routing layer before our guard runs; see the separate assertion
    below for that class.)

    main.py: guards at the /audio and /samples/audio handlers ("/" in
    filename or ".." in filename").
    """
    res = client.get(path)
    assert res.status_code == 400
    assert "Bad filename" in res.json()["detail"]


@pytest.mark.parametrize("path", ["/audio/foo%2Fbar", "/samples/audio/foo%2Fbar"])
def test_API_013b_embedded_slash_never_routes_to_a_200(client, path):
    """A filename containing an embedded slash never reaches a 200 response
    (Starlette's single-segment path param can't match it — a structural
    guard on top of the explicit one in main.py)."""
    res = client.get(path)
    assert res.status_code != 200


def test_API_014_samples_list(client):
    """GET /samples: 3 entries, each with full attribution + metadata, and
    no feature payload or internal file names.

    SPEC.md: "GET /samples | Curated sample library: list with attribution
    + metadata."
    """
    res = client.get("/samples")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 3
    expected_keys = {"id", "species", "sci_name", "recordist", "license",
                      "license_url", "source_url", "xc_id", "duration_s"}
    for item in items:
        assert set(item) == expected_keys
        assert "features" not in item
        assert "audio_file" not in item
        assert "feature_file" not in item


def test_API_015_sample_item(client, monkeypatch):
    """GET /samples/{id}: full payload with features + spectrogram +
    audio_url; unknown id -> 404; a manifest entry whose feature file is
    missing -> 404 (get_sample returns None)."""
    import samples as samples_lib

    listing = client.get("/samples").json()
    sid = listing[0]["id"]
    res = client.get(f"/samples/{sid}")
    assert res.status_code == 200
    data = res.json()
    assert data["features"]
    assert "spectrogram" in data
    assert data["audio_url"].startswith("/samples/audio/")

    assert client.get("/samples/does-not-exist").status_code == 404

    def fake_manifest():
        return [{"id": "ghost", "feature_file": "does-not-exist.json",
                  "audio_file": "does-not-exist.opus"}]
    monkeypatch.setattr(samples_lib, "_load_manifest", fake_manifest)
    assert client.get("/samples/ghost").status_code == 404


def test_API_016_sample_audio_serving(client):
    """GET /samples/audio/{file}: 200 audio/ogg for a committed sample
    opus; 404 for a missing name."""
    import samples as samples_lib
    real_entry = samples_lib._load_manifest()[0]

    res = client.get(f"/samples/audio/{real_entry['audio_file']}")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/ogg"

    assert client.get("/samples/audio/does-not-exist.opus").status_code == 404


def test_API_017_samples_audio_route_precedence(client):
    """GET /samples/audio/{file} is served by the two-segment audio route,
    not matched as sample_item(sample_id="audio") — proven by getting real
    binary audio content-type back, not a JSON 404/payload.

    main.py comment: "Route order: the two-segment /samples/audio/{filename}
    is declared before /samples/{sample_id} so there's no ambiguity."
    """
    import samples as samples_lib
    real_entry = samples_lib._load_manifest()[0]
    res = client.get(f"/samples/audio/{real_entry['audio_file']}")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/ogg"


def test_API_018_staticfiles_never_shadows_api_routes(client_with_frontend):
    """With a fixture frontend/dist present, /history, /samples, and
    /api/health still return JSON (not index.html), while / returns the SPA
    index.html and an asset path serves the file.

    CLAUDE.md standing guardrail: "StaticFiles is mounted last in main.py,
    after all API routes."
    """
    c = client_with_frontend

    for path in ("/history", "/samples", "/api/health"):
        res = c.get(path)
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("application/json")

    root = c.get("/")
    assert root.status_code == 200
    assert "Echo SPA fixture" in root.text

    asset = c.get("/assets/app.js")
    assert asset.status_code == 200
    assert "fixture asset" in asset.text


def test_API_019_health(client):
    """GET /api/health -> {"status": "ok"} (the readiness probe used by the
    hardware-recovery checks)."""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_API_020_capture_wrapper_missing(client, monkeypatch):
    """POST /capture with REC_WRAPPER pointed at a nonexistent path -> 503
    "Pi mic wrapper (~/bin/rec) not found."."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", "/definitely/not/a/real/path/rec")
    res = client.post("/capture", json={"duration": 3})
    assert res.status_code == 503
    assert "rec" in res.json()["detail"]


def test_API_021_capture_happy_path_via_stub(client, monkeypatch, rec_stub):
    """POST /capture via a stub rec script (never the real ~/bin/rec) -> 200,
    full pipeline runs, history row has source_type == "pi_mic".

    SPEC.md: "POST /capture | Body {duration} (≤60). Runs ~/bin/rec, then
    the upload pipeline."
    """
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    res = client.post("/capture", json={"duration": 2})
    assert res.status_code == 200
    data = res.json()
    assert data["features"]

    hist = client.get("/history").json()
    assert any(r["id"] == data["id"] and r["source_type"] == "pi_mic" for r in hist)


def test_API_022_capture_failure_and_timeout(client, monkeypatch, rec_stub):
    """A rec script that exits non-zero surfaces its stderr as a 503 (the
    ALSA card-shift symptom is *reported*, never retried); a rec invocation
    that exceeds its timeout budget surfaces as 504.

    CLAUDE.md: "The mic's ALSA card number can shift across reboots. If rec
    fails … the fix is Job's … report it, don't attempt it." Never invokes
    the real ~/bin/rec.
    """
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("fail")))
    res = client.post("/capture", json={"duration": 2})
    assert res.status_code == 503
    assert "Mic capture failed" in res.json()["detail"]

    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="rec", timeout=kwargs.get("timeout", 0))
    monkeypatch.setattr(main_module.subprocess, "run", fake_run)
    res2 = client.post("/capture", json={"duration": 2})
    assert res2.status_code == 504
    assert "timed out" in res2.json()["detail"].lower()


def test_API_023_capture_duration_validation(client):
    """/capture duration validation: 61 and 0 -> 422 (pydantic gt=0,
    le=MAX_DURATION_S).

    SPEC.md: "Body {duration} (≤60)."
    """
    assert client.post("/capture", json={"duration": 61}).status_code == 422
    assert client.post("/capture", json={"duration": 0}).status_code == 422
