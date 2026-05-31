"""Book upload, processing, and retrieval endpoints."""

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from lectoria.api.deps import get_book_store, llm_provider_dep
from lectoria.core.config import get_settings
from lectoria.models.ncm import NCM, ChaptersData
from lectoria.providers.base import LLMProvider
from lectoria.services.bookstore import ArtifactNotFound, BookStore
from lectoria.services.ingestion import ingest_epub
from lectoria.services.pipeline import (
    get_book_dir,
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


class BookResponse(BaseModel):
    """The NCM-derived fields are present only once a book has been processed;
    they are set/unset together and dropped via response_model_exclude_unset."""

    book_id: str
    has_ncm: bool
    title: str | None = None
    genre: str | None = None
    character_count: int | None = None
    chapter_count: int | None = None
    scene_count: int | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/")
async def list_books(
    store: Annotated[BookStore, Depends(get_book_store)],
) -> dict[str, list[BookSummary]]:
    """List all books that have been uploaded."""
    books = [
        BookSummary(book_id=record.book_id, title=record.title, has_ncm=record.has_ncm)
        for record in store.list_books()
    ]
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


@router.get("/{book_id}", response_model_exclude_unset=True)
async def get_book(
    book_id: str, store: Annotated[BookStore, Depends(get_book_store)]
) -> BookResponse:
    """Get book metadata and NCM status."""
    if not store.exists(book_id):
        raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found")

    if not store.has_ncm(book_id):
        return BookResponse(book_id=book_id, has_ncm=False)

    ncm = store.load_ncm(book_id)
    return BookResponse(
        book_id=book_id,
        has_ncm=True,
        title=ncm.book_map.title,
        genre=ncm.book_map.genre,
        character_count=len(ncm.book_map.characters),
        chapter_count=len(ncm.chapters),
        scene_count=sum(len(ch.scenes) for ch in ncm.chapters),
    )


@router.get("/{book_id}/chapters", response_model=ChaptersData)
async def get_chapters(book_id: str, store: Annotated[BookStore, Depends(get_book_store)]):
    """Get the ingested chapters with paragraph text.

    Typed at the route boundary with ``response_model=ChaptersData`` so the HTTP
    contract is the structured shape. The store stays data-faithful (returns the
    raw dict, no model round-trip — D15); validation/serialization happens here.
    """
    try:
        return store.load_chapters_json(book_id)
    except ArtifactNotFound:
        raise HTTPException(
            status_code=404, detail=f"Chapters not found for book '{book_id}'"
        ) from None


@router.get("/{book_id}/ncm")
async def get_ncm(book_id: str, store: Annotated[BookStore, Depends(get_book_store)]) -> NCM:
    """Get the complete NCM for a book."""
    try:
        return store.load_ncm(book_id)
    except ArtifactNotFound:
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'") from None
