"""Tests for music API endpoints — style parameter validation."""

import pytest
from fastapi.testclient import TestClient

from lectoria.app import create_app


@pytest.fixture()
def client():
    app = create_app()
    return TestClient(app)


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
