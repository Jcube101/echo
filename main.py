"""Echo — FastAPI app (M2 + M8).

Source-agnostic audio visualizer API. Serves the built frontend last via
StaticFiles so all API routes take precedence.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import AUDIO_DIR, ROOT, Clip, SessionLocal, init_db
from extraction import MAX_DURATION_S
from storage import (MAX_UPLOAD_BYTES, ProcessingError, delete_clip,
                     discard_partial, new_clip_id, process_audio, run_retention)
from analysis_worker import AnalysisCrashed, AnalysisTimeout, AnalysisWorker
import access
import samples as sample_lib
import visitor
from ratelimit import RateLimiter

REC_WRAPPER = os.path.expanduser("~/bin/rec")
# ECHO_FRONTEND_DIST lets tests point the StaticFiles mount at a fixture
# directory instead of the real frontend/dist (test-enablement seam; unset
# in production).
FRONTEND_DIST = (Path(os.environ["ECHO_FRONTEND_DIST"])
                  if os.environ.get("ECHO_FRONTEND_DIST") else ROOT / "frontend" / "dist")

# FastAPI's interactive API docs are a map of the whole API; they are off unless
# ECHO_DEV=1 (docs/LAUNCH.md §4). Never set in production.
_DEV = os.environ.get("ECHO_DEV") == "1"
app = FastAPI(title="Echo", description="General-purpose 3D sound visualizer",
              docs_url="/docs" if _DEV else None,
              redoc_url="/redoc" if _DEV else None,
              openapi_url="/openapi.json" if _DEV else None)

# --- Security headers on every response (docs/LAUNCH.md §4) -------------------
# The CSP allows only what the built app uses: its own files; blob: for the
# recorder's audio and canvas-made images; data: for small inlined assets;
# inline styles, which React, Radix and sonner set at runtime. No inline or
# third-party scripts, and no eval.
#
# script-src needs blob: for one reason: the 3D axis labels (drei <Text>, i.e.
# troika) run in a worker that loads its own code with importScripts(blobURL).
# Without it the labels throw and the whole 3D scene stays blank. A blob: URL
# can only be minted by script already running on the page, so this opens far
# less than 'unsafe-inline' or 'unsafe-eval' would.
#
# The one third-party allowance is Cloudflare Web Analytics (Job's call,
# 2026-11-13): Cloudflare adds its beacon script to the pages at the edge, and
# the beacon posts page views back. Exactly two origins, nothing broader.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' blob: https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: https://cloudflareinsights.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "microphone=(self)",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
}


# --- Protect the Pi (docs/LAUNCH.md §3) ---------------------------------------
def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.environ.get(name, default))))
    except ValueError:
        return default


# One analysis at a time (two at most): ffmpeg + extraction is the only heavy
# work Echo does. A request that can't get a slot within BUSY_WAIT_S gets a
# friendly 503, which also keeps every request far inside Cloudflare's ~100 s.
MAX_CONCURRENT_EXTRACTIONS = _env_int("ECHO_MAX_CONCURRENT_EXTRACTIONS", 1, 1, 2)
BUSY_WAIT_S = 20.0
BUSY_RETRY_AFTER_S = 15
BUSY_MESSAGE = "Echo is busy — try again in a moment."
_extract_slots: asyncio.Semaphore | None = None

# Where the analysis runs. "process" (the default, and production): a separate
# long-lived worker process per slot (analysis_worker.py), so the web server
# never stalls and a stuck job can be killed. "thread": in this process, which
# is what the test suite uses so it can stub the pipeline.
ANALYSIS_MODE = ("thread" if os.environ.get("ECHO_ANALYSIS_MODE") == "thread"
                 else "process")
# Hard limit for one clip in the worker. A real 60 s clip takes about 13 s on
# the Pi; with the 20 s wait for a slot this still ends well inside
# Cloudflare's ~100 s.
ANALYSIS_TIMEOUT_S = 60.0
TOO_SLOW_MESSAGE = "That clip took too long to analyse — try a shorter or simpler one."
CRASHED_MESSAGE = "Something went wrong analysing that clip — please try again."
_workers: list[AnalysisWorker] = []   # the idle workers, one per slot

# Uploads per browser AND per IP address. The env overrides exist for the
# end-to-end test server, which uploads far more than a person would.
UPLOADS_PER_HOUR = _env_int("ECHO_UPLOADS_PER_HOUR", 10, 1, 100_000)
UPLOADS_PER_DAY = _env_int("ECHO_UPLOADS_PER_DAY", 30, 1, 100_000)
upload_limiter = RateLimiter([(UPLOADS_PER_HOUR, 3600), (UPLOADS_PER_DAY, 86400)])
_LOOPBACK = {"127.0.0.1", "::1"}


def _client_ip(request: Request) -> str:
    """The visitor's IP address. CF-Connecting-IP is believed only when the
    connection comes from this machine (cloudflared); anyone reaching port
    8014 directly could set that header to anything, so they get their real
    socket address. (The unit runs uvicorn with --no-proxy-headers so that
    request.client is the real peer.)"""
    peer = request.client.host if request.client else "unknown"
    if peer in _LOOPBACK:
        return request.headers.get("cf-connecting-ip", "").strip() or peer
    return peer


def _rate_keys(request: Request) -> list[str]:
    # The visitor middleware has already run (it wraps the upload guard), so a
    # browser's very first upload counts against the ID it is about to be given.
    return ["ip:" + _client_ip(request), "vid:" + _visitor_id(request)]


def _rate_message(limit: int, window_s: int, retry_after_s: int) -> str:
    per = "hour" if window_s == 3600 else "day"
    mins = max(1, round(retry_after_s / 60))
    wait = (f"about {mins} minute{'s' if mins != 1 else ''}" if mins < 90
            else f"about {round(mins / 60)} hours")
    return (f"You've reached the upload limit ({limit} per {per}). "
            f"Try again in {wait}.")


def _start_workers() -> None:
    """One worker per slot, started (and warmed up) in the background so the
    first visitor's clip doesn't pay for loading the audio libraries."""
    if ANALYSIS_MODE != "process" or _workers:
        return
    for _ in range(MAX_CONCURRENT_EXTRACTIONS):
        worker = AnalysisWorker()
        worker.start()
        _workers.append(worker)


def _stop_workers() -> None:
    while _workers:
        _workers.pop().stop()


def _run_in_worker(worker: AnalysisWorker, raw_path: Path, job: dict) -> dict:
    """Blocking: one job in the worker process, cleaning up if it is killed."""
    clip_id = new_clip_id()
    try:
        return worker.run({"raw_path": str(raw_path), "clip_id": clip_id, **job},
                          ANALYSIS_TIMEOUT_S)
    except (AnalysisTimeout, AnalysisCrashed):
        discard_partial(clip_id)  # the worker never got to roll back
        raise


async def _analyse(raw_path: Path, **job):
    """Run the pipeline for one clip, one at a time. Waits up to BUSY_WAIT_S
    for a free slot, then gives up with the friendly 503."""
    global _extract_slots
    if _extract_slots is None:
        _extract_slots = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)
    try:
        await asyncio.wait_for(_extract_slots.acquire(), timeout=BUSY_WAIT_S)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail=BUSY_MESSAGE,
                            headers={"Retry-After": str(BUSY_RETRY_AFTER_S)})
    try:
        if ANALYSIS_MODE == "thread":
            return await run_in_threadpool(process_audio, raw_path, **job)
        _start_workers()
        worker = _workers.pop()
        try:
            return await run_in_threadpool(_run_in_worker, worker, raw_path, job)
        except AnalysisTimeout:
            raise ProcessingError(TOO_SLOW_MESSAGE)
        except AnalysisCrashed:
            raise HTTPException(status_code=500, detail=CRASHED_MESSAGE)
        finally:
            _workers.append(worker)
    finally:
        _extract_slots.release()


RETENTION_INTERVAL_S = 24 * 3600
_retention_task: asyncio.Task | None = None


async def _retention_loop() -> None:
    """Once a day: the inactivity rule, the site-wide cap and the 80% warning.
    In-process on purpose: a systemd timer would need a second unit file."""
    while True:
        await asyncio.sleep(RETENTION_INTERVAL_S)
        try:
            await run_in_threadpool(run_retention)
        except Exception:  # never let one bad pass end the loop
            logging.getLogger("echo").exception("Daily retention pass failed.")


@app.on_event("startup")
async def _startup() -> None:
    global _retention_task, _extract_slots
    _extract_slots = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)
    init_db()
    await run_in_threadpool(run_retention)
    _retention_task = asyncio.create_task(_retention_loop())
    await run_in_threadpool(_start_workers)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _retention_task is not None:
        _retention_task.cancel()
    await run_in_threadpool(_stop_workers)


# --- Upload guard (docs/LAUNCH.md §3) -----------------------------------------
# Declared before the visitor middleware so that one wraps this one (the last
# @app.middleware added is the outermost): a 429 still carries the cookie.
@app.middleware("http")
async def _upload_guard(request: Request, call_next):
    """Turn away oversized and over-limit uploads before the body is read
    (FastAPI spools the whole upload to disk before the route runs)."""
    if request.method == "POST" and request.url.path == "/upload":
        length = request.headers.get("content-length", "")
        if not length.isdigit():
            return JSONResponse({"detail": "Upload needs a Content-Length."},
                                status_code=411)
        if int(length) > MAX_UPLOAD_BYTES + UPLOAD_FORM_OVERHEAD:
            return JSONResponse({"detail": _TOO_BIG}, status_code=413)
        keys = _rate_keys(request)
        refused = upload_limiter.hit(keys)
        if refused:
            return JSONResponse(
                {"detail": _rate_message(refused.limit, refused.window_s,
                                         refused.retry_after_s)},
                status_code=429,
                headers={"Retry-After": str(refused.retry_after_s)})
        request.state.rate_keys = keys
    return await call_next(request)


UPLOAD_FORM_OVERHEAD = 64 * 1024  # multipart boundaries + the small form fields
_TOO_BIG = f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."


# --- Visitor ID (docs/LAUNCH.md §1) -------------------------------------------
@app.middleware("http")
async def _visitor_cookie(request: Request, call_next):
    """Give each browser a private `echo_vid` and refresh it on use."""
    if not visitor.applies(request.url.path):
        return await call_next(request)
    vid = visitor.parse(request.cookies.get(visitor.COOKIE)) or visitor.new_id()
    request.state.visitor_id = vid
    response = await call_next(request)
    visitor.set_cookie(response, vid)
    return response


# Declared last, so it is the outermost middleware: every response gets the
# headers, including 404s, 429s and static files.
@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


def _visitor_id(request: Request) -> str:
    """The requesting browser's ID. Never None: a route the middleware doesn't
    cover gets a throwaway ID that owns nothing (a None here would match the
    unowned rows in an `owner_id == …` filter)."""
    return getattr(request.state, "visitor_id", None) or visitor.new_id()


_NOT_FOUND = "Clip not found."


def _owned_clip(session, clip_id: str, vid: str) -> Clip:
    """The clip if this browser owns it. 404 otherwise, with the same answer
    as a clip that doesn't exist, so another browser's IDs can't be confirmed."""
    clip = session.get(Clip, clip_id)
    if clip is None or clip.owner_id != vid:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return clip


