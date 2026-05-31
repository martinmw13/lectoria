import { providerHeaders } from './byok';
import { getMusicStyle } from './prefs';
import type { MusicPreset } from './types';

// Re-exported so existing import sites (e.g. SettingsPage) resolve `MusicPreset`
// off the generated schema without reaching into `./types` directly.
export type { MusicPreset } from './types';

const BASE = '/api/books';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

// --- Book endpoints ---

export interface BookSummary {
  book_id: string;
  title: string;
  has_ncm: boolean;
}

export interface CostEstimate {
  book_id: string;
  total_chapters: number;
  narrative_chapters: number;
  total_paragraphs: number;
  estimated_tokens: number;
  message: string;
}

export async function listBooks(): Promise<BookSummary[]> {
  const data = await jsonFetch<{ books: BookSummary[] }>(BASE + '/');
  return data.books;
}

export async function uploadBook(file: File): Promise<CostEstimate> {
  const form = new FormData();
  form.append('file', file);
  return jsonFetch<CostEstimate>(BASE + '/upload', { method: 'POST', body: form });
}

export interface ProcessOptions {
  maxChapters?: number;
  force?: boolean;
}

// Open the book-processing SSE stream (POST + BYOK headers). Returns the raw
// Response; the caller (useBookProcessing) inspects res.ok/status/body, parses
// the body with parseSSEStream, and owns the AbortController. See ADR-0001.
export function openProcessingStream(
  bookId: string,
  opts: ProcessOptions,
  signal: AbortSignal,
): Promise<Response> {
  const params = new URLSearchParams();
  if (opts.maxChapters) params.set('max_chapters', String(opts.maxChapters));
  if (opts.force) params.set('force', 'true');
  const qs = params.toString();
  const url = `${BASE}/${bookId}/process${qs ? '?' + qs : ''}`;
  return fetch(url, { method: 'POST', headers: providerHeaders(), signal });
}

// --- NCM ---

export interface NCM {
  book_map: {
    book_id: string;
    title: string;
    genre: string;
    setting: { time_period: string; world: string; description: string };
    characters: Array<{
      id: string;
      name: string;
      aliases: string[];
      physical_description: string;
      role: string;
      relationships: Array<{ target_id: string; type: string }>;
    }>;
    chapters: Array<{ chapter_index: number; title: string; summary: string }>;
  };
  chapters: Array<{
    chapter_index: number;
    cover_description: string;
    llm_model: string;
    attempt_count: number;
    is_fallback: boolean;
    scenes: Array<{
      scene_index: number;
      title: string;
      start_paragraph: number;
      end_paragraph: number;
      characters_present: string[];
      emotion: string;
      pacing: string;
      scene_type: string;
      setting: { location: string; time_of_day: string; weather: string };
      image_prompt: string;
      transition_type: string;
      key_phrases: string[];
      key_objects: string[];
      raw_emotion: string | null;
      raw_pacing: string | null;
      raw_scene_type: string | null;
      raw_transition_type: string | null;
    }>;
  }>;
}

export interface ChaptersData {
  chapters: Array<{
    chapter_index: number;
    title: string;
    paragraphs: Array<{ index: number; text: string }>;
    is_narrative: boolean;
  }>;
}

export async function getNCM(bookId: string): Promise<NCM> {
  return jsonFetch<NCM>(`${BASE}/${bookId}/ncm`);
}

export async function getChapters(bookId: string): Promise<ChaptersData> {
  return jsonFetch<ChaptersData>(`${BASE}/${bookId}/chapters`);
}

export async function getBookInfo(bookId: string): Promise<Record<string, unknown>> {
  return jsonFetch<Record<string, unknown>>(`${BASE}/${bookId}`);
}

// --- Music ---

export interface TrackMatch {
  track_id: string;
  file_path: string;
  stream_url: string;
  cached: boolean;
  duration_seconds: number;
  tags: string[];
  emotion_primary: string;
}

export interface DetailedMatch {
  selected_track: string;
  score: number;
  scene_vector: number[];
  fallback: string;
  style_applied: string | null;
  candidates: Array<{ track_id: string; tags: string[]; score: number }>;
}

export async function getPresets(): Promise<MusicPreset[]> {
  return jsonFetch<MusicPreset[]>('/api/music/presets');
}

export async function getSceneTrack(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  previousTrackId?: string,
  detailed?: boolean,
  exclude?: string[],
): Promise<TrackMatch | DetailedMatch> {
  const params = new URLSearchParams();
  if (previousTrackId) params.set('previous_track_id', previousTrackId);
  if (detailed) params.set('detailed', 'true');
  if (exclude && exclude.length) params.set('exclude', exclude.join(','));
  const style = getMusicStyle();
  if (style && style !== 'auto') params.set('style', style);
  const url = `${BASE}/${bookId}/chapters/${chapterIdx}/scenes/${sceneIdx}/track?${params}`;
  return jsonFetch(url);
}

export async function checkCrossfade(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  prevChapterIdx?: number,
  prevSceneIdx?: number,
): Promise<{ should_crossfade: boolean; [key: string]: unknown }> {
  const params = new URLSearchParams();
  params.set('chapter_idx', String(chapterIdx));
  params.set('scene_idx', String(sceneIdx));
  if (prevChapterIdx !== undefined) params.set('prev_chapter_idx', String(prevChapterIdx));
  if (prevSceneIdx !== undefined) params.set('prev_scene_idx', String(prevSceneIdx));
  return jsonFetch(`${BASE}/${bookId}/chapters/${chapterIdx}/scenes/${sceneIdx}/crossfade?${params}`);
}

// --- Images ---

export async function generateImage(
  bookId: string,
  selectedText: string,
  chapterIndex?: number,
  sceneIndex?: number,
): Promise<{ image_base64: string; content_type: string; cache_url?: string }> {
  return jsonFetch(`${BASE}/${bookId}/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...providerHeaders() },
    body: JSON.stringify({
      selected_text: selectedText,
      chapter_index: chapterIndex,
      scene_index: sceneIndex,
    }),
  });
}

export async function generateSceneImage(
  bookId: string,
  chapterIndex: number,
  sceneIndex: number,
): Promise<{ cache_url: string; generated: boolean }> {
  return jsonFetch(`${BASE}/${bookId}/images/scene`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...providerHeaders() },
    body: JSON.stringify({
      chapter_index: chapterIndex,
      scene_index: sceneIndex,
    }),
  });
}
