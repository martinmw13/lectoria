## Context

This is a greenfield academic project (thesis for CEIA, FIUBA) building a web-based EPUB reader with AI-driven multimodal enrichment. The system uses a two-stage LLM pipeline to analyze narrative text and produce a Narrative Context Map (NCM), which then drives contextual music selection and image generation. All AI capabilities are consumed via external APIs (BYOK model). Single developer, ~600h budget, ~24 weeks.

The key architectural bet is that LLM prompting alone (no fine-tuning) can extract rich enough narrative attributes to drive coherent audiovisual enrichment that users perceive as superior to random selection.

## Goals / Non-Goals

**Goals:**
- Define the data flow from EPUB upload to enriched reading experience
- Specify the NCM JSON schema as the central contract between modules
- Establish the two-stage LLM pipeline design (LLM 1 + LLM 2)
- Define how music matching, image generation, and the reader UI consume the NCM

**Non-Goals:**
- Prompt engineering details (specific prompt templates are implementation-phase work)
- UI/UX wireframes or visual design
- API cost optimization strategies
- Deployment infrastructure

## Decisions

### Decision 1: Two-stage LLM pipeline (sequential, not iterative)

LLM 1 runs first on the full book and produces a book-level map. LLM 2 runs per-chapter, receiving the chapter text plus LLM 1's output as context. Communication is **one-directional** (LLM 1 → LLM 2), not iterative.

**Why not iterative?** An iterative loop (LLM 2 feeding corrections back to LLM 1) adds pipeline complexity, non-determinism, and cost for marginal quality gain. If LLM 2 discovers a character LLM 1 missed, the character is simply added to the per-chapter output without updating the global map. A post-processing merge step can reconcile discrepancies after all chapters are processed.

**Alternative considered:** Single LLM pass per chapter. Rejected because scene-level analysis benefits significantly from knowing the global character list, genre, and narrative arc.

### Decision 2: LLM 1 receives the full book in one shot

We assume 200K+ token context is available in the user-selected LLM provider. LLM 1 receives the entire book text in a single call and produces the book-level map. No running summary, no multi-pass, no chapter-by-chapter accumulation.

**Why?** Simplest possible pipeline. The LLM sees everything, character identification and relationship extraction benefit from full context. Books exceeding 200K tokens (~700+ pages) are an edge case to handle later.

**Alternative considered:** Chapter-by-chapter with running summary. Rejected as unnecessary complexity given current model context window sizes.

### Decision 3: Scene delimitation via numbered paragraphs

Chapters are pre-split into numbered paragraphs before being sent to LLM 2. The LLM returns scene boundaries as `{start_paragraph, end_paragraph}` integer ranges. This is the most robust approach because:
- Paragraph boundaries are unambiguous (derived from EPUB HTML structure)
- Integer ranges are easy to validate (no overlap, full coverage)
- No fragile string matching or marker insertion

**Validation rule:** scenes must cover all paragraphs in the chapter without gaps or overlaps. If the LLM output violates this, a fallback assigns orphan paragraphs to the nearest scene.

### Decision 4: Emotion taxonomy — 9 narrative-music aligned categories

Scenes are classified using a custom taxonomy designed for music matching:

| Category | Musical mapping |
|---|---|
| joy | happy, uplifting tracks |
| sorrow | sad, melancholic tracks |
| tension | dark, suspenseful tracks |
| anger | aggressive, intense tracks |
| peace | calm, ambient tracks |
| romance | warm, romantic tracks |
| mystery | mysterious, ethereal tracks |
| excitement | energetic, epic tracks |
| wonder | dreamy, atmospheric tracks |

**Why custom over Plutchik/GoEmotions?** Plutchik's "trust" and "anticipation" have no clear sonic signature. GoEmotions was designed for Reddit comments, not literary narrative. This taxonomy was designed backwards from what music can actually distinguish, ensuring every category maps to a distinct musical space.

**Why categorical over dimensional (valence-arousal)?** Categorical labels are easier for the LLM to produce reliably, easier to map to music tags, and easier to evaluate.

**Tension scalar dropped.** The original design included a separate tension scalar (1-5). This was dropped because the "tension" emotion category absorbs its function. A tense scene is simply `emotion: tension`. Combined with `pacing` and `scene_type`, there is enough signal for music matching without a redundant axis.

