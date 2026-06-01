"""Image generation service — automatic and on-demand (Decisions 5, 8, 9).

Automatic: generate images from NCM image_prompts and cover_descriptions.
On-demand: generate from user-selected text with character description injection.
"""

import logging
import re
from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel

from lectoria.models.ncm import BookMap, Character, ChapterAnalysis, NCM, Scene
from lectoria.providers.base import ImageProvider
from lectoria.services.bookstore import BookStore

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Automatic image generation (Decision 5)
# ---------------------------------------------------------------------------


class ImageGenerationStats(BaseModel):
    """Summary counts returned by :func:`generate_all_images`."""

    covers_generated: int = 0
    scenes_generated: int = 0
    failed: int = 0
    skipped: int = 0


def _load_character_ref(store: BookStore, book_id: str, character_id: str) -> bytes | None:
    """Load a single character reference image on demand."""
    path = store.character_image_path(book_id, character_id)
    if path.exists():
        return path.read_bytes()
    return None


async def generate_scene_image(
    provider: ImageProvider,
    store: BookStore,
    book_id: str,
    scene: Scene,
    chapter_index: int,
) -> Path | None:
    """Generate an image for a scene using its image_prompt.

    Character reference images are loaded lazily from disk when needed.

    Returns:
        Path to saved image, or None if generation failed.
    """
    if not scene.image_prompt:
        logger.debug("No image_prompt for scene %d, skipping", scene.scene_index)
        return None

    out_path = store.scene_image_path(book_id, chapter_index, scene.scene_index)
    if out_path.exists():
        logger.debug("Scene image already exists: %s", out_path)
        return out_path

    reference = None
    if provider.supports_reference_image() and scene.characters_present:
        reference = _load_character_ref(store, book_id, scene.characters_present[0])

    try:
        image_bytes = await provider.generate(
            scene.image_prompt,
            reference_image=reference,
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(image_bytes)
        logger.info("Generated scene image: %s", out_path)
        return out_path
    except Exception as e:
        logger.error(
            "Failed to generate scene image ch%d/sc%d: %s", chapter_index, scene.scene_index, e
        )
        return None


async def generate_cover_image(
    provider: ImageProvider,
    store: BookStore,
    book_id: str,
    chapter: ChapterAnalysis,
) -> Path | None:
    """Generate a chapter cover image from cover_description."""
    if not chapter.cover_description:
        return None

    out_path = store.cover_image_path(book_id, chapter.chapter_index)
    if out_path.exists():
        return out_path

    try:
        image_bytes = await provider.generate(chapter.cover_description)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(image_bytes)
        logger.info("Generated cover image: %s", out_path)
        return out_path
    except Exception as e:
        logger.error("Failed to generate cover for ch%d: %s", chapter.chapter_index, e)
        return None


async def generate_all_images(
    provider: ImageProvider,
    store: BookStore,
    book_id: str,
    ncm: NCM,
    *,
    scenes: bool = True,
    covers: bool = True,
    on_progress: Callable[[str, str], None] | None = None,
) -> ImageGenerationStats:
    """Generate all automatic images for a book.

    Returns summary counts of generated/skipped/failed.
    """
    stats = ImageGenerationStats()

    for chapter in ncm.chapters:
        if covers:
            result = await generate_cover_image(provider, store, book_id, chapter)
            if result:
                stats.covers_generated += 1

        if scenes:
            for scene in chapter.scenes:
                result = await generate_scene_image(
                    provider,
                    store,
                    book_id,
                    scene,
                    chapter.chapter_index,
                )
                if result:
                    stats.scenes_generated += 1
                elif scene.image_prompt:
                    stats.failed += 1
                else:
                    stats.skipped += 1

        if on_progress:
            on_progress(
                "images",
                f"Chapter {chapter.chapter_index}: {stats.scenes_generated} scenes, "
                f"{stats.covers_generated} covers",
            )

    logger.info("Image generation complete: %s", stats)
    return stats


# ---------------------------------------------------------------------------
# On-demand image generation (Decisions 8, 9)
# ---------------------------------------------------------------------------

_POSSESSIVE_RE = re.compile(r"'s\b", re.IGNORECASE)


def identify_characters(
    text: str,
    characters: list[Character],
    scene_characters: list[str] | None = None,
) -> list[Character]:
    """Identify characters mentioned in text via string matching (Decision 9).

    Primary: match character names and aliases against the text.
    Fallback: use scene.characters_present when no name matches.
    """
    normalized_text = _POSSESSIVE_RE.sub("", text).lower()
    matched: list[Character] = []

    for char in characters:
        names_to_check = [char.name] + char.aliases
        for name in names_to_check:
            if name.lower() in normalized_text:
                matched.append(char)
                break

    if not matched and scene_characters:
        char_map = {c.id: c for c in characters}
        for cid in scene_characters:
            if cid in char_map:
                matched.append(char_map[cid])

    return matched


def build_on_demand_prompt(
    selected_text: str,
    characters: list[Character],
    scene: Scene | None = None,
    *,
    identified: list[Character] | None = None,
) -> str:
    """Build an image prompt from user-selected text + character descriptions.

    Injects physical descriptions of identified characters. Callers that already
    ran :func:`identify_characters` can pass ``identified`` to avoid recomputing it;
    when omitted it is computed from ``selected_text``/``characters``/``scene``.
    """
    if identified is None:
        scene_chars = scene.characters_present if scene else None
        identified = identify_characters(selected_text, characters, scene_chars)

    parts = [selected_text]

    if identified:
        char_descs = []
        for c in identified:
            if c.physical_description:
                char_descs.append(f"{c.name}: {c.physical_description}")
        if char_descs:
            parts.append("\n\nCharacter appearances:\n" + "\n".join(char_descs))

    return "\n".join(parts)


async def generate_on_demand(
    provider: ImageProvider,
    store: BookStore,
    book_id: str,
    selected_text: str,
    book_map: BookMap,
    *,
    scene: Scene | None = None,
    chapter_index: int | None = None,
) -> bytes:
    """Generate an image from user-selected text (Decision 5 -- raw text, no LLM rewriting).

    Character descriptions are injected. If character memory exists and the provider
    supports reference images, the first identified character's reference is passed.
    The generated image is cached to disk per scene so it persists across sessions.
    """
    scene_chars = scene.characters_present if scene else None
    identified = identify_characters(selected_text, book_map.characters, scene_chars)
    prompt = build_on_demand_prompt(
        selected_text, book_map.characters, scene, identified=identified
    )

    reference = None
    if provider.supports_reference_image() and identified:
        ref_path = store.character_image_path(book_id, identified[0].id)
        if ref_path.exists():
            reference = ref_path.read_bytes()
            logger.info("Using character reference for %s", identified[0].name)

    image_bytes = await provider.generate(prompt, reference_image=reference)

    # Store as character memory if a single character was identified (Decision 8)
    if len(identified) == 1:
        char_path = store.character_image_path(book_id, identified[0].id)
        if not char_path.exists():
            char_path.parent.mkdir(parents=True, exist_ok=True)
            char_path.write_bytes(image_bytes)
            logger.info("Stored character memory: %s -> %s", identified[0].name, char_path)

    # Cache to disk so it survives navigation and app restarts
    if chapter_index is not None and scene is not None:
        cache_path = store.on_demand_image_path(book_id, chapter_index, scene.scene_index)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(image_bytes)
        logger.info("Cached on-demand image: %s", cache_path)

    return image_bytes
