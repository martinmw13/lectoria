"""BookStore — the seam that owns the on-disk artifact layout for a book.

Encapsulates D15 (file-based JSON storage): callers ask the store whether a
book exists, whether it is processed, or for a loaded artifact — they never
build ``books_dir / book_id / artifact`` paths or run existence checks inline.

This slice covers the read side needed by the ``get_ncm`` / ``get_book``
endpoints (``exists`` / ``has_ncm`` / ``load_ncm``) plus the image-path
resolvers consumed by the image service and the image routes, alongside a
``source.epub`` path resolver that completes the artifact layout. The
remaining read methods (``list_books``, ``load_chapters_json``) and the write
side land in later slices of PRD #30.
"""

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

    def source_epub_path(self, book_id: str) -> Path:
        """Resolve the path to the book's source EPUB (no existence check)."""
        ...

    def scene_image_path(self, book_id: str, chapter_index: int, scene_index: int) -> Path:
        """Resolve the cache path for an automatic scene image (no existence check)."""
        ...

    def cover_image_path(self, book_id: str, chapter_index: int) -> Path:
        """Resolve the cache path for a chapter cover image (no existence check)."""
        ...

    def character_image_path(self, book_id: str, character_id: str) -> Path:
        """Resolve the path for a character reference image (no existence check)."""
        ...

    def on_demand_image_path(self, book_id: str, chapter_index: int, scene_index: int) -> Path:
        """Resolve the cache path for an on-demand image (no existence check)."""
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

    def _image_path(self, book_id: str, kind: str, filename: str) -> Path:
        return self._book_dir(book_id) / "images" / kind / filename

    def source_epub_path(self, book_id: str) -> Path:
        return self._book_dir(book_id) / "source.epub"

    def scene_image_path(self, book_id: str, chapter_index: int, scene_index: int) -> Path:
        return self._image_path(book_id, "scenes", f"ch{chapter_index}_sc{scene_index}.png")

    def cover_image_path(self, book_id: str, chapter_index: int) -> Path:
        return self._image_path(book_id, "covers", f"ch{chapter_index}.png")

    def character_image_path(self, book_id: str, character_id: str) -> Path:
        return self._image_path(book_id, "characters", f"{character_id}.png")

    def on_demand_image_path(self, book_id: str, chapter_index: int, scene_index: int) -> Path:
        return self._image_path(book_id, "on_demand", f"ch{chapter_index}_sc{scene_index}.png")
