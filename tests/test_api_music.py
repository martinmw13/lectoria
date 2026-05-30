"""Tests for music API endpoints — style validation, scene-track, and crossfade.

The scene-track and crossfade routes load the NCM through the BookStore, so the
``book_client`` fixture overrides the store with a temp-directory-backed one (the
``book_on_disk`` fixture). The music index is monkeypatched per test class since
the matcher reads it from disk and would otherwise 503 on an empty index.
"""

import pytest
from fastapi.testclient import TestClient

from lectoria.api.deps import get_book_store
from lectoria.app import create_app
from lectoria.models.ncm import Emotion, MusicIndexEntry
from lectoria.services.bookstore import FileSystemBookStore
from lectoria.services.music import tags_to_vector


@pytest.fixture()
def client():
    app = create_app()
    return TestClient(app)


@pytest.fixture()
def book_client(book_on_disk):
    """TestClient with the BookStore pointed at the fixture's temp books dir."""
    app = create_app()
    books_dir = book_on_disk.book_dir.parent
    app.dependency_overrides[get_book_store] = lambda: FileSystemBookStore(books_dir)
    yield TestClient(app)
    app.dependency_overrides.clear()


class TestPresetsEndpoint:
    def test_list_presets(self, client):
        res = client.get("/api/music/presets")
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
    def test_invalid_style_returns_400(self, client):
        res = client.get(
            "/api/books/nonexistent/chapters/0/scenes/0/track",
            params={"style": "invalid_preset"},
        )
        assert res.status_code == 400
        assert "Invalid style" in res.json()["detail"]

    def test_valid_style_does_not_cause_400(self, client):
        res = client.get(
            "/api/books/nonexistent/chapters/0/scenes/0/track",
            params={"style": "cinematic"},
        )
        # 404 is expected (book doesn't exist), but NOT 400
        assert res.status_code == 404

    def test_auto_style_accepted(self, client):
        res = client.get(
            "/api/books/nonexistent/chapters/0/scenes/0/track",
            params={"style": "auto"},
        )
        assert res.status_code == 404

    def test_no_style_param_accepted(self, client):
        res = client.get("/api/books/nonexistent/chapters/0/scenes/0/track")
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

    def test_track_match_happy_path(self, book_client, book_on_disk):
        res = book_client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/track")
        assert res.status_code == 200
        body = res.json()
        assert body["track_id"] == "track_42"
        assert body["emotion_primary"] == Emotion.WONDER

    def test_nonexistent_book_returns_404(self, book_client):
        res = book_client.get("/api/books/nope/chapters/1/scenes/1/track")
        assert res.status_code == 404
        assert res.json()["detail"] == "NCM not found for book 'nope'"

    def test_missing_current_scene_returns_404(self, book_client, book_on_disk):
        res = book_client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/99/track")
        assert res.status_code == 404


class TestCrossfade:
    def test_current_scene_missing_returns_404(self, book_client, book_on_disk):
        res = book_client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/99/crossfade")
        assert res.status_code == 404

    def test_no_previous_scene_is_lenient(self, book_client, book_on_disk):
        res = book_client.get(f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/crossfade")
        assert res.status_code == 200
        assert res.json() == {"should_crossfade": True, "reason": "no previous scene"}

    def test_previous_scene_missing_is_lenient(self, book_client, book_on_disk):
        # Previous scene lookup stays lenient: a missing scene never 404s.
        res = book_client.get(
            f"/api/books/{book_on_disk.book_id}/chapters/1/scenes/1/crossfade",
            params={"prev_chapter_idx": 1, "prev_scene_idx": 99},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["should_crossfade"] is True
        assert body["reason"] == "previous scene not found"
