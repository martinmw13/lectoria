"""Tests for music API endpoints — style validation, scene-track, and crossfade.

Route tests use ``httpx.AsyncClient`` over ``ASGITransport`` (the documented
route-testing pattern). The scene-track and crossfade routes load the NCM through
the BookStore, so the ``book_app`` fixture overrides the store with a
temp-directory-backed one (the ``book_on_disk`` fixture). The music index is
monkeypatched per test class since the matcher reads it from disk and would
otherwise 503 on an empty index.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from lectoria.api.deps import get_book_store
from lectoria.app import create_app
from lectoria.models.ncm import Emotion, MusicIndexEntry
from lectoria.services.bookstore import FileSystemBookStore
from lectoria.services.music import tags_to_vector


@pytest.fixture()
def app():
    return create_app()


@pytest.fixture()
def book_app(book_on_disk):
    """App with the BookStore pointed at the fixture's temp books dir."""
    app = create_app()
    books_dir = book_on_disk.book_dir.parent
    app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(books_dir)
    yield app
    app.dependency_overrides.clear()


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestPresetsEndpoint:
    @pytest.mark.asyncio
    async def test_list_presets(self, app):
        async with _client(app) as client:
            res = await client.get("/api/music/presets")
        assert res.status_code == 200
        presets = res.json()
        names = [p["name"] for p in presets]
        assert "auto" in names
        assert "cinematic" in names
        assert "piano_only" in names
        assert "ambient" in names
        assert "synthwave" in names
        assert "noir_jazz" in names
        for p in presets:
            assert "description" in p
            assert len(p["description"]) > 0


class TestStyleParameterValidation:
    @pytest.mark.asyncio
    async def test_invalid_style_returns_400(self, app):
        async with _client(app) as client:
            res = await client.get(
                "/api/books/nonexistent/chapters/0/scenes/0/track",
                params={"style": "invalid_preset"},
            )
        assert res.status_code == 400
        assert "Invalid style" in res.json()["detail"]

    @pytest.mark.asyncio
    async def test_valid_style_does_not_cause_400(self, app):
        async with _client(app) as client:
            res = await client.get(
                "/api/books/nonexistent/chapters/0/scenes/0/track",
                params={"style": "cinematic"},
            )
        # 404 is expected (book doesn't exist), but NOT 400
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_auto_style_accepted(self, app):
        async with _client(app) as client:
            res = await client.get(
                "/api/books/nonexistent/chapters/0/scenes/0/track",
                params={"style": "auto"},
            )
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_no_style_param_accepted(self, app):
        async with _client(app) as client:
            res = await client.get("/api/books/nonexistent/chapters/0/scenes/0/track")
        assert res.status_code == 404


class TestSceneTrack:
    @pytest.fixture(autouse=True)
    def _music_index(self, monkeypatch):
        # The fixture scene is Emotion.WONDER; a single matching track is enough
        # for the matcher to return a selection (track_id must be "track_<n>" so
        # the route's numeric-id parsing succeeds).
        track = MusicIndexEntry(
            track_id="track_42",
            file_path="tracks/track_42.mp3",
            duration_seconds=180.0,
            tags=["dream", "space"],
            emotion_primary=Emotion.WONDER,
            tag_vector=tags_to_vector(["dream", "space"]),
        )
        monkeypatch.setattr("lectoria.api.routes.music.load_music_index", lambda: [track])

    @pytest.mark.asyncio
    async def test_track_match_happy_path(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/track")
        assert res.status_code == 200
        body = res.json()
        assert body["track_id"] == "track_42"
        assert body["emotion_primary"] == Emotion.WONDER

    @pytest.mark.asyncio
    async def test_nonexistent_book_returns_404(self, book_app):
        async with _client(book_app) as client:
            res = await client.get("/api/books/nope/chapters/1/scenes/1/track")
        assert res.status_code == 404
        assert res.json()["detail"] == "NCM not found for book 'nope'"

    @pytest.mark.asyncio
    async def test_missing_current_scene_returns_404(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/99/track")
        assert res.status_code == 404


class TestCrossfade:
    @pytest.mark.asyncio
    async def test_current_scene_missing_returns_404(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(
                f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/99/crossfade"
            )
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_no_previous_scene_is_lenient(self, book_app, book_on_disk):
        async with _client(book_app) as client:
            res = await client.get(
                f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/crossfade"
            )
        assert res.status_code == 200
        assert res.json() == {"should_crossfade": True, "reason": "no previous scene"}

    @pytest.mark.asyncio
    async def test_previous_scene_missing_is_lenient(self, book_app, book_on_disk):
        # Previous scene lookup stays lenient: a missing scene never 404s.
        async with _client(book_app) as client:
            res = await client.get(
                f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/crossfade",
                params={"prev_chapter_idx": 1, "prev_scene_idx": 99},
            )
        assert res.status_code == 200
        body = res.json()
        assert body["should_crossfade"] is True
        assert body["reason"] == "previous scene not found"