### Decision 5: No prompt rewriter module — LLM 2 produces image_prompt directly

Each scene includes an `image_prompt` field: a ready-to-use visual description for the image generation API. LLM 2 produces this as part of its scene analysis, since it already has full context (characters with physical descriptions from LLM 1, setting, emotion, the text itself).

This eliminates a separate "prompt rewriter" module and removes an extra LLM call from the pipeline.

**On-demand images use raw text.** When the user selects a text passage for illustration, the selection is sent directly to the image generation API with no LLM processing. The use case is visually rich but complex descriptions the user wants to see illustrated, not abstract/metaphorical text. No rewriting needed.

### Decision 6: Music matching via tag filtering + tag-derived vector ranking

Two-phase retrieval with no ML models:
1. **Filter:** use the scene's emotion to select tracks with compatible mood tags
2. **Rank:** within the candidate set, rank by cosine similarity between tag-derived vectors (scene attributes vs. track tags)

Tag-derived vectors are computed from the Jamendo mood/theme tags (e.g., one-hot or TF-IDF encoding). No pre-trained audio model (CLAP, Music2Emo) is used. Fully deterministic, no ML infrastructure needed.

**Alternative considered:** Pre-trained audio embeddings. Rejected to maintain the "no models" constraint and keep the system simple. Can be added later as an upgrade.

### Decision 7: Scene-based reader presentation

The frontend renders content scene-by-scene, not using epub.js's native pagination. Each scene is a scroll unit. Scene transitions trigger music crossfade and optional visual updates.

**Why abandon epub.js pagination?** epub.js pages split text at arbitrary visual breakpoints that don't respect narrative boundaries. A scene that spans 2.5 pages would trigger no transition in the middle despite being one continuous unit, or worse, the music would change mid-scene if paragraph-level tracking were used.

**Trade-off:** Loses the "book page" feel. Mitigated by allowing users to toggle between scene view and page view in settings.

### Decision 8: Character memory as image-reference passing

When generating an image that includes a known character:
1. Check if a previously generated image of that character exists
2. If yes, pass it as a reference image to the generation API (img2img or IP-Adapter style)
3. The character's physical description from LLM 1 is always included in the prompt

This is best-effort consistency, not guaranteed. The quality depends on the image generation API's reference image capabilities.

### Decision 9: Character identification via string matching + scene context fallback

Primary strategy: string matching against LLM 1's character list (names + aliases), with basic normalization (strip possessives like "'s"). When multiple characters match, all their descriptions are injected.

Fallback: when no character name is found in the selected text (e.g., pronouns like "he", or descriptors like "the ranger"), the system falls back to `scene.characters_present` from the NCM. If the scene has one character, that character's description is injected. If multiple, all are injected.

No spaCy, no separate NER model, no LLM call. Deterministic and fast.

### Decision 10: Pre-processing cost estimate

Before starting the offline pipeline, the system estimates and displays the cost:

1. Count tokens in the uploaded EPUB
2. Estimate LLM cost: LLM 1 (full book input + output) + LLM 2 (per chapter input + output)
3. Estimate image cost based on user settings: number of scenes x cost per image

Cost tiers driven by user settings:
- **Minimal:** NCM only, no automatic images (~$0.50/book)
- **Standard:** NCM + chapter covers only (~$1.00/book)
- **Full:** NCM + one image per scene + covers (~$3-5/book)
- **On-demand:** NCM + images only when user requests (~$0.50 base + ~$0.03/image)

The system shows the estimate before processing begins and displays a running cost counter during processing. Exact pricing depends on API rates at development time.

### Decision 11: Progressive scene reveal

The reader does not show a full page of text at once. Instead, it reveals content scene by scene within the page:

1. When the user navigates to a new page, only the first scene on that page is visible
2. Subsequent scenes on the same page are hidden
3. When the user taps/swipes (same gesture as a normal reader page turn), the next scene is revealed below the current one, building up the full page progressively
4. Once all scenes on a page are revealed, the next tap/swipe advances to the next page

