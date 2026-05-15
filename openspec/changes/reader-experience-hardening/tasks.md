# Tasks — reader experience hardening

Status: **completed** (implementation matches this list; use for verification or onboarding).

## Music

- [x] Reduce music crossfade duration in `frontend/src/components/MusicPlayer.tsx`
- [x] Add DevPanel `onClose` + close button; wire `ReaderPage`; styles in `index.css`
- [x] Vocal / instrumental filter in `scripts/build_music_index.py` curation (`voice` instrument + vocal genre tags)
- [x] Tighten `cinematic` and `piano_only` in `lectoria/services/music.py`; `matches_preset` fails when no instrument/genre tags
- [x] Rebuild `data/music/music_index.json`; download tracks as needed
- [x] Update unit tests for preset matching (`tests/test_music.py`)

## Images

- [x] Switch Google image provider to Gemini native image model + `generate_content` path (`lectoria/providers/image/google.py`)
- [x] Improve errors when response has text but no image bytes
- [x] Persist on-demand images to `images/on_demand/ch{N}_sc{M}.png`; return `cache_url` from `lectoria/api/routes/images.py`
- [x] Frontend: load cached on-demand URL on scene/page mount; use `cache_url` after generate (`PageView.tsx`, `client.ts`)

## OpenSpec

- [x] Add change `openspec/changes/reader-experience-hardening/` (proposal, design, specs, tasks)
- [x] Amend `music-style-presets` preset-matching scenario to reference tightened behavior
