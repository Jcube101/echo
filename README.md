# Echo

Echo turns an audio clip into an interactive **3D trail through
pitch / timbre / motion space**, with a synced playback scrubber, a labelled 2D
spectrogram strip, a seven-line Spectral panel, and a browsable history. It is
a general-purpose sound visualizer — it works on any audio and knows nothing
about what made the sound.

Two pages (Design v2, see [DESIGN_V2.md](DESIGN_V2.md)):

- **`/`** — a static landing page that explains Echo and links into the app.
- **`/app`** — the app. It has three layouts: a phone app below 640px (home,
  recording and result screens), a single-column layout up to 1200px, and a
  desktop workspace with a clip sidebar above that. It installs as a PWA
  that opens straight at `/app`.

Links into the app can carry `?record=1` (start recording), `?sample=<id>`
(open with that sample loaded) or `?samples=1` (open the sample library).

Four ways to get audio in:

1. **File upload** — drag/drop or pick any `mp3/wav/m4a/opus` (or a video,
   whose audio track is extracted with `ffmpeg`).
2. **In-browser recording** — tap record on your phone at the park, capture
   up to 60s from the mic, and it posts straight to the same pipeline. This
   is the primary mobile use case.
3. **Pi USB mic capture** — trigger a recording on the Pi itself for local
   testing.
4. **Sample library** — no audio needed: the built-in Samples sheet has 14
   curated clips — 3 birdcalls from Xeno-canto (Asian Koel,
   Common Myna, Rose-ringed Parakeet) plus 11 other animal sounds from
   Freesound (Lion, Wolf, Cow, Dog, Cat, Frog, Cricket, Pig, Red Deer,
   Bullfrog, Camel), chosen to spread across the pitch/timbre/motion range
   a birds-only library couldn't show. These are permanent (never rotated
   out by history retention) and each shows its recordist, license, and a
   source link back to whichever of the two providers it came from.

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
├── build_landing_art.py  Draws the landing page's static art from samples/
├── migrate_schema.py / schema_audit.py  Feature-schema versioning tools
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
│   ├── src/Landing.jsx        Landing page (/)
│   ├── src/App.jsx            The app (/app), all three layouts
│   ├── src/assets/landing/    Generated art + sample details (committed)
│   └── dist/          Production build served by StaticFiles (gitignored)
├── tests/             pytest (backend, deployment, landing-art checks)
├── e2e/               Playwright specs + the Lighthouse runner
├── package.json       Playwright + Lighthouse verification tooling ONLY (not the app)
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
| POST   | `/capture`              | Owner only: record on the Pi mic → same result   |
| GET    | `/history`              | This browser's clips (id, timestamp, source, len)|
| DELETE | `/history/{id}`         | Delete one of this browser's clips               |
| POST   | `/history/delete`       | Delete several of this browser's clips           |
| DELETE | `/capture`              | Owner only: cancel or stop the running recording |
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
frontend. **A build into `frontend/dist` is live immediately** (the backend
serves it from disk), so build only when the work is ready to be seen.

### Tests and checks

```bash
npm test                       # pytest + Vitest (repo root)
npm run test:e2e               # Playwright, against a throwaway server
npm run lighthouse             # landing-page accessibility, mobile + desktop
node e2e/build-icons.mjs       # redraw the favicon + PWA icons (frontend/public)
.venv/bin/python build_landing_art.py   # regenerate landing art after the
                                        # sample library changes
```

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
