"""Tests for narrative analysis helpers — JSON extraction and enum coercion."""

import pytest

from lectoria.services.narrative import _coerce_scene_enums, _extract_json


class TestExtractJson:
    def test_plain_json(self):
        raw = '{"chapter_index": 1, "scenes": []}'
        assert _extract_json(raw) == raw

    def test_markdown_fenced_json(self):
        raw = '```json\n{"chapter_index": 1}\n```'
        assert _extract_json(raw) == '{"chapter_index": 1}'

    def test_markdown_fenced_no_language(self):
        raw = '```\n{"chapter_index": 1}\n```'
        assert _extract_json(raw) == '{"chapter_index": 1}'

    def test_json_with_surrounding_text(self):
        raw = 'Here is the result:\n```json\n{"key": "val"}\n```\nDone.'
        assert _extract_json(raw) == '{"key": "val"}'

    def test_no_json_raises(self):
        with pytest.raises(ValueError, match="No JSON found"):
            _extract_json("This is just plain text with no JSON.")

    def test_whitespace_stripped(self):
        raw = '   \n{"chapter_index": 1}  \n'
        assert _extract_json(raw) == '{"chapter_index": 1}'


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
