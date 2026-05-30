"""Tests for pipeline read-time lookups and book-id slugging.

``load_ncm`` is the NCM read-model loader used by the image routes; it is
exercised here through the ``book_on_disk`` fixture (an NCM written to a real
``tmp_path`` directory). Scene navigation now lives on the model itself — see
``test_ncm.py`` for ``NCM.find_scene`` / ``NCM.get_scene``.
"""

import pytest

from lectoria.services.pipeline import load_ncm, make_book_id


class TestLoadNcm:
    def test_round_trips_from_disk(self, book_on_disk):
        loaded = load_ncm(book_on_disk.book_dir)
        assert loaded.book_map.title == book_on_disk.ncm.book_map.title
        assert len(loaded.chapters) == 1
        assert loaded.chapters[0].scenes[0].scene_index == 1


class TestMakeBookId:
    @pytest.mark.parametrize(
        "title,author,expected",
        [
            ("The Great Book", "", "the-great-book"),
            ("Title", "Author Name", "title-author-name"),
            ("  Spaces  & Symbols!! ", "", "spaces-symbols"),
            ("", "", "untitled"),
        ],
    )
    def test_slugifies_title_and_author(self, title, author, expected):
        assert make_book_id(title, author) == expected
