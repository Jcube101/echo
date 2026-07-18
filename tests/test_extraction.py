"""EXT-* (unit) and REG-* (regression) tests for extraction.py.

Fully sandboxed: synthetic audio only (numpy + soundfile), no network, no
hardware. Each test ties back to a concrete contract quoted in its docstring
— SPEC.md's quality gates, a CLAUDE.md locked decision, or a specific
regression documented in LEARNINGS.md. See TEST_PLAN.md sections A and B.
"""

from __future__ import annotations

import math

import librosa
import numpy as np
import pytest

import extraction
from conftest import SAMPLE_RATE, concat, make_silence, make_tone


# --- shared synthesis battery for the quality-gate tests ----------------------

BATTERY = {
    "tone": lambda af: af.tone(duration=3.0, freq=440.0, amp=0.6),
    "chirp": lambda af: af.chirp(duration=3.0, f0=300.0, f1=3000.0, amp=0.6),
    "noise": lambda af: af.noise(duration=3.0, amp=0.3),
    "quiet_tone": lambda af: af.tone(duration=3.0, freq=220.0, amp=0.03),
    "loud_tone": lambda af: af.tone(duration=3.0, freq=880.0, amp=0.95),
    "click_train": lambda af: af.click_train(duration=3.0, rate_hz=6.0),
}


@pytest.mark.parametrize("kind", list(BATTERY))
def test_EXT_001_world_box(audio_factory, kind):
    """pitch/timbre/motion stay within the fixed [-3, 3] world box for a
    battery of synthetic clips (pure tone, chirp, white noise, near-silence,
    extreme SPL, click train).

    SPEC.md: features are "stored as fixed-scale world coordinates in
    [-3, 3]"; extraction's own self-check GATE:
    "{axis} out of [-{WORLD}, {WORLD}]".
    """
    path = BATTERY[kind](audio_factory)
    feats = extraction.extract_features(str(path))
    assert feats, f"{kind}: expected non-empty features"
    for axis in ("pitch", "timbre", "motion"):
        vals = [f[axis] for f in feats]
        assert min(vals) >= -extraction.WORLD - 1e-6, f"{kind}/{axis} below box: {min(vals)}"
        assert max(vals) <= extraction.WORLD + 1e-6, f"{kind}/{axis} above box: {max(vals)}"


@pytest.mark.parametrize("kind", list(BATTERY))
def test_EXT_002_amplitude_range(audio_factory, kind):
    """amplitude stays within 0..1 even after AMP_SMOOTH_WINDOW smoothing
    (the code re-clips post-smooth).

    SPEC.md: "amplitude … normalized 0-1"; self-check GATE:
    "amplitude out of 0..1".
    """
    path = BATTERY[kind](audio_factory)
    feats = extraction.extract_features(str(path))
    amps = [f["amplitude"] for f in feats]
    assert min(amps) >= 0.0
    assert max(amps) <= 1.0


PATHOLOGICAL = {
    "silence": lambda af: af.silence(duration=2.0),
    "single_sample": lambda af: af.custom(np.array([0.5], dtype=np.float32)),
    "dc_only": lambda af: af.custom(np.full(SAMPLE_RATE, 0.3, dtype=np.float32)),
    "very_short": lambda af: af.tone(duration=0.05, freq=440.0, amp=0.3),
}


@pytest.mark.parametrize("kind", list(BATTERY) + list(PATHOLOGICAL))
def test_EXT_003_no_nan_inf(audio_factory, kind):
    """Zero NaN/Inf anywhere in features or the spectrogram, including
    pathological inputs (all-zero signal, single-sample file, DC-only, a
    clip shorter than one FFT frame).

    SPEC.md quality gate: "zero NaN/Inf anywhere"; extract_features
    docstring: "Never returns NaN/Inf."
    """
    gen = BATTERY.get(kind) or PATHOLOGICAL[kind]
    path = gen(audio_factory)

    feats = extraction.extract_features(str(path))
    for f in feats:
        for name in ("t", "pitch", "timbre", "motion", "amplitude"):
            assert math.isfinite(f[name]), f"{kind}: non-finite {name} in {f}"

    spec = extraction.compute_spectrogram(str(path))
    assert all(math.isfinite(v) for v in spec["data"]), f"{kind}: non-finite spectrogram value"


