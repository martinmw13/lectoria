"""Narrative analysis service — two-stage LLM pipeline (Decisions 1-5).

LLM 1: full book → BookMap (characters, setting, genre, chapter summaries)
LLM 2: per-chapter with BookMap context → ChapterAnalysis (scenes with attributes)
"""

import logging

from lectoria.models.ncm import (
    BookMap,
    Chapter,
    ChapterAnalysis,
    ChaptersData,
    Emotion,
    Pacing,
    Scene,
    SceneType,
    TransitionType,
)
from lectoria.providers.base import LLMProvider
from lectoria.services.llm_json import (
    StructuredCallError,
    StructuredCompletion,
    TokenUsage,
    complete_to_model,
)

logger = logging.getLogger(__name__)

MAX_RETRIES = 3

# Rough token-estimation heuristic shared by the upload route and book analysis:
# ~4 characters per token. Used only for cost display and context-window warnings,
# so the approximation does not need to be exact.
CHARS_PER_TOKEN = 4


def estimate_tokens(char_count: int) -> int:
    """Estimate token count from a character count (~4 chars per token)."""
    return char_count // CHARS_PER_TOKEN


# ---------------------------------------------------------------------------
# Scene enum coercion (Decision 18)
# ---------------------------------------------------------------------------

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

# (field, valid-value set, coerce-map) — one row per scene enum field, driving the
# coercion loop below. Adding a coercible field is one new row, not a new block.
_COERCIBLE_FIELDS: tuple[tuple[str, set[str], dict[str, str]], ...] = (
    ("emotion", _VALID_EMOTIONS, _EMOTION_COERCE),
    ("scene_type", _VALID_SCENE_TYPES, _SCENE_TYPE_COERCE),
    ("transition_type", _VALID_TRANSITIONS, _TRANSITION_COERCE),
    ("pacing", _VALID_PACINGS, _PACING_COERCE),
)


def _coerce_scene_enums(data: dict) -> dict:
    """Map LLM-invented enum values to valid ones before Pydantic validation.

    When a value is coerced, the original is preserved in raw_<field> for dev inspection.
    """
    for scene in data.get("scenes", []):
        for field, valid_set, coerce_map in _COERCIBLE_FIELDS:
            raw = str(scene.get(field, "")).lower().strip()
            if not raw or raw in valid_set:
                continue
            coerced = coerce_map.get(raw)
            if coerced:
                logger.info("Coerced %s '%s' -> '%s'", field, raw, coerced)
                scene[f"raw_{field}"] = raw
                scene[field] = coerced

    return data


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


async def analyze_book(
    provider: LLMProvider,
    chapters_data: ChaptersData,
) -> tuple[BookMap, TokenUsage]:
    """Run LLM 1: analyze the full book and produce a BookMap.

    Returns:
        Tuple of (BookMap, TokenUsage) with cumulative token counts.

    Raises:
        StructuredCallError: If all retries fail (a RuntimeError subclass).
    """
    book_text = _format_book_text(chapters_data)

    token_estimate = estimate_tokens(len(book_text))
    max_tokens = provider.max_context_tokens()
    if token_estimate > max_tokens * 0.9:
        logger.warning(
            "Book text (~%d tokens) may exceed provider context window (%d tokens)",
            token_estimate,
            max_tokens,
        )

    prompt = _LLM1_PROMPT_TEMPLATE.format(book_text=book_text)
    completion = await complete_to_model(
        provider,
        prompt=prompt,
        system=_LLM1_SYSTEM,
        model_type=BookMap,
        max_retries=MAX_RETRIES,
        label="LLM 1",
    )
    book_map = completion.value
    logger.info(
        "LLM 1 success: %d characters, %d chapter summaries (tokens: prompt=%d, completion=%d)",
        len(book_map.characters),
        len(book_map.chapters),
        completion.usage.prompt_tokens,
        completion.usage.completion_tokens,
    )
    return book_map, completion.usage


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

    On exhausted retries this falls back to a single-scene analysis rather than
    raising (Decision 18), stamping dev metadata (llm_model, attempt_count,
    is_fallback) either way.

    Returns:
        Tuple of (ChapterAnalysis, TokenUsage) with per-chapter token counts.
    """
    if not chapter.paragraphs:
        return ChapterAnalysis(chapter_index=chapter.chapter_index, scenes=[]), TokenUsage()

    prompt = _format_llm2_prompt(chapter, book_map)
    label = f"LLM 2 chapter {chapter.chapter_index}"
    try:
        completion = await complete_to_model(
            provider,
            prompt=prompt,
            system=_LLM2_SYSTEM,
            model_type=ChapterAnalysis,
            max_retries=MAX_RETRIES,
            preprocess=_coerce_scene_enums,
            label=label,
        )
    except StructuredCallError as e:
        return _chapter_fallback(chapter, provider, label, e)

    return _finalize_chapter_analysis(completion, provider, label)


def _chapter_fallback(
    chapter: Chapter,
    provider: LLMProvider,
    label: str,
    error: StructuredCallError,
) -> tuple[ChapterAnalysis, TokenUsage]:
    """Log exhausted retries and build a stamped single-scene fallback (Decision 18)."""
    logger.error(
        "%s failed after %d attempts, using fallback. Last error: %s",
        label,
        error.attempts,
        error.last_error,
    )
    fallback = _fallback_chapter_analysis(chapter)
    fallback.llm_model = provider.model
    fallback.attempt_count = error.attempts
    fallback.is_fallback = True
    return fallback, error.usage


def _finalize_chapter_analysis(
    completion: StructuredCompletion[ChapterAnalysis],
    provider: LLMProvider,
    label: str,
) -> tuple[ChapterAnalysis, TokenUsage]:
    """Stamp dev metadata on a successful analysis and log the result (Decision 18)."""
    analysis = completion.value
    analysis.llm_model = provider.model
    analysis.attempt_count = completion.attempts
    logger.info(
        "%s success: %d scenes (attempt %d, tokens: prompt=%d, completion=%d)",
        label,
        len(analysis.scenes),
        completion.attempts,
        completion.usage.prompt_tokens,
        completion.usage.completion_tokens,
    )
    return analysis, completion.usage


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
