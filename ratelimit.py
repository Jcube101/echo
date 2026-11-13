"""Echo — small in-memory rate limiter (docs/LAUNCH.md §3).

One process, so plain memory is enough: a sliding window of timestamps per
key. A request is checked against every key it carries (its browser's visitor
ID and its IP address) and against every limit (per hour, per day); it is only
recorded if all of them allow it. Nothing here is logged or written to disk,
and the two kinds of key are never stored together.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Refusal:
    limit: int        # the limit that was hit…
    window_s: int     # …over this many seconds
    retry_after_s: int


class RateLimiter:
    def __init__(self, limits: list[tuple[int, int]]):
        """`limits` is [(max_requests, window_seconds), …]."""
        self.limits = sorted(limits, key=lambda lw: lw[1])
        self._horizon = max(w for _, w in self.limits)
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    def hit(self, keys: list[str], now: float | None = None) -> Refusal | None:
        """Record one request for `keys`, or return why it is refused."""
        now = time.time() if now is None else now
        with self._lock:
            self._sweep(now)
            for key in keys:
                q = self._hits.get(key)
                if not q:
                    continue
                while q and q[0] <= now - self._horizon:
                    q.popleft()
                for limit, window in self.limits:
                    recent = [t for t in q if t > now - window]
                    if len(recent) >= limit:
                        # Allowed again when the oldest of the last `limit` ages out.
                        wait = recent[-limit] + window - now
                        return Refusal(limit, window, max(1, int(wait) + 1))
            for key in keys:
                self._hits.setdefault(key, deque()).append(now)
        return None

    def refund(self, keys: list[str]) -> None:
        """Take back the latest request (it was turned away for another reason)."""
        with self._lock:
            for key in keys:
                q = self._hits.get(key)
                if q:
                    q.pop()

    def _sweep(self, now: float) -> None:
        """Every few minutes, forget keys with nothing left inside the horizon."""
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        for key in [k for k, q in self._hits.items()
                    if not q or q[-1] <= now - self._horizon]:
            del self._hits[key]
