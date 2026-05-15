## Context

The music matching system currently operates on a single dimension: emotion. Scenes are matched to tracks via emotion filtering + cosine similarity over mood/theme tag vectors. All users hear the same style of music for a given emotion, regardless of personal taste.

MTG-Jamendo provides three autotagging TSV files: `autotagging_moodtheme.tsv` (59 tags, currently used), `autotagging_instrument.tsv` (41 tags, unused), and `autotagging_genre.tsv` (87 tags, unused). The instrument and genre tags carry exactly the information needed to distinguish between a cinematic orchestral track and a synthwave track that share the same "tension" emotion.

The current `MusicIndexEntry` model has: `track_id`, `file_path`, `duration_seconds`, `tags` (mood/theme only), `emotion_primary`, `tag_vector` (mood/theme vector). The `build_music_index.py` script reads only `autotagging_moodtheme.tsv`.

## Goals / Non-Goals

**Goals:**
- Enrich each track with instrument and genre tags from the two unused TSV files
- Define a set of musical style presets that filter tracks by instrument/genre characteristics
- Insert a style filter step into the matching pipeline between emotion filtering and cosine ranking
- Expose preset selection through the API and frontend settings
- Expand the curated library to maintain sufficient coverage per emotion x style combination

**Non-Goals:**
- No per-instrument sliders or fine-grained exclusion UI
- No audio-based classification (CLAP, Essentia) -- metadata tags only
- No user-created custom presets in v1
- No changes to the emotion taxonomy, hysteresis, or crossfade logic
- No changes to how the NCM drives scene attributes
- No changes to the mood/theme tag vector (used for cosine ranking) -- instrument/genre tags are orthogonal metadata used only for preset filtering

## Decisions

### Decision 21: Instrument and genre tags stored as separate fields, not merged into tag_vector

`MusicIndexEntry` gains two new list fields: `instrument_tags: list[str]` and `genre_tags: list[str]`. The existing `tags` (mood/theme) and `tag_vector` remain unchanged.

**Why not merge all tags into one vector?** The mood/theme vector drives cosine ranking within an emotion-filtered set. Instrument and genre tags serve a different purpose: binary filtering ("does this track match the user's style?"). Mixing them into the ranking vector would dilute emotion-relevant signal with style-relevant signal. Keeping them separate preserves the current ranking quality while enabling clean style filtering.

**Alternative considered:** Weighted concatenation of mood + instrument + genre vectors. Rejected because it requires tuning the weight balance and changes the behavior of the existing emotion-based ranking, which is already validated.

### Decision 22: Style presets as declarative tag filter rules

Each preset is a dictionary with `include` and `exclude` lists of instrument and genre tags. A track matches a preset if it has at least one included tag AND none of the excluded tags. When no include tags match (sparse metadata), the track passes if it has no excluded tags either.

Five initial presets:

| Preset | Include (instrument/genre) | Exclude (instrument/genre) |
|---|---|---|
| `cinematic` | orchestral, strings, soundtrack, classical, epic | electricguitar, drums, drumkit, ukulele, hiphop, reggae, rap |
| `piano_only` | piano, keyboard | electricguitar, drums, drumkit, bass, synthesizer |
| `ambient` | synthesizer, pads, ambient, electronic, chillout, downtempo | drums, drumkit, electricguitar, vocals, rap, hiphop |
| `synthwave` | synthesizer, electronic, 80s, retrowave, newwave, synth | acoustic, piano, strings, orchestral, jazz |
| `noir_jazz` | jazz, saxophone, trumpet, piano, doublebass, blues | electronic, synthesizer, rock, metal, hiphop, pop |

`auto` (default) applies no style filter -- current behavior preserved.

**Why declarative rules over ML classification?** The tag vocabulary is known and fixed (41 instrument + 87 genre tags). Explicit rules are transparent, debuggable, and trivially adjustable. No training data, no model, no threshold tuning.

**Why include + exclude rather than include-only?** A track tagged `[piano, drums, rock]` would match `piano_only` on the include side but is clearly wrong. Exclusion rules prevent these false positives without requiring exhaustive inclusion lists.

### Decision 23: Style filter inserts between emotion filter and cosine ranking

The matching pipeline becomes: **emotion filter -> style filter -> cosine ranking**.

