"""Unit tests for the FileSystemBookStore adapter over a temp directory.

Uses the ``book_on_disk`` fixture (conftest) which materialises a processed
book under ``tmp_path/books/<book_id>/``; the store is rooted at that books dir.
"""

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


class TestImagePathResolvers:
    """Path resolution only — the resolvers never touch disk or check existence."""

    def test_source_epub_path(self, book_on_disk):
        path = book_on_disk.store.source_epub_path(book_on_disk.book_id)
        assert path == book_on_disk.book_dir / "source.epub"

    def test_scene_image_path(self, book_on_disk):
        path = book_on_disk.store.scene_image_path(book_on_disk.book_id, 2, 5)
        assert path == book_on_disk.book_dir / "images" / "scenes" / "ch2_sc5.png"

    def test_cover_image_path(self, book_on_disk):
        path = book_on_disk.store.cover_image_path(book_on_disk.book_id, 3)
        assert path == book_on_disk.book_dir / "images" / "covers" / "ch3.png"

    def test_character_image_path(self, book_on_disk):
        path = book_on_disk.store.character_image_path(book_on_disk.book_id, "hero")
        assert path == book_on_disk.book_dir / "images" / "characters" / "hero.png"

    def test_on_demand_image_path(self, book_on_disk):
        path = book_on_disk.store.on_demand_image_path(book_on_disk.book_id, 4, 7)
        assert path == book_on_disk.book_dir / "images" / "on_demand" / "ch4_sc7.png"

    def test_resolvers_do_no_io(self, book_on_disk):
        # An absent book still resolves to a path; no existence check, no raise.
        books_dir = book_on_disk.book_dir.parent
        path = book_on_disk.store.scene_image_path("no-such-book", 1, 1)
        assert path == books_dir / "no-such-book" / "images" / "scenes" / "ch1_sc1.png"
        assert not path.exists()
