import { providerHeaders } from './byok';
import { getMusicStyle } from './prefs';
import type {
  BookResponse,
  ChaptersData,
  CrossfadeResponse,
  DetailedSceneTrackResponse,
  MusicPreset,
  NCM,
  SceneTrackResponse,
} from './types';

// Re-exported so the settings page resolves this name off the generated schema
// without reaching into `./types` directly.
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

export async function getNCM(bookId: string): Promise<NCM> {
  return jsonFetch<NCM>(`${BASE}/${bookId}/ncm`);
}

export async function getChapters(bookId: string): Promise<ChaptersData> {
  return jsonFetch<ChaptersData>(`${BASE}/${bookId}/chapters`);
}

export async function getBookInfo(bookId: string): Promise<BookResponse> {
  return jsonFetch<BookResponse>(`${BASE}/${bookId}`);
}

// --- Music ---

export async function getPresets(): Promise<MusicPreset[]> {
  return jsonFetch<MusicPreset[]>('/api/music/presets');
}

function sceneTrackUrl(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  previousTrackId?: string,
  exclude?: string[],
  detailed?: boolean,
): string {
  const params = new URLSearchParams();
  if (previousTrackId) params.set('previous_track_id', previousTrackId);
  if (detailed) params.set('detailed', 'true');
  if (exclude && exclude.length) params.set('exclude', exclude.join(','));
  const style = getMusicStyle();
  if (style && style !== 'auto') params.set('style', style);
  return `${BASE}/${bookId}/chapters/${chapterIdx}/scenes/${sceneIdx}/track?${params}`;
}

export async function getSceneTrack(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  previousTrackId?: string,
  exclude?: string[],
): Promise<SceneTrackResponse> {
  return jsonFetch(sceneTrackUrl(bookId, chapterIdx, sceneIdx, previousTrackId, exclude));
}

export async function getSceneTrackDetailed(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  previousTrackId?: string,
  exclude?: string[],
): Promise<DetailedSceneTrackResponse> {
  return jsonFetch(sceneTrackUrl(bookId, chapterIdx, sceneIdx, previousTrackId, exclude, true));
}

export async function checkCrossfade(
  bookId: string,
  chapterIdx: number,
  sceneIdx: number,
  prevChapterIdx?: number,
  prevSceneIdx?: number,
): Promise<CrossfadeResponse> {
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
