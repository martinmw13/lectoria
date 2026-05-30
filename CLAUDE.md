# Lectoria

Lector de texto con enriquecimiento multimodal basado en análisis narrativo. Multimodal EPUB reader with AI-driven narrative enrichment. Academic thesis project (CEIA, FIUBA).

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
- PRs: use the PR template (`gh pr create --draft`). Do NOT add AI co-author or mention AI assistance in the PR body.
- User-visible changes: use a conventional commit message (`feat:`, `fix:`) with a clear description — release-please generates `CHANGELOG.md` automatically. Do not edit `CHANGELOG.md` by hand.

## Domain Language

Read `CONTEXT.md` at the repo root before working in the codebase. It defines the canonical vocabulary (NCM, BookMap, ChapterAnalysis, Scene, emotion taxonomy) and records the load-bearing design decisions (numbered D1–D33) that appear as `(Decision N)` comments throughout the code.

## Known Technical Debt

- **No typecheck in CI** for backend. `pyright` is wired in `justfile` but not yet enforced — opt-in until the codebase is clean.

## Agent Skills

### Issue Tracker

Issues live in GitHub Issues (github.com/martinmw13/lectoria). See `docs/agents/issue-tracker.md`.

### Triage Labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain Docs

Single-context repo — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Picking Work

How to choose the next issue and which issues can run in parallel (issues are parallel-safe when their `Touches:` sets are disjoint). See `docs/agents/picking-work.md`.
