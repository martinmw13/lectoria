"""Tests for music service — vector encoding, matching, hysteresis, and style presets."""

import pytest

from lectoria.models.ncm import Emotion, MusicIndexEntry, Pacing, Scene, SceneType
from lectoria.services.music import (
    STYLE_PRESETS,
    TAG_DIM,
    TAG_TO_INDEX,
    assign_emotion_primary,
    match_scene_to_track,
    match_scene_to_track_detailed,
    matches_preset,
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
    instrument_tags: list[str] | None = None,
    genre_tags: list[str] | None = None,
) -> MusicIndexEntry:
    return MusicIndexEntry(
        track_id=track_id,
        file_path=f"tracks/{track_id}.mp3",
        duration_seconds=180.0,
        tags=tags,
        instrument_tags=instrument_tags or [],
        genre_tags=genre_tags or [],
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

    def test_exclude_applied_before_variety_rule(self):
        """Exclusion happens before the variety rule, not after.

        Ranking is t1 > t2 > t3. With t1 excluded, the top non-excluded track is t2;
        because t2 == previous_track_id, the variety rule bumps to the next
        non-excluded track (t3). A naive rank-then-filter would return t2 or t1.
        """
        index = [
            _track("t1", Emotion.JOY, ["happy", "fun", "upbeat"]),
            _track("t2", Emotion.JOY, ["happy", "positive"]),
            _track("t3", Emotion.JOY, ["happy"]),
        ]
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track(
            scene, index, exclude_track_ids={"t1"}, previous_track_id="t2"
        )
        assert result is not None
        assert result.track_id == "t3"


class TestMatchSceneToTrackDetailed:
    """Dev-view projection of the matcher: same selection, plus ranked candidates."""

    @pytest.fixture()
    def index(self):
        return [
            _track("t1", Emotion.JOY, ["happy", "fun", "upbeat"]),
            _track("t2", Emotion.JOY, ["happy", "positive"]),
            _track("t3", Emotion.JOY, ["happy"]),
            _track("s1", Emotion.SORROW, ["sad", "melancholic"]),
        ]

    def test_returns_full_result_shape(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track_detailed(scene, index)
        assert result["selected_track"] == "t1"
        assert result["fallback"] == "none"
        assert result["style_applied"] is None
        assert "scene_vector" in result
        assert {c["track_id"] for c in result["candidates"]} == {"t1", "t2", "t3"}
        assert set(result["candidates"][0].keys()) == {"track_id", "tags", "score"}
        assert result["candidates"][0]["track_id"] == "t1"  # ranked best-first

    def test_top_n_limits_candidates(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track_detailed(scene, index, top_n=2)
        assert len(result["candidates"]) == 2

    def test_avoids_previous_track(self, index):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track_detailed(scene, index, previous_track_id="t1")
        assert result["selected_track"] == "t2"  # t1 is top but == previous, bumped

    def test_fallback_full_index_when_no_emotion_match(self, index):
        scene = _scene(Emotion.WONDER)
        result = match_scene_to_track_detailed(scene, index)
        assert result["fallback"] == "full_index"

    def test_fallback_style_only(self):
        index = [
            _track("jp", Emotion.JOY, ["happy"], instrument_tags=["piano"]),
            _track("orc", Emotion.SORROW, ["sad"], instrument_tags=["strings", "orchestra"]),
        ]
        scene = _scene(Emotion.SORROW)
        result = match_scene_to_track_detailed(scene, index, style="piano_only")
        assert result["fallback"] == "style_only"
        assert result["selected_track"] == "jp"
        assert result["style_applied"] == "piano_only"

    def test_fallback_emotion_only(self):
        index = [
            _track(
                "rk",
                Emotion.TENSION,
                ["dark", "heavy"],
                instrument_tags=["electricguitar", "drums"],
            ),
        ]
        scene = _scene(Emotion.TENSION)
        result = match_scene_to_track_detailed(scene, index, style="noir_jazz")
        assert result["fallback"] == "emotion_only"
        assert result["selected_track"] == "rk"

    def test_empty_index_returns_no_selection(self):
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track_detailed(scene, [])
        assert result["selected_track"] is None
        assert result["candidates"] == []
        # Behavior-preserving: the no-candidate result omits scene_vector.
        assert "scene_vector" not in result

    def test_exclude_honored_in_selection_but_not_in_candidates(self, index):
        """Converged behavior: selected_track honors exclude (matching the played track),
        while the candidates list keeps the full ranking so the dev view can still see
        skipped tracks.

        Ranking is t1 > t2 > t3. With t1 excluded and t2 == previous_track_id, selection
        bumps to t3 — identical to match_scene_to_track's behavior.
        """
        scene = _scene(Emotion.JOY)
        result = match_scene_to_track_detailed(
            scene, index, exclude_track_ids={"t1"}, previous_track_id="t2"
        )
        assert result["selected_track"] == "t3"
        # The excluded track is still shown in the full ranking.
        assert "t1" in {c["track_id"] for c in result["candidates"]}

    def test_selection_matches_non_detailed_path(self, index):
        """The dev view is a projection: its selected_track equals match_scene_to_track."""
        scene = _scene(Emotion.JOY)
        for kwargs in (
            {},
            {"previous_track_id": "t1"},
            {"exclude_track_ids": {"t1"}},
            {"exclude_track_ids": {"t1"}, "previous_track_id": "t2"},
            {"style": "piano_only"},
        ):
            plain = match_scene_to_track(scene, index, **kwargs)
            detailed = match_scene_to_track_detailed(scene, index, **kwargs)
            expected = plain.track_id if plain else None
            assert detailed["selected_track"] == expected, kwargs


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


class TestMatchesPreset:
    def test_track_with_matching_include_tag(self):
        track = _track("t1", Emotion.JOY, ["happy"], instrument_tags=["piano"])
        assert matches_preset(track, "piano_only") is True

    def test_track_with_excluded_tag_rejected(self):
        track = _track("t1", Emotion.JOY, ["happy"], instrument_tags=["piano", "drums"])
        assert matches_preset(track, "piano_only") is False

    def test_track_with_no_instrument_genre_tags_fails(self):
        track = _track("t1", Emotion.JOY, ["happy"])
        assert matches_preset(track, "cinematic") is False

    def test_track_with_only_excluded_tags_rejected(self):
        track = _track("t1", Emotion.JOY, ["happy"], instrument_tags=["electricguitar"])
        assert matches_preset(track, "cinematic") is False

    def test_unknown_preset_returns_false(self):
        track = _track("t1", Emotion.JOY, ["happy"], instrument_tags=["piano"])
        assert matches_preset(track, "nonexistent") is False

    def test_genre_tags_also_checked(self):
        track = _track("t1", Emotion.MYSTERY, ["deep"], genre_tags=["jazz", "blues"])
        assert matches_preset(track, "noir_jazz") is True

    def test_cinematic_orchestra(self):
        track = _track(
            "t1", Emotion.TENSION, ["dramatic"], instrument_tags=["strings", "orchestra"]
        )
        assert matches_preset(track, "cinematic") is True

    def test_synthwave_with_synth_and_80s(self):
        track = _track(
            "t1",
            Emotion.EXCITEMENT,
            ["energetic"],
            instrument_tags=["synthesizer"],
            genre_tags=["80s"],
        )
        assert matches_preset(track, "synthwave") is True

    def test_ambient_rejects_vocals(self):
        track = _track("t1", Emotion.PEACE, ["calm"], instrument_tags=["synthesizer", "voice"])
        assert matches_preset(track, "ambient") is False

    def test_all_presets_defined(self):
        assert set(STYLE_PRESETS.keys()) == {
            "cinematic",
            "piano_only",
            "ambient",
            "synthwave",
            "noir_jazz",
        }


class TestMatchSceneToTrackWithStyle:
    @pytest.fixture()
    def styled_index(self):
        return [
            _track("piano1", Emotion.SORROW, ["sad", "melancholic"], instrument_tags=["piano"]),
            _track(
                "orch1",
                Emotion.SORROW,
                ["sad", "dramatic"],
                instrument_tags=["strings", "orchestra"],
            ),
            _track(
                "synth1",
                Emotion.SORROW,
                ["sad", "deep"],
                instrument_tags=["synthesizer"],
                genre_tags=["electronic"],
            ),
            _track(
                "jazz1",
                Emotion.SORROW,
                ["sad", "emotional"],
                instrument_tags=["saxophone", "piano"],
                genre_tags=["jazz"],
            ),
            _track(
                "rock1",
                Emotion.SORROW,
                ["sad", "heavy"],
                instrument_tags=["electricguitar", "drums"],
            ),
            _track("joy_piano", Emotion.JOY, ["happy", "fun"], instrument_tags=["piano"]),
        ]

    def test_style_narrows_candidates(self, styled_index):
        scene = _scene(Emotion.SORROW)
        result = match_scene_to_track(scene, styled_index, style="piano_only")
        assert result is not None
        assert result.track_id == "piano1"

    def test_cinematic_selects_orchestral(self, styled_index):
        scene = _scene(Emotion.SORROW)
        result = match_scene_to_track(scene, styled_index, style="cinematic")
        assert result is not None
        assert result.track_id == "orch1"

    def test_auto_style_no_filtering(self, styled_index):
        scene = _scene(Emotion.SORROW)
        result_auto = match_scene_to_track(scene, styled_index, style="auto")
        result_none = match_scene_to_track(scene, styled_index, style=None)
        assert result_auto is not None
        assert result_none is not None
        assert result_auto.track_id == result_none.track_id

    def test_fallback_to_style_only_when_emotion_style_empty(self, styled_index):
        scene = _scene(Emotion.WONDER)
        result = match_scene_to_track(scene, styled_index, style="piano_only")
        assert result is not None
        assert "piano" in result.instrument_tags

    def test_fallback_to_emotion_only_when_style_yields_nothing(self):
        index = [
            _track(
                "rock1",
                Emotion.TENSION,
                ["dark", "heavy"],
                instrument_tags=["electricguitar", "drums"],
            ),
        ]
        scene = _scene(Emotion.TENSION)
        result = match_scene_to_track(scene, index, style="noir_jazz")
        assert result is not None
        assert result.track_id == "rock1"