This prevents narrative spoilers from music transitions or visual changes: the user doesn't see upcoming text that might be accompanied by a different emotional context. Each reveal triggers the appropriate music transition (subject to hysteresis, see Decision 12).

For scenes that span multiple pages, the scene continues across pages normally — the reveal mechanic only applies when multiple scenes share a single page.

### Decision 12: Music transition hysteresis with emotional distance

The music system does not change tracks on every scene transition. A crossfade only occurs when there is a meaningful emotional shift between consecutive scenes. The logic uses emotion clusters to determine distance:

**Emotion clusters:**

| Cluster | Emotions | Character |
|---|---|---|
| Positive | joy, excitement, peace, wonder, romance | Upbeat or calm, all positive valence |
| Dark | tension, anger | High energy, negative/threatening |
| Melancholic | sorrow | Low energy, negative — distinct from dark |
| Neutral | mystery | Bridges between clusters |

**Hysteresis rules:**

1. **Same emotion** → no track change (always)
2. **Same cluster** (e.g., peace → wonder, tension → anger) → no track change on short scenes, crossfade on long scenes
3. **Different cluster** (e.g., peace → anger, joy → sorrow) → always crossfade, regardless of scene duration
4. **Mystery** is neutral: transition to/from mystery follows the short-scene duration rule (suppress if short, crossfade if long)

This prevents the music from becoming distracting in chapters with many short scenes of similar emotional tone, while ensuring that genuine narrative shifts (e.g., a sudden turn from peace to violence) are always reflected in the music.

### Decision 13: BYOK provider abstraction layer

All external AI capabilities (LLM and image generation) are consumed through a provider abstraction. The user selects their preferred provider and supplies API keys. The backend instantiates the appropriate adapter at request time.

**Provider interfaces (Python protocols):**
- `LLMProvider`: `complete(prompt, system?) → str`, `max_context_tokens() → int`
- `ImageProvider`: `generate(prompt, reference_image?) → bytes`, `supports_reference_image() → bool`

Each provider implements these protocols. Services call providers through the interface, never directly.

**Implications:**
- Character memory (Decision 8) becomes conditional: reference images are passed only if `provider.supports_reference_image()` returns True
- LLM 1 requires large context; the system verifies `provider.max_context_tokens()` exceeds the book's token count before starting
- Cost estimation is provider-specific; each adapter exposes rate information or the system displays generic token counts
- Only one LLM provider and one image provider are active per processing session

**Starting point:** implement one concrete adapter per interface to validate the abstraction. Additional providers are trivial to add once the protocol is proven.

### Decision 14: Repository structure

Flat monorepo with the Python backend package at root and frontend in a subfolder:

```
lectoria/
├── pyproject.toml          # Backend (uv-managed)
├── lectoria/               # Python package
│   ├── app.py              # FastAPI application
│   ├── api/                # Route handlers
│   │   └── routes/
│   ├── models/             # Pydantic models (NCM schema = central contract)
│   │   └── ncm.py
│   ├── services/           # Domain logic
│   │   ├── ingestion.py
│   │   ├── narrative.py    # LLM 1 + LLM 2 orchestration
│   │   ├── music.py
│   │   └── image.py
│   ├── providers/          # External API adapters
│   │   ├── base.py         # LLMProvider / ImageProvider protocols
│   │   ├── llm/            # One module per provider
│   │   └── image/          # One module per provider
│   └── core/               # Config, dependencies
│       └── config.py
├── tests/
├── frontend/               # React + TypeScript
│   ├── package.json
│   └── src/
├── data/                   # Runtime data (gitignored)
│   ├── music/              # Curated Jamendo tracks
│   └── books/              # Uploaded EPUBs + NCMs
└── notebooks/              # Exploration, evaluation
```

**Why monorepo:** single developer, shared deployment, simpler CI. The NCM schema lives as Pydantic models in the backend; the frontend consumes it via API.

### Decision 15: NCM storage — file-based JSON

One directory per book under `data/books/`:

```
data/books/<book-id>/
├── source.epub               # Original upload
├── chapters.json             # Ingestion output (chapters + numbered paragraphs)
├── bookmap.json              # LLM 1 output (intermediate, for inspection/debug)
├── ncm.json                  # Complete NCM (LLM 1 + LLM 2 merged, includes dev metadata)
└── images/
    ├── covers/               # Chapter cover images
    ├── scenes/               # Automatic scene images
    └── characters/           # Character memory reference images
```

