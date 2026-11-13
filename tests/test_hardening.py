"""SEC-* tests: the smaller launch checks (docs/LAUNCH.md §4).

API docs off in production, security headers on every response, and a CSP
with no inline or third-party script. Fully sandboxed.
"""

from __future__ import annotations

import pytest

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


def test_SEC_001_api_docs_off_by_default(client):
    for path in DOC_PATHS:
        res = client.get(path)
        assert res.status_code == 404, path
        assert res.json() == {"detail": "Not Found"}


def test_SEC_002_api_docs_on_only_with_ECHO_DEV_1(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from conftest import _reload_backend
    for value, expected in (("1", 200), ("0", 404), ("true", 404)):
        monkeypatch.setenv("ECHO_DEV", value)
        main = _reload_backend(tmp_path / f"data-{value}", monkeypatch)
        with TestClient(main.app) as c:
            assert [c.get(p).status_code for p in DOC_PATHS] == [expected] * 3, value


def _assert_headers(res, where):
    h = res.headers
    assert h["x-content-type-options"] == "nosniff", where
    assert h["referrer-policy"] == "same-origin", where
    assert h["permissions-policy"] == "microphone=(self)", where
    assert "default-src 'self'" in h["content-security-policy"], where


def test_SEC_003_security_headers_on_every_kind_of_response(client_with_frontend, audio_factory, access_gate):
    """API JSON, the SPA page, static files, samples, redirects, 404s and
    refusals all carry the four headers."""
    c = client_with_frontend
    for path in ("/", "/app", "/assets/app.js", "/api/health", "/api/me", "/history",
                 "/samples", "/history/nope", "/no-such-page", "/capture", "/docs"):
        _assert_headers(c.get(path), path)
    _assert_headers(c.post("/upload", files={"file": ("e.wav", b"", "audio/wav")}), "400")
    _assert_headers(c.post("/upload", content=b"x", headers={
        "content-length": "999999999", "content-type": "multipart/form-data; boundary=x"}), "413")
    me = c.get("/me", headers={"Cf-Access-Jwt-Assertion": access_gate()}, follow_redirects=False)
    assert me.status_code == 303
    _assert_headers(me, "redirect")


def test_SEC_004_csp_allows_only_what_the_app_needs(isolated_backend):
    """No inline scripts, no eval, no third-party origins; blob: only where
    the recorder, the 3D text worker and canvas images need it; and the page
    can't be framed."""
    main, _db, _storage = isolated_backend
    policy = dict(d.split(" ", 1) for d in main.CONTENT_SECURITY_POLICY.split("; "))
    assert policy["default-src"] == "'self'"
    # blob: is there for the 3D label worker's importScripts (see main.py);
    # verified in a real browser by the CSP end-to-end spec.
    assert policy["script-src"] == "'self' blob:"
    assert policy["object-src"] == "'none'"
    assert policy["frame-ancestors"] == "'none'"
    assert policy["base-uri"] == "'self'"
    assert "blob:" in policy["media-src"] and "blob:" in policy["worker-src"]
    whole = main.CONTENT_SECURITY_POLICY
    assert "unsafe-eval" not in whole
    assert "http:" not in whole and "https:" not in whole and "*" not in whole
    assert "'unsafe-inline'" not in policy["script-src"]
