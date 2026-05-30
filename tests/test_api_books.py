"""Tests for the book retrieval routes (list_books, get_book, get_chapters, get_ncm).

Route tests use ``httpx.AsyncClient`` over ``ASGITransport`` (the documented
route-testing pattern). The BookStore provider is overridden with a
temp-directory-backed store (the ``book_on_disk`` fixture), so the happy paths
run without touching the real ``data/books/`` directory.
"""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from lectoria.api.deps import get_book_store
from lectoria.app import create_app
from lectoria.services.bookstore import FileSystemBookStore


@pytest.fixture()
def book_app(book_on_disk):
    """App with the BookStore pointed at the fixture's temp books dir."""
    app = create_app()
    books_dir = book_on_disk.book_dir.parent
    app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(books_dir)
    yield app
    app.dependency_overrides.clear()


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestGetNcm:
    @pytest.mark.asyncio
    async def test_returns_ncm(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/ncm")
        assert res.status_code == 200
        assert res.json()["book_map"]["title"] == "Test Book"

    @pytest.mark.asyncio
    async def test_missing_returns_404(self, book_app):
        async with _client(book_app) as client:
            res = await client.get("/api/books/nonexistent/ncm")
        assert res.status_code == 404
        assert res.json()["detail"] == "NCM not found for book 'nonexistent'"


class TestGetBook:
    @pytest.mark.asyncio
    async def test_processed_returns_metadata(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}")
        assert res.status_code == 200
        body = res.json()
        assert body["book_id"] == book_on_disk.book_id
        assert body["has_ncm"] is True
        assert body["title"] == "Test Book"
        assert body["genre"] == "fantasy"
        assert body["character_count"] == 1
        assert body["chapter_count"] == 1
        assert body["scene_count"] == 1

    @pytest.mark.asyncio
    async def test_present_but_unprocessed_returns_has_ncm_false(self, book_app, book_on_disk):
        # A book directory that exists but has no ncm.json (uploaded, not processed).
        (book_on_disk.book_dir.parent / "unprocessed").mkdir()
        async with _client(book_app) as client:
            res = await client.get("/api/books/unprocessed")
        assert res.status_code == 200
        assert res.json() == {"book_id": "unprocessed", "has_ncm": False}

    @pytest.mark.asyncio
    async def test_absent_returns_404_not_500(self, book_app):
        # Regression guard for the exception contract: a nonexistent book is a
        # clean 404, never an unhandled 500.
        async with _client(book_app) as client:
            res = await client.get("/api/books/nonexistent")
        assert res.status_code == 404
        assert res.json()["detail"] == "Book 'nonexistent' not found"


class TestListBooks:
    @pytest.mark.asyncio
    async def test_populated_lists_books(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get("/api/books/")
        assert res.status_code == 200
        assert res.json()["books"] == [
            {"book_id": book_on_disk.book_id, "title": "Test Book", "has_ncm": True}
        ]

    @pytest.mark.asyncio
    async def test_empty_returns_empty_list(self, tmp_path):
        app = create_app()
        empty_books = tmp_path / "books"
        empty_books.mkdir()
        app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(empty_books)
        try:
            async with _client(app) as client:
                res = await client.get("/api/books/")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        assert res.json() == {"books": []}


class TestGetChapters:
    @pytest.mark.asyncio
    async def test_returns_chapters_byte_faithful(self, book_app, book_on_disk):
        chapters = {"chapters": [{"index": 1, "paragraphs": [{"text": "hello"}]}]}
        chapters_path = book_on_disk.book_dir / "chapters.json"
        chapters_path.write_text(json.dumps(chapters))
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 200
        # Data-faithful to the on-disk JSON (no model round-trip in the store).
        assert res.json() == json.loads(chapters_path.read_text())

    @pytest.mark.asyncio
    async def test_missing_returns_404(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 404
        assert res.json()["detail"] == f"Chapters not found for book '{book_on_disk.book_id}'"
