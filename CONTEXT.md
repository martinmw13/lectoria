# Lectoria — Context

**What it is:** A multimodal EPUB reader that uses a two-stage LLM pipeline to analyze narrative text and produce a Narrative Context Map (NCM), which drives contextual music selection and AI image generation while reading. Academic thesis project (CEIA, FIUBA).

**The core bet:** LLM prompting alone (no fine-tuning, no custom models) can extract narrative attributes rich enough to drive audiovisual enrichment that users perceive as meaningfully better than random selection.

---

## Glossary

**NCM (Narrative Context Map)** — The central artifact produced by the pipeline. A JSON document that merges the outputs of both LLM stages. It is the contract between all modules: the pipeline writes it, the reader and music/image services read it. Schema: `lectoria/models/ncm.py`.

**BookMap** — The output of LLM 1. Book-level context: title, genre, setting, full character list with physical descriptions, chapter summaries. One per book.

**ChapterAnalysis** — The output of LLM 2 for a single chapter. Scene segmentation with per-scene attributes. One per narrative chapter.

**Scene** — The atomic narrative unit. A continuous segment of a chapter with consistent emotional tone, setting, and characters. Defined by `{start_paragraph, end_paragraph}` integer ranges. Scenes cover all paragraphs without gaps or overlaps.

**Emotion** — A 9-value categorical classification assigned to each scene by LLM 2. Values: `joy`, `sorrow`, `tension`, `anger`, `peace`, `romance`, `mystery`, `excitement`, `wonder`. Designed backwards from what music can sonically distinguish (not Plutchik, not GoEmotions). The primary axis driving music matching.

**Pacing** — `slow | medium | fast`. Secondary axis for music matching, influencing tag vector composition.

**SceneType** — `action | dialogue | description | introspection | transition`. Tertiary axis for music matching.

**TransitionType** — `none | time_jump | pov_change | flashback | location_change`. Marks how one scene transitions to the next.

**MusicIndexEntry** — A curated track from the MTG-Jamendo dataset, pre-indexed with mood/theme tags, instrument tags, genre tags, and a one-hot tag vector. Stored in `data/music/music_index.json`.

**tag_vector** — A one-hot encoding of a track's (or scene's) mood/theme tags over the 59-tag MTG-Jamendo vocabulary. Used for cosine similarity ranking within an emotion-filtered candidate set.

**Style Preset** — A named filter (`cinematic`, `piano_only`, `ambient`, `synthwave`, `noir_jazz`, `auto`) that restricts music candidates by instrument/genre tags before cosine ranking. User-selectable. `auto` disables filtering.

**Coercion** — When LLM 2 returns an enum value outside the defined taxonomy (e.g. `"frustration"` instead of `"anger"`), the coercion layer maps it to the closest valid value. The original LLM value is preserved in `raw_<field>` on the Scene model for dev inspection.

**BYOK (Bring Your Own Key)** — The API key model: users supply their own LLM and image generation API keys via the frontend Settings page. Keys are stored in `localStorage` and sent per-request via headers. Never persisted server-side.

**book-id** — A filesystem-safe slug derived from `title + author` (e.g. `the-lord-of-the-rings-j-r-r-tolkien`). Used as the directory name under `data/books/`.

**BookStore** — The module that owns the on-disk artifact layout for a book: it maps a `book-id` to its directory and resolves/loads the artifacts under it (`ncm.json`, `bookmap.json`, `chapters.json`, `source.epub`, `images/{scenes,covers,characters,on_demand}/`). Encapsulates D15 (file-based storage) behind one seam so routes and services never build paths or run existence checks inline. The read side is injected into routes via FastAPI `Depends`. _Avoid_: book repository, book service.

**Ingestion** — The EPUB parsing step that produces `ChaptersData`: chapters with numbered paragraphs and a `is_narrative` flag. Runs before any LLM call.

**Offline Pipeline** — The full processing flow: ingestion → LLM 1 → LLM 2 (concurrent, per chapter) → NCM assembly → save to disk. Triggered by the user after upload. Takes 3–10 minutes depending on book length and provider.

**Online Reading** — What happens at read time: NCM + chapters loaded from disk, reader paginates scenes into pages, music matched per scene via tag similarity, images served per scene (see Scene Image, On-Demand Image).

**Scene Image** — The canonical image for a Scene, generated from the Scene's pipeline-authored `image_prompt` (D5). At most one per Scene. The reader requests it via the "Picture scene" action; the pipeline may also pre-generate it. Stored under `images/scenes/` (see BookStore).

**On-Demand Image** — An image the reader generates at read time from a passage they select, rather than from the Scene's `image_prompt`. Triggered by the "Picture this" popup. Scoped to the Scene the selection sits in. Stored under `images/on_demand/` (see BookStore).

**Developer View** — A toggle in the reader UI (Ctrl+D) that shows per-scene debug info: LLM model, attempt count, coercion events, music matching details (score, candidates, fallback used).

**Fallback** — When LLM 2 fails all retries for a chapter, a single-scene fallback is inserted covering all paragraphs with `emotion: mystery` and `is_fallback: true`.

---

## Key Design Decisions

These decisions are referenced as `(Decision N)` in the code. Full rationale in `.openspec-archive/changes/multimodal-reader-system/design.md`.

### Pipeline Architecture

**D1 — Two-stage pipeline (sequential, not iterative)**
LLM 1 runs first on the full book text and produces BookMap. LLM 2 runs per chapter, receiving chapter text + BookMap as context. Communication is one-directional. Characters discovered by LLM 2 but missing from BookMap are reconciled by a post-processing merge step.

