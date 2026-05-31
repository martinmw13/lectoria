import { useEffect, useRef, useState } from 'react';
import { getSceneTrack, checkCrossfade, type TrackMatch } from '../api/client';
import { useCrossfadeAudio } from '../hooks/useCrossfadeAudio';
import { AudioError, type CrossfadeAudioPlayer } from '../audio/crossfadePlayer';

const CROSSFADE_MS = 2000;

interface Props {
  bookId: string;
  chapterIndex: number;
  sceneIndex: number;
  prevChapterIndex?: number;
  prevSceneIndex?: number;
}

function buildAudioUrl(t: TrackMatch, preferLocal: boolean): string {
  if (preferLocal && t.cached) return `/api/music/${t.file_path}`;
  return t.stream_url;
}

// Local file first (served from /api/music/), CDN stream as fallback when they differ.
function audioUrls(t: TrackMatch): { localUrl: string; fallbackUrl: string | null } {
  const localUrl = buildAudioUrl(t, true);
  const cdnUrl = t.stream_url;
  return { localUrl, fallbackUrl: localUrl !== cdnUrl ? cdnUrl : null };
}

// The engine rejects with a typed AudioError; the UI copy lives here (not in the engine).
function mapAudioError(e: AudioError): string {
  return e.code === 'autoplay-blocked' ? 'Autoplay blocked -- click play' : e.message;
}

function describeError(e: unknown): string {
  return e instanceof AudioError ? mapAudioError(e) : String(e);
}

export default function MusicPlayer({
  bookId,
  chapterIndex,
  sceneIndex,
  prevChapterIndex,
  prevSceneIndex,
}: Props) {
  const [track, setTrack] = useState<TrackMatch | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [error, setError] = useState('');
  const [skipping, setSkipping] = useState(false);

  // The engine owns the audio mechanism; this component keeps only policy + rendering.
  const { playing, playingRef, playerRef } = useCrossfadeAudio(volume, muted, CROSSFADE_MS);

  const prevTrackId = useRef<string | undefined>(undefined);
  const skippedIds = useRef<string[]>([]);
  const sceneKey = useRef('');

  // Reset skipped list when scene changes
  useEffect(() => {
    const key = `${bookId}-${chapterIndex}-${sceneIndex}`;
    if (key !== sceneKey.current) {
      sceneKey.current = key;
      skippedIds.current = [];
    }
  }, [bookId, chapterIndex, sceneIndex]);

  // Scene change: fetch the track, then decide crossfade-vs-swap-vs-cold-start (policy).
  // `cancelled` guards the API-fetch race; the engine's dispose() guards the audio race.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let cancelled = false;

    async function load(p: CrossfadeAudioPlayer) {
      try {
        setError('');
        const t = (await getSceneTrack(
          bookId, chapterIndex, sceneIndex, prevTrackId.current,
        )) as TrackMatch;
        if (cancelled) return;

        if (prevChapterIndex !== undefined && prevSceneIndex !== undefined) {
          const cf = await checkCrossfade(
            bookId, chapterIndex, sceneIndex, prevChapterIndex, prevSceneIndex,
          );
          if (cancelled) return;

          // No-crossfade branch (D12 hysteresis): keep the old track playing, just
          // relabel to the new track. NOT a hard cut — do not switch audio here.
          if (!cf.should_crossfade && p.hasCurrent && playingRef.current) {
            setTrack(t);
            prevTrackId.current = t.track_id;
            return;
          }
        }

        setTrack(t);
        prevTrackId.current = t.track_id;

        if (!playingRef.current) return;

        const { localUrl, fallbackUrl } = audioUrls(t);
        if (p.hasCurrent) {
          await p.crossfadeTo(localUrl, { fallbackUrl });
        } else {
          await p.play(localUrl, { fallbackUrl });
        }
      } catch (e) {
        if (cancelled) return;
        setError(describeError(e));
      }
    }

    load(player);
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterIndex, sceneIndex, prevChapterIndex, prevSceneIndex, playerRef, playingRef]);

  async function skipTrack() {
    if (!track || skipping) return;
    const player = playerRef.current;

    skippedIds.current.push(track.track_id);
    setSkipping(true);
    setError('');

    try {
      const t = (await getSceneTrack(
        bookId, chapterIndex, sceneIndex,
        track.track_id,
        false,
        skippedIds.current,
      )) as TrackMatch;

      setTrack(t);
      prevTrackId.current = t.track_id;

      if (playingRef.current && player) {
        const { localUrl, fallbackUrl } = audioUrls(t);
        if (player.hasCurrent) {
          await player.crossfadeTo(localUrl, { fallbackUrl });
        } else {
          await player.play(localUrl, { fallbackUrl });
        }
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSkipping(false);
    }
  }

  function togglePlay() {
    const player = playerRef.current;
    if (!track || !player) return;

    if (playing) {
      player.pause();
      return;
    }

    if (player.hasCurrent) {
      player.resume();
      return;
    }

    const { localUrl, fallbackUrl } = audioUrls(track);
    player.play(localUrl, { fallbackUrl }).catch((e) => setError(describeError(e)));
  }

  return (
    <div className="music-player">
      <button className="music-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
        {playing ? '\u23F8' : '\u25B6'}
      </button>
      <button
        className="music-btn"
        onClick={skipTrack}
        disabled={!track || skipping}
        title="Skip to a different track"
      >
        {skipping ? '\u23F3' : '\u23ED'}
      </button>
      <button className="music-btn" onClick={() => setMuted(!muted)} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
      </button>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
      {track && (
        <span className="music-info" data-emotion={track.emotion_primary}>
          {track.emotion_primary}
        </span>
      )}
      {error && <span className="music-error" title={error}>!</span>}
    </div>
  );
}
