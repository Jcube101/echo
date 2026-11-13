# Echo — Public launch brief (Session 6)

**Status:** ✅ Shipped 2026-11-13. Known gap: iOS Safari untested, no device (results: `VERIFICATION_LOG.md` Session 16) · **Goal:** make `echo.job-joseph.com` safe to share with
friends and strangers, with no logins.
**Order:** do this **before** the "Bring your own Pi mic" work (`docs/BYO_PI_MIC.md`).

CLAUDE.md rules apply in full. This touches the DB schema (a new column) but **not**
the feature schema — no `FEATURE_SCHEMA_VERSION` bump, no `migrate_schema.py`.

---

## Decisions (Job, 2026-11-12) — all settled, don't re-ask

| # | Decision |
|---|---|
| L1 | No accounts or logins. Each **browser** gets its own private history. |
| L2 | The Pi mic is **not** available to the public. Only Job can use it until the BYO Pi mic work replaces it. |
| L3 | Samples stay public for everyone, unchanged. |
| L4 | Protect the Pi: it also runs JARVIS and other services, so Echo must never be able to starve them. |
| L5 | **Pi mic gate = Cloudflare Access (option a).** Home-network-only (option b) was considered and rejected: it doesn't work away from home and lets anyone on the Wi-Fi trigger the mic. |
| L6 | **Retention changes** from a global 50 to: **20 per browser**, **500 clips or 1 GB site-wide** (whichever first), and **30-day inactivity** deletion. Job has approved updating the Locked Decision row in CLAUDE.md. |
| L7 | **Existing clips are dropped, not claimed** (plan review, 2026-11-12). No `claim_clips.py`. At deploy, every clip with `owner_id IS NULL` is deleted (rows + audio + feature files): print the count first, then delete, and log it in `VERIFICATION_LOG.md`. Samples are untouched. |
| L8 | **Access settings live in `/home/jcube/.config/echo/access.env`** (plan review, 2026-11-12): outside the repo, `chmod 600`, read by the unit's `EnvironmentFile=-…`. Job fills it in; no sudo needed to edit it. |
| L9 | **`/api/health` stays backward-compatible** (plan review, 2026-11-12): `{"ok": true, "status": "ok"}`. |

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
- Update CLAUDE.md's "History retention" row to match (approved by Job, decision L6).

**Existing clips (decision L7):** dropped at deploy. Every clip with
`owner_id IS NULL` is deleted (rows + audio + feature files) after printing the
count, and the count is logged in `VERIFICATION_LOG.md`. Samples are untouched.

**UI**

- History sheet: "Your clips live in this browser only." + a delete button per clip.
- FAQ: replace the "Is my audio kept?" answer with: *Only a small copy for playback,
  and only this browser can see it. The original file is discarded after analysis,
  and clips you haven't opened in 30 days are deleted.* Update the 50-clip wording
  everywhere (copy in `DESIGN_V2.md` §5 too).

---

## 2. Pi mic: Job only, via Cloudflare Access (decision L5)

**What Job sets up by hand** (Cloudflare Zero Trust dashboard, free plan, one time):

1. Zero Trust → Access → Applications → add a **self-hosted** application on
   `echo.job-joseph.com` covering the paths **`/me`**, **`/capture`** and
   **`/api/schema-audit`**.
2. Policy: **Allow**, include **Emails** = Job's email only. Login method: one-time PIN.
3. Session duration: **1 month**.
4. Copy the application's **AUD tag** and the team domain
   (`<team>.cloudflareaccess.com`) into `/home/jcube/.config/echo/access.env`
   (`ECHO_CF_ACCESS_AUD`, `ECHO_CF_TEAM_DOMAIN`; decision L8). The unit reads it
   with `EnvironmentFile=`; it is outside the repo, never in git. Then
   `sudo -n systemctl restart echo`.

Claude Code writes these steps into the end-of-session checklist and does not
attempt them.

**What Echo does**

- **Verify the token itself.** Any request to a gated route must carry a valid
  `Cf-Access-Jwt-Assertion` header: signature checked against
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cache the keys),
  `aud` = `ECHO_CF_ACCESS_AUD`, not expired. Otherwise **404**. This matters
  because anything on the home Wi-Fi can reach port 8014 directly and skip
  Cloudflare. No valid JWT means no mic, from anywhere.
- If `ECHO_CF_ACCESS_AUD` isn't set, gated routes are **always 404** (fail closed).
- **`GET /me`** (gated): the sign-in step. Cloudflare asks for Job's email the first
  time. Echo then redirects to `/app?owner=1`. After that, the Access cookie lets
  `/capture` calls from the app through for a month.
- **`GET /api/me`** (public): `{"pi_mic": true}` only when the request carries a
  valid Access JWT, else `{"pi_mic": false}`. The app shows the **Pi mic** button only
  when it's true.
- When the session expires, `/capture` 404s → the app hides the button and shows
  "Sign in again at /me" in a toast (only to someone who had it before).
- Add `PyJWT[crypto]` to `requirements.txt` if needed (pin per CLAUDE.md conventions).
- Tests: forged / expired / wrong-audience tokens → 404. No env set → 404. Valid
  token (signed with a test key in the fixture) → passes the gate.
- The BYO Pi mic work will later replace `/capture`; `/me` and the gate stay for
  owner-only pages.

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
  `MemoryMax=1G`, `CPUQuota=200%` (leaves headroom for other services on the Pi 5's 4 cores).
  *Found during the build:* this Pi's kernel boots with `cgroup_disable=memory`, so
  `MemoryMax` is inert here; the unit also sets `OOMScoreAdjust=500` so Echo is
  killed (and restarted) first under memory pressure. `CPUQuota` works.
- `/capture` needs `~/bin/rec` and the audio device. Check it still works under
  these settings (it may need `DeviceAllow=` / group `audio`). If it can't, ask Job.
- Install with the existing sudo pattern: write to `/tmp/echo.service`, then
  `sudo -n cp`, `daemon-reload`, `restart`.

---

## 4. Smaller checks

- Turn off FastAPI's `/docs`, `/redoc` and `/openapi.json` in production
  (`docs_url=None, redoc_url=None, openapi_url=None` unless `ECHO_DEV=1`).
- `/api/schema-audit`: behind the same Access gate (Job only).
- `/api/health`: keep public, but return only `{"ok": true, "status": "ok"}`
  (decision L9: `status` kept for existing checks).
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
- Without a valid Access JWT (any network, including direct LAN to :8014), the Pi mic
  button is hidden and `POST /capture` → 404. After signing in at `/me`, it records.
- Firing 5 uploads at once gives 1–2 processed and the rest a friendly 503, and
  the Pi stays healthy for other services during the burst: Echo's CPU stays
  ≤200% (the `CPUQuota` works); cloudflared and every other enabled project
  service stay active (`systemctl is-active`); load average and CPU temperature
  stay sane (temp under 70 °C); a quick request to one other tunnelled site still
  answers within a couple of seconds. Hitting the rate limit gives a 429.
- `/docs` → 404 in production. Security headers are present.
- Recording works on Android Chrome, and the iPhone result is noted.
- ROADMAP.md, CLAUDE.md (retention row, with Job's OK), VERIFICATION_LOG.md and
  LEARNINGS.md are updated.
