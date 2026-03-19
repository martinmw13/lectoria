"""Tests for music service — vector encoding, matching, and hysteresis."""

import pytest

from lectoria.models.ncm import Emotion, MusicIndexEntry, Pacing, Scene, SceneType
from lectoria.services.music import (
    TAG_DIM,
    TAG_TO_INDEX,
    assign_emotion_primary,
    match_scene_to_track,
    scene_to_vector,
    should_crossfade,
    tags_to_vector,
)


def _scene(
    emotion: Emotion = Emotion.JOY,
    pacing: Pacing = Pacing.MEDIUM,
    scene_type: SceneType = SceneType.DESCRIPTION,
    start: int = 1,
    end: int = 10,
) -> Scene:
    return Scene(
        scene_index=1,
        start_paragraph=start,
        end_paragraph=end,
        emotion=emotion,
        pacing=pacing,
        scene_type=scene_type,
    )


def _track(
    track_id: str,
    emotion: Emotion,
    tags: list[str],
) -> MusicIndexEntry:
    return MusicIndexEntry(
        track_id=track_id,
        file_path=f"tracks/{track_id}.mp3",
        duration_seconds=180.0,
        tags=tags,
        emotion_primary=emotion,
        tag_vector=tags_to_vector(tags),
    )


class TestTagsToVector:
    def test_correct_dimension(self):
        vec = tags_to_vector(["happy", "calm"])
        assert len(vec) == TAG_DIM

    def test_known_tags_set_to_one(self):
        vec = tags_to_vector(["happy"])
        assert vec[TAG_TO_INDEX["happy"]] == 1.0

    def test_unknown_tags_ignored(self):
        vec = tags_to_vector(["nonexistent_tag"])
        assert sum(vec) == 0.0

    def test_empty_tags(self):
        vec = tags_to_vector([])
        assert sum(vec) == 0.0

    def test_multiple_tags(self):
        vec = tags_to_vector(["happy", "calm", "romantic"])
        assert sum(vec) == 3.0


class TestSceneToVector:
    def test_produces_correct_dimension(self):
        scene = _scene(Emotion.JOY, Pacing.FAST, SceneType.ACTION)
        vec = scene_to_vector(scene)
        assert len(vec) == TAG_DIM

    def test_nonzero_for_known_scene(self):
        scene = _scene(Emotion.TENSION, Pacing.FAST, SceneType.ACTION)
        vec = scene_to_vector(scene)
        assert sum(vec) > 0

    def test_different_emotions_produce_different_vectors(self):
        joy_vec = scene_to_vector(_scene(Emotion.JOY))
        tension_vec = scene_to_vector(_scene(Emotion.TENSION))
        assert joy_vec != tension_vec


class TestAssignEmotionPrimary:
    def test_single_emotion_tag(self):
        assert assign_emotion_primary(["happy"]) == Emotion.JOY

    def test_majority_wins(self):
        result = assign_emotion_primary(["happy", "fun", "dark"])
        assert result == Emotion.JOY

    def test_no_emotion_tags_returns_none(self):
        assert assign_emotion_primary(["corporate", "background"]) is None

    def test_empty_tags_returns_none(self):
        assert assign_emotion_primary([]) is None


class TestMatchSceneToTrack:
    @pytest.fixture()
    def index(self):
        return [
            _track("t1", Emotion.JOY, ["happy", "fun", "upbeat"]),
            _track("t2", Emotion.JOY, ["happy", "positive"]),
            _track("t3", Emotion.TENSION, ["dark", "heavy", "dramatic"]),
            _track("t4", Emotion.SORROW, ["sad", "melancholic"]),
            _track("t5", Emotion.PEACE, ["calm", "relaxing", "soft"]),
        ]

    def test_matches_by_emotion(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(scene, index)
        assert result is not None
        assert result.emotion_primary == Emotion.JOY

    def test_avoids_previous_track(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(scene, index, previous_track_id="t1")
        assert result is not None
        assert result.track_id != "t1"

    def test_excludes_track_ids(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(scene, index, exclude_track_ids={"t1"})
        assert result is not None
        assert result.track_id == "t2"

    def test_all_candidates_excluded_falls_back_to_excluded(self, index):
        """When all emotion-matched candidates are excluded, returns best excluded track."""
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(scene, index, exclude_track_ids={"t1", "t2"})
        assert result is not None
        assert result.emotion_primary == Emotion.JOY

    def test_fallback_to_full_index_when_no_emotion_match(self, index):
        scene = _scene(Emotion.WONDER)
        result = match_scene_to_track(scene, index)
        assert result is not None

    def test_empty_index_returns_none(self):
        scene = _scene(Emotion.JOY)
        assert match_scene_to_track(scene, []) is None

    def test_all_excluded_falls_back(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(scene, index, exclude_track_ids={"t1", "t2"})
        assert result is not None


class TestShouldCrossfade:
    def test_same_emotion_no_crossfade(self):
        s1 = _scene(Emotion.JOY, start=1, end=50)
        s2 = _scene(Emotion.JOY, start=51, end=100)
        assert should_crossfade(s1, s2) is False

    def test_different_cluster_always_crossfade(self):
        s1 = _scene(Emotion.PEACE, start=1, end=5)
        s2 = _scene(Emotion.ANGER, start=6, end=10)
        assert should_crossfade(s1, s2) is True

    def test_same_cluster_short_scene_no_crossfade(self):
        s1 = _scene(Emotion.JOY, start=1, end=5)
        s2 = _scene(Emotion.PEACE, start=6, end=15)
        assert should_crossfade(s1, s2) is False

    def test_same_cluster_long_scene_crossfade(self):
        s1 = _scene(Emotion.JOY, start=1, end=10)
        s2 = _scene(Emotion.PEACE, start=11, end=60)
        assert should_crossfade(s1, s2) is True

    def test_tension_to_anger_same_dark_cluster(self):
        s1 = _scene(Emotion.TENSION, start=1, end=5)
        s2 = _scene(Emotion.ANGER, start=6, end=10)
        assert should_crossfade(s1, s2) is False

    def test_sorrow_to_joy_different_clusters(self):
        s1 = _scene(Emotion.SORROW, start=1, end=5)
        s2 = _scene(Emotion.JOY, start=6, end=10)
        assert should_crossfade(s1, s2) is True
