## ADDED Requirements

### Requirement: Music library indexing
The system SHALL maintain a curated subset of MTG-Jamendo tracks (~200-500), each indexed with mood/theme tags, a primary emotion label (from the 9-category taxonomy), and a tag-derived vector.

#### Scenario: Library initialization
- **WHEN** the music library is set up
- **THEN** each track has: track_id, file_path, duration, mood/theme tags, emotion_primary (one of the 9 categories), and a tag_vector computed from tag encoding

#### Scenario: Minimum coverage per emotion
- **WHEN** querying the library for any of the 9 emotion categories
- **THEN** at least 3 candidate tracks are returned

### Requirement: Scene-to-track matching
The system SHALL select a music track for each scene using two-phase retrieval: tag-based filtering by emotion, then ranking by cosine similarity of tag-derived vectors.

#### Scenario: Standard scene matching
- **WHEN** the reader enters a scene with emotion="sorrow", scene_type="introspection"
- **THEN** the system filters tracks with emotion_primary="sorrow", then ranks candidates by cosine similarity between the scene's attribute vector and each track's tag_vector, returning the top match

#### Scenario: Consecutive scenes with same emotion
- **WHEN** two consecutive scenes share the same emotion
- **THEN** the system avoids selecting the same track for both, preferring variety within the candidate pool

### Requirement: Music transition hysteresis with emotional distance
The system SHALL avoid changing tracks on every scene transition, using emotion clusters (positive, dark, melancholic, neutral) to determine whether a transition is warranted.

#### Scenario: Same emotion consecutive scenes
- **WHEN** the user advances to a new scene that has the same emotion as the current scene
- **THEN** the current track continues playing without crossfade

#### Scenario: Same cluster, long scene
- **WHEN** the user advances to a new scene with a different emotion but within the same cluster (e.g., peace → wonder, tension → anger) and the scene is above the short-scene duration threshold
- **THEN** the system crossfades to a new track

#### Scenario: Same cluster, short scene
- **WHEN** the user advances to a new scene within the same cluster and the scene is below the short-scene duration threshold
- **THEN** the current track continues playing without crossfade

#### Scenario: Different cluster
- **WHEN** the user advances to a new scene in a different cluster (e.g., joy → sorrow, peace → anger)
- **THEN** the system always crossfades to a new track, regardless of scene duration

#### Scenario: Mystery transitions
- **WHEN** the user advances to or from a mystery scene
- **THEN** the system follows the short-scene duration rule (crossfade if long, suppress if short)

### Requirement: Crossfade transitions
The system SHALL apply audio crossfade when transitioning between tracks (subject to hysteresis rules).

#### Scenario: Scene transition with track change
- **WHEN** the user advances to a scene that triggers a track change (per hysteresis rules)
- **THEN** the current track fades out and the new track fades in over 3-5 seconds

#### Scenario: Same track continues
- **WHEN** the user advances to a scene that does not trigger a track change
- **THEN** playback continues without interruption
