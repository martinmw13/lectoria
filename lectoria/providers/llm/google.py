"""Google Gemini LLM provider adapter."""

import logging

from google import genai
from google.genai import types

from lectoria.providers.registry import register_llm_provider

logger = logging.getLogger(__name__)

# Gemini model context windows (input tokens)
_MODEL_CONTEXT: dict[str, int] = {
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-flash": 1_048_576,
    "gemini-2.0-flash": 1_048_576,
}

DEFAULT_MODEL = "gemini-2.5-flash"


class GeminiLLMProvider:
    """LLM provider backed by Google Gemini via the google-genai SDK."""

    def __init__(self, api_key: str, *, model: str = DEFAULT_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    async def complete(self, prompt: str, *, system: str | None = None) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
        )
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=config,
            )
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            raise RuntimeError(f"Gemini API call failed: {e}") from e
        return response.text or ""

    def max_context_tokens(self) -> int:
        return _MODEL_CONTEXT.get(self._model, 1_048_576)

    async def count_tokens(self, text: str) -> int:
        """Count tokens for a given text using the model's tokenizer."""
        response = await self._client.aio.models.count_tokens(
            model=self._model,
            contents=text,
        )
        return response.total_tokens


def _factory(api_key: str) -> GeminiLLMProvider:
    return GeminiLLMProvider(api_key)


register_llm_provider("google", _factory)
