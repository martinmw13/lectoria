"""Provider abstraction layer for external AI APIs (Decision 13).

Services call providers through these protocols, never directly.
Each concrete adapter (e.g., google.py, openai.py) implements one or both.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class CompletionResult:
    """Return value from LLMProvider.complete() (Decision 31)."""

    text: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol for LLM text completion providers."""

    # Model identifier, recorded as dev metadata on analysis output (Decision 18).
    model: str

    async def complete(self, prompt: str, *, system: str | None = None) -> CompletionResult:
        """Send a prompt and return completion text with token usage."""
        ...

    def max_context_tokens(self) -> int:
        """Maximum input tokens this provider supports in a single call."""
        ...


@runtime_checkable
class ImageProvider(Protocol):
    """Protocol for image generation providers."""

    async def generate(
        self,
        prompt: str,
        *,
        reference_image: bytes | None = None,
    ) -> bytes:
        """Generate an image from a text prompt, optionally with a reference image."""
        ...

    def supports_reference_image(self) -> bool:
        """Whether this provider supports passing a reference image for consistency."""
        ...
