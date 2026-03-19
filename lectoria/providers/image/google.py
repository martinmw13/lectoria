"""Google Imagen image generation provider adapter."""

import logging

from google import genai
from google.genai import types

from lectoria.providers.registry import register_image_provider

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "imagen-3.0-generate-002"


class GoogleImageProvider:
    """Image generation provider backed by Google Imagen via the google-genai SDK."""

    def __init__(self, api_key: str, *, model: str = DEFAULT_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    async def generate(
        self,
        prompt: str,
        *,
        reference_image: bytes | None = None,
    ) -> bytes:
        # Imagen generate_images does not support reference images for consistency;
        # reference_image is ignored (character memory falls back to text-only).
        if reference_image is not None:
            logger.debug("Reference image provided but Imagen does not support it; ignoring")

        response = await self._client.aio.models.generate_images(
            model=self._model,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/png",
            ),
        )

        if not response.generated_images:
            raise RuntimeError("Image generation returned no images (possibly filtered by safety)")

        return response.generated_images[0].image.image_bytes

    def supports_reference_image(self) -> bool:
        return False


def _factory(api_key: str) -> GoogleImageProvider:
    return GoogleImageProvider(api_key)


register_image_provider("google", _factory)
