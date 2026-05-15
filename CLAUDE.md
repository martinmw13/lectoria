# Lectoria

Lector de texto con enriquecimiento multimodal basado en análisis narrativo. Multimodal EPUB reader with AI-driven narrative enrichment.

**Stack**: Python 3.14 + FastAPI + Uvicorn + Pydantic + Google Gemini API (`google-genai`) + ebooklib + BeautifulSoup + React + TypeScript + Vite + uv + ruff + pytest

## Boundaries

- **Autonomous**: Tests, docs, comments (in feature branch), ruff formatting, type hints
- **Ask first**: Application/pipeline code changes, new API routes, changes to AI prompts
- **Prohibited**: Secrets and credential files (`api_keys.env`, `.env*`), production data, merge to main without PR, modifications to `frontend/dist/`

## Scoped Rules

Architecture, testing, and workflow patterns are in `.claude/rules/` with glob-based auto-loading.

## Required Workflows

- Changes with multiple valid approaches: brainstorm before implementing
- All changes: run tests before committing
- PRs: use PR template with AI attribution
- User-visible changes: use a conventional commit message (`feat:`, `fix:`) with a
  clear description — release-please generates `CHANGELOG.md` automatically from commits.
  Do not edit `CHANGELOG.md` by hand.

## Known Technical Debt

- **No typecheck in CI** for backend. `pyright` is wired in `justfile` but not yet enforced — opt-in until the codebase is clean.