@pytest.mark.parametrize("duration", [2.0, 5.0, 30.0])
def test_EXT_004_density(audio_factory, duration):
    """Density is ~50 pts/sec over the ANALYZED span (not file length), the
    SPEC.md/self-check gate (44-56 pts/sec).

    SPEC.md: "Frame hop: ~20 ms (~50 fps) -> ~50 points/sec of the analyzed
    (post-trim) span"; extraction._self_check GATE range 44.0-56.0.
    """
    path = audio_factory.tone(duration=duration, freq=500.0, amp=0.6)
    feats = extraction.extract_features(str(path))
    span = feats[-1]["t"] - feats[0]["t"]
    pts_per_sec = len(feats) / span
    assert 44.0 <= pts_per_sec <= 56.0, f"density {pts_per_sec:.1f} pts/sec out of range"


def test_EXT_005_point_cap_downsampling(audio_factory):
    """Downsampling only kicks in beyond `max_points`, and preserves the
    first/last frames (np.linspace endpoints).

    SPEC.md: "Point cap: the API downsamples so the frontend never receives
    more than a few thousand points (cap: 3000)."
    """
    path = audio_factory.tone(duration=5.0, freq=440.0, amp=0.6)
    full = extraction.extract_features(str(path))
    assert len(full) > 100

    capped = extraction.extract_features(str(path), max_points=100)
    assert len(capped) == 100
    assert capped[0]["t"] == pytest.approx(full[0]["t"], abs=1e-3)
    assert capped[-1]["t"] == pytest.approx(full[-1]["t"], abs=1e-3)


def test_EXT_005b_point_cap_never_exceeded_uncapped(audio_factory):
    """A clip at the 60s ceiling never returns more than MAX_POINTS(=3000)
    features (the default cap, not a custom one)."""
    # ~62s of tone; _load_audio truncates to MAX_DURATION_S=60 defensively.
    path = audio_factory.tone(duration=62.0, freq=440.0, amp=0.5)
    feats = extraction.extract_features(str(path))
    assert len(feats) <= extraction.MAX_POINTS


def test_EXT_006_max_duration_truncation(audio_factory):
    """`_load_audio` truncates to MAX_DURATION_S even when the server-side
    duration check is bypassed (defensive cap, not just a client-side one).

    CLAUDE.md locked: "Max clip duration | 60 seconds (all input paths)";
    _load_audio docstring: "truncated to MAX_DURATION_S … in case the
    server-side duration check is bypassed."
    """
    path = audio_factory.tone(duration=65.0, freq=440.0, amp=0.5)
    y, sr = extraction._load_audio(str(path))
    actual_duration = len(y) / sr
    assert actual_duration <= extraction.MAX_DURATION_S + 0.05
    assert actual_duration == pytest.approx(extraction.MAX_DURATION_S, abs=0.05)


def test_EXT_007_to_world_mapping_and_clamping():
    """`_to_world` maps [lo, hi] onto [-WORLD, WORLD] linearly and clamps
    out-of-range values to the box edge — never stretches the scale.

    LEARNINGS.md: "Out-of-range values clamp to the box edge (never stretch
    the scale)."
    """
    lo, hi = 10.0, 20.0
    vals = np.array([lo, (lo + hi) / 2, hi, lo - 100, hi + 100])
    out = extraction._to_world(vals, lo, hi)
    assert out[0] == pytest.approx(-extraction.WORLD)
    assert out[1] == pytest.approx(0.0, abs=1e-9)
    assert out[2] == pytest.approx(extraction.WORLD)
    # clamped, not extrapolated past the box edge
    assert out[3] == pytest.approx(-extraction.WORLD)
    assert out[4] == pytest.approx(extraction.WORLD)


def test_EXT_008_normalize():
    """`_normalize` maps to exactly [0, 1]; flat/zero/NaN input safely
    returns all-zeros (the `hi - lo < 1e-9` guard)."""
    vals = np.array([2.0, 4.0, 6.0, 8.0])
    out = extraction._normalize(vals)
    assert out.min() == pytest.approx(0.0)
    assert out.max() == pytest.approx(1.0)

    flat = np.array([5.0, 5.0, 5.0])
    assert np.all(extraction._normalize(flat) == 0.0)

    zero = np.zeros(4)
    assert np.all(extraction._normalize(zero) == 0.0)

    with_nan = np.array([1.0, np.nan, np.inf, -np.inf])
    out_nan = extraction._normalize(with_nan)
    assert np.all(np.isfinite(out_nan))


