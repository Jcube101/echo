"""Echo — anonymous per-browser visitor ID (docs/LAUNCH.md §1, decision L1).

No accounts: each browser gets a random `echo_vid` cookie, and every clip it
makes is tagged with it. The ID means only "this browser". It is never logged,
and never stored next to an IP address.

The cookie is set (or refreshed) only on routes that work with a visitor's
clips, plus the app page itself. Static files (landing page, /assets/*,
samples) never carry Set-Cookie, because Cloudflare won't edge-cache a
response that sets a cookie.
"""

from __future__ import annotations

import re
import secrets

COOKIE = "echo_vid"
MAX_AGE_S = 365 * 24 * 3600  # one year, refreshed on every use

_VALID = re.compile(r"[0-9a-f]{32}")
_EXACT = {"/upload", "/capture", "/history", "/me", "/api/me", "/app"}
_PREFIXES = ("/history/", "/audio/", "/app/")


def applies(path: str) -> bool:
    """Does this route read or set the visitor cookie?"""
    return path in _EXACT or path.startswith(_PREFIXES)


def new_id() -> str:
    return secrets.token_hex(16)  # 32 hex chars


def parse(raw: str | None) -> str | None:
    """The cookie's ID if it is well-formed, else None (a fresh one is minted)."""
    if raw and _VALID.fullmatch(raw):
        return raw
    return None


def set_cookie(response, vid: str) -> None:
    response.set_cookie(COOKIE, vid, max_age=MAX_AGE_S, path="/",
                        httponly=True, secure=True, samesite="lax")
