"""Tests for pipeline book-id slugging.

NCM reading now lives on the ``BookStore`` (``store.load_ncm`` — see
``test_bookstore.py``) and scene navigation on the model (``NCM.find_scene`` /
``NCM.get_scene`` — see ``test_ncm.py``). The pipeline module retains only its
write helpers and ``make_book_id``.
"""

import pytest

from lectoria.services.pipeline import make_book_id


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
