"""Echo — feature extraction engine (M1).

Standalone, testable: audio file in -> per-frame feature stream out.

Each frame is a dict:
    {"t": float, "pitch": float, "timbre": float, "motion": float, "amplitude": float}

- pitch     fundamental frequency (Hz) via librosa.pyin; unvoiced frames
            carry forward the last voiced pitch so the 3D trail stays
            continuous (never null / never a hole in the line).
- timbre    spectral centroid (Hz) mapped through log2 into a small,
            perceptually-even scalar range. Chosen over MFCC->PCA because it
            is deterministic, needs no per-clip model fit, is cheap, and maps
            cleanly onto a spatial axis. Rationale in LEARNINGS.md.
- motion    onset-strength envelope (librosa.onset.onset_strength): how much
            the spectrum is changing frame-to-frame. Chosen over raw RMS-delta
            because it is spectrally aware (a steady loud tone reads as low
            motion; a chirp reads as high) which matches the "motion" idea
            better. Rationale in LEARNINGS.md.
- amplitude RMS energy per frame, normalized 0..1. Drives point size/color,
            NOT a spatial axis.

Run directly for a quick self-check:
    python extraction.py test.wav
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np

# --- Tunables -----------------------------------------------------------------
SAMPLE_RATE = 22050          # librosa default; plenty for pitch/timbre of speech,
                             # birdsong, music up to ~11 kHz Nyquist.
HOP_LENGTH = 441             # ~20 ms at 22050 Hz (441 / 22050 = 0.02 s)
N_FFT = 2048
MAX_DURATION_S = 60.0        # hard cap (locked): never process past 60 s
MAX_POINTS = 3000            # frontend never receives more than this
FMIN = 50.0                  # pyin floor — aligned with the fixed pitch scale
FMAX = 4000.0                # pyin ceil — raised from 2093 so high birdsong
                             # (the reference clip is ~2.5 kHz) is actually
                             # detected, not collapsed to the unvoiced fallback
PYIN_RESOLUTION = 0.25       # pyin pitch-bin size in fractions of a semitone.
                             # librosa's default 0.1 (10 cents) is the runtime
                             # bottleneck on the Pi — pyin cost scales with the
                             # bin count. 0.25 (25 cents) is ~5.6x faster
                             # (60 s clip: ~37 s -> ~6.5 s of pyin) while shifting
                             # detected pitch by only ~6 cents mean / 15 cents p95
                             # vs 0.1 — imperceptible in the visualization, and
                             # well below one semitone. 0.5 was too coarse (octave
                             # errors). This is what keeps /upload under every
                             # timeout in the chain. See LEARNINGS.md.
SILENCE_RMS_FRAC = 0.06      # a frame is "quiet" (hold its shape) if its RMS is
                             # below this fraction of the clip's peak RMS.

# --- Boundary silence trim (Part B) -------------------------------------------
# Leading/trailing silence is removed so the trail doesn't open/close with a
# cluster of near-origin points ("starts from nothing" artifact). The INTERIOR
# is never touched — quiet passages between sounds are HELD (SILENCE_RMS_FRAC).
# The threshold is ADAPTIVE: it sits TRIM_MARGIN_DB above the clip's own noise
# floor, so a quiet phone recording and a loud close-up are judged by their own
# noise level, not one global dB value. It is also capped so it can never rise
# within TRIM_MIN_SNR_DB of the peak — that cap is what prevents the old
# top_db=30 failure, where a single loud transient inflated the peak and made
# the trim eat quiet-but-real signal at the boundaries.
TRIM_FLOOR_PCT = 10          # noise-floor estimate = this percentile of RMS(dB)
TRIM_MARGIN_DB = 8.0         # signal must exceed the noise floor by this much
TRIM_MIN_SNR_DB = 25.0       # never treat frames within this of the peak as silence
TRIM_PAD_FRAMES = 3          # keep ~60 ms of margin around the detected signal

# --- Fixed world scale (Part B) -----------------------------------------------
# The axes mean the SAME value range for every clip, so clips are comparable
# across the gallery (a high bird sits high on pitch in every clip). Each raw
# feature is transformed, clamped to fixed bounds, then mapped into the
# [-WORLD, WORLD] box. Bounds derived from the actual history-clip distributions
# (n=5759 frames): timbre p50/p95 ≈ 4.8/6.5, motion(onset) p50/p95/p99 ≈
# 0.5/3.3/10.4 (heavy-tailed → log-compressed), pitch over the audible-of-
# interest band. See LEARNINGS.md. These are the tunables to adjust by eye.
WORLD = 3.0                       # half-extent of the cube the trail lives in
PITCH_HZ_RANGE = (50.0, 4000.0)   # mapped via log2 (octaves evenly spaced)
TIMBRE_RAW_RANGE = (2.0, 8.0)     # raw = log2(spectral_centroid / 55)
MOTION_RAW_RANGE = (0.0, 3.0)     # raw = log1p(onset_strength)  (log1p(19)≈3)

# --- Smoothing (Part C) -------------------------------------------------------
SMOOTH_WINDOW = 5      # ~100 ms moving average on the 3 spatial axes
AMP_SMOOTH_WINDOW = 3  # light smoothing on amplitude (keep transient peaks)


def _load_audio(path: str) -> tuple[np.ndarray, int]:
    """Load mono audio at SAMPLE_RATE, truncated to MAX_DURATION_S.

    librosa (via audioread/soundfile) already handles mp3/wav/m4a/opus/ogg.
    We still truncate defensively in case the server-side duration check is
    bypassed.
    """
    y, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True,
                         duration=MAX_DURATION_S)
    return y, sr


def _normalize(x: np.ndarray) -> np.ndarray:
    """Scale a non-negative array into 0..1 robustly (guards flat/zero input)."""
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    lo = float(np.min(x))
    hi = float(np.max(x))
    if hi - lo < 1e-9:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


def _hold_forward(values: np.ndarray, valid: np.ndarray, fallback: float) -> np.ndarray:
    """Hold the last valid value across invalid frames (carry-forward).

    Invalid frames take the previous valid frame's value; a leading run of
    invalid frames is back-filled with the first valid value. If no frame is
    valid, the whole array becomes `fallback` (keeps downstream math finite).

    Used to keep pitch/timbre/motion *steady* through quiet/unvoiced frames
    instead of collapsing any axis toward 0 — which read as a spike to the
    origin in the 3D trail.
    """
    out = np.array(values, dtype=float)
    valid = np.asarray(valid, dtype=bool) & np.isfinite(out)
    if not valid.any():
        return np.full_like(out, fallback)

    last = None
    for i in range(len(out)):
        if valid[i]:
            last = out[i]
        elif last is not None:
            out[i] = last
        # else: leading invalid, handled by back-fill below
    first_valid_idx = int(np.argmax(valid))
    out[:first_valid_idx] = out[first_valid_idx]
    return out


def _trim_boundary_silence(y: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    """Remove leading + trailing silence only; interior untouched.

    Returns (y_trimmed, offset_samples). The offset is added back to the frame
    times so the untrimmed playback copy still scrub-syncs. Adaptive threshold
    (see the TRIM_* tunables): a frame counts as signal if its RMS is more than
    TRIM_MARGIN_DB above the clip's own noise floor, but the threshold is capped
    so it never rises within TRIM_MIN_SNR_DB of the peak — real signal is never
    trimmed even when a loud transient inflates the peak. No-ops (returns y, 0)
    when nothing is clearly below signal or the result would be degenerate.
    """
    if y.size < N_FFT:
        return y, 0
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP_LENGTH)[0]
    if rms.size == 0:
        return y, 0
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)  # 0 dB at the peak frame
    floor_db = float(np.percentile(rms_db, TRIM_FLOOR_PCT))
    thresh_db = min(floor_db + TRIM_MARGIN_DB, -TRIM_MIN_SNR_DB)
    signal = rms_db > thresh_db
    if not signal.any():
        return y, 0
    first = max(0, int(np.argmax(signal)) - TRIM_PAD_FRAMES)
    last = min(len(signal) - 1,
               len(signal) - 1 - int(np.argmax(signal[::-1])) + TRIM_PAD_FRAMES)
    start = first * HOP_LENGTH
    end = min(int(y.size), (last + 1) * HOP_LENGTH + N_FFT)
    if end - start < 2 * N_FFT:          # would leave too little to analyze
        return y, 0
    if start == 0 and end >= y.size:     # nothing to trim
        return y, 0
    return y[start:end], start


def _to_world(vals: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Map values in feature-range [lo, hi] into the fixed [-WORLD, WORLD] box,
    clamping out-of-range values to the box edge (never stretch the scale)."""
    v = np.clip(np.asarray(vals, dtype=float), lo, hi)
    return (v - lo) / (hi - lo) * (2 * WORLD) - WORLD


