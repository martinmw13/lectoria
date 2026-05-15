"""Build the curated music index from MTG-Jamendo metadata.

Reads autotagging_moodtheme.tsv, autotagging_instrument.tsv, and
autotagging_genre.tsv from the MTG-Jamendo dataset, joins them by track_id,
filters and curates tracks, assigns emotion_primary, builds tag vectors,
and saves the music_index.json.

Usage:
    # First, clone the MTG-Jamendo dataset metadata:
    #   git clone https://github.com/MTG/mtg-jamendo-dataset.git /path/to/mtg-jamendo
    #
    # Then run:
    uv run python scripts/build_music_index.py /path/to/mtg-jamendo/data

    # Or with custom output:
    uv run python scripts/build_music_index.py /path/to/mtg-jamendo/data --output data/music/music_index.json

    # Control target size and style coverage:
    uv run python scripts/build_music_index.py /path/to/mtg-jamendo/data --max-tracks 500 --min-per-emotion 5 --min-per-style 10
"""

import argparse
import csv
import logging
import sys
from collections import Counter
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_autotagging_tsv(tsv_path: Path, category_prefix: str) -> dict[str, list[str]]:
    """Parse an MTG-Jamendo autotagging TSV and return {track_id: [tags]}.

    Format: TRACK_ID \\t ARTIST_ID \\t ALBUM_ID \\t PATH \\t DURATION \\t TAGS...
    Where TAGS are tab-separated "category---tag" strings.
    """
    result: dict[str, list[str]] = {}
    with open(tsv_path, newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader, None)  # skip header
        for row in reader:
            if len(row) < 6:
                continue
            track_id = row[0]
            tags = []
            for tag_str in row[5:]:
                if tag_str.startswith(category_prefix):
                    tags.append(tag_str[len(category_prefix) :])
            if tags:
                result[track_id] = tags
    return result


def parse_moodtheme_tsv(tsv_path: Path) -> list[dict]:
    """Parse autotagging_moodtheme.tsv into track dicts with metadata."""
    tracks = []
    with open(tsv_path, newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader, None)  # skip header
        for row in reader:
            if len(row) < 6:
                continue
            track_id = row[0]
            path = row[3]
            duration = float(row[4])

            mood_tags = []
            for tag_str in row[5:]:
                if tag_str.startswith("mood/theme---"):
                    mood_tags.append(tag_str.replace("mood/theme---", ""))

            tracks.append(
                {
                    "track_id": track_id,
                    "path": path,
                    "duration": duration,
                    "tags": mood_tags,
                }
            )

    return tracks


def join_tags(
    tracks: list[dict],
    instrument_tags: dict[str, list[str]],
    genre_tags: dict[str, list[str]],
) -> list[dict]:
    """Attach instrument and genre tags to mood/theme track dicts by track_id."""
    for t in tracks:
        tid = t["track_id"]
        t["instrument_tags"] = instrument_tags.get(tid, [])
        t["genre_tags"] = genre_tags.get(tid, [])
    return tracks


