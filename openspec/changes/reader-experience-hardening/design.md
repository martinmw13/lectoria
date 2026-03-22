# Design: Reader experience hardening

## D27 — On-demand image disk cache (per scene)

**Decision:** Persist each successful on-demand generation under `books/{book_id}/images/on_demand/ch{chapter}_sc{scene}.png`. Overwrite on regenerate for the same scene.

**Rationale:** Matches automatic scene images pattern (`images/scenes/`); served via existing `/api/data/books` static mount; survives browser refresh and app restart without localStorage size limits.

**Tradeoff:** Multiple "Picture this" selections in the same scene overwrite the same file; last generation wins.

## D28 — Google image provider: Gemini native image, not Imagen

**Decision:** Use `gemini-2.5-flash-image` with `generate_content` and image response parts. Do not use `generate_images` / Imagen model IDs for the default path.

**Rationale:** Imagen 3/4 via `generate_images` often requires paid billing; Gemini Flash Image aligns with typical Gemini API keys. Deprecated Imagen 3 IDs return 404.

**Tradeoff:** Reference-image support for character memory remains limited (provider reports `supports_reference_image` false for this path).

## D29 — Style preset matching: require tags

**Decision:** A track matches a named style preset only if it has at least one instrument or genre tag, passes include/exclude, and has no excluded tags. Empty tag sets do not match presets (still eligible under `auto`).

**Rationale:** Prevents untagged tracks from diluting cinematic/piano_only selections.

## D30 — Instrumental-only curation filter

**Decision:** During `build_music_index.py` curation, drop tracks with `voice` in instrument tags or vocal-prone genre tags (`singersongwriter`, `rap`, `hiphop`, `rnb`, `chanson`) before emotion assignment.

**Rationale:** User requirement for lyric-free accompaniment where metadata allows filtering.

**Limitation:** Tracks with no instrument/genre tags may still be unknown vocal/instrumental; mood/theme subset skews instrumental.
