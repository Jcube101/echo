# Echo — Roadmap

Echo turns an audio clip into an interactive 3D trail through
pitch/timbre/motion space. This roadmap is the build order: each milestone is
one focused Claude Code session, shippable on its own, with a working state at
the end. Do not start a milestone until the previous one is verified.

Design principle carried across all phases: Echo is **on-demand** — it never
listens in the background, never holds the mic, never runs continuous
processing. That property is what keeps it compatible with everything else on
this Pi.

---

## v1 — Core Product

### M1. Feature extraction engine
The heart of the project — everything else is plumbing around it.
- Standalone Python module: audio file in → per-frame feature JSON out
  (`t`, `pitch`, `timbre`, `motion`, `amplitude`) per SPEC.md
- Verified against a real sample clip: sane pitch range, amplitude 0–1,
  no NaNs, ~20ms hop, point count capped at a few thousand
- **Done when:** running the module on a test clip prints valid JSON

### M2. API + storage
- FastAPI: `POST /upload`, `GET /history`, `GET /history/{id}`
- SQLite metadata only (file paths, never audio blobs)
- 20MB / 60s limits enforced server-side
- Raw audio discarded after processing; small transcoded playback copy kept
- 50-entry retention with automatic cleanup
- **Done when:** all endpoints verified with curl, cleanup rule demonstrated

### M3. 3D visualization
- React + Vite + react-three-fiber scene rendering a static feature JSON
- Trail on pitch/timbre/motion axes, orbit controls, amplitude drives
  point size/color
- **Done when:** the M1 sample clip renders as a navigable 3D trail

### M4. Input flows
- File upload UI (drag/drop + picker)
- In-browser recording via MediaRecorder — the phone-at-the-park flow —
  posting to the same `/upload` endpoint
- **Done when:** a clip recorded on the phone renders end-to-end

### M5. Pi mic capture
- `POST /capture` triggers `~/bin/rec` for a selected duration (max 60s)
- Mic acquired for the recording window only, released immediately
- **Done when:** a Pi-captured clip renders end-to-end

### M6. Playback + spectrogram
- Playback scrubber synced to the 3D trail (current point highlights)
- 2D spectrogram strip below the 3D view
- **Done when:** scrubbing moves the highlight through the trail

### M7. History gallery
- Browsable list of past clips, click to reload any visualization
- **Done when:** gallery shows multiple entries and reload works

### M8. Deployment
- systemd service (`echo.service`), port 8014
- `echo.job-joseph.com` via Cloudflare Tunnel ingress rule
- Register port in dev-meta PORTS.md (done by Job, not CC)
- **Done when:** `curl https://echo.job-joseph.com/history` returns real data
  from outside the LAN

---

## v1.x — Polish (after real use, only if wanted)

- PWA manifest + install-to-home-screen (the park use case benefits most —
  follow the stack's standard vite-plugin-pwa pattern)
- iOS Safari MediaRecorder hardening if testing surfaces issues
- Visual tuning to better match the reference reel (trail fade, point
  glow, camera presets)
- Shareable links to a specific clip's visualization

---

## v2 — Avian Visitors as a Client of Echo (future)

Echo and Avian Visitors are **independent projects with independent goals**:

- **Echo** — 3D acoustic-geometry visualization of any sound. Knows nothing
  about birds or species. Complete on its own.
- **Avian Visitors** (BirdNET-Pi fork, kachō-e collage,
  `birds.job-joseph.com`) — 24/7 bird detection and identification. Complete
  on its own. Built later as its own repo, service, and setup per
  ideas.md #31. Echo is not touched during that build.

The relationship, when both exist: **Avian becomes one more client of Echo's
API** — no different from the phone or a file upload. Avian already records a
clip for every detection it identifies; sending that clip to
`POST /upload` gives each detection a 3D visualization as a bonus. This is
not a workflow, not continuous, and not required by either side — if the
integration breaks or is removed, both projects still work fully alone.

- **On Avian's side:** a small post-detection hook (or on-demand script) that
  POSTs a detection clip to Echo with optional metadata — species,
  confidence, detected-at
- **On Echo's side:** two optional columns (`species`, `confidence`) and a
  gallery filter. Nothing else changes. Can even ship after the hook exists —
  clips arrive fine without metadata.

### Shared mic — decided approach
Echo's Pi-mic use is rare and short (seconds per day); Avian wants the mic
continuously. Plan of record: **arbitration** — Echo's `/capture` stops the
birdnet service, records, and restarts it in a try/finally so birdnet always
resumes even if the recording fails. Requires two scoped sudoers lines
(exact subcommand + service name only). **Fallback:** a second USB mic
(~₹500) removes the need for arbitration entirely — buy it if arbitration
proves flaky in practice.

### Open items for when Avian is scoped (not Echo's concern)
- **Mic placement:** the Pi and mic live inside the house — 24/7 outdoor
  bird detection likely needs the mic at a window (USB extension cable), and
  the ₹500 second mic could double as the dedicated window mic, solving
  placement and sharing in one purchase
- **Retention pressure:** bird detections arrive far faster than manual
  uploads — revisit Echo's 50-entry cap with per-source_type retention so
  auto-ingested clips never evict manually recorded ones

---

## Deferred / Ideas (no commitment)

- Live transcription overlay — only if a lightweight local model proves
  feasible on Pi CPU
- Comparison mode: two clips rendered side by side or overlaid (e.g. same
  bird species, different mornings)
- Export: short screen-recorded MP4/GIF of an orbiting trail for sharing
- Ollama-generated plain-language description of a clip's acoustic character
- NVMe migration for larger history retention (Phase 2 hardware, only if
  the 50-entry cap actually pinches)