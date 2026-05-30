"""Tests for narrative analysis — enum coercion and the two-stage LLM
orchestration (analyze_book / analyze_chapter)."""

import json

import pytest

from lectoria.models.ncm import (
    BookMap,
    Chapter,
    ChaptersData,
    ChapterAnalysis,
    Character,
    Emotion,
    Paragraph,
)
from lectoria.providers.base import CompletionResult, LLMProvider
from lectoria.services.narrative import (
    MAX_RETRIES,
    _coerce_scene_enums,
    analyze_book,
    analyze_chapter,
)
from tests.fakes import FakeLLMProvider


class TestCoerceSceneEnums:
    def test_valid_values_unchanged(self):
        data = {
            "scenes": [
                {
                    "emotion": "joy",
                    "pacing": "fast",
                    "scene_type": "action",
                    "transition_type": "none",
                }
            ]
        }
        result = _coerce_scene_enums(data)
        scene = result["scenes"][0]
        assert scene["emotion"] == "joy"
        assert scene["pacing"] == "fast"
        assert scene["scene_type"] == "action"
        assert scene["transition_type"] == "none"
        assert "raw_emotion" not in scene

    def test_emotion_coercion(self):
        data = {"scenes": [{"emotion": "frustration"}]}
        result = _coerce_scene_enums(data)
        scene = result["scenes"][0]
        assert scene["emotion"] == "anger"
        assert scene["raw_emotion"] == "frustration"

    def test_scene_type_coercion(self):
        data = {"scenes": [{"scene_type": "combat"}]}
        result = _coerce_scene_enums(data)
        scene = result["scenes"][0]
        assert scene["scene_type"] == "action"
        assert scene["raw_scene_type"] == "combat"

    def test_transition_coercion(self):
        data = {"scenes": [{"transition_type": "perspective_change"}]}
        result = _coerce_scene_enums(data)
        assert result["scenes"][0]["transition_type"] == "pov_change"

    def test_pacing_coercion(self):
        data = {"scenes": [{"pacing": "moderate"}]}
        result = _coerce_scene_enums(data)
        assert result["scenes"][0]["pacing"] == "medium"

    def test_unknown_value_left_as_is(self):
        data = {"scenes": [{"emotion": "totally_invented_value"}]}
        result = _coerce_scene_enums(data)
        assert result["scenes"][0]["emotion"] == "totally_invented_value"
        assert "raw_emotion" not in result["scenes"][0]

    def test_case_insensitive(self):
        data = {"scenes": [{"emotion": "Frustration"}]}
        result = _coerce_scene_enums(data)
        assert result["scenes"][0]["emotion"] == "anger"

    def test_whitespace_stripped(self):
        data = {"scenes": [{"emotion": "  hope  "}]}
        result = _coerce_scene_enums(data)
        assert result["scenes"][0]["emotion"] == "wonder"

    def test_empty_scenes(self):
        data = {"scenes": []}
        result = _coerce_scene_enums(data)
        assert result["scenes"] == []

    def test_no_scenes_key(self):
        data = {}
        result = _coerce_scene_enums(data)
        assert result == {}

    def test_multiple_fields_coerced(self):
        data = {
            "scenes": [
                {
                    "emotion": "melancholy",
                    "pacing": "very_fast",
                    "scene_type": "flashback",
                    "transition_type": "scene_change",
                }
            ]
        }
        result = _coerce_scene_enums(data)
        scene = result["scenes"][0]
        assert scene["emotion"] == "sorrow"
        assert scene["pacing"] == "fast"
        assert scene["scene_type"] == "transition"
        assert scene["transition_type"] == "location_change"


# ---------------------------------------------------------------------------
# Orchestration fixtures
# ---------------------------------------------------------------------------


def _chapters_data() -> ChaptersData:
    return ChaptersData(
        chapters=[
            Chapter(
                chapter_index=1,
                title="One",
                paragraphs=[Paragraph(index=1, text="Once upon a time.")],
            )
        ]
    )


def _book_map() -> BookMap:
    return BookMap(
        title="Test Book",
        genre="fantasy",
        characters=[Character(id="hero", name="Hero")],
    )


def _chapter() -> Chapter:
    return Chapter(
        chapter_index=2,
        title="Two",
        paragraphs=[
            Paragraph(index=1, text="A paragraph."),
            Paragraph(index=2, text="Another paragraph."),
        ],
    )


_VALID_BOOKMAP_JSON = json.dumps(
    {
        "title": "Test Book",
        "genre": "fantasy",
        "characters": [{"id": "hero", "name": "Hero", "role": "protagonist"}],
        "chapters": [{"chapter_index": 1, "summary": "stuff happens"}],
    }
)


