"""Tests for NCM model validation — scene coverage invariant."""

import pytest
from pydantic import ValidationError

from lectoria.models.ncm import (
    ChapterAnalysis,
    Emotion,
    Scene,
)


def _scene(index: int, start: int, end: int, **kwargs) -> dict:
    """Helper to build a minimal valid Scene dict."""
    return {
        "scene_index": index,
        "start_paragraph": start,
        "end_paragraph": end,
        "emotion": kwargs.get("emotion", Emotion.PEACE),
        **kwargs,
    }


class TestSceneCoverageValidator:
    def test_valid_contiguous_scenes(self):
        analysis = ChapterAnalysis(
            chapter_index=1,
            scenes=[
                Scene(**_scene(1, 1, 5)),
                Scene(**_scene(2, 6, 10)),
                Scene(**_scene(3, 11, 15)),
            ],
        )
        assert len(analysis.scenes) == 3

    def test_single_scene_covering_all(self):
        analysis = ChapterAnalysis(
            chapter_index=1,
            scenes=[Scene(**_scene(1, 1, 100))],
        )
        assert len(analysis.scenes) == 1

    def test_empty_scenes_valid(self):
        analysis = ChapterAnalysis(chapter_index=1, scenes=[])
        assert len(analysis.scenes) == 0

    def test_overlapping_scenes_rejected(self):
        with pytest.raises(ValidationError, match="overlaps"):
            ChapterAnalysis(
                chapter_index=1,
                scenes=[
                    Scene(**_scene(1, 1, 10)),
                    Scene(**_scene(2, 8, 15)),
                ],
            )

    def test_gap_between_scenes_rejected(self):
        with pytest.raises(ValidationError, match="Gap"):
            ChapterAnalysis(
                chapter_index=1,
                scenes=[
                    Scene(**_scene(1, 1, 5)),
                    Scene(**_scene(2, 8, 15)),
                ],
            )

    def test_start_greater_than_end_rejected(self):
        with pytest.raises(ValidationError, match="start_paragraph"):
            ChapterAnalysis(
                chapter_index=1,
                scenes=[Scene(**_scene(1, 10, 5))],
            )

    def test_unordered_scenes_are_sorted(self):
        """Scenes provided out of order should still validate if contiguous."""
        analysis = ChapterAnalysis(
            chapter_index=1,
            scenes=[
                Scene(**_scene(2, 6, 10)),
                Scene(**_scene(1, 1, 5)),
            ],
        )
        assert len(analysis.scenes) == 2

    def test_single_paragraph_scene(self):
        analysis = ChapterAnalysis(
            chapter_index=1,
            scenes=[
                Scene(**_scene(1, 1, 1)),
                Scene(**_scene(2, 2, 2)),
            ],
        )
        assert len(analysis.scenes) == 2

    def test_adjacent_scenes_touching_boundary(self):
        """end=5 and start=6 is valid (no gap); end=5 and start=5 is overlap."""
        with pytest.raises(ValidationError, match="overlaps"):
            ChapterAnalysis(
                chapter_index=1,
                scenes=[
                    Scene(**_scene(1, 1, 5)),
                    Scene(**_scene(2, 5, 10)),
                ],
            )


class TestDevMetadata:
    def test_raw_fields_default_to_none(self):
        scene = Scene(**_scene(1, 1, 10))
        assert scene.raw_emotion is None
        assert scene.raw_pacing is None
        assert scene.raw_scene_type is None
        assert scene.raw_transition_type is None

    def test_raw_fields_preserve_original(self):
        scene = Scene(**_scene(1, 1, 10, raw_emotion="frustration"))
        assert scene.raw_emotion == "frustration"
        assert scene.emotion == Emotion.PEACE

    def test_chapter_analysis_dev_defaults(self):
        analysis = ChapterAnalysis(chapter_index=1)
        assert analysis.llm_model == ""
        assert analysis.attempt_count == 0
        assert analysis.is_fallback is False
