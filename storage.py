"""Echo — audio processing + retention helpers (M2).

The pipeline every input path shares:

    raw bytes on disk
      -> ffprobe duration (enforce 60 s)
      -> ffmpeg transcode to a temp WAV (mono 22.05k) for extraction
      -> extract_features(wav)
      -> ffmpeg transcode raw to a small playback copy (opus) kept on disk
      -> write features JSON to disk
      -> insert DB row, enforce retention (per browser, site-wide, inactivity)
      -> delete raw + temp WAV

Raw uploaded/recorded audio is NEVER kept beyond the small playback copy
(locked SD-card constraint).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func

from db import (AUDIO_DIR, DB_PATH, FEATURES_DIR, ROOT, RETENTION_GLOBAL_BYTES,
                RETENTION_GLOBAL_CLIPS, RETENTION_INACTIVE_DAYS,
                RETENTION_PER_OWNER, RETENTION_WARN_FRACTION, Clip, SessionLocal)

log = logging.getLogger("echo.storage")
from extraction import (FEATURE_SCHEMA_VERSION, MAX_DURATION_S,
                        compute_spectrogram, extract_features)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB (locked)


class ProcessingError(Exception):
    """Raised for client-fixable problems (bad/too-long/undecodable audio)."""


# Every ffprobe/ffmpeg call on an untrusted file is bounded (docs/LAUNCH.md §3).
# A real 60 s clip converts in a second or two on the Pi; 30 s is generous.
FFMPEG_TIMEOUT_S = 30


def probe_duration(path: Path) -> float:
    """Return audio duration in seconds via ffprobe, or raise ProcessingError.

    Also the gate for untrusted files: nothing is decoded unless ffprobe
    recognises the container AND finds an audio stream in it.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=codec_type", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_S, check=True,
            stdin=subprocess.DEVNULL,
        )
        info = json.loads(out.stdout)
        duration = float(info["format"]["duration"])
    except (subprocess.CalledProcessError, ValueError, KeyError, TypeError,
            subprocess.TimeoutExpired) as e:
        raise ProcessingError(
            "Could not read audio — unsupported or corrupt file.") from e
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise ProcessingError("That file has no audio track.")
    return duration


def _run_ffmpeg(args: list[str]) -> None:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_S,
            stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:  # run() has already killed ffmpeg
        raise ProcessingError(
            "Audio conversion took too long — try a shorter or simpler file.") from e
    if proc.returncode != 0:
        raise ProcessingError(f"Audio conversion failed: {proc.stderr[:300]}")


def _to_wav(src: Path, dst: Path) -> None:
    # -vn drops any video stream; take only audio.
    _run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", "22050", str(dst)])


def _to_opus(src: Path, dst: Path) -> None:
    # Small mono playback copy. libopus @ 48 kbps is tiny and clear.
    _run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-c:a", "libopus",
                 "-b:a", "48k", str(dst)])


def delete_clip(session, clip: Clip) -> None:
    """Remove one clip: its playback copy, its feature file and its row.

    The caller commits. Missing files are fine (already gone is the goal).
    """
    for rel in (clip.feature_path, clip.audio_path):
        try:
            (ROOT / rel).unlink(missing_ok=True)
        except OSError:
            pass
    session.delete(clip)


def _file_size(rel: str) -> int:
    try:
        return (ROOT / rel).stat().st_size
    except OSError:
        return 0


def data_usage_bytes() -> int:
    """Bytes of clip data on disk: playback copies + feature files + the DB.
    This is what the site-wide size cap measures (samples live elsewhere)."""
    total = 0
    for d in (AUDIO_DIR, FEATURES_DIR):
        try:
            total += sum(e.stat().st_size for e in os.scandir(d) if e.is_file())
        except OSError:
            pass
    try:
        total += DB_PATH.stat().st_size
    except OSError:
        pass
    return total


def _enforce_owner_limit(session, owner_id: str | None) -> int:
    """Keep one browser's newest RETENTION_PER_OWNER clips; delete its older ones."""
    if not owner_id:
        return 0
    rows = (session.query(Clip).filter(Clip.owner_id == owner_id)
            .order_by(Clip.created_at.desc()).all())
    extra = rows[RETENTION_PER_OWNER:]
    for clip in extra:
        delete_clip(session, clip)
    session.commit()
    return len(extra)


def _enforce_global_limit(session) -> int:
    """Site-wide hard cap: at most RETENTION_GLOBAL_CLIPS clips and
    RETENTION_GLOBAL_BYTES of clip data, whichever is hit first. Deletes the
    oldest clips, whoever owns them, until both hold."""
    removed = 0
    rows = session.query(Clip).order_by(Clip.created_at.desc()).all()
    extra = rows[RETENTION_GLOBAL_CLIPS:]
    rows = rows[:RETENTION_GLOBAL_CLIPS]
    for clip in extra:
        delete_clip(session, clip)
        removed += 1
    if extra:
        session.commit()

    usage = data_usage_bytes()
    while usage > RETENTION_GLOBAL_BYTES and rows:
        oldest = rows.pop()
        usage -= _file_size(oldest.audio_path) + _file_size(oldest.feature_path)
        delete_clip(session, oldest)
        removed += 1
    session.commit()
    return removed


