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

## Known Technical Debt

- **Frontend lint is non-blocking in CI** (`continue-on-error: true` on the lint step in `.github/workflows/ci.yml`). The prototype phase left 3 real React issues in `DevPanel.tsx` and `ReaderPage.tsx` (TDZ violations, synchronous setState in `useEffect`, missing hook dependencies). These are bugs, not style preferences. Re-enable lint as blocking once a dedicated frontend cleanup PR fixes them.
- **No typecheck in CI** for backend. `pyright` is wired in `justfile` but not yet enforced — opt-in until the codebase is clean.
