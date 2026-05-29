"""Reusable test doubles for the provider protocols (Decision 13).

Service-layer code (narrative analysis, the pipeline) talks to LLMs only
through ``LLMProvider``. These fakes let those services be tested without
touching a real API (see testing-standards.md).
"""

from lectoria.providers.base import CompletionResult

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