def _sweep_inactive(session, now: datetime | None = None) -> int:
    """Delete clips nobody has opened for RETENTION_INACTIVE_DAYS."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=RETENTION_INACTIVE_DAYS)
    stale = (session.query(Clip)
             .filter(func.coalesce(Clip.last_seen_at, Clip.created_at) < cutoff).all())
    for clip in stale:
        delete_clip(session, clip)
    session.commit()
    return len(stale)


def _enforce_retention(session, owner_id: str | None = None) -> None:
    """All three rules, run after every save: this browser's 20, the 30-day
    inactivity rule, then the site-wide cap."""
    _enforce_owner_limit(session, owner_id)
    _sweep_inactive(session)
    _enforce_global_limit(session)


def run_retention(now: datetime | None = None) -> dict:
    """The startup + once-a-day pass (main.py): inactivity and the site-wide
    cap, then a log warning if clip data is past 80% of either cap. Logs
    counts only, never visitor IDs."""
    with SessionLocal() as session:
        inactive = _sweep_inactive(session, now)
        capped = _enforce_global_limit(session)
        clips = session.query(Clip).count()
    usage = data_usage_bytes()
    if inactive or capped:
        log.warning("Retention: deleted %d inactive and %d over-cap clips.",
                    inactive, capped)
    if (usage > RETENTION_WARN_FRACTION * RETENTION_GLOBAL_BYTES
            or clips > RETENTION_WARN_FRACTION * RETENTION_GLOBAL_CLIPS):
        log.warning(
            "Clip storage is past %d%% of its cap: %d of %d clips, %.0f of %.0f MB.",
            round(RETENTION_WARN_FRACTION * 100), clips, RETENTION_GLOBAL_CLIPS,
            usage / 1e6, RETENTION_GLOBAL_BYTES / 1e6)
    return {"inactive_deleted": inactive, "cap_deleted": capped,
            "clips": clips, "bytes": usage}


def new_clip_id() -> str:
    # Full 128-bit IDs (docs/LAUNCH.md §1): clip and audio URLs are unguessable.
    return uuid.uuid4().hex


def discard_partial(clip_id: str) -> None:
    """Remove whatever a killed or crashed analysis left behind for this clip
    ID: the playback copy, the feature file and (if it got that far) the row."""
    for p in (AUDIO_DIR / f"{clip_id}.opus", FEATURES_DIR / f"{clip_id}.json"):
        p.unlink(missing_ok=True)
    with SessionLocal() as session:
        clip = session.get(Clip, clip_id)
        if clip is not None:
            session.delete(clip)
            session.commit()


def process_audio(raw_path: Path | str, source_type: str,
                  source_name: str | None = None,
                  owner_id: str | None = None,
                  clip_id: str | None = None) -> dict:
    """Full pipeline for one clip. Returns {id, features, duration_s, audio_url}.

    `owner_id` is the uploading browser's visitor ID (visitor.py); only that
    browser can see the clip. `raw_path` is deleted before returning (only the
    playback copy survives). Caller owns any temp dir; we only unlink the raw
    file itself. `clip_id` lets the caller choose the ID up front, so it can
    clean up (discard_partial) if this call is killed part-way.
    """
    raw_path = Path(raw_path)
    clip_id = clip_id or new_clip_id()
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
        # get cleaned up by the same retention rule (one file per clip). The
        # schema_version stamp (Part 0) records which extraction produced this
        # payload so the audit can tell current from stale without git archaeology.
        feat_out.write_text(json.dumps(
            {"schema_version": FEATURE_SCHEMA_VERSION,
             "features": features, "spectrogram": spectrogram}))

        # effective duration = min(actual, cap) since extraction truncates at cap
        eff_duration = min(duration, MAX_DURATION_S)

        with SessionLocal() as session:
            clip = Clip(
                id=clip_id,
                source_type=source_type,
                source_name=source_name,
                owner_id=owner_id,
                duration_s=eff_duration,
                schema_version=FEATURE_SCHEMA_VERSION,
                # os.path.relpath (not Path.relative_to) so this still works
                # when DATA_DIR has been redirected outside ROOT (ECHO_DATA_DIR,
                # test-enablement seam) — it emits a ../-relative path instead
                # of raising, and ROOT / that path still resolves correctly.
                feature_path=os.path.relpath(feat_out, ROOT),
                audio_path=os.path.relpath(audio_out, ROOT),
            )
            session.add(clip)
            session.commit()
            _enforce_retention(session, owner_id)

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
