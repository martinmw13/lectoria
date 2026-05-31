import { useCallback, useEffect, useRef, useState } from 'react';
import { openProcessingStream, type ProcessOptions } from '../api/client';
import { interpretProgressEvent, parseSSEStream } from '../api/sseParser';

// Two genuinely distinct error paths — must NOT be flattened:
//   - 'http':   pre-stream HTTP non-OK (e.g. the 409 "already processed",
//               raised before the SSE response opens) — carries a status code.
//   - 'stream': an in-stream pipeline failure (a `data: error:` payload) — message only.
export type ProcessingError =
  | { kind: 'http'; status: number; message: string }
  | { kind: 'stream'; message: string };

export type ProcessingStatus = 'idle' | 'running' | 'done' | 'error';

export interface UseBookProcessing {
  status: ProcessingStatus;
  progress: string[];
  error: ProcessingError | null;
  finalBookId: string | null;
  start: (bookId: string, opts?: ProcessOptions) => void;
  /** Return to idle, clearing progress/error/result (e.g. before analyzing a new book). */
  reset: () => void;
}

// Owns the AbortController for the book-processing SSE stream and aborts it on
// unmount, so cleanup can't be forgotten by callers. Routing stays in the page
// (a status/finalBookId effect), never here — see #65 / ADR-0001.
export function useBookProcessing(): UseBookProcessing {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [finalBookId, setFinalBookId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Abort the in-flight stream when the component unmounts.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus('idle');
    setProgress([]);
    setError(null);
    setFinalBookId(null);
  }, []);

  const start = useCallback((bookId: string, opts?: ProcessOptions) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setStatus('running');
    setProgress([]);
    setError(null);
    setFinalBookId(null);

    void (async () => {
      try {
        const res = await openProcessingStream(bookId, opts ?? {}, controller.signal);
        if (!res.ok) {
          const detail = await res.text().catch(() => res.statusText);
          setError({ kind: 'http', status: res.status, message: detail });
          setStatus('error');
          return;
        }
        if (!res.body) {
          setError({ kind: 'stream', message: 'Empty response body' });
          setStatus('error');
          return;
        }
        for await (const frame of parseSSEStream(res.body)) {
          const update = interpretProgressEvent(frame);
          if (update.type === 'ping') continue;
          if (update.type === 'progress') {
            setProgress((prev) => [...prev, update.message]);
          } else if (update.type === 'done') {
            setFinalBookId(update.bookId || bookId);
            setStatus('done');
            return;
          } else {
            setError({ kind: 'stream', message: update.message });
            setStatus('error');
            return;
          }
        }
      } catch (e) {
        // Swallow the post-abort rejection (unmount / restart); surface real failures.
        if (!controller.signal.aborted) {
          setError({ kind: 'stream', message: String(e) });
          setStatus('error');
        }
      }
    })();
  }, []);

  return { status, progress, error, finalBookId, start, reset };
}
