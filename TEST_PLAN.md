# Echo — Test Plan

Test-planning analysis only — **no test code exists yet**. This document is the
complete, prioritized plan for taking Echo from zero automated tests (the root
`package.json` "test" script is a stub; `verification/` is manual Playwright
screenshot checks) to a layered suite. A later session implements only what is
approved here.

Status: **proposed — awaiting Job's approval.** Nothing in this plan has been
implemented, and no dependency has been installed.

---

## Summary

**Total proposed tests: 89**

| Type | Count |
|---|---|
| Unit | 47 |
| API-integration | 26 |
| End-to-end (Playwright) | 12 |
| Manual-only (real hardware / real phone) | 4 |

| Priority | Count | Meaning |
|---|---|---|
| P0 | 30 | Breaks the product or risks data loss (quality gates, limits, retention, raw-discard, route shadowing, documented regressions) |
| P1 | 42 | Core behavior a user would notice broken |
| P2 | 17 | Edge cases, polish, defense-in-depth |

**By suite:** extraction unit 21 (EXT) · regression 6 (REG) · API 23 (API) ·
storage/db 10 (STO) · frontend unit 11 (FE) · E2E 10 (E2E) · hardware/deploy 8 (HW)

### Proposed directory layout

```
echo/
├── tests/                        # backend pytest suite (sibling to main.py)
│   ├── conftest.py               # shared fixtures: temp data dir + temp SQLite,
│   │                             #   synthetic audio factory (numpy+soundfile),
│   │                             #   TestClient app factory, fake ~/bin/rec stub
│   ├── test_extraction.py        # EXT-* and REG-001..004/006
│   ├── test_api.py               # API-*
│   ├── test_storage.py           # STO-*
│   └── test_deployment.py        # HW-003..006 (all opt-in-marked, never default)
├── frontend/src/__tests__/       # Vitest + React Testing Library (FE-*)
│   │                             #   (single __tests__/ dir; co-located
│   │                             #   *.test.jsx acceptable too — pick one)
├── e2e/                          # Playwright E2E (E2E-*) — kept strictly
│   │                             #   separate from tests/ and __tests__/
│   ├── playwright.config.js
│   └── *.spec.js
├── pyproject.toml                # pytest markers + default addopts (new file,
│                                 #   pytest config only — no packaging change)
└── verification/                 # existing manual screenshot checks — untouched
```

- Backend fixtures synthesize audio with `numpy` + `soundfile` (both already in
  `requirements.txt`) — sine tones, chirps, silence-padded clips, click trains.
  No network fetches. The committed `samples/audio/*.opus` files double as
  real-audio fixtures where a genuine recording matters.
- The real regression clip `25bd6d1c` lives only in `data/` on the Pi (and is
  subject to retention), and the `test-fixtures/xeno-canto/*.wav|mp3` referenced
  by the MANIFEST are not in git — so regression fixtures are **synthetic
  reconstructions** generated in `conftest.py` (see REG-003).

### Unattended-safety marker scheme (pytest)

Registered in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
addopts = "-m 'not hardware and not requires_sudo and not tunnel and not perf'"
markers = [
    "hardware: needs the real Pi USB mic via ~/bin/rec — never runs unattended",
    "requires_sudo: invokes the scoped sudo -n systemctl commands (restarts the LIVE echo service) — never runs unattended",
    "tunnel: needs network access to https://echo.job-joseph.com — never runs unattended",
    "perf: wall-clock timing assertions meaningful only on the Pi — flaky elsewhere",
]
```

- A bare `pytest` run therefore executes **only** the fully sandboxed subset
  (temp DB, temp data dir, synthetic/fixture audio, localhost only).
- Every test that touches the mic, the live systemd service, or the public URL
  carries one of these markers — no exceptions. None of the sudo-marked tests
  needs anything **beyond** CLAUDE.md's current 8-command allowlist (see the
  standalone list below); anything that would have needed more is listed under
  "Cannot be tested" instead.
- **Opt-in commands** (run only when Job is present to babysit):
  - `pytest -m hardware` — real-mic tests (HW-001)
  - `pytest -m requires_sudo` — live-service restart tests (HW-003, HW-004)
  - `pytest -m tunnel` — public-URL smoke (HW-005, HW-006)
  - `pytest -m perf` — Pi timing budget (REG-005)
  - `pytest -m "hardware or requires_sudo or tunnel or perf"` — everything gated
- Playwright equivalent: tag gated specs with `@hardware`/`@tunnel` in the test
  title and exclude by default via `grepInvert: /@hardware|@tunnel/` in
  `e2e/playwright.config.js`; opt in with `npx playwright test --grep @tunnel`.

### Standalone list — every test needing real hardware, sudo, or the tunnel

| ID | Needs | Within CLAUDE.md's current sudo allowlist? |
|---|---|---|
| REG-005 | Pi hardware (timing only, no mic, no sudo) | n/a |
| HW-001 | Real Pi USB mic via `~/bin/rec` | n/a (no sudo) |
| HW-002 | Real Pi USB mic; manual observation | n/a (no sudo) |
| HW-003 | `sudo -n systemctl restart echo` | **Yes** — in the allowlist |
| HW-004 | `sudo -n systemctl stop echo` / `start echo` | **Yes** — in the allowlist |
| HW-005 | Network to `https://echo.job-joseph.com` | n/a (no sudo) |
| HW-006 | Network to the public URL; writes one clip to prod history | n/a (no sudo) |
| HW-007 | Real Android phone (manual) | n/a |
| HW-008 | Real iPhone / iOS Safari (manual) | n/a |

No proposed test requires sudo beyond the existing 8-command scope. Status
checks in HW-003/004 use plain `systemctl is-active echo` (no sudo), per the
LEARNINGS.md gotcha that `status` is not allowlisted.

