"""On-demand image generation endpoints."""

import base64
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lectoria.api.deps import image_provider_dep
from lectoria.core.config import get_settings
from lectoria.providers.base import ImageProvider
from lectoria.services.image import generate_on_demand
from lectoria.services.pipeline import find_scene, load_ncm

logger = logging.getLogger(__name__)

router = APIRouter()


class ImageGenerateRequest(BaseModel):
    selected_text: str
    chapter_index: int | None = None
    scene_index: int | None = None


@router.post("/{book_id}/images/generate")
async def generate_image(
    book_id: str,
    request: ImageGenerateRequest,
    image_provider: ImageProvider = Depends(image_provider_dep),
) -> dict:
    """Generate an on-demand image from selected text (Decision 5).

    Injects character physical descriptions via string matching (Decision 9).
    Stores character memory on single-character images (Decision 8).
    """
    settings = get_settings()
    book_dir = settings.books_dir / book_id
    ncm_path = book_dir / "ncm.json"

    if not ncm_path.exists():
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'")

    ncm = load_ncm(book_dir)

    scene = None
    if request.chapter_index is not None and request.scene_index is not None:
        try:
            _, scene = find_scene(ncm, request.chapter_index, request.scene_index)
        except ValueError:
            pass

    try:
        image_bytes = await generate_on_demand(
            image_provider,
            request.selected_text,
            ncm.book_map,
            book_dir,
            scene=scene,
        )
    except Exception as e:
        logger.error("On-demand image generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Image generation failed: {e}") from e

    return {
        "image_base64": base64.b64encode(image_bytes).decode(),
        "content_type": "image/png",
    }
