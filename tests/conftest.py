"""Shared pytest fixtures — the reusable test seam (architecture triage item A).

This is the on-disk half of the test seam: a minimal NCM materialised under
``tmp_path`` in the real book layout (``ncm.json`` + ``images/{covers,scenes,
characters}/``), so the read-time lookups and the image service can be tested
against a real directory without touching ``data/books/``. The fake providers
themselves live in ``tests.fakes`` (imported explicitly, like ``FakeLLMProvider``).

The fixture deliberately builds the directory tree by hand rather than calling
``pipeline.get_book_dir()`` — that helper resolves through ``get_settings()`` and
would write into the real data directory.
"""

from dataclasses import dataclass
from pathlib import Path

import pytest

from lectoria.models.ncm import (
    NCM,
    BookMap,
    Character,
    CharacterRole,
    ChapterAnalysis,
    Emotion,
    Scene,
)


@dataclass(frozen=True)
class BookOnDisk:
    """A sample book materialised on disk for read-time and image-gen tests."""

    book_id: str
    book_dir: Path
    ncm: NCM


def _sample_ncm() -> NCM:
    """Build a minimal but complete NCM: one character, one chapter, one scene.

    The single scene spans paragraphs 1-3 contiguously so the ChapterAnalysis
    scene-coverage validator passes, and carries a non-empty ``image_prompt`` so
    ``generate_scene_image`` actually invokes the provider.
    """
    return NCM(
        book_map=BookMap(
            book_id="test-book",
            title="Test Book",
            genre="fantasy",
            characters=[
                Character(
                    id="hero",
                    name="Hero",
                    physical_description="tall, dark hair",
                    role=CharacterRole.PROTAGONIST,
                )
            ],
        ),
        chapters=[
            ChapterAnalysis(
                chapter_index=1,
                cover_description="a lone figure on a hill at dawn",
                scenes=[
                    Scene(
                        scene_index=1,
                        title="opening",
                        start_paragraph=1,
                        end_paragraph=3,
                        emotion=Emotion.WONDER,
                        image_prompt="a hero stands at dawn overlooking a valley",
                        characters_present=["hero"],
                    )
                ],
            )
        ],
    )


@pytest.fixture
def book_on_disk(tmp_path: Path) -> BookOnDisk:
    """Materialise the sample NCM under ``tmp_path`` in the real book layout."""
    ncm = _sample_ncm()
    book_id = ncm.book_map.book_id
    book_dir = tmp_path / "books" / book_id
    for sub in ("covers", "scenes", "characters"):
        (book_dir / "images" / sub).mkdir(parents=True, exist_ok=True)
    (book_dir / "ncm.json").write_text(ncm.model_dump_json(indent=2))
    return BookOnDisk(book_id=book_id, book_dir=book_dir, ncm=ncm)
