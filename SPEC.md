# Echo — v1 Specification

This is Echo's own working spec, adapted from the build brief. It is the
contract the code is held to. Anything marked **locked** comes from
`CLAUDE.md` and is not up for change in a build session.

---

## What Echo is

A general-purpose acoustic visualizer. Audio in → per-frame feature stream →
interactive 3D trail (pitch / timbre / motion axes) + 2D spectrogram +
synced playback + history. It knows nothing about the *source* of a sound;
bird detection and any other semantics live in separate downstream projects
that call Echo's `/upload` as an ordinary client.

---

## Input sources (v1)

1. **File upload** — `mp3/wav/m4a/opus`, or a video whose audio is extracted
   with `ffmpeg` first. Limits (**20 MB / 60 s**) are enforced **server-side**,
   not just in the browser.
2. **In-browser recording** — the phone-at-the-park flow. `MediaRecorder`
   captures ≤60 s from the device mic and POSTs the blob to the **same
   `/upload` endpoint** — no separate pipeline. Android Chrome is the target;
   iOS Safari quirks are noted in `LEARNINGS.md` and do not block v1.
3. **Pi USB mic capture** — `/capture` triggers `~/bin/rec` for the requested
   duration (≤60 s), then the same pipeline. The mic is acquired only for the
   recording window and released immediately — never held in the background.

---

## Feature-extraction spec

Given an audio file, produce a JSON array of per-frame feature points:

```json
[
  { "t": 0.00, "pitch": 220.5, "timbre": 1.2, "motion": 0.3, "amplitude": 0.60 },
  { "t": 0.05, "pitch": 224.1, "timbre": 1.3, "motion": 0.4, "amplitude": 0.65 }
]
```

| Field       | Meaning | How |
|-------------|---------|-----|
| `t`         | Frame time (seconds) | frame index × hop |
| `pitch`     | Fundamental frequency (Hz) | `librosa.pyin`; unvoiced frames **carry forward** the last voiced pitch (keeps the trail continuous) rather than nulling |
| `timbre`    | Scalar timbre descriptor | spectral centroid normalized, or MFCC(13)→PCA scalar — whichever is simpler to implement correctly; the choice + why is documented in `LEARNINGS.md` |
| `motion`    | Rate of spectral change | onset-strength envelope, or frame-to-frame RMS delta — one, documented in `LEARNINGS.md` |
| `amplitude` | Loudness, normalized 0–1 | RMS energy per frame, normalized. Drives point size/color **only** — not a spatial axis |

- **Frame hop:** target ~20 ms (≈50 fps). A 60 s clip ≈ 3000 points.
- **Point cap:** the API downsamples so the frontend never receives more than
  a few thousand points (cap: **3000**).
- Extraction is a **standalone, testable function first**, verified on a real
  sample clip before any API/frontend wiring.

**Extraction quality gates (Phase 1 self-check):** pitch within 20–4000 Hz,
amplitude within 0–1, zero NaN/Inf anywhere, point count consistent with the
~20 ms hop for the clip length.

---

## API (locked: FastAPI + SQLite, port 8014)

| Method | Path            | Behavior |
|--------|-----------------|----------|
| POST   | `/upload`       | Accepts an audio file **or** a browser-recorded blob (same validation). Runs extraction, saves a history row + a transcoded playback copy, returns `{id, features}`. |
| POST   | `/capture`      | Body `{duration}` (≤60). Runs `~/bin/rec`, then the upload pipeline. Returns `{id, features}`. |
| GET    | `/history`      | List of `{id, created_at, source_type, duration_s}`, newest first. |
| GET    | `/history/{id}` | Full feature JSON + playback audio URL for one clip. |
| GET    | `/audio/{file}` | Serves the transcoded playback file. |

**Schema** — `clips(id, created_at, source_type, duration_s, feature_path, audio_path)`.
Metadata + file paths only. **Audio blobs are never stored in the DB**
(locked); audio lives on disk under `data/audio/`.

**Retention (locked):** keep the last **50** entries. On each save beyond 50,
the oldest entry's DB row **and** its files (audio + features) are deleted.

**Storage discipline (locked):** the raw uploaded/recorded audio is processed
and then **discarded** — only a small transcoded playback copy (opus/mp3) is
kept. This protects the SD card.

---

## Frontend (locked: React 18 + Vite 6 + Tailwind + react-three-fiber)

- 3D scene: point/line trail on **pitch / timbre / motion** axes, orbit
  controls, amplitude driving point size + color intensity.
- Upload UI (drag/drop + picker) and a record button (`MediaRecorder`, 60 s
  max, visible countdown) posting to `/upload`.
- Pi capture button + duration selector calling `/capture`.
- Playback scrubber synced to the trail (the current point highlights as
  playback advances).
- 2D spectrogram strip below the 3D view.
- History gallery listing past clips, click to reload via `/history/{id}`.

Served in production by FastAPI `StaticFiles` from `frontend/dist`, mounted
**last**, same origin — no CORS, no `credentials: 'include'`.

---

## Deployment (locked)

- systemd service `echo.service`, `Type=simple`, uvicorn on **8014**, restart
  on failure.
- `echo.job-joseph.com` via one new ingress block in the `pi-home` Cloudflare
  Tunnel config, following `CLAUDE.md`'s editing rules exactly.
- **Done when** `curl https://echo.job-joseph.com/history` returns real data
  from the public URL.

---

## Non-goals (v1)

- No bird/species concepts anywhere in schema, code, or UI (that's the
  separate Avian Visitors project, a future *client* of this API).
- No background listening, no continuous capture, no long-running mic hold.
- No Docker/Kubernetes. No Vercel. No cross-origin setup.
