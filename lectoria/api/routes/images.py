"""On-demand and scene image generation endpoints."""

import base64
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lectoria.api.deps import (
    find_scene_or_404,
    get_book_store,
    image_provider_dep,
    load_ncm_or_404,
)
from lectoria.models.ncm import NCM
from lectoria.providers.base import ImageProvider
from lectoria.services.bookstore import BookStore
from lectoria.services.image import generate_on_demand, generate_scene_image

logger = logging.getLogger(__name__)

router = APIRouter()


class ImageGenerateRequest(BaseModel):
    selected_text: str
    chapter_index: int | None = None
    scene_index: int | None = None


class SceneImageRequest(BaseModel):
    chapter_index: int
    scene_index: int


class OnDemandImageResponse(BaseModel):
    image_base64: str
    content_type: str
    # None when the image is not tied to a scene (no on-disk cache location).
    cache_url: str | None = None


class SceneImageResponse(BaseModel):
    cache_url: str
    generated: bool


@router.post("/{book_id}/images/generate")
async def generate_image(
    book_id: str,
    request: ImageGenerateRequest,
    store: Annotated[BookStore, Depends(get_book_store)],
    ncm: Annotated[NCM, Depends(load_ncm_or_404)],
    image_provider: Annotated[ImageProvider, Depends(image_provider_dep)],
) -> OnDemandImageResponse:
    """Generate an on-demand image from selected text (Decision 5).

    Injects character physical descriptions via string matching (Decision 9).
    Stores character memory on single-character images (Decision 8).
    """
    # Lenient scene lookup (Decision 5): bad/absent coordinates are non-fatal —
    # we still generate from the selected text, just without scene context.
    scene = None
    if request.chapter_index is not None and request.scene_index is not None:
        try:
            _, scene = ncm.find_scene(request.chapter_index, request.scene_index)
        except ValueError:
            logger.debug(
                "No scene at ch=%s sc=%s for book '%s'; generating without scene context",
                request.chapter_index,
                request.scene_index,
                book_id,
            )

    try:
        image_bytes = await generate_on_demand(
            image_provider,
            store,
            book_id,
            request.selected_text,
            ncm.book_map,
            scene=scene,
            chapter_index=request.chapter_index,
        )
    except Exception as e:
        logger.error("On-demand image generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Image generation failed: {e}") from e

    cache_url = None
    if request.chapter_index is not None and request.scene_index is not None:
        cache_url = (
            f"/api/data/books/{book_id}/images/on_demand"
            f"/ch{request.chapter_index}_sc{request.scene_index}.png"
        )

    return OnDemandImageResponse(
        image_base64=base64.b64encode(image_bytes).decode(),
        content_type="image/png",
        cache_url=cache_url,
    )


@router.post("/{book_id}/images/scene")
async def generate_scene(
    book_id: str,
    request: SceneImageRequest,
    store: Annotated[BookStore, Depends(get_book_store)],
    ncm: Annotated[NCM, Depends(load_ncm_or_404)],
    image_provider: Annotated[ImageProvider, Depends(image_provider_dep)],
) -> SceneImageResponse:
    """Generate (or return cached) scene image from the LLM-produced image_prompt (Decision 33)."""
    # Strict lookup: coordinates come from the request body, so the scene is
    # resolved here via the shared helper rather than a path-param dependency.
    scene = find_scene_or_404(ncm, request.chapter_index, request.scene_index)

    if not scene.image_prompt:
        raise HTTPException(
            status_code=400,
            detail=f"Scene {request.scene_index} in chapter {request.chapter_index} has no image_prompt",
        )

    cache_url = (
        f"/api/data/books/{book_id}/images/scenes"
        f"/ch{request.chapter_index}_sc{request.scene_index}.png"
    )

    if store.scene_image_path(book_id, request.chapter_index, request.scene_index).exists():
        return SceneImageResponse(cache_url=cache_url, generated=False)

    try:
        result_path = await generate_scene_image(
            image_provider, store, book_id, scene, request.chapter_index
        )
    except Exception as e:
        logger.error("Scene image generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Scene image generation failed: {e}") from e

    if result_path is None:
        raise HTTPException(status_code=502, detail="Scene image generation returned no result")

    return SceneImageResponse(cache_url=cache_url, generated=True)
