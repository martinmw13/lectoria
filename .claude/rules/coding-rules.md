# Coding Rules

## Python

- Functions MUST NOT exceed 50 lines. Break into smaller helpers.
- NEVER define functions inside other functions. Extract to module/class level.
- NEVER add `# noqa` without explicit documented justification.
- Refactor functions triggering C901 or PLR0915 into smaller functions.
- Line length max 100 chars.
- Import order: stdlib -> third-party -> first-party -> local.
- Use `logger.info/error` not `print()`.
- No bare `except: pass` — log or re-raise.

## FastAPI

- All route handlers must be `async def` — no sync routes.
- Use Pydantic models for all request/response bodies; no raw `dict` in route signatures.
- Route handlers must stay thin: validate input, delegate to a service, return output.
- Never raise `HTTPException` from service or provider layers — only from routes.

## AI Provider (BYOK architecture)

- All LLM/AI provider calls live in `lectoria/providers/` — never call provider SDKs directly from routes or services.
- Providers must be interchangeable: accept a config object that includes model name and API key; no hardcoded provider names.
- Never log or serialize raw API keys; redact them in debug output.
- Streaming responses must use SSE via `sse-starlette`; never buffer complete LLM output before sending.

## Notebooks (`notebooks/`)

- Notebooks are for exploration only; all production code lives in `lectoria/`.
- Never commit notebooks with outputs — use `nbstripout` or clear outputs before commit.
- Never use magic commands (`%`, `!`) in files that will be extracted to production scripts.
- When extracting notebook code: restart kernel, run all cells top-to-bottom, then extract into named functions.

## TypeScript / React (`frontend/`)

- Strict mode enabled — no `any` types.
- Prefer `interface` over `type` aliases for object shapes.
- SSE connections must be closed on component unmount (`EventSource.close()`).

## Quality Commands

```bash
uv run pytest                      # Run all tests
uv run ruff check .                # Lint
uv run ruff format .               # Auto-format
uv run pytest && uv run ruff check .  # All quality checks
```
