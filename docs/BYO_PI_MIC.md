# Echo — Bring your own Pi mic (design note)

**Status:** 💡 Idea. The public launch it was waiting for (`docs/LAUNCH.md`,
v1.7) shipped on 2026-11-13. Not scheduled. This captures the agreed shape, so a
future session starts from it. Updated 2026-11-13 for what v1.7 built.

## The idea

Split the Pi's two jobs:

- **Processing** stays on Job's Pi and serves everyone.
- **The mic** becomes a small, optional **Echo Mic** agent that *anyone* can install
  on *their own* Raspberry Pi and pair with *their own* browser. Job's Pi is just
  one paired mic like everyone else's. The `/capture` route is retired, but its
  capture tracking and cancel/stop behaviour are kept and reused (next section).

## What v1.7 already built (reuse it, don't rebuild it)

Today's owner-only Pi capture already solves several problems the agent design
has. The code is in `main.py` (`_capture`, `_capture_lock`, `_run_rec`,
`DELETE /capture`) and the tests are CAP-001…020.

- **One capture at a time, tracked by the server.** A single record holds the
  running capture: its process, its phase (`recording` or `analysing`) and any
  stop/cancel already asked for. A second request gets an immediate "busy"
  (503 `mic_busy`). For BYO this becomes **one tracked job per paired mic**,
  with the same fields.
- **Cancel and Stop.** `DELETE /capture?action=cancel` kills the recording and
  saves nothing, and also works during the analysis. `?action=stop` ends the
  recording now and keeps what was recorded (under 1 s counts as a cancel).
  The agent should support the same two actions with the same meaning: cancel
  = kill the recorder's whole process group and delete the file; stop = SIGINT
  to `arecord`, which leaves a valid WAV.
- **Safe at any moment.** The first stop or cancel wins and any later one is a
  no-op; nothing is signalled after the recorder has exited; a cancel that
  arrives before the recorder starts means it never starts. CAP-017 fires both
  actions at 18 offsets around the end of a recording. Job routes need the
  same guarantees.
- **A hard limit on the recorder.** `rec` is killed, process group and all, at
  duration + 10 s. The agent needs the same guard locally.
- **A trace with no personal data.** `capture_trace.py` logs each step with no
  IPs, visitor IDs or token values. Job routes should log the same way.
- **The app side.** The recording screen ("Pi mic is listening", countdown,
  Stop, Cancel) and the recovery when the answer is lost (find the new clip in
  History when the app comes back to the foreground) work for a remote mic
  unchanged. The app also treats "busy" and "try later" as notices, not errors.
- **Parameters in the URL, no request body**, for anything behind Cloudflare
  Access (CLAUDE.md, LEARNINGS.md "Pi mic capture hang").
- **Ownership.** A capture's clip already belongs to the browser that asked
  (PRIV-009), and counts toward its retention.

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
   polls `GET /jobs/{id}` until it's done. One job per mic at a time; the browser
   can stop or cancel it (`DELETE /jobs/{id}?action=stop|cancel`, the same
   meaning as today's `DELETE /capture`).
5. **Disconnect:** "Unpair" in the browser revokes the token instantly, or stop the
   service on the Pi. Either side can end it.

## Rules that must hold

- The agent accepts `record {seconds ≤ 60}` and, for the recording it is making,
  `stop` and `cancel`. It never runs anything else, and the server can't make it
  run anything else.
- One recording per mic at a time. Stop and cancel are safe at any moment, as
  they are today.
- Only the paired browser can trigger its Pi. Tokens can be revoked and listed
  ("Your connected mics").
- The browser clearly shows when a remote mic is listening, with a countdown.
- **Async jobs only.** A 60 s recording + upload + analysis gets too close to
  Cloudflare's ~100 s limit for one request (see CLAUDE.md).
- The mic is held only for the recording, then released, same as today. On Job's Pi
  the agent records through `~/bin/rec` (shared with JARVIS). On other Pis it uses a
  configurable ALSA device.
- Uploads from agents count against the owner's rate limit and retention (20 per
  browser, 30 days) like any other clip, and go through the one-at-a-time
  analysis worker like any other upload.
- Pairing is tied to the browser. Clearing browser data means pairing again
  (accepted trade-off of the no-login decision).

## Possible first step (smaller)

**Upload-only agent:** press a button (or run `echo-mic record 10`) *on the Pi* and
the clip uploads to the paired browser's history. No remote trigger, so no open
connection or job queue. The website trigger can be added on top later.

## Rough size

Three to four sessions: agent + install script; pairing + device tokens; job queue +
WebSocket; UI ("Connect a Pi mic", connected mics) + tests. The remote recording
state, stop/cancel and the capture tracking exist already, which should shorten
the last two.
