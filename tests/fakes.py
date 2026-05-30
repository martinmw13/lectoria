"""Reusable test doubles for the provider protocols (Decision 13).

Service-layer code (narrative analysis, the pipeline, image generation) talks to
external AI only through ``LLMProvider`` / ``ImageProvider``. These fakes let
those services be tested without touching a real API (see testing-standards.md).
"""

from lectoria.providers.base import CompletionResult

# A minimal byte payload that stands in for a generated PNG. Nothing decodes it;
# the image service only writes the bytes to disk, so any non-empty value works.
FAKE_PNG = b"\x89PNG\r\n\x1a\nfake-image-bytes"

# One scripted reply per complete() call: plain text, a full CompletionResult
# (to control token counts), or an exception to raise (provider-level failure).
ResponseScript = str | CompletionResult | BaseException


class FakeLLMProvider:
    """An ``LLMProvider`` whose ``complete()`` replays a scripted sequence.

    Each item in ``responses`` is consumed by exactly one ``complete()`` call:

    - ``str`` -> returned as ``CompletionResult(text=item)`` with no token counts
    - ``CompletionResult`` -> returned verbatim (use to assert token accumulation)
    - an ``Exception`` instance -> raised (simulates a provider failure, e.g. 429
      exhaustion surfacing as ``RuntimeError``)

    Every call is recorded for assertions via ``calls``, ``prompts`` and
    ``systems``.
    """

    def __init__(
        self,
        responses: list[ResponseScript],
        *,
        model: str = "fake-model-1.0",
        max_tokens: int = 1_000_000,
    ) -> None:
        self._responses = list(responses)
        self.model = model
        self._max_tokens = max_tokens
        self.calls = 0
        self.prompts: list[str] = []
        self.systems: list[str | None] = []

    def max_context_tokens(self) -> int:
        return self._max_tokens

    async def complete(self, prompt: str, *, system: str | None = None) -> CompletionResult:
        self.calls += 1
        self.prompts.append(prompt)
        self.systems.append(system)
        if not self._responses:
            raise AssertionError(
                f"FakeLLMProvider exhausted: complete() called {self.calls} time(s) "
                "but the script has no response left"
            )
        item = self._responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, CompletionResult):
            return item
        return CompletionResult(text=item)


class FakeImageProvider:
    """An ``ImageProvider`` whose ``generate()`` returns scripted image bytes.

    Two modes:

    - ``responses=None`` (default): every ``generate()`` call returns ``FAKE_PNG``.
      Use when the test only cares that *some* image was produced.
    - ``responses=[...]``: each call consumes one item, like ``FakeLLMProvider``:
        - ``bytes`` -> returned as the generated image
        - an ``Exception`` instance -> raised (simulates a generation failure)

    Every call is recorded for assertions via ``calls``, ``prompts`` and
    ``references`` (the ``reference_image`` passed on each call, or ``None``).
    """

    def __init__(
        self,
        responses: list[bytes | BaseException] | None = None,
        *,
        supports_reference: bool = False,
    ) -> None:
        self._responses = list(responses) if responses is not None else None
        self._supports_reference = supports_reference
        self.calls = 0
        self.prompts: list[str] = []
        self.references: list[bytes | None] = []

    def supports_reference_image(self) -> bool:
        return self._supports_reference

    async def generate(self, prompt: str, *, reference_image: bytes | None = None) -> bytes:
        self.calls += 1
        self.prompts.append(prompt)
        self.references.append(reference_image)
        if self._responses is None:
            return FAKE_PNG
        if not self._responses:
            raise AssertionError(
                f"FakeImageProvider exhausted: generate() called {self.calls} time(s) "
                "but the script has no response left"
            )
        item = self._responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item
