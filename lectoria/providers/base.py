"""Provider abstraction layer for external AI APIs (Decision 13).

Services call providers through these protocols, never directly.
Each concrete adapter (e.g., google.py, openai.py) implements one or both.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol for LLM text completion providers."""

    async def complete(self, prompt: str, *, system: str | None = None) -> str:
        """Send a prompt and return the completion text."""
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
