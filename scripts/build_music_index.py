"""Build the curated music index from MTG-Jamendo metadata.

Reads the autotagging_moodtheme.tsv file from the MTG-Jamendo dataset,
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

    # Control target size:
    uv run python scripts/build_music_index.py /path/to/mtg-jamendo/data --max-tracks 300 --min-per-emotion 5
"""

import argparse
import csv
import logging
import sys
from collections import Counter
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_tsv(tsv_path: Path) -> list[dict]:
    """Parse MTG-Jamendo autotagging_moodtheme.tsv.

    Format: TRACK_ID \\t ARTIST_ID \\t ALBUM_ID \\t PATH \\t DURATION \\t TAGS...
    Where TAGS are tab-separated "category---tag" strings.
    """
    tracks = []
    with open(tsv_path, newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        header = next(reader, None)
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


def curate(
    tracks: list[dict],
    *,
    max_tracks: int = 300,
    min_per_emotion: int = 5,
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
    - Capped at max_tracks total, balanced across emotions
    """
    from lectoria.services.music import assign_emotion_primary, tags_to_vector

    # Basic filters
    filtered = []
    for t in tracks:
        if t["duration"] < min_duration or t["duration"] > max_duration:
            continue
        if len(t["tags"]) < min_tags:
            continue

        emotion = assign_emotion_primary(t["tags"])
        if emotion is None:
            continue

        filtered.append(
            {**t, "emotion_primary": str(emotion), "tag_vector": tags_to_vector(t["tags"])}
        )

    logger.info("After basic filtering: %d tracks (from %d)", len(filtered), len(tracks))

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

    logger.info("Final selection: %d tracks", len(selected))

    final_counts = Counter(t["emotion_primary"] for t in selected)
    logger.info("Final per emotion: %s", dict(sorted(final_counts.items())))

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
    parser.add_argument("--max-tracks", type=int, default=300, help="Target number of tracks")
    parser.add_argument("--min-per-emotion", type=int, default=5, help="Minimum tracks per emotion")
    parser.add_argument(
        "--min-duration", type=float, default=60.0, help="Minimum track duration (seconds)"
    )
    parser.add_argument(
        "--max-duration", type=float, default=600.0, help="Maximum track duration (seconds)"
    )
    parser.add_argument("--min-tags", type=int, default=2, help="Minimum mood/theme tags per track")
    args = parser.parse_args()

    tsv_path = args.data_dir / "autotagging_moodtheme.tsv"
    if not tsv_path.exists():
        logger.error("TSV not found: %s", tsv_path)
        logger.error(
            "Expected MTG-Jamendo data/ dir. Clone: git clone https://github.com/MTG/mtg-jamendo-dataset.git"
        )
        sys.exit(1)

    logger.info("Parsing %s", tsv_path)
    tracks = parse_tsv(tsv_path)
    logger.info("Parsed %d tracks with mood/theme tags", len(tracks))

    selected = curate(
        tracks,
        max_tracks=args.max_tracks,
        min_per_emotion=args.min_per_emotion,
        min_duration=args.min_duration,
        max_duration=args.max_duration,
        min_tags=args.min_tags,
    )

    # Convert to MusicIndexEntry format
    from lectoria.models.ncm import Emotion, MusicIndexEntry

    entries = []
    for t in selected:
        entries.append(
            MusicIndexEntry(
                track_id=t["track_id"],
                file_path=t["path"],
                duration_seconds=t["duration"],
                tags=t["tags"],
                emotion_primary=Emotion(t["emotion_primary"]),
                tag_vector=t["tag_vector"],
            )
        )

    output = args.output
    if output is None:
        output = Path("data/music/music_index.json")

    from lectoria.services.music import save_music_index

    save_music_index(entries, output)

    # Summary
    print()
    print("=" * 60)
    print(f"Music index built: {len(entries)} tracks -> {output}")
    print("=" * 60)
    emotion_counts = Counter(e.emotion_primary for e in entries)
    for emotion in sorted(emotion_counts.keys()):
        print(f"  {emotion:12s}: {emotion_counts[emotion]:4d} tracks")
    print(f"  {'TOTAL':12s}: {len(entries):4d} tracks")


if __name__ == "__main__":
    main()
