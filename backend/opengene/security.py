"""Who may talk to the engine.

The engine is a local HTTP server. Left open, any web page in the user's
browser could call it — browsers happily send requests to ``127.0.0.1`` — and
read, change or delete their plasmid library. Three checks close that door:

* **Host** — the request must be addressed to a loopback name. This defeats
  DNS rebinding, where an attacker's domain is re-pointed at ``127.0.0.1`` so
  that their page becomes "same-origin" with the engine.
* **Origin** — a request sent by a web page carries the page's origin. Only
  pages served from this computer (the dev server) or origins listed in
  ``OPENGENE_ALLOWED_ORIGINS`` are let through, so another site can neither
  read the library nor fire a blind "simple" request (a form post) at it.
* **Token** — when ``OPENGENE_API_TOKEN`` is set, as the desktop app does with
  a fresh random value on every launch, each request must present it. The
  desktop UI is loaded from disk and so has the anonymous origin ``null``,
  which any sandboxed frame on the web shares; the token is what tells the
  real window apart.

Requests are also capped in size, so nothing can make the engine buffer an
arbitrarily large upload.

Configuration (environment, read at startup):

``OPENGENE_API_TOKEN``        require this value in the ``X-OpenGene-Token`` header
``OPENGENE_ALLOWED_ORIGINS``  extra allowed origins, comma-separated (e.g. ``null``)
``OPENGENE_ALLOWED_HOSTS``    extra allowed Host names, comma-separated — needed
                              only when deliberately serving beyond localhost
"""

from __future__ import annotations

import hmac
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN_HEADER = "x-opengene-token"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
# Large enough for a sizeable genome in any supported format.
MAX_REQUEST_BYTES = 256 * 1024 * 1024
# Reachable without a token: carries nothing private, and lets the desktop
# shell (and monitoring) see that the engine is up.
OPEN_PATHS = frozenset({"/health"})


def _csv(name: str) -> frozenset[str]:
    return frozenset(v.strip() for v in os.environ.get(name, "").split(",") if v.strip())


@dataclass
class Settings:
    token: str = field(default_factory=lambda: os.environ.get("OPENGENE_API_TOKEN", ""))
    allowed_origins: frozenset[str] = field(
        default_factory=lambda: _csv("OPENGENE_ALLOWED_ORIGINS")
    )
    allowed_hosts: frozenset[str] = field(
        default_factory=lambda: frozenset(h.lower() for h in _csv("OPENGENE_ALLOWED_HOSTS"))
    )
    max_request_bytes: int = MAX_REQUEST_BYTES


settings = Settings()


def _hostname(host_header: str) -> str:
    """The name part of a Host header (``localhost:8000``, ``[::1]:8000``)."""
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if ":" in host else host


def host_allowed(host_header: str) -> bool:
    name = _hostname(host_header)
    return name in LOOPBACK_HOSTS or name in settings.allowed_hosts


def origin_allowed(origin: str) -> bool:
    if origin in settings.allowed_origins:
        return True
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and (parts.hostname or "") in LOOPBACK_HOSTS


def token_ok(presented: str) -> bool:
    return hmac.compare_digest(presented.encode(), settings.token.encode())


class LocalCORSMiddleware(CORSMiddleware):
    """CORS for exactly the origins the guard lets in (decided per request, so
    it always agrees with the current settings)."""

    def is_allowed_origin(self, origin: str) -> bool:
        return origin_allowed(origin)


class RequestTooLarge(Exception):
    pass


class GuardMiddleware:
    """Reject requests the engine should not serve, before any route runs."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}

        if not host_allowed(headers.get("host", "")):
            await _refuse(scope, receive, send, 403, "this address is not allowed to reach OpenGene")
            return
        origin = headers.get("origin")
        if origin is not None and not origin_allowed(origin):
            await _refuse(scope, receive, send, 403, "this origin is not allowed to reach OpenGene")
            return
        # A CORS preflight carries no credentials by design; the request it
        # asks about is checked when it arrives.
        if (
            settings.token
            and scope["method"] != "OPTIONS"
            and scope["path"] not in OPEN_PATHS
            and not token_ok(headers.get(TOKEN_HEADER, ""))
        ):
            await _refuse(scope, receive, send, 401, "missing or wrong access token")
            return

        limit = settings.max_request_bytes
        declared = headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await _refuse(scope, receive, send, 413, _too_large(limit))
            return

        # A body sent without a length (chunked) is counted as it arrives.
        # Once it passes the limit the route is cut off and whatever it then
        # tries to answer is replaced by the refusal.
        received = 0
        too_large = False
        started = False

        async def counted_receive():
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_large = True
                    raise RequestTooLarge
            return message

        async def guarded_send(message):
            nonlocal started
            if too_large and not started:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, guarded_send)
        except RequestTooLarge:
            pass
        if too_large and not started:
            await _refuse(scope, receive, send, 413, _too_large(limit))


def _too_large(limit: int) -> str:
    return f"that is larger than OpenGene accepts ({limit // (1024 * 1024)} MB)"


async def _refuse(scope: Scope, receive: Receive, send: Send, status: int, detail: str) -> None:
    await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)