### Recommended test stack (recommendation only — nothing installed)

| Layer | Recommendation | Why it fits what's already here |
|---|---|---|
| Backend | **pytest** (+ FastAPI's built-in `TestClient`, which rides on `httpx`/`starlette` already pulled in by `fastapi>=0.115`) | Standard for FastAPI; `numpy`+`soundfile` already in `requirements.txt` cover fixture synthesis; no new runtime deps — only `pytest` (and optionally `pytest-timeout`) added as dev deps |
| Frontend units | **Vitest + @testing-library/react + jsdom** | Vitest is the native test runner for Vite 6 (shares `vite.config.js` transform pipeline — zero babel/jest config); RTL is the standard for React 18 component tests |
| E2E | **Keep Playwright**, but move to the `@playwright/test` runner in `e2e/` | The root `package.json` already pins `playwright ^1.61.1` and Chromium is cached on the Pi; the existing `verification/*.mjs` scripts are raw-API Playwright — the `@playwright/test` runner adds assertions, retries, and `--grep` tagging with no new browser download |

Wiring (later, on approval): root `package.json` "test" stub →
`cd frontend && vitest run && cd .. && .venv/bin/pytest`; e2e stays a separate
explicit command.

### Test-enablement seams (small source changes needing approval first)

The plan needs three tiny testability seams. They are **not** part of this
session — flagged for approval:

1. **`db.py` paths/engine are bound at import time** (`ROOT`, `DATA_DIR`,
   `engine`, `SessionLocal` are module-level). The conftest must either
   monkeypatch these before importing `main`, or (cleaner) `db.py` grows an
   optional `ECHO_DATA_DIR` env-var override. Without a seam, API/storage tests
   would write into the real `data/` — unacceptable.
2. **`indexForTime` is module-private in `frontend/src/App.jsx`.** Export it (or
   move it to `frontend/src/lib/`) so FE-001 can unit-test the binary search.
3. **`main.py`'s StaticFiles mount is conditional on `frontend/dist` existing at
   import.** API-018 needs an app-factory or re-import with a fixture dist dir.

`REC_WRAPPER` in `main.py` is already monkeypatchable (module global read at
request time) — `/capture` is testable sandboxed with a stub script, with no
change to source and **without ever touching the real `~/bin/rec`**.

---

## A. extraction.py — unit tests (`tests/test_extraction.py`)

All fully sandboxed: synthetic audio fixtures, no network, no hardware.

**SPEC.md quality-gate contract under test:** *"pitch/timbre/motion within the
[-3, 3] world box, amplitude within 0–1, zero NaN/Inf anywhere, density ~50
pts/sec over the analyzed span (unless capped at 3000)."*

- [ ] EXT-001 — **Unit · P0 · sandboxed** — `extract_features()` — every
  `pitch`/`timbre`/`motion` value lies in the `[-3, 3]` world box for a battery
  of synthetic clips (pure tone, chirp, white noise, near-silence, extreme SPL).
  Contract: SPEC.md quality gate above + *"stored as fixed-scale world
  coordinates in [-3, 3]"*.
- [ ] EXT-002 — **Unit · P0 · sandboxed** — `extract_features()` — `amplitude`
  is within 0–1 on the same battery (including after `AMP_SMOOTH_WINDOW`
  smoothing, which is explicitly re-clipped in code). Contract: SPEC.md
  *"amplitude within 0–1"*.
- [ ] EXT-003 — **Unit · P0 · sandboxed** — `extract_features()` +
  `compute_spectrogram()` — zero NaN/Inf in any output field for the battery,
  including pathological inputs (all-zero signal, single-sample file, DC-only).
  Contract: SPEC.md *"zero NaN/Inf anywhere"*; `docstring: "Never returns
  NaN/Inf"*.
- [ ] EXT-004 — **Unit · P0 · sandboxed** — `extract_features()` — density is
  44–56 pts/sec **measured over the analyzed span** (`t[-1] − t[0]`), not the
  file length, for clips of 2 s / 5 s / 30 s. Contract: SPEC.md *"~50
  points/sec of the analyzed (post-trim) span"* and the `_self_check` gate
  `44.0 <= pts_per_sec <= 56.0`.
- [ ] EXT-005 — **Unit · P0 · sandboxed** — `extract_features(max_points=…)` —
  a >60 s-equivalent frame count is downsampled to exactly ≤3000 points with
  first/last frames retained (`np.linspace` endpoints). Contract: SPEC.md
  *"Point cap: … no more than a few thousand points (cap: 3000)"*.
- [ ] EXT-006 — **Unit · P0 · sandboxed** — `_load_audio()` — a 65 s input is
  truncated to 60 s before analysis (defensive cap independent of the server
  check). Contract: CLAUDE.md locked *"Max clip duration | 60 seconds (all
  input paths)"*; code comment *"truncate defensively in case the server-side
  duration check is bypassed"*.
- [ ] EXT-007 — **Unit · P1 · sandboxed** — `_to_world()` — endpoint mapping
  (lo→−3, hi→+3, midpoint→0) and out-of-range clamping to the box edge, never
  scale-stretching. Contract: LEARNINGS.md *"Out-of-range values clamp to the
  box edge (never stretch the scale)"*.
- [ ] EXT-008 — **Unit · P1 · sandboxed** — `_normalize()` — flat/zero/NaN
  input returns all-zeros (the `hi − lo < 1e-9` guard); normal input maps to
  exactly [0, 1].
- [ ] EXT-009 — **Unit · P1 · sandboxed** — `_hold_forward()` — (a) invalid
  frames take the previous valid value; (b) a leading invalid run is
  back-filled with the first valid value; (c) an all-invalid array becomes the
  fallback. Contract: docstring + LEARNINGS.md *"pitch carry-forward
  (Phase 1)"*.
- [ ] EXT-010 — **Unit · P0 · sandboxed** — `extract_features()` end-to-end
  pyin unvoiced carry-forward — a tone→silence→tone clip produces a
  *continuous* pitch track (no frame drops toward the box floor during the
  unvoiced gap); a fully unvoiced clip (white noise under the voicing
  threshold) falls back to the 220 Hz neutral. Contract: SPEC.md *"unvoiced /
  quiet frames carry forward the last voiced value (keeps the trail
  continuous) rather than nulling"*.
- [ ] EXT-011 — **Unit · P1 · sandboxed** — quiet-frame hold — frames with RMS
  < `SILENCE_RMS_FRAC` (6%) of peak hold **all three** of pitch/timbre/motion
  (not just pitch) while amplitude still reflects the true low energy.
  Contract: LEARNINGS.md *"Quiet-frame hold SILENCE_RMS_FRAC = 0.06 … all
  three, not just pitch … Amplitude still reflects the real low energy"*.
- [ ] EXT-012 — **Unit · P0 · sandboxed** — `_trim_boundary_silence()` — a clip
  with 1 s leading + 1 s trailing digital silence around a tone loses only the
  boundary silence (±`TRIM_PAD_FRAMES`); a clip with an **interior** quiet gap
  keeps its full frame count (interior never cut). Contract: SPEC.md
  *"Boundary silence trim: leading/trailing silence is removed (interior
  untouched)"*.
- [ ] EXT-013 — **Unit · P0 · sandboxed** — trim offset restored — after a
  leading-silence trim, `features[0]["t"]` ≈ the silence duration on the
  **original** timeline (offset added back), so the untrimmed playback copy
  scrub-syncs. Contract: SPEC.md `t` row *"boundary-trim offset added back so
  playback scrub-syncs"*.
- [ ] EXT-014 — **Unit · P1 · sandboxed** — trim no-op guards — returns
  `(y, 0)` unchanged for: input shorter than `N_FFT`; an all-signal clip
  (nothing below threshold); a clip whose trim would leave `< 2 * N_FFT`
  samples. Contract: docstring *"No-ops … when nothing is clearly below signal
  or the result would be degenerate"*.
- [ ] EXT-015 — **Unit · P1 · sandboxed** — `_smooth()` — output length equals
  input length (edge padding), `window <= 1` and `size < 3` are no-ops, and a
  step signal's plateau values are unchanged (no phase shift). Contract:
  LEARNINGS.md Part C smoothing design (`SMOOTH_WINDOW = 5`,
  `AMP_SMOOTH_WINDOW = 3`).
- [ ] EXT-016 — **Unit · P1 · sandboxed** — `compute_spectrogram()` — payload
  shape: `bins == 64`, `cols <= 256`, `len(data) == bins * cols`, all values
  int 0–255, column-major order (verified with a synthetic clip whose energy
  moves low→high over time). Contract: SPEC.md *"compact mel-spectrogram
  ({bins, cols, data, freq_ticks})"* + LEARNINGS.md Phase-6 note.
- [ ] EXT-017 — **Unit · P1 · sandboxed** — `_mel_tick_positions()` — only
  ticks below Nyquist are emitted (at sr=22050, the 8000 Hz tick appears but
  a hypothetical ≥11025 Hz one would not), positions are strictly increasing
  in [0, 1], labels format as `"250"`/`"1k"`/`"4k"`. Contract: LEARNINGS.md
  Part C *"freq_ticks (_mel_tick_positions, Slaney mel) so the frontend needs
  no mel math"*.
- [ ] EXT-018 — **Unit · P2 · sandboxed** — degenerate inputs —
  `extract_features()` on empty/zero-length audio returns `[]`;
  `compute_spectrogram()` returns the `{bins:0, cols:0, data:[],
  freq_ticks:[]}` zero payload.
- [ ] EXT-019 — **Unit · P1 · sandboxed** — determinism — two runs on the same
  file produce byte-identical feature lists (no per-clip model fit, no
  randomness). Contract: LEARNINGS.md *"timbre = log2 spectral centroid …
  deterministic, needs no per-clip model fit"*.
- [ ] EXT-020 — **Unit · P2 · sandboxed** — axis semantics sanity — a 440 Hz
  sine maps to the expected pitch world coordinate (log2 interpolation of
  (50, 4000) into [−3, 3], ± smoothing tolerance); a click train scores higher
  mean motion than a steady tone of equal loudness. Contract: SPEC.md feature
  table (pitch/motion "How" column) + LEARNINGS.md *"motion = onset-strength
  … spectrally aware"*.
- [ ] EXT-021 — **Unit · P2 · sandboxed** — `t` is non-decreasing, starts at
  `trim_offset/sr`, steps ≈ 20 ms (`HOP_LENGTH/SAMPLE_RATE`), and all fields
  are rounded to 4 decimals.

---

## B. Regression tests from LEARNINGS.md (`tests/test_extraction.py`, marked/`perf` in `tests/` as noted)

Every documented regression becomes a permanent test. Fixtures are synthetic
reconstructions because the original clips live only in the Pi's `data/` dir
(and would be evicted by retention eventually).

- [ ] REG-001 — **Unit · P0 · sandboxed** — origin-collapse / density bug —
  target `extract_features()`. A clip with a loud passage, an interior quiet
  passage, and another loud passage yields ~50 pts/sec of the full analyzed
  span (**not** ~9), and no frame sits near the box-floor corner on all three
  axes during the quiet passage. Contract: LEARNINGS.md *"Part A — density bug
  root cause: librosa.effects.trim … shrank the frame timeline … a 2.8 s clip
  → 54 points. Fix: removed trimming entirely. Quiet frames are HELD"*.
- [ ] REG-002 — **Unit · P0 · sandboxed** — over-aggressive trim (the old
  `top_db=30` failure) — target `_trim_boundary_silence()`. A clip with one
  very loud transient plus quiet-but-real boundary signal (constructed so
  boundary signal is >30 dB below the peak but >8 dB above the noise floor)
  keeps its boundary signal — the `TRIM_MIN_SNR_DB=25` cap must prevent the
  threshold from chasing the peak. Contract: LEARNINGS.md *"the old top_db=30
  failure was a loud transient inflating the peak so boundary signal >30 dB
  below it got eaten; a floor-relative threshold with an SNR cap keeps real
  signal even then"*.
- [ ] REG-003 — **Unit · P0 · sandboxed** — clip `25bd6d1c` behavior,
  synthetically reconstructed: 1.55 s of pure digital silence followed by
  ~1.25 s of tonal "call". Assert: leading silence trimmed (first `t` ≈ 1.5 s
  on the original timeline), ~100% of call frames kept (frame count ≈
  call-duration × 50, matching the documented 141→64), density ~50/s over the
  analyzed span. Contract: LEARNINGS.md *"Regression clip 25bd6d1c is
  genuinely 1.55 s digital silence + 1.24 s call → correctly 141→64 frames
  (all real signal kept)"*.
- [ ] REG-004 — **Unit · P1 · sandboxed** — pyin resolution/speed tradeoff,
  accuracy half — assert `extraction.PYIN_RESOLUTION == 0.25` (guarding the
  Cloudflare-timeout fix against silent reversion) and that a synthetic sine
  sweep's detected pitch is within ~25 cents of ground truth (the documented
  cost was ~6 cents mean / 15 cents p95). Contract: LEARNINGS.md *"PYIN
  _RESOLUTION = 0.25 … cut a 60 s clip's pyin from 37 s → 6.5 s for only
  ~6 cents mean / 15 cents p95 pitch shift"*.
- [ ] REG-005 — **Manual-only · P2 · needs the real Pi (`perf` marker, no mic,
  no sudo)** — pyin resolution/speed tradeoff, speed half — a 60 s synthetic
  clip's full `extract_features()` completes in < 15 s wall-clock **on the
  Pi** (the Session-5 target; leaves ~6× margin under Cloudflare's ~100 s
  edge limit). Timing assertions are meaningless on other machines and flaky
  under load (LEARNINGS notes ~5× variance) — excluded from default runs via
  the `perf` marker, run only when Job is present:
  `pytest -m perf`. Contract: LEARNINGS.md Part A + CLAUDE.md *"extraction
  speed is tuned to stay in single-digit seconds"*.
- [ ] REG-006 — **Unit · P1 · sandboxed** — pyin range covers high birdsong —
  a synthetic 2.5–3.7 kHz tone is detected near the top of the pitch axis,
  not collapsed to the 220 Hz unvoiced fallback; assert `FMAX == 4000.0`,
  `FMIN == 50.0`. Contract: LEARNINGS.md *"pyin range raised. FMAX 2093 →
  4000 Hz … so high birdsong … is actually detected instead of collapsing to
  the unvoiced 220 Hz fallback"*.

(The mobile pole-flip / canvas-fill regressions from LEARNINGS.md are UI-level
and covered by E2E-009; the `freq_ticks` backward-compat regression is covered
by API-011 and FE-011.)

---

## C. main.py API surface — integration tests (`tests/test_api.py`)

All run against FastAPI's `TestClient` with a temp data dir + temp SQLite
(see seam #1) — fully sandboxed, real ffmpeg/librosa, synthetic fixture audio.
The `/capture` tests use a **stub** rec script written to the temp dir and
monkeypatched into `main.REC_WRAPPER` — the real `~/bin/rec` is never touched
or invoked (CLAUDE.md hardware rule).

- [ ] API-001 — **API-integration · P0 · sandboxed** — `POST /upload` happy
  path — a small WAV returns 200 with `{id, features, spectrogram,
  duration_s, audio_url}`, features pass the EXT-001..004 gates, and
  `audio_url` is `/audio/{id}.opus`. Contract: SPEC.md API table `/upload`
  row.
- [ ] API-002 — **API-integration · P0 · sandboxed** — `POST /upload` 20 MB
  limit — a 21 MB body returns **413** with the "exceeds the 20 MB limit"
  detail, and the size is enforced by streaming (send a small
  `Content-Length` header with a large body to prove the header isn't
  trusted). No partial temp files remain. Contract: CLAUDE.md locked *"Max
  upload size | 20 MB (server-side enforced, clear error beyond it)"*;
  VERIFICATION_LOG Phase 2 *"size enforced by streaming to disk with a hard
  cap, not trusting Content-Length"*.
- [ ] API-003 — **API-integration · P1 · sandboxed** — `POST /upload` empty
  file → **400** "Empty upload."
- [ ] API-004 — **API-integration · P0 · sandboxed** — `POST /upload`
  undecodable junk bytes → **422** "Could not read audio…". Contract:
  VERIFICATION_LOG Phase 2.
- [ ] API-005 — **API-integration · P0 · sandboxed** — `POST /upload` 60 s
  limit — a 61 s WAV → **422** with the duration message; a 60.3 s file (in
  the +0.5 s container-rounding tolerance) is accepted with
  `duration_s == 60.0`. Contract: CLAUDE.md locked 60 s cap; `storage.py`
  tolerance comment.
- [ ] API-006 — **API-integration · P1 · sandboxed** — `POST /upload` of a
  video file with an audio track → 200 (ffmpeg `-vn` extracts audio).
  Contract: SPEC.md *"or a video whose audio is extracted with ffmpeg
  first"*.
- [ ] API-007 — **API-integration · P1 · sandboxed** — `GET /history` — rows
  newest-first, each exactly `{id, created_at (ISO-8601 UTC), source_type,
  duration_s}` — no feature payload, no paths leaked. Contract: SPEC.md
  `/history` row.
- [ ] API-008 — **API-integration · P1 · sandboxed** — `GET /history/{id}` —
  full payload: summary keys + `features` + `spectrogram` + `audio_url`.
  Contract: SPEC.md `/history/{id}` row.
- [ ] API-009 — **API-integration · P1 · sandboxed** — `GET
  /history/{unknown}` → **404** "Clip not found."
- [ ] API-010 — **API-integration · P2 · sandboxed** — `GET /history/{id}`
  whose feature file was deleted on disk → **410** "Clip features gone."
- [ ] API-011 — **API-integration · P1 · sandboxed** — backward compat: a
  feature file stored as a plain JSON array (pre-spectrogram era) is served
  with `features` populated and `spectrogram: null`. Contract: LEARNINGS.md
  *"Backward-compat: /history/{id} still reads the older plain-array files
  (spectrogram = null)"*.
- [ ] API-012 — **API-integration · P1 · sandboxed** — `GET /audio/{file}` —
  200 with `content-type: audio/ogg` for an existing opus; **404** for a
  missing one.
- [ ] API-013 — **API-integration · P0 · sandboxed** — path-traversal guard —
  `GET /audio/..%2Fecho.sqlite`, `/audio/foo%2Fbar` and the same patterns on
  `/samples/audio/…` → **400** "Bad filename." — the DB and feature files
  must never be servable. Guards in `main.py:154` and `main.py:174`.
- [ ] API-014 — **API-integration · P1 · sandboxed** — `GET /samples` — 3
  entries, each carrying the full attribution summary (`id, species,
  sci_name, recordist, license, license_url, source_url, xc_id, duration_s`)
  and **no** feature payload or internal file names. Contract: SPEC.md
  *"/samples | Curated sample library: list with attribution + metadata"*.
- [ ] API-015 — **API-integration · P1 · sandboxed** — `GET /samples/{id}` —
  full payload with features + spectrogram + `audio_url =
  /samples/audio/…`; unknown id → **404**; a manifest entry whose feature
  file is missing → **404** (returns `None`).
- [ ] API-016 — **API-integration · P1 · sandboxed** — `GET
  /samples/audio/{file}` — 200 `audio/ogg` for a committed sample opus;
  **404** for a missing name.
- [ ] API-017 — **API-integration · P0 · sandboxed** — route-order guard —
  `GET /samples/audio/asian-koel.opus` is served by the audio route, NOT
  matched as `sample_item(sample_id="audio")`; i.e. the two-segment route
  declared first keeps precedence. Contract: `main.py:163` comment *"Route
  order: … declared before /samples/{sample_id} so there's no ambiguity"*.
- [ ] API-018 — **API-integration · P0 · sandboxed** — StaticFiles never
  shadows an API route — with a fixture `frontend/dist` present (seam #3):
  `/history`, `/samples`, `/api/health` still return JSON (not
  `index.html`), while `/` returns the SPA `index.html` and an asset path
  serves the file. Contract: CLAUDE.md standing guardrail *"StaticFiles is
  mounted last in main.py, after all API routes"*.
- [ ] API-019 — **API-integration · P2 · sandboxed** — `GET /api/health` →
  `{"status": "ok"}` (the readiness probe HW-003 depends on).
- [ ] API-020 — **API-integration · P1 · sandboxed** — `POST /capture` with
  `REC_WRAPPER` pointed at a nonexistent path → **503** "Pi mic wrapper
  (~/bin/rec) not found." (This is also what CI machines would hit by
  default — the test pins the behavior.)
- [ ] API-021 — **API-integration · P0 · sandboxed** — `POST /capture` happy
  path via a **stub** rec script (writes a synthetic WAV to the requested
  path, exits 0; monkeypatched `main.REC_WRAPPER`) → 200, full pipeline
  runs, and the history row has `source_type == "pi_mic"`. Contract: SPEC.md
  `/capture` row; VERIFICATION_LOG Phase 5. **Never invokes the real
  `~/bin/rec`.**
- [ ] API-022 — **API-integration · P1 · sandboxed** — `/capture` failure
  surfaces — stub exits non-zero → **503** with stderr excerpt (the ALSA
  card-shift symptom is *reported*, never retried/fixed, per CLAUDE.md);
  stub that sleeps past `duration + 20` → **504** "Mic capture timed out."
- [ ] API-023 — **API-integration · P1 · sandboxed** — `/capture` validation —
  `duration: 61` and `duration: 0` → **422** (pydantic `gt=0,
  le=MAX_DURATION_S`). Contract: SPEC.md *"Body {duration} (≤60)"*.

---

## D. db.py / storage.py — unit tests (`tests/test_storage.py`)

Direct calls to `process_audio` / `_enforce_retention` with temp dirs + temp
DB. Fully sandboxed (real ffmpeg for transcodes).

- [ ] STO-001 — **Unit · P0 · sandboxed** — retention evicts oldest row AND
  files — with `RETENTION_LIMIT` monkeypatched to 3, saving a 4th clip
  deletes the oldest clip's DB row **and** both its files (`data/audio/*.opus`
  + `data/features/*.json`). Contract: CLAUDE.md locked *"Last 50 entries;
  oldest entry's files + DB row deleted on each save beyond 50"*.
- [ ] STO-002 — **Unit · P0 · sandboxed** — retention ordering — with mixed
  `created_at` timestamps inserted out of order, the survivors are exactly
  the N newest by `created_at` (not by insertion order or id).
- [ ] STO-003 — **Unit · P0 · sandboxed** — raw-audio discard —
  after `process_audio()` returns, the raw input file and the intermediate
  `_x.wav` are gone; only the transcoded `.opus` + feature `.json` persist.
  Contract: CLAUDE.md locked *"Raw upload processed then discarded; only a
  small transcoded playback copy (opus/mp3) is kept"* and the standing
  guardrail *"Raw uploaded/recorded audio must never persist … no
  exceptions (SD-card disk constraint)"*.
- [ ] STO-004 — **Unit · P0 · sandboxed** — failure rollback — when
  extraction raises mid-pipeline (monkeypatched `extract_features` →
  exception, and separately an undecodable input), no partial `.opus` /
  `.json` remains, no DB row is created, and the raw file is still deleted
  (the `finally` block). Contract: `storage.py:135` *"Roll back any partial
  artifacts on failure"*.
- [ ] STO-005 — **Unit · P1 · sandboxed** — metadata-only DB — the `clips`
  schema stores only strings/floats/datetime (id, created_at, source_type,
  duration_s, feature_path, audio_path); after several saves the SQLite file
  stays small (< ~100 KB) proving no blob leaked in. Contract: CLAUDE.md
  locked *"Never store audio blobs in the DB"*.
- [ ] STO-006 — **Unit · P1 · sandboxed** — `probe_duration()` — raises
  `ProcessingError` for junk input, ffprobe non-zero exit, and unparseable
  output; `process_audio` maps zero duration to "Audio has zero duration."
- [ ] STO-007 — **Unit · P1 · sandboxed** — duration tolerance + effective
  duration — 60.0–60.5 s accepted; > 60.5 s → `ProcessingError`; stored
  `duration_s == min(actual, 60.0)` (matches the truncated extraction).
- [ ] STO-008 — **Unit · P0 · sandboxed** — sample-library retention immunity
  — after churning enough clips through `process_audio` to trigger multiple
  evictions (limit lowered), every `samples/audio/*.opus` and
  `samples/features/*.json` still exists and `list_samples()` still returns
  all 3 — samples are never `clips` rows *by construction*, so eviction can
  never see them. Contract: CLAUDE.md locked *"Sample library exception …
  never a clips DB row, never subject to the 50-entry retention rule"*;
  LEARNINGS.md Part D.
- [ ] STO-009 — **Unit · P2 · sandboxed** — playback copy validity — the
  produced `.opus` is ffprobe-decodable, mono, and dramatically smaller than
  the raw WAV input (the SD-card rationale).
- [ ] STO-010 — **Unit · P2 · sandboxed** — retention tolerates missing files
  — evicting a row whose files were already deleted by hand does not raise
  (`unlink(missing_ok=True)` + `OSError` guard) and still removes the row.

---

## E. Frontend — unit tests (Vitest + React Testing Library, `frontend/src/__tests__/`)

All fully sandboxed in jsdom with mocked `fetch`/`MediaRecorder` — no backend,
no browser, no mic. Scene.jsx (WebGL/three) is **not** realistically
unit-testable in jsdom — it is covered by E2E only. Spectrogram's canvas
*pixels* likewise; its DOM (axes/ticks/playhead) is unit-testable.

- [ ] FE-001 — **Unit · P0 · sandboxed** — `indexForTime()` (App.jsx; needs
  seam #2 to export) — the nearest-point binary search: exact hit, midpoint
  tie resolving to the truly nearer neighbor, `t` before the first frame → 0,
  after the last → last index, empty array → null. Contract: LEARNINGS.md
  *"Nearest point found by binary search over t-ordered frames"* — this is
  the scrubber-to-trail sync core.
- [ ] FE-002 — **Unit · P0 · sandboxed** — `pickMime()` (useRecorder.js) —
  the fallback chain in order (`audio/webm;codecs=opus` → `audio/webm` →
  `audio/mp4` → `audio/ogg;codecs=opus`) with `MediaRecorder.isTypeSupported`
  mocked to accept each candidate in turn; no `MediaRecorder` at all → null;
  none supported → `''` (browser default). Contract: LEARNINGS.md
  *"MediaRecorder mime negotiation (Phase 4)"*.
- [ ] FE-003 — **Unit · P1 · sandboxed** — `useRecorder()` (mocked
  MediaRecorder + getUserMedia, fake timers) — onstop builds a Blob and maps
  extensions (`mp4→.m4a`, `ogg→.ogg`, else `.webm`); the 60 s cap auto-stops;
  tracks are stopped on cleanup (mic released — the UI-side analogue of the
  no-background-listening rule); zero-byte recordings don't fire
  `onComplete`.
- [ ] FE-004 — **Unit · P1 · sandboxed** — `buildGeometry()` (features.js) —
  axis layout X=pitch / Y=motion / Z=timbre exactly as stored (no per-clip
  normalization — LEARNINGS Part B), amplitude drives size (`0.55 + a*2.4`)
  and monochrome brightness, amplitude clamped to [0,1], duration = last `t`.
- [ ] FE-005 — **Unit · P1 · sandboxed** — `api.js` error parsing — non-OK
  responses surface the backend's `detail` string (e.g. the 413 "20 MB
  limit" message) and fall back to `Request failed (status)` for non-JSON
  bodies — this is what the user sees in the error toast.
- [ ] FE-006 — **Unit · P1 · sandboxed** — `Gallery` — renders items from a
  mocked `getHistory` (source icon per `source_type`, duration, short id),
  empty state, error state; clicking a card calls `getClip(id)`, then
  `onLoaded` + drawer `onClose`. Contract: SPEC.md *"History gallery listing
  past clips, click to reload via /history/{id}"*.
- [ ] FE-007 — **Unit · P2 · sandboxed** — `Gallery` refresh — bumping
  `refreshKey` triggers a re-fetch (the post-upload auto-refresh path,
  `historyKey` in App).
- [ ] FE-008 — **Unit · P1 · sandboxed** — `Samples` attribution rendering —
  each card shows species, scientific name, recordist, license text linked
  to `license_url`, and "Xeno-canto XC{id}" linked to `source_url`; the
  footer credit line renders. Contract: SPEC.md *"each sample's attribution
  … is shown in the UI"* (CC BY-NC-SA obligation — a P1, not cosmetic).
- [ ] FE-009 — **Unit · P2 · sandboxed** — `Samples` pick → `onLoaded` is
  called with `source_type: 'sample'`, and App then renders the in-view
  credit overlay (`sampleMeta`) with license + source links.
- [ ] FE-010 — **Unit · P1 · sandboxed** — `PlaybackBar` — scrubbing the
  range input calls `onSeek(t)` and sets `audio.currentTime`; transport is
  disabled with no `audioUrl`; changing `audioUrl` pauses and resets to 0;
  `timeupdate` events propagate to `onSeek`. Contract: LEARNINGS.md
  *"Playback highlight driven by a single playheadSec state, updated by BOTH
  the audio timeupdate AND the seek input"*.
- [ ] FE-011 — **Unit · P2 · sandboxed** — `Spectrogram` DOM — no-data
  placeholder text; freq tick labels render at `bottom: pos*100%` from a
  fixture `freq_ticks`; a payload **without** `freq_ticks` (old clips)
  renders without crashing (defaults to `[]` — LEARNINGS Part C
  backward-compat); playhead line sits at `progress*100%`; ~5 time ticks.
  (Canvas 2D context stubbed; pixel output is E2E-006's job.)

---

## F. End-to-end (Playwright, `e2e/` — never mixed into `tests/` or `__tests__/`)

Each spec boots uvicorn against a **temp data dir** on localhost (never the
Pi's real `data/`), serves the built frontend, and drives headless Chromium.
All sandboxed; the patterns already proven by `verification/*.mjs` are
formalized into asserting specs. Every spec asserts **zero console/page
errors** (the standard every VERIFICATION_LOG phase held).

- [ ] E2E-001 — **E2E · P0 · sandboxed** — app boots: WebGL canvas present and
  non-zero-sized, footer shows the bundled sample, 0 console errors
  (formalizes `verify_ui.mjs`).
- [ ] E2E-002 — **E2E · P0 · sandboxed** — upload flow: set the file input
  with a fixture clip → processing overlay appears → footer flips to
  `clip {id}`, trail renders (formalizes `verify_upload.mjs`; this shared
  path is also the stand-in wiring test for phone recording, per
  LEARNINGS.md's follow-up note).
- [ ] E2E-003 — **E2E · P0 · sandboxed** — scrubber-to-trail sync: after
  loading a clip, drag the seek input to several positions → playhead time
  label updates and the highlight sprite's 3D position changes and tracks
  monotonically (formalizes `verify_playback.mjs`; headless-verifiable by
  design — LEARNINGS Phase 6). Contract: SPEC.md *"Playback scrubber synced
  to the trail (the current point highlights as playback advances)"*.
- [ ] E2E-004 — **E2E · P1 · sandboxed** — history gallery reload: open the
  drawer, cards listed with source icons, click one → footer flips to that
  clip id, drawer closes (formalizes `verify_gallery.mjs`).
- [ ] E2E-005 — **E2E · P1 · sandboxed** — samples drawer: 3 cards, each with
  visible recordist/license/XC link; clicking one loads the sample and the
  in-view credit line appears. Contract: SPEC.md sample-library section +
  M9 done-criteria.
- [ ] E2E-006 — **E2E · P1 · sandboxed** — spectrogram strip: second canvas
  renders non-blank pixels, Hz labels from `freq_ticks` and mm:ss time
  labels visible, playhead line moves with the scrubber. Contract: SPEC.md
  *"2D spectrogram strip … log/mel frequency axis (Hz) and a time axis
  (aligned to the scrubber)"*.
- [ ] E2E-007 — **E2E · P1 · sandboxed** — error surfacing: uploading a junk
  file shows the rose error toast with the backend's 422 detail; the app
  stays usable (previous trail intact).
- [ ] E2E-008 — **E2E · P2 · sandboxed** — drag-and-drop: dispatching
  dragover shows the "Drop audio to visualize" overlay; dropping a fixture
  file runs the upload flow.
- [ ] E2E-009 — **E2E · P1 · sandboxed** — mobile regression pack (Pixel-5
  emulation, touch): vertical drag leaves the view pixel-identical (polar
  lock — no pole flip), horizontal drag rotates, canvas fills its container
  in portrait AND after rotation to landscape with buffer = client × dpr
  (≤2). Permanently encodes the three mobile bugs fixed post-launch
  (LEARNINGS *"Mobile camera + trail-spike bug fixes"*; formalizes
  `verify_mobile.mjs`).
- [ ] E2E-010 — **E2E · P2 · sandboxed (best-effort)** — in-browser recording
  via Chromium's fake media device (`--use-fake-device-for-media-capture`
  `--use-fake-ui-for-media-capture`): tap Record → countdown visible → Stop
  → blob POSTs to `/upload` → renders. Exercises the real MediaRecorder code
  path without any real mic. **This does not replace HW-007/HW-008** — fake
  devices don't reproduce real Android/iOS codec behavior.

---

## G. Hardware / deployment / public-URL tests (opt-in only — never in a default run)

Live in `tests/test_deployment.py` behind markers, or remain documented manual
procedures. **Every test here requires Job present.** They run on the Pi
itself, against the *live* service and real hardware.

- [ ] HW-001 — **API-integration · P1 · `@pytest.mark.hardware`** — real Pi
  mic capture: `POST http://127.0.0.1:8014/capture {"duration": 3}` against
  the live service → 200, `source_type == "pi_mic"`, features pass gates.
  Uses the real `~/bin/rec` exactly as the app does — never modified, never
  bypassed to `arecord` (CLAUDE.md hardware rules). If it fails with "audio
  open error", the test must **report** (ALSA card shift is Job's fix) and
  not retry — assert-and-surface only.
- [ ] HW-002 — **Manual-only · P2 · real Pi mic** — mic release check: after
  HW-001 completes, confirm nothing holds the capture device (e.g.
  `fuser -v /dev/snd/*` shows no lingering echo-owned process). Verifies the
  locked *"Echo acquires the mic only for the exact recording duration and
  releases it immediately"* property. Manual because the definitive check is
  a human confirming JARVIS/other mic users still work.
- [ ] HW-003 — **API-integration · P1 · `@pytest.mark.requires_sudo`** —
  systemd restart recovery: `sudo -n systemctl restart echo` (in the
  allowlist), then poll `GET /api/health` until 200 within a bounded window,
  then `GET /history` returns data. Status checks use plain
  `systemctl is-active echo` — **never** `sudo -n systemctl status`
  (LEARNINGS: not allowlisted, would hang). Restarts the LIVE service —
  babysat runs only.
- [ ] HW-004 — **API-integration · P2 · `@pytest.mark.requires_sudo`** —
  stop/start cycle: `sudo -n systemctl stop echo` → port 8014 stops
  answering → `sudo -n systemctl start echo` → health returns. Confirms the
  unit file survives a cold start (not just restart).
- [ ] HW-005 — **E2E-smoke · P1 · `@pytest.mark.tunnel`** — public smoke:
  `GET https://echo.job-joseph.com/history` → 200 JSON; `/` → 200 containing
  `<title>Echo`; `/samples` → the 3 samples. Read-only — writes nothing.
  Contract: SPEC.md deployment *"Done when curl
  https://echo.job-joseph.com/history returns real data"*.
- [ ] HW-006 — **E2E-smoke · P2 · `@pytest.mark.tunnel`** — public upload
  within the edge budget: POST a ~20 s fixture clip to the public `/upload`,
  assert 200 well under 100 s round-trip (guards the Cloudflare 524
  regression the pyin fix bought margin against). **Side effect:** adds one
  real clip to production history (ages out via retention — the same
  accepted side effect as Session 5's checks). Flag in the run log.
- [ ] HW-007 — **Manual-only · P1 · real Android phone** — live phone
  recording at `echo.job-joseph.com`: tap Record → countdown → auto-stop at
  60 s → POST → render. Still the open follow-up in LEARNINGS.md ("cannot be
  exercised in headless Chromium (no real mic)"). E2E-010's fake-device run
  reduces but does not eliminate this.
- [ ] HW-008 — **Manual-only · P2 · real iPhone** — iOS Safari recording
  (`audio/mp4` mime path) — explicitly untested on real hardware per
  LEARNINGS.md; note quirks back into LEARNINGS.md per the ROADMAP v1.x
  item.

---

## Cannot be tested automatically/unattended (and why — no test proposed)

Per CLAUDE.md's guardrails, the following are **excluded by design**; proposing
them would violate a rule:

1. **ALSA card-shift failure mode** — reproducing it would mean editing
   `~/.asoundrc` or unplugging hardware. CLAUDE.md: the fix is Job's; never
   modify `~/.asoundrc` or `~/bin/rec`. Only the *surface* (503 with stderr
   detail, no retry) is tested, sandboxed, via a stub (API-022).
2. **Real background-listening prohibition** — "never holds the mic" is a
   design property (rec is synchronous). HW-002 spot-checks it manually; no
   automated watcher is possible without itself becoming a long-running
   process on the shared Pi.
3. **Cloudflare's ~100 s edge timeout (HTTP 524) itself** — forcing a 524
   would require deploying a deliberately slow endpoint through the production
   tunnel. The constraint is guarded *indirectly*: REG-004 pins
   `PYIN_RESOLUTION`, REG-005 checks the Pi timing budget, HW-006 checks real
   round-trip headroom.
4. **Cloudflare Tunnel config editing** — any test that rewrites
   `~/.cloudflared/config.yml` to verify the ingress-editing procedure would
   touch shared infrastructure serving other projects. The deployed result is
   smoke-tested read-only instead (HW-005).
5. **`sudo -n systemctl enable echo` / `daemon-reload` / service-file
   install** — although in the allowlist, exercising them as a *test* means
   overwriting the live unit file; there is no sandbox systemd on the Pi.
   Covered by the documented install procedure + HW-003/004 recovery checks.
6. **Real phone MediaRecorder (Android + iOS)** — no real mic in headless
   Chromium; fake-device E2E-010 approximates Chrome only. HW-007/HW-008 stay
   manual.
7. **Mic sharing/arbitration with a future birdnet service** — v2 scope
   (ROADMAP); its sudoers lines don't exist yet. Out of scope until then.

---

## Suggested implementation order (on approval)

1. `pyproject.toml` markers + `tests/conftest.py` seams/fixtures + the three
   test-enablement seams (needs sign-off — they touch `db.py`, `App.jsx`,
   `main.py` minimally).
2. All P0s: EXT gates, REG-001..003, API limits/traversal/shadowing/capture-stub,
   STO retention/discard/rollback/sample-immunity, FE-001/002, E2E-001..003.
3. P1s per suite; wire root `package.json` "test" to the sandboxed suites.
4. P2s + the opt-in `tests/test_deployment.py` (run once with Job to validate,
   then reserved for babysat sessions).
