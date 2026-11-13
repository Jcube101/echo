"""Echo — a timeline in the log for every /capture request, and only those.

The service runs without an access log (it would hold IP addresses), so when a
Pi mic capture once hung for minutes there was nothing to read afterwards.
This writes one line per step, each stamped with the seconds since the
request's headers arrived:

    capture 3fa1c2 +0.00s request received: POST HTTP/1.1, content-length=0, ...
    capture 3fa1c2 +0.00s request body complete (0 bytes)
    capture 3fa1c2 +0.01s rec started (10 s, limit 20 s)
    capture 3fa1c2 +10.2s rec ended (exit 0, 882044 bytes)
    capture 3fa1c2 +12.6s response 200 sent
    capture 3fa1c2 +12.7s response complete

The ID is random per request. Nothing here identifies a person: no IP address,
no visitor ID, no cookie or token values (only whether an Access token was
present at all).

It is a plain ASGI middleware, added outermost, so "request received" is the
moment uvicorn hands the request over: before the body is read, before any
other middleware, before the owner check.
"""

from __future__ import annotations

import logging
import secrets
import sys
import time

log = logging.getLogger("echo.capture")
log.setLevel(logging.INFO)
if not log.handlers:  # uvicorn configures no root handler; give these lines one
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_handler)

PATH = "/capture"
_KEY = "capture_trace"


def _stamp(state: dict) -> str:
    return f"capture {state['id']} +{time.monotonic() - state['t0']:.2f}s"


def note(request, message: str) -> None:
    """Add a step to the current /capture request's timeline (from the route)."""
    state = request.scope.get(_KEY)
    if state:
        log.info("%s %s", _stamp(state), message)


class CaptureTrace:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") != PATH:
            return await self.app(scope, receive, send)

        state = {"id": secrets.token_hex(3), "t0": time.monotonic()}
        scope[_KEY] = state
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        has_cookie = "cf_authorization=" in headers.get("cookie", "").lower()
        log.info(
            "%s request received: %s HTTP/%s, content-length=%s, transfer-encoding=%s, "
            "expect=%s, content-type=%s, query=%s, access header %s, access cookie %s",
            _stamp(state), scope.get("method"), scope.get("http_version"),
            headers.get("content-length", "-"), headers.get("transfer-encoding", "-"),
            headers.get("expect", "-"), headers.get("content-type", "-"),
            "yes" if scope.get("query_string") else "no",
            "present" if "cf-access-jwt-assertion" in headers else "absent",
            "present" if has_cookie else "absent")

        seen = {"bytes": 0, "body_done": False, "gone": False, "sent": False}

        async def traced_receive():
            message = await receive()
            if message["type"] == "http.request":
                seen["bytes"] += len(message.get("body", b""))
                if not message.get("more_body", False) and not seen["body_done"]:
                    seen["body_done"] = True
                    log.info("%s request body complete (%d bytes)", _stamp(state), seen["bytes"])
            elif message["type"] == "http.disconnect" and not seen["gone"]:
                seen["gone"] = True
                when = "after the response" if seen["sent"] else "BEFORE any response"
                log.info("%s client disconnected %s", _stamp(state), when)
            return message

        async def traced_send(message):
            if message["type"] == "http.response.start":
                log.info("%s response %s sent", _stamp(state), message.get("status"))
            await send(message)
            if (message["type"] == "http.response.body"
                    and not message.get("more_body", False) and not seen["sent"]):
                seen["sent"] = True
                log.info("%s response complete", _stamp(state))

        try:
            await self.app(scope, traced_receive, traced_send)
        except BaseException as exc:
            log.info("%s request ended with %s", _stamp(state), type(exc).__name__)
            raise
