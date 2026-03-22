## MODIFIED Requirements

### Requirement: Music library indexing
The system SHALL maintain a curated subset of MTG-Jamendo tracks (~400-500), each indexed with mood/theme tags, instrument tags, genre tags, a primary emotion label (from the 9-category taxonomy), and a tag-derived vector (mood/theme only).

#### Scenario: Library initialization
- **WHEN** the music library is set up
- **THEN** each track has: track_id, file_path, duration, mood/theme tags, instrument_tags (from autotagging_instrument.tsv), genre_tags (from autotagging_genre.tsv), emotion_primary (one of the 9 categories), and a tag_vector computed from mood/theme tag encoding

#### Scenario: Minimum coverage per emotion
- **WHEN** querying the library for any of the 9 emotion categories
- **THEN** at least 5 candidate tracks are returned

#### Scenario: Multi-TSV join
- **WHEN** the build script processes the MTG-Jamendo dataset
- **THEN** it SHALL read autotagging_moodtheme.tsv, autotagging_instrument.tsv, and autotagging_genre.tsv, joining instrument and genre tags to each track by track_id

#### Scenario: Tracks missing instrument or genre annotations
- **WHEN** a track in autotagging_moodtheme.tsv has no corresponding entry in the instrument or genre TSV files
- **THEN** its instrument_tags and genre_tags SHALL be empty lists and it SHALL still be eligible for curation

### Requirement: Scene-to-track matching
The system SHALL select a music track for each scene using three-phase retrieval: filtering by emotion, filtering by style preset, then ranking by cosine similarity of mood/theme tag-derived vectors.

#### Scenario: Standard scene matching with no style preference
- **WHEN** the reader enters a scene with emotion="sorrow", scene_type="introspection" and style is "auto" or not specified
- **THEN** the system filters tracks with emotion_primary="sorrow", skips style filtering, then ranks candidates by cosine similarity between the scene's attribute vector and each track's tag_vector, returning the top match

#### Scenario: Scene matching with style preset
- **WHEN** the reader enters a scene with emotion="tension" and style="cinematic"
- **THEN** the system filters tracks with emotion_primary="tension", then filters to tracks matching the "cinematic" preset rules (has at least one included instrument/genre tag AND none of the excluded tags), then ranks by cosine similarity

#### Scenario: Style filter produces zero candidates for emotion
- **WHEN** the emotion + style filter combination yields zero tracks
- **THEN** the system falls back to style-filtered full index (ignoring emotion), and if that also yields zero, falls back to emotion-filtered only (ignoring style)

#### Scenario: Consecutive scenes with same emotion
- **WHEN** two consecutive scenes share the same emotion
- **THEN** the system avoids selecting the same track for both, preferring variety within the candidate pool

## ADDED Requirements

### Requirement: Style presets definition
The system SHALL provide a set of predefined musical style presets, each defined as include/exclude rules over instrument and genre tags.

#### Scenario: Available presets
- **WHEN** the system is initialized
- **THEN** the following presets SHALL be available: "auto" (no filtering), "cinematic", "piano_only", "ambient", "synthwave", "noir_jazz"

#### Scenario: Preset matching logic
- **WHEN** evaluating whether a track matches a preset
- **THEN** the track MUST have at least one tag from the preset's include list AND none of the tags from the preset's exclude list; tracks with no instrument or genre tags SHALL NOT match a named preset (see `openspec/changes/reader-experience-hardening` for the tightened rules and vocal curation filter)

#### Scenario: Auto preset
- **WHEN** the user selects "auto" or provides no style preference
- **THEN** no style filtering is applied and the system uses the original emotion + cosine ranking pipeline

### Requirement: Style preset API parameter
The scene track endpoint SHALL accept an optional style parameter to apply style preset filtering.

#### Scenario: Track request with style
- **WHEN** the frontend requests a track via GET .../track?style=cinematic
- **THEN** the matching pipeline applies the "cinematic" preset filter between emotion filtering and cosine ranking

#### Scenario: Track request without style
- **WHEN** the frontend requests a track via GET .../track (no style parameter)
- **THEN** the system behaves identically to the current implementation (emotion filter + cosine ranking, no style filter)

#### Scenario: Invalid style parameter
- **WHEN** the frontend sends style=nonexistent_preset
- **THEN** the system returns HTTP 400 with a message listing valid preset names

### Requirement: Style preset selection in frontend
The frontend settings panel SHALL expose a style preset selector that persists the user's choice.

#### Scenario: Settings panel display
- **WHEN** the user opens the settings panel
- **THEN** a "Music Style" section shows radio buttons for each preset (auto, cinematic, piano_only, ambient, synthwave, noir_jazz) with a short description of each

#### Scenario: Preset persistence
- **WHEN** the user selects a preset
- **THEN** the choice is stored in localStorage under key "lectoria_music_style" and all subsequent track requests include the style parameter

#### Scenario: Default preset
- **WHEN** no preset has been selected (first visit or cleared storage)
- **THEN** the system defaults to "auto"

### Requirement: Minimum style coverage in curation
The music index build script SHALL ensure minimum track coverage per style preset.

#### Scenario: Style-aware curation
- **WHEN** building the music index with --min-per-style N
- **THEN** for each preset, the curated library SHALL contain at least N tracks that match the preset's filter rules

#### Scenario: Default min-per-style
- **WHEN** --min-per-style is not specified
- **THEN** the default minimum is 10 tracks per preset
