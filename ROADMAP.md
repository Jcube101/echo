# Echo — Roadmap

**Living document** — jointly maintained by Job and Claude Code sessions.
Update status inline as work starts and ships; log notable changes in the
Changelog at the bottom. Last updated: 2026-11-13.

Echo turns an audio clip into an interactive 3D trail through
pitch/timbre/motion space. This roadmap is the build order: each milestone is
one focused Claude Code session, shippable on its own, with a working state at
the end. Do not start a milestone until the previous one is verified.

Design principle carried across all phases: Echo is **on-demand** — it never
listens in the background, never holds the mic, never runs continuous
processing. That property is what keeps it compatible with everything else on
this Pi.

### Status legend
| Symbol | Meaning |
|---|---|
| ✅ | Shipped — live in the deployed app, verified |
| 🚧 | In progress — partially built, work remaining |
| 📋 | Planned — scoped/decided, not yet started |
| 💡 | Idea — under consideration, no commitment |

### At a glance
| Version | Status |
|---|---|
| v1 — Core Product (M1–M9) | ✅ Shipped |
| v1.x — Polish | 🚧 In progress (1 of 4 items started) |
| v1.5 — Extended Spectral Analysis Panel | ✅ Shipped (2D panel; 3D cube deferred) |
| v1.6 — Frontend Redesign (Design v2) | ✅ Shipped (2026-11-12) |
| v1.7 — Public Launch | 🚧 In progress (built and live 2026-11-13; three checks waiting on Job) |
| v1.8 — Bring Your Own Pi Mic | 💡 Idea |
| v2 — Avian Visitors integration | 📋 Planned |
| Deferred / Ideas | 💡 Idea |

---

## v1 — Core Product — ✅ Shipped

### M1. Feature extraction engine — ✅ Shipped
The heart of the project — everything else is plumbing around it.
- Standalone Python module: audio file in → per-frame feature JSON out
  (`t`, `pitch`, `timbre`, `motion`, `amplitude`) per SPEC.md
- Verified against a real sample clip: sane pitch range, amplitude 0–1,
  no NaNs, ~20ms hop, point count capped at a few thousand
- **Done when:** running the module on a test clip prints valid JSON

### M2. API + storage — ✅ Shipped
- FastAPI: `POST /upload`, `GET /history`, `GET /history/{id}`
- SQLite metadata only (file paths, never audio blobs)
- 20MB / 60s limits enforced server-side
- Raw audio discarded after processing; small transcoded playback copy kept
- 50-entry retention with automatic cleanup
- **Done when:** all endpoints verified with curl, cleanup rule demonstrated

### M3. 3D visualization — ✅ Shipped
- React + Vite + react-three-fiber scene rendering a static feature JSON
- Trail on pitch/timbre/motion axes, orbit controls, amplitude drives
  point size/color
- **Done when:** the M1 sample clip renders as a navigable 3D trail

### M4. Input flows — ✅ Shipped
- File upload UI (drag/drop + picker)
- In-browser recording via MediaRecorder — the phone-at-the-park flow —
  posting to the same `/upload` endpoint
- **Done when:** a clip recorded on the phone renders end-to-end

### M5. Pi mic capture — ✅ Shipped
- `POST /capture` triggers `~/bin/rec` for a selected duration (max 60s)
- Mic acquired for the recording window only, released immediately
- **Done when:** a Pi-captured clip renders end-to-end

### M6. Playback + spectrogram — ✅ Shipped
- Playback scrubber synced to the 3D trail (current point highlights)
- 2D spectrogram strip below the 3D view
- **Done when:** scrubbing moves the highlight through the trail

### M7. History gallery — ✅ Shipped
- Browsable list of past clips, click to reload any visualization
- **Done when:** gallery shows multiple entries and reload works

### M8. Deployment — ✅ Shipped
- systemd service (`echo.service`), port 8014
- `echo.job-joseph.com` via Cloudflare Tunnel ingress rule
- Register port in dev-meta PORTS.md (done by Job, not CC)
- **Done when:** `curl https://echo.job-joseph.com/history` returns real data
  from outside the LAN

### M9. Sample library — ✅ Shipped
Shipped in Session 5, after initial v1 launch — added so someone with no
sound to hand can still see the visualization. Expanded in two later
sessions (2026-07-25) from 3 bird clips to 14 clips across two sources, so
the sample library actually demonstrates the 3D box's full pitch/timbre/
motion range instead of clustering in the high-pitch birdsong region. The
second expansion round targeted the low-pitch band specifically —
quantified as genuinely empty (not assumed) with
`verification/coverage_gap.py`, then filled by measuring ~11 real
candidates and keeping only the 4 that measurably closed it.
- Curated store under `samples/` (audio + features + attribution), served by
  dedicated `/samples*` endpoints — never a `clips` table row, so the
  50-entry retention rule can't evict it
