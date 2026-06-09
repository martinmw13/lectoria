"""Music track matching and crossfade endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lectoria.api.deps import (
    find_scene_or_404,
    get_book_store,
    get_current_scene_or_404,
    load_ncm_or_404,
)
from lectoria.core.config import get_settings
from lectoria.models.ncm import NCM, Emotion, Scene
from lectoria.services.bookstore import BookStore
from lectoria.services.music import (
    EMOTION_TO_CLUSTER,
    STYLE_PRESETS,
    VALID_STYLE_NAMES,
    MatchResult,
    load_music_index,
    match_scene_to_track,
    match_scene_to_track_detailed,
    should_crossfade,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class SceneTrackResponse(BaseModel):
    track_id: str
    file_path: str
    stream_url: str
    cached: bool
    duration_seconds: float
    tags: list[str]
    emotion_primary: Emotion


class SceneTrackCandidate(BaseModel):
    track_id: str
    tags: list[str]
    score: float


class DetailedSceneTrackResponse(BaseModel):
    """Dev-view projection (``detailed=True``). ``scene_vector`` is omitted when
    there is no candidate pool, preserving the historical no-vector shape."""

    selected_track: str | None
    score: float
    fallback: str
    style_applied: str | None
    candidates: list[SceneTrackCandidate]
    scene_vector: list[float] | None = None


class CrossfadeResponse(BaseModel):
    """``reason`` is set only on the short-circuit paths; the emotion/cluster
    fields are set only when both scenes are present (mutually exclusive)."""

    should_crossfade: bool
    reason: str | None = None
    current_emotion: Emotion | None = None
    previous_emotion: Emotion | None = None
    current_cluster: str | None = None
    previous_cluster: str | None = None


class MusicPreset(BaseModel):
    name: str
    description: str


DETAILED_CANDIDATE_LIMIT = 5

# Jamendo stream URL template; ``track_id`` is the numeric Jamendo track id.
JAMENDO_STREAM_URL_TEMPLATE = "https://prod-1.storage.jamendo.com/?trackid={track_id}&format=mp32"
# Prefix on internal track ids (e.g. ``track_123``) stripped to recover the numeric id.
TRACK_ID_PREFIX = "track_"
# A local file smaller than this (bytes) is treated as a stub/placeholder, not a real cache hit.
CACHED_MIN_BYTES = 1000


def _project_detailed(result: MatchResult, top_n: int) -> DetailedSceneTrackResponse:
    """Project a ``MatchResult`` into the dev-view response, slicing the top ``top_n``
    ranked candidates.

    ``selected`` and ``scene_vector`` are both ``None`` exactly when there is no candidate
    pool; branching on that disjunction narrows both for the type checker (no ``type:
    ignore`` needed) and lets the no-pool case leave ``scene_vector`` unset so
    ``response_model_exclude_unset`` omits it — preserving the historical no-vector shape
    rather than emitting ``"scene_vector": null``.
    """
    candidates = [
        SceneTrackCandidate(track_id=t.track_id, tags=t.tags, score=s)
        for t, s in result.ranked[:top_n]
    ]
    selected = result.selected
    scene_vector = result.scene_vector
    if selected is None or scene_vector is None:
        return DetailedSceneTrackResponse(
            selected_track=None,
            score=0.0,
            fallback=result.fallback,
            style_applied=result.style_applied,
            candidates=candidates,
        )
    return DetailedSceneTrackResponse(
        selected_track=selected.track_id,
        score=result.score,
        fallback=result.fallback,
        style_applied=result.style_applied,
        candidates=candidates,
        scene_vector=scene_vector.tolist(),
    )


@router.get(
    "/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/track",
    response_model_exclude_unset=True,
)
async def get_scene_track(
    book_id: str,
    chapter_idx: int,
    scene_idx: int,
    store: Annotated[BookStore, Depends(get_book_store)],
    previous_track_id: str | None = None,
    exclude: str | None = None,
    detailed: bool = False,
    style: str | None = None,
) -> SceneTrackResponse | DetailedSceneTrackResponse:
    """Get the matched music track for a scene.

    Args:
        book_id: Book identifier.
        chapter_idx: Chapter index (matches NCM chapter_index).
        scene_idx: Scene index within the chapter.
        previous_track_id: Track currently playing (for variety rule).
        exclude: Comma-separated track IDs to skip (user-skipped tracks).
        detailed: If true, include dev metadata (candidates, scores, vectors).
        style: Style preset name (auto, cinematic, piano_only, ambient, synthwave, noir_jazz).
    """
    if style and style not in VALID_STYLE_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid style '{style}'. Valid options: {sorted(VALID_STYLE_NAMES)}",
        )

    # ``style`` is validated above before the NCM is touched: an invalid style
    # (400) must take precedence over a missing book (404), so the load stays
    # inline here rather than in a pre-handler dependency (which would run first
    # and invert that order).
    ncm = load_ncm_or_404(book_id, store)
    scene = find_scene_or_404(ncm, chapter_idx, scene_idx)

    index = load_music_index()
    if not index:
        raise HTTPException(status_code=503, detail="Music index not available")

    exclude_ids = set(exclude.split(",")) if exclude else set()

    if detailed:
        result = match_scene_to_track_detailed(
            scene,
            index,
            previous_track_id=previous_track_id,
            exclude_track_ids=exclude_ids or None,
            style=style,
        )
        return _project_detailed(result, top_n=DETAILED_CANDIDATE_LIMIT)

    track = match_scene_to_track(
        scene,
        index,
        previous_track_id=previous_track_id,
        exclude_track_ids=exclude_ids or None,
        style=style,
    )
    if track is None:
        raise HTTPException(status_code=404, detail="No matching track found")

    settings = get_settings()
    numeric_id = str(int(track.track_id.replace(TRACK_ID_PREFIX, "")))
    local_path = settings.music_dir / track.file_path
    return SceneTrackResponse(
        track_id=track.track_id,
        file_path=track.file_path,
        stream_url=JAMENDO_STREAM_URL_TEMPLATE.format(track_id=numeric_id),
        cached=local_path.exists() and local_path.stat().st_size > CACHED_MIN_BYTES,
        duration_seconds=track.duration_seconds,
        tags=track.tags,
        emotion_primary=track.emotion_primary,
    )


@router.get(
    "/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/crossfade",
    response_model_exclude_unset=True,
)
async def check_crossfade(
    ncm: Annotated[NCM, Depends(load_ncm_or_404)],
    scene: Annotated[Scene, Depends(get_current_scene_or_404)],
    prev_chapter_idx: int | None = None,
    prev_scene_idx: int | None = None,
) -> CrossfadeResponse:
    """Check whether a crossfade should occur when transitioning to this scene.

    Returns the hysteresis decision based on emotion clusters (Decision 12). The
    current scene is resolved via dependencies (book_id/chapter_idx/scene_idx are
    declared inside them and FastAPI caches the single NCM load); the previous
    scene stays a lenient in-body lookup.
    """
    if prev_chapter_idx is None or prev_scene_idx is None:
        return CrossfadeResponse(should_crossfade=True, reason="no previous scene")

    # Lenient previous-scene lookup: a missing chapter or scene never 404s — we
    # default to crossfading rather than blocking the transition.
    prev_scene = ncm.get_scene(prev_chapter_idx, prev_scene_idx)
    if prev_scene is None:
        return CrossfadeResponse(should_crossfade=True, reason="previous scene not found")

    do_crossfade = should_crossfade(prev_scene, scene)

    return CrossfadeResponse(
        should_crossfade=do_crossfade,
        current_emotion=scene.emotion,
        previous_emotion=prev_scene.emotion,
        current_cluster=EMOTION_TO_CLUSTER[scene.emotion],
        previous_cluster=EMOTION_TO_CLUSTER[prev_scene.emotion],
    )


PRESET_DESCRIPTIONS: dict[str, str] = {
    "auto": "No style filter - uses the full library (default)",
    "cinematic": "Orchestral, strings, brass - film scores and epic soundtracks",
    "piano_only": "Solo piano and keyboard - intimate and minimal",
    "ambient": "Synthesizers, pads, atmospheric textures - no vocals or drums",
    "synthwave": "Electronic, retro synths, 80s vibes - sci-fi and neon",
    "noir_jazz": "Jazz, saxophone, blues - smoky and dark",
}


@router.get("/music/presets")
async def list_presets() -> list[MusicPreset]:
    """Return available music style presets with descriptions."""
    return [
        MusicPreset(name=name, description=PRESET_DESCRIPTIONS.get(name, ""))
        for name in ["auto", *STYLE_PRESETS.keys()]
    ]
