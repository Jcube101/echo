# CLAUDE.md — Echo

Operational guide for Claude Code sessions in this repo. These rules are
binding in every session, not just the initial build.

**Living document** — jointly maintained by Job and Claude Code sessions.
Last updated: 2026-11-13.

---

## This repo is public — Read First

- **`CLAUDE.local.md` holds the host-specific rules** (gitignored, private,
  equally binding): the exact sudo allowlist, the tunnel-editing steps, the mic
  wrapper and config paths, the private env file, and the names of other
  projects on the machine. If its contents are not already in your context,
  **read it before any sudo, systemd, tunnel or mic work.** If the file does
  not exist (a fresh clone), don't attempt those operations; ask Job.
- **Keep host details out of tracked files.** Never write into `CLAUDE.md`,
  `ROADMAP.md`, `README.md`, `SPEC.md`, `LEARNINGS.md`, code comments or commit
  messages: sudo rules, the tunnel's name or config paths, home-directory
  paths or usernames, secrets or their file locations, other projects on this
  machine, or plans for projects other than Echo. Put those in
  `CLAUDE.local.md` or `docs/`.
- **`docs/` is gitignored working notes** that exist only on the host
  (TEST_PLAN, VERIFICATION_LOG, DESIGN_V2, LAUNCH, BYO_PI_MIC, design
  mockups, plans for related projects). Keep writing to them; never
  `git add -f` them. Tracked files may name one ("see `docs/LAUNCH.md`") but
  `README.md` must not, and nothing should depend on a reader having them.
- Tracked documents: `README.md` (describes only what is in git),
  `CLAUDE.md`, `ROADMAP.md`, `SPEC.md`, `LEARNINGS.md`.

---

## Scope Restriction

**Work only inside this repository.** Do not read, list, clone, or modify any
other directory or repository on this machine. If a pattern from another
project seems needed, ask Job instead of going looking for it.

**Process hygiene on the shared host:** never kill processes with a broad/
generic pattern (e.g. `pkill -f "node.*vite"`) — a session once did this and
took down an unrelated project's dev server. Kill by exact PID or a
project-scoped path only.

`CLAUDE.md` — this file, jointly maintained by Job and Claude Code sessions.
Locked Decisions and standing guardrails encode Job's calls — add new
operational rules or guardrails discovered during a session, and keep
existing sections accurate, but don't reorder, delete, or override Job's
existing decisions without being asked.

`ROADMAP.md` — a **living document**, jointly maintained by Job and Claude
Code sessions. Keep milestone status (✅ Shipped / 🚧 In progress /
📋 Planned / 💡 Idea) current as work starts and ships, and add new
milestones or decisions surfaced during a session. Add and update — don't
reorder, delete, or rewrite Job's existing decisions and context without
being asked.

---

## What Echo Is

