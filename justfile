# Lectoria — task runner
# Run `just` (no args) to list all recipes.

default:
    @just --list

# Install all deps and pre-commit hooks
install:
    uv sync --all-extras
    uv run pre-commit install
    cd frontend && npm install

# Run all tests
test:
    uv run pytest

# Run a specific test file or pattern
test-file FILE:
    uv run pytest {{FILE}}

# Lint and format check (fast — does not modify files)
check:
    uv run ruff check .
    uv run ruff format --check .

# Auto-fix lint and format
fmt:
    uv run ruff check --fix .
    uv run ruff format .

# Static type check (not part of `check` yet — opt-in)
typecheck:
    uv run pyright lectoria

# Run backend dev server (http://localhost:8000)
dev:
    uv run python main.py

# Run frontend dev server (http://localhost:5173)
dev-frontend:
    cd frontend && npm run dev

# Run backend + frontend dev servers together (Ctrl-C stops both)
dev-all:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    uv run python main.py &
    (cd frontend && npm run dev) &
    wait

# Run pre-commit on all files
pre-commit:
    uv run pre-commit run --all-files

# What to work next: eligible / in-flight / blocked / parallel-safe issues (live from the tracker)
next:
    uv run python scripts/whats_next.py
