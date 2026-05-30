import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from lectoria.api.routes import books, images, music
from lectoria.core.config import get_settings

logger = logging.getLogger(__name__)

# CORS: restrict to the local dev frontend origins (Vite serves on :5173).
# Under BYOK (Decision D17/D34) API keys travel in custom request headers, never
# cookies, so credentialed CORS is unnecessary — and `allow_origins=["*"]` with
# `allow_credentials=True` would make Starlette reflect any caller's origin.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def create_app() -> FastAPI:
    app = FastAPI(
        title="Lectoria",
        description="Multimodal EPUB reader with AI-driven narrative enrichment",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(books.router, prefix="/api/books", tags=["books"])
    app.include_router(music.router, prefix="/api", tags=["music"])
    app.include_router(images.router, prefix="/api/books", tags=["images"])

    settings = get_settings()
    if settings.music_dir.exists():
        app.mount("/api/music", StaticFiles(directory=str(settings.music_dir)), name="music")
    if settings.books_dir.exists():
        app.mount(
            "/api/data/books", StaticFiles(directory=str(settings.books_dir)), name="book-data"
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
