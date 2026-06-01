"""FastAPI dependency providers.

Provider injection from request headers (Decision 17) plus the BookStore read
seam, constructed from settings and injected into routes via ``Depends``.
"""

import logging
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from lectoria.core.config import get_settings
from lectoria.models.ncm import NCM, Scene
from lectoria.providers.base import ImageProvider, LLMProvider
from lectoria.providers.registry import get_image_provider, get_llm_provider
from lectoria.services.bookstore import ArtifactNotFound, BookStore, FileSystemBookStore

logger = logging.getLogger(__name__)


def get_book_store() -> BookStore:
    """Construct the filesystem-backed BookStore from settings.

    Tests override this provider with a temp-directory-backed store.
    """
    return FileSystemBookStore(get_settings().books_dir)


def load_ncm_or_404(
    book_id: str,
    store: Annotated[BookStore, Depends(get_book_store)],
) -> NCM:
    """Load a book's NCM, raising 404 when the artifact is missing.

    Usable as a FastAPI dependency (``Depends(load_ncm_or_404)``) or called
    directly with an explicit store when a route must run another check first —
    e.g. the scene-track route validates ``style`` (400) before touching the NCM,
    a precedence a pre-handler dependency would invert.

    Intentionally a sync ``def`` (not ``async``): ``store.load_ncm`` does blocking
    disk I/O + a CPU-bound parse, so FastAPI runs it in its threadpool when injected
    via ``Depends``. Making it ``async`` would run that blocking load on the event
    loop and stall concurrent requests — do not "tidy" it to match the async
    provider deps above (those do no blocking I/O).
    """
    try:
        return store.load_ncm(book_id)
    except ArtifactNotFound:
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'") from None


def find_scene_or_404(ncm: NCM, chapter_idx: int, scene_idx: int) -> Scene:
    """Resolve a scene by index, raising 404 when the chapter or scene is absent.

    Lives in the deps layer rather than on the NCM model so the model stays free
    of HTTP concerns; ``deps.py`` is the boundary where ``HTTPException`` is allowed.
    """
    try:
        _, scene = ncm.find_scene(chapter_idx, scene_idx)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return scene


def get_current_scene_or_404(
    chapter_idx: int,
    scene_idx: int,
    ncm: Annotated[NCM, Depends(load_ncm_or_404)],
) -> Scene:
    """Resolve the path-addressed current scene, 404ing if the NCM or scene is absent.

    For routes whose scene coordinates are path parameters (the crossfade route).
    Routes that validate other inputs first, or whose coordinates live in the
    request body, call ``load_ncm_or_404`` / ``find_scene_or_404`` directly.
    """
    return find_scene_or_404(ncm, chapter_idx, scene_idx)


async def llm_provider_dep(
    x_provider_llm: Annotated[str, Header()],
    x_api_key_llm: Annotated[str, Header()],
) -> LLMProvider:
    try:
        return get_llm_provider(x_provider_llm, x_api_key_llm)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


async def image_provider_dep(
    x_provider_image: Annotated[str | None, Header()] = None,
    x_api_key_image: Annotated[str | None, Header()] = None,
) -> ImageProvider:
    if not x_provider_image or not x_api_key_image:
        raise HTTPException(
            status_code=400,
            detail="Image provider not configured. Set your Image API key in Settings.",
        )
    try:
        return get_image_provider(x_provider_image, x_api_key_image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
