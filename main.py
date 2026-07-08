"""Echo — FastAPI app (M2 + M8).

Source-agnostic audio visualizer API. Serves the built frontend last via
StaticFiles so all API routes take precedence.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import AUDIO_DIR, ROOT, Clip, SessionLocal, init_db
from extraction import MAX_DURATION_S
from storage import (MAX_UPLOAD_BYTES, ProcessingError, process_audio)
import samples as sample_lib

REC_WRAPPER = os.path.expanduser("~/bin/rec")
FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="Echo", description="General-purpose 3D sound visualizer")


@app.on_event("startup")
def _startup() -> None:
    init_db()


# --- POST /upload -------------------------------------------------------------
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    """Accept an audio file OR a browser-recorded blob; run the pipeline.

    Source-agnostic (the future Avian project POSTs here like any other
    client). Enforces the 20 MB / 60 s limits server-side.
    """
    suffix = Path(file.filename or "clip").suffix or ".bin"
    tmp_dir = Path(tempfile.mkdtemp(prefix="echo_up_"))
    raw_path = tmp_dir / f"raw_{uuid.uuid4().hex[:8]}{suffix}"

    # Stream to disk with a hard size cap (don't trust client Content-Length).
    size = 0
    with raw_path.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                fh.close()
                raw_path.unlink(missing_ok=True)
                _rmdir(tmp_dir)
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.")
            fh.write(chunk)

    if size == 0:
        _rmdir(tmp_dir)
        raise HTTPException(status_code=400, detail="Empty upload.")

    try:
        result = process_audio(raw_path, source_type="upload")
    except ProcessingError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        _rmdir(tmp_dir)
    return {"id": result["id"], "features": result["features"],
            "spectrogram": result.get("spectrogram"),
            "duration_s": result["duration_s"], "audio_url": result["audio_url"]}


# --- POST /capture ------------------------------------------------------------
class CaptureRequest(BaseModel):
    duration: float = Field(default=5.0, gt=0, le=MAX_DURATION_S)


@app.post("/capture")
def capture(req: CaptureRequest):
    """Record `duration` s from the Pi USB mic via ~/bin/rec, then process.

    The mic is acquired only for the recording window (rec is synchronous and
    exits when done) and released immediately — no background listening.
    """
    if not os.path.exists(REC_WRAPPER):
        raise HTTPException(status_code=503,
                            detail="Pi mic wrapper (~/bin/rec) not found.")

    tmp_dir = Path(tempfile.mkdtemp(prefix="echo_cap_"))
    raw_path = tmp_dir / f"cap_{uuid.uuid4().hex[:8]}.wav"
    try:
        proc = subprocess.run(
            [REC_WRAPPER, str(raw_path), str(int(req.duration))],
            capture_output=True, text=True,
            timeout=req.duration + 20,
        )
        if proc.returncode != 0 or not raw_path.exists() or raw_path.stat().st_size == 0:
            detail = proc.stderr.strip() or "recording produced no audio"
            # ALSA card shift is Job's fix (per CLAUDE.md) — surface, don't retry.
            raise HTTPException(status_code=503,
                                detail=f"Mic capture failed: {detail[:200]}")
        result = process_audio(raw_path, source_type="pi_mic")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Mic capture timed out.")
    except ProcessingError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        _rmdir(tmp_dir)
    return {"id": result["id"], "features": result["features"],
            "spectrogram": result.get("spectrogram"),
            "duration_s": result["duration_s"], "audio_url": result["audio_url"]}


# --- GET /history -------------------------------------------------------------
@app.get("/history")
def history():
    with SessionLocal() as session:
        rows = session.query(Clip).order_by(Clip.created_at.desc()).all()
        return [r.to_summary() for r in rows]


# --- GET /history/{id} --------------------------------------------------------
@app.get("/history/{clip_id}")
def history_item(clip_id: str):
    with SessionLocal() as session:
        clip = session.get(Clip, clip_id)
        if clip is None:
            raise HTTPException(status_code=404, detail="Clip not found.")
        feat_file = ROOT / clip.feature_path
        if not feat_file.exists():
            raise HTTPException(status_code=410, detail="Clip features gone.")
        payload = json.loads(feat_file.read_text())
        summary = clip.to_summary()
    # Backward compat: early clips saved a plain features array; newer clips
    # save {"features", "spectrogram"}.
    if isinstance(payload, list):
        features, spectrogram = payload, None
    else:
        features = payload.get("features", [])
        spectrogram = payload.get("spectrogram")
    return {**summary, "features": features, "spectrogram": spectrogram,
            "audio_url": f"/audio/{Path(clip.audio_path).name}"}


# --- GET /audio/{filename} ----------------------------------------------------
@app.get("/audio/{filename}")
def audio(filename: str):
    # Guard against path traversal: only a bare filename inside AUDIO_DIR.
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Bad filename.")
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


@app.get("/api/health")
def health():
    return {"status": "ok"}


def _rmdir(d: Path) -> None:
    try:
        for p in d.iterdir():
            p.unlink(missing_ok=True)
        d.rmdir()
    except OSError:
        pass


# --- StaticFiles: MOUNTED LAST (locked) ---------------------------------------
# All API routes above take precedence. In dev, frontend/dist may not exist yet.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True),
              name="frontend")
