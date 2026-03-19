## Why

Digital reading remains a purely textual experience. Contextual audiovisual enrichment (music that responds to the narrative, illustrations generated from the text) is technically feasible with current AI models but no existing product integrates these capabilities into an accessible web reader. This project builds a multimodal EPUB reader as an academic thesis (CEIA, FIUBA) that demonstrates computational narrative analysis can drive coherent cross-modal enrichment perceived as superior to random stimulus selection.

## What Changes

- **Two-stage LLM narrative analysis pipeline**: LLM 1 extracts book-level context (characters, setting, genre, chapter summaries); LLM 2 segments each chapter into scenes and annotates them with emotion, tension, pacing, scene type, visual mood, key phrases, key objects, and transition type. The combined output forms the Narrative Context Map (NCM).
- **Scene-based reader**: the application presents content scene-by-scene (not page-by-page) to synchronize music and visual transitions with actual narrative shifts, preventing spoilers from premature transitions.
- **Contextual music selection**: a curated MTG-Jamendo library indexed by emotional context is matched to scene attributes from the NCM, with crossfade transitions between scenes.
- **Image generation (automatic + on-demand)**: automatic illustration from key phrases and chapter cover descriptions; on-demand generation when the user selects text, with prompt rewriting, NER-based character identification, and character memory for visual consistency.
- **BYOK architecture**: all AI capabilities consumed via external APIs (LLM, image generation). Users provide their own API keys. No local model deployment.
- **User-configurable settings**: scene vs. page view, graphics frequency, character memory toggle, BYOK key management, lazy loading.
- **Web application**: React + TypeScript frontend, FastAPI backend, Web Audio API for audio playback.

## Non-goals

- No model fine-tuning or pretraining of any kind
- No generative audio composition (music is pre-recorded, retrieved, not generated)
- No PDF support in MVP
- No mobile native apps
- No user accounts, authentication, or cross-device sync
- No multilingual evaluation (English only)
- No perfect character consistency across generated images (best-effort via memory)
- No scanned document (OCR) support

## Capabilities

### New Capabilities
- `epub-ingestion`: Extract and structure text from EPUB documents, producing clean text organized by chapter
- `narrative-analysis`: Two-stage LLM pipeline (LLM 1 + LLM 2) that generates the Narrative Context Map (NCM) with scene segmentation, emotion, tension, pacing, characters, key phrases, and all scene-level attributes
- `music-contextual`: Curated music library indexing, scene-to-track matching via emotional context embeddings, and crossfade playback synchronized to scene transitions
- `image-generation`: Automatic image generation from key phrases and cover descriptions, plus on-demand generation from user-selected text with prompt rewriting, NER, and character memory
- `reader-ui`: Scene-based web reader with synchronized music playback, image display, and user settings
- `evaluation`: Quantitative NCM quality assessment and user study comparing NCM-guided enrichment vs. random enrichment

### Modified Capabilities
(none - greenfield project)

## Impact

- **External APIs**: system depends on user-selected LLM and image generation APIs (BYOK, provider-agnostic). API availability, cost, and rate limits directly affect functionality. Provider abstraction layer isolates services from specific API implementations.
- **MTG-Jamendo**: requires curation and preprocessing of a music subset (~200-500 tracks) with emotional indexing.
- **Frontend rendering**: abandoning native EPUB pagination in favor of scene-based presentation requires custom text rendering logic (not standard epub.js page flow).
- **Data pipeline**: the offline ingestion pipeline (~3-4 minutes per book) produces JSON artifacts (NCM) that must be stored and served efficiently.
- **Cost model**: BYOK means the user bears API costs. The system should expose cost estimates and provide controls (lazy loading, graphics frequency) to manage spend.
