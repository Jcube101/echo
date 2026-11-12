# Echo — Bring your own Pi mic (design note)

**Status:** 💡 Idea → 📋 Planned **after** the public launch (`docs/LAUNCH.md`).
Not scheduled. This captures the agreed shape, so a future session starts from it.

## The idea

Split the Pi's two jobs:

- **Processing** stays on Job's Pi and serves everyone.
- **The mic** becomes a small, optional **Echo Mic** agent that *anyone* can install
  on *their own* Raspberry Pi and pair with *their own* browser. Job's Pi is just
  one paired mic like everyone else's. `/capture` is retired.

## How it works

1. **Install:** a one-line install script on the Pi, plus a systemd service
   (`echo-mic.service`). It's a small Python app with no inbound ports.
2. **Pair:** in the browser, "Connect a Pi mic" shows a short code (e.g. `K7Q-29F`,
   valid 10 min, single use). The person runs `echo-mic pair K7Q-29F` on the Pi.
   The server swaps the code for a long-lived **device token** tied to that
   browser's `echo_vid`.
3. **Stay connected:** the agent keeps an outbound WebSocket (or long-poll) to
   `echo.job-joseph.com`, so no router changes or port forwarding are needed.
4. **Record:** the browser presses "Pi mic · 10 s" → server creates a **job** →
   sends it to that owner's agent → the agent records → uploads to `/upload` with its
   device token → the clip lands in that browser's private history. The browser
   polls `GET /jobs/{id}` until it's done.
5. **Disconnect:** "Unpair" in the browser revokes the token instantly, or stop the
   service on the Pi. Either side can end it.

## Rules that must hold

- The agent accepts exactly **one** command: `record {seconds ≤ 60}`. It never runs
  anything else, and the server can't make it run anything else.
- Only the paired browser can trigger its Pi. Tokens can be revoked and listed
  ("Your connected mics").
- The browser clearly shows when a remote mic is listening, with a countdown.
- **Async jobs only.** A 60 s recording + upload + analysis gets too close to
  Cloudflare's ~100 s limit for one request (see CLAUDE.md).
- The mic is held only for the recording, then released, same as today. On Job's Pi
  the agent records through `~/bin/rec` (shared with JARVIS). On other Pis it uses a
  configurable ALSA device.
- Uploads from agents count against the owner's rate limit and retention like any
  other clip.
- Pairing is tied to the browser. Clearing browser data means pairing again
  (accepted trade-off of the no-login decision).

## Possible first step (smaller)

**Upload-only agent:** press a button (or run `echo-mic record 10`) *on the Pi* and
the clip uploads to the paired browser's history. No remote trigger, so no open
connection or job queue. The website trigger can be added on top later.

## Rough size

Three to four sessions: agent + install script; pairing + device tokens; job queue +
WebSocket; UI ("Connect a Pi mic", connected mics, remote recording state) + tests.
