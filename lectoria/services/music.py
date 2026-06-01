"""Music matching service — tag-based scene-to-track matching (Decisions 6, 12, 16, 21-23).

Contains:
- Jamendo mood/theme tag vocabulary and mappings
- Style presets for instrument/genre filtering (Decisions 21-23)
- Scene attribute → tag vector encoding
- Track index loading and scene-to-track matching
- Hysteresis logic for music transitions
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lectoria.core.config import get_settings
from lectoria.models.ncm import Emotion, MusicIndexEntry, Pacing, Scene, SceneType

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tag vocabulary — all 59 MTG-Jamendo mood/theme tags in fixed order
# ---------------------------------------------------------------------------

TAG_VOCABULARY: list[str] = [
    "action",
    "adventure",
    "advertising",
    "ambiental",
    "background",
    "ballad",
    "calm",
    "children",
    "christmas",
    "commercial",
    "cool",
    "corporate",
    "dark",
    "deep",
    "documentary",
    "drama",
    "dramatic",
    "dream",
    "emotional",
    "energetic",
    "epic",
    "fast",
    "film",
    "fun",
    "funny",
    "game",
    "groovy",
    "happy",
    "heavy",
    "holiday",
    "hopeful",
    "horror",
    "inspiring",
    "love",
    "meditative",
    "melancholic",
    "mellow",
    "melodic",
    "motivational",
    "movie",
    "nature",
    "party",
    "positive",
    "powerful",
    "relaxing",
    "retro",
    "romantic",
    "sad",
    "sexy",
    "slow",
    "soft",
    "soundscape",
    "space",
    "sport",
    "summer",
    "trailer",
    "travel",
    "upbeat",
    "uplifting",
]

TAG_TO_INDEX: dict[str, int] = {tag: i for i, tag in enumerate(TAG_VOCABULARY)}
TAG_DIM = len(TAG_VOCABULARY)

# ---------------------------------------------------------------------------
# Jamendo tag → emotion_primary mapping (for assigning emotion to tracks)
# Tags mapping to None are genre/use-case descriptors, not emotion-relevant.
# ---------------------------------------------------------------------------

TAG_TO_EMOTION: dict[str, Emotion | None] = {
    "action": Emotion.EXCITEMENT,
    "adventure": Emotion.EXCITEMENT,
    "advertising": None,
    "ambiental": Emotion.PEACE,
    "background": None,
    "ballad": Emotion.SORROW,
    "calm": Emotion.PEACE,
    "children": Emotion.JOY,
    "christmas": Emotion.JOY,
    "commercial": None,
    "cool": None,
    "corporate": None,
    "dark": Emotion.TENSION,
    "deep": Emotion.MYSTERY,
    "documentary": None,
    "drama": Emotion.SORROW,
    "dramatic": Emotion.TENSION,
    "dream": Emotion.WONDER,
    "emotional": Emotion.SORROW,
    "energetic": Emotion.EXCITEMENT,
    "epic": Emotion.EXCITEMENT,
    "fast": Emotion.EXCITEMENT,
    "film": None,
    "fun": Emotion.JOY,
    "funny": Emotion.JOY,
    "game": Emotion.EXCITEMENT,
    "groovy": Emotion.JOY,
    "happy": Emotion.JOY,
    "heavy": Emotion.ANGER,
    "holiday": Emotion.JOY,
    "hopeful": Emotion.WONDER,
    "horror": Emotion.TENSION,
    "inspiring": Emotion.WONDER,
    "love": Emotion.ROMANCE,
    "meditative": Emotion.PEACE,
    "melancholic": Emotion.SORROW,
    "mellow": Emotion.PEACE,
    "melodic": Emotion.WONDER,
    "motivational": Emotion.EXCITEMENT,
    "movie": None,
    "nature": Emotion.PEACE,
    "party": Emotion.JOY,
    "positive": Emotion.JOY,
    "powerful": Emotion.EXCITEMENT,
    "relaxing": Emotion.PEACE,
    "retro": None,
    "romantic": Emotion.ROMANCE,
    "sad": Emotion.SORROW,
    "sexy": Emotion.ROMANCE,
    "slow": Emotion.PEACE,
    "soft": Emotion.PEACE,
    "soundscape": Emotion.WONDER,
    "space": Emotion.WONDER,
    "sport": Emotion.EXCITEMENT,
    "summer": Emotion.JOY,
    "trailer": Emotion.TENSION,
    "travel": Emotion.WONDER,
    "upbeat": Emotion.JOY,
    "uplifting": Emotion.JOY,
}

# ---------------------------------------------------------------------------
# Scene attributes → Jamendo tag mapping (Decision 16)
# Used to build scene tag vectors for cosine similarity matching.
# ---------------------------------------------------------------------------

EMOTION_TO_TAGS: dict[Emotion, list[str]] = {
    Emotion.JOY: ["happy", "fun", "positive", "uplifting", "upbeat", "hopeful", "groovy"],
    Emotion.SORROW: ["sad", "melancholic", "emotional", "ballad", "drama", "mellow"],
    Emotion.TENSION: ["dark", "heavy", "dramatic", "trailer", "powerful", "horror"],
    Emotion.ANGER: ["dark", "heavy", "powerful", "epic", "action", "dramatic"],
    Emotion.PEACE: [
        "calm",
        "relaxing",
        "ambiental",
        "meditative",
        "nature",
        "soft",
        "mellow",
        "slow",
    ],
    Emotion.ROMANCE: ["romantic", "love", "sexy", "emotional", "ballad", "soft"],
    Emotion.MYSTERY: ["deep", "dark", "space", "soundscape", "ambiental", "dream"],
    Emotion.EXCITEMENT: [
        "energetic",
        "epic",
        "action",
        "adventure",
        "fast",
        "sport",
        "powerful",
        "motivational",
    ],
    Emotion.WONDER: [
        "dream",
        "space",
        "soundscape",
        "deep",
        "melodic",
        "nature",
        "ambiental",
        "inspiring",
    ],
}

PACING_TO_TAGS: dict[Pacing, list[str]] = {
    Pacing.SLOW: ["slow", "calm", "soft", "mellow", "relaxing", "meditative", "ambiental"],
    Pacing.MEDIUM: ["melodic", "emotional", "ballad", "background", "documentary"],
    Pacing.FAST: ["fast", "energetic", "action", "sport", "party", "upbeat"],
}

SCENE_TYPE_TO_TAGS: dict[SceneType, list[str]] = {
    SceneType.ACTION: [
        "action",
        "adventure",
        "epic",
        "powerful",
        "fast",
        "energetic",
        "sport",
        "game",
    ],
    SceneType.DIALOGUE: ["background", "soft", "calm", "mellow"],
    SceneType.DESCRIPTION: ["ambiental", "nature", "soundscape", "documentary", "film"],
    SceneType.INTROSPECTION: ["emotional", "deep", "meditative", "melodic", "ballad", "drama"],
    SceneType.TRANSITION: ["film", "trailer", "dramatic", "epic", "motivational"],
}

# ---------------------------------------------------------------------------
# Emotion clusters for hysteresis (Decision 12)
# ---------------------------------------------------------------------------

EMOTION_CLUSTERS: dict[str, set[Emotion]] = {
    "positive": {Emotion.JOY, Emotion.EXCITEMENT, Emotion.PEACE, Emotion.WONDER, Emotion.ROMANCE},
    "dark": {Emotion.TENSION, Emotion.ANGER},
    "melancholic": {Emotion.SORROW},
    "neutral": {Emotion.MYSTERY},
}

EMOTION_TO_CLUSTER: dict[Emotion, str] = {
    e: cluster for cluster, emotions in EMOTION_CLUSTERS.items() for e in emotions
}

SHORT_SCENE_THRESHOLD = 20  # paragraphs

# ---------------------------------------------------------------------------
# Style presets — instrument/genre filter rules (Decisions 21-23)
# Each preset has include/exclude sets drawn from MTG-Jamendo instrument (40)
# and genre (87) tag vocabularies. A track matches if it has at least one
# included tag AND none of the excluded tags. Tracks with no instrument/genre
# tags always fail (available only in "auto" mode).
# ---------------------------------------------------------------------------

STYLE_PRESETS: dict[str, dict[str, set[str]]] = {
    "cinematic": {
        "include": {
            "orchestra",
            "strings",
            "violin",
            "cello",
            "brass",
            "horn",
            "trombone",
            "trumpet",
            "soundtrack",
            "symphonic",
            "orchestral",
        },
        "exclude": {
            "electricguitar",
            "drums",
            "drummachine",
            "hiphop",
            "reggae",
            "rap",
            "punkrock",
            "metal",
            "jazz",
            "easylistening",
            "lounge",
            "pop",
            "indie",
            "folk",
            "blues",
            "chillout",
            "ambient",
            "singersongwriter",
        },
    },
    "piano_only": {
        "include": {"piano", "electricpiano", "keyboard", "rhodes"},
        "exclude": {
            "electricguitar",
            "drums",
            "drummachine",
            "bass",
            "synthesizer",
            "brass",
            "saxophone",
            "strings",
            "violin",
            "cello",
            "flute",
            "oboe",
            "orchestra",
            "harp",
            "trumpet",
            "horn",
            "guitar",
            "acousticguitar",
            "rock",
            "pop",
            "indie",
            "metal",
            "hiphop",
            "electronic",
            "orchestral",
        },
    },
    "ambient": {
        "include": {
            "synthesizer",
            "pad",
            "sampler",
            "ambient",
            "chillout",
            "downtempo",
            "electronic",
            "darkambient",
            "newage",
            "atmospheric",
        },
        "exclude": {
            "drums",
            "drummachine",
            "electricguitar",
            "voice",
            "rap",
            "hiphop",
            "metal",
            "rock",
        },
    },
    "synthwave": {
        "include": {
            "synthesizer",
            "drummachine",
            "electricpiano",
            "electronic",
            "electropop",
            "synthpop",
            "newwave",
            "80s",
            "edm",
        },
        "exclude": {
            "acousticguitar",
            "piano",
            "strings",
            "orchestra",
            "jazz",
            "classical",
            "folk",
            "country",
        },
    },
    "noir_jazz": {
        "include": {
            "saxophone",
            "trumpet",
            "piano",
            "doublebass",
            "jazz",
            "acidjazz",
            "jazzfusion",
            "blues",
            "swing",
            "bossanova",
            "soul",
        },
        "exclude": {
            "electronic",
            "synthesizer",
            "rock",
            "metal",
            "hiphop",
            "edm",
            "techno",
            "trance",
        },
    },
}

VALID_STYLE_NAMES: set[str] = {"auto"} | set(STYLE_PRESETS.keys())


def matches_preset(track: MusicIndexEntry, preset_name: str) -> bool:
    """Check if a track matches a style preset's include/exclude rules.

    Returns True if the track has at least one tag from include AND
    none from exclude. Tracks with no instrument/genre tags always
    fail preset filters (they remain available in "auto" mode).
    """
    if preset_name not in STYLE_PRESETS:
        return False
    rules = STYLE_PRESETS[preset_name]
    track_tags = set(track.instrument_tags) | set(track.genre_tags)

    if not track_tags:
        return False

    has_include = bool(track_tags & rules["include"])
    has_exclude = bool(track_tags & rules["exclude"])

    return has_include and not has_exclude


# ---------------------------------------------------------------------------
# One-hot encoding
# ---------------------------------------------------------------------------


def tags_to_vector(tags: list[str]) -> list[float]:
    """Encode a list of Jamendo mood/theme tags as a one-hot vector."""
    vec = [0.0] * TAG_DIM
    for tag in tags:
        idx = TAG_TO_INDEX.get(tag)
        if idx is not None:
            vec[idx] = 1.0
    return vec


def scene_to_vector(scene: Scene) -> list[float]:
    """Build a tag vector for a scene from its attributes (Decision 16)."""
    active_tags: set[str] = set()

    emotion_tags = EMOTION_TO_TAGS.get(scene.emotion, [])
    active_tags.update(emotion_tags)

    pacing_tags = PACING_TO_TAGS.get(scene.pacing, [])
    active_tags.update(pacing_tags)

    scene_type_tags = SCENE_TYPE_TO_TAGS.get(scene.scene_type, [])
    active_tags.update(scene_type_tags)

    return tags_to_vector(list(active_tags))


# ---------------------------------------------------------------------------
# Track emotion assignment (for curation)
# ---------------------------------------------------------------------------


def assign_emotion_primary(tags: list[str]) -> Emotion | None:
    """Determine the primary emotion for a track based on its tags.

    Scores each emotion by counting how many of the track's tags map to it.
    Returns the emotion with the highest count, or None if no emotion-relevant tags.
    """
    scores: dict[Emotion, int] = {}
    for tag in tags:
        emotion = TAG_TO_EMOTION.get(tag)
        if emotion is not None:
            scores[emotion] = scores.get(emotion, 0) + 1

    if not scores:
        return None

    return max(scores, key=scores.get)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Music index I/O
# ---------------------------------------------------------------------------


def load_music_index(path: Path | None = None) -> list[MusicIndexEntry]:
    """Load the curated music index from JSON."""
    if path is None:
        path = get_settings().music_dir / "music_index.json"
    if not path.exists():
        logger.warning("Music index not found at %s", path)
        return []

    data = json.loads(path.read_text())
    return [MusicIndexEntry.model_validate(entry) for entry in data]


def save_music_index(entries: list[MusicIndexEntry], path: Path | None = None) -> Path:
    """Save the music index to JSON."""
    if path is None:
        path = get_settings().music_dir / "music_index.json"
    path.parent.mkdir(parents=True, exist_ok=True)

    data = [entry.model_dump() for entry in entries]
    path.write_text(json.dumps(data, indent=2))
    logger.info("Saved music index with %d tracks to %s", len(entries), path)
    return path


# ---------------------------------------------------------------------------
# Vectorized cosine similarity (Decision 20)
# ---------------------------------------------------------------------------


def _batch_cosine_scores(scene_vec: np.ndarray, track_matrix: np.ndarray) -> np.ndarray:
    """Vectorized cosine similarity: scene_vec (D,) vs track_matrix (N, D) -> scores (N,)."""
    dot_products = track_matrix @ scene_vec
    scene_norm = float(np.linalg.norm(scene_vec))
    if scene_norm == 0.0:
        return np.zeros(len(track_matrix))
    track_norms = np.linalg.norm(track_matrix, axis=1)
    denominators = track_norms * scene_norm
    safe_denom = np.where(denominators > 0, denominators, 1.0)
    return np.where(denominators > 0, dot_products / safe_denom, 0.0)


def _rank_candidates(
    scene_vec: np.ndarray,
    candidates: list[MusicIndexEntry],
) -> list[tuple[MusicIndexEntry, float]]:
    """Rank candidates by cosine similarity to scene vector (vectorized)."""
    if not candidates:
        return []
    track_matrix = np.array([t.tag_vector for t in candidates])
    scores = _batch_cosine_scores(scene_vec, track_matrix)
    order = np.argsort(scores)[::-1]
    return [(candidates[i], float(scores[i])) for i in order]


# ---------------------------------------------------------------------------
# Scene-to-track matching (Decision 6)
# ---------------------------------------------------------------------------


def _apply_style_filter(
    candidates: list[MusicIndexEntry],
    style: str | None,
) -> list[MusicIndexEntry]:
    """Filter candidates by style preset. Returns unfiltered list if style is None/auto."""
    if not style or style == "auto":
        return candidates
    return [t for t in candidates if matches_preset(t, style)]


@dataclass
class MatchResult:
    """Rich result of matching a scene to a track (Decisions 6, 23).

    ``match_scene_to_track`` reads ``.selected``; the dev view projects the whole
    object. ``ranked`` is the full candidate pool ranked best-first (so the dev view
    can show skipped tracks), while ``selected`` already honours ``exclude_track_ids``
    and the variety rule — exactly the track that will play.
    """

    selected: MusicIndexEntry | None
    score: float
    scene_vector: np.ndarray | None
    ranked: list[tuple[MusicIndexEntry, float]]
    fallback: str
    style_applied: str | None


def _build_candidate_pool(
    scene: Scene,
    index: list[MusicIndexEntry],
    style: str | None,
) -> tuple[list[MusicIndexEntry], str]:
    """Apply the Decision 23 fallback chain. Returns (candidates, fallback_label).

    Fallback chain: emotion + style -> style only (all emotions) -> emotion only (no style).
    """
    styled = bool(style and style != "auto")
    emotion_filtered = [t for t in index if t.emotion_primary == scene.emotion]
    candidates = _apply_style_filter(emotion_filtered, style)
    fallback = "none"

    if not candidates and styled:
        # Fallback 1: style only, ignoring emotion
        candidates = _apply_style_filter(list(index), style)
        fallback = "style_only"
        if candidates:
            logger.info(
                "emotion+style yielded 0 candidates for emotion=%s style=%s, "
                "falling back to style-only (%d candidates)",
                scene.emotion,
                style,
                len(candidates),
            )

    if not candidates:
        # Fallback 2: emotion only, ignoring style
        candidates = emotion_filtered if emotion_filtered else list(index)
        if styled:
            fallback = "emotion_only"
            logger.info(
                "style-only also yielded 0 for style=%s, "
                "falling back to emotion-only (%d candidates)",
                style,
                len(candidates),
            )
        else:
            fallback = "full_index" if not emotion_filtered else "none"

    return candidates, fallback


def _select_with_variety(
    scored: list[tuple[MusicIndexEntry, float]],
    previous_track_id: str | None,
) -> tuple[MusicIndexEntry | None, float]:
    """Pick the top-ranked track, bumping to the runner-up if it equals the previous track."""
    if not scored:
        return None, 0.0
    if previous_track_id and len(scored) > 1 and scored[0][0].track_id == previous_track_id:
        return scored[1]
    return scored[0]


def _match_scene_core(
    scene: Scene,
    index: list[MusicIndexEntry],
    *,
    previous_track_id: str | None = None,
    exclude_track_ids: set[str] | None = None,
    style: str | None = None,
) -> MatchResult:
    """Single source of truth for scene-to-track matching (Decisions 6, 23).

    Three-phase matching: filter by emotion, filter by style, rank by cosine similarity.
    ``exclude_track_ids`` are removed before ranking and the variety rule, so the
    selected track is never an excluded one unless every candidate is excluded.
    """
    exclude = exclude_track_ids or set()
    candidates, fallback = _build_candidate_pool(scene, index, style)

    if not candidates:
        return MatchResult(
            selected=None,
            score=0.0,
            scene_vector=None,
            ranked=[],
            fallback=fallback,
            style_applied=style,
        )

    scene_vec = np.array(scene_to_vector(scene))
    ranked = _rank_candidates(scene_vec, candidates)  # full pool, for the dev view

    if exclude:
        non_excluded = [t for t in candidates if t.track_id not in exclude]
        scored = _rank_candidates(scene_vec, non_excluded) or ranked
    else:
        scored = ranked  # no exclusion: selection ranks the same pool as the dev view

    selected, score = _select_with_variety(scored, previous_track_id)
    return MatchResult(
        selected=selected,
        score=score,
        scene_vector=scene_vec,
        ranked=ranked,
        fallback=fallback,
        style_applied=style,
    )


def match_scene_to_track(
    scene: Scene,
    index: list[MusicIndexEntry],
    *,
    previous_track_id: str | None = None,
    exclude_track_ids: set[str] | None = None,
    style: str | None = None,
) -> MusicIndexEntry | None:
    """Best matching track for a scene, or None if no candidates (Decisions 6, 23).

    Args:
        scene: The scene to match.
        index: Full music index.
        previous_track_id: Track playing in the previous scene (for variety).
        exclude_track_ids: Tracks to skip entirely (e.g., user-skipped tracks).
        style: Style preset name (None or "auto" = no style filtering).
    """
    return _match_scene_core(
        scene,
        index,
        previous_track_id=previous_track_id,
        exclude_track_ids=exclude_track_ids,
        style=style,
    ).selected


def match_scene_to_track_detailed(
    scene: Scene,
    index: list[MusicIndexEntry],
    *,
    previous_track_id: str | None = None,
    exclude_track_ids: set[str] | None = None,
    style: str | None = None,
) -> MatchResult:
    """Dev-view match: same selection as ``match_scene_to_track`` plus the full ranking.

    Returns the ``MatchResult`` directly (the full candidate pool ranked best-first in
    ``.ranked``); the route slices the top N and projects it to the response model.
    """
    return _match_scene_core(
        scene,
        index,
        previous_track_id=previous_track_id,
        exclude_track_ids=exclude_track_ids,
        style=style,
    )


# ---------------------------------------------------------------------------
# Hysteresis (Decision 12)
# ---------------------------------------------------------------------------


def should_crossfade(
    current_scene: Scene,
    next_scene: Scene,
) -> bool:
    """Determine if a music crossfade should occur between two scenes."""
    if current_scene.emotion == next_scene.emotion:
        return False

    current_cluster = EMOTION_TO_CLUSTER[current_scene.emotion]
    next_cluster = EMOTION_TO_CLUSTER[next_scene.emotion]

    if current_cluster != next_cluster:
        return True

    # Same cluster, different emotion: depends on scene length
    scene_length = next_scene.end_paragraph - next_scene.start_paragraph + 1
    return scene_length > SHORT_SCENE_THRESHOLD
