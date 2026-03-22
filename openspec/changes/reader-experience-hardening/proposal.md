# Reader experience hardening (music, images, UI)

## Why

After shipping music style presets and multimodal basics, usage surfaced gaps: style presets were too loose or inconsistent; crossfade felt slow; the developer panel could not be dismissed; Imagen model IDs were deprecated or paid-only; on-demand images disappeared on navigation. This change records the fixes and constraints in OpenSpec so they remain traceable.

## What changes

- **Music:** Faster crossfade; stricter cinematic / piano_only presets; tracks with no instrument/genre tags do not match style presets; global instrumental-only filter during music index curation (voice instrument + vocal-prone genre tags excluded).
- **Reader UI:** Dev panel close control; on-demand images persisted per scene on disk and reloaded when revisiting a scene.
- **Image generation:** Google provider uses Gemini native image models (`generate_content`) instead of Imagen `generate_images`, aligned with typical AI Studio free/paid tiers; clearer errors when the model returns text instead of image bytes.

## Non-goals

- New image providers (e.g. OpenAI DALL-E adapter).
- Per-selection (sub-scene) on-demand cache keys; cache is one file per scene.
- Changing automatic pipeline scene image paths or NCM schema.
