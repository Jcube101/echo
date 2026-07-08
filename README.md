# Echo

Echo turns an audio clip into an interactive **3D trail through
pitch / timbre / motion space**, with a synced playback scrubber, a labelled 2D
spectrogram strip, and a browsable history gallery. It is a general-purpose
sound visualizer — it works on any audio and knows nothing about what made
the sound.

Four ways to get audio in:

1. **File upload** — drag/drop or pick any `mp3/wav/m4a/opus` (or a video,
   whose audio track is extracted with `ffmpeg`).
2. **In-browser recording** — tap record on your phone at the park, capture
   up to 60s from the mic, and it posts straight to the same pipeline. This
   is the primary mobile use case.
3. **Pi USB mic capture** — trigger a recording on the Pi itself for local
   testing.
4. **Sample library** — no audio needed: the built-in “🐦 Samples” drawer has
   one curated birdcall per species (Asian Koel, Common Myna, Rose-ringed
   Parakeet) so anyone can see the visualization immediately. These are
   permanent (never rotated out by history retention) and each shows its
   Xeno-canto recordist, license, and source link.

Every path funnels through one extraction engine (`librosa`) that produces a
per-frame feature stream, which the React + Three.js frontend renders as a
navigable point trail.

Live at **https://echo.job-joseph.com**.

---

## Architecture

```
echo/
├── main.py            FastAPI app: routes + StaticFiles (mounted last)
├── extraction.py      Standalone librosa feature-extraction engine (M1)
├── db.py              SQLAlchemy models + SQLite session (M2)
├── storage.py         Audio transcode / retention helpers
├── samples.py         Sample-library store (served, never in the clips table)
├── requirements.txt   Backend Python deps (installed into .venv)
├── data/              Runtime data (gitignored)
│   ├── echo.sqlite    Metadata only — never audio blobs
│   ├── audio/         Small transcoded playback copies (opus/mp3)
│   └── features/      Per-clip feature JSON
├── samples/           Curated sample library (COMMITTED product asset)
│   ├── samples.json   Per-sample attribution + metadata
│   ├── audio/         Opus playback copies
│   └── features/      Pre-extracted feature JSON
├── frontend/          React 18 + Vite 6 + Tailwind + react-three-fiber
│   └── dist/          Production build served by StaticFiles (gitignored)
├── package.json       Playwright verification tooling ONLY (not the app)
└── verification/      Overnight self-check screenshots + logs (gitignored)
```

- **Backend** lives at the repo root (not a `backend/` subfolder) so systemd
  can run `uvicorn main:app` with `WorkingDirectory=~/projects/echo`.
- **Frontend** is a separate Vite app in `frontend/` with its own
  `package.json`. In production its `dist/` build is served by the FastAPI
  app on the same origin — no CORS, no separate host.

See [SPEC.md](SPEC.md) for the full feature/API contract and
[LEARNINGS.md](LEARNINGS.md) for decisions and gotchas found during the build.

---

## Running locally

### Backend

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8014 --reload
```

The API is then at `http://localhost:8014`. Key endpoints:

| Method | Path                    | Purpose                                          |
|--------|-------------------------|--------------------------------------------------|
| POST   | `/upload`               | Audio file or recorded blob → `{id, features}`   |
| POST   | `/capture`              | Record `duration` s on the Pi mic → same result  |
| GET    | `/history`              | List recent clips (id, timestamp, source, len)   |
| GET    | `/history/{id}`         | Full feature JSON + playback audio URL           |
| GET    | `/audio/{file}`         | Transcoded playback audio                         |
| GET    | `/samples`              | List curated samples (attribution + metadata)    |
| GET    | `/samples/{id}`         | Full feature JSON + audio URL for one sample     |
| GET    | `/samples/audio/{file}` | Sample playback audio                            |

Limits enforced server-side: **20 MB** upload, **60 s** duration.

### Frontend

```bash
cd frontend
npm install
npm run dev          # dev server, proxies backend calls to :8014
npm run build        # production build into frontend/dist
```

In development the Vite dev server proxies backend calls to port 8014, so
run both. In production only the backend runs — it serves the built
frontend.

### Feature extraction on its own

The extraction engine is standalone and testable without the API:

```bash
.venv/bin/python extraction.py test.wav          # prints stats + sample JSON
```

---

## Deployment

Runs as the `echo` systemd service on the Pi (port 8014), exposed at
`echo.job-joseph.com` through the `pi-home` Cloudflare Tunnel. Bare-metal
systemd only — no Docker. See Phase 8 in `VERIFICATION_LOG.md` for the exact
install steps used.
