#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v20.20.1/bin:$PATH"

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

echo "=== Lectoria ==="
echo ""

# 1. Backend
echo "[backend] Starting on http://localhost:8000"
uv run python main.py &
BACKEND_PID=$!

# 2. Frontend
echo "[frontend] Starting on http://localhost:5173"
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

cd "$ROOT"

echo ""
echo "Open http://localhost:5173 in your browser."
echo "Press Ctrl+C to stop both servers."
echo ""

wait
