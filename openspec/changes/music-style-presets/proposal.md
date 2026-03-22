## Why

The current music system matches scenes to tracks purely by emotion. All users hear the same type of music for the same emotion regardless of personal taste. A user reading literary fiction may want intimate piano, while another reading sci-fi wants synth pads, and a third reading noir wants dark jazz. The system has no way to express this preference.

MTG-Jamendo provides instrument (41 tags) and genre (87 tags) metadata that the system currently ignores entirely -- only mood/theme tags are indexed. This unused metadata is exactly what's needed to support musical style preferences without manual curation.

## What Changes

- **Enrich music index with instrument and genre tags** from the two MTG-Jamendo TSV files the system currently ignores (`autotagging_instrument.tsv`, `autotagging_genre.tsv`).
- **Define 5 musical style presets**: `piano_only`, `cinematic`, `ambience`, `sci_fi_synth`, `noir_jazz`, each expressed as inclusion/exclusion filters over the enriched tag set.
- **Derive style labels per track** automatically from the combined tag set (mood + instrument + genre).
- **Add a style filter step to the matching pipeline**: emotion filter -> style filter -> cosine ranking. The user's selected preset narrows candidates before ranking, preserving the existing emotion-first contract.
- **Expose preset selection in the frontend** Settings panel. Default is `Auto` (no style filter, current behavior).
- **Expand the curated library** from ~200 to ~400-500 tracks to maintain sufficient coverage per emotion x style combination.

## Non-goals

- No per-instrument sliders or fine-grained exclusion UI ("no drums", "no ukulele").
- No audio-based classification (CLAP, Essentia, etc.) -- tag metadata only.
- No user-created custom presets in v1.
- No changes to the emotion taxonomy, hysteresis logic, or crossfade behavior.
- No changes to how the NCM drives scene attributes.

## Capabilities

### Modified Capabilities
- `music-contextual`: Enriched track index (instrument + genre tags, style labels), style-aware matching pipeline, expanded library (~400-500 tracks), preset selection in settings.

## Impact

- **`MusicIndexEntry` model** gains `instrument_tags`, `genre_tags`, and `style_labels` fields. Existing `tags` (mood/theme) and `tag_vector` remain unchanged for backward compatibility.
- **`build_music_index.py`** reads all three TSV files instead of one. Curated subset grows from ~200 to ~400-500.
- **`match_scene_to_track`** gains an optional `style` parameter. When `None` or `"auto"`, current behavior is preserved.
- **Frontend Settings** adds a style selector (radio buttons or dropdown). Stored in localStorage, sent as query parameter on track requests.
- **API endpoint** `GET .../track` gains an optional `style` query parameter.
- **Music data on disk** (`data/music/`) needs re-curation after index changes.
