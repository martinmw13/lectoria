"""Generic LLM-to-validated-model call with a content-retry budget.

Both narrative stages (``analyze_book``, ``analyze_chapter``) share one loop:
complete -> accumulate tokens -> extract JSON -> parse -> (optional preprocess)
-> validate, retrying a bounded number of times on *content* failures. This
module owns that loop so each stage keeps only its prompt-building and its
post-processing.

Two retry layers are kept distinct (Decision 32):
- 429 / rate-limit backoff lives *inside* the provider.
- the content-retry budget here is for malformed JSON or validation failures.

The module is deliberately ignorant of the concrete models it produces: callers
pass the target Pydantic type and an optional ``dict -> dict`` preprocess hook,
and own any post-validation stamping (e.g. ``ChapterAnalysis`` dev metadata,
Decision 18) and any fallback policy.
"""

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from lectoria.providers.base import LLMProvider

logger = logging.getLogger(__name__)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*\n(.*?)\n\s*```", re.DOTALL)

# A transform applied to the parsed JSON object before Pydantic validation.
Preprocess = Callable[[dict], dict]


def extract_json(text: str) -> str:
    """Extract a JSON string from an LLM response, handling markdown code blocks."""
    match = _JSON_BLOCK_RE.search(text)
    if match:
        return match.group(1).strip()
    # Try the raw text — maybe the LLM returned plain JSON
    text = text.strip()
    if text.startswith("{"):
        return text
    raise ValueError(f"No JSON found in LLM response (first 200 chars): {text[:200]}")


@dataclass
class TokenUsage:
    """Accumulated token counts from one or more LLM calls."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, prompt: int | None, completion: int | None) -> None:
        self.calls += 1
        self.prompt_tokens += prompt or 0
        self.completion_tokens += completion or 0


@dataclass
class StructuredCompletion[T: BaseModel]:
    """A validated model plus the cost and attempt count it took to produce it."""

    value: T
    usage: TokenUsage
    attempts: int  # 1-based loop index on which validation succeeded


class StructuredCallError(RuntimeError):
    """All content-retry attempts were exhausted without a valid model.

    Carries the accumulated token usage and the attempt count so the caller can
    choose between re-raising and falling back without re-deriving either.
    """

    def __init__(
        self,
        label: str,
        attempts: int,
        usage: TokenUsage,
        last_error: Exception | None,
    ) -> None:
        super().__init__(f"{label} failed after {attempts} attempts. Last error: {last_error}")
        self.label = label
        self.attempts = attempts
        self.usage = usage
        self.last_error = last_error


async def complete_to_model[T: BaseModel](
    provider: LLMProvider,
    *,
    prompt: str,
    system: str,
    model_type: type[T],
    max_retries: int,
    preprocess: Preprocess | None = None,
    label: str = "LLM call",
) -> StructuredCompletion[T]:
    """Call the provider until it yields a JSON object that validates as ``model_type``.

    Token usage is accumulated across every *completed* call (a call whose
    response arrives but fails to parse still counts toward usage). The attempt
    index is reported separately from ``usage.calls`` because a provider-level
    failure raises before any tokens are recorded.

    Raises:
        StructuredCallError: if no attempt within ``max_retries`` validates.
    """
    usage = TokenUsage()
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            logger.info("%s attempt %d/%d", label, attempt, max_retries)
            result = await provider.complete(prompt, system=system)
            usage.add(result.prompt_tokens, result.completion_tokens)
            data = json.loads(extract_json(result.text))
            if preprocess is not None:
                data = preprocess(data)
            value = model_type.model_validate(data)
            return StructuredCompletion(value=value, usage=usage, attempts=attempt)
        except (json.JSONDecodeError, ValidationError, ValueError, RuntimeError) as e:
            last_error = e
            logger.warning("%s attempt %d failed: %s", label, attempt, e)
    raise StructuredCallError(label, max_retries, usage, last_error)
