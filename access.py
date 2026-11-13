"""Echo — owner-only gate, backed by Cloudflare Access (docs/LAUNCH.md §2, L5).

The Pi mic (and anything else marked owner-only) is for Job alone. Cloudflare
Access does the sign-in at the edge; Echo then checks the signed token itself
on every gated request, because anything on the home network can reach port
8014 directly and skip Cloudflare. No valid token means 404, from anywhere.

The token arrives as the `Cf-Access-Jwt-Assertion` header on paths the Access
application covers, and as the `CF_Authorization` cookie on every other path
of the site (which is how the public /api/me can tell the owner's browser).

Settings come from the environment (the unit's EnvironmentFile, never git):
ECHO_CF_ACCESS_AUD and ECHO_CF_TEAM_DOMAIN. While either is missing or empty
the gate is closed: every check fails, and nothing is fetched.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.request

import jwt
from fastapi import HTTPException, Request

log = logging.getLogger("echo.access")

HEADER = "Cf-Access-Jwt-Assertion"
COOKIE = "CF_Authorization"
KEYS_TTL_S = 3600          # re-fetch Cloudflare's signing keys hourly
KEYS_RETRY_S = 60          # …and at most once a minute for an unknown key ID,
                           # so forged tokens can't make Echo hammer Cloudflare
FETCH_TIMEOUT_S = 5

_lock = threading.Lock()
_keys: dict[str, object] = {}
_keys_domain: str | None = None
_keys_fetched_at = 0.0


def _settings() -> tuple[str, str] | None:
    """(audience tag, team domain), or None while the gate isn't configured."""
    aud = os.environ.get("ECHO_CF_ACCESS_AUD", "").strip()
    domain = os.environ.get("ECHO_CF_TEAM_DOMAIN", "").strip()
    domain = domain.removeprefix("https://").removeprefix("http://").strip("/")
    if not aud or not domain:
        return None
    return aud, domain


def _fetch_jwks(domain: str) -> dict:
    """Cloudflare's public signing keys for this team (tests replace this)."""
    url = f"https://{domain}/cdn-cgi/access/certs"
    with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_S) as res:
        return json.load(res)


def reset_cache() -> None:
    global _keys, _keys_domain, _keys_fetched_at
    with _lock:
        _keys, _keys_domain, _keys_fetched_at = {}, None, 0.0


def _signing_key(kid: str, domain: str):
    """The cached public key with this ID, fetching the key set when it is
    stale, or (rate-limited) when the ID is unknown, e.g. after a rotation."""
    global _keys, _keys_domain, _keys_fetched_at
    with _lock:
        age = time.monotonic() - _keys_fetched_at
        fresh = _keys_domain == domain and _keys_fetched_at and age < KEYS_TTL_S
        if not fresh or (kid not in _keys and age >= KEYS_RETRY_S):
            try:
                jwks = jwt.PyJWKSet.from_dict(_fetch_jwks(domain))
                _keys = {k.key_id: k.key for k in jwks.keys if k.key_id}
                _keys_domain = domain
            except Exception as e:  # network, bad JSON, no usable keys
                log.warning("Could not load Cloudflare Access keys: %s",
                            type(e).__name__)
                if _keys_domain != domain:
                    _keys = {}
            _keys_fetched_at = time.monotonic()
            _keys_domain = domain
        return _keys.get(kid)


def verify(token: str | None) -> dict | None:
    """The token's claims if it is a valid, unexpired Access token for this
    application, else None. Never raises."""
    settings = _settings()
    if not settings or not token:
        return None
    aud, domain = settings
    try:
        kid = jwt.get_unverified_header(token).get("kid")
        key = _signing_key(kid, domain) if kid else None
        if key is None:
            return None
        return jwt.decode(token, key, algorithms=["RS256"], audience=aud,
                          issuer=f"https://{domain}",
                          options={"require": ["exp", "aud", "iss"]})
    except Exception:
        return None


def is_owner(request: Request) -> bool:
    """Does this request carry a valid Access token (header or cookie)?"""
    return (verify(request.headers.get(HEADER)) is not None
            or verify(request.cookies.get(COOKIE)) is not None)


def require_owner(request: Request) -> None:
    """Dependency for owner-only routes: a plain 404 without a valid token,
    the same answer as a route that doesn't exist."""
    if not is_owner(request):
        raise HTTPException(status_code=404, detail="Not Found")
