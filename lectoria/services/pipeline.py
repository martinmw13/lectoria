"""Pipeline orchestration — ingestion through NCM assembly and persistence.

Coordinates the full offline pipeline:
  EPUB → ingestion → LLM 1 → LLM 2 (per chapter) → NCM assembly → save to disk
"""

import asyncio
import functools
import logging
import re
from collections.abc import Callable
from pathlib import Path

from lectoria.core.config import get_settings
from lectoria.models.ncm import (
    BookMap,
    Chapter,
    ChapterAnalysis,
    ChaptersData,
    Character,
    CharacterRole,
    NCM,
)
from lectoria.providers.base import LLMProvider
from lectoria.services.ingestion import ingest_epub
from lectoria.services.narrative import TokenUsage, analyze_book, analyze_chapter

logger = logging.getLogger(__name__)


def _slugify(text: str) -> str:
    """Create a filesystem-safe slug from text."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text[:80].strip("-") or "untitled"


def make_book_id(title: str, author: str = "") -> str:
    """Generate a book-id slug from title and author (Decision 15)."""
    parts = [title]
    if author:
        parts.append(author)
    return _slugify(" ".join(parts))


def get_book_dir(book_id: str) -> Path:
    """Return the data directory for a book, creating it if needed."""
    settings = get_settings()
    book_dir = settings.books_dir / book_id
    book_dir.mkdir(parents=True, exist_ok=True)
    (book_dir / "images" / "covers").mkdir(parents=True, exist_ok=True)
    (book_dir / "images" / "scenes").mkdir(parents=True, exist_ok=True)
    (book_dir / "images" / "characters").mkdir(parents=True, exist_ok=True)
    return book_dir


def save_bookmap(book_dir: Path, book_map: BookMap) -> Path:
    """Save LLM 1 output to bookmap.json."""
    path = book_dir / "bookmap.json"
    path.write_text(book_map.model_dump_json(indent=2))
    logger.info(
        "Saved bookmap.json (%d characters, %d chapter summaries)",
        len(book_map.characters),
        len(book_map.chapters),
    )
    return path


def save_chapters(book_dir: Path, chapters_data: ChaptersData) -> Path:
    """Save ingestion output to chapters.json."""
    path = book_dir / "chapters.json"
    path.write_text(chapters_data.model_dump_json(indent=2))
    logger.info("Saved chapters.json (%d chapters)", len(chapters_data.chapters))
    return path


def save_ncm(book_dir: Path, ncm: NCM) -> Path:
    """Save complete NCM to ncm.json."""
    path = book_dir / "ncm.json"
    path.write_text(ncm.model_dump_json(indent=2))
    logger.info(
        "Saved ncm.json (%d characters, %d chapters)",
        len(ncm.book_map.characters),
        len(ncm.chapters),
    )
    return path


def reconcile_characters(book_map: BookMap, chapter_analyses: list[ChapterAnalysis]) -> BookMap:
    """Add characters discovered by LLM 2 but missing from LLM 1 (Decision 1 post-processing).

    If LLM 2 references character IDs not present in BookMap, they are added
    as minor characters with minimal info.
    """
    known_ids = {c.id for c in book_map.characters}
    discovered: set[str] = set()

    for analysis in chapter_analyses:
        for scene in analysis.scenes:
            for char_id in scene.characters_present:
                if char_id not in known_ids:
                    discovered.add(char_id)

    if not discovered:
        return book_map

    new_characters = list(book_map.characters)
    for char_id in sorted(discovered):
        logger.info("Reconciling character discovered by LLM 2: %s", char_id)
        readable_name = char_id.replace("-", " ").title()
        new_characters.append(
            Character(
                id=char_id,
                name=readable_name,
                role=CharacterRole.MINOR,
            )
        )

    return book_map.model_copy(update={"characters": new_characters})


def assemble_ncm(
    book_map: BookMap,
    chapter_analyses: list[ChapterAnalysis],
) -> NCM:
    """Merge LLM 1 + LLM 2 outputs into a complete NCM."""
    reconciled_map = reconcile_characters(book_map, chapter_analyses)
    return NCM(book_map=reconciled_map, chapters=chapter_analyses)


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------


def _emit_progress(
    on_progress: Callable[[str, str], None] | None, stage: str, detail: str = ""
) -> None:
    """Fan a pipeline progress event out to the optional callback and the log."""
    if on_progress:
        on_progress(stage, detail)
    logger.info("[Pipeline] %s %s", stage, detail)


async def _analyze_chapter_bounded(
    idx: int,
    chapter: Chapter,
    *,
    sem: asyncio.Semaphore,
    llm_provider: LLMProvider,
    book_map: BookMap,
    total: int,
    progress: Callable[[str, str], None],
) -> tuple[ChapterAnalysis, TokenUsage]:
    """Analyze one chapter under the concurrency semaphore, reporting progress."""
    async with sem:
        progress("llm2", f"Chapter {idx}/{total}: {chapter.title or '(untitled)'}")
        return await analyze_chapter(llm_provider, chapter, book_map)


async def run_pipeline(
    epub_path: Path,
    llm_provider: LLMProvider,
    *,
    book_id: str | None = None,
    max_chapters: int | None = None,
    on_progress: Callable[[str, str], None] | None = None,
) -> tuple[str, NCM]:
    """Run the complete offline pipeline from EPUB to NCM.

    Args:
        epub_path: Path to the .epub file.
        llm_provider: LLM provider for narrative analysis.
        book_id: Pre-assigned book ID (from upload). If None, generated from LLM title.
        max_chapters: If set, only process this many narrative chapters (for testing/free-tier).
        on_progress: Optional callback(stage: str, detail: str) for progress reporting.

    Returns:
        Tuple of (book_id, NCM).
    """

    progress = functools.partial(_emit_progress, on_progress)

    # 1. Ingestion
    progress("ingestion", f"Parsing {epub_path.name}")
    chapters_data = ingest_epub(epub_path)
    narrative_chapters = [c for c in chapters_data.chapters if c.is_narrative]
    progress("ingestion", f"Done: {len(narrative_chapters)} narrative chapters")

    if max_chapters and max_chapters < len(narrative_chapters):
        logger.info(
            "Trimming to first %d narrative chapters (of %d)", max_chapters, len(narrative_chapters)
        )
        narrative_chapters = narrative_chapters[:max_chapters]
        chapters_data = ChaptersData(chapters=narrative_chapters)
        progress("ingestion", f"Trimmed to {max_chapters} chapters for processing")

    # 2. LLM 1 — book-level analysis
    progress("llm1", f"Analyzing book ({len(narrative_chapters)} chapters)")
    book_map, llm1_usage = await analyze_book(llm_provider, chapters_data)
    if not book_id:
        book_id = make_book_id(book_map.title)
    progress(
        "llm1",
        f"Done: '{book_map.title}', {len(book_map.characters)} characters "
        f"| tokens: prompt={llm1_usage.prompt_tokens} completion={llm1_usage.completion_tokens} total={llm1_usage.total}",
    )

    # 3. Save intermediate artifacts
    book_dir = get_book_dir(book_id)
    save_chapters(book_dir, chapters_data)
    save_bookmap(book_dir, book_map)

    # 4. LLM 2 — per-chapter scene analysis (concurrent with bounded parallelism)
    llm2_concurrency = 2
    sem = asyncio.Semaphore(llm2_concurrency)
    total = len(narrative_chapters)

    analyze = functools.partial(
        _analyze_chapter_bounded,
        sem=sem,
        llm_provider=llm_provider,
        book_map=book_map,
        total=total,
        progress=progress,
    )
    results = list(
        await asyncio.gather(*(analyze(i, ch) for i, ch in enumerate(narrative_chapters, 1)))
    )
    chapter_analyses = [r[0] for r in results]

    llm2_usage = sum((usage for _, usage in results), TokenUsage())

    progress(
        "llm2",
        f"Done: {sum(len(a.scenes) for a in chapter_analyses)} total scenes "
        f"| tokens: prompt={llm2_usage.prompt_tokens} completion={llm2_usage.completion_tokens} total={llm2_usage.total} ({llm2_usage.calls} calls)",
    )

    # 5. Assemble and save NCM
    progress("assembly", "Merging LLM 1 + LLM 2 outputs")
    ncm = assemble_ncm(book_map, chapter_analyses)
    save_ncm(book_dir, ncm)

    total_usage = llm1_usage + llm2_usage
    progress(
        "complete",
        f"NCM saved to {book_dir} "
        f"| total tokens: prompt={total_usage.prompt_tokens} "
        f"completion={total_usage.completion_tokens} total={total_usage.total}",
    )

    return book_id, ncm