- "🔊 Sample sounds" drawer in the UI, distinct from the personal History
  gallery, each card showing attribution (recordist, license, source link)
  per the source clip's Creative Commons license
- Two independent sources, tracked per-entry via a `provider` field:
  - 3 birds (Asian Koel, Common Myna, Rose-ringed Parakeet) from
    `test-fixtures/xeno-canto/`, seeded by `verification/seed_samples.py`
  - 11 non-bird animal sounds (Lion, Wolf, Cow, Dog, Cat, Frog, Cricket, Pig,
    Red Deer, Bullfrog, Camel) from the Freesound API, seeded by
    `verification/fetch_freesound_samples.py`
- **Done when:** the drawer lists the sample clips and each renders/plays
  end-to-end with attribution visible

---

## v1.x — Polish (after real use, only if wanted) — 🚧 In progress

- ✅ **Shipped** — PWA manifest + install-to-home-screen (the park use case
  benefits most — follow the stack's standard vite-plugin-pwa pattern).
  *Absorbed into v1.6 S1 and shipped there (2026-11-12)*
- 📋 **Planned** — iOS Safari MediaRecorder hardening if testing surfaces
  issues (untested on a real device — see `LEARNINGS.md` follow-ups)
- 🚧 **In progress** — Visual tuning to better match the reference reel.
  Point glow + additive-blend teal styling shipped in the post-launch visual
  overhaul; trail time-fade and camera presets are still open
- 📋 **Planned** — Shareable links to a specific clip's visualization
- ✅ **Shipped (session 7, 2026-07-19)** — shadcn/ui component polish: Buttons,
  Select, Tabs, Sheet + Card (History/Samples), and real toast feedback
  (sonner) replaced the raw HTML controls, with proper hover/focus/disabled/
  loading states. Palette mapped to Echo's existing colors (pixel-identical
  before/after, verified by diff), the 3D trail and spectral-panel line
  colors untouched. Pinned to `shadcn@2.10.0` (Tailwind v3-compatible; the
  latest CLI targets Tailwind v4). See `LEARNINGS.md` "shadcn/ui component
  polish" and `VERIFICATION_LOG.md` Session 7.

---

## v1.5 — Extended Spectral Analysis Panel — ✅ Shipped (session 6, 2026-07-19)

Shipped: a **2D multi-line time-series panel** (the reference's "DB Domain
Descriptors" view) as a genuinely separate view from the 3D trail, reached by a
header tab toggle. Seven engineered descriptors — Spectral Spread, Crest,
Contrast, Slope, Flatness, HNR, and a Tonality composite — plotted against the
shared time axis, with a hover/tap readout (physical value + unit per line), a
playhead driven by the same scrubber state as the spectrogram, and per-line legend
toggles. Works for history + sample clips. Formulas, fixed ranges, and the
tonality/crest/slope/HNR judgment calls are documented in `LEARNINGS.md`
(session 6). Also shipped alongside it: the **feature-schema versioning system**
(Part 0) — see the binding rule in `CLAUDE.md`.

**Deferred (clean follow-up, deliberately not attempted this session):** the
reference's *second 3D scene* (a Spread/Centroid/Crest cube). The per-frame data
it would need already ships in every v2 feature payload, so it's purely a frontend
addition when picked up.

Original scoping notes below are kept for context.

Inspired by a more advanced reference visualization (a multi-panel bird-audio
analysis tool, screenshot saved by Job) that extracts a much richer feature
set than Echo's current pitch/timbre/motion. Not a replacement for the
existing 3D trail — a **second, additional view** alongside it.

### New features to add (all of them, decided)
Six additional engineered audio descriptors, on top of what Echo already
computes:

- **Spectral Spread** — how concentrated vs. dispersed energy is around the
  centroid
- **Spectral Crest** — peak-to-average ratio (tonal peakiness vs. flat noise)
- **Spectral Contrast** — peak/valley difference across sub-bands (separates
  tonal calls from noisy/breathy ones)
- **Spectral Slope** — spectral tilt, low-to-high frequency energy decline
- **Spectral Flatness** — standard feature (`librosa.feature.spectral_flatness`)
  — noise-like vs. tonal
- **Harmonic/Noise Ratio (HNR)** — periodic vs. noise energy ratio
- **Tonality** — likely a composite score derived from flatness/HNR; needs
  its own definition when this is scoped in detail, no standard single
  librosa function for it

Note what's already covered under different names — no need to reinvent:
Echo's **timbre** (log2 spectral centroid) *is* Spectral Centroid; Echo's
**motion** (onset strength) is conceptually near-identical to **Spectral
Flux** (flux is the standard basis for onset detection). Confirm during
scoping whether to keep the existing names or rename to match convention.

### How this shows up in the app (decided)
A **second panel/view alongside the existing 3D trail** — not a replacement
of pitch/timbre/motion, and not merged into the same 3D scene. Likely
something like: the current 3D trail stays as the primary view, plus a new
panel (a second 3D scene on different axes, and/or a 2D multi-line
time-series panel showing several of these features plotted against time,
similar to how the spectrogram strip already sits below the main view).

### Resolved — it's a time trail
Confirmed by watching the source video: the connecting lines are a time
trail, same paradigm as Echo's existing trail (the line visibly "bounces"
across time as the bird sings) — not a similarity/nearest-neighbor graph.
No new interaction model needed; this panel is the same time-sequential
trail concept, just on richer axes.