`book-id` is a slug derived from title + author. The full NCM is loaded in one file read — the natural access pattern. SQLite rejected as unnecessary complexity for a single-user application with no concurrent access or complex queries.

### Decision 16: Tag vector encoding — one-hot with mapping table

Scene attributes are mapped to the Jamendo tag vocabulary via a hand-crafted mapping table, then one-hot encoded. Track tags are one-hot encoded in the same vocabulary. Cosine similarity ranks candidates within the emotion-filtered set.

Mapping table examples:
- `emotion: sorrow` → `["sad", "melancholic", "sorrowful"]`
- `pacing: slow` → `["slow", "calm", "relaxed"]`
- `scene_type: introspection` → `["atmospheric", "contemplative"]`

TF-IDF rejected: with 200-500 tracks, IDF weights don't vary meaningfully. One-hot is deterministic and sufficient for ranking within a pre-filtered set of 20-50 candidates.

### Decision 17: BYOK key management — localStorage + per-request headers

API keys are stored in the browser's localStorage and sent to the backend in request headers per call. The backend extracts keys, instantiates the appropriate provider adapter, makes the API call, and discards the keys. Keys are never persisted server-side.

Request headers carry both provider selection and credentials: `X-Provider-LLM`, `X-Provider-Image`, `X-API-Key-LLM`, `X-API-Key-Image` (plus any provider-specific fields like project ID).

**Security posture:** localStorage is vulnerable to XSS. Acceptable for an academic demo without user accounts. For production: httpOnly cookies or a secret manager. This limitation is documented in the thesis.

### Decision 18: LLM output coercion layer + dev metadata

LLMs frequently invent enum values outside the defined taxonomy (e.g. "frustration" instead of "anger", "emotional_shift" instead of a valid transition_type). Rather than relying solely on retries (expensive, not guaranteed), a coercion layer maps near-miss values to valid enums before Pydantic validation.

**Coercion tables** map ~40 common LLM-invented values to their closest valid enum (e.g. frustration->anger, hope->wonder, contemplation->peace, flashback(scene_type)->transition, emotional_shift->none). Unknown values pass through for Pydantic to reject normally.

**Dev metadata on Scene:** When coercion occurs, the original LLM value is preserved in `raw_<field>` (e.g. `raw_emotion: "frustration"`, `emotion: "anger"`). These are `null` when no coercion was needed. This enables the frontend Developer View to show exactly what the LLM produced vs. what the system mapped it to.

**Dev metadata on ChapterAnalysis:**
- `llm_model`: which model produced the analysis (e.g. "gemini-2.5-flash")
- `attempt_count`: how many retry attempts were needed (1 = first try success)
- `is_fallback`: true if all retries failed and a single-scene fallback was used

**Developer View (frontend):** A toggle in the reader UI that shows per-scene debug info: assigned categories, raw LLM values, coercion events, music matching details (track selected, score, candidates), model/attempts metadata. Lightweight metadata lives inline in the NCM; heavy data (music candidates, vectors) goes in a sidecar file.

