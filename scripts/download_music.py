"""Download Jamendo tracks referenced in music_index.json to data/music/.

Skips tracks that are already downloaded. Safe to re-run.

Usage:
    uv run python scripts/download_music.py
    uv run python scripts/download_music.py --concurrency 4
    uv run python scripts/download_music.py --format mp32   # 96kbps (default, smaller)
    uv run python scripts/download_music.py --format mp31   # 128kbps (better quality)
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

JAMENDO_CDN = "https://prod-1.storage.jamendo.com/"


def numeric_id(track_id: str) -> str:
    return track_id.replace("track_", "")


async def download_track(
    session,
    track: dict,
    music_dir: Path,
    audio_format: str,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Download a single track. Returns True if downloaded, False if skipped/failed."""
    import aiohttp

    dest = music_dir / track["file_path"]
    if dest.exists() and dest.stat().st_size > 1000:
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    nid = numeric_id(track["track_id"])
    url = f"{JAMENDO_CDN}?trackid={nid}&format={audio_format}"

    async with semaphore:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                if resp.status != 200:
                    logger.warning(
                        "HTTP %d for %s (track %s)",
                        resp.status,
                        url,
                        track["track_id"],
                    )
                    return False

                data = await resp.read()
                if len(data) < 1000:
                    logger.warning(
                        "Suspiciously small response (%d bytes) for %s",
                        len(data),
                        track["track_id"],
                    )
                    return False

                dest.write_bytes(data)
                logger.info(
                    "Downloaded %s (%.1f MB)",
                    track["track_id"],
                    len(data) / 1_048_576,
                )
                return True

        except Exception as e:
            logger.error("Failed to download %s: %s", track["track_id"], e)
            return False


async def main_async(args: argparse.Namespace) -> None:
    import aiohttp

    index_path = args.index
    if not index_path.exists():
        logger.error("Music index not found: %s", index_path)
        sys.exit(1)

    tracks = json.loads(index_path.read_text())
    logger.info("Loaded %d tracks from index", len(tracks))

    music_dir = args.output
    music_dir.mkdir(parents=True, exist_ok=True)

    already = sum(
        1
        for t in tracks
        if (music_dir / t["file_path"]).exists()
        and (music_dir / t["file_path"]).stat().st_size > 1000
    )
    logger.info("%d/%d already cached, %d to download", already, len(tracks), len(tracks) - already)

    if already == len(tracks):
        logger.info("All tracks cached. Nothing to do.")
        return

    semaphore = asyncio.Semaphore(args.concurrency)
    downloaded = 0

    async with aiohttp.ClientSession() as session:
        tasks = [download_track(session, t, music_dir, args.format, semaphore) for t in tracks]
        results = await asyncio.gather(*tasks)
        downloaded = sum(1 for r in results if r)

    logger.info(
        "Done: %d downloaded, %d already cached, %d total",
        downloaded,
        already,
        len(tracks),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Jamendo tracks to local cache")
    parser.add_argument(
        "--index",
        type=Path,
        default=Path("data/music/music_index.json"),
        help="Path to music_index.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/music"),
        help="Output directory for MP3 files",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Number of concurrent downloads",
    )
    parser.add_argument(
        "--format",
        choices=["mp31", "mp32"],
        default="mp32",
        help="Audio quality: mp32=96kbps (default), mp31=128kbps",
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
