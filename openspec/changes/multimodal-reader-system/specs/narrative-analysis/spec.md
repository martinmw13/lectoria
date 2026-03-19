## ADDED Requirements

### Requirement: LLM 1 book-level analysis
The system SHALL process the full book text through LLM 1 in a single call (assuming 200K+ token context) and produce a book-level map containing characters (with aliases), setting, genre, and chapter summaries.

#### Scenario: Standard novel
- **WHEN** a novel with identifiable characters and setting is processed
- **THEN** LLM 1 returns a JSON object with a characters array (id, name, aliases, physical_description, role, relationships), a setting object, a genre string, and a chapter_summaries array

#### Scenario: Character aliases
- **WHEN** a character is referred to by multiple names or titles
- **THEN** LLM 1 includes all known aliases in the character's aliases array

### Requirement: LLM 2 scene-level analysis
The system SHALL process each chapter through LLM 2, receiving the chapter text (with numbered paragraphs) plus LLM 1's book-level output as context, and produce scene segmentation with narrative attributes.

#### Scenario: Chapter with multiple scenes
- **WHEN** a chapter containing distinct narrative shifts is processed
- **THEN** LLM 2 returns a scenes array where each scene has: title, start_paragraph, end_paragraph, characters_present, emotion (from the 9-category taxonomy), pacing, scene_type, setting, image_prompt, and transition_type

#### Scenario: Emotion classification
- **WHEN** LLM 2 classifies a scene's emotion
- **THEN** the value is one of: joy, sorrow, tension, anger, peace, romance, mystery, excitement, wonder

#### Scenario: Image prompt generation
- **WHEN** LLM 2 analyzes a scene
- **THEN** it produces an image_prompt field containing a ready-to-use visual description suitable for an image generation API, incorporating characters' physical descriptions and scene setting

#### Scenario: Optional fields
- **WHEN** LLM 2 analyzes a scene
- **THEN** it MAY include key_phrases (text fragments suitable for illustration) and key_objects (narratively relevant objects) as optional arrays

#### Scenario: Scene coverage validation
- **WHEN** LLM 2 returns scenes for a chapter
- **THEN** every paragraph in the chapter is covered by exactly one scene (no gaps, no overlaps). If violations are detected, orphan paragraphs are assigned to the nearest scene.

#### Scenario: Single-scene chapter
- **WHEN** a short chapter with no narrative shifts is processed
- **THEN** LLM 2 returns a single scene covering all paragraphs

### Requirement: NCM persistence
The system SHALL persist the combined output of LLM 1 and LLM 2 as a structured JSON file (the Narrative Context Map) associated with the uploaded book.

#### Scenario: NCM stored after processing
- **WHEN** both LLM 1 and LLM 2 complete successfully for all chapters
- **THEN** the NCM JSON is saved to persistent storage and is retrievable by book identifier

#### Scenario: Partial failure recovery
- **WHEN** LLM 2 fails on one chapter but succeeds on others
- **THEN** the system retries the failed chapter. If retry fails, the chapter is stored with a single fallback scene covering all paragraphs with default attributes.

### Requirement: LLM output validation
The system SHALL validate all LLM outputs against the expected JSON schema before accepting them.

#### Scenario: Malformed JSON response
- **WHEN** the LLM returns invalid JSON
- **THEN** the system retries the request (up to 3 attempts) with the same prompt

#### Scenario: Missing required fields
- **WHEN** the LLM returns valid JSON but missing required fields
- **THEN** the system fills missing fields with sensible defaults and logs a warning
