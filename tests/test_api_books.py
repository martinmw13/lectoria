"""Tests for the book retrieval routes (list_books, get_book, get_chapters, get_ncm).

Route tests use ``httpx.AsyncClient`` over ``ASGITransport`` (the documented
route-testing pattern). The BookStore provider is overridden with a
temp-directory-backed store (the ``book_on_disk`` fixture), so the happy paths
run without touching the real ``data/books/`` directory.
"""

import asyncio
import json
import logging
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

import lectoria.api.routes.books as books_route
from lectoria.api.deps import get_book_store, llm_provider_dep
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


def _unprocessed_book(tmp_path, book_id="sse-book"):
    """Materialise an uploaded-but-unprocessed book dir (source.epub, no ncm.json)."""
    book_dir = tmp_path / "books" / book_id
    book_dir.mkdir(parents=True)
    (book_dir / "source.epub").write_bytes(b"PK\x03\x04 fake epub")
    return book_dir.parent  # books_dir


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
    async def test_returns_typed_chaptersdata_shape(self, book_app, book_on_disk):
        # The route is typed with response_model=ChaptersData: the HTTP edge
        # validates and serializes through the model even though the store stays
        # data-faithful (raw dict, no round-trip). So model defaults are filled
        # in at the boundary — the first chapter omits ``is_narrative`` on disk
        # and must come back ``True``; the second omits ``title`` and gets ``""``.
        chapters = {
            "chapters": [
                {
                    "chapter_index": 0,
                    "title": "Chapter One",
                    "paragraphs": [{"index": 0, "text": "Once upon a time."}],
                },
                {
                    "chapter_index": 1,
                    "paragraphs": [{"index": 0, "text": "Front matter."}],
                    "is_narrative": False,
                },
            ]
        }
        chapters_path = book_on_disk.book_dir / "chapters.json"
        chapters_path.write_text(json.dumps(chapters))
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 200
        body = res.json()

        first = body["chapters"][0]
        assert first["chapter_index"] == 0
        assert first["title"] == "Chapter One"
        assert first["paragraphs"] == [{"index": 0, "text": "Once upon a time."}]
        assert first["is_narrative"] is True  # model default filled at the boundary

        second = body["chapters"][1]
        assert second["is_narrative"] is False
        assert second["title"] == ""  # model default filled at the boundary

    @pytest.mark.asyncio
    async def test_missing_returns_404(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 404
        assert res.json()["detail"] == f"Chapters not found for book '{book_on_disk.book_id}'"

    @pytest.mark.asyncio
    async def test_corrupt_chapters_logs_and_returns_500(self, book_app, book_on_disk, caplog):
        # A chapters.json that does not satisfy ChaptersData (chapter missing the
        # required ``chapter_index``) is validated in-handler, so the route logs
        # with ``book_id`` and returns a traceable 500 — rather than letting the
        # framework raise an unattributed ResponseValidationError with no context.
        bad = {"chapters": [{"title": "x", "paragraphs": [{"text": "no index"}]}]}
        (book_on_disk.book_dir / "chapters.json").write_text(json.dumps(bad))
        with caplog.at_level(logging.ERROR):
            async with _client(book_app) as client:
                res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters")
        assert res.status_code == 500
        assert res.json()["detail"] == f"Corrupt chapters data for book '{book_on_disk.book_id}'"
        assert book_on_disk.book_id in caplog.text  # logged with context (observability.md)


class TestProcessBookSSE:
    """Characterizes the /process SSE wire format after the _SSEProgressBridge
    extraction: 3 event types — ``progress``, ``ping`` (keepalive), and the
    terminal ``done``/``error`` riding on ``event: progress``."""

    @pytest.mark.asyncio
    async def test_streams_progress_then_terminal_done(self, tmp_path, monkeypatch):
        books_dir = _unprocessed_book(tmp_path)
        monkeypatch.setattr(
            books_route, "get_settings", lambda: SimpleNamespace(books_dir=books_dir)
        )

        async def fake_run_pipeline(epub_path, provider, *, book_id, max_chapters, on_progress):
            on_progress("ingestion", "Parsing source.epub")
            on_progress("llm1", "Analyzing book")
            return book_id, object()  # (book_id, ncm) — ncm unused by the bridge

        monkeypatch.setattr(books_route, "run_pipeline", fake_run_pipeline)

        app = create_app()
        app.dependency_overrides[llm_provider_dep] = lambda: object()
        try:
            async with (
                _client(app) as client,
                client.stream("POST", "/api/books/sse-book/process") as r,
            ):
                assert r.status_code == 200
                body = "".join([chunk async for chunk in r.aiter_text()])
        finally:
            app.dependency_overrides.clear()

        assert "event: progress" in body
        assert "data: ingestion: Parsing source.epub" in body
        assert "data: llm1: Analyzing book" in body
        assert "data: done: sse-book" in body  # terminal rides on progress
        assert "event: done" not in body  # NOT a distinct event type

    @pytest.mark.asyncio
    async def test_pipeline_exception_streams_terminal_error(self, tmp_path, monkeypatch):
        books_dir = _unprocessed_book(tmp_path)
        monkeypatch.setattr(
            books_route, "get_settings", lambda: SimpleNamespace(books_dir=books_dir)
        )

        async def boom(epub_path, provider, *, book_id, max_chapters, on_progress):
            on_progress("ingestion", "start")
            raise RuntimeError("kaboom")

        monkeypatch.setattr(books_route, "run_pipeline", boom)

        app = create_app()
        app.dependency_overrides[llm_provider_dep] = lambda: object()
        try:
            async with (
                _client(app) as client,
                client.stream("POST", "/api/books/sse-book/process") as r,
            ):
                body = "".join([chunk async for chunk in r.aiter_text()])
        finally:
            app.dependency_overrides.clear()

        assert "data: error: kaboom" in body
        assert "event: error" not in body

    @pytest.mark.asyncio
    async def test_emits_keepalive_ping_on_timeout(self, tmp_path, monkeypatch):
        books_dir = _unprocessed_book(tmp_path)
        monkeypatch.setattr(
            books_route, "get_settings", lambda: SimpleNamespace(books_dir=books_dir)
        )
        monkeypatch.setattr(books_route, "_KEEPALIVE_TIMEOUT_S", 0.01)

        async def slow(epub_path, provider, *, book_id, max_chapters, on_progress):
            await asyncio.sleep(0.05)  # longer than the timeout → forces a ping
            return book_id, object()

        monkeypatch.setattr(books_route, "run_pipeline", slow)

        app = create_app()
        app.dependency_overrides[llm_provider_dep] = lambda: object()
        try:
            async with (
                _client(app) as client,
                client.stream("POST", "/api/books/sse-book/process") as r,
            ):
                body = "".join([chunk async for chunk in r.aiter_text()])
        finally:
            app.dependency_overrides.clear()

        assert "event: ping" in body
        assert "data: keepalive" in body
        assert "data: done: sse-book" in body  # still terminates after the ping
