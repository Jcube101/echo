# CLAUDE.md — Echo

Operational guide for Claude Code sessions in this repo. These rules are
binding in every session, not just the initial build.

---

## Scope Restriction — Read First

**Work only inside `~/projects/echo`.** Do not read, list, clone, or modify
any other directory or repository on this machine — not dev-meta, not hunter,
not photorank, not any other project folder. If a pattern from another
project seems needed, ask Job instead of going looking for it.

Job-maintained files — **never modify these:**
- `ROADMAP.md` — milestone order and future plans (read it, don't touch it)
- `CLAUDE.md` — this file

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
| History retention | Last 50 entries; oldest entry's files + DB row deleted on each save beyond 50 |

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

---

## Other Standing Guardrails

- No Docker, no Kubernetes — bare-metal systemd only
- `StaticFiles` is mounted **last** in `main.py`, after all API routes
- Pin `pydantic>=2.10.4` and `sqlalchemy>=2.0.51` (Python 3.13 aarch64)
- Raw uploaded/recorded audio must never persist beyond the transcoded
  playback copy — no exceptions (SD-card disk constraint)
- Never touch `PORTS.md` or anything in other repos — report the port used,
  Job registers it himself
- Session learnings go in `LEARNINGS.md`, not in this file