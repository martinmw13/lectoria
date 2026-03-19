## ADDED Requirements

### Requirement: EPUB upload with cost estimate
The system SHALL provide a web interface for uploading EPUB files, display a cost estimate, and initiate the offline processing pipeline upon confirmation.

#### Scenario: File upload and cost estimate
- **WHEN** the user uploads an EPUB file
- **THEN** the system analyzes the file (token count, chapter count, estimated scene count) and displays an estimated processing cost based on current API rates and user settings (minimal/standard/full/on-demand)

#### Scenario: User confirms processing
- **WHEN** the user confirms after reviewing the cost estimate
- **THEN** the system starts the offline pipeline (ingestion → LLM 1 → LLM 2 → NCM) and shows progress with a running cost counter

#### Scenario: Processing complete
- **WHEN** the offline pipeline completes
- **THEN** the reader view becomes available with the book's content and NCM loaded

### Requirement: Paginated e-reader navigation (Decision 19)
The system SHALL present book content in a paginated view with horizontal slide transitions, where each page contains a portion of a scene limited by a maximum word count (~250 words).

#### Scenario: Scene fits on one page
- **WHEN** a scene has fewer than ~250 words
- **THEN** the entire scene is rendered on a single page with its header (title + emotion)

#### Scenario: Scene spans multiple pages
- **WHEN** a scene has more than ~250 words
- **THEN** the scene is split across multiple pages at paragraph boundaries; the scene header only appears on the first page; the footer shows page position within the scene (e.g., "2/3")

#### Scenario: Page transition
- **WHEN** the user presses Next (button or right arrow key)
- **THEN** the current page slides out to the left and the next page slides in with a horizontal animation

#### Scenario: Progressive forward reveal
- **WHEN** the user advances past the highest previously seen page
- **THEN** the new page is revealed for the first time; the user cannot skip ahead to unrevealed pages

#### Scenario: Backward navigation
- **WHEN** the user presses Prev (button or left arrow key) on already-revealed pages
- **THEN** the current page slides out to the right and the previous page slides in

#### Scenario: Light/dark reading mode
- **WHEN** the reader view is active
- **THEN** it defaults to a light theme (white background, dark text, serif font) optimized for reading, with a toggle for dark mode

### Requirement: Scene-based navigation
The system SHALL present book content organized by scenes (as defined in the NCM), allowing the user to navigate scene-by-scene and page-by-page.

#### Scenario: Scene metadata display
- **WHEN** a scene page is displayed
- **THEN** the scene title, chapter title, and page position are visible in the footer

#### Scenario: Chapter navigation
- **WHEN** the user wants to jump to a different chapter
- **THEN** a chapter index is available showing all chapters with their scene counts

### Requirement: Page view fallback
The system SHALL offer an alternative page-based view that presents the original EPUB content without scene segmentation or progressive reveal.

#### Scenario: Toggle view mode
- **WHEN** the user switches from scene view to page view
- **THEN** the content is re-rendered using standard pagination and music continues based on the nearest scene boundary

### Requirement: Music playback controls
The system SHALL provide controls for the contextual music player.

#### Scenario: Music plays automatically
- **WHEN** the user enters a scene with an associated track
- **THEN** the track begins playing (or crossfades from the previous track, subject to hysteresis rules)

#### Scenario: User mutes or adjusts volume
- **WHEN** the user adjusts volume or mutes
- **THEN** the preference persists across scenes

### Requirement: Image display
The system SHALL display generated images (automatic and on-demand) within the reading interface.

#### Scenario: Automatic image display
- **WHEN** a scene is revealed and has pre-generated images with automatic display enabled
- **THEN** images are shown alongside the scene text upon reveal

#### Scenario: On-demand image result
- **WHEN** the user generates an image from selected text
- **THEN** the image is displayed in a panel or overlay near the selected text

### Requirement: User settings
The system SHALL expose configurable settings.

#### Scenario: Available settings
- **WHEN** the user opens settings
- **THEN** the following options are available: view mode (scene/page), graphics frequency (per scene / per chapter / on-demand only), character memory toggle, API key management (BYOK), lazy loading toggle

#### Scenario: BYOK key entry
- **WHEN** the user enters API keys for LLM and image generation services
- **THEN** the keys are stored locally (not on server) and used for all subsequent API calls

### Requirement: Developer View
The system SHALL provide a developer/debug view that exposes the internal analysis metadata for each scene, enabling inspection of the LLM pipeline outputs and downstream matching decisions (Decision 18).

#### Scenario: Toggle developer view
- **WHEN** the user activates the developer view toggle
- **THEN** each scene displays an expandable panel showing its analysis metadata

#### Scenario: Scene analysis metadata
- **WHEN** the developer view is active and a scene panel is expanded
- **THEN** the following information is displayed:
  - Assigned categories: emotion, pacing, scene_type, transition_type
  - Coercion events: original LLM value and mapped value (if coercion occurred)
  - LLM model used and number of retry attempts
  - Whether a fallback single-scene was used
  - Characters detected and their IDs
  - Image prompt used for generation
  - Key phrases and key objects

#### Scenario: Music matching metadata (when available)
- **WHEN** the developer view is active and music data is available for a scene
- **THEN** the panel additionally shows:
  - Selected track ID, name, and tags
  - Similarity score (cosine)
  - Top-N candidate tracks that were considered
  - Scene tag vector vs. track tag vector

#### Scenario: Chapter-level summary
- **WHEN** the developer view is active at chapter level
- **THEN** a summary shows: total scenes, fallback count, average attempts per chapter, coercion frequency across all scenes in the chapter
