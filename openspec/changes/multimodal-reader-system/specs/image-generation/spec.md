## ADDED Requirements

### Requirement: Automatic image generation from scene image_prompt
The system SHALL generate images from the image_prompt field produced by LLM 2 for each scene during the offline pipeline (configurable).

#### Scenario: Automatic generation enabled
- **WHEN** the user has enabled automatic image generation
- **THEN** the system generates one image per scene using scene.image_prompt and associates it with the scene

#### Scenario: Automatic generation disabled
- **WHEN** the user has disabled automatic image generation
- **THEN** no scene images are generated during the offline pipeline (on-demand only)

### Requirement: Chapter cover generation
The system SHALL generate a cover image for each chapter using the cover_description from LLM 2 output.

#### Scenario: Cover generation
- **WHEN** a chapter has a cover_description in the NCM
- **THEN** the system generates a single cover image displayed at the start of the chapter

### Requirement: On-demand image generation (raw text)
The system SHALL allow the user to select a text passage and send it directly to the image generation API without LLM processing.

#### Scenario: User selects text
- **WHEN** the user selects a text fragment and triggers image generation
- **THEN** the system sends the raw selected text to the user-selected image generation API and displays the resulting image

#### Scenario: Character enrichment
- **WHEN** the selected text contains a character name or alias matching the NCM character list
- **THEN** the system appends the character's physical_description to the prompt before sending to the image API

#### Scenario: Generation latency
- **WHEN** an on-demand image is requested
- **THEN** the system shows a loading indicator and delivers the image within 15 seconds under normal API conditions

### Requirement: Character identification via string matching + scene context fallback
The system SHALL identify characters in user-selected text by string matching (with possessive normalization) against the character list (names and aliases) from LLM 1's output. When no match is found, the system SHALL fall back to the current scene's characters_present list.

#### Scenario: Character name found in selection
- **WHEN** the user selects text containing a character name or alias from the NCM (including possessive forms like "Aragorn's")
- **THEN** the system identifies the character and includes their physical_description in the image generation prompt

#### Scenario: Multiple characters found
- **WHEN** the selected text contains multiple character names
- **THEN** the system injects all matched characters' physical_descriptions

#### Scenario: No character name found, scene context fallback
- **WHEN** the selected text does not contain any known character names (e.g., uses pronouns or descriptors)
- **THEN** the system falls back to the current scene's characters_present list from the NCM and injects those characters' physical_descriptions

#### Scenario: No characters in scene
- **WHEN** no character match is found and the current scene has no characters_present
- **THEN** the system sends the raw text without character descriptions

### Requirement: Character memory
The system SHALL maintain a mapping of character IDs to previously generated images and use them as reference when generating new images of the same character.

#### Scenario: Known character in new image
- **WHEN** generating an image that includes a character for whom a previous image exists
- **THEN** the system passes the previous image as a reference to the generation API alongside the text prompt

#### Scenario: First appearance of character
- **WHEN** generating an image of a character with no prior images
- **THEN** the system uses only the text prompt and the character's physical_description, and stores the result as the character's reference image
