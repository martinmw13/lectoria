"""Google image generation via Gemini native image models (not Imagen).

Imagen ``generate_images`` models are paid-only for typical AI Studio projects.
Gemini 2.5 Flash Image (``gemini-2.5-flash-image``) uses ``generate_content`` and
matches the free-tier image quota documented for the Gemini API.
"""

import logging

from google import genai
from google.genai import types

from lectoria.providers.registry import register_image_provider

logger = logging.getLogger(__name__)

# Stable "Nano Banana" model — text-to-image via generate_content (not Imagen).
DEFAULT_MODEL = "gemini-2.5-flash-image"


def _first_image_bytes(response: types.GenerateContentResponse) -> bytes:
    parts = response.parts
    if not parts:
        # Prompt may have been blocked by safety filters
        feedback = getattr(response, "prompt_feedback", None)
        logger.error("No content parts returned. prompt_feedback=%s", feedback)
        raise RuntimeError(
            f"Image generation returned no content parts (prompt may have been blocked: {feedback})"
        )
    text_parts = []
    for part in parts:
        if part.inline_data is not None and part.inline_data.data:
            return part.inline_data.data
        if part.text:
            text_parts.append(part.text)
    # Model responded with text only (refused or explained instead of drawing)
    refusal_snippet = "; ".join(text_parts)[:300] if text_parts else "(no text either)"
    logger.error("No image in response. Text returned: %s", refusal_snippet)
    raise RuntimeError(f"Image generation returned text instead of image: {refusal_snippet}")


class GoogleImageProvider:
    """Image generation via Gemini native image output (google-genai SDK)."""

    def __init__(self, api_key: str, *, model: str = DEFAULT_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    async def generate(
        self,
        prompt: str,
        *,
        reference_image: bytes | None = None,
    ) -> bytes:
        # Native image models do not take a reference image for consistency here.
        if reference_image is not None:
            logger.debug("Reference image provided; Gemini Flash Image path ignores it")

        wrapped = f"Generate an illustration for the following scene:\n\n{prompt}"
        logger.debug("Image prompt (%d chars): %.200s...", len(wrapped), wrapped)

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=[wrapped],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        return _first_image_bytes(response)

    def supports_reference_image(self) -> bool:
        return False


def _factory(api_key: str) -> GoogleImageProvider:
    return GoogleImageProvider(api_key)


register_image_provider("google", _factory)