### Also worth deciding when scoped
- Point-level hover/tap readouts showing exact numeric values — the
  reference has this, Echo currently has none
- Whether any of these six features affect the fixed-world-scale
  normalization approach (Part B/session-5 decisions) or need their own
  independent scale

---

## v1.6 — Frontend Redesign (Design v2) — ✅ Shipped

Full brief, tokens, screen specs, final copy and open decisions: **`DESIGN_V2.md`**.
Frontend only, plus one backend route; no extraction/schema/storage changes.

- ✅ **Shipped** — S1 Routing + PWA: landing at `/`, app at `/app` (backend
  `/app` route above the StaticFiles mount), PWA `start_url: /app`. Absorbs the
  v1.x PWA item. **Live (2026-11-12):** placeholder landing at `/`,
  today's app at `/app`, `/app?record=1` auto-starts the recorder,
  vite-plugin-pwa manifest + service worker. Job confirmed on his Android
  phone: the PWA installs and opens at `/app`, and `/app?record=1` starts
  recording after the permission prompt. The home-screen icon is a
  placeholder (replace in S2/S4)
- ✅ **Shipped** — S2 Design tokens + desktop app reskin (header, clip sidebar,
  dock + spectrogram, Spectral panel labels). **Live (2026-11-12):** v2
  tokens + self-hosted fonts; new header; trail coloured by loudness (D4) and
  the new spectrogram ramp (D5), both as Job decided; clip sidebar at ≥1200px;
  Spectral panel as seven stacked lanes with a label column. Camera presets
  (D6) left out at Job's call. Known gaps, all from "no API changes": history
  clips can't show a filename or tell an upload from a browser recording.
  Deviations from the mockups are listed in VERIFICATION_LOG.md Session 11
- ✅ **Shipped** — S3 Phone app: idle home, recording screen, result screen.
  **Live (2026-11-12)** below 640px: home (record circle, Upload,
  Pi mic, four samples), full-screen recording (countdown ring, live level
  bars, Stop / Cancel), result (tabs, trail, playhead chips, spectrogram,
  dock, attribution). Job confirmed on his Android phone: recording end to
  end works, and Cancel returns home with nothing added to History. Sample thumbnails on the home list
  are deferred to S4, which generates static sample images anyway
- ✅ **Shipped** — S4 Landing page, desktop + phone, with a static hero SVG and
  FAQ (closed by default). **Live (2026-11-12):** all eight sections;
  illustrations, sample thumbnails and sample details generated by
  `build_landing_art.py` (no API calls on `/`); deep links `/app?sample=<id>`
  and `/app?samples=1`; the app split into its own chunk so `/` weighs 142 KB
  as served (without fonts); thumbnails on the phone home list. Bird language
  removed from the copy at Job's call. Lighthouse accessibility: **100** on mobile
  and desktop (`npm run lighthouse`, added as a dev dependency at Job's
  request), so every "done when" item is met
- ✅ **Shipped** — S5 Update Vitest/Playwright tests for the new UI; docs.
  **Done (2026-11-12):** unit tests for the sidebar, phone screens, Spectral
  panel and landing page (Vitest 56 → 84); stale test wording refreshed;
  HW-005 no longer hardcodes 3 samples; README, SPEC and TEST_PLAN brought up
  to date. Final state: pytest 103, Vitest 84, Playwright 29 of 30 (E2E-010
  is the long-standing no-audio-session gap), Lighthouse accessibility 100