**Why coerce instead of retry?** A retry costs another API call, takes 5-10s, and the LLM may invent a different invalid value. Coercion is instant, deterministic, and covers the 90% case. Retries remain as a second line of defense for structurally broken responses.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    OFFLINE PIPELINE                              │
│                                                                 │
│  EPUB ──→ [Ingestion] ──→ chapters[] ──→ [LLM 1] ──→ book_map │
│               │                             │                    │
│               │                             ▼                    │
│               └── chapter[i] + book_map ──→ [LLM 2] ──→ NCM    │
│                                                     │           │
│  MTG-Jamendo ──→ [Tag Indexer] ──→ music_index      │           │
│                                                     │           │
│  NCM.scene.image_prompt ──→ [Image API] ──→ auto_images        │
│  NCM.cover_description  ──→ [Image API] ──→ covers             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ONLINE (READING)                              │
│                                                                 │
│  User reads scene[i]                                            │
│    ├──→ NCM[scene_i].emotion ──→ [Tag Matcher] ──→ track       │
│    │                                               ──→ audio    │
│    └──→ auto_images[scene_i] ──→ display (if enabled)          │
│                                                                 │
│  User selects text                                              │
│    ├──→ [String match characters] ──→ inject physical desc      │
│    └──→ raw text + char desc ──→ [Image API] ──→ display       │
└─────────────────────────────────────────────────────────────────┘
```

## NCM JSON Schema

### Book-level (LLM 1 output)

```json
{
  "book_id": "string (hash or slug)",
  "title": "string",
  "genre": "string",
  "setting": {
    "time_period": "string",
    "world": "string",
    "description": "string"
  },
  "characters": [
    {
      "id": "string (slug)",
      "name": "string",
      "aliases": ["string"],
      "physical_description": "string",
      "role": "protagonist | antagonist | secondary | minor",
      "relationships": [
        { "target_id": "string", "type": "string" }
      ]
    }
  ],
  "chapters": [
    {
      "chapter_index": "int",
      "title": "string",
      "summary": "string"
    }
  ]
}
```

### Chapter-level (LLM 2 output, one per chapter)

```json
{
  "chapter_index": "int",
  "cover_description": "string (image prompt for chapter cover)",
  "llm_model": "string (e.g. 'gemini-2.5-flash', Decision 18)",
  "attempt_count": "int (retries needed, 1 = first try)",
  "is_fallback": "bool (true if all retries failed)",
  "scenes": [
    {
      "scene_index": "int",
      "title": "string (short label)",
      "start_paragraph": "int",
      "end_paragraph": "int",
      "characters_present": ["character_id"],
      "emotion": "joy | sorrow | tension | anger | peace | romance | mystery | excitement | wonder",
      "pacing": "slow | medium | fast",
      "scene_type": "action | dialogue | description | introspection | transition",
      "setting": {
        "location": "string",
        "time_of_day": "string",
        "weather": "string"
      },
      "image_prompt": "string (ready-to-use prompt for image generation)",
      "transition_type": "none | time_jump | pov_change | flashback | location_change",
      "key_phrases": ["string (optional)"],
      "key_objects": ["string (optional)"],
      "raw_emotion": "string | null (original LLM value before coercion, Decision 18)",
      "raw_pacing": "string | null",
      "raw_scene_type": "string | null",
      "raw_transition_type": "string | null"
    }
  ]
}
```

### Music Index Entry

```json
{
  "track_id": "string",
  "file_path": "string",
  "duration_seconds": "float",
  "tags": ["string"],
  "emotion_primary": "joy | sorrow | tension | anger | peace | romance | mystery | excitement | wonder",
  "tag_vector": ["float"]
}
```

### Decision 19: Paginated e-reader navigation with horizontal slide

**Context:** The original reader used a vertical scroll model where all revealed scenes stacked. This had UX issues: no clear sense of pacing, auto-scroll was jarring, and the "page" metaphor was absent.

**Decision:** Replace with a paginated e-reader model:
- Scenes are split into pages with a max word limit (~250 words per page) at paragraph boundaries
- Navigation is one page at a time with horizontal slide transitions (like Kindle/Apple Books)
- Light theme is default (white background, serif font), dark mode optional
- Progressive reveal is maintained: users can only advance forward to unseen pages, backward to already-seen pages
- Scene header (title + emotion badge) appears only on the first page of each scene
- Dev info appears on the last page of each scene
- Footer shows scene title and page-within-scene position
- Keyboard navigation: left/right arrow keys

**Alternatives rejected:**
- **Continuous scroll:** Loses pacing; hard to know where you are in a scene.
- **Scene-per-page:** Scenes can be very long (1000+ words); forcing them to one page means tiny text or endless scrolling within the "page."

### Decision 20: Code quality and performance standards

Post-implementation review identified patterns that need hardening before evaluation.

**Performance:**
- **Vectorize batch computations.** `_cosine_similarity` in `music.py` creates numpy arrays per call inside a loop. Track tag vectors should be pre-stacked into a numpy matrix at index load time. Scene-to-track matching becomes a single matrix multiply + normalization instead of N individual cosine calls. At 500 tracks x 200 scenes this matters.
- **Parallelize independent LLM calls.** `run_pipeline` processes chapters sequentially (`for chapter in chapters: await analyze_chapter(...)`). These calls are independent once `book_map` exists. Use `asyncio.gather` with a concurrency semaphore (e.g., 3-5 concurrent) to reduce pipeline wall time proportionally.
- **Lazy-load binary resources.** `_load_character_refs` loads all character PNGs into memory eagerly. Load on-demand when a scene actually references that character.
- **Cache settings.** `get_settings()` instantiates `Settings()` (parses env vars) on every call. Use `functools.lru_cache` or module-level singleton.

**Code organization:**
- **Split `books.py` (429 LOC) by domain.** Currently handles book CRUD, pipeline SSE, music endpoints, image endpoints, and crossfade logic. Split into `routes/books.py`, `routes/music.py`, `routes/images.py`. Move domain lookups (finding chapter/scene in NCM by index) to service helpers.
- **Route handlers should be thin adapters.** Current handlers contain domain logic (assembling stream URLs, scanning NCM for chapters). This should live in services.
- **`ncm.py` model grouping.** Keep the NCM contract models together (they form a cohesive schema). Extract `MusicIndexEntry` and ingestion models (`Paragraph`, `Chapter`, `ChaptersData`) only if the file grows past ~300 lines.

**Correctness:**
- **`generate_on_demand` calls `identify_characters` three times** on the same inputs (lines 228, 232, 243 in `image.py`). Call once, reuse the result.
- **`on_progress` type annotations** use string forward references (`"Callable | None"`) because `Callable` isn't imported. Use proper `Callable[[str, str], None] | None` from `collections.abc`.

**Testing:**
- Zero tests exist. All deterministic service logic (coercion, JSON extraction, character identification, scene validation, music matching, hysteresis) is pure-function and trivially testable. Test coverage is required before evaluation phase.

**Alternatives considered:** Deferring performance work until evaluation reveals bottlenecks. Rejected because vectorization and parallelism are not premature optimization here — they're standard patterns for the known data shapes (hundreds of tracks, dozens of chapters), and the current code explicitly loops where it shouldn't.

## Risks / Trade-offs

**[LLM output reliability]** → LLMs may produce malformed JSON, miss scenes, or misclassify emotions. Mitigation: strict JSON schema validation with retry logic; fallback defaults for missing fields; post-processing validation that scenes cover all paragraphs without gaps.

**[Scene detection quality]** → No ground truth for scene boundaries in arbitrary books. Mitigation: manual gold-standard annotation on 3-5 test books for evaluation; accept that "correct" segmentation is subjective.

**[API cost accumulation]** → Processing a full book through LLM 1 + LLM 2 + image generation can be expensive. Mitigation: BYOK model puts cost on user; settings to control image generation frequency; lazy loading option; cost estimation before processing.

**[Music library coverage]** → A curated subset of 200-500 tracks may not cover all 9 emotion categories evenly. Mitigation: ensure at least 3-5 tracks per emotion category during curation; use tag vector ranking to maximize variety within constraints.

**[Character memory limitations]** → Image generation APIs have varying support for reference images. Some may ignore the reference entirely. Mitigation: treat character consistency as best-effort; document which APIs support it; evaluate quality empirically.

**[Tag-derived vectors expressiveness]** → Tag vectors are less expressive than audio embeddings. Two tracks with identical tags get identical vectors. Mitigation: accept this limitation for MVP; upgrade to audio embeddings (CLAP/Music2Emo) if variety becomes a problem.

**[Provider fragmentation]** → Different providers have different capabilities (context window size, reference image support, response format, rate limits). Mitigation: the provider protocol defines a minimal interface; capability checks (e.g., `supports_reference_image()`, `max_context_tokens()`) let services degrade gracefully. Start with one provider (Google) and validate the abstraction before adding others.

**[Raw text as image prompt]** → Sending literary text directly to an image model without rewriting may produce poor results for metaphorical passages. Mitigation: the on-demand feature targets visually descriptive passages selected by the user; abstract text is not the expected input. Automatic images use LLM 2's image_prompt which is already written for visual generation.