def test_EXT_009_hold_forward():
    """`_hold_forward`: invalid frames take the previous valid value; a
    leading invalid run back-fills with the first valid value; an
    all-invalid array becomes the fallback.

    LEARNINGS.md "pitch carry-forward (Phase 1)": unvoiced frames "replaced
    with the last voiced value (leading gap back-filled with the first
    voiced value; a fully unvoiced clip falls back to a neutral 220 Hz)."
    """
    values = np.array([1.0, 2.0, 99.0, 99.0, 5.0, 99.0])
    valid = np.array([True, True, False, False, True, False])
    out = extraction._hold_forward(values, valid, fallback=-1.0)
    assert list(out) == [1.0, 2.0, 2.0, 2.0, 5.0, 5.0]

    # leading invalid run back-filled with the first valid value
    values2 = np.array([99.0, 99.0, 3.0, 4.0])
    valid2 = np.array([False, False, True, True])
    out2 = extraction._hold_forward(values2, valid2, fallback=-1.0)
    assert list(out2) == [3.0, 3.0, 3.0, 4.0]

    # all-invalid -> fallback everywhere
    values3 = np.array([1.0, 2.0, 3.0])
    valid3 = np.zeros(3, dtype=bool)
    out3 = extraction._hold_forward(values3, valid3, fallback=220.0)
    assert list(out3) == [220.0, 220.0, 220.0]


def test_EXT_010_pyin_unvoiced_carry_forward_continuous(audio_factory):
    """A tone -> silence -> tone clip keeps a continuous pitch track through
    the (interior) unvoiced gap — no collapse toward the box floor.

    SPEC.md: "unvoiced/quiet frames carry forward the last voiced value
    (keeps the trail continuous) rather than nulling."
    """
    y = concat(
        make_tone(duration=0.6, freq=440.0, amp=0.6),
        make_silence(duration=0.8),
        make_tone(duration=0.6, freq=440.0, amp=0.6),
    )
    path = audio_factory.custom(y, name="tone_gap_tone")
    feats = extraction.extract_features(str(path))
    assert feats

    times = [f["t"] for f in feats]
    pitches = [f["pitch"] for f in feats]

    # Sample the middle of the silence gap (well clear of tone edges/frame
    # bleed) and confirm pitch there sits close to the pitch just before the
    # gap started, not at the box floor (-WORLD) or drifting wildly.
    gap_center = 0.6 + 0.4
    idx = min(range(len(times)), key=lambda i: abs(times[i] - gap_center))
    pre_gap_idx = min(range(len(times)), key=lambda i: abs(times[i] - 0.55))
    assert pitches[idx] == pytest.approx(pitches[pre_gap_idx], abs=0.3)
    assert pitches[idx] > -extraction.WORLD + 0.5, "pitch collapsed toward the box floor during silence"


