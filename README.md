# Echo

Echo turns an audio clip into an interactive **3D trail through
pitch / timbre / motion space**, with a synced playback scrubber, a labelled 2D
spectrogram strip, a seven-line Spectral panel, and a private history of your
own clips. It is a general-purpose sound visualizer — it works on any audio and
knows nothing about what made the sound.

It is public, with no accounts: each browser sees only the clips it made (see
*Privacy and retention* below).

Two pages (Design v2, see [DESIGN_V2.md](DESIGN_V2.md)):

- **`/`** — a static landing page that explains Echo and links into the app.
- **`/app`** — the app. It has three layouts: a phone app below 640px (home,
  recording and result screens), a single-column layout up to 1200px, and a
  desktop workspace with a clip sidebar above that. It installs as a PWA
  that opens straight at `/app`.

Links into the app can carry `?record=1` (start recording), `?sample=<id>`
(open with that sample loaded) or `?samples=1` (open the sample library).

What the app does:

- **3D Trail** — the clip as a path on pitch / timbre / motion axes; drag to
  orbit, loudness sets point size and colour.
- **Spectral panel** — seven finer measures as stacked lines over time.
- **Playback** — a scrubber synced to the trail, over a spectrogram strip with
  Hz and time axes.
- **History** — this browser's clips. Delete one, or select several and delete
  them together.
- **Samples** — 14 built-in clips with credits, open to everyone.

Four ways to get audio in:

1. **File upload** — drag/drop or pick any `mp3/wav/m4a/opus` (or a video,
   whose audio track is extracted with `ffmpeg`).
2. **In-browser recording** — tap record on your phone at the park, capture
   up to 60s from the mic, and it posts straight to the same pipeline. This
   is the primary mobile use case.
3. **Pi USB mic capture** — **owner only.** Records on the Pi's own mic. The
   button appears only after Job signs in at `/me` through Cloudflare Access;
   for everyone else it is hidden and the route answers 404. A running
   recording can be stopped early (keeps what was recorded) or cancelled
   (saves nothing), and only one runs at a time.
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

## Privacy and retention

- **No accounts.** The first time a browser uses the app it gets a random
  `echo_vid` cookie (HttpOnly, Secure, SameSite=Lax, one year). Every clip is
  tagged with it, and every clip route checks it. Another browser's clip is a
  404, the same answer as a clip that doesn't exist. Clearing the cookie means
  losing access to those clips.
- **The ID means only "this browser".** It is never logged, and never stored
  or logged next to an IP address. The service runs with no access log.
- **What is kept:** a small transcoded playback copy and the feature file. The
  original upload or recording is discarded after analysis.
- **Retention:** the newest **20** clips per browser; **500** clips or **1 GB**
  of clip data site-wide, whichever comes first (oldest deleted first); and any
  clip not opened for **30 days** is deleted. Runs on every save, at startup
  and once a day. Samples are not clips and are never deleted.
- **Pi mic and owner pages:** gated by Cloudflare Access, and Echo verifies
  the Access token itself on every request (so a direct request on the LAN
  gets a 404 too). With no Access settings configured, the gate stays closed.
- **Protecting the Pi:** one analysis at a time in a separate worker process
  (a friendly 503 when busy), upload limits of 10 per hour and 30 per day per
  browser and per IP (429), and a sandboxed systemd unit.

The full brief is [docs/LAUNCH.md](docs/LAUNCH.md).

---

## Architecture

```
echo/
├── main.py            FastAPI app: routes + StaticFiles (mounted last)
├── extraction.py      Standalone librosa feature-extraction engine (M1)
├── db.py              SQLAlchemy models + SQLite session + retention limits
├── storage.py         Audio transcode, clip deletion, retention
├── visitor.py         The per-browser `echo_vid` cookie
├── access.py          Owner-only gate (verifies the Cloudflare Access token)
├── ratelimit.py       Upload rate limits (in memory)
├── analysis_worker.py Separate process that runs ffmpeg + extraction
├── capture_trace.py   Per-request log for /capture (no IPs, IDs or tokens)
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
├── docs/              LAUNCH.md (v1.7 brief), BYO_PI_MIC.md (v1.8 idea),
│                      design-v2/ (redesign mockups)
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

| Method | Path                      | Who | Purpose |
|--------|---------------------------|-----|---------|
| GET    | `/`                       | Public | Landing page |
| GET    | `/app`, `/app/*`          | Public | The app (sets the `echo_vid` cookie) |
| POST   | `/upload`                 | Public, rate-limited | Audio file or recorded blob → `{id, features}`; the clip belongs to this browser |
| GET    | `/history`                | This browser | Its clips (id, timestamp, source, name, length) |
| GET    | `/history/{id}`           | This browser | Full feature JSON + playback audio URL |
| DELETE | `/history/{id}`           | This browser | Delete one clip (row + both files) |
| POST   | `/history/delete`         | This browser | Delete several: body `{"ids": [...]}`, up to 100 → `{"deleted": n}` |
| GET    | `/audio/{file}`           | This browser | Transcoded playback audio |
| GET    | `/samples`                | Public | List curated samples (attribution + metadata) |
| GET    | `/samples/{id}`           | Public | Full feature JSON + audio URL for one sample |
| GET    | `/samples/audio/{file}`   | Public | Sample playback audio |
| GET    | `/api/me`                 | Public | `{"pi_mic": true}` only for the signed-in owner |
| GET    | `/api/health`             | Public | `{"ok": true, "status": "ok"}` |
| GET    | `/me`                     | **Owner only** | Sign-in step; redirects to `/app?owner=1` |
| POST   | `/capture?duration=N`     | **Owner only** | Record N seconds on the Pi mic → same result as `/upload` |
| DELETE | `/capture?action=cancel\|stop` | **Owner only** | Cancel the running recording (nothing saved) or stop it early (keeps what was recorded) |
| GET    | `/api/schema-audit`       | **Owner only** | Current-vs-stale feature-schema report |

"This browser" routes answer 404 for a clip the browser doesn't own. Owner-only
routes answer 404 without a valid Cloudflare Access token. The interactive API
docs (`/docs`, `/redoc`, `/openapi.json`) are off unless `ECHO_DEV=1`.

Limits enforced server-side: **20 MB** upload, **60 s** duration, 10 uploads
per hour and 30 per day.

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
npm run test:e2e               # Playwright, against a throwaway server on
                               # http://localhost (not 127.0.0.1)
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
systemd only — no Docker. See Phase 8 in `VERIFICATION_LOG.md` for the
original install steps and Session 16 for the public-launch changes.

- The unit is sandboxed: read-only home, writes only under `data/`,
  `CPUQuota=200%`, `OOMScoreAdjust=500`, no access log.
- The two Cloudflare Access settings (`ECHO_CF_ACCESS_AUD`,
  `ECHO_CF_TEAM_DOMAIN`) live in `~/.config/echo/access.env`, outside the repo.
  Without them the Pi mic and the other owner-only routes stay off.
- Trace a Pi mic capture with `journalctl -u echo -o cat | grep '^capture'`.
- Not yet tested on iOS Safari (no device available).
