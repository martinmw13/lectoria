# Lectoria — Dev Guide

## CEIA · FIUBA — Academic Thesis Project

*June 2026*

- [Objective](#objective)
- [General Overview](#general-overview)
  - [Design Assumptions](#design-assumptions)
- [High Level Flow](#high-level-flow)
- [The Implementation](#the-implementation)
  - [Ingestion](#ingestion)
  - [The Pipeline (two LLM stages)](#the-pipeline-two-llm-stages)
  - [NCM — the central artifact](#ncm--the-central-artifact)
  - [Music Matching](#music-matching)
  - [Image Generation](#image-generation)
  - [Providers & BYOK](#providers--byok)
- [Services (HTTP API)](#services-http-api)
  - [Books](#books)
  - [Music](#music)
  - [Images](#images)
  - [Static media](#static-media)
- [Configuration](#configuration)
- [Repository Structure](#repository-structure)
- [Development Workflow](#development-workflow)
- [Deployments](#deployments)

---

## Objective

Lectoria enriches the EPUB reading experience with **contextually matched music** and
**AI-generated images** that respond to the narrative. Each scene of a book is classified
by emotion, pacing, and scene type; that classification then drives which Jamendo track
plays and which image appears as the reader moves through the text.

This guide documents the system for **developers**: the architecture, the request/response
contracts, the repository layout, and the workflows for building and shipping changes. For
a feature-level walkthrough aimed at readers, see the [User Guide](./user-guide.md). For an
architecture-first deep dive with diagrams, see [`onboarding.html`](./onboarding.html).

**The academic bet**: LLM prompting alone (no fine-tuning) can extract narrative attributes
rich enough that users perceive the enrichment as meaningfully better than random selection.

## General Overview

```
EPUB  ──►  Ingestion  ──►  Two-stage LLM pipeline  ──►  NCM (Narrative Context Map)
                                                          │
                                          ┌───────────────┼────────────────┐
                                          ▼               ▼                ▼
                                   Music matching   Image generation   Reader UI
                                   (deterministic)  (Gemini Flash)     (React SPA)
```

The backend is a **FastAPI** application (Python 3.14, served by Uvicorn). The frontend is a
**React + TypeScript** single-page app built with Vite. All AI is **BYOK** (Bring Your Own
Key): the browser holds the user's Google Gemini key in `localStorage` and sends it as a
request header on each call; the server never stores it.

The pipeline produces a single JSON document per book — the **Narrative Context Map (NCM)** —
which is the contract every downstream feature reads.

### Design Assumptions

- **Single user, no concurrency.** Storage is file-based JSON (one directory per book); no
  database. SQLite was rejected as unnecessary for a single-user thesis demo (Decision D15).
- **Large context window.** LLM 1 receives the full book in one shot, assuming a 200K+ token
  context window. Books over ~700 pages are a deferred edge case (Decision D2).
- **No local inference.** Every AI call is BYOK against the Google Gemini API. There is no
  audio generation — music is pre-recorded Jamendo tracks selected deterministically.
- **Prompting over fine-tuning.** The narrative attributes are extracted purely through
  prompt design, never model training — this is the thesis hypothesis under test.

## High Level Flow

1. **Upload.** The user uploads an EPUB. The backend ingests it into numbered paragraphs and
   returns a **cost estimate** (chapter/paragraph counts + token estimate) so the user can
   decide whether to proceed.
2. **Process.** The user triggers processing. The two-stage LLM pipeline runs and streams
   progress over **Server-Sent Events (SSE)**. The result — the NCM — is persisted to disk.
3. **Read.** The frontend loads the NCM and the ingested chapters, paginates scenes into
   pages, and as the reader advances it asks the backend for the **matched music track** and
   (on demand) **generated images** for the current scene.

## The Implementation

### Ingestion

`lectoria/services/ingestion.py` parses the EPUB (ebooklib + BeautifulSoup) into a
`ChaptersData` model: a list of chapters, each with numbered `Paragraph`s. Non-narrative
chapters (front matter, TOC, etc.) are flagged `is_narrative = False` and excluded from the
LLM pipeline. Paragraph numbering is load-bearing: scene boundaries are later expressed as
integer paragraph ranges (Decision D3).

### The Pipeline (two LLM stages)

Implemented in `lectoria/services/pipeline.py` and `lectoria/services/narrative.py`. Takes
3–10 minutes per book and streams progress via SSE.

- **LLM 1 (book-level).** Receives the full book and produces a `BookMap`: title, genre, and
  the cast of `Character`s with physical descriptions. One shot, full context (Decision D2).
- **LLM 2 (chapter-level).** Runs per narrative chapter with the `BookMap` as context and
  produces a `ChapterAnalysis`: the chapter split into `Scene`s, each carrying an emotion,
  pacing, scene type, a `{start_paragraph, end_paragraph}` range, and a ready-to-use
  `image_prompt` (Decision D5).

Both stages route through one shared deep module — `complete_to_model()` in
`lectoria/services/llm_json.py` — which calls the provider, extracts JSON from the response
(stripping markdown fences), validates it against the target Pydantic model, and retries on
failure. It returns a `StructuredCompletion` (parsed model + aggregated `TokenUsage`) and
raises `StructuredCallError` once retries are exhausted.

Two independent retry budgets apply:

- **Content retries** (up to 3) — in `narrative.py`, for JSON parse failures, validation
  errors, or missing fields.
- **Rate-limit retries** (up to 3) — inside the provider (`providers/llm/google.py`), for
  429 / `RESOURCE_EXHAUSTED`, using the API's `retryDelay` or exponential backoff from 30s.

LLM 2 frequently hallucinates enum values; rather than retry, ~40 **coercion rules** map
them onto the canonical taxonomy, preserving the originals in `raw_*` fields (Decision D18).

### NCM — the central artifact

The **Narrative Context Map** (`lectoria/models/ncm.py`) merges the two stages into one JSON
document per book, stored at `data/books/{book-id}/ncm.json`. It is the single contract every
downstream feature reads. Roughly:

```jsonc
{
  "book_map": {
    "title": "The Name of the Wind",
    "genre": "fantasy",
    "characters": [ { "id": "kvothe", "name": "Kvothe", "physical_description": "..." } ]
  },
  "chapters": [
    {
      "chapter_index": 0,
      "title": "A Place for Demons",
      "scenes": [
        {
          "scene_index": 0,
          "emotion": "tension",
          "pacing": "slow",
          "scene_type": "action",
          "start_paragraph": 0,
          "end_paragraph": 12,
          "image_prompt": "A dim country inn at night, ...",
          "tag_vector": { "...": 0.0 }
        }
      ]
    }
  ]
}
```

The emotion taxonomy is a **9-category** set (joy, sorrow, tension, peace, romance, mystery,
excitement, wonder, anger) designed backwards from *musical distinguishability*, not from
psychology (Decision D4).

### Music Matching

`lectoria/services/music.py`. Fully **deterministic** — no ML inference at read time. The
track library is a curated subset of the [MTG-Jamendo dataset](https://mtg.github.io/mtg-jamendo-dataset/),
indexed in `data/music/music_index.json`.

Matching pipeline for a scene:

1. **Emotion filter** — keep tracks tagged with the scene's primary emotion.
2. **Style filter** — apply the optional style preset's `{include, exclude}` tag rules.
3. **Cosine ranking** — rank surviving tracks by cosine similarity of tag vectors.
4. **Variety / hysteresis** — avoid repeating the previous track, and only change tracks on
   meaningful emotional shifts using four emotion *clusters* (`positive` / `dark` /
   `melancholic` / `neutral`). Cross-cluster transitions always crossfade; same-cluster
   transitions crossfade only on long scenes (Decision D12).

**Style presets** (`STYLE_PRESETS`): `auto`, `cinematic`, `piano_only`, `ambient`,
`synthwave`, `noir_jazz`. A track matches a preset if it has ≥1 included tag and 0 excluded
tags.

### Image Generation

`lectoria/services/image.py`, provider `providers/image/google.py`. Uses **Gemini Flash
Image** (`gemini-2.5-flash-image` via `generate_content`), not Imagen — Imagen requires paid
billing and deprecated IDs, while Flash Image aligns with typical Gemini API keys
(Decision D28).

Two modes:

- **Scene images** — generated from the LLM-produced `image_prompt` and cached on disk.
- **On-demand images** — generated from arbitrary reader-selected text, with character
  physical descriptions injected by string matching (Decision D9).

Character consistency is **prompt-only**: Gemini Flash Image does not support reference
images, so there is no true character memory across generations.

### Providers & BYOK

All LLM/image SDK access lives behind Python `Protocol` interfaces in
`lectoria/providers/base.py`; services never import an SDK directly. Concrete adapters
register themselves in `lectoria/providers/registry.py`:

- `GeminiLLMProvider` (`providers/llm/google.py`)
- `GeminiImageProvider` (`providers/image/google.py`)

A new provider is a new module plus a `register_llm_provider()` / `register_image_provider()`
call. Providers are resolved **per request** by FastAPI dependencies in
`lectoria/api/deps.py`, which read the BYOK headers and instantiate a request-scoped provider
with the caller's key. The key lives in memory for the duration of the request and is
discarded when it ends (Decision D13 / D17).

**BYOK request headers:**

| Header | Purpose |
|--------|---------|
| `X-Provider-LLM` | LLM provider name (e.g. `google`) |
| `X-API-Key-LLM` | LLM API key |
| `X-Provider-Image` | Image provider name (optional, image endpoints only) |
| `X-API-Key-Image` | Image API key (optional) |

## Services (HTTP API)

FastAPI app in `lectoria/app.py`. Routers are mounted under `/api`. Interactive docs at
`http://localhost:8000/docs` (Swagger UI) when running locally. CORS is restricted to the dev
frontend origins (`http://localhost:5173`, `http://127.0.0.1:5173`) with
`allow_credentials=False` — BYOK keys ride in headers, never cookies (Decision D34).

`GET /health` → `{ "status": "ok" }`.

### Books

Mounted at `/api/books` (`lectoria/api/routes/books.py`).

| Method & Path | Description |
|---------------|-------------|
| `GET /api/books/` | List uploaded books → `{ "books": [BookSummary] }` |
| `POST /api/books/upload` | Upload an EPUB (multipart `file`), ingest it, return a `CostEstimate` |
| `POST /api/books/{book_id}/process` | Run the pipeline; SSE progress stream. Query: `max_chapters`, `force` |
| `GET /api/books/{book_id}` | Book metadata + NCM status → `BookResponse` |
| `GET /api/books/{book_id}/chapters` | Ingested chapters with paragraph text → `ChaptersData` |
| `GET /api/books/{book_id}/ncm` | The complete NCM → `NCM` |

**`POST /api/books/upload`** — `multipart/form-data` with an `.epub` file. Returns:

```json
{
  "book_id": "the-name-of-the-wind",
  "total_chapters": 24,
  "narrative_chapters": 22,
  "total_paragraphs": 4120,
  "estimated_tokens": 612340,
  "message": "22 narrative chapters, ~612,340 tokens. LLM 1 will process the full book. LLM 2 will process 22 chapters individually."
}
```

A non-`.epub` upload returns `400`.

**`POST /api/books/{book_id}/process`** — requires BYOK LLM headers. Returns an SSE stream
(`text/event-stream`):

```
event: progress
data: ingestion: Done: 22 narrative chapters

event: progress
data: llm1: Done: 'The Name of the Wind', 14 characters | tokens: prompt=48230 completion=1840 total=50070

event: progress
data: llm2: Chapter 3/22: The Bonfire

event: progress
data: complete: NCM saved to data/books/the-name-of-the-wind | total tokens: ...

event: progress
data: done: the-name-of-the-wind
```

Returns `404` if the book was never uploaded, and `409` if it is already processed (pass
`force=true` to reprocess).

### Music

Mounted at `/api` (`lectoria/api/routes/music.py`).

| Method & Path | Description |
|---------------|-------------|
| `GET /api/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/track` | Matched track for a scene |
| `GET /api/books/{book_id}/chapters/{chapter_idx}/scenes/{scene_idx}/crossfade` | Hysteresis decision for a transition |
| `GET /api/music/presets` | Available style presets → `[MusicPreset]` |

**`…/track`** — query params: `previous_track_id`, `exclude` (comma-separated IDs to skip),
`detailed` (include dev metadata: candidates, scores, vectors), `style` (preset name). An
invalid `style` returns `400`; a missing book/scene returns `404`. Default response:

```json
{
  "track_id": "track_0001234",
  "file_path": "00/0001234.mp3",
  "stream_url": "https://...jamendo.../1234",
  "cached": true,
  "duration_seconds": 184,
  "tags": ["cinematic", "tension", "strings"],
  "emotion_primary": "tension"
}
```

With `detailed=true` the response is a `DetailedSceneTrackResponse` (adds `score`,
`fallback`, `style_applied`, ranked `candidates`, and the scene's `scene_vector`).

**`…/crossfade`** — query params: `prev_chapter_idx`, `prev_scene_idx`. Returns whether a
crossfade should occur and the emotion clusters involved:

```json
{
  "should_crossfade": true,
  "current_emotion": "tension",
  "previous_emotion": "peace",
  "current_cluster": "dark",
  "previous_cluster": "positive"
}
```

### Images

Mounted at `/api/books` (`lectoria/api/routes/images.py`). Both require BYOK image headers.

| Method & Path | Body | Response |
|---------------|------|----------|
| `POST /api/books/{book_id}/images/generate` | `ImageGenerateRequest` | `OnDemandImageResponse` |
| `POST /api/books/{book_id}/images/scene` | `SceneImageRequest` | `SceneImageResponse` |

**`…/images/generate`** — on-demand from selected text:

```json
// request
{ "selected_text": "the great stone bridge", "chapter_index": 2, "scene_index": 1 }

// response
{ "image_base64": "iVBORw0KGgo...", "content_type": "image/png", "cache_url": "/api/data/books/<id>/images/on_demand/ch2_sc1.png" }
```

Scene coordinates are optional (lenient lookup); without them the image is generated from the
text alone and `cache_url` is `null`. Generation failure returns `502`.

**`…/images/scene`** — generate (or return cached) a scene image from its `image_prompt`:

```json
// request
{ "chapter_index": 2, "scene_index": 1 }

// response
{ "cache_url": "/api/data/books/<id>/images/scenes/ch2_sc1.png", "generated": true }
```

`generated` is `false` when a cached image already existed. A scene with no `image_prompt`
returns `400`; generation failure returns `502`.

### Static media

When the data directories exist, the app mounts static file servers:

- `GET /api/music/{shard}/{track_id}.mp3` — cached Jamendo audio.
- `GET /api/data/books/{book_id}/images/...` — generated images (the `cache_url`s above).

## Configuration

All env vars use the `LECTORIA_` prefix, parsed by `lectoria/core/config.py` (pydantic-settings,
cached with `lru_cache`).

| Variable | Default | Purpose |
|----------|---------|---------|
| `LECTORIA_DATA_DIR` | `<repo>/data` | Root data directory |
| `LECTORIA_BOOKS_DIR` | `data/books` | Uploaded EPUBs + NCM artifacts |
| `LECTORIA_MUSIC_DIR` | `data/music` | Curated tracks + `music_index.json` |
| `LECTORIA_LOG_LEVEL` | `INFO` | Python logging level |

API keys are **not** server-side config — they are sent per request from the browser (BYOK).

## Repository Structure

```
lectoria/                  ← backend package
├── app.py                 ← FastAPI app factory, CORS, router + static mounts, /health
├── api/
│   ├── deps.py            ← DI: BYOK provider resolution, BookStore, scene/NCM-or-404 helpers
│   └── routes/
│       ├── books.py       ← upload, process (SSE), get book / chapters / ncm
│       ├── music.py       ← track matching, crossfade, presets
│       └── images.py      ← scene + on-demand image generation
├── core/config.py         ← LECTORIA_* settings (pydantic-settings)
├── models/ncm.py          ← NCM, BookMap, ChapterAnalysis, Scene, Character (the contract)
├── providers/
│   ├── base.py            ← LLM/Image Protocol interfaces
│   ├── registry.py        ← register_/get_ provider functions
│   ├── llm/google.py      ← GeminiLLMProvider (+ 429 backoff)
│   └── image/google.py    ← GeminiImageProvider (Gemini Flash Image)
└── services/
    ├── ingestion.py       ← EPUB → ChaptersData (numbered paragraphs)
    ├── pipeline.py        ← orchestrates LLM 1 → LLM 2 → NCM, emits SSE progress
    ├── narrative.py       ← LLM stages + content retries + enum coercion
    ├── llm_json.py        ← complete_to_model(): JSON extraction, validation, retries
    ├── music.py           ← tag vectors, cosine matching, hysteresis, style presets
    ├── image.py           ← scene + on-demand image generation
    └── bookstore.py       ← BookStore seam over data/books (paths, load, ArtifactNotFound)

frontend/src/              ← React + TypeScript SPA (Vite)
├── api/
│   ├── client.ts          ← all backend calls
│   ├── byok.ts            ← reads API keys from localStorage → request headers
│   ├── prefs.ts           ← non-secret UI preferences (music style)
│   ├── sseParser.ts       ← fetch + ReadableStream SSE parser (ADR-0001)
│   ├── schema.json/.d.ts  ← generated from the backend OpenAPI schema (just gen-api-types)
│   └── types.ts           ← re-exports the named OpenAPI components (single source of truth)
├── pages/                 ← UploadPage, ReaderPage, SettingsPage
├── components/            ← PageView, ChapterNav, MusicPlayer, DevPanel
├── hooks/                 ← useBookProcessing, useCrossfadeAudio, useReaderCursor, useSceneImage
├── audio/crossfadePlayer.ts  ← framework-free dual-track audio engine (ADR-0002)
├── reader/cursor.ts       ← pure offset → (chapter, scene, page) mapping
└── utils/paginate.ts      ← scene → ~250-word pages at paragraph boundaries

scripts/                   ← download_music.py, build_music_index.py, test_pipeline.py, …
tests/                     ← pytest suite (backend); frontend Vitest tests live alongside src
docs/                      ← onboarding.html, adr/, this guide, user-guide
```

## Development Workflow

```bash
just install        # uv sync + pre-commit install + frontend npm install
just dev            # backend dev server (http://localhost:8000)
just dev-frontend   # frontend dev server (http://localhost:5173)
just dev-all        # both in one terminal (Ctrl-C stops both)

just test           # backend tests (pytest)
just test-frontend  # frontend tests (Vitest)
just check          # ruff lint + format check (no auto-fix)
just fmt            # auto-fix lint + format
just typecheck      # pyright (opt-in, not in CI)
just gen-api-types  # regenerate frontend API types from the backend OpenAPI schema
```

**API type contract.** The frontend types are generated from the backend's OpenAPI schema,
not hand-written. After changing any backend route or response model, run
`just gen-api-types` and commit both `frontend/src/api/schema.json` and `schema.d.ts` — a CI
job (`api-types-drift`) regenerates them and fails the build if the committed files are stale.

**Change classification** (see `.claude/rules/workflow.md`): **S** = implement → test → PR;
**M** = brainstorm → implement; **L** = research → plan → implement. Use conventional commits
(`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`) — release-please generates the
changelog automatically.

## Deployments

Lectoria currently targets **local execution** (thesis demo). The backend is a long-running
Uvicorn process (`just dev`); the frontend is a Vite SPA (`just dev-frontend`) or a static
build (`npm run build`). Because the pipeline is a multi-minute, stateful, disk-writing
process, serverless hosts (e.g. Vercel) cannot run the backend — only the static frontend.
A containerized backend on a persistent host (VPS / PaaS with a mounted volume for `data/`)
is the path for a hosted deployment. There is no production deployment pipeline yet.
