# CLAUDE.md — Echo

Operational guide for Claude Code sessions in this repo. These rules are
binding in every session, not just the initial build.

**Living document** — jointly maintained by Job and Claude Code sessions.
Last updated: 2026-11-13.

---

## Scope Restriction — Read First

**Work only inside `~/projects/echo`.** Do not read, list, clone, or modify
any other directory or repository on this machine — not dev-meta, not hunter,
not photorank, not any other project folder. If a pattern from another
project seems needed, ask Job instead of going looking for it.

**Process hygiene on the shared Pi:** never kill processes with a broad/
generic pattern (e.g. `pkill -f "node.*vite"`) — a session once did this and
took down an unrelated project's dev server. Kill by exact PID or a
project-scoped path (`pkill -f "projects/echo/frontend"`) only.

`CLAUDE.md` — this file, jointly maintained by Job and Claude Code sessions.
Locked Decisions and standing guardrails encode Job's calls — add new
operational rules, sudo scope, or guardrails discovered during a session,
and keep existing sections accurate, but don't reorder, delete, or override
Job's existing decisions without being asked.

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

**Independence principle:** a future, separate bird-detection project
("Avian Visitors") will call Echo's `POST /upload` as just another client.
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
| Public URL | `echo.job-joseph.com` via Cloudflare Tunnel `pi-home` |
| Database | SQLite, metadata + file paths only. **Never store audio blobs in the DB.** Audio lives on disk under `~/projects/echo/data/audio/` |
| Max upload size | 20 MB (server-side enforced, clear error beyond it) |
| Max clip duration | 60 seconds (all input paths) |
| Stored audio | Raw upload processed then discarded; only a small transcoded playback copy (opus/mp3) is kept |
| History retention | Per browser: newest **20** clips. Site-wide: **500** clips or **1 GB** of clip data, whichever comes first (oldest deleted first). Inactivity: clips not opened for **30 days** are deleted. Each deletion removes the DB row and both files. Runs on every save, at startup and once a day (decision L6 in `docs/LAUNCH.md`, approved by Job 2026-11-12; replaces the earlier single limit of 50) |
| Sample library exception | `samples/audio/*.opus` are a deliberate, permanent exception to the discard rule above — committed to git as product assets, never a `clips` DB row, never subject to the retention rules above |

The root `package.json` exists solely for Playwright verification tooling —
the app frontend lives in `frontend/` with its own `package.json`.

---

## Hardware & Audio Rules

- The Pi mic is used **only** via the existing `~/bin/rec` wrapper. Never
  modify `~/bin/rec` or `~/.asoundrc`; never call `arecord` directly.
- **Mic sharing:** the USB mic is shared hardware (JARVIS today, a future
  bird-detection service later). Echo acquires the mic only for the exact
  recording duration and releases it immediately. No background listening,
  no long-running capture process, ever.
- The mic's ALSA card number can shift across reboots. If `rec` fails with
  "audio open error", the fix is Job's (updating `~/.asoundrc`) — report it,
  don't attempt it.
- Playback verification audio goes through the existing `~/bin/hear` wrapper
  (connects the Bluetooth speaker first) if ever needed.

---

## Sudo — What's Available

Passwordless sudo is scoped to exactly these commands (via
`/etc/sudoers.d/pi-services`). Always invoke with `sudo -n` so a
misconfiguration fails fast instead of hanging on a password prompt:

```
sudo -n cp /tmp/echo.service /etc/systemd/system/echo.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable echo
sudo -n systemctl start echo
sudo -n systemctl stop echo
sudo -n systemctl restart echo
sudo -n cp /home/jcube/.cloudflared/config.yml /etc/cloudflared/config.yml
sudo -n systemctl restart cloudflared
```

Anything outside this list will prompt for a password and hang an unattended
session — don't attempt other sudo commands; report the need instead.
Notably, `status` is **not** in the allowlist: `sudo -n systemctl status
echo` will hang on a password prompt. Use plain `systemctl status echo`
(no sudo) for read-only inspection instead.

System-file editing pattern: write to `/tmp/` first, then `sudo -n cp` into
place. Never `sudo nano`, never `sudo tee` for these files.

---

## Cloudflare Tunnel — Editing Rules

When adding the `echo.job-joseph.com` ingress rule:
1. Read `~/.cloudflared/config.yml` in full first
2. Add exactly one ingress block, above the catch-all `http_status:404` line
3. Do not reorder, reformat, or touch any other ingress rule
4. Sync: `sudo -n cp /home/jcube/.cloudflared/config.yml /etc/cloudflared/config.yml`
5. Restart: `sudo -n systemctl restart cloudflared`
6. Record the full before/after config in the session report

**Hard constraint — Cloudflare's ~100s edge timeout:** nothing in the
request chain (uvicorn, cloudflared) imposes a request-processing timeout,
but Cloudflare's free-plan edge enforces an unconfigurable ~100s
origin-response limit (HTTP 524) on `*.job-joseph.com`. Any synchronous
endpoint served through the tunnel must return well inside that window — if
a future feature needs longer, it needs an async job-status pattern, not a
config tweak. (This is why `/upload`/`/capture` extraction speed is tuned
to stay in single-digit seconds — see `LEARNINGS.md`.)

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

## Public-Launch Guardrails (v1.7, `docs/LAUNCH.md`)

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
  `ECHO_CF_TEAM_DOMAIN` are unset. Those two values live only in
  `/home/jcube/.config/echo/access.env` (outside the repo, `chmod 600`) —
  never in git, never printed in a report.
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
  `data/`). Anything Echo needs to write must live under `data/`. On this Pi
  `MemoryMax` is inert (`cgroup_disable=memory`); `OOMScoreAdjust=500` and
  `CPUQuota=200%` are what actually protect other services.
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
- Never touch `PORTS.md` or anything in other repos — report the port used,
  Job registers it himself
- Session learnings go in `LEARNINGS.md`, not in this file