# Testing Standards

## Commands

```bash
just test                    # Run all tests
just test-file <path>        # Specific test file
```

## Test Patterns

Use pytest fixtures for test setup.

```python
@pytest.mark.parametrize("input,expected", [...])
def test_transformation(input, expected):
    result = transform(input)
    assert result == expected
```

## Commands

```bash
uv run pytest                    # Run all tests
uv run pytest tests/unit/        # Unit tests only
uv run pytest tests/integration/ # Integration tests
uv run pytest -k "test_epub"     # Filter by name
```

## Async tests

Mark all async tests and use `httpx.AsyncClient` for route testing:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from lectoria.app import app

@pytest.mark.asyncio
async def test_route():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
```

## AI provider tests

Never call real provider APIs in tests. Inject a mock provider via dependency injection:

```python
async def mock_provider(prompt: str):
    yield "mocked narrative chunk"

def test_enrichment_uses_provider(monkeypatch):
    monkeypatch.setattr("lectoria.providers.base.get_provider", lambda: mock_provider)
    ...
```

## EPUB parsing tests

Use small fixture EPUBs (`tests/fixtures/*.epub`); never use real user books in tests:

```python
def test_epub_parsed(epub_fixture_path):
    result = parse_epub(epub_fixture_path)
    assert result.chapters  # at least one chapter
    assert all(ch.text for ch in result.chapters)
```

## SSE / streaming tests

Test that streaming routes emit at least one event and close cleanly:

```python
@pytest.mark.asyncio
async def test_stream_returns_events():
    async with AsyncClient(...) as client:
        async with client.stream("GET", "/enrich/stream?chapter=1") as r:
            assert r.status_code == 200
            events = [chunk async for chunk in r.aiter_text()]
            assert any("data:" in e for e in events)
```

## Rules

- NEVER skip, delete, or disable failing tests — fix the tests or implementation
- Every feature needs at least one test
- Don't change tests unless the spec changes
