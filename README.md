# Lectoria

Multimodal EPUB reader with AI-driven narrative enrichment: a two-stage LLM pipeline produces a **Narrative Context Map (NCM)** that drives contextual music (Jamendo tag matching) and image generation (BYOK). Academic project (CEIA, FIUBA).

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.14, FastAPI, Pydantic, ebooklib |
| LLM / images | Google Gemini / Gemini image (pluggable providers) |
| Frontend | React, TypeScript, Vite |

## Requirements

- **Python 3.14** (see `.python-version`)
- **[uv](https://docs.astral.sh/uv/)** for the backend venv and dependencies
- **Node.js** (e.g. 20+) for the frontend

## Setup

```bash
just install   # uv sync --all-extras + pre-commit install + npm install
```

Or manually:

```bash
uv sync --all-extras   # backend deps including dev
cd frontend && npm install && cd ..
```

Runtime data lives under `data/` (books, music index). Those paths are gitignored except what you add manually.

## Run locally

Development runs two processes: the **FastAPI backend** and the **Vite dev server** for the React client. They listen on **separate ports**. Interactive use is through the **client** at port 5173; the SPA communicates with the API on port 8000 (CORS is enabled for local development).

| Process | Default port | Base URL |
|---------|--------------|----------|
| API (FastAPI / Uvicorn) | 8000 | http://localhost:8000 |
| Client (Vite) | 5173 | http://localhost:5173 |

**API only** — REST endpoints and OpenAPI UI at http://localhost:8000/docs:

```bash
just dev
```

**Client only** — run when the API is already available on port 8000:

```bash
just dev-frontend
```

Navigate to http://localhost:5173.

Use http://localhost:5173 as the application entry point; the API runs on http://localhost:8000.

## Configuration

Environment variables use the prefix `LECTORIA_` (see `lectoria/core/config.py`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LECTORIA_DATA_DIR` | `<repo>/data` | Root data directory |
| `LECTORIA_BOOKS_DIR` | `data/books` | Uploaded EPUBs and NCM artifacts |
| `LECTORIA_MUSIC_DIR` | `data/music` | Curated tracks + `music_index.json` |
| `LECTORIA_LOG_LEVEL` | `INFO` | Logging level |

**BYOK:** API keys are not stored on the server. The client sends provider choice and keys per request (see `lectoria/api/deps.py`).

## API overview

Base URL: `http://localhost:8000`

| Area | Prefix | Notes |
|------|--------|-------|
| Books | `/api/books` | Upload, process (SSE), list, NCM, chapters |
| Music | `/api/books/.../track`, `.../crossfade` | Scene-to-track matching |
| Images | `/api/books/.../images/generate` | On-demand generation |
| Static | `/api/music`, `/api/data/books` | Served when dirs exist |
| Health | `/GET /health` | Liveness |

OpenAPI: http://localhost:8000/docs

## Tests

```bash
just test         # all tests
just check        # lint + format check
just typecheck    # pyright (opt-in, not yet in CI)
```

## Project layout

```
lectoria/           # Python package (api, models, services, providers)
frontend/           # React reader + settings (BYOK)
notebooks/          # Exploration / evaluation
data/               # Runtime (gitignored under books/music as configured)
```

## License

See project metadata in `pyproject.toml` if specified.
