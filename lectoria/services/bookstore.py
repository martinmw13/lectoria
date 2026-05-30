"""BookStore — the seam that owns the on-disk artifact layout for a book.

Encapsulates D15 (file-based JSON storage): callers ask the store whether a
book exists, whether it is processed, or for a loaded artifact — they never
build ``books_dir / book_id / artifact`` paths or run existence checks inline.

The read side covers the book retrieval routes: ``exists`` / ``has_ncm`` /
``load_ncm`` (for ``get_ncm`` / ``get_book``) plus ``list_books`` /
``load_chapters_json`` (for the listing and chapters routes). The image-path
resolvers and the write side land in later slices of PRD #30.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from lectoria.models.ncm import NCM


class ArtifactNotFound(Exception):
    """A requested book artifact is absent on disk.

    Raised when either the book directory or the artifact file itself is
    missing — the two cases are deliberately collapsed into one error because
    every read route returns 404 in both and does not distinguish them. Routes
    translate this to a 404 ``HTTPException``; the store never raises HTTP errors.
    """


@dataclass(frozen=True)
class BookRecord:
    """A lightweight listing entry for one book.

    ``title`` resolves to the NCM title when the book is processed, falling back
    to the directory name otherwise; ``has_ncm`` is whether it is processed.
    Routes map this to their own response model.
    """

    book_id: str
    title: str
    has_ncm: bool


@runtime_checkable
class BookStore(Protocol):
    """Read seam over a book's on-disk artifacts."""

    def exists(self, book_id: str) -> bool:
        """Whether the book directory exists."""
        ...

    def has_ncm(self, book_id: str) -> bool:
        """Whether the book has been processed (its NCM is present)."""
        ...

    def load_ncm(self, book_id: str) -> NCM:
        """Load and validate the book's NCM. Raises ``ArtifactNotFound`` if absent."""
        ...

    def list_books(self) -> list[BookRecord]:
        """List books as lightweight records, sorted by id; skips dotfiles and files."""
        ...

    def load_chapters_json(self, book_id: str) -> dict:
        """Load the raw ingested chapters JSON. Raises ``ArtifactNotFound`` if absent."""
        ...


class FileSystemBookStore:
    """``BookStore`` backed by the ``data/books/<book-id>/`` filesystem layout."""

    def __init__(self, books_dir: Path) -> None:
        self._books_dir = books_dir

    def _book_dir(self, book_id: str) -> Path:
        return self._books_dir / book_id

    def exists(self, book_id: str) -> bool:
        return self._book_dir(book_id).exists()

    def has_ncm(self, book_id: str) -> bool:
        return (self._book_dir(book_id) / "ncm.json").exists()

    def load_ncm(self, book_id: str) -> NCM:
        path = self._book_dir(book_id) / "ncm.json"
        if not path.exists():
            raise ArtifactNotFound(f"NCM not found for book '{book_id}'")
        return NCM.model_validate_json(path.read_text())

    def list_books(self) -> list[BookRecord]:
        if not self._books_dir.exists():
            return []
        records: list[BookRecord] = []
        for book_dir in sorted(self._books_dir.iterdir()):
            if not book_dir.is_dir() or book_dir.name.startswith("."):
                continue
            book_id = book_dir.name
            has_ncm = self.has_ncm(book_id)
            title = book_id
            if has_ncm:
                try:
                    title = self.load_ncm(book_id).book_map.title or book_id
                except Exception:
                    # A present-but-corrupt NCM falls back to the directory name
                    # rather than failing the whole listing.
                    pass
            records.append(BookRecord(book_id=book_id, title=title, has_ncm=has_ncm))
        return records

    def load_chapters_json(self, book_id: str) -> dict:
        path = self._book_dir(book_id) / "chapters.json"
        if not path.exists():
            raise ArtifactNotFound(f"Chapters not found for book '{book_id}'")
        return json.loads(path.read_text())
