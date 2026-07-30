"""A per-process, per-IP token bucket — the first line of defence against a
runaway loop or a curious user racking up an unexpectedly large token bill.

Hand-rolled rather than a library (`slowapi`, `limits`) on purpose: this app runs
as a single `api` container with no replicas (see docker-compose.yml — no
`--workers`, no orchestration), so there is nothing distributed to coordinate,
and a dependency's pluggable-backend machinery would buy nothing over the ~80
lines below. Matches this codebase's existing preference for small,
dependency-light solutions where the problem is small (the keyless web-search
scraper in services/web.py, the hand-written chunking strategies).

Known, accepted limitations — not solved here:
  * in-memory: every bucket resets on process restart (including a dev
    `--reload` restart);
  * per-process: would NOT coordinate across replicas if this were ever scaled
    horizontally;
  * keyed by `request.client.host`, the literal peer address Starlette sees —
    there is no reverse proxy in front of this app today. Add one, and this
    would need `X-Forwarded-For` handling, which it deliberately does not do.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

from fastapi import HTTPException, Request

from .config import settings


class _Bucket:
    __slots__ = ("tokens", "last_refill")

    def __init__(self, tokens: float, last_refill: float) -> None:
        self.tokens = tokens
        self.last_refill = last_refill


class RateLimiter:
    """One named limit (e.g. "/ask") shared across every client IP that hits it.

    Token bucket, not a fixed window: a small burst (a few quick messages) is
    allowed even at the very start, and the bucket refills continuously rather
    than resetting hard at a minute boundary — closer to how someone actually
    uses a chat than a wall that unlocks all at once.
    """

    def __init__(self, capacity: int, refill_per_sec: float) -> None:
        self.capacity = capacity
        self.refill_per_sec = refill_per_sec
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def check(self, request: Request) -> None:
        if not settings.rate_limit_enabled:
            return

        key = request.client.host if request.client else "unknown"
        now = time.monotonic()

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket(tokens=float(self.capacity), last_refill=now)
                self._buckets[key] = bucket
            else:
                elapsed = now - bucket.last_refill
                bucket.tokens = min(self.capacity, bucket.tokens + elapsed * self.refill_per_sec)
                bucket.last_refill = now

            if bucket.tokens < 1:
                deficit = 1 - bucket.tokens
                retry_after = max(1, round(deficit / self.refill_per_sec))
                per_minute = self.refill_per_sec * 60
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Too many requests to {request.url.path} from your address — "
                        f"the limit here is {self.capacity} at once and {per_minute:g} per "
                        f"minute sustained. Wait about {retry_after}s and try again. "
                        f"(This demo's rate limiter is per-process and keyed by IP.)"
                    ),
                    headers={"Retry-After": str(retry_after)},
                )

            bucket.tokens -= 1


def rate_limit_dependency(limiter: RateLimiter) -> Callable[[Request], None]:
    """A FastAPI-`Depends`-compatible closure over one limiter instance."""

    def _dependency(request: Request) -> None:
        limiter.check(request)

    return _dependency