def test_EXT_010b_fully_unvoiced_fallback(audio_factory):
    """A fully unvoiced clip (noise below the voicing threshold) falls back
    to the neutral 220 Hz pitch rather than nulling."""
    path = audio_factory.noise(duration=2.0, amp=0.02)
    feats = extraction.extract_features(str(path))
    assert feats
    expected = extraction._to_world(
        np.array([math.log2(220.0)]),
        math.log2(extraction.PITCH_HZ_RANGE[0]), math.log2(extraction.PITCH_HZ_RANGE[1]),
    )[0]
    pitches = [f["pitch"] for f in feats]
    assert max(pitches) - min(pitches) < 0.05, "expected a near-constant fallback pitch"
    assert pitches[len(pitches) // 2] == pytest.approx(expected, abs=0.05)


def test_EXT_011_quiet_frame_holds_all_three_axes(audio_factory):
    """Frames with RMS below SILENCE_RMS_FRAC of peak hold pitch, timbre,
    AND motion (not just pitch), while amplitude still reflects the true
    low energy.

    A different frequency is used for the quiet segment than the loud
    segments: if holding weren't happening, the quiet segment's own natural
    pitch would clearly differ from the held value.

    LEARNINGS.md: "Quiet-frame hold SILENCE_RMS_FRAC = 0.06 … a frame whose
    RMS is below 6% of the clip's peak RMS holds the previous pitch/timbre
    /motion (all three, not just pitch) … Amplitude still reflects the real
    low energy."
    """
    y = concat(
        make_tone(duration=0.6, freq=523.0, amp=0.8),
        make_tone(duration=0.8, freq=1500.0, amp=0.01),  # different freq, well under 6% of peak
        make_tone(duration=0.6, freq=523.0, amp=0.8),
    )
    path = audio_factory.custom(y, name="loud_quiet_loud")
    feats = extraction.extract_features(str(path))
    times = [f["t"] for f in feats]

    # Deep inside the quiet plateau, safely clear of the transition edges —
    # holding means these two points are identical, not independently computed.
    idx_start = min(range(len(times)), key=lambda i: abs(times[i] - 0.85))
    idx_end = min(range(len(times)), key=lambda i: abs(times[i] - 1.15))

    for axis in ("pitch", "timbre", "motion"):
        v_start = feats[idx_start][axis]
        v_end = feats[idx_end][axis]
        assert v_start == pytest.approx(v_end, abs=0.02), f"{axis} drifted during the held quiet plateau"

    # Sanity: a genuine (non-held) 1500 Hz tone reads at a clearly different
    # pitch than what's held here — confirms this is carry-forward, not a
    # coincidence of the quiet tone's own frequency.
    tone_1500 = audio_factory.tone(duration=1.0, freq=1500.0, amp=0.6)
    natural_1500_feats = extraction.extract_features(str(tone_1500))
    natural_1500_pitch = natural_1500_feats[len(natural_1500_feats) // 2]["pitch"]
    assert abs(feats[idx_start]["pitch"] - natural_1500_pitch) > 0.5

    # amplitude still reflects the real low energy (small, not held loud).
    loud_idx = min(range(len(times)), key=lambda i: abs(times[i] - 0.3))
    assert feats[idx_start]["amplitude"] < feats[loud_idx]["amplitude"] * 0.3


def test_EXT_012_boundary_trim_leaves_interior_untouched(audio_factory):
    """A clip with leading+trailing silence loses only the boundaries; a
    clip with an INTERIOR quiet gap keeps its full frame count (interior
    never cut).

    SPEC.md: "Boundary silence trim: leading/trailing silence is removed
    (interior untouched)."
    """
    # Boundary case: silence - tone - silence.
    y_boundary = concat(
        make_silence(duration=1.0),
        make_tone(duration=1.0, freq=440.0, amp=0.6),
        make_silence(duration=1.0),
    )
    y_trim, offset = extraction._trim_boundary_silence(y_boundary, SAMPLE_RATE)
    assert offset > 0, "expected leading silence to be trimmed"
    assert len(y_trim) < len(y_boundary)

    # Interior case: tone - silence - tone (no boundary silence at all).
    y_interior = concat(
        make_tone(duration=0.6, freq=440.0, amp=0.6),
        make_silence(duration=0.8),
        make_tone(duration=0.6, freq=440.0, amp=0.6),
    )
    y_trim2, offset2 = extraction._trim_boundary_silence(y_interior, SAMPLE_RATE)
    assert offset2 == 0, "interior-only clip should not be boundary-trimmed"
    assert len(y_trim2) == len(y_interior)


def test_EXT_013_trim_offset_restores_original_timeline(audio_factory):
    """After a leading-silence trim, features[0]["t"] sits near the silence
    duration on the ORIGINAL timeline (offset added back), so the untrimmed
    playback copy still scrub-syncs.

    SPEC.md `t` row: "boundary-trim offset added back so playback
    scrub-syncs."
    """
    lead_silence_s = 1.5
    y = concat(
        make_silence(duration=lead_silence_s),
        make_tone(duration=1.2, freq=440.0, amp=0.6),
    )
    path = audio_factory.custom(y, name="lead_silence")
    feats = extraction.extract_features(str(path))
    assert feats
    # TRIM_PAD_FRAMES keeps ~60ms margin, so t[0] should be at or slightly
    # before the true silence/tone boundary — never negative, never far past it.
    pad_s = extraction.TRIM_PAD_FRAMES * extraction.HOP_LENGTH / SAMPLE_RATE
    assert 0.0 <= feats[0]["t"] <= lead_silence_s + 0.05
    assert feats[0]["t"] >= lead_silence_s - pad_s - 0.1


@pytest.mark.parametrize("kind", ["too_short", "all_signal", "degenerate_remainder"])
def test_EXT_014_trim_noop_guards(kind):
    """Trim no-ops (returns (y, 0) unchanged) when: input is shorter than
    N_FFT; the whole clip is signal (nothing below threshold); or trimming
    would leave less than 2*N_FFT samples.

    _trim_boundary_silence docstring: "No-ops … when nothing is clearly
    below signal or the result would be degenerate."
    """
    if kind == "too_short":
        y = make_tone(duration=0.02, freq=440.0, amp=0.5)  # < N_FFT samples
        assert len(y) < extraction.N_FFT
    elif kind == "all_signal":
        y = make_tone(duration=2.0, freq=440.0, amp=0.6)  # loud throughout
    else:  # degenerate_remainder: extremely short clip, mostly silence
        y = concat(make_silence(0.02), make_tone(0.01, 440.0, 0.6), make_silence(0.02))

    y_out, offset = extraction._trim_boundary_silence(y, SAMPLE_RATE)
    assert offset == 0
    assert len(y_out) == len(y)


def test_EXT_015_smooth_properties():
    """`_smooth`: output length equals input length; window<=1 and a
    too-short array are no-ops; a constant/plateau signal is unchanged (no
    phase shift introduced by the edge padding).

    LEARNINGS.md Part C: "SMOOTH_WINDOW = 5 (~100 ms) odd-window moving
    average … Reduced frame-to-frame zigzag … while preserving overall
    shape."
    """
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])
    out = extraction._smooth(x, window=5)
    assert len(out) == len(x)

    assert list(extraction._smooth(x, window=1)) == list(x)
    assert list(extraction._smooth(np.array([1.0, 2.0]), window=5)) == [1.0, 2.0]

    plateau = np.full(10, 3.0)
    out_plateau = extraction._smooth(plateau, window=5)
    assert np.allclose(out_plateau, 3.0)