Open after v1.6 (none blocking): camera presets (DESIGN_V2.md D6, left out at
Job's call); real icons to replace the placeholder PWA icons; `/history`
stores neither a filename nor whether a clip was uploaded or recorded, so
history clips read "Upload or recording"; the 3D axis labels still fetch
their font from a CDN, the one part of the app shell that isn't offline

- ✅ **Shipped** — v1.6 follow-ups (2026-11-12, at Job's request). Only the
  camera presets remain open.
  - **E2E-010 passes.** The Playwright config used Chromium flag names that
    don't exist (`…-for-media-capture`), so the fake mic was never on; the
    real names are `--use-fake-device-for-media-stream` and
    `--use-fake-ui-for-media-stream`. The earlier "no audio session /
    pipewire" diagnosis was wrong. Playwright is now 31 of 31
  - **PWA icon.** A tapering trail in the loudness colours ending at the
    playhead ring; all five files are drawn by `node e2e/build-icons.mjs`
  - **History clips say what they are.** `/upload` takes an optional
    `source=recording` form field and keeps an uploaded file's name;
    `/history` rows gain `name`, and `source_type` gains `recording`. Clips
    saved earlier still read "Upload or recording" until they age out
  - **3D axis labels work offline.** They use the build's own IBM Plex Mono
    (`.woff`, precached), so `/app` fetches nothing from another origin

---

## v1.7 — Public Launch — 🚧 In progress

Full brief and Job's settled decisions (L1–L6): **`docs/LAUNCH.md`**. Make
`echo.job-joseph.com` safe to share with friends and strangers, with no logins.
Touches the DB schema (`owner_id`, `last_seen_at` columns) but **not** the
feature schema — no `FEATURE_SCHEMA_VERSION` bump.

- ✅ **Shipped (live 2026-11-13)** — §1 Private history per browser: `echo_vid`
  cookie, owner checks on every clip route, `DELETE /history/{id}`, retention
  of 20 per browser / 500 clips or 1 GB site-wide / 30 days inactive (L6). The
  44 existing ownerless clips were dropped at deploy (L7, Job's call)
- 🚧 **In progress** — §2 Pi mic for Job only, via Cloudflare Access (L5).
  **Built and live:** Echo verifies the Access token itself and fails closed;
  `/me`, `/api/me`; the Pi mic button shows only for the signed-in owner.
  **Waiting on Job:** the Access application and `access.env`, then a real
  recording after signing in at `/me`
- ✅ **Shipped (live 2026-11-13)** — §3 Protect the Pi: one analysis at a time
  in a separate worker process with a 60 s kill (503 when busy), upload rate
  limits (429), ffmpeg timeouts, a locked-down `echo.service` (exposure
  9.2 → 6.7). `MemoryMax` is inert on this Pi (kernel boots with
  `cgroup_disable=memory`), so `OOMScoreAdjust=500` is used too. Burst of five
  60 s uploads on the live unit: 2 processed, 3 friendly 503s, Echo CPU peak
  131% of a 200% cap, 52 °C, every other service still up
- ✅ **Shipped (live 2026-11-13)** — §4 Smaller checks: API docs off in
  production, security headers + CSP, `/api/health` = `{"ok": true,
  "status": "ok"}` (L9), no IP addresses in Echo's logs, data-cap warning,
  Privacy dialog. **Waiting on Job:** recording on Android Chrome and on an
  iPhone; the uptime check; whether to allow Cloudflare Web Analytics in the
  CSP (it is blocked today)

Everything in `docs/LAUNCH.md` §5 that a session can check passes on the live
site (`VERIFICATION_LOG.md` Session 16). Final state: pytest 181, Vitest 101,
Playwright 38, Lighthouse accessibility 100. v1.7 turns ✅ when Job reports the
`/me` recording, Android Chrome and the iPhone result.

---

## v1.8 — Bring Your Own Pi Mic — 💡 Idea

Design note: **`docs/BYO_PI_MIC.md`**. Starts only after v1.7 ships. Processing
stays on Job's Pi; the mic becomes a small optional agent anyone can install on
their own Raspberry Pi and pair with their own browser. `/capture` is retired
when this lands; the `/me` Access gate stays for owner-only pages. Roughly three
to four sessions; a smaller upload-only agent is a possible first step.

---

## v2 — Avian Visitors as a Client of Echo (future) — 📋 Planned

**Reaffirmed decision:** species identification (BirdNET — Cornell's
acoustic classifier) stays entirely inside Avian Visitors. Echo remains
bird-agnostic and never runs a classification model itself; it only ever
receives a species label as metadata from Avian via the bridge below. This
was explicitly reconsidered (not just defaulted to) when Job asked about
adding recognition directly to Echo, and confirmed as the right split.

**Correction worth keeping on record:** there's no standalone "Cornell API
key" that identifies a species from audio. BirdNET is a model you run
locally against the clip, not an API call — that's the actual work Avian
Visitors does. The eBird API key is a separate, unrelated thing: it only
filters species lists by region (e.g. Karnataka), it doesn't listen to
anything.

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

## Deferred / Ideas (no commitment) — 💡 Idea

- Live transcription overlay — only if a lightweight local model proves
  feasible on Pi CPU
- Comparison mode: two clips rendered side by side or overlaid (e.g. same
  bird species, different mornings)
- Export: short screen-recorded MP4/GIF of an orbiting trail for sharing
- Ollama-generated plain-language description of a clip's acoustic character
- NVMe migration for larger history retention (Phase 2 hardware, only if
  the 50-entry cap actually pinches)

---

## Changelog

- **2026-11-13** — v1.7 Public Launch built and live: private history per
  browser, new retention (L6), the owner-only gate, the analysis worker
  process, rate limits, the service lock-down, security headers. Decided
  (Job): drop the 44 existing clips (L7); Access settings in
  `~/.config/echo/access.env` (L8); `/api/health` keeps `status` (L9); analysis
  in a separate process at about 420 MB total; FAQ says "under 15 seconds".
  Stays 🚧 until Job confirms the `/me` recording and the phone checks.
- **2026-11-12** — Added v1.7 Public Launch (🚧 in progress, brief in
  `docs/LAUNCH.md`) and v1.8 Bring Your Own Pi Mic (💡 idea, design note in
  `docs/BYO_PI_MIC.md`).
- **2026-11-12** — Shipped v1.6 S5 (tests + docs); **v1.6 Frontend Redesign
  complete.** Follow-ups listed at the end of the v1.6 section.
- **2026-11-12** — Shipped v1.6 S4 (landing page). Decided (Job): no bird
  language in the landing copy — hero sub-lines and one FAQ question reworded,
  DESIGN_V2.md §5 updated. Lighthouse added as a dev dependency
  (`npm run lighthouse`): accessibility 100 on mobile and desktop.
- **2026-11-12** — Shipped v1.6 S3 (phone app: home, recording, result).
  Recording end to end and Cancel confirmed by Job on his Android phone.
- **2026-11-12** — Shipped v1.6 S2 (tokens + desktop app reskin). Job decided
  D4 (loudness-coloured trail) and D5 (new spectrogram ramp) in favour of the
  design; D6 (camera presets) left out for now.
- **2026-11-12** — Shipped v1.6 S1 (routing + PWA), live behind the tunnel:
  `/app` SPA route, placeholder landing at `/`, `/app?record=1`, PWA manifest
  (`start_url: /app`) + service worker. Android install and `?record=1`
  confirmed by Job on his phone. The v1.x PWA item is absorbed here.
- **2026-11-11** — Added v1.6 Frontend Redesign (Design v2) as planned, with
  the full brief in `DESIGN_V2.md`. Decided: landing page at `/`, app at `/app`,
  no species/ID language on the site.
- **2026-07-19** — Shipped shadcn/ui component polish (session 7, frontend
  only): Button/Select/Tabs/Sheet+Card/toast primitives replace the raw HTML
  controls; palette mapped to Echo's exact existing colors (verified
  pixel-identical); 3D trail and spectral-panel colors untouched. Two e2e
  specs updated to target the new Sheet's accessible structure instead of the
  old drawer's implementation-detail classes.
- **2026-07-19** — Shipped v1.5: the 2D Spectral Analysis panel (seven descriptors,
  hover readout, scrubber-synced playhead) plus the Part 0 feature-schema
  versioning system (version stamp + `schema_audit.py` + `migrate_schema.py` +
  `GET /api/schema-audit` + enforced CLAUDE.md rule). Six new fields migrated
  across all 35 history + 3 sample clips (v1→v2, zero stale). The reference's
  second 3D (Spread/Centroid/Crest) scene is deliberately deferred.
- **2026-07-18** — Converted to a living document: added the status legend,
  at-a-glance table, and per-milestone/per-item status (✅/🚧/📋/💡)
  throughout. `ROADMAP.md` maintenance is now shared between Job and Claude
  Code sessions (was Job-only) — see `CLAUDE.md`. Also added M9 (sample
  library, retroactively — shipped in Session 5) and the v1.5 section /
  expanded v2 context that had been missing.