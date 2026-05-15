"""Google Gemini LLM provider adapter."""

import asyncio
import logging
import re

from google import genai
from google.genai import types

from lectoria.providers.base import CompletionResult
from lectoria.providers.registry import register_llm_provider

logger = logging.getLogger(__name__)

# Gemini model context windows (input tokens)
_MODEL_CONTEXT: dict[str, int] = {
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-flash": 1_048_576,
    "gemini-2.0-flash": 1_048_576,
}

DEFAULT_MODEL = "gemini-2.5-flash"

_MAX_RATE_LIMIT_RETRIES = 3
_DEFAULT_BACKOFF_SECONDS = 30
_RETRY_DELAY_RE = re.compile(r"retryDelay.*?(\d+(?:\.\d+)?)\s*s", re.IGNORECASE)


class GeminiLLMProvider:
    """LLM provider backed by Google Gemini via the google-genai SDK."""

    def __init__(self, api_key: str, *, model: str = DEFAULT_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    async def complete(self, prompt: str, *, system: str | None = None) -> CompletionResult:
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
        )
        response = await self._call_with_rate_limit_retry(prompt, config)

        prompt_tokens = None
        completion_tokens = None
        usage = getattr(response, "usage_metadata", None)
        if usage:
            prompt_tokens = getattr(usage, "prompt_token_count", None)
            completion_tokens = getattr(usage, "candidates_token_count", None)
            logger.info(
                "Token usage: prompt=%s completion=%s total=%s",
                prompt_tokens,
                completion_tokens,
                (prompt_tokens or 0) + (completion_tokens or 0),
            )

        return CompletionResult(
            text=response.text or "",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    async def _call_with_rate_limit_retry(
        self,
        prompt: str,
        config: types.GenerateContentConfig,
    ) -> types.GenerateContentResponse:
        """Call the API, retrying on 429 RESOURCE_EXHAUSTED with backoff."""
        for attempt in range(1, _MAX_RATE_LIMIT_RETRIES + 1):
            try:
                return await self._client.aio.models.generate_content(
                    model=self._model,
                    contents=prompt,
                    config=config,
                )
            except Exception as e:
                error_str = str(e)
                if "429" not in error_str and "RESOURCE_EXHAUSTED" not in error_str:
                    logger.error("Gemini API error: %s", e)
                    raise RuntimeError(f"Gemini API call failed: {e}") from e

                delay = self._parse_retry_delay(error_str, attempt)
                if attempt < _MAX_RATE_LIMIT_RETRIES:
                    logger.warning(
                        "Rate limited (attempt %d/%d), retrying in %.1fs: %s",
                        attempt,
                        _MAX_RATE_LIMIT_RETRIES,
                        delay,
                        e,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error("Rate limited, all %d retries exhausted", _MAX_RATE_LIMIT_RETRIES)
                    raise RuntimeError(
                        f"Gemini API call failed after {_MAX_RATE_LIMIT_RETRIES} rate-limit retries: {e}"
                    ) from e
        raise RuntimeError("Unreachable")  # pragma: no cover

    @staticmethod
    def _parse_retry_delay(error_str: str, attempt: int) -> float:
        """Extract retryDelay from the API error, or use exponential backoff."""
        match = _RETRY_DELAY_RE.search(error_str)
        if match:
            return float(match.group(1)) + 1.0
        return _DEFAULT_BACKOFF_SECONDS * (2 ** (attempt - 1))

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