def _smooth(x: np.ndarray, window: int) -> np.ndarray:
    """Odd-window moving average with edge padding (keeps length, no phase shift)."""
    x = np.asarray(x, dtype=float)
    if window <= 1 or x.size < 3:
        return x
    pad = window // 2
    xp = np.pad(x, pad, mode="edge")
    kernel = np.ones(window) / window
    return np.convolve(xp, kernel, mode="valid")[:x.size]


def extract_features(path: str, max_points: int = MAX_POINTS) -> list[dict]:
    """Extract per-frame features from an audio file.

    Returns a list of {t, pitch, timbre, motion, amplitude} dicts where
    pitch/timbre/motion are FIXED-SCALE world coordinates in [-WORLD, WORLD]
    (comparable across clips) and amplitude is 0..1 (per-clip, drives size/glow).
    ~50 points/sec of the FULL clip; only downsampled beyond `max_points`
    (=3000, i.e. 60 s). Never returns NaN/Inf.
    """
    y, sr = _load_audio(path)
    if y.size == 0:
        return []

    # Boundary-only silence trim (Part B): strip leading/trailing room tone so
    # the trail doesn't open/close with a cluster of near-origin points. Only
    # the boundaries are cut — interior quiet passages are still HELD (below),
    # so density stays ~50/s of the *remaining* clip. `trim_offset` is added
    # back to the frame times so the (untrimmed) playback copy scrub-syncs.
    y, trim_offset = _trim_boundary_silence(y, sr)
    if y.size == 0:
        return []

    # --- pitch (fundamental frequency) ---
    f0, voiced_flag, _ = librosa.pyin(
        y, sr=sr, fmin=FMIN, fmax=FMAX, resolution=PYIN_RESOLUTION,
        frame_length=N_FFT, hop_length=HOP_LENGTH,
    )

    # --- timbre (spectral centroid, log2) ---
    centroid = librosa.feature.spectral_centroid(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
    )[0]
    centroid = np.maximum(np.nan_to_num(centroid, nan=55.0), 1.0)
    timbre_raw = np.log2(centroid / 55.0)

    # --- motion (onset strength) ---
    motion_raw = librosa.onset.onset_strength(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
    )

    # --- amplitude (RMS energy) ---
    rms = librosa.feature.rms(
        y=y, frame_length=N_FFT, hop_length=HOP_LENGTH,
    )[0]

    # Align to the shortest per-frame array before combining.
    n = min(len(f0), len(timbre_raw), len(motion_raw), len(rms))
    f0, voiced_flag = f0[:n], voiced_flag[:n]
    timbre_raw, motion_raw, rms = timbre_raw[:n], motion_raw[:n], rms[:n]

    # Quiet frames HOLD the previous pitch/timbre/motion (no axis collapses to
    # 0 → no spike to origin), while keeping the frame in the timeline.
    peak = float(np.max(rms)) if n else 0.0
    loud = rms > (SILENCE_RMS_FRAC * peak) if peak > 0 else np.zeros(n, dtype=bool)

    pitch_valid = np.asarray(voiced_flag, dtype=bool) & loud & np.isfinite(f0) & (f0 > 0)
    pitch_hz = _hold_forward(f0, pitch_valid, 220.0)
    timbre_held = _hold_forward(timbre_raw, loud, float(np.nanmedian(timbre_raw)))
    motion_held = _hold_forward(motion_raw, loud, 0.0)

    # --- map to FIXED world coordinates (Part B) ---
    pitch = _to_world(np.log2(np.clip(pitch_hz, *PITCH_HZ_RANGE)),
                      math.log2(PITCH_HZ_RANGE[0]), math.log2(PITCH_HZ_RANGE[1]))
    timbre = _to_world(timbre_held, *TIMBRE_RAW_RANGE)
    motion = _to_world(np.log1p(np.maximum(motion_held, 0.0)), *MOTION_RAW_RANGE)

    # amplitude stays per-clip 0..1 (real low energy => small/dim point)
    amplitude = _normalize(rms)

    # --- smoothing (Part C): flow the spatial axes; keep amplitude peaks ---
    pitch = _smooth(pitch, SMOOTH_WINDOW)
    timbre = _smooth(timbre, SMOOTH_WINDOW)
    motion = _smooth(motion, SMOOTH_WINDOW)
    amplitude = np.clip(_smooth(amplitude, AMP_SMOOTH_WINDOW), 0.0, 1.0)

    # Frame times carry the trim offset back so they sit on the ORIGINAL
    # (untrimmed) timeline — the full playback copy still scrub-syncs; the trail
    # simply has no points during the trimmed-away lead/tail silence.
    times = (librosa.frames_to_samples(np.arange(n), hop_length=HOP_LENGTH)
             + trim_offset) / sr

    # --- downsample only beyond the 3000-point ceiling (~60 s) ---
    idx = (np.linspace(0, n - 1, max_points).round().astype(int)
           if n > max_points else np.arange(n))

    features: list[dict] = []
    for i in idx:
        features.append({
            "t": round(float(times[i]), 4),
            "pitch": round(float(pitch[i]), 4),
            "timbre": round(float(timbre[i]), 4),
            "motion": round(float(motion[i]), 4),
            "amplitude": round(float(amplitude[i]), 4),
        })
    return features