def _chapter_json(emotion: str = "joy") -> str:
    return json.dumps(
        {
            "chapter_index": 2,
            "cover_description": "a cover image",
            "scenes": [
                {
                    "scene_index": 1,
                    "title": "the scene",
                    "start_paragraph": 1,
                    "end_paragraph": 2,
                    "emotion": emotion,
                    "pacing": "medium",
                    "scene_type": "dialogue",
                    "transition_type": "none",
                }
            ],
        }
    )


def test_fake_provider_satisfies_protocol():
    assert isinstance(FakeLLMProvider([]), LLMProvider)


class TestAnalyzeBook:
    @pytest.mark.asyncio
    async def test_success_first_attempt(self):
        provider = FakeLLMProvider([_VALID_BOOKMAP_JSON])
        book_map, usage = await analyze_book(provider, _chapters_data())
        assert isinstance(book_map, BookMap)
        assert book_map.title == "Test Book"
        assert len(book_map.characters) == 1
        assert provider.calls == 1
        assert usage.calls == 1

    @pytest.mark.asyncio
    async def test_retry_then_success_counts_every_completed_call(self):
        # The first reply parses as no-JSON: complete() *succeeded*, so its tokens
        # ARE counted before the content failure. The second reply is valid.
        provider = FakeLLMProvider(
            [
                CompletionResult(text="not json at all", prompt_tokens=3, completion_tokens=1),
                CompletionResult(text=_VALID_BOOKMAP_JSON, prompt_tokens=10, completion_tokens=5),
            ]
        )
        book_map, usage = await analyze_book(provider, _chapters_data())
        assert book_map.title == "Test Book"
        assert provider.calls == 2
        assert usage.calls == 2
        assert usage.prompt_tokens == 13
        assert usage.completion_tokens == 6
        assert usage.total == 19

    @pytest.mark.asyncio
    async def test_raises_runtimeerror_on_exhaust(self):
        provider = FakeLLMProvider(["not json"] * MAX_RETRIES)
        with pytest.raises(RuntimeError, match="LLM 1 failed after"):
            await analyze_book(provider, _chapters_data())
        assert provider.calls == MAX_RETRIES


class TestAnalyzeChapter:
    @pytest.mark.asyncio
    async def test_empty_chapter_short_circuits_without_calling_provider(self):
        provider = FakeLLMProvider([])  # would raise AssertionError if called
        chapter = Chapter(chapter_index=3, paragraphs=[])
        analysis, usage = await analyze_chapter(provider, chapter, _book_map())
        assert analysis.chapter_index == 3
        assert analysis.scenes == []
        assert provider.calls == 0
        assert usage.calls == 0

    @pytest.mark.asyncio
    async def test_success_stamps_model_and_attempt_count(self):
        provider = FakeLLMProvider([_chapter_json()], model="gemini-test")
        analysis, usage = await analyze_chapter(provider, _chapter(), _book_map())
        assert isinstance(analysis, ChapterAnalysis)
        assert len(analysis.scenes) == 1
        assert analysis.attempt_count == 1
        assert analysis.llm_model == "gemini-test"
        assert analysis.is_fallback is False
        assert provider.calls == 1
        assert usage.calls == 1

    @pytest.mark.asyncio
    async def test_enum_coercion_runs_before_validation(self):
        provider = FakeLLMProvider([_chapter_json(emotion="frustration")])
        analysis, _ = await analyze_chapter(provider, _chapter(), _book_map())
        scene = analysis.scenes[0]
        assert scene.emotion == Emotion.ANGER
        assert scene.raw_emotion == "frustration"

    @pytest.mark.asyncio
    async def test_falls_back_on_exhaust(self):
        provider = FakeLLMProvider(["garbage"] * MAX_RETRIES, model="gemini-test")
        analysis, usage = await analyze_chapter(provider, _chapter(), _book_map())
        assert analysis.is_fallback is True
        assert analysis.attempt_count == MAX_RETRIES
        assert analysis.llm_model == "gemini-test"
        assert len(analysis.scenes) == 1
        assert analysis.scenes[0].title == "(full chapter)"
        assert provider.calls == MAX_RETRIES
        assert usage.calls == MAX_RETRIES

    @pytest.mark.asyncio
    async def test_attempt_count_is_loop_index_not_usage_calls(self):
        # complete() RAISES on attempt 1 (provider-level failure) so usage.add is
        # never reached; attempt 2 succeeds. attempt_count must track the loop
        # index (2), NOT usage.calls (1). This pins the behaviour the extracted
        # module must preserve.
        provider = FakeLLMProvider(
            [
                RuntimeError("Gemini API call failed: 500"),
                _chapter_json(),
            ]
        )
        analysis, usage = await analyze_chapter(provider, _chapter(), _book_map())
        assert analysis.attempt_count == 2
        assert usage.calls == 1
        assert provider.calls == 2
        assert analysis.is_fallback is False
