"""Tests for the CORS policy (Decision D34).

The middleware emits CORS headers only when the request carries an ``Origin``
header, so every request below sets one explicitly — a request without ``Origin``
would see zero CORS headers and assert nothing. We check both the simple-request
path (``GET``) and the preflight path (``OPTIONS`` + ``Access-Control-Request-*``),
and assert that ``Access-Control-Allow-Credentials`` is never sent: under BYOK
(D17) keys ride in custom headers, not cookies, so credentialed CORS is unused.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from lectoria.app import create_app

# Pinned as a literal (not imported from app) so the test asserts the intended
# policy rather than mirroring whatever the implementation happens to allow.
ALLOWED_ORIGIN = "http://localhost:5173"
DISALLOWED_ORIGIN = "http://evil.example.com"


@pytest.fixture()
def app():
    return create_app()


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_allowed_origin_is_echoed_without_credentials(app):
    async with _client(app) as client:
        response = await client.get("/health", headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    # Credentialed CORS is intentionally off (D34) — the header must be absent.
    assert "access-control-allow-credentials" not in response.headers


@pytest.mark.asyncio
async def test_disallowed_origin_is_not_echoed(app):
    async with _client(app) as client:
        response = await client.get("/health", headers={"Origin": DISALLOWED_ORIGIN})

    assert response.status_code == 200
    # No allow-origin header at all means the browser blocks the cross-origin read.
    assert response.headers.get("access-control-allow-origin") != DISALLOWED_ORIGIN
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.asyncio
async def test_preflight_allows_dev_origin(app):
    async with _client(app) as client:
        response = await client.options(
            "/api/books",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-api-key-llm",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert "access-control-allow-credentials" not in response.headers


@pytest.mark.asyncio
async def test_preflight_rejects_unknown_origin(app):
    async with _client(app) as client:
        response = await client.options(
            "/api/books",
            headers={
                "Origin": DISALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
            },
        )

    # Starlette returns 400 with no allow-origin header for a disallowed origin.
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
