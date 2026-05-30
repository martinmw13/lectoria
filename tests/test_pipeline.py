"""Tests for pipeline read-time lookups and book-id slugging.

``find_scene`` and ``load_ncm`` are the NCM read-model lookups used by the
image/music routes; they are exercised here through the ``book_on_disk`` fixture
(an NCM written to a real ``tmp_path`` directory).
"""

import pytest

from lectoria.services.pipeline import find_scene, load_ncm, make_book_id


class TestFindScene:
    def test_returns_matching_chapter_and_scene(self, book_on_disk):
        chapter, scene = find_scene(book_on_disk.ncm, 1, 1)
        assert chapter.chapter_index == 1
        assert scene.scene_index == 1
        assert scene.image_prompt

    def test_missing_chapter_raises(self, book_on_disk):
        with pytest.raises(ValueError, match="Chapter 99 not found"):
            find_scene(book_on_disk.ncm, 99, 1)

    def test_missing_scene_raises(self, book_on_disk):
        with pytest.raises(ValueError, match="Scene 99 not found in chapter 1"):
            find_scene(book_on_disk.ncm, 1, 99)


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
