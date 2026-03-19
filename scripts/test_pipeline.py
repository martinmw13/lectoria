"""Quick pipeline test — run LLM 1 on a trimmed book, then LLM 2 on one chapter.

Saves all artifacts to data/books/<book-id>/ for real-time inspection.

Usage:
    uv run python scripts/test_pipeline.py <epub_path> <gemini_api_key>
"""

import asyncio
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

MAX_CHAPTERS = 5


async def main(epub_path: str, api_key: str) -> None:
    from lectoria.models.ncm import ChaptersData
    from lectoria.providers.llm.google import GeminiLLMProvider
    from lectoria.services.ingestion import ingest_epub
    from lectoria.services.narrative import analyze_book, analyze_chapter
    from lectoria.services.pipeline import (
        get_book_dir,
        make_book_id,
        save_bookmap,
        save_chapters,
        save_ncm,
    )
    from lectoria.models.ncm import NCM

    provider = GeminiLLMProvider(api_key)

    # 1. Ingest
    print("=" * 60)
    print("STEP 1: EPUB Ingestion")
    print("=" * 60)

    chapters_data = ingest_epub(Path(epub_path))
    narrative = [c for c in chapters_data.chapters if c.is_narrative]
    print(f"  Chapters: {len(chapters_data.chapters)} total, {len(narrative)} narrative")
    print(f"  Paragraphs: {sum(len(c.paragraphs) for c in narrative)}")

    trimmed = ChaptersData(chapters=narrative[:MAX_CHAPTERS])
    trimmed_paras = sum(len(c.paragraphs) for c in trimmed.chapters)
    print(f"  Using first {len(trimmed.chapters)} narrative chapters ({trimmed_paras} paragraphs)")

    # 2. LLM 1 — book analysis (trimmed)
    print()
    print("=" * 60)
    print(f"STEP 2: LLM 1 (first {MAX_CHAPTERS} chapters)")
    print("=" * 60)
    book_map = await analyze_book(provider, trimmed)

    # Create book dir and save intermediates
    book_id = make_book_id(book_map.title)
    book_dir = get_book_dir(book_id)
    save_chapters(book_dir, trimmed)
    save_bookmap(book_dir, book_map)

    print(f"  Title: {book_map.title}")
    print(f"  Genre: {book_map.genre}")
    print(f"  Setting: {book_map.setting.description[:100]}")
    print(f"  Characters: {len(book_map.characters)}")
    for c in book_map.characters[:8]:
        aliases = ", ".join(c.aliases[:3]) if c.aliases else ""
        print(f"    - {c.name} ({c.role}){f' [{aliases}]' if aliases else ''}")
        if c.physical_description:
            print(f"      {c.physical_description[:120]}")
    if len(book_map.characters) > 8:
        print(f"    ... and {len(book_map.characters) - 8} more")
    print(f"  Chapter summaries: {len(book_map.chapters)}")
    print(f"  -> Saved to {book_dir}/bookmap.json")

    # 3. LLM 2 — one chapter from the trimmed set
    test_chapter = next(
        (c for c in trimmed.chapters if len(c.paragraphs) > 30 and c.title),
        trimmed.chapters[-1],
    )
    print()
    print("=" * 60)
    print(f"STEP 3: LLM 2 (chapter {test_chapter.chapter_index}: {test_chapter.title})")
    print(f"  Paragraphs: {len(test_chapter.paragraphs)}")
    print("=" * 60)
    analysis = await analyze_chapter(provider, test_chapter, book_map)

    print(f"  Cover description: {analysis.cover_description[:100]}...")
    print(f"  Scenes: {len(analysis.scenes)}")
    print(
        f"  Model: {analysis.llm_model} | Attempts: {analysis.attempt_count} | Fallback: {analysis.is_fallback}"
    )
    for s in analysis.scenes:
        chars = ", ".join(s.characters_present[:3])
        coerced = []
        if s.raw_emotion:
            coerced.append(f"emotion: {s.raw_emotion}->{s.emotion}")
        if s.raw_scene_type:
            coerced.append(f"type: {s.raw_scene_type}->{s.scene_type}")
        if s.raw_transition_type:
            coerced.append(f"transition: {s.raw_transition_type}->{s.transition_type}")
        if s.raw_pacing:
            coerced.append(f"pacing: {s.raw_pacing}->{s.pacing}")

        print(
            f'    Scene {s.scene_index}: "{s.title}" '
            f"[p{s.start_paragraph}-{s.end_paragraph}] "
            f"emotion={s.emotion} pacing={s.pacing} type={s.scene_type}"
        )
        if coerced:
            print(f"      COERCED: {' | '.join(coerced)}")
        if chars:
            print(f"      characters: {chars}")
        print(f"      image_prompt: {s.image_prompt[:100]}...")

    # Save NCM with the single analyzed chapter
    ncm = NCM(book_map=book_map, chapters=[analysis])
    save_ncm(book_dir, ncm)
    print(f"  -> Saved to {book_dir}/ncm.json")

    print()
    print("=" * 60)
    print(f"TEST COMPLETE — all artifacts in {book_dir}/")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <epub_path> <gemini_api_key>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
