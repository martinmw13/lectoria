"""Narrative analysis service — two-stage LLM pipeline (Decisions 1-5).

LLM 1: full book → BookMap (characters, setting, genre, chapter summaries)
LLM 2: per-chapter with BookMap context → ChapterAnalysis (scenes with attributes)
"""

import json
import logging
import re
from dataclasses import dataclass

from pydantic import ValidationError

from lectoria.models.ncm import (
    BookMap,
    Chapter,
    ChapterAnalysis,
    ChaptersData,
    Emotion,
    Pacing,
    SceneType,
    TransitionType,
)
from lectoria.providers.base import LLMProvider

logger = logging.getLogger(__name__)

MAX_RETRIES = 3

# ---------------------------------------------------------------------------
# JSON extraction helper
# ---------------------------------------------------------------------------

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*\n(.*?)\n\s*```", re.DOTALL)

# Maps LLM-invented values to valid enum members.
# Keys are lowercased. If a value isn't in the map, it's left as-is for Pydantic to reject.
_EMOTION_COERCE: dict[str, str] = {
    "frustration": Emotion.ANGER,
    "fear": Emotion.TENSION,
    "anxiety": Emotion.TENSION,
    "worry": Emotion.TENSION,
    "suspense": Emotion.TENSION,
    "dread": Emotion.TENSION,
    "horror": Emotion.TENSION,
    "hope": Emotion.WONDER,
    "awe": Emotion.WONDER,
    "curiosity": Emotion.WONDER,
    "surprise": Emotion.EXCITEMENT,
    "anticipation": Emotion.EXCITEMENT,
    "thrill": Emotion.EXCITEMENT,
    "contemplation": Emotion.PEACE,
    "calm": Emotion.PEACE,
    "serenity": Emotion.PEACE,
    "melancholy": Emotion.SORROW,
    "grief": Emotion.SORROW,
    "sadness": Emotion.SORROW,
    "nostalgia": Emotion.SORROW,
    "love": Emotion.ROMANCE,
    "affection": Emotion.ROMANCE,
    "tenderness": Emotion.ROMANCE,
    "happiness": Emotion.JOY,
    "humor": Emotion.JOY,
    "amusement": Emotion.JOY,
    "delight": Emotion.JOY,
    "relief": Emotion.JOY,
    "resolution": Emotion.PEACE,
    "determination": Emotion.EXCITEMENT,
    "introspection": Emotion.PEACE,
    "confusion": Emotion.MYSTERY,
    "unease": Emotion.TENSION,
    "despair": Emotion.SORROW,
    "rage": Emotion.ANGER,
    "fury": Emotion.ANGER,
}

_SCENE_TYPE_COERCE: dict[str, str] = {
    "flashback": SceneType.TRANSITION,
    "narrative": SceneType.DESCRIPTION,
    "exposition": SceneType.DESCRIPTION,
    "monologue": SceneType.INTROSPECTION,
    "reflection": SceneType.INTROSPECTION,
    "combat": SceneType.ACTION,
    "fight": SceneType.ACTION,
    "chase": SceneType.ACTION,
    "conversation": SceneType.DIALOGUE,
}

_TRANSITION_COERCE: dict[str, str] = {
    "emotional_shift": TransitionType.NONE,
    "scene_change": TransitionType.LOCATION_CHANGE,
    "perspective_change": TransitionType.POV_CHANGE,
    "perspective_shift": TransitionType.POV_CHANGE,
    "cut": TransitionType.NONE,
    "continuation": TransitionType.NONE,
}

_PACING_COERCE: dict[str, str] = {
    "very_slow": Pacing.SLOW,
    "very_fast": Pacing.FAST,
    "moderate": Pacing.MEDIUM,
    "steady": Pacing.MEDIUM,
}

_VALID_EMOTIONS = {e.value for e in Emotion}
_VALID_SCENE_TYPES = {s.value for s in SceneType}
_VALID_TRANSITIONS = {t.value for t in TransitionType}
_VALID_PACINGS = {p.value for p in Pacing}


def _coerce_scene_enums(data: dict) -> dict:
    """Map LLM-invented enum values to valid ones before Pydantic validation.

    When a value is coerced, the original is preserved in raw_<field> for dev inspection.
    """
    for scene in data.get("scenes", []):
        emotion = str(scene.get("emotion", "")).lower().strip()
        if emotion and emotion not in _VALID_EMOTIONS:
            coerced = _EMOTION_COERCE.get(emotion)
            if coerced:
                logger.info("Coerced emotion '%s' -> '%s'", emotion, coerced)
                scene["raw_emotion"] = emotion
                scene["emotion"] = coerced

        scene_type = str(scene.get("scene_type", "")).lower().strip()
        if scene_type and scene_type not in _VALID_SCENE_TYPES:
            coerced = _SCENE_TYPE_COERCE.get(scene_type)
            if coerced:
                logger.info("Coerced scene_type '%s' -> '%s'", scene_type, coerced)
                scene["raw_scene_type"] = scene_type
                scene["scene_type"] = coerced

        transition = str(scene.get("transition_type", "")).lower().strip()
        if transition and transition not in _VALID_TRANSITIONS:
            coerced = _TRANSITION_COERCE.get(transition)
            if coerced:
                logger.info("Coerced transition_type '%s' -> '%s'", transition, coerced)
                scene["raw_transition_type"] = transition
                scene["transition_type"] = coerced

        pacing = str(scene.get("pacing", "")).lower().strip()
        if pacing and pacing not in _VALID_PACINGS:
            coerced = _PACING_COERCE.get(pacing)
            if coerced:
                logger.info("Coerced pacing '%s' -> '%s'", pacing, coerced)
                scene["raw_pacing"] = pacing
                scene["pacing"] = coerced

    return data


def _extract_json(text: str) -> str:
    """Extract JSON from LLM response, handling markdown code blocks."""
    match = _JSON_BLOCK_RE.search(text)
    if match:
        return match.group(1).strip()
    # Try the raw text — maybe the LLM returned plain JSON
    text = text.strip()
    if text.startswith("{"):
        return text
    raise ValueError(f"No JSON found in LLM response (first 200 chars): {text[:200]}")


# ---------------------------------------------------------------------------
# LLM 1 — Book-level analysis
# ---------------------------------------------------------------------------

_LLM1_SYSTEM = """\
You are a literary analyst. You analyze novels and produce structured JSON output.
You must respond ONLY with valid JSON, no commentary before or after.
"""

_LLM1_PROMPT_TEMPLATE = """\
Analyze the following novel and produce a JSON object with this exact structure:

{{
  "title": "book title",
  "genre": "primary genre/subgenre (e.g., 'fantasy', 'literary fiction', 'science fiction')",
  "setting": {{
    "time_period": "when the story takes place",
    "world": "the world or universe (e.g., 'modern-day London', 'Middle-earth')",
    "description": "brief description of the overall setting"
  }},
  "characters": [
    {{
      "id": "lowercase-slug-from-name",
      "name": "Character Full Name",
      "aliases": ["nickname", "title", "other names they are called"],
      "physical_description": "detailed physical appearance for image generation",
      "role": "protagonist | antagonist | secondary | minor",
      "relationships": [
        {{"target_id": "other-character-slug", "type": "relationship description"}}
      ]
    }}
  ],
  "chapters": [
    {{
      "chapter_index": 1,
      "title": "chapter title if known",
      "summary": "2-3 sentence summary of what happens in this chapter"
    }}
  ]
}}

Rules:
- Include ALL named characters who appear more than once. For minor characters who appear once, include them only if they are plot-relevant.
- The "id" field must be a lowercase slug derived from the character's primary name (e.g., "harry-potter", "lord-voldemort").
- "aliases" must include ALL names, titles, nicknames, and forms of address used for this character (e.g., for Harry Potter: ["Harry", "Potter", "The Boy Who Lived", "the Chosen One"]).
- "physical_description" should be detailed enough for an AI image generator to depict the character. Include hair color, eye color, build, distinctive features, typical clothing.
- "role" must be exactly one of: protagonist, antagonist, secondary, minor.
- "chapters" should match the chapter structure in the text. Number them sequentially starting from 1.
- Respond with ONLY the JSON object. No markdown, no explanation.

=== FULL BOOK TEXT ===

{book_text}
"""


@dataclass
class TokenUsage:
    """Accumulated token counts from one or more LLM calls."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, prompt: int | None, completion: int | None) -> None:
        self.calls += 1
        self.prompt_tokens += prompt or 0
        self.completion_tokens += completion or 0


async def analyze_book(
    provider: LLMProvider,
    chapters_data: ChaptersData,
) -> tuple[BookMap, TokenUsage]:
    """Run LLM 1: analyze the full book and produce a BookMap.

    Returns:
        Tuple of (BookMap, TokenUsage) with cumulative token counts.

    Raises:
        RuntimeError: If all retries fail.
    """
    usage = TokenUsage()
    book_text = _format_book_text(chapters_data)

    token_estimate = len(book_text) // 4  # rough estimate
    max_tokens = provider.max_context_tokens()
    if token_estimate > max_tokens * 0.9:
        logger.warning(
            "Book text (~%d tokens) may exceed provider context window (%d tokens)",
            token_estimate,
            max_tokens,
        )

    prompt = _LLM1_PROMPT_TEMPLATE.format(book_text=book_text)

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("LLM 1 attempt %d/%d", attempt, MAX_RETRIES)
            result = await provider.complete(prompt, system=_LLM1_SYSTEM)
            usage.add(result.prompt_tokens, result.completion_tokens)
            json_str = _extract_json(result.text)
            data = json.loads(json_str)
            book_map = BookMap.model_validate(data)
            logger.info(
                "LLM 1 success: %d characters, %d chapter summaries "
                "(tokens: prompt=%d, completion=%d)",
                len(book_map.characters),
                len(book_map.chapters),
                usage.prompt_tokens,
                usage.completion_tokens,
            )
            return book_map, usage

        except (json.JSONDecodeError, ValidationError, ValueError, RuntimeError) as e:
            last_error = e
            logger.warning("LLM 1 attempt %d failed: %s", attempt, e)

    raise RuntimeError(f"LLM 1 failed after {MAX_RETRIES} attempts. Last error: {last_error}")


def _format_book_text(chapters_data: ChaptersData) -> str:
    """Format all narrative chapters into a single text block for LLM 1."""
    parts: list[str] = []
    for chapter in chapters_data.chapters:
        if not chapter.is_narrative:
            continue
        header = f"--- Chapter {chapter.chapter_index}"
        if chapter.title:
            header += f": {chapter.title}"
        header += " ---"
        parts.append(header)
        for para in chapter.paragraphs:
            parts.append(para.text)
        parts.append("")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM 2 — Scene-level analysis (per chapter)
# ---------------------------------------------------------------------------

_LLM2_SYSTEM = """\
You are a narrative scene analyst. You segment book chapters into scenes and annotate them.
You must respond ONLY with valid JSON, no commentary before or after.
"""

_LLM2_PROMPT_TEMPLATE = """\
You are analyzing Chapter {chapter_index}{chapter_title_suffix} of the novel "{book_title}".

=== BOOK CONTEXT (from prior analysis) ===

Genre: {genre}
Setting: {setting_description}
Characters: {characters_summary}

=== CHAPTER TEXT (paragraphs are numbered) ===

{numbered_paragraphs}

=== TASK ===

Segment this chapter into SCENES. A scene is a continuous narrative unit with consistent \
emotional tone, setting, and set of characters. Scene boundaries occur at:
- Location changes
- Time jumps
- Point-of-view changes
- Major emotional shifts
- Flashbacks or returns from flashbacks

Produce a JSON object with this exact structure:

{{
  "chapter_index": {chapter_index},
  "cover_description": "A visual description for a chapter cover image. Describe the most \
iconic or representative moment/setting of this chapter, suitable for an AI image generator.",
  "scenes": [
    {{
      "scene_index": 1,
      "title": "short descriptive label (3-6 words)",
      "start_paragraph": <first paragraph number in this scene>,
      "end_paragraph": <last paragraph number in this scene>,
      "characters_present": ["character-id-slug", ...],
      "emotion": "<one of: joy, sorrow, tension, anger, peace, romance, mystery, excitement, wonder>",
      "pacing": "<one of: slow, medium, fast>",
      "scene_type": "<one of: action, dialogue, description, introspection, transition>",
      "setting": {{
        "location": "where this scene takes place",
        "time_of_day": "morning, afternoon, evening, night, or unknown",
        "weather": "weather if mentioned or implied, otherwise empty string"
      }},
      "image_prompt": "A detailed visual description of this scene for an AI image generator. \
Include character appearances, setting details, lighting, mood. Must be self-contained \
(do not reference other scenes).",
      "transition_type": "<one of: none, time_jump, pov_change, flashback, location_change>",
      "key_phrases": ["notable phrases from the text that are visually evocative"],
      "key_objects": ["narratively important objects in this scene"]
    }}
  ]
}}

STRICT ENUM CONSTRAINTS — use ONLY these exact string values:
- "emotion" MUST be one of: joy | sorrow | tension | anger | peace | romance | mystery | excitement | wonder
- "pacing" MUST be one of: slow | medium | fast
- "scene_type" MUST be one of: action | dialogue | description | introspection | transition
- "transition_type" MUST be one of: none | time_jump | pov_change | flashback | location_change
Do NOT invent new values. Map nuanced emotions to the closest allowed value (e.g. worry->tension, hope->wonder, contemplation->peace).

Rules:
- Scenes MUST cover ALL paragraphs from 1 to {max_paragraph} with NO gaps and NO overlaps.
- Every paragraph belongs to exactly one scene.
- "characters_present" must use the character ID slugs from the book context above.
- "image_prompt" should be detailed enough for a standalone image. Include physical \
descriptions of characters (use the book context), setting details, and mood.
- Prefer fewer, larger scenes over many tiny ones. A typical chapter has 3-8 scenes.
- Respond with ONLY the JSON object. No markdown, no explanation.
"""


async def analyze_chapter(
    provider: LLMProvider,
    chapter: Chapter,
    book_map: BookMap,
) -> tuple[ChapterAnalysis, TokenUsage]:
    """Run LLM 2: analyze a single chapter and produce scene segmentation.

    Returns:
        Tuple of (ChapterAnalysis, TokenUsage) with per-chapter token counts.

    Raises:
        RuntimeError: If all retries fail.
    """
    usage = TokenUsage()
    if not chapter.paragraphs:
        return ChapterAnalysis(chapter_index=chapter.chapter_index, scenes=[]), usage

    prompt = _format_llm2_prompt(chapter, book_map)
    model_name = getattr(provider, "model", "unknown")

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(
                "LLM 2 chapter %d attempt %d/%d",
                chapter.chapter_index,
                attempt,
                MAX_RETRIES,
            )
            result = await provider.complete(prompt, system=_LLM2_SYSTEM)
            usage.add(result.prompt_tokens, result.completion_tokens)
            json_str = _extract_json(result.text)
            data = json.loads(json_str)
            _coerce_scene_enums(data)
            analysis = ChapterAnalysis.model_validate(data)
            analysis.llm_model = str(model_name)
            analysis.attempt_count = attempt
            logger.info(
                "LLM 2 chapter %d success: %d scenes (attempt %d, tokens: prompt=%d, completion=%d)",
                chapter.chapter_index,
                len(analysis.scenes),
                attempt,
                usage.prompt_tokens,
                usage.completion_tokens,
            )
            return analysis, usage

        except (json.JSONDecodeError, ValidationError, ValueError, RuntimeError) as e:
            last_error = e
            logger.warning(
                "LLM 2 chapter %d attempt %d failed: %s",
                chapter.chapter_index,
                attempt,
                e,
            )

    logger.error(
        "LLM 2 chapter %d failed after %d attempts, using fallback. Last error: %s",
        chapter.chapter_index,
        MAX_RETRIES,
        last_error,
    )
    fallback = _fallback_chapter_analysis(chapter)
    fallback.llm_model = str(model_name)
    fallback.attempt_count = MAX_RETRIES
    fallback.is_fallback = True
    return fallback, usage


def _format_llm2_prompt(chapter: Chapter, book_map: BookMap) -> str:
    """Build the LLM 2 prompt for a single chapter."""
    # Characters summary for context
    chars_lines = []
    for c in book_map.characters:
        aliases = f" (aliases: {', '.join(c.aliases)})" if c.aliases else ""
        desc = f" — {c.physical_description}" if c.physical_description else ""
        chars_lines.append(f"- {c.name} [id: {c.id}]{aliases}{desc}")
    characters_summary = "\n".join(chars_lines) if chars_lines else "(no characters identified)"

    # Numbered paragraphs
    para_lines = [f"[{p.index}] {p.text}" for p in chapter.paragraphs]
    numbered_paragraphs = "\n\n".join(para_lines)

    max_paragraph = chapter.paragraphs[-1].index if chapter.paragraphs else 0

    title_suffix = f": {chapter.title}" if chapter.title else ""

    return _LLM2_PROMPT_TEMPLATE.format(
        chapter_index=chapter.chapter_index,
        chapter_title_suffix=title_suffix,
        book_title=book_map.title,
        genre=book_map.genre,
        setting_description=book_map.setting.description or "Not specified",
        characters_summary=characters_summary,
        numbered_paragraphs=numbered_paragraphs,
        max_paragraph=max_paragraph,
    )


def _fallback_chapter_analysis(chapter: Chapter) -> ChapterAnalysis:
    """Produce a single-scene fallback when LLM 2 fails for a chapter."""
    from lectoria.models.ncm import Emotion, Scene

    if not chapter.paragraphs:
        return ChapterAnalysis(chapter_index=chapter.chapter_index, scenes=[])

    return ChapterAnalysis(
        chapter_index=chapter.chapter_index,
        cover_description="",
        scenes=[
            Scene(
                scene_index=1,
                title="(full chapter)",
                start_paragraph=chapter.paragraphs[0].index,
                end_paragraph=chapter.paragraphs[-1].index,
                emotion=Emotion.MYSTERY,
                image_prompt="",
            )
        ],
    )
