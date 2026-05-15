## 1. Data Model & Index Enrichment

- [x] 1.1 Add `instrument_tags: list[str]` and `genre_tags: list[str]` fields to `MusicIndexEntry` in `lectoria/models/ncm.py` (with `default_factory=list` for backward compat)
- [x] 1.2 Extend `build_music_index.py` to parse `autotagging_instrument.tsv` and `autotagging_genre.tsv`, join on `track_id`, and attach instrument/genre tags to each entry
- [x] 1.3 Add `--min-per-style` CLI parameter to `build_music_index.py` (default 10) and extend `curate()` to verify minimum coverage per preset after emotion-balanced selection
- [x] 1.4 Increase `--max-tracks` default from 300 to 500 in `build_music_index.py`
- [x] 1.5 Rebuild `data/music/music_index.json` with the enriched script and verify instrument/genre tags are populated

## 2. Preset Definitions & Filtering Logic

- [x] 2.1 Define `STYLE_PRESETS` constant dict in `lectoria/services/music.py` with include/exclude tag rules for: cinematic, piano_only, ambient, synthwave, noir_jazz
- [x] 2.2 Implement `matches_preset(track: MusicIndexEntry, preset_name: str) -> bool` in `music.py` following the include/exclude logic (Decision 22)
- [x] 2.3 Add `style: str | None` parameter to `match_scene_to_track()` and insert the style filter step between emotion filter and cosine ranking
- [x] 2.4 Implement the three-tier fallback chain: emotion+style -> style-only -> emotion-only (Decision 23)
- [x] 2.5 Add `style: str | None` parameter to `match_scene_to_track_detailed()` with the same filtering logic

## 3. API Layer

- [x] 3.1 Add `style: str | None = None` query parameter to `get_scene_track` endpoint in `lectoria/api/routes/music.py`
- [x] 3.2 Validate `style` parameter against known preset names; return HTTP 400 with valid names on invalid input
- [x] 3.3 Pass `style` through to `match_scene_to_track()` / `match_scene_to_track_detailed()`
- [x] 3.4 Add `GET /api/presets` endpoint (or similar) that returns the list of available preset names with descriptions

## 4. Frontend

- [x] 4.1 Add "Music Style" section to the settings panel with radio buttons for each preset (auto, cinematic, piano_only, ambient, synthwave, noir_jazz) and short descriptions
- [x] 4.2 Store selected preset in `localStorage` under key `lectoria_music_style`
- [x] 4.3 Read the stored preset and include `style` query parameter on all track requests from the reader

## 5. Tests

- [x] 5.1 Unit tests for `matches_preset()`: tracks with matching include tags, tracks with excluded tags, tracks with no instrument/genre tags, unknown preset name
- [x] 5.2 Unit tests for `match_scene_to_track()` with style parameter: style filtering narrows candidates, fallback chain fires when style+emotion yields zero results
- [x] 5.3 Test the API `style` parameter: valid preset, invalid preset (400), omitted (auto behavior)
- [x] 5.4 Test `build_music_index.py` multi-TSV join: verify instrument and genre tags are attached to entries