Echo turns an audio clip (uploaded, recorded in-browser, or captured from the
Pi's USB mic) into an interactive 3D trail through pitch/timbre/motion space,
plus a 2D spectrogram strip. It is a **general-purpose sound visualizer** —
works on any audio, knows nothing about birds or species.

**Independence principle:** other projects may call Echo's `POST /upload` as
just another client.
Keep that endpoint source-agnostic and cleanly documented. Never add
species/bird concepts to Echo's schema, code, or UI unless ROADMAP.md's v2
section is explicitly in scope for the session.

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Backend port | `8014` |
| Backend | FastAPI + SQLite |
| Frontend | React 18 + Vite 6, Tailwind, in `frontend/` |
| 3D rendering | Three.js via `react-three-fiber` + `@react-three/drei` |
| Feature extraction | Python `librosa` |
| Deployment | FastAPI `StaticFiles` serves `frontend/dist` same-domain — no Vercel, no CORS config, no `credentials: 'include'` on any fetch |
| Public URL | `echo.job-joseph.com` via a Cloudflare Tunnel |
| Database | SQLite, metadata + file paths only. **Never store audio blobs in the DB.** Audio lives on disk under `data/audio/` |
| Max upload size | 20 MB (server-side enforced, clear error beyond it) |
| Max clip duration | 60 seconds (all input paths) |
| Stored audio | Raw upload processed then discarded; only a small transcoded playback copy (opus/mp3) is kept |
| History retention | Per browser: newest **20** clips. Site-wide: **500** clips or **1 GB** of clip data, whichever comes first (oldest deleted first). Inactivity: clips not opened for **30 days** are deleted. Each deletion removes the DB row and both files. Runs on every save, at startup and once a day (decision L6, approved by Job 2026-11-12; replaces the earlier single limit of 50) |
| Sample library exception | `samples/audio/*.opus` are a deliberate, permanent exception to the discard rule above — committed to git as product assets, never a `clips` DB row, never subject to the retention rules above |

The root `package.json` exists solely for Playwright verification tooling —
the app frontend lives in `frontend/` with its own `package.json`.

---

## Hardware & Audio Rules

- The Pi mic is used **only** through the existing recording wrapper
  (`REC_WRAPPER` in `main.py`). Never modify the wrapper or the ALSA
  configuration; never call `arecord` directly.
- **Mic sharing:** the USB mic is shared hardware. Echo acquires the mic only
  for the exact recording duration and releases it immediately. No background
  listening, no long-running capture process, ever.
- If the wrapper fails with "audio open error", the fix is Job's — report it,
  don't attempt it.
- Details (paths, the playback wrapper, what else uses the mic) are in
  `CLAUDE.local.md`.

---

## Sudo, systemd and the tunnel

- Passwordless sudo exists for a **short, exact list of commands** (installing
  and restarting this service, syncing and restarting the tunnel). The list is
  in `CLAUDE.local.md`. Anything outside it prompts for a password and hangs an
  unattended session — don't attempt it; report the need instead.
- Always invoke with `sudo -n` so a misconfiguration fails fast.
- System-file editing pattern: write to `/tmp/` first, then `sudo -n cp` into
  place. Never `sudo nano`, never `sudo tee`.
- Tunnel config changes follow the step-by-step rules in `CLAUDE.local.md`.

**Hard constraint — Cloudflare's ~100s edge timeout:** nothing in the
request chain imposes a request-processing timeout, but Cloudflare's
free-plan edge enforces an unconfigurable ~100s origin-response limit
(HTTP 524). Any synchronous endpoint served through the tunnel must return
well inside that window — if a future feature needs longer, it needs an async
job-status pattern, not a config tweak. (This is why `/upload`/`/capture`
extraction speed is tuned to stay in single-digit seconds — see
`LEARNINGS.md`.)

---

## Feature-Schema Versioning — Binding Rule

Stored feature JSONs are versioned (Part 0, session 6). **Any change to what
`extract_features`/`compute_spectrogram` output** — a new/removed/renamed
per-frame field, OR a change to how an existing value is computed, scaled, or
clamped — **requires, in the same change:**

1. Bump `extraction.FEATURE_SCHEMA_VERSION` (and update `FEATURE_FIELDS` if the
   per-frame keys changed).
2. Run `python migrate_schema.py` (re-extracts + re-stamps history **and**
   samples; this is the only supported migration path — not an ad-hoc script).
3. Confirm `python schema_audit.py` reports **zero stale** clips.
4. Run `python build_landing_art.py` and commit what it changes — the landing
   page's static illustrations and sample thumbnails are drawn from the sample
   feature files (`tests/test_landing_art.py` fails while they are stale). The
   same applies whenever a sample is added, removed or re-credited.

This is enforced, not just documented: `tests/test_schema.py` (SCHEMA-005) fails
whenever any stored clip is behind `FEATURE_SCHEMA_VERSION`, and
`GET /api/schema-audit` reports current-vs-stale at runtime. Do **not** hand-edit
stored feature JSONs or migrate with a one-off script — go through
`migrate_schema.py` so the version stamp and DB column stay consistent. The audit
+ migration runner live at the repo root on purpose (`verification/` is
gitignored). See `LEARNINGS.md` "Session 6 — feature-schema versioning".

## Public-Launch Guardrails (v1.7)

Echo is public, with no logins. These hold in every later session:

- **Every clip route is scoped to the browser's `echo_vid` cookie**
  (`visitor.py`). Any new route that reads, lists, serves or deletes a clip
  must go through the owner check (`_owned_clip` in `main.py`) and answer
  **404, never 403**, for someone else's clip. Never filter on a visitor ID
  that could be `None` (it would match unowned rows).
- **Never log a visitor ID, and never store or log one next to an IP
  address.** The unit runs uvicorn with `--no-access-log` for this reason.
- **Owner-only routes** (`/capture`, `/me`, `/api/schema-audit`, and any
  future one) use `Depends(access.require_owner)`: a valid Cloudflare Access
  token or 404. It must stay **fail-closed** when `ECHO_CF_ACCESS_AUD` /
  `ECHO_CF_TEAM_DOMAIN` are unset. Those two values live only in a private
  env file outside the repo (path in `CLAUDE.local.md`) — never in git, never
  printed in a report.
- **One Pi mic capture at a time, tracked by the server** (`_capture` in
  `main.py`, under `_capture_lock`). `DELETE /capture?action=cancel|stop`
  must stay safe at any moment: a no-op when nothing runs or it was already
  asked, never a signal to a process that has exited, never a stuck mic.
  Cancel = SIGKILL the group and discard; Stop = SIGINT and keep the file
  (arecord leaves a valid WAV on SIGINT). CAP-010…020 guard this.
- **Behind Cloudflare Access, put parameters in the URL and send no request
  body** (`/capture?duration=`, `/capture?action=`). See LEARNINGS.md "Pi mic
  capture hang: cause not reproduced".
- **`/capture` stays traceable and bounded.** The app sends it with no
  request body (`?duration=`); `rec` is killed, process group and all, at
  duration + 10 s; `capture_trace.py` logs each step with no IPs, visitor IDs
  or token values. Read it with `journalctl -u echo -o cat | grep '^capture'`.
  Give any new long-running route the same treatment (LEARNINGS.md "Pi mic
  capture hang").
- **Heavy work goes through `_analyse()`** (one at a time, in the analysis
  worker process, with the 60 s kill). Don't call `process_audio` from a
  route directly, and don't run ffmpeg/librosa in the web process.
- **`/upload` keeps its guard**: size, rate limit and Content-Length are
  checked before the body is read. `CF-Connecting-IP` is trusted only from
  localhost; the unit's `--no-proxy-headers` is part of that.
- **The CSP is tested in a real browser** (`e2e/specs/launch.spec.mjs`,
  E2E-023). Change `CONTENT_SECURITY_POLICY` only with that spec passing;
  pytest alone can't see a policy that blanks the 3D view. Its only
  third-party origins are Cloudflare Web Analytics' two (Job's call); don't
  add others without asking.
- **`echo.service` is sandboxed** (read-only home, writes only under
  `data/`). Anything Echo needs to write must live under `data/`. `OOMScoreAdjust=500`
  and `CPUQuota=200%` are what protect other services on the host (`MemoryMax`
  has no effect there).
- The end-to-end suite must run on `http://localhost`, not `127.0.0.1`
  (Chromium sends the Secure cookie over plain http only to `localhost`).

## Other Standing Guardrails

- No Docker, no Kubernetes — bare-metal systemd only
- `StaticFiles` is mounted **last** in `main.py`, after all API routes
- Pin `pydantic>=2.10.4` and `sqlalchemy>=2.0.51` (Python 3.13 aarch64)
- Raw uploaded/recorded audio must never persist beyond the transcoded
  playback copy — no exceptions (SD-card disk constraint). This governs the
  `/upload` and `/capture` pipelines specifically; it doesn't apply to the
  curated sample library, which is a separate, permanent, committed asset
  set (see the Sample library exception row in Locked Decisions)
- Never touch anything in other repos, including any shared port registry —
  report the port used, Job registers it himself
- Session learnings go in `LEARNINGS.md`, not in this file (host-specific
  ones go in `docs/`)