SPEC_MELS = 64        # frequency bins in the spectrogram strip
SPEC_MAX_COLS = 256   # cap time columns so the JSON stays small


# Frequencies (Hz) labelled on the spectrogram's vertical axis. Only those below
# the Nyquist for the current sample rate are emitted. The mel→position math is
# done here (librosa side) so the frontend needs no mel formula.
SPEC_FREQ_TICKS_HZ = (250, 500, 1000, 2000, 4000, 8000)


def _mel_tick_positions(fmax: float) -> list[dict]:
    """For each labelled frequency < fmax, its fractional position (0=low/bottom,
    1=high/top) along the mel axis the spectrogram uses (fmin=0, Slaney mel)."""
    mel_hi = float(librosa.hz_to_mel(fmax, htk=False))
    ticks = []
    for hz in SPEC_FREQ_TICKS_HZ:
        if hz >= fmax:
            continue
        pos = float(librosa.hz_to_mel(hz, htk=False)) / mel_hi if mel_hi > 0 else 0.0
        label = f"{hz // 1000}k" if hz >= 1000 else str(hz)
        ticks.append({"hz": int(hz), "pos": round(pos, 4), "label": label})
    return ticks


def compute_spectrogram(path: str) -> dict:
    """Compact mel-spectrogram for the 2D strip.

    Returns {"bins", "cols", "data", "freq_ticks"} where `data` is a flat,
    column-major list of ints 0..255 (length bins*cols), each column low→high
    frequency, and `freq_ticks` is a list of {hz, pos, label} for the Hz axis
    (pos 0..1, low→high). Computed server-side (deterministic) and carried inside
    the feature JSON so the frontend needs no audio decoding and no extra file.
    """
    y, sr = _load_audio(path)
    if y.size == 0:
        return {"bins": 0, "cols": 0, "data": [], "freq_ticks": []}

    fmax = sr / 2
    S = librosa.feature.melspectrogram(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
        n_mels=SPEC_MELS, fmax=fmax,
    )
    S_db = librosa.power_to_db(S, ref=np.max)  # ~ -80..0 dB

    cols = S_db.shape[1]
    if cols > SPEC_MAX_COLS:
        idx = np.linspace(0, cols - 1, SPEC_MAX_COLS).round().astype(int)
        S_db = S_db[:, idx]
        cols = SPEC_MAX_COLS

    lo, hi = float(S_db.min()), float(S_db.max())
    if hi - lo < 1e-9:
        norm = np.zeros_like(S_db)
    else:
        norm = (S_db - lo) / (hi - lo)
    q = np.clip(np.round(norm * 255), 0, 255).astype(np.uint8)

    # Column-major flat list (each column = SPEC_MELS bins, low→high).
    data = q.T.reshape(-1).tolist()
    return {"bins": int(SPEC_MELS), "cols": int(cols), "data": data,
            "freq_ticks": _mel_tick_positions(fmax)}


