"""Tests for build_music_index.py — multi-TSV join and tag parsing."""

from pathlib import Path

from scripts.build_music_index import join_tags, parse_autotagging_tsv, parse_moodtheme_tsv


def _write_tsv(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines))


class TestParseMoodthemeTsv:
    def test_parses_tracks_with_mood_tags(self, tmp_path):
        tsv = tmp_path / "autotagging_moodtheme.tsv"
        _write_tsv(
            tsv,
            [
                "TRACK_ID\tARTIST_ID\tALBUM_ID\tPATH\tDURATION\tTAGS",
                "track_001\tartist_1\talbum_1\t01/001.mp3\t120.0\tmood/theme---happy\tmood/theme---calm",
                "track_002\tartist_2\talbum_2\t02/002.mp3\t90.0\tmood/theme---sad",
            ],
        )
        tracks = parse_moodtheme_tsv(tsv)
        assert len(tracks) == 2
        assert tracks[0]["track_id"] == "track_001"
        assert set(tracks[0]["tags"]) == {"happy", "calm"}
        assert tracks[1]["tags"] == ["sad"]
        assert tracks[0]["duration"] == 120.0


class TestParseAutotaggingTsv:
    def test_parses_instrument_tags(self, tmp_path):
        tsv = tmp_path / "autotagging_instrument.tsv"
        _write_tsv(
            tsv,
            [
                "TRACK_ID\tARTIST_ID\tALBUM_ID\tPATH\tDURATION\tTAGS",
                "track_001\tartist_1\talbum_1\t01/001.mp3\t120.0\tinstrument---piano\tinstrument---strings",
                "track_003\tartist_3\talbum_3\t03/003.mp3\t150.0\tinstrument---guitar",
            ],
        )
        result = parse_autotagging_tsv(tsv, "instrument---")
        assert result["track_001"] == ["piano", "strings"]
        assert result["track_003"] == ["guitar"]

    def test_parses_genre_tags(self, tmp_path):
        tsv = tmp_path / "autotagging_genre.tsv"
        _write_tsv(
            tsv,
            [
                "TRACK_ID\tARTIST_ID\tALBUM_ID\tPATH\tDURATION\tTAGS",
                "track_001\tartist_1\talbum_1\t01/001.mp3\t120.0\tgenre---jazz\tgenre---blues",
            ],
        )
        result = parse_autotagging_tsv(tsv, "genre---")
        assert result["track_001"] == ["jazz", "blues"]

    def test_tracks_without_matching_prefix_skipped(self, tmp_path):
        tsv = tmp_path / "autotagging_instrument.tsv"
        _write_tsv(
            tsv,
            [
                "TRACK_ID\tARTIST_ID\tALBUM_ID\tPATH\tDURATION\tTAGS",
                "track_001\tartist_1\talbum_1\t01/001.mp3\t120.0\tgenre---jazz",
            ],
        )
        result = parse_autotagging_tsv(tsv, "instrument---")
        assert "track_001" not in result


class TestJoinTags:
    def test_attaches_instrument_and_genre_tags(self):
        tracks = [
            {"track_id": "t1", "path": "01/t1.mp3", "duration": 120.0, "tags": ["happy"]},
            {"track_id": "t2", "path": "02/t2.mp3", "duration": 90.0, "tags": ["sad"]},
        ]
        instrument_map = {"t1": ["piano", "strings"]}
        genre_map = {"t1": ["jazz"], "t2": ["rock"]}

        result = join_tags(tracks, instrument_map, genre_map)

        assert result[0]["instrument_tags"] == ["piano", "strings"]
        assert result[0]["genre_tags"] == ["jazz"]
        assert result[1]["instrument_tags"] == []
        assert result[1]["genre_tags"] == ["rock"]

    def test_missing_entries_get_empty_lists(self):
        tracks = [
            {"track_id": "t1", "path": "01/t1.mp3", "duration": 120.0, "tags": ["happy"]},
        ]
        result = join_tags(tracks, {}, {})
        assert result[0]["instrument_tags"] == []
        assert result[0]["genre_tags"] == []
