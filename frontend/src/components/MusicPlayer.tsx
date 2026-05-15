import { useEffect, useRef, useState, useCallback } from 'react';
import { getSceneTrack, checkCrossfade, type TrackMatch } from '../api/client';

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

function loadAudio(url: string, fallbackUrl: string | null): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.loop = true;

    function onReady() {
      cleanup();
      resolve(audio);
    }

    function onError() {
      cleanup();
      audio.src = '';
      if (fallbackUrl && fallbackUrl !== url) {
        loadAudio(fallbackUrl, null).then(resolve, reject);
      } else {
        reject(new Error(`Failed to load audio: ${url}`));
      }
    }

    function cleanup() {
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
    }

    audio.addEventListener('canplaythrough', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}

function killAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
  audio.src = '';
}

export default function MusicPlayer({
  bookId,
  chapterIndex,
  sceneIndex,
  prevChapterIndex,
  prevSceneIndex,
}: Props) {
  const [track, setTrack] = useState<TrackMatch | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [error, setError] = useState('');
  const [skipping, setSkipping] = useState(false);

  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const nextAudio = useRef<HTMLAudioElement | null>(null);
  const fadeInterval = useRef<number | null>(null);
  const prevTrackId = useRef<string | undefined>(undefined);
  const playingRef = useRef(false);
  const skippedIds = useRef<string[]>([]);
  const sceneKey = useRef('');

  useEffect(() => { playingRef.current = playing; }, [playing]);

  // Reset skipped list when scene changes
  useEffect(() => {
    const key = `${bookId}-${chapterIndex}-${sceneIndex}`;
    if (key !== sceneKey.current) {
      sceneKey.current = key;
      skippedIds.current = [];
    }
  }, [bookId, chapterIndex, sceneIndex]);

  const stopAll = useCallback(() => {
    if (fadeInterval.current !== null) {
      clearInterval(fadeInterval.current);
      fadeInterval.current = null;
    }
    killAudio(nextAudio.current);
    nextAudio.current = null;
  }, []);

  const crossfadeTo = useCallback((next: HTMLAudioElement) => {
    stopAll();

    const targetVol = muted ? 0 : volume;
    next.volume = 0;
    nextAudio.current = next;
    next.play().catch(() => {});

    const old = currentAudio.current;
    const steps = CROSSFADE_MS / 50;
    let step = 0;

    fadeInterval.current = window.setInterval(() => {
      step++;
      const progress = step / steps;

      next.volume = Math.min(progress * targetVol, targetVol);
      if (old) old.volume = Math.max((1 - progress) * targetVol, 0);

      if (step >= steps) {
        if (fadeInterval.current !== null) {
          clearInterval(fadeInterval.current);
          fadeInterval.current = null;
        }
        killAudio(old);
        currentAudio.current = next;
        nextAudio.current = null;
        setPlaying(true);
      }
    }, 50);
  }, [volume, muted, stopAll]);

  const startPlaying = useCallback((audio: HTMLAudioElement) => {
    stopAll();
    killAudio(currentAudio.current);
    audio.volume = muted ? 0 : volume;
    currentAudio.current = audio;
    audio.play()
      .then(() => setPlaying(true))
      .catch(() => setError('Autoplay blocked -- click play'));
  }, [volume, muted, stopAll]);

  async function loadAndPlay(t: TrackMatch, useCrossfade: boolean) {
    const localUrl = buildAudioUrl(t, true);
    const cdnUrl = t.stream_url;
    const fallback = localUrl !== cdnUrl ? cdnUrl : null;

    const audio = await loadAudio(localUrl, fallback);

    if (useCrossfade && currentAudio.current && playingRef.current) {
      crossfadeTo(audio);
    } else {
      startPlaying(audio);
    }
  }

  // Scene change: fetch initial track
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError('');
        const t = await getSceneTrack(
          bookId, chapterIndex, sceneIndex, prevTrackId.current,
        ) as TrackMatch;

        if (cancelled) return;

        if (prevChapterIndex !== undefined && prevSceneIndex !== undefined) {
          const cf = await checkCrossfade(
            bookId, chapterIndex, sceneIndex, prevChapterIndex, prevSceneIndex,
          );
          if (cancelled) return;

          if (!cf.should_crossfade && currentAudio.current && playingRef.current) {
            setTrack(t);
            prevTrackId.current = t.track_id;
            return;
          }
        }

        setTrack(t);
        prevTrackId.current = t.track_id;

        if (!playingRef.current) return;

        await loadAndPlay(t, true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId, chapterIndex, sceneIndex]);

  async function skipTrack() {
    if (!track || skipping) return;

    skippedIds.current.push(track.track_id);
    setSkipping(true);
    setError('');

    try {
      const t = await getSceneTrack(
        bookId, chapterIndex, sceneIndex,
        track.track_id,
        false,
        skippedIds.current,
      ) as TrackMatch;

      setTrack(t);
      prevTrackId.current = t.track_id;

      if (playingRef.current) {
        await loadAndPlay(t, true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSkipping(false);
    }
  }

  useEffect(() => {
    if (currentAudio.current) {
      currentAudio.current.volume = muted ? 0 : volume;
    }
    if (nextAudio.current) {
      nextAudio.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  function togglePlay() {
    if (!track) return;

    if (playing) {
      stopAll();
      currentAudio.current?.pause();
      setPlaying(false);
      return;
    }

    if (currentAudio.current) {
      currentAudio.current.play().catch(() => {});
      setPlaying(true);
      return;
    }

    loadAndPlay(track, false).catch((e) => setError(String(e)));
  }

  useEffect(() => {
    return () => {
      stopAll();
      killAudio(currentAudio.current);
      currentAudio.current = null;
    };
  }, [stopAll]);

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
