// One comic page per chapter, requested in the reader's style. Session
// cache per book, text version, chapter and style, so reopening never
// refetches and another book's chapter page never shows.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MSG_FAILED, MSG_HUMAN } from "@/core/images";
import { requestStyleFields } from "../image-style";
import type { ImageStylePref } from "../image-style";
import { HumanNeeded, ImageRequestError, isQuotaCode, poll } from "./image-poll";

export type ChapterPage =
  | { phase: "loading" }
  | { phase: "ready"; url: string; caption: string }
  | { phase: "error"; message: string; quota?: boolean };

const chapterCache = new Map<string, { url: string; caption: string }>();

export function chapterCacheKey(bookId: string, textVersion: string, ch: number, pref: ImageStylePref): string {
  return `${bookId}::${textVersion}::${ch}::${JSON.stringify(requestStyleFields(pref))}`;
}

function pageBody(
  bookId: string,
  textVersion: string,
  ch: number,
  pref: ImageStylePref,
  reachedCh: number,
): Record<string, unknown> {
  return { kind: "chapter", bookId, textVersion, ch, reachedCh, ...requestStyleFields(pref) };
}

export function useChapterPage({
  bookId,
  textVersion,
  ch,
  pref,
  reachedCh,
}: {
  bookId: string;
  textVersion: string;
  ch: number;
  pref: ImageStylePref;
  reachedCh: number;
}): { page: ChapterPage; retry: () => void; needHuman: boolean; submitHumanPass: (pass: string) => void } {
  const reached = ch <= reachedCh;
  // The style pref arrives as a fresh object each render and is read
  // through a ref, like use-pictures; the key string tracks its value.
  const prefRef = useRef(pref);
  // eslint-disable-next-line react-hooks/refs -- latest-pref mirror; the key string tracks its value
  prefRef.current = pref;
  const key = chapterCacheKey(bookId, textVersion, ch, pref);
  const [page, setPage] = useState<ChapterPage>(() => {
    const hit = chapterCache.get(key);
    return hit ? { phase: "ready", url: hit.url, caption: hit.caption } : { phase: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  const [needHuman, setNeedHuman] = useState(false);
  const humanRetry = useRef<((pass: string) => void) | null>(null);

  const request = useCallback(
    (pass?: string) => {
      setPage({ phase: "loading" });
      let cancelled = false;
      const stop = () => {
        cancelled = true;
      };
      void poll(pageBody(bookId, textVersion, ch, prefRef.current, reachedCh), pass)
        .then(({ url, caption }) => {
          chapterCache.set(key, { url, caption });
          if (!cancelled) setPage({ phase: "ready", url, caption });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof HumanNeeded) {
            // eslint-disable-next-line react-hooks/immutability -- deferred human-retry callback, runs after render
            humanRetry.current = (next: string) => request(next);
            setNeedHuman(true);
            setPage({ phase: "error", message: MSG_HUMAN });
          } else {
            setPage({
              phase: "error",
              message: err instanceof Error ? err.message : MSG_FAILED,
              quota: err instanceof ImageRequestError && isQuotaCode(err.code),
            });
          }
        });
      return stop;
    },
    [bookId, textVersion, ch, key, reachedCh],
  );

  // The widget proof retries the failed request once, with the proof on
  // the first post only; later polls reuse the issued cookie.
  const submitHumanPass = useCallback((pass: string) => {
    const retry = humanRetry.current;
    humanRetry.current = null;
    setNeedHuman(false);
    if (retry) retry(pass);
    else request(pass);
  }, [request]);

  useEffect(() => {
    if (!reached) return;
    const hit = chapterCache.get(key);
    if (hit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cache-hit sync on chapter/pref change
      setPage({ phase: "ready", url: hit.url, caption: hit.caption });
      return;
    }
    const stop = request();
    return stop;
  }, [bookId, textVersion, ch, key, reached, reachedCh, attempt, request]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { page, retry, needHuman, submitHumanPass };
}
