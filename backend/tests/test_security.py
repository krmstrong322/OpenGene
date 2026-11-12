"""Only this computer's own UI may talk to the engine (opengene.security)."""

import pytest
from fastapi.testclient import TestClient

from opengene import security
from opengene.api import app
from opengene.session import store


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    store.clear()
    monkeypatch.setattr(security, "settings", security.Settings(token="", allowed_origins=frozenset()))
    yield
    store.clear()


@pytest.fixture
def client():
    return TestClient(app, base_url="http://localhost")


def _record(client, **headers):
    return client.post("/records", json={"name": "t", "sequence": "ACGTACGT"}, headers=headers)


# -- Host -------------------------------------------------------------------

@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1:53211", "[::1]:8000"])
def test_loopback_hosts_are_served(client, host):
    assert client.get("/records", headers={"Host": host}).status_code == 200


@pytest.mark.parametrize("host", ["attacker.example", "attacker.example:8000", "localhost.attacker.example", ""])
def test_other_hosts_are_refused(client, host):
    # DNS rebinding: an attacker's name pointed at 127.0.0.1.
    r = client.get("/records", headers={"Host": host})
    assert r.status_code == 403


def test_extra_hosts_can_be_allowed(client, monkeypatch):
    monkeypatch.setattr(security.settings, "allowed_hosts", frozenset({"lab-server.local"}))
    assert client.get("/records", headers={"Host": "lab-server.local:8000"}).status_code == 200


# -- Origin -----------------------------------------------------------------

def test_requests_without_an_origin_are_served(client):
    assert _record(client).status_code == 200


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])
def test_local_pages_may_read(client, origin):
    r = client.get("/records", headers={"Origin": origin})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize(
    "origin",
    ["https://evil.example", "http://localhost.evil.example", "http://evil.example:5173", "null", "file://"],
)
def test_other_sites_can_neither_read_nor_write(client, origin):
    rid = _record(client).json()["id"]
    assert client.get("/records", headers={"Origin": origin}).status_code == 403
    # A "simple" cross-site request needs no preflight, so it must be refused
    # by the engine itself, not just hidden from the page by CORS.
    assert client.post(f"/records/{rid}/reverse_complement", headers={"Origin": origin}).status_code == 403
    assert client.delete(f"/records/{rid}", headers={"Origin": origin}).status_code == 403
    assert len(client.get("/records").json()) == 1


def test_preflight_from_another_site_is_not_approved(client):
    r = client.options(
        "/records/abc",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "DELETE"},
    )
    assert r.status_code >= 400
    assert "access-control-allow-origin" not in r.headers


def test_refusals_are_readable_by_allowed_pages(client, monkeypatch):
    # The UI must be able to read *why* a request was refused.
    monkeypatch.setattr(security.settings, "token", "secret")
    r = client.get("/records", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


# -- Token (the desktop app) --------------------------------------------------

@pytest.fixture
def desktop(monkeypatch):
    monkeypatch.setattr(
        security, "settings", security.Settings(token="s3cret-token", allowed_origins=frozenset({"null"}))
    )


def test_token_is_required_when_configured(client, desktop):
    assert client.get("/records").status_code == 401
    assert client.get("/records", headers={"X-OpenGene-Token": "wrong"}).status_code == 401
    assert client.get("/records", headers={"X-OpenGene-Token": "s3cret-token"}).status_code == 200


def test_health_stays_open_so_the_shell_can_wait_for_startup(client, desktop):
    assert client.get("/health").status_code == 200


def test_anonymous_origin_needs_the_token(client, desktop):
    # The desktop window's origin is "null" — and so is any sandboxed frame
    # on the web. Only the real window knows the token.
    assert _record(client, Origin="null").status_code == 401
    r = _record(client, Origin="null", **{"X-OpenGene-Token": "s3cret-token"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "null"


def test_preflight_passes_without_a_token_for_an_allowed_origin(client, desktop):
    r = client.options(
        "/records",
        headers={
            "Origin": "null",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-opengene-token",
        },
    )
    assert r.status_code == 200
    assert "x-opengene-token" in r.headers["access-control-allow-headers"].lower()


# -- Size ---------------------------------------------------------------------

def test_oversized_requests_are_refused(client, monkeypatch):
    monkeypatch.setattr(security.settings, "max_request_bytes", 1000)
    big = "A" * 5000
    r = client.post("/records", json={"name": "t", "sequence": big})
    assert r.status_code == 413
    r = client.post("/records/import", files={"file": ("big.fasta", f">big\n{big}\n")})
    assert r.status_code == 413
    assert client.get("/records").json() == []


def test_oversized_body_without_a_declared_length_is_refused(client, monkeypatch):
    monkeypatch.setattr(security.settings, "max_request_bytes", 1000)

    def chunks():
        for _ in range(50):
            yield b'{"name": "t", "sequence": "' if _ == 0 else b"A" * 100
        yield b'"}'

    r = client.post("/records", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
