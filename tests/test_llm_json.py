"""Tests for the generic LLM-to-validated-model call (llm_json module)."""

import pytest
from pydantic import BaseModel

from lectoria.providers.base import CompletionResult
from lectoria.services.llm_json import (
    StructuredCallError,
    complete_to_model,
    extract_json,
)
from tests.fakes import FakeLLMProvider


class _Doc(BaseModel):
    value: int


def _raw_to_value_hook(data: dict) -> dict:
    """Test preprocess hook: map {"raw": "5"} -> {"value": 5}."""
    return {"value": int(data["raw"])}


class TestExtractJson:
    def test_plain_json(self):
        raw = '{"chapter_index": 1, "scenes": []}'
        assert extract_json(raw) == raw

    def test_markdown_fenced_json(self):
        raw = '```json\n{"chapter_index": 1}\n```'
        assert extract_json(raw) == '{"chapter_index": 1}'

    def test_markdown_fenced_no_language(self):
        raw = '```\n{"chapter_index": 1}\n```'
        assert extract_json(raw) == '{"chapter_index": 1}'

    def test_json_with_surrounding_text(self):
        raw = 'Here is the result:\n```json\n{"key": "val"}\n```\nDone.'
        assert extract_json(raw) == '{"key": "val"}'

    def test_no_json_raises(self):
        with pytest.raises(ValueError, match="No JSON found"):
            extract_json("This is just plain text with no JSON.")

    def test_whitespace_stripped(self):
        raw = '   \n{"chapter_index": 1}  \n'
        assert extract_json(raw) == '{"chapter_index": 1}'


class TestCompleteToModel:
    @pytest.mark.asyncio
    async def test_success_first_attempt(self):
        provider = FakeLLMProvider(['{"value": 7}'])
        result = await complete_to_model(
            provider, prompt="p", system="s", model_type=_Doc, max_retries=3
        )
        assert result.value.value == 7
        assert result.attempts == 1
        assert result.usage.calls == 1

    @pytest.mark.asyncio
    async def test_passes_prompt_and_system_through(self):
        provider = FakeLLMProvider(['{"value": 1}'])
        await complete_to_model(
            provider, prompt="the-prompt", system="the-system", model_type=_Doc, max_retries=3
        )
        assert provider.prompts == ["the-prompt"]
        assert provider.systems == ["the-system"]

    @pytest.mark.asyncio
    async def test_preprocess_hook_runs_before_validation(self):
        # The model wants {"value": int}; the LLM emits {"raw": "5"} and the hook maps it.
        provider = FakeLLMProvider(['{"raw": "5"}'])
        result = await complete_to_model(
            provider,
            prompt="p",
            system="s",
            model_type=_Doc,
            max_retries=3,
            preprocess=_raw_to_value_hook,
        )
        assert result.value.value == 5

    @pytest.mark.asyncio
    async def test_retries_then_succeeds_counts_every_completed_call(self):
        provider = FakeLLMProvider(
            [
                CompletionResult(text="not json", prompt_tokens=2, completion_tokens=1),
                CompletionResult(text='{"value": 9}', prompt_tokens=4, completion_tokens=2),
            ]
        )
        result = await complete_to_model(
            provider, prompt="p", system="s", model_type=_Doc, max_retries=3
        )
        assert result.value.value == 9
        assert result.attempts == 2
        assert result.usage.calls == 2
        assert result.usage.total == 9

    @pytest.mark.asyncio
    async def test_exhaust_raises_with_usage_and_attempts(self):
        provider = FakeLLMProvider(
            [CompletionResult(text="nope", prompt_tokens=1, completion_tokens=0)] * 3
        )
        with pytest.raises(StructuredCallError) as exc_info:
            await complete_to_model(
                provider, prompt="p", system="s", model_type=_Doc, max_retries=3, label="L1"
            )
        err = exc_info.value
        assert err.attempts == 3
        assert err.usage.calls == 3  # tokens counted on every completed call
        assert err.usage.prompt_tokens == 3
        assert err.last_error is not None
        assert "L1 failed after 3 attempts" in str(err)
        assert isinstance(err, RuntimeError)  # callers may catch it as RuntimeError

    @pytest.mark.asyncio
    async def test_attempts_diverge_from_usage_calls_on_provider_failure(self):
        # complete() RAISES on attempt 1 (no token accounting); attempt 2 succeeds.
        # attempts must report the loop index (2), not usage.calls (1).
        provider = FakeLLMProvider(
            [RuntimeError("boom"), CompletionResult(text='{"value": 1}', prompt_tokens=5)]
        )
        result = await complete_to_model(
            provider, prompt="p", system="s", model_type=_Doc, max_retries=3
        )
        assert result.attempts == 2
        assert result.usage.calls == 1
        assert result.usage.prompt_tokens == 5
