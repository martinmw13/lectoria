"""Tests for the book retrieval routes (list_books, get_book, get_chapters, get_ncm).

The BookStore provider is overridden with a temp-directory-backed store (the
``book_on_disk`` fixture), so the happy paths run without touching the real
``data/books/`` directory.
"""

import json

import pytest
from fastapi.testclient import TestClient

from lectoria.api.deps import get_book_store
from lectoria.app import create_app
from lectoria.services.bookstore import FileSystemBookStore


@pytest.fixture()
def client(book_on_disk):
    """TestClient with the BookStore pointed at the fixture's temp books dir."""
    app = create_app()
    books_dir = book_on_disk.book_dir.parent
    app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(books_dir)
    yield TestClient(app)
    app.dependency_overrides.clear()


class TestGetNcm:
    def test_returns_ncm(self, client, book_on_disk):
        res = client.get(f"/api/books/{book_on_disk.book_id}/ncm")
        assert res.status_code == 200
        assert res.json()["book_map"]["title"] == "Test Book"

    def test_missing_returns_404(self, client):
        res = client.get("/api/books/nonexistent/ncm")
        assert res.status_code == 404
        assert res.json()["detail"] == "NCM not found for book 'nonexistent'"


class TestGetBook:
    def test_processed_returns_metadata(self, client, book_on_disk):
        res = client.get(f"/api/books/{book_on_disk.book_id}")
        assert res.status_code == 200
        body = res.json()
        assert body["book_id"] == book_on_disk.book_id
        assert body["has_ncm"] is True
        assert body["title"] == "Test Book"
        assert body["genre"] == "fantasy"
        assert body["character_count"] == 1
        assert body["chapter_count"] == 1
        assert body["scene_count"] == 1

    def test_present_but_unprocessed_returns_has_ncm_false(self, client, book_on_disk):
        # A book directory that exists but has no ncm.json (uploaded, not processed).
        (book_on_disk.book_dir.parent / "unprocessed").mkdir()
        res = client.get("/api/books/unprocessed")
        assert res.status_code == 200
        assert res.json() == {"book_id": "unprocessed", "has_ncm": False}

    def test_absent_returns_404_not_500(self, client):
        # Regression guard for the exception contract: a nonexistent book is a
        # clean 404, never an unhandled 500.
        res = client.get("/api/books/nonexistent")
        assert res.status_code == 404
        assert res.json()["detail"] == "Book 'nonexistent' not found"


class TestListBooks:
    def test_populated_lists_books(self, client, book_on_disk):
        res = client.get("/api/books/")
        assert res.status_code == 200
        assert res.json()["books"] == [
            {"book_id": book_on_disk.book_id, "title": "Test Book", "has_ncm": True}
        ]

    def test_empty_returns_empty_list(self, tmp_path):
        app = create_app()
        empty_books = tmp_path / "books"
        empty_books.mkdir()
        app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(empty_books)
        try:
            res = TestClient(app).get("/api/books/")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        assert res.json() == {"books": []}


class TestGetChapters:
    def test_returns_chapters_byte_faithful(self, client, book_on_disk):
        chapters = {"chapters": [{"index": 1, "paragraphs": [{"text": "hello"}]}]}
        chapters_path = book_on_disk.book_dir / "chapters.json"
        chapters_path.write_text(json.dumps(chapters))
        res = client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 200
        # Data-faithful to the on-disk JSON (no model round-trip in the store).
        assert res.json() == json.loads(chapters_path.read_text())

    def test_missing_returns_404(self, client, book_on_disk):
        res = client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 404
        assert res.json()["detail"] == f"Chapters not found for book '{book_on_disk.book_id}'"
