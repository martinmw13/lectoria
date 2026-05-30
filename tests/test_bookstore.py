"""Unit tests for the FileSystemBookStore adapter over a temp directory.

Uses the ``book_on_disk`` fixture (conftest) which materialises a processed
book under ``tmp_path/books/<book_id>/``; the store is rooted at that books dir.
"""

import json

import pytest

from lectoria.models.ncm import NCM
from lectoria.services.bookstore import ArtifactNotFound, FileSystemBookStore


class TestExists:
    def test_true_when_book_dir_present(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        assert store.exists(book_on_disk.book_id) is True

    def test_false_when_book_dir_absent(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        assert store.exists("no-such-book") is False


class TestHasNcm:
    def test_true_when_ncm_present(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        assert store.has_ncm(book_on_disk.book_id) is True

    def test_false_when_dir_present_but_unprocessed(self, book_on_disk):
        books_dir = book_on_disk.book_dir.parent
        (books_dir / "unprocessed").mkdir()
        store = FileSystemBookStore(books_dir)
        assert store.has_ncm("unprocessed") is False

    def test_false_when_book_dir_absent(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        assert store.has_ncm("no-such-book") is False


class TestLoadNcm:
    def test_returns_validated_ncm(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        ncm = store.load_ncm(book_on_disk.book_id)
        assert isinstance(ncm, NCM)
        assert ncm.book_map.title == "Test Book"

    def test_raises_when_book_dir_absent(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        with pytest.raises(ArtifactNotFound):
            store.load_ncm("no-such-book")

    def test_raises_when_dir_present_but_ncm_absent(self, book_on_disk):
        books_dir = book_on_disk.book_dir.parent
        (books_dir / "unprocessed").mkdir()
        store = FileSystemBookStore(books_dir)
        with pytest.raises(ArtifactNotFound):
            store.load_ncm("unprocessed")


class TestListBooks:
    def test_empty_when_books_dir_absent(self, tmp_path):
        store = FileSystemBookStore(tmp_path / "books")
        assert store.list_books() == []

    def test_title_from_ncm_when_processed(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        records = store.list_books()
        assert len(records) == 1
        assert records[0].book_id == book_on_disk.book_id
        assert records[0].title == "Test Book"
        assert records[0].has_ncm is True

    def test_title_falls_back_to_dir_name_when_unprocessed(self, book_on_disk):
        books_dir = book_on_disk.book_dir.parent
        (books_dir / "unprocessed").mkdir()
        store = FileSystemBookStore(books_dir)
        record = next(r for r in store.list_books() if r.book_id == "unprocessed")
        assert record.title == "unprocessed"
        assert record.has_ncm is False

    def test_skips_dotfiles_and_non_directories(self, book_on_disk):
        books_dir = book_on_disk.book_dir.parent
        (books_dir / ".hidden").mkdir()
        (books_dir / "loose-file.txt").write_text("not a book")
        store = FileSystemBookStore(books_dir)
        ids = {r.book_id for r in store.list_books()}
        assert ids == {book_on_disk.book_id}

    def test_corrupt_ncm_falls_back_to_dir_name(self, book_on_disk):
        # A present-but-unparseable NCM is still has_ncm=True, but the title
        # falls back to the directory name rather than failing the listing.
        books_dir = book_on_disk.book_dir.parent
        corrupt = books_dir / "corrupt"
        corrupt.mkdir()
        (corrupt / "ncm.json").write_text("{not valid json")
        store = FileSystemBookStore(books_dir)
        record = next(r for r in store.list_books() if r.book_id == "corrupt")
        assert record.title == "corrupt"
        assert record.has_ncm is True


class TestLoadChaptersJson:
    def test_returns_raw_chapters_dict(self, book_on_disk):
        chapters = {"chapters": [{"index": 1, "paragraphs": [{"text": "hello"}]}]}
        (book_on_disk.book_dir / "chapters.json").write_text(json.dumps(chapters))
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        assert store.load_chapters_json(book_on_disk.book_id) == chapters

    def test_raises_when_chapters_absent(self, book_on_disk):
        store = FileSystemBookStore(book_on_disk.book_dir.parent)
        with pytest.raises(ArtifactNotFound):
            store.load_chapters_json(book_on_disk.book_id)