```
match_scene_to_track(scene, index, style="cinematic", ...)
  │
  ├─ 1. Emotion filter: candidates = [t for t in index if t.emotion_primary == scene.emotion]
  │
  ├─ 2. Style filter:   candidates = [t for t in candidates if matches_preset(t, "cinematic")]
  │     (skip if style is None or "auto")
  │
  ├─ 3. Cosine ranking: rank candidates by similarity to scene tag vector
  │
  └─ 4. Variety/exclusion rules (unchanged)
```

**Fallback chain:** If the style filter produces zero candidates for the current emotion, fall back to style-filtered full index (ignoring emotion). If that also produces zero, fall back to emotion-filtered only (ignoring style). This ensures the user always gets music, even if their style preference has poor coverage for a specific emotion.

```
emotion + style  →  if empty  →  style only (all emotions)  →  if empty  →  emotion only (no style)
```

**Why not style before emotion?** Emotion is the primary semantic signal from the NCM. A cinematic track with the wrong emotion is worse than a non-cinematic track with the right emotion. Style is a user preference; emotion is narrative-driven.

### Decision 24: Preset selection via API query parameter and localStorage

The `GET .../track` endpoint gains an optional `style` query parameter (string, one of the preset names or "auto"). Default is "auto" (no filtering).

Frontend stores the selected preset in `localStorage` under key `lectoria_music_style`. The settings panel shows a radio group with preset names and descriptions. The reader passes `style` as a query param on every track request.

No server-side user state. No database. Consistent with the existing BYOK key management pattern (Decision 17).

### Decision 25: Expand curated library with multi-TSV join

`build_music_index.py` is extended to:
1. Parse all three TSV files: `autotagging_moodtheme.tsv`, `autotagging_instrument.tsv`, `autotagging_genre.tsv`
2. Join on `track_id` -- only tracks present in the mood/theme file are considered (the mood/theme tags drive emotion assignment, which is required)
3. Attach instrument and genre tags to each track entry
4. Increase `--max-tracks` default from 300 to 500
5. Add a `--min-per-style` parameter to ensure minimum coverage per preset

The curation algorithm is extended: after emotion-balanced selection, verify that each preset has at least `min-per-style` tracks per emotion. If not, pull additional tracks from the full pool that match the underrepresented preset + emotion combination.

**Data flow:**

```
autotagging_moodtheme.tsv ──┐
autotagging_instrument.tsv ─┼──→ join on track_id ──→ curate() ──→ music_index.json
autotagging_genre.tsv ──────┘
```

### Decision 26: No style_labels derived field -- presets filter at query time

The proposal mentioned deriving `style_labels` per track. After further analysis, this is unnecessary. Preset matching is a simple tag check that runs in microseconds per track. Pre-computing labels would denormalize the data and require re-indexing whenever preset definitions change.

Instead, preset definitions live in `music.py` as a constant dictionary. `matches_preset(track, preset_name)` evaluates the rules at query time against the track's `instrument_tags` and `genre_tags`.

## Risks / Trade-offs

**[Sparse metadata]** -> Not all tracks in MTG-Jamendo have instrument or genre annotations. Tracks with only mood/theme tags will pass the style filter by default (no excluded tags to match), meaning they may appear in any preset. Mitigation: the curation step prioritizes tracks with richer metadata (more tags = better style signal). Monitor the percentage of "style-agnostic" tracks in the final index.

**[Preset coverage gaps]** -> Some emotion x style combinations may have very few tracks (e.g., `noir_jazz` + `excitement`). Mitigation: the fallback chain ensures music always plays. The `--min-per-style` curation parameter helps, but cannot guarantee coverage if the source dataset lacks tracks in that intersection. Document known gaps.

**[Tag vocabulary drift]** -> Preset rules reference specific tag strings from MTG-Jamendo. If the dataset updates tag names, presets break silently. Mitigation: pin the dataset version. Log warnings when preset rules reference tags not found in the loaded index.

**[Preset granularity]** -> Five presets may not cover all user preferences (e.g., someone who wants "acoustic folk"). Mitigation: the five presets cover the most distinct musical spaces. v2 can add more presets or user-created custom rules based on feedback. The architecture supports it trivially since presets are just filter dictionaries.