**D2 — LLM 1 receives the full book in one shot**
Assumes 200K+ token context. No running summary, no multi-pass. Books >700 pages are an edge case deferred to later.

**D3 — Scene boundaries via numbered paragraphs**
Chapters are pre-split into numbered paragraphs (`[1] text...`). LLM 2 returns `{start_paragraph, end_paragraph}` integer ranges. Validated for no gaps and no overlaps. Robust because paragraph boundaries are unambiguous from HTML structure.

**D4 — 9-category emotion taxonomy**
Custom taxonomy designed backwards from musical distinguishability. Every emotion maps to a distinct sonic space. Categorical (not dimensional valence-arousal) because LLMs produce it more reliably and it maps cleanly to music tags.

**D5 — LLM 2 produces `image_prompt` directly**
Each scene includes a ready-to-use image generation prompt as part of LLM 2's output. No separate prompt-rewriter module.

### Music Matching

**D6 — Tag filtering + cosine similarity (no ML models)**
Two-phase retrieval: (1) filter by `emotion_primary`, (2) rank by cosine similarity of tag vectors. Fully deterministic. No CLAP, no audio embeddings.

**D12 — Hysteresis with emotion clusters**
Music does not change on every scene transition. Four clusters: Positive (joy/excitement/peace/wonder/romance), Dark (tension/anger), Melancholic (sorrow), Neutral (mystery). Cross-cluster transitions always trigger crossfade. Same-cluster transitions: crossfade only on long scenes. Prevents music from becoming distracting in chapters with many short, tonally similar scenes.

**D16 — One-hot tag vectors with hand-crafted mapping**
Scene attributes are mapped to Jamendo mood tags via a fixed mapping table (`EMOTION_TO_TAGS`, `PACING_TO_TAGS`, `SCENE_TYPE_TO_TAGS` in `lectoria/services/music.py`) then one-hot encoded. TF-IDF rejected as unnecessary for 200–500 tracks.

**D21–D23 — Instrument/genre tags and style presets**
`MusicIndexEntry` carries separate `instrument_tags` and `genre_tags` (not merged into tag_vector). Style presets are declarative `{include, exclude}` rules applied between emotion filtering and cosine ranking. Fallback chain: emotion+style → style only → emotion only.

### Reader UI

**D7 — Scene-based presentation (not epub.js pagination)**
Content is paginated by scene, not by arbitrary visual breakpoints. Each scene is a self-contained display unit. Music transitions synchronize to scene boundaries.

**D19 — Paginated e-reader with horizontal slide**
Scenes longer than ~250 words are split into pages at paragraph boundaries. Navigation is one page at a time with horizontal slide transition (Kindle/Apple Books style). Progressive reveal: users can only advance forward, back to already-seen pages.

### Infrastructure

**D13 — BYOK provider abstraction**
`LLMProvider` and `ImageProvider` Python protocols in `lectoria/providers/base.py`. All AI calls go through providers, never directly from services or routes. New providers = new module in `lectoria/providers/llm/` or `providers/image/`.

**D15 — File-based JSON storage**
One directory per book under `data/books/<book-id>/`. `ncm.json` is the primary artifact. No database. Appropriate for a single-user application. The layout is encapsulated behind the **BookStore** module (see Glossary) — callers ask the store for paths and artifacts rather than building `books_dir / book_id / …` themselves.

**D17 — BYOK via localStorage + per-request headers**
Keys stored in browser localStorage, sent as `X-Provider-LLM`, `X-API-Key-LLM`, `X-Provider-Image`, `X-API-Key-Image` headers. Discarded server-side after use. Security limitation documented in thesis.

**D34 — CORS restricted to the local dev frontend, no credentials**
`CORSMiddleware` allows only `http://localhost:5173` / `http://127.0.0.1:5173` (the Vite dev origin) with `allow_credentials=False`. Because BYOK keys ride in custom request headers rather than cookies (D17), credentialed CORS is never needed. The previous `allow_origins=["*"]` + `allow_credentials=True` was self-contradictory: Starlette reflects the caller's origin instead of sending `*` once credentials are enabled, so it effectively trusted every origin. Allowed origins live in `ALLOWED_ORIGINS` in `lectoria/app.py`.

**D18 — LLM output coercion + dev metadata**
~40-entry coercion tables for enum values LLMs commonly hallucinate. Original values preserved in `raw_*` fields. `ChapterAnalysis` carries `llm_model`, `attempt_count`, `is_fallback` for observability.

**D31 — CompletionResult return type**
`LLMProvider.complete()` returns `CompletionResult(text, prompt_tokens, completion_tokens)` — not a plain string. Token counts enable pipeline cost logging.

**D32 — 429 backoff inside provider**
Rate-limit retries (up to 3) with parsed or exponential backoff happen at the provider layer, not in the service layer. Keeps service retry budget for content failures.

**D28 — Google image provider: Gemini native image**
Uses `gemini-2.5-flash-image` via `generate_content`. Imagen via `generate_images` requires paid billing and deprecated model IDs.

---

## What's Not Here

- Prompt engineering details — see the prompt templates in `lectoria/services/narrative.py`
- API routes reference — see `README.md` and `http://localhost:8000/docs`
- Dev setup and commands — see `README.md` and `justfile`
- Coding rules and testing standards — see `.claude/rules/`