def curate(
    tracks: list[dict],
    *,
    max_tracks: int = 500,
    min_per_emotion: int = 5,
    min_per_style: int = 10,
    min_duration: float = 60.0,
    max_duration: float = 600.0,
    min_tags: int = 2,
) -> list[dict]:
    """Filter and select tracks for the curated subset.

    Selection criteria:
    - Duration between min_duration and max_duration seconds
    - At least min_tags mood/theme tags
    - Must have an assignable emotion_primary
    - Minimum min_per_emotion tracks per emotion category
    - Minimum min_per_style tracks per style preset
    - Capped at max_tracks total, balanced across emotions
    """
    from lectoria.services.music import (
        STYLE_PRESETS,
        assign_emotion_primary,
        matches_preset,
        tags_to_vector,
    )

    from lectoria.models.ncm import MusicIndexEntry

    VOCAL_INSTRUMENT_TAGS = {"voice"}
    VOCAL_GENRE_TAGS = {"singersongwriter", "rap", "hiphop", "rnb", "chanson"}

    # Basic filters
    filtered = []
    vocal_excluded = 0
    for t in tracks:
        if t["duration"] < min_duration or t["duration"] > max_duration:
            continue
        if len(t["tags"]) < min_tags:
            continue

        if set(t.get("instrument_tags", [])) & VOCAL_INSTRUMENT_TAGS:
            vocal_excluded += 1
            continue
        if set(t.get("genre_tags", [])) & VOCAL_GENRE_TAGS:
            vocal_excluded += 1
            continue

        emotion = assign_emotion_primary(t["tags"])
        if emotion is None:
            continue

        filtered.append(
            {**t, "emotion_primary": str(emotion), "tag_vector": tags_to_vector(t["tags"])}
        )

    logger.info(
        "After basic filtering: %d tracks (from %d, %d excluded as vocal)",
        len(filtered),
        len(tracks),
        vocal_excluded,
    )

    # Group by emotion
    by_emotion: dict[str, list[dict]] = {}
    for t in filtered:
        by_emotion.setdefault(t["emotion_primary"], []).append(t)

    emotion_counts = {e: len(ts) for e, ts in by_emotion.items()}
    logger.info("Tracks per emotion: %s", emotion_counts)

    # Check minimum coverage
    from lectoria.models.ncm import Emotion

    all_emotions = {e.value for e in Emotion}
    missing = all_emotions - set(by_emotion.keys())
    if missing:
        logger.warning("No tracks for emotions: %s", missing)

    under_min = {e: c for e, c in emotion_counts.items() if c < min_per_emotion}
    if under_min:
        logger.warning("Below minimum (%d) for: %s", min_per_emotion, under_min)

    # Balanced selection: allocate quota per emotion, then fill
    n_emotions = len(by_emotion)
    if n_emotions == 0:
        return []

    base_quota = max_tracks // n_emotions
    selected = []

    # Sort tracks within each emotion by number of tags (more tags = richer signal)
    for emotion, emotion_tracks in sorted(by_emotion.items()):
        emotion_tracks.sort(key=lambda t: len(t["tags"]), reverse=True)
        quota = max(min_per_emotion, base_quota)
        selected.extend(emotion_tracks[:quota])

    # If under budget, add more from largest groups
    if len(selected) < max_tracks:
        selected_ids = {t["track_id"] for t in selected}
        remaining = [t for t in filtered if t["track_id"] not in selected_ids]
        remaining.sort(key=lambda t: len(t["tags"]), reverse=True)
        selected.extend(remaining[: max_tracks - len(selected)])

    # If over budget, trim from largest groups
    if len(selected) > max_tracks:
        selected = selected[:max_tracks]

    # Style coverage: pull additional tracks if any preset is underrepresented
    def _as_entry(t: dict) -> MusicIndexEntry:
        return MusicIndexEntry(
            track_id=t["track_id"],
            file_path=t.get("path", ""),
            duration_seconds=t["duration"],
            tags=t["tags"],
            instrument_tags=t.get("instrument_tags", []),
            genre_tags=t.get("genre_tags", []),
            emotion_primary=Emotion(t["emotion_primary"]),
            tag_vector=t["tag_vector"],
        )

    selected_ids = {t["track_id"] for t in selected}
    pool = [t for t in filtered if t["track_id"] not in selected_ids]

    for preset_name in STYLE_PRESETS:
        matching = [t for t in selected if matches_preset(_as_entry(t), preset_name)]
        deficit = min_per_style - len(matching)
        if deficit > 0:
            candidates = [t for t in pool if matches_preset(_as_entry(t), preset_name)]
            candidates.sort(key=lambda t: len(t["tags"]), reverse=True)
            added = candidates[:deficit]
            selected.extend(added)
            for t in added:
                pool.remove(t)
            if added:
                logger.info(
                    "Added %d tracks for style '%s' coverage (had %d, need %d)",
                    len(added),
                    preset_name,
                    len(matching),
                    min_per_style,
                )

    logger.info("Final selection: %d tracks", len(selected))

    final_counts = Counter(t["emotion_primary"] for t in selected)
    logger.info("Final per emotion: %s", dict(sorted(final_counts.items())))

    # Log style coverage
    for preset_name in STYLE_PRESETS:
        count = sum(1 for t in selected if matches_preset(_as_entry(t), preset_name))
        logger.info("Style '%s': %d tracks", preset_name, count)

    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description="Build curated music index from MTG-Jamendo")
    parser.add_argument("data_dir", type=Path, help="Path to MTG-Jamendo data/ directory")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output path (default: data/music/music_index.json)",
    )
    parser.add_argument("--max-tracks", type=int, default=500, help="Target number of tracks")
    parser.add_argument("--min-per-emotion", type=int, default=5, help="Minimum tracks per emotion")
    parser.add_argument(
        "--min-per-style", type=int, default=10, help="Minimum tracks per style preset"
    )
    parser.add_argument(
        "--min-duration", type=float, default=60.0, help="Minimum track duration (seconds)"
    )
    parser.add_argument(
        "--max-duration", type=float, default=600.0, help="Maximum track duration (seconds)"
    )
    parser.add_argument("--min-tags", type=int, default=2, help="Minimum mood/theme tags per track")
    args = parser.parse_args()

    mood_path = args.data_dir / "autotagging_moodtheme.tsv"
    if not mood_path.exists():
        logger.error("TSV not found: %s", mood_path)
        logger.error(
            "Expected MTG-Jamendo data/ dir. Clone: git clone https://github.com/MTG/mtg-jamendo-dataset.git"
        )
        sys.exit(1)

    logger.info("Parsing %s", mood_path)
    tracks = parse_moodtheme_tsv(mood_path)
    logger.info("Parsed %d tracks with mood/theme tags", len(tracks))

    instrument_path = args.data_dir / "autotagging_instrument.tsv"
    instrument_map: dict[str, list[str]] = {}
    if instrument_path.exists():
        instrument_map = parse_autotagging_tsv(instrument_path, "instrument---")
        logger.info("Parsed instrument tags for %d tracks", len(instrument_map))
    else:
        logger.warning(
            "Instrument TSV not found: %s (instrument_tags will be empty)", instrument_path
        )

    genre_path = args.data_dir / "autotagging_genre.tsv"
    genre_map: dict[str, list[str]] = {}
    if genre_path.exists():
        genre_map = parse_autotagging_tsv(genre_path, "genre---")
        logger.info("Parsed genre tags for %d tracks", len(genre_map))
    else:
        logger.warning("Genre TSV not found: %s (genre_tags will be empty)", genre_path)

    tracks = join_tags(tracks, instrument_map, genre_map)

    selected = curate(
        tracks,
        max_tracks=args.max_tracks,
        min_per_emotion=args.min_per_emotion,
        min_per_style=args.min_per_style,
        min_duration=args.min_duration,
        max_duration=args.max_duration,
        min_tags=args.min_tags,
    )

    from lectoria.models.ncm import Emotion, MusicIndexEntry

    entries = []
    for t in selected:
        entries.append(
            MusicIndexEntry(
                track_id=t["track_id"],
                file_path=t["path"],
                duration_seconds=t["duration"],
                tags=t["tags"],
                instrument_tags=t.get("instrument_tags", []),
                genre_tags=t.get("genre_tags", []),
                emotion_primary=Emotion(t["emotion_primary"]),
                tag_vector=t["tag_vector"],
            )
        )

    output = args.output
    if output is None:
        output = Path("data/music/music_index.json")

    from lectoria.services.music import save_music_index

    save_music_index(entries, output)

    print()
    print("=" * 60)
    print(f"Music index built: {len(entries)} tracks -> {output}")
    print("=" * 60)
    emotion_counts = Counter(e.emotion_primary for e in entries)
    for emotion in sorted(emotion_counts.keys()):
        print(f"  {emotion:12s}: {emotion_counts[emotion]:4d} tracks")
    print(f"  {'TOTAL':12s}: {len(entries):4d} tracks")

    from lectoria.services.music import STYLE_PRESETS, matches_preset

    print()
    print("Style coverage:")
    for preset_name in STYLE_PRESETS:
        count = sum(1 for e in entries if matches_preset(e, preset_name))
        print(f"  {preset_name:12s}: {count:4d} tracks")


if __name__ == "__main__":
    main()