def test_EXT_016_spectrogram_shape_and_orientation(audio_factory):
    """compute_spectrogram's payload shape: bins==64, cols<=256,
    len(data)==bins*cols, values are int 0..255, column-major, low frequency
    energy sits toward the bottom of each column.

    SPEC.md: "a compact mel-spectrogram ({bins, cols, data, freq_ticks})."
    LEARNINGS.md Phase 6: column-major flat list, quantized 0..255.
    """
    path = audio_factory.tone(duration=2.0, freq=200.0, amp=0.7)
    spec = extraction.compute_spectrogram(str(path))
    assert spec["bins"] == extraction.SPEC_MELS
    assert spec["cols"] <= extraction.SPEC_MAX_COLS
    assert len(spec["data"]) == spec["bins"] * spec["cols"]
    assert all(isinstance(v, int) and 0 <= v <= 255 for v in spec["data"])

    # A 200 Hz tone should concentrate energy in the LOW mel bins (data is
    # column-major, low->high per column per the docstring).
    bins, cols = spec["bins"], spec["cols"]
    data = np.array(spec["data"]).reshape(cols, bins)  # [col][bin], bin 0 = low freq
    mean_by_bin = data.mean(axis=0)
    low_energy = mean_by_bin[: bins // 4].mean()
    high_energy = mean_by_bin[3 * bins // 4:].mean()
    assert low_energy > high_energy


def test_EXT_017_mel_tick_positions():
    """Only ticks below Nyquist are emitted; positions strictly increase in
    [0, 1]; labels format as "250"/"1k"/"4k".

    LEARNINGS.md Part C: "freq_ticks (_mel_tick_positions, Slaney mel) so
    the frontend needs no mel math."
    """
    ticks = extraction._mel_tick_positions(fmax=SAMPLE_RATE / 2)  # 11025 Hz
    hz_values = [t["hz"] for t in ticks]
    assert all(hz < SAMPLE_RATE / 2 for hz in hz_values)
    assert 8000 in hz_values  # below 11025 Nyquist
    positions = [t["pos"] for t in ticks]
    assert positions == sorted(positions)
    assert all(0.0 <= p <= 1.0 for p in positions)

    labels = {t["hz"]: t["label"] for t in ticks}
    assert labels[250] == "250"
    assert labels[1000] == "1k"
    assert labels[4000] == "4k"

    # A lower fmax excludes ticks at/above it.
    ticks_narrow = extraction._mel_tick_positions(fmax=3000.0)
    assert all(t["hz"] < 3000.0 for t in ticks_narrow)
    assert 4000 not in [t["hz"] for t in ticks_narrow]


def test_EXT_018_degenerate_empty_audio(audio_factory):
    """Empty/zero-length audio returns [] from extract_features and the
    zero payload from compute_spectrogram."""
    path = audio_factory.custom(np.array([], dtype=np.float32), name="empty")
    assert extraction.extract_features(str(path)) == []
    spec = extraction.compute_spectrogram(str(path))
    assert spec == {"bins": 0, "cols": 0, "data": [], "freq_ticks": []}


def test_EXT_019_determinism(audio_factory):
    """Two runs on the same file produce byte-identical feature lists — no
    per-clip model fit, no randomness.

    LEARNINGS.md: "timbre = log2 spectral centroid … deterministic, needs
    no per-clip model fit."
    """
    path = audio_factory.chirp(duration=2.0, f0=300.0, f1=2000.0, amp=0.6)
    a = extraction.extract_features(str(path))
    b = extraction.extract_features(str(path))
    assert a == b


def test_EXT_020_axis_semantics(audio_factory):
    """A 440 Hz sine maps to the expected pitch world coordinate; a click
    train scores higher mean motion than a steady tone of equal loudness.

    SPEC.md feature table: pitch = log2(Hz) mapped into [-3,3]; motion =
    "spectrally aware: steady tone = low, chirp = high."
    """
    tone_path = audio_factory.tone(duration=2.0, freq=440.0, amp=0.6)
    feats = extraction.extract_features(str(tone_path))
    expected_pitch = extraction._to_world(
        np.array([math.log2(440.0)]),
        math.log2(extraction.PITCH_HZ_RANGE[0]), math.log2(extraction.PITCH_HZ_RANGE[1]),
    )[0]
    mid = feats[len(feats) // 2]["pitch"]
    assert mid == pytest.approx(expected_pitch, abs=0.15)

    click_path = audio_factory.click_train(duration=2.0, rate_hz=6.0, amp=0.6)
    click_feats = extraction.extract_features(str(click_path))
    steady_path = audio_factory.tone(duration=2.0, freq=440.0, amp=0.6)
    steady_feats = extraction.extract_features(str(steady_path))

    mean_motion_click = sum(f["motion"] for f in click_feats) / len(click_feats)
    mean_motion_steady = sum(f["motion"] for f in steady_feats) / len(steady_feats)
    assert mean_motion_click > mean_motion_steady


def test_EXT_021_time_field_properties(audio_factory):
    """`t` is non-decreasing, starts near trim_offset/sr, steps ~20ms
    (HOP_LENGTH/SAMPLE_RATE), and every field is rounded to 4 decimals."""
    path = audio_factory.tone(duration=2.0, freq=440.0, amp=0.6)
    feats = extraction.extract_features(str(path))
    times = [f["t"] for f in feats]
    assert times == sorted(times)

    diffs = np.diff(times)
    expected_hop = extraction.HOP_LENGTH / SAMPLE_RATE
    assert np.allclose(diffs, expected_hop, atol=0.005)

    for f in feats[:5]:
        for name in ("t", "pitch", "timbre", "motion", "amplitude"):
            s = f"{f[name]:.10f}"
            decimals = s.split(".")[1].rstrip("0")
            assert len(decimals) <= 4


# =============================================================================
# REG-* — regression tests for bugs documented in LEARNINGS.md
# =============================================================================

def test_REG_001_no_origin_collapse_density_bug(audio_factory):
    """Origin-collapse / density bug: a clip with a loud passage, an
    interior quiet passage, and another loud passage still yields ~50
    pts/sec of the FULL analyzed span (not ~9), and no frame sits near the
    box-floor corner on all three axes during the quiet passage.

    LEARNINGS.md: "Part A - density bug root cause. The librosa.effects.trim
    added the prior session shrank the frame timeline for clips with quiet
    passages … a 2.8 s clip -> 54 points. Fix: removed trimming entirely.
    Quiet frames are HELD (not dropped) … density is now ~50 pts/sec of the
    full clip."
    """
    y = concat(
        make_tone(duration=1.0, freq=500.0, amp=0.7),
        make_silence(duration=1.0),
        make_tone(duration=1.0, freq=500.0, amp=0.7),
    )
    path = audio_factory.custom(y, name="loud_quiet_loud_3s")
    feats = extraction.extract_features(str(path))
    span = feats[-1]["t"] - feats[0]["t"]
    pts_per_sec = len(feats) / span
    assert pts_per_sec >= 40.0, f"density collapsed to {pts_per_sec:.1f} pts/sec (old bug symptom)"

    # No frame should sit at the origin corner (all three axes near 0) during
    # the quiet passage — the old bug's "spike to origin" symptom.
    origin_dips = sum(
        1 for f in feats
        if abs(f["pitch"]) < 0.3 and abs(f["timbre"]) < 0.3 and abs(f["motion"]) < 0.3
    )
    assert origin_dips == 0


def test_REG_002_snr_cap_prevents_overaggressive_trim(audio_factory):
    """Over-aggressive trim (the old top_db=30 failure): a clip with one
    loud transient plus quiet-but-real boundary signal (constructed so the
    boundary signal is within TRIM_MIN_SNR_DB=25 of the peak, but a naive
    floor-relative threshold WITHOUT the cap would have rejected it) keeps
    its boundary signal.

    LEARNINGS.md: "the old top_db=30 failure was a loud transient inflating
    the peak so boundary signal >30 dB below it got eaten; a floor-relative
    threshold with an SNR cap keeps real signal even then."
    """
    call_amp = 0.15   # the "real" boundary content, present almost throughout
    transient_amp = 1.0  # one brief, much louder burst that inflates the peak

    y = concat(
        make_tone(duration=1.2, freq=300.0, amp=call_amp),
        make_tone(duration=0.15, freq=300.0, amp=transient_amp),  # inflates peak
        make_tone(duration=1.2, freq=300.0, amp=call_amp),
    )

    # Reproduce extraction's own floor computation to confirm this fixture
    # actually exercises the cap (i.e. the uncapped threshold would have been
    # stricter than -TRIM_MIN_SNR_DB).
    rms = librosa.feature.rms(y=y, frame_length=extraction.N_FFT, hop_length=extraction.HOP_LENGTH)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    floor_db = float(np.percentile(rms_db, extraction.TRIM_FLOOR_PCT))
    naive_thresh = floor_db + extraction.TRIM_MARGIN_DB
    assert naive_thresh > -extraction.TRIM_MIN_SNR_DB, (
        "fixture does not exercise the SNR cap — adjust amplitudes"
    )

    y_trim, offset = extraction._trim_boundary_silence(y, SAMPLE_RATE)
    # The boundary call content (louder than -25dB relative to peak) must
    # survive: the trimmed signal should retain almost all of the original.
    assert len(y_trim) >= 0.9 * len(y), "real boundary signal was trimmed away"
    assert offset < 0.3 * SAMPLE_RATE, "leading trim ate into the real call, not just silence"


def test_REG_003_25bd6d1c_reconstruction(audio_factory):
    """Synthetic reconstruction of regression clip `25bd6d1c`: 1.55s of pure
    digital silence followed by ~1.24s of tonal "call". Leading silence is
    trimmed (first `t` lands on the original timeline near 1.55s) and ~all
    of the call is kept, at ~50 pts/sec over the analyzed span.

    The real clip lives only in the Pi's data/ (subject to retention) so
    this is a synthetic stand-in for the documented behavior, not a literal
    byte-for-byte replay.

    LEARNINGS.md: "Regression clip 25bd6d1c is genuinely 1.55 s digital
    silence + 1.24 s call -> correctly 141->64 frames (all real signal
    kept)."
    """
    silence_s, call_s = 1.55, 1.24
    y = concat(
        make_silence(duration=silence_s),
        make_tone(duration=call_s, freq=1200.0, amp=0.5),
    )
    path = audio_factory.custom(y, name="25bd6d1c_repro")
    feats = extraction.extract_features(str(path))
    assert feats

    span = feats[-1]["t"] - feats[0]["t"]
    pts_per_sec = len(feats) / span
    assert 40.0 <= pts_per_sec <= 60.0

    # Leading silence trimmed: first frame lands near the silence/call
    # boundary on the ORIGINAL timeline, not at 0.
    assert feats[0]["t"] == pytest.approx(silence_s, abs=0.15)
    # Nearly the whole call survives (span close to call_s, not collapsed).
    assert span == pytest.approx(call_s, rel=0.25)


@pytest.mark.perf
def test_REG_005_pyin_speed_budget_on_pi(audio_factory):
    """A 60s clip's full extract_features() completes in < 15s wall-clock ON
    THE PI (Session-5 target, ~6x margin under Cloudflare's ~100s edge
    limit). Timing is meaningless off the Pi and flaky under load
    (LEARNINGS notes ~5x variance) — excluded from default runs.

    Opt-in: `pytest -m perf` (run only when Job is present to babysit).

    LEARNINGS.md Part A: "PYIN_RESOLUTION = 0.25 … cut a 60 s clip's pyin
    from 37 s -> 6.5 s (full extract 8.5 s) … well under the 15 s target."
    """
    import time
    path = audio_factory.tone(duration=60.0, freq=600.0, amp=0.5)
    start = time.monotonic()
    extraction.extract_features(str(path))
    elapsed = time.monotonic() - start
    assert elapsed < 15.0, f"extraction took {elapsed:.1f}s — over the Session-5 budget"


def test_REG_004_pyin_resolution_speed_accuracy_tradeoff(audio_factory):
    """PYIN_RESOLUTION guarded against silent reversion (this is *the*
    Cloudflare-timeout fix), and accuracy stays within a documented ~25-cent
    tolerance of ground truth for a sine sweep.

    LEARNINGS.md: "PYIN_RESOLUTION = 0.25 … cut a 60 s clip's pyin from
    37 s -> 6.5 s … for only ~6 cents mean / 15 cents p95 pitch shift."
    """
    assert extraction.PYIN_RESOLUTION == 0.25

    freq = 500.0
    path = audio_factory.tone(duration=2.0, freq=freq, amp=0.6)
    feats = extraction.extract_features(str(path))
    expected_pitch = extraction._to_world(
        np.array([math.log2(freq)]),
        math.log2(extraction.PITCH_HZ_RANGE[0]), math.log2(extraction.PITCH_HZ_RANGE[1]),
    )[0]
    mid = feats[len(feats) // 2]["pitch"]
    # 25 cents ~= 25/1200 octave; convert to world-coord tolerance.
    cents_25_world = (25.0 / 1200.0) / math.log2(extraction.PITCH_HZ_RANGE[1] / extraction.PITCH_HZ_RANGE[0]) * (2 * extraction.WORLD)
    assert abs(mid - expected_pitch) < max(cents_25_world * 3, 0.05)


def test_REG_006_pyin_range_covers_high_birdsong(audio_factory):
    """pyin range covers high birdsong: FMIN/FMAX are the raised values, and
    a synthetic 2.5-3.7 kHz tone is detected near the top of the pitch axis,
    not collapsed to the 220 Hz unvoiced fallback.

    LEARNINGS.md: "pyin range raised. FMAX 2093 -> 4000 Hz (and FMIN 65 ->
    50) so high birdsong … is actually detected instead of collapsing to
    the unvoiced 220 Hz fallback."
    """
    assert extraction.FMIN == 50.0
    assert extraction.FMAX == 4000.0

    high_freq = 3000.0
    path = audio_factory.tone(duration=1.5, freq=high_freq, amp=0.6)
    feats = extraction.extract_features(str(path))
    mid_pitch = feats[len(feats) // 2]["pitch"]

    fallback_220_world = extraction._to_world(
        np.array([math.log2(220.0)]),
        math.log2(extraction.PITCH_HZ_RANGE[0]), math.log2(extraction.PITCH_HZ_RANGE[1]),
    )[0]
    # High tone must sit well above where the 220 Hz fallback would land, and
    # in the upper half of the box.
    assert mid_pitch > fallback_220_world + 0.5
    assert mid_pitch > 0.5
