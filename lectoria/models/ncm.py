"""Narrative Context Map (NCM) schema — the central contract between all modules.

Defines the structured output of the two-stage LLM pipeline:
- BookMap: LLM 1 output (book-level: characters, setting, genre, chapter summaries)
- ChapterAnalysis: LLM 2 output (chapter-level: scenes with all narrative attributes)
- NCM: merged artifact combining both stages
"""

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Emotion(StrEnum):
    JOY = "joy"
    SORROW = "sorrow"
    TENSION = "tension"
    ANGER = "anger"
    PEACE = "peace"
    ROMANCE = "romance"
    MYSTERY = "mystery"
    EXCITEMENT = "excitement"
    WONDER = "wonder"


class Pacing(StrEnum):
    SLOW = "slow"
    MEDIUM = "medium"
    FAST = "fast"


class SceneType(StrEnum):
    ACTION = "action"
    DIALOGUE = "dialogue"
    DESCRIPTION = "description"
    INTROSPECTION = "introspection"
    TRANSITION = "transition"


class TransitionType(StrEnum):
    NONE = "none"
    TIME_JUMP = "time_jump"
    POV_CHANGE = "pov_change"
    FLASHBACK = "flashback"
    LOCATION_CHANGE = "location_change"


class CharacterRole(StrEnum):
    PROTAGONIST = "protagonist"
    ANTAGONIST = "antagonist"
    SECONDARY = "secondary"
    MINOR = "minor"


# ---------------------------------------------------------------------------
# BookMap — LLM 1 output (book-level)
# ---------------------------------------------------------------------------


class Relationship(BaseModel):
    target_id: str
    type: str


class Character(BaseModel):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    physical_description: str = ""
    role: CharacterRole = CharacterRole.MINOR
    relationships: list[Relationship] = Field(default_factory=list)


class BookSetting(BaseModel):
    time_period: str = ""
    world: str = ""
    description: str = ""


class ChapterSummary(BaseModel):
    chapter_index: int
    title: str = ""
    summary: str = ""


class BookMap(BaseModel):
    """LLM 1 output: book-level context."""

    book_id: str = ""
    title: str = ""
    genre: str = ""
    setting: BookSetting = Field(default_factory=BookSetting)
    characters: list[Character] = Field(default_factory=list)
    chapters: list[ChapterSummary] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# ChapterAnalysis — LLM 2 output (chapter-level)
# ---------------------------------------------------------------------------


class SceneSetting(BaseModel):
    location: str = ""
    time_of_day: str = ""
    weather: str = ""


class Scene(BaseModel):
    scene_index: int
    title: str = ""
    start_paragraph: int
    end_paragraph: int
    characters_present: list[str] = Field(default_factory=list)
    emotion: Emotion
    pacing: Pacing = Pacing.MEDIUM
    scene_type: SceneType = SceneType.DESCRIPTION
    setting: SceneSetting = Field(default_factory=SceneSetting)
    image_prompt: str = ""
    transition_type: TransitionType = TransitionType.NONE
    key_phrases: list[str] = Field(default_factory=list)
    key_objects: list[str] = Field(default_factory=list)

    # Dev metadata — original LLM values before coercion (None = no coercion needed)
    raw_emotion: str | None = None
    raw_pacing: str | None = None
    raw_scene_type: str | None = None
    raw_transition_type: str | None = None


class ChapterAnalysis(BaseModel):
    """LLM 2 output: scene-level analysis for one chapter."""

    chapter_index: int
    cover_description: str = ""
    scenes: list[Scene] = Field(default_factory=list)

    # Dev metadata
    llm_model: str = ""
    attempt_count: int = 0
    is_fallback: bool = False

    @model_validator(mode="after")
    def validate_scene_coverage(self) -> "ChapterAnalysis":
        """Scenes must cover all paragraphs without gaps or overlaps."""
        if not self.scenes:
            return self

        sorted_scenes = sorted(self.scenes, key=lambda s: s.start_paragraph)

        for i, scene in enumerate(sorted_scenes):
            if scene.start_paragraph > scene.end_paragraph:
                raise ValueError(
                    f"Scene {scene.scene_index}: start_paragraph ({scene.start_paragraph}) "
                    f"> end_paragraph ({scene.end_paragraph})"
                )
            if i > 0:
                prev = sorted_scenes[i - 1]
                if scene.start_paragraph <= prev.end_paragraph:
                    raise ValueError(
                        f"Scene {scene.scene_index} overlaps with scene {prev.scene_index}: "
                        f"paragraph {scene.start_paragraph} <= {prev.end_paragraph}"
                    )
                if scene.start_paragraph != prev.end_paragraph + 1:
                    raise ValueError(
                        f"Gap between scene {prev.scene_index} and {scene.scene_index}: "
                        f"paragraphs {prev.end_paragraph + 1}-{scene.start_paragraph - 1} uncovered"
                    )
        return self


# ---------------------------------------------------------------------------
# NCM — merged artifact (BookMap + all ChapterAnalysis)
# ---------------------------------------------------------------------------


class NCM(BaseModel):
    """Complete Narrative Context Map for a book."""

    book_map: BookMap
    chapters: list[ChapterAnalysis] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Ingestion output — intermediate artifact before LLM processing
# ---------------------------------------------------------------------------


class Paragraph(BaseModel):
    index: int
    text: str


class Chapter(BaseModel):
    chapter_index: int
    title: str = ""
    paragraphs: list[Paragraph] = Field(default_factory=list)
    is_narrative: bool = True


class ChaptersData(BaseModel):
    """Ingestion output: structured text extracted from EPUB."""

    chapters: list[Chapter] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Music index
# ---------------------------------------------------------------------------


class MusicIndexEntry(BaseModel):
    track_id: str
    file_path: str
    duration_seconds: float
    tags: list[str] = Field(default_factory=list)
    instrument_tags: list[str] = Field(default_factory=list)
    genre_tags: list[str] = Field(default_factory=list)
    emotion_primary: Emotion
    tag_vector: list[float] = Field(default_factory=list)