def _self_check(path: str) -> int:
    """Run extraction on a file and print stats; return process exit code."""
    feats = extract_features(path)
    if not feats:
        print("FAIL: no features extracted (empty audio?)")
        return 1

    def col(name):
        return [f[name] for f in feats]

    def stats(name):
        v = col(name)
        return (min(v), max(v), sum(v) / len(v))

    dur = librosa.get_duration(path=path)
    # Density is measured over the ANALYZED span (t[0]..t[-1]) not the full file,
    # since boundary silence is now trimmed away (Part B) — dividing by the full
    # duration would understate density for a clip with leading/trailing silence.
    span = (feats[-1]["t"] - feats[0]["t"]) if len(feats) > 1 else dur
    pts_per_sec = len(feats) / span if span > 0 else 0.0

    print(f"file: {path}")
    print(f"duration: {dur:.3f} s (analyzed span {span:.3f} s after boundary trim)")
    print(f"point count: {len(feats)}  ({pts_per_sec:.1f} pts/sec over span, cap {MAX_POINTS})")
    for name in ("t", "pitch", "timbre", "motion", "amplitude"):
        mn, mx, mean = stats(name)
        print(f"  {name:9s} min={mn:10.4f}  max={mx:10.4f}  mean={mean:10.4f}")

    # Automated gates. pitch/timbre/motion are now FIXED world coords in
    # [-WORLD, WORLD]; amplitude is 0..1; density ~50 pts/sec (unless capped).
    all_vals = [v for name in ("t", "pitch", "timbre", "motion", "amplitude")
                for v in col(name)]
    has_bad = any(math.isnan(v) or math.isinf(v) for v in all_vals)
    amin, amax, _ = stats("amplitude")

    ok = True
    if has_bad:
        print("GATE FAIL: NaN/Inf present"); ok = False
    for axis in ("pitch", "timbre", "motion"):
        mn, mx, _ = stats(axis)
        if mn < -WORLD - 1e-6 or mx > WORLD + 1e-6:
            print(f"GATE FAIL: {axis} out of [-{WORLD}, {WORLD}] ({mn}..{mx})"); ok = False
    if not (0.0 <= amin and amax <= 1.0):
        print(f"GATE FAIL: amplitude out of 0..1 ({amin}..{amax})"); ok = False
    if len(feats) > MAX_POINTS:
        print(f"GATE FAIL: point count {len(feats)} > cap {MAX_POINTS}"); ok = False
    if len(feats) < MAX_POINTS and not (44.0 <= pts_per_sec <= 56.0):
        print(f"GATE FAIL: density {pts_per_sec:.1f} pts/sec outside 44..56"); ok = False

    print("\nsample (first 3 points):")
    print(json.dumps(feats[:3], indent=2))
    print("\nSELF-CHECK:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "test.wav"
    sys.exit(_self_check(target))
