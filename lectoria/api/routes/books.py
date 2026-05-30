"""Book upload, processing, and retrieval endpoints."""

import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from lectoria.api.deps import get_book_store, llm_provider_dep
from lectoria.core.config import get_settings
from lectoria.models.ncm import NCM
from lectoria.providers.base import LLMProvider
from lectoria.services.bookstore import ArtifactNotFound, BookStore
from lectoria.services.ingestion import ingest_epub
from lectoria.services.pipeline import (
    get_book_dir,
    load_ncm,
    make_book_id,
    run_pipeline,
    save_chapters,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class BookSummary(BaseModel):
    book_id: str
    title: str
    has_ncm: bool


class CostEstimate(BaseModel):
    book_id: str
    total_chapters: int
    narrative_chapters: int
    total_paragraphs: int
    estimated_tokens: int
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/")
async def list_books() -> dict[str, list[BookSummary]]:
    """List all books that have been uploaded."""
    settings = get_settings()
    books: list[BookSummary] = []

    if not settings.books_dir.exists():
        return {"books": books}

    for book_dir in sorted(settings.books_dir.iterdir()):
        if not book_dir.is_dir() or book_dir.name.startswith("."):
            continue
        ncm_path = book_dir / "ncm.json"
        # Try to get the title from NCM, fall back to directory name
        title = book_dir.name
        if ncm_path.exists():
            try:
                ncm = load_ncm(book_dir)
                title = ncm.book_map.title or title
            except Exception:
                pass
        books.append(
            BookSummary(
                book_id=book_dir.name,
                title=title,
                has_ncm=ncm_path.exists(),
            )
        )

    return {"books": books}


@router.post("/upload")
async def upload_and_estimate(file: UploadFile) -> CostEstimate:
    """Upload an EPUB and get a cost estimate before processing.

    The EPUB is saved and ingested. Returns chapter/paragraph counts
    and a token estimate so the user can decide whether to proceed.
    """
    if not file.filename or not file.filename.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="File must be an .epub")

    settings = get_settings()
    tmp_path = settings.data_dir / "tmp_upload.epub"
    tmp_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        chapters_data = ingest_epub(tmp_path)
        narrative = [c for c in chapters_data.chapters if c.is_narrative]
        total_paragraphs = sum(len(c.paragraphs) for c in narrative)

        # Rough token estimate: ~1.3 tokens per word, ~5 chars per word
        total_chars = sum(len(p.text) for c in narrative for p in c.paragraphs)
        estimated_tokens = int(total_chars / 5 * 1.3)

        # Create a preliminary book_id from filename
        book_id = make_book_id(Path(file.filename).stem)
        book_dir = get_book_dir(book_id)

        shutil.copy2(tmp_path, book_dir / "source.epub")
        save_chapters(book_dir, chapters_data)

    finally:
        tmp_path.unlink(missing_ok=True)

    return CostEstimate(
        book_id=book_id,
        total_chapters=len(chapters_data.chapters),
        narrative_chapters=len(narrative),
        total_paragraphs=total_paragraphs,
        estimated_tokens=estimated_tokens,
        message=(
            f"{len(narrative)} narrative chapters, ~{estimated_tokens:,} tokens. "
            f"LLM 1 will process the full book. "
            f"LLM 2 will process {len(narrative)} chapters individually."
        ),
    )


@router.post("/{book_id}/process")
async def process_book(
    book_id: str,
    max_chapters: int | None = None,
    force: bool = False,
    llm_provider: LLMProvider = Depends(llm_provider_dep),
) -> EventSourceResponse:
    """Start processing a previously uploaded book. Streams progress via SSE.

    Args:
        max_chapters: If set, only process this many narrative chapters (for testing/free-tier).
        force: If true, delete existing NCM and reprocess.
    """
    settings = get_settings()
    book_dir = settings.books_dir / book_id

    epub_path = book_dir / "source.epub"
    if not epub_path.exists():
        raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found or not uploaded")

    ncm_path = book_dir / "ncm.json"
    if ncm_path.exists():
        if not force:
            raise HTTPException(status_code=409, detail="Book already processed.")
        ncm_path.unlink()
        bookmap_path = book_dir / "bookmap.json"
        if bookmap_path.exists():
            bookmap_path.unlink()
        logger.info("Cleared existing NCM for %s (force reprocess)", book_id)

    async def event_generator():
        progress_queue: asyncio.Queue[dict] = asyncio.Queue()

        def on_progress(stage: str, detail: str = "") -> None:
            progress_queue.put_nowait({"stage": stage, "detail": detail})

        async def _run():
            try:
                _book_id, _ncm = await run_pipeline(
                    epub_path,
                    llm_provider,
                    book_id=book_id,
                    max_chapters=max_chapters,
                    on_progress=on_progress,
                )
                progress_queue.put_nowait({"stage": "done", "detail": _book_id})
            except Exception as e:
                logger.exception("Pipeline failed for %s", book_id)
                progress_queue.put_nowait({"stage": "error", "detail": str(e)})

        task = asyncio.create_task(_run())

        while True:
            try:
                msg = await asyncio.wait_for(progress_queue.get(), timeout=120)
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "keepalive"}
                continue

            yield {"event": "progress", "data": f"{msg['stage']}: {msg['detail']}"}

            if msg["stage"] in ("done", "error"):
                break

        await task

    return EventSourceResponse(event_generator())


@router.get("/{book_id}")
async def get_book(book_id: str, store: Annotated[BookStore, Depends(get_book_store)]) -> dict:
    """Get book metadata and NCM status."""
    if not store.exists(book_id):
        raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found")

    result: dict = {"book_id": book_id, "has_ncm": False}

    if store.has_ncm(book_id):
        ncm = store.load_ncm(book_id)
        result["has_ncm"] = True
        result["title"] = ncm.book_map.title
        result["genre"] = ncm.book_map.genre
        result["character_count"] = len(ncm.book_map.characters)
        result["chapter_count"] = len(ncm.chapters)
        result["scene_count"] = sum(len(ch.scenes) for ch in ncm.chapters)

    return result


@router.get("/{book_id}/chapters")
async def get_chapters(book_id: str) -> dict:
    """Get the ingested chapters with paragraph text."""
    settings = get_settings()
    book_dir = settings.books_dir / book_id
    chapters_path = book_dir / "chapters.json"

    if not chapters_path.exists():
        raise HTTPException(status_code=404, detail=f"Chapters not found for book '{book_id}'")

    return json.loads(chapters_path.read_text())


@router.get("/{book_id}/ncm")
async def get_ncm(book_id: str, store: Annotated[BookStore, Depends(get_book_store)]) -> NCM:
    """Get the complete NCM for a book."""
    try:
        return store.load_ncm(book_id)
    except ArtifactNotFound:
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'") from None
