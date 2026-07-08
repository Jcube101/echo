"""Echo — audio processing + retention helpers (M2).

The pipeline every input path shares:

    raw bytes on disk
      -> ffprobe duration (enforce 60 s)
      -> ffmpeg transcode to a temp WAV (mono 22.05k) for extraction
      -> extract_features(wav)
      -> ffmpeg transcode raw to a small playback copy (opus) kept on disk
      -> write features JSON to disk
      -> insert DB row, enforce 50-entry retention
      -> delete raw + temp WAV

Raw uploaded/recorded audio is NEVER kept beyond the small playback copy
(locked SD-card constraint).
"""

from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path

from db import (AUDIO_DIR, FEATURES_DIR, ROOT, RETENTION_LIMIT, Clip,
                SessionLocal)
from extraction import MAX_DURATION_S, compute_spectrogram, extract_features

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB (locked)


class ProcessingError(Exception):
    """Raised for client-fixable problems (bad/too-long/undecodable audio)."""


def probe_duration(path: Path) -> float:
    """Return audio duration in seconds via ffprobe, or raise ProcessingError."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return float(out.stdout.strip())
    except (subprocess.CalledProcessError, ValueError, subprocess.TimeoutExpired) as e:
        raise ProcessingError(
            "Could not read audio — unsupported or corrupt file.") from e


def _run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                           *args], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise ProcessingError(f"Audio conversion failed: {proc.stderr[:300]}")


def _to_wav(src: Path, dst: Path) -> None:
    # -vn drops any video stream; take only audio.
    _run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", "22050", str(dst)])


def _to_opus(src: Path, dst: Path) -> None:
    # Small mono playback copy. libopus @ 48 kbps is tiny and clear.
    _run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-c:a", "libopus",
                 "-b:a", "48k", str(dst)])


def _enforce_retention(session) -> None:
    """Delete oldest clips + their files beyond RETENTION_LIMIT."""
    rows = session.query(Clip).order_by(Clip.created_at.desc()).all()
    for stale in rows[RETENTION_LIMIT:]:
        for rel in (stale.feature_path, stale.audio_path):
            p = ROOT / rel
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        session.delete(stale)
    session.commit()


def process_audio(raw_path: Path, source_type: str) -> dict:
    """Full pipeline for one clip. Returns {id, features, duration_s, audio_url}.

    `raw_path` is deleted before returning (only the playback copy survives).
    Caller owns any temp dir; we only unlink the raw file itself.
    """
    clip_id = uuid.uuid4().hex[:12]
    wav_tmp = raw_path.with_name(f"{clip_id}_x.wav")
    audio_out = AUDIO_DIR / f"{clip_id}.opus"
    feat_out = FEATURES_DIR / f"{clip_id}.json"

    try:
        duration = probe_duration(raw_path)
        if duration <= 0:
            raise ProcessingError("Audio has zero duration.")
        if duration > MAX_DURATION_S + 0.5:  # small tolerance for container rounding
            raise ProcessingError(
                f"Clip is {duration:.1f}s — the limit is {int(MAX_DURATION_S)}s.")

        _to_wav(raw_path, wav_tmp)
        features = extract_features(str(wav_tmp))
        if not features:
            raise ProcessingError("No audio content could be analyzed.")
        spectrogram = compute_spectrogram(str(wav_tmp))

        _to_opus(raw_path, audio_out)
        # Saved as a combined payload so the strip + trail travel together and
        # get cleaned up by the same retention rule (one file per clip).
        feat_out.write_text(json.dumps(
            {"features": features, "spectrogram": spectrogram}))

        # effective duration = min(actual, cap) since extraction truncates at cap
        eff_duration = min(duration, MAX_DURATION_S)

        with SessionLocal() as session:
            clip = Clip(
                id=clip_id,
                source_type=source_type,
                duration_s=eff_duration,
                feature_path=str(feat_out.relative_to(ROOT)),
                audio_path=str(audio_out.relative_to(ROOT)),
            )
            session.add(clip)
            session.commit()
            _enforce_retention(session)

        return {
            "id": clip_id,
            "features": features,
            "spectrogram": spectrogram,
            "duration_s": round(eff_duration, 3),
            "audio_url": f"/audio/{clip_id}.opus",
        }
    except Exception:
        # Roll back any partial artifacts on failure.
        for p in (audio_out, feat_out):
            p.unlink(missing_ok=True)
        raise
    finally:
        raw_path.unlink(missing_ok=True)
        wav_tmp.unlink(missing_ok=True)
