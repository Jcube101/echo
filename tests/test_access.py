"""ACC-* tests: the owner-only gate (docs/LAUNCH.md §2, decision L5).

Gated routes: POST /capture, GET /me, GET /api/schema-audit. Each must carry a
valid Cloudflare Access token or it is a 404, whatever network it came from.
A throwaway RSA key stands in for Cloudflare's (conftest `access_gate`); no
test talks to Cloudflare, and /capture only ever runs a stub rec script.
"""

from __future__ import annotations

import pytest

import access
import main as main_module
from conftest import set_cookie

HEADER = "Cf-Access-Jwt-Assertion"
GATED = [("POST", "/capture"), ("GET", "/me"), ("GET", "/api/schema-audit")]


def _call(c, method, path, **kw):
    if method == "POST":
        return c.post(path, json={"duration": 2}, **kw)
    return c.get(path, follow_redirects=False, **kw)


@pytest.fixture
def no_mic(monkeypatch):
    """Fail the test if anything gets as far as the rec wrapper."""
    def boom(*a, **k):
        raise AssertionError("the rec wrapper must not run without a valid token")
    monkeypatch.setattr(main_module.subprocess, "run", boom)


@pytest.mark.parametrize("method,path", GATED)
def test_ACC_001_no_env_means_always_404(client, method, path, monkeypatch, access_gate, no_mic):
    """Fail closed: with ECHO_CF_ACCESS_AUD unset or empty, gated routes are
    404 even for a token that would otherwise be valid, and Echo fetches no
    keys."""
    token = access_gate()
    for value in (None, "", "   "):
        if value is None:
            monkeypatch.delenv("ECHO_CF_ACCESS_AUD")
        else:
            monkeypatch.setenv("ECHO_CF_ACCESS_AUD", value)
        res = _call(client, method, path, headers={HEADER: token})
        assert res.status_code == 404
        assert res.json() == {"detail": "Not Found"}
    assert access_gate.fetches == 0


@pytest.mark.parametrize("method,path", GATED)
def test_ACC_002_no_token_is_404_like_a_missing_route(client, method, path, access_gate, no_mic):
    res = _call(client, method, path)
    assert res.status_code == 404
    assert res.json() == client.get("/no-such-route").json() == {"detail": "Not Found"}


@pytest.mark.parametrize("why,kwargs", [
    ("forged signature", {"key": "forged"}),
    ("expired", {"exp": -60}),
    ("wrong audience", {"aud": "some-other-application"}),
    ("wrong issuer", {"iss": "https://evil.cloudflareaccess.com"}),
    ("unknown key id", {"kid": "not-a-real-key"}),
])
@pytest.mark.parametrize("method,path", GATED)
def test_ACC_003_bad_tokens_are_404(client, method, path, why, kwargs, access_gate, no_mic):
    """Forged, expired, wrong-audience, wrong-issuer and unknown-key tokens
    are all refused, in the header and in the cookie."""
    token = access_gate(**kwargs)
    assert _call(client, method, path, headers={HEADER: token}).status_code == 404, why
    set_cookie(client, "CF_Authorization", token)
    assert _call(client, method, path).status_code == 404, why
    # The cookie really is read: a good one on the same client is recognised.
    set_cookie(client, "CF_Authorization", access_gate())
    assert client.get("/api/me").json() == {"pi_mic": True}


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c", "eyJhbGciOiJub25lIn0.e30."])
def test_ACC_004_malformed_and_unsigned_tokens_are_404(client, token, access_gate, no_mic):
    """Junk, and an `alg: none` token, never pass (only RS256 is accepted)."""
    assert client.post("/capture", json={"duration": 2},
                       headers={HEADER: token}).status_code == 404


def test_ACC_005_valid_token_passes_the_gate(client, access_gate, monkeypatch, rec_stub):
    """A token signed by the (test) Access key, right audience, not expired:
    /capture records, /api/schema-audit answers, /me redirects to the app."""
    monkeypatch.setattr(main_module, "REC_WRAPPER", str(rec_stub("ok")))
    headers = {HEADER: access_gate()}

    res = client.post("/capture", json={"duration": 2}, headers=headers)
    assert res.status_code == 200 and res.json()["features"]

    audit = client.get("/api/schema-audit", headers=headers)
    assert audit.status_code == 200 and "current_version" in audit.json()

    me = client.get("/me", headers=headers, follow_redirects=False)
    assert me.status_code == 303
    assert me.headers["location"] == "/app?owner=1"


def test_ACC_006_api_me_is_public_and_true_only_for_the_owner(client, other_client, access_gate):
    """/api/me never 404s. It reports pi_mic true for a valid token in the
    header or in the CF_Authorization cookie (all Cloudflare sends on paths
    the Access app doesn't cover), false otherwise, and is never cached."""
    res = client.get("/api/me")
    assert res.status_code == 200 and res.json() == {"pi_mic": False}
    assert res.headers["cache-control"] == "no-store"

    assert client.get("/api/me", headers={HEADER: access_gate()}).json() == {"pi_mic": True}
    assert client.get("/api/me", headers={HEADER: access_gate(exp=-5)}).json() == {"pi_mic": False}

    set_cookie(other_client, "CF_Authorization", access_gate())
    assert other_client.get("/api/me").json() == {"pi_mic": True}
    set_cookie(other_client, "CF_Authorization", access_gate(key="forged"))
    assert other_client.get("/api/me").json() == {"pi_mic": False}


def test_ACC_007_api_me_false_when_gate_not_configured(client, access_gate, monkeypatch):
    token = access_gate()
    monkeypatch.setenv("ECHO_CF_TEAM_DOMAIN", "")
    assert client.get("/api/me", headers={HEADER: token}).json() == {"pi_mic": False}


def test_ACC_008_keys_are_cached_and_forgeries_cannot_force_refetches(client, access_gate):
    """The key set is fetched once and reused; a flood of tokens naming an
    unknown key ID triggers no further fetches inside the retry window."""
    good = {HEADER: access_gate()}
    for _ in range(5):
        assert client.get("/api/me", headers=good).json() == {"pi_mic": True}
    assert access_gate.fetches == 1

    bad = {HEADER: access_gate(kid="rotated-or-fake")}
    for _ in range(20):
        assert client.get("/api/me", headers=bad).json() == {"pi_mic": False}
    assert access_gate.fetches == 1


def test_ACC_009_key_fetch_failure_fails_closed(client, access_gate, monkeypatch):
    """If Cloudflare's keys can't be loaded, nobody is the owner (no crash)."""
    def down(domain):
        raise OSError("network unreachable")
    monkeypatch.setattr(access, "_fetch_jwks", down)
    access.reset_cache()
    res = client.post("/capture", json={"duration": 2}, headers={HEADER: access_gate()})
    assert res.status_code == 404


def test_ACC_010_gate_runs_before_body_validation(client, access_gate):
    """An invalid body doesn't reveal the route: still 404 without a token."""
    assert client.post("/capture", json={"duration": 999}).status_code == 404
    assert client.post("/capture", content=b"not json").status_code == 404