# --- POST /upload -------------------------------------------------------------
@app.post("/upload")
async def upload(request: Request, file: UploadFile = File(...),
                 source: str = Form("upload"), vid: str = Depends(_visitor_id)):
    """Accept an audio file OR a browser-recorded blob; run the pipeline.

    Source-agnostic (the future Avian project POSTs here like any other
    client). Enforces the 20 MB / 60 s limits server-side.

    `source` is an optional form field: "recording" marks a clip recorded in
    the browser; anything else (or nothing) is a plain file upload, whose
    filename is kept for the history list. It only labels the clip — the
    pipeline is identical either way.
    """
    source_type = "recording" if source == "recording" else "upload"
    source_name = _display_name(file.filename) if source_type == "upload" else None
    suffix = Path(file.filename or "clip").suffix or ".bin"
    # The temp dir is removed on every way out: success, refusal or crash.
    tmp_dir = Path(tempfile.mkdtemp(prefix="echo_up_"))
    try:
        raw_path = tmp_dir / f"raw_{uuid.uuid4().hex[:8]}{suffix}"

        # Stream to disk with a hard size cap (don't trust client Content-Length).
        size = 0
        with raw_path.open("wb") as fh:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=_TOO_BIG)
                fh.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty upload.")

        try:
            result = await _analyse(raw_path, source_type=source_type,
                                    source_name=source_name, owner_id=vid)
        except HTTPException as e:
            if e.status_code == 503:  # busy: don't charge the visitor's allowance
                upload_limiter.refund(getattr(request.state, "rate_keys", []))
            raise
        except ProcessingError as e:
            raise HTTPException(status_code=422, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return {"id": result["id"], "features": result["features"],
            "spectrogram": result.get("spectrogram"),
            "duration_s": result["duration_s"], "audio_url": result["audio_url"]}


# --- POST /capture ------------------------------------------------------------
class CaptureRequest(BaseModel):
    duration: float = Field(default=5.0, gt=0, le=MAX_DURATION_S)


@app.post("/capture", dependencies=[Depends(access.require_owner)])
async def capture(req: CaptureRequest, vid: str = Depends(_visitor_id)):
    """Record `duration` s from the Pi USB mic via ~/bin/rec, then process.

    Owner only (docs/LAUNCH.md §2): 404 without a valid Cloudflare Access
    token, checked before anything else, on every network.

    The mic is acquired only for the recording window (rec is synchronous and
    exits when done) and released immediately — no background listening.
    """
    if not os.path.exists(REC_WRAPPER):
        raise HTTPException(status_code=503,
                            detail="Pi mic wrapper (~/bin/rec) not found.")

    tmp_dir = Path(tempfile.mkdtemp(prefix="echo_cap_"))
    raw_path = tmp_dir / f"cap_{uuid.uuid4().hex[:8]}.wav"
    try:
        # Recording is light, so it doesn't hold an analysis slot; the
        # processing afterwards does.
        proc = await run_in_threadpool(
            subprocess.run,
            [REC_WRAPPER, str(raw_path), str(int(req.duration))],
            capture_output=True, text=True,
            timeout=req.duration + 20,
        )
        if proc.returncode != 0 or not raw_path.exists() or raw_path.stat().st_size == 0:
            detail = proc.stderr.strip() or "recording produced no audio"
            # ALSA card shift is Job's fix (per CLAUDE.md) — surface, don't retry.
            raise HTTPException(status_code=503,
                                detail=f"Mic capture failed: {detail[:200]}")
        result = await _analyse(raw_path, source_type="pi_mic", owner_id=vid)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Mic capture timed out.")
    except ProcessingError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return {"id": result["id"], "features": result["features"],
            "spectrogram": result.get("spectrogram"),
            "duration_s": result["duration_s"], "audio_url": result["audio_url"]}


# --- GET /history -------------------------------------------------------------
# Every clip route is scoped to the requesting browser (docs/LAUNCH.md §1).
@app.get("/history")
def history(vid: str = Depends(_visitor_id)):
    with SessionLocal() as session:
        rows = (session.query(Clip).filter(Clip.owner_id == vid)
                .order_by(Clip.created_at.desc()).all())
        return [r.to_summary() for r in rows]


# --- GET /history/{id} --------------------------------------------------------
@app.get("/history/{clip_id}")
def history_item(clip_id: str, vid: str = Depends(_visitor_id)):
    with SessionLocal() as session:
        clip = _owned_clip(session, clip_id, vid)
        feat_file = ROOT / clip.feature_path
        if not feat_file.exists():
            raise HTTPException(status_code=410, detail="Clip features gone.")
        payload = json.loads(feat_file.read_text())
        summary = clip.to_summary()
        # Opening a clip keeps it alive under the 30-day inactivity rule.
        clip.last_seen_at = datetime.now(timezone.utc)
        session.commit()
    # Backward compat: early clips saved a plain features array; newer clips
    # save {"features", "spectrogram"}.
    if isinstance(payload, list):
        features, spectrogram = payload, None
    else:
        features = payload.get("features", [])
        spectrogram = payload.get("spectrogram")
    return {**summary, "features": features, "spectrogram": spectrogram,
            "audio_url": f"/audio/{Path(clip.audio_path).name}"}


# --- DELETE /history/{id} -----------------------------------------------------
@app.delete("/history/{clip_id}", status_code=204)
def history_delete(clip_id: str, vid: str = Depends(_visitor_id)):
    """Delete one of this browser's clips: the row, the playback copy and the
    feature file. Another browser's clip is a 404, like a missing one."""
    with SessionLocal() as session:
        delete_clip(session, _owned_clip(session, clip_id, vid))
        session.commit()
    return Response(status_code=204)


# --- GET /audio/{filename} ----------------------------------------------------
@app.get("/audio/{filename}")
def audio(filename: str, vid: str = Depends(_visitor_id)):
    # Guard against path traversal: only a bare filename inside AUDIO_DIR.
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Bad filename.")
    # Playback copies are named after their clip, so the clip row (and so the
    # owner check) is found from the file name. Same 404 for "not yours" and
    # "doesn't exist".
    stem, dot, ext = filename.rpartition(".")
    with SessionLocal() as session:
        clip = session.get(Clip, stem) if dot else None
        if (clip is None or clip.owner_id != vid
                or Path(clip.audio_path).name != filename):
            raise HTTPException(status_code=404, detail="Audio not found.")
    path = AUDIO_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found.")
    return FileResponse(path, media_type="audio/ogg")


# --- Sample library (Part D) --------------------------------------------------
# Curated example clips, permanent + never in the retention-managed clips table.
# Route order: the two-segment /samples/audio/{filename} is declared before
# /samples/{sample_id} so there's no ambiguity.
@app.get("/samples")
def samples_list():
    return sample_lib.list_samples()


@app.get("/samples/audio/{filename}")
def sample_audio(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Bad filename.")
    path = sample_lib.AUDIO_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sample audio not found.")
    return FileResponse(path, media_type="audio/ogg")


@app.get("/samples/{sample_id}")
def sample_item(sample_id: str):
    data = sample_lib.get_sample(sample_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Sample not found.")
    return data


# --- Owner sign-in (docs/LAUNCH.md §2) ----------------------------------------
@app.get("/me", dependencies=[Depends(access.require_owner)])
def me():
    """The owner's sign-in step. Cloudflare Access covers this path, so
    visiting it asks for Job's email (once a month); with a valid token Echo
    sends the browser on to the app. Without one it is a 404."""
    return RedirectResponse("/app?owner=1", status_code=303)


@app.get("/api/me")
def api_me(request: Request):
    """Public: tells the app whether to show the Pi mic button. True only for
    a browser carrying a valid Access token."""
    return JSONResponse({"pi_mic": access.is_owner(request)},
                        headers={"Cache-Control": "no-store"})


@app.get("/api/health")
def health():
    """Public liveness check: says the app is up and nothing else. `status`
    is kept for checks written against the older response (decision L9)."""
    return {"ok": True, "status": "ok"}


# --- GET /api/schema-audit ----------------------------------------------------
# Cheap runtime report of how many stored clips are on the current extraction
# schema vs stale (Part 0). Imported lazily so the test suite's module-reload
# (ECHO_DATA_DIR seam) is always reflected.
# Owner only, like /capture (docs/LAUNCH.md §4).
@app.get("/api/schema-audit", dependencies=[Depends(access.require_owner)])
def schema_audit_endpoint():
    import schema_audit
    return schema_audit.audit_all()


def _display_name(filename: str | None) -> str | None:
    """An uploaded file's name, reduced to something safe to show in a list:
    no directory part, no control characters, at most 80 characters."""
    if not filename:
        return None
    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if ch.isprintable()).strip()
    return base[:80] or None


# --- SPA route + StaticFiles: MOUNTED LAST (locked) ---------------------------
# All API routes above take precedence. In dev, frontend/dist may not exist yet.
if FRONTEND_DIST.exists():
    # Design v2: the app lives at /app (landing page at /). StaticFiles'
    # html=True only serves index.html for "/", so /app and /app/* need an
    # explicit route. It must be registered BEFORE the "/" mount (which
    # swallows everything it's asked for) and after every API route.
    @app.get("/app", include_in_schema=False)
    @app.get("/app/{rest:path}", include_in_schema=False)
    def spa_app(rest: str = ""):
        return FileResponse(FRONTEND_DIST / "index.html", media_type="text/html")

    # The PWA service worker must never be served stale: Cloudflare's edge
    # caches *.js for 4 hours by default, which would hold every installed
    # client on the previous build's precache list after a deploy. no-cache
    # makes the edge and the browser revalidate it every time. (Hashed
    # /assets/* files are safe to cache; index.html isn't edge-cached.)
    @app.get("/sw.js", include_in_schema=False)
    def service_worker():
        path = FRONTEND_DIST / "sw.js"
        if not path.exists():
            raise HTTPException(status_code=404, detail="Not found.")
        return FileResponse(path, media_type="text/javascript",
                            headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True),
              name="frontend")
