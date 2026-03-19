"""FastAPI dependencies for provider injection from request headers (Decision 17)."""

import logging
from typing import Annotated

from fastapi import Header, HTTPException

from lectoria.providers.base import ImageProvider, LLMProvider
from lectoria.providers.registry import get_image_provider, get_llm_provider

logger = logging.getLogger(__name__)


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
