# Echo — Public launch brief (Session 6)

**Status:** 📋 Planned · **Goal:** make `echo.job-joseph.com` safe to share with
friends and strangers, with no logins.
**Order:** do this **before** the "Bring your own Pi mic" work (`docs/BYO_PI_MIC.md`).

CLAUDE.md rules apply in full. This touches the DB schema (a new column) but **not**
the feature schema — no `FEATURE_SCHEMA_VERSION` bump, no `migrate_schema.py`.

---

## Decisions (Job, 2026-11-12)

| # | Decision |
|---|---|
| L1 | No accounts or logins. Each **browser** gets its own private history. |
| L2 | The Pi mic is **not** available to the public. Only Job can use it until the BYO Pi mic work replaces it. |
| L3 | Samples stay public for everyone, unchanged. |
| L4 | Protect the Pi: it also runs JARVIS and other services, so Echo must never be able to starve them. |

---

## 1. Private history per browser

**Visitor ID**

- On any request without one, the server sets a cookie `echo_vid` = 32 random
  hex chars (`secrets.token_hex(16)`). Flags: `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, `Max-Age` 1 year, refreshed on use. Do this in a small middleware.
- Same origin, so `fetch` sends it by default. **Don't** add
  `credentials: 'include'` anywhere (CLAUDE.md).
- The ID only means "this browser". Never log it next to an IP address.

**Database**

- Add `owner_id` (string, indexed, nullable) and `last_seen_at` to `clips`, via the
  existing `_ensure_columns()` pattern in `db.py`. Record who uploaded each clip.
- New clip IDs: switch `uuid.uuid4().hex[:12]` → full `uuid.uuid4().hex`
  (unguessable). Audio file names follow the clip ID, so they become unguessable too.

**Every clip route checks ownership**

| Route | Rule |
|---|---|
| `GET /history` | Only clips where `owner_id == echo_vid` |
| `GET /history/{id}` | 404 unless the owner matches (404, not 403 — don't confirm it exists) |
| `GET /audio/{file}` | Same check, through the clip row |
| `DELETE /history/{id}` | **New.** Owner only. Deletes the row and both files |
| `/samples*` | Unchanged, public |

**Retention (replaces the single global 50)**

- Per browser: keep the newest **20** clips (`RETENTION_PER_OWNER`).
- Whole site: hard cap **500** clips or **1 GB** in `data/`, whichever comes first
  (`RETENTION_GLOBAL_*`). When it's hit, delete the oldest clips site-wide.
- Inactivity: delete any owner's clips not opened for **30 days**. Run it at
  startup and once a day (a systemd timer, or a check on each upload).
- Update CLAUDE.md's "History retention" row, with Job's OK, since it's a Locked Decision.

**Existing clips:** add a one-off admin script `claim_clips.py <visitor_id>` that
assigns every `owner_id IS NULL` clip to Job's browser ID. Job copies his ID from
the browser's cookie. Anything left unclaimed after launch is deleted.

**UI**

- History sheet: "Your clips live in this browser only." + a delete button per clip.
- FAQ: replace the "Is my audio kept?" answer with: *Only a small copy for playback,
  and only this browser can see it. The original file is discarded after analysis,
  and clips you haven't opened in 30 days are deleted.* Update the 50-clip wording
  everywhere (copy in `DESIGN_V2.md` §5 too).

---

## 2. Pi mic: Job only

- Hide the **Pi mic** button unless `GET /api/me` says `{"pi_mic": true}`.
- `POST /capture` returns **404** unless the request is allowed. Allowed means either:
  - **(a, recommended)** a **Cloudflare Access** policy on `echo.job-joseph.com/capture`
    that only lets in Job's email. Echo then checks the `Cf-Access-Jwt-Assertion`
    header is present and valid (verify against the team's public certs), **or**
  - **(b)** the request comes from the home LAN (`CF-Connecting-IP` is absent and the
    client IP is in `192.168.0.0/16`), for use on home Wi-Fi only.
- Ask Job which option before building. (a) needs a one-time Cloudflare Zero Trust
  setup in the dashboard, which Job does by hand.
- The BYO Pi mic work will later replace `/capture` entirely.

---

## 3. Protect the Pi

**One analysis at a time**

- A process-wide `asyncio.Semaphore(1)` (tunable `MAX_CONCURRENT_EXTRACTIONS`, max 2)
  around ffmpeg + extraction. When busy, wait up to ~20 s, then return **503**
  `"Echo is busy — try again in a moment."` with `Retry-After: 15`. The frontend
  shows it as a friendly toast, not an error.
- Keeps every request well under Cloudflare's ~100 s limit.

**Rate limits** (per visitor ID *and* per IP from `CF-Connecting-IP`)

- Uploads: **10 per hour, 30 per day**. Return 429 with a plain-language message.
- Implement in-app (a small in-memory token bucket is enough on one process).
  Optionally also add Cloudflare's free rate-limiting rule on `/upload` as an
  outer guard; Job sets that up in the dashboard.

**Untrusted files**

- Keep the 20 MB / 60 s limits. Add a **30 s timeout** to every ffmpeg call and
  `-nostdin`. Reject anything ffprobe can't identify as audio/video before decoding.
- Write uploads to a temp dir that's cleaned on success *and* failure.

**Lock down the service** (`echo.service`)

- Runs as `jcube`, never root (confirm).
- Add: `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`,
  `ProtectHome=read-only`, `ReadWritePaths=/home/jcube/projects/echo/data`,
  `MemoryMax=1G`, `CPUQuota=200%` (leaves headroom for JARVIS on the Pi 5's 4 cores).
- `/capture` needs `~/bin/rec` and the audio device. Check it still works under
  these settings (it may need `DeviceAllow=` / group `audio`). If it can't, ask Job.
- Install with the existing sudo pattern: write to `/tmp/echo.service`, then
  `sudo -n cp`, `daemon-reload`, `restart`.

---

## 4. Smaller checks

- Turn off FastAPI's `/docs`, `/redoc` and `/openapi.json` in production
  (`docs_url=None, redoc_url=None, openapi_url=None` unless `ECHO_DEV=1`).
- `/api/schema-audit`: same gate as `/capture` (Job only).
- `/api/health`: keep public, but return only `{"ok": true}`.
- Security headers on every response: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, `Permissions-Policy: microphone=(self)`,
  and a CSP that allows self + `blob:` media + the WebGL/worker needs of R3F.
- Logs: no visitor IDs next to IPs. Keep logs for 14 days at most.
- **iOS Safari:** test recording on a real iPhone (it's never been tried). Fix what's
  cheap, and note anything that isn't in LEARNINGS.md.
- **Monitoring:** a free uptime check on `https://echo.job-joseph.com/api/health`
  (UptimeRobot or similar, set up by Job), plus a daily log warning when `data/`
  passes 80% of the cap.
- Footer: add a short **Privacy** page or modal with the same wording as the FAQ.

---

## 5. Done when

- Two different browsers can't see, open or play each other's clips. Verify with
  Playwright: two browser contexts, plus direct `GET /history/{id}` and
  `/audio/{file}` from the wrong context → 404.
- Delete works, and the files are gone from disk.
- Per-browser, global and 30-day retention are covered by pytest.
- From outside the home network, the Pi mic button is hidden and `POST /capture` → 404.
  From Job's allowed path it still records.
- Firing 5 uploads at once gives 1–2 processed and the rest a friendly 503, with
  JARVIS still responsive. Hitting the rate limit gives a 429.
- `/docs` → 404 in production. Security headers are present.
- Recording works on Android Chrome, and the iPhone result is noted.
- ROADMAP.md, CLAUDE.md (retention row, with Job's OK), VERIFICATION_LOG.md and
  LEARNINGS.md are updated.
