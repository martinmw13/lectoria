"""Tests for the image generation routes (generate_image, generate_scene).

Route tests use ``httpx.AsyncClient`` over ``ASGITransport`` (the documented
route-testing pattern). The BookStore is overridden with a temp-directory-backed
store (the ``book_on_disk`` fixture) and the image provider with a
``FakeImageProvider``, so the routes run without BYOK headers and without
touching a real provider or the real ``data/books/`` directory.
"""

import base64
import json

import pytest
from httpx import ASGITransport, AsyncClient

from lectoria.api.deps import get_book_store, image_provider_dep
from lectoria.app import create_app
from lectoria.services.bookstore import FileSystemBookStore
from tests.fakes import FAKE_PNG, FakeImageProvider


@pytest.fixture()
def image_provider() -> FakeImageProvider:
    """A mock image provider that returns FAKE_PNG on every ``generate()`` call."""
    return FakeImageProvider()


@pytest.fixture()
def book_app(book_on_disk, image_provider):
    """App with the BookStore and image provider dependencies overridden."""
    app = create_app()
    books_dir = book_on_disk.book_dir.parent
    app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(books_dir)
    app.dependency_overrides[image_provider_dep] = lambda: image_provider
    yield app
    app.dependency_overrides.clear()


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestGenerateScene:
    @pytest.mark.asyncio
    async def test_cache_miss_generates(self, book_app, book_on_disk, image_provider):
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/scene",
                json={"chapter_index": 1, "scene_index": 1},
            )
        assert res.status_code == 200
        body = res.json()
        assert body["generated"] is True
        assert body["cache_url"] == "/api/data/books/test-book/images/scenes/ch1_sc1.png"
        assert image_provider.calls == 1
        scene_file = book_on_disk.book_dir / "images" / "scenes" / "ch1_sc1.png"
        assert scene_file.read_bytes() == FAKE_PNG

    @pytest.mark.asyncio
    async def test_cache_hit_returns_existing(self, book_app, book_on_disk, image_provider):
        existing = book_on_disk.book_dir / "images" / "scenes" / "ch1_sc1.png"
        existing.write_bytes(b"cached")
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/scene",
                json={"chapter_index": 1, "scene_index": 1},
            )
        assert res.status_code == 200
        assert res.json()["generated"] is False
        assert image_provider.calls == 0
        assert existing.read_bytes() == b"cached"

    @pytest.mark.asyncio
    async def test_no_image_prompt_returns_400(self, book_app, book_on_disk):
        ncm_path = book_on_disk.book_dir / "ncm.json"
        data = json.loads(ncm_path.read_text())
        data["chapters"][0]["scenes"][0]["image_prompt"] = ""
        ncm_path.write_text(json.dumps(data))
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/scene",
                json={"chapter_index": 1, "scene_index": 1},
            )
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_missing_book_returns_404(self, book_app):
        async with _client(book_app) as client:
            res = await client.post(
                "/api/books/nonexistent/images/scene",
                json={"chapter_index": 1, "scene_index": 1},
            )
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_scene_returns_404(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/scene",
                json={"chapter_index": 1, "scene_index": 99},
            )
        assert res.status_code == 404


class TestGenerateImage:
    @pytest.mark.asyncio
    async def test_happy_path_returns_image_and_caches(
        self, book_app, book_on_disk, image_provider
    ):
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/generate",
                json={
                    "selected_text": "Hero draws a sword.",
                    "chapter_index": 1,
                    "scene_index": 1,
                },
            )
        assert res.status_code == 200
        body = res.json()
        assert base64.b64decode(body["image_base64"]) == FAKE_PNG
        assert body["content_type"] == "image/png"
        assert body["cache_url"] == "/api/data/books/test-book/images/on_demand/ch1_sc1.png"
        assert image_provider.calls == 1
        cached = book_on_disk.book_dir / "images" / "on_demand" / "ch1_sc1.png"
        assert cached.read_bytes() == FAKE_PNG

    @pytest.mark.asyncio
    async def test_bad_scene_coords_is_lenient(self, book_app, book_on_disk, image_provider):
        # Decision 5: coordinates that don't resolve to a scene are non-fatal —
        # the route still generates from the selected text rather than 404ing.
        async with _client(book_app) as client:
            res = await client.post(
                f"/api/books/{book_on_disk.book_id}/images/generate",
                json={
                    "selected_text": "Hero draws a sword.",
                    "chapter_index": 99,
                    "scene_index": 99,
                },
            )
        assert res.status_code == 200
        assert base64.b64decode(res.json()["image_base64"]) == FAKE_PNG
        assert image_provider.calls == 1

    @pytest.mark.asyncio
    async def test_missing_book_returns_404(self, book_app):
        async with _client(book_app) as client:
            res = await client.post(
                "/api/books/nonexistent/images/generate",
                json={"selected_text": "anything"},
            )
        assert res.status_code == 404
