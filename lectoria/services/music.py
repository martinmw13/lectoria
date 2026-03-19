"""Music matching service — tag-based scene-to-track matching (Decisions 6, 12, 16).

Contains:
- Jamendo mood/theme tag vocabulary and mappings
- Scene attribute → tag vector encoding
- Track index loading and scene-to-track matching
- Hysteresis logic for music transitions
"""

import json
import logging
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


def match_scene_to_track(
    scene: Scene,
    index: list[MusicIndexEntry],
    *,
    previous_track_id: str | None = None,
    exclude_track_ids: set[str] | None = None,
) -> MusicIndexEntry | None:
    """Two-phase matching: filter by emotion, rank by cosine similarity.

    Args:
        scene: The scene to match.
        index: Full music index.
        previous_track_id: Track playing in the previous scene (for variety).
        exclude_track_ids: Tracks to skip entirely (e.g., user-skipped tracks).

    Returns:
        Best matching track, or None if no candidates.
    """
    exclude = exclude_track_ids or set()

    candidates = [t for t in index if t.emotion_primary == scene.emotion]

    if not candidates:
        logger.warning("No tracks for emotion=%s, falling back to full index", scene.emotion)
        candidates = list(index)

    if not candidates:
        return None

    scene_vec = np.array(scene_to_vector(scene))
    non_excluded = [t for t in candidates if t.track_id not in exclude]
    scored = _rank_candidates(scene_vec, non_excluded)

    if not scored:
        scored = _rank_candidates(scene_vec, candidates)

    if previous_track_id and len(scored) > 1:
        if scored[0][0].track_id == previous_track_id:
            return scored[1][0]

    return scored[0][0] if scored else None


def match_scene_to_track_detailed(
    scene: Scene,
    index: list[MusicIndexEntry],
    *,
    previous_track_id: str | None = None,
    top_n: int = 5,
) -> dict:
    """Like match_scene_to_track but returns detailed matching info for dev view.

    Returns dict with: selected_track, score, scene_vector, candidates (top N with scores).
    """
    candidates = [t for t in index if t.emotion_primary == scene.emotion]
    fell_back = False
    if not candidates:
        candidates = list(index)
        fell_back = True

    if not candidates:
        return {"selected_track": None, "score": 0.0, "candidates": [], "fell_back": fell_back}

    scene_vec = np.array(scene_to_vector(scene))
    scored = _rank_candidates(scene_vec, candidates)

    candidate_dicts = [{"track_id": t.track_id, "tags": t.tags, "score": s} for t, s in scored]

    selected_idx = 0
    if (
        previous_track_id
        and len(candidate_dicts) > 1
        and candidate_dicts[0]["track_id"] == previous_track_id
    ):
        selected_idx = 1

    return {
        "selected_track": candidate_dicts[selected_idx]["track_id"],
        "score": candidate_dicts[selected_idx]["score"],
        "scene_vector": scene_vec.tolist(),
        "fell_back_to_full_index": fell_back,
        "candidates": candidate_dicts[:top_n],
    }


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
