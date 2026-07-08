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
FMIN = 65.0                  # pyin floor (~C2) — below typical fundamentals
FMAX = 2093.0                # pyin ceil (~C7) — covers speech, most birdsong
PITCH_CLAMP = (20.0, 4000.0)  # sanity clamp for the output (Hz)


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


def _carry_forward_pitch(f0: np.ndarray, voiced: np.ndarray) -> np.ndarray:
    """Replace unvoiced/NaN pitch frames with the last voiced value.

    Leading unvoiced frames (before any voiced frame) are back-filled with the
    first voiced value so the trail never starts at 0 Hz. If the whole clip is
    unvoiced, fall back to a neutral mid pitch so downstream math is finite.
    """
    out = np.array(f0, dtype=float)
    valid = voiced & np.isfinite(out) & (out > 0)
    if not valid.any():
        # Nothing voiced anywhere — neutral filler, keeps trail finite.
        return np.full_like(out, 220.0)

    last = None
    for i in range(len(out)):
        if valid[i]:
            last = out[i]
        elif last is not None:
            out[i] = last
        # else: leading unvoiced, handled by back-fill below
    # Back-fill any leading gap with the first voiced value.
    first_valid_idx = int(np.argmax(valid))
    out[:first_valid_idx] = out[first_valid_idx]
    return out


def extract_features(path: str, max_points: int = MAX_POINTS) -> list[dict]:
    """Extract per-frame features from an audio file.

    Returns a list of {t, pitch, timbre, motion, amplitude} dicts, downsampled
    so len(result) <= max_points. Never returns NaN/Inf.
    """
    y, sr = _load_audio(path)

    if y.size == 0:
        return []

    # --- pitch (fundamental frequency) ---
    # pyin returns f0 (Hz, NaN where unvoiced), voiced_flag, voiced_prob.
    f0, voiced_flag, _ = librosa.pyin(
        y, sr=sr, fmin=FMIN, fmax=FMAX,
        frame_length=N_FFT, hop_length=HOP_LENGTH,
    )
    pitch = _carry_forward_pitch(f0, voiced_flag)
    pitch = np.clip(pitch, PITCH_CLAMP[0], PITCH_CLAMP[1])

    # --- timbre (spectral centroid, log-scaled) ---
    centroid = librosa.feature.spectral_centroid(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
    )[0]
    # log2(Hz) compresses the wide centroid range into a compact, perceptually
    # even scalar. Reference 55 Hz (A1) keeps values positive and small.
    centroid = np.nan_to_num(centroid, nan=55.0)
    centroid = np.maximum(centroid, 1.0)
    timbre = np.log2(centroid / 55.0)  # typically ~2..8 for real audio

    # --- motion (onset strength) ---
    motion = librosa.onset.onset_strength(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
    )

    # --- amplitude (RMS energy, normalized) ---
    rms = librosa.feature.rms(
        y=y, frame_length=N_FFT, hop_length=HOP_LENGTH,
    )[0]
    amplitude = _normalize(rms)

    # librosa's per-frame features can differ by a frame; align to the shortest.
    n = min(len(pitch), len(timbre), len(motion), len(amplitude))
    pitch = pitch[:n]
    timbre = timbre[:n]
    motion = _normalize(motion[:n])  # normalize motion 0..1 for a stable axis
    amplitude = amplitude[:n]

    times = librosa.frames_to_samples(np.arange(n), hop_length=HOP_LENGTH) / sr

    # --- downsample to <= max_points by uniform striding ---
    if n > max_points:
        idx = np.linspace(0, n - 1, max_points).round().astype(int)
    else:
        idx = np.arange(n)

    features: list[dict] = []
    for i in idx:
        features.append({
            "t": round(float(times[i]), 4),
            "pitch": round(float(pitch[i]), 2),
            "timbre": round(float(timbre[i]), 4),
            "motion": round(float(motion[i]), 4),
            "amplitude": round(float(amplitude[i]), 4),
        })
    return features


SPEC_MELS = 64        # frequency bins in the spectrogram strip
SPEC_MAX_COLS = 256   # cap time columns so the JSON stays small


def compute_spectrogram(path: str) -> dict:
    """Compact mel-spectrogram for the 2D strip.

    Returns {"bins", "cols", "data"} where `data` is a flat, column-major list
    of ints 0..255 (length bins*cols), each column low→high frequency. Computed
    server-side (deterministic) and carried inside the feature JSON so the
    frontend needs no audio decoding and no extra endpoint/file.
    """
    y, sr = _load_audio(path)
    if y.size == 0:
        return {"bins": 0, "cols": 0, "data": []}

    S = librosa.feature.melspectrogram(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP_LENGTH,
        n_mels=SPEC_MELS, fmax=sr / 2,
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
    return {"bins": int(SPEC_MELS), "cols": int(cols), "data": data}


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
    expected = int(dur / (HOP_LENGTH / SAMPLE_RATE))

    print(f"file: {path}")
    print(f"duration: {dur:.3f} s")
    print(f"point count: {len(feats)}  (raw frames ~{expected}, cap {MAX_POINTS})")
    for name in ("t", "pitch", "timbre", "motion", "amplitude"):
        mn, mx, mean = stats(name)
        print(f"  {name:9s} min={mn:10.4f}  max={mx:10.4f}  mean={mean:10.4f}")

    # Automated gates
    all_vals = [v for name in ("t", "pitch", "timbre", "motion", "amplitude")
                for v in col(name)]
    has_bad = any(math.isnan(v) or math.isinf(v) for v in all_vals)
    pmin, pmax, _ = stats("pitch")
    amin, amax, _ = stats("amplitude")

    ok = True
    if has_bad:
        print("GATE FAIL: NaN/Inf present"); ok = False
    if not (20.0 <= pmin and pmax <= 4000.0):
        print(f"GATE FAIL: pitch out of 20..4000 Hz ({pmin}..{pmax})"); ok = False
    if not (0.0 <= amin and amax <= 1.0):
        print(f"GATE FAIL: amplitude out of 0..1 ({amin}..{amax})"); ok = False
    if len(feats) > MAX_POINTS:
        print(f"GATE FAIL: point count {len(feats)} > cap {MAX_POINTS}"); ok = False

    print("\nsample (first 3 points):")
    print(json.dumps(feats[:3], indent=2))
    print("\nSELF-CHECK:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "test.wav"
    sys.exit(_self_check(target))
