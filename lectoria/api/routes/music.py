"""Music track matching and crossfade endpoints."""

import logging

from fastapi import APIRouter, HTTPException

from lectoria.core.config import get_settings
from lectoria.services.music import (
    EMOTION_TO_CLUSTER,
    STYLE_PRESETS,
    VALID_STYLE_NAMES,
    load_music_index,
    match_scene_to_track,
    match_scene_to_track_detailed,
    should_crossfade,
)
from lectoria.services.pipeline import find_scene, load_ncm

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/track")
async def get_scene_track(
    book_id: str,
    chapter_idx: int,
    scene_idx: int,
    previous_track_id: str | None = None,
    exclude: str | None = None,
    detailed: bool = False,
    style: str | None = None,
) -> dict:
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

    settings = get_settings()
    book_dir = settings.books_dir / book_id
    ncm_path = book_dir / "ncm.json"

    if not ncm_path.exists():
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'")

    ncm = load_ncm(book_dir)

    try:
        _, scene = find_scene(ncm, chapter_idx, scene_idx)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    index = load_music_index()
    if not index:
        raise HTTPException(status_code=503, detail="Music index not available")

    exclude_ids = set(exclude.split(",")) if exclude else set()

    if detailed:
        return match_scene_to_track_detailed(
            scene,
            index,
            previous_track_id=previous_track_id,
            exclude_track_ids=exclude_ids or None,
            style=style,
        )

    track = match_scene_to_track(
        scene,
        index,
        previous_track_id=previous_track_id,
        exclude_track_ids=exclude_ids or None,
        style=style,
    )
    if track is None:
        raise HTTPException(status_code=404, detail="No matching track found")

    numeric_id = str(int(track.track_id.replace("track_", "")))
    local_path = settings.music_dir / track.file_path
    return {
        "track_id": track.track_id,
        "file_path": track.file_path,
        "stream_url": f"https://prod-1.storage.jamendo.com/?trackid={numeric_id}&format=mp32",
        "cached": local_path.exists() and local_path.stat().st_size > 1000,
        "duration_seconds": track.duration_seconds,
        "tags": track.tags,
        "emotion_primary": track.emotion_primary,
    }


@router.get("/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/crossfade")
async def check_crossfade(
    book_id: str,
    chapter_idx: int,
    scene_idx: int,
    prev_chapter_idx: int | None = None,
    prev_scene_idx: int | None = None,
) -> dict:
    """Check whether a crossfade should occur when transitioning to this scene.

    Returns the hysteresis decision based on emotion clusters (Decision 12).
    """
    settings = get_settings()
    book_dir = settings.books_dir / book_id
    ncm_path = book_dir / "ncm.json"

    if not ncm_path.exists():
        raise HTTPException(status_code=404, detail=f"NCM not found for book '{book_id}'")

    ncm = load_ncm(book_dir)

    try:
        _, scene = find_scene(ncm, chapter_idx, scene_idx)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    if prev_chapter_idx is None or prev_scene_idx is None:
        return {"should_crossfade": True, "reason": "no previous scene"}

    prev_chapter = next((ch for ch in ncm.chapters if ch.chapter_index == prev_chapter_idx), None)
    if prev_chapter is None:
        return {"should_crossfade": True, "reason": "previous chapter not found"}
    prev_scene = next((s for s in prev_chapter.scenes if s.scene_index == prev_scene_idx), None)
    if prev_scene is None:
        return {"should_crossfade": True, "reason": "previous scene not found"}

    do_crossfade = should_crossfade(prev_scene, scene)

    return {
        "should_crossfade": do_crossfade,
        "current_emotion": scene.emotion,
        "previous_emotion": prev_scene.emotion,
        "current_cluster": EMOTION_TO_CLUSTER[scene.emotion],
        "previous_cluster": EMOTION_TO_CLUSTER[prev_scene.emotion],
    }


PRESET_DESCRIPTIONS: dict[str, str] = {
    "auto": "No style filter - uses the full library (default)",
    "cinematic": "Orchestral, strings, brass - film scores and epic soundtracks",
    "piano_only": "Solo piano and keyboard - intimate and minimal",
    "ambient": "Synthesizers, pads, atmospheric textures - no vocals or drums",
    "synthwave": "Electronic, retro synths, 80s vibes - sci-fi and neon",
    "noir_jazz": "Jazz, saxophone, blues - smoky and dark",
}


@router.get("/music/presets")
async def list_presets() -> list[dict]:
    """Return available music style presets with descriptions."""
    return [
        {"name": name, "description": PRESET_DESCRIPTIONS.get(name, "")}
        for name in ["auto", *STYLE_PRESETS.keys()]
    ]
