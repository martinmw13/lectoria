## MODIFIED Requirements

### Requirement: Style presets definition
The system SHALL provide a set of predefined musical style presets, each defined as include/exclude rules over instrument and genre tags.

#### Scenario: Preset matching logic (updated)
- **WHEN** evaluating whether a track matches a preset other than auto
- **THEN** the track MUST have at least one instrument or genre tag; MUST have at least one tag from the preset's include set; MUST have none of the preset's exclude tags; tracks with empty instrument and genre tag sets SHALL NOT match any named preset (they remain available when style is auto)

#### Scenario: Cinematic preset stricter orchestra focus
- **WHEN** the cinematic preset is applied
- **THEN** include tags favor orchestra, strings, brass, soundtrack, symphonic, orchestral (not broad solo-instrument pulls); exclude tags reduce jazz, lounge, pop, ambient overlap where listed in implementation

#### Scenario: Piano-only preset stricter dominance
- **WHEN** the piano_only preset is applied
- **THEN** include tags require piano-family instruments; exclude tags block common ensemble and band instruments and conflicting genres as defined in implementation

### Requirement: Music library indexing (instrumental bias)
The curated music index build SHALL exclude tracks that are explicitly tagged as vocal-heavy in metadata where available.

#### Scenario: Vocal exclusion at curation
- **WHEN** the build script runs curation
- **THEN** tracks with `voice` in instrument autotags OR selected vocal-prone genre autotags (e.g. singersongwriter, rap, hiphop, rnb, chanson) SHALL be dropped before emotion assignment

#### Scenario: Unknown tags
- **WHEN** a track has no instrument or genre tags
- **THEN** it MAY remain in the index (instrumental/vocal unknown); the instrumental filter applies only where tags exist

## ADDED Requirements

### Requirement: Music style preset quality iteration
The implementation SHALL document iterative tightening of cinematic and piano_only include/exclude lists in code (`lectoria/services/music.py`) and rebuild `music_index.json` after curation rule changes.

#### Scenario: Rebuild after rule change
- **WHEN** preset rules or vocal filters change
- **THEN** operators rerun `scripts/build_music_index.py` against MTG-Jamendo data and refresh downloads as needed
