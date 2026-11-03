"use client";

import { useEffect, useState } from "react";

interface Definition {
  word: string;
  phonetic?: string;
  senses: { pos: string; defs: { text: string; example?: string }[] }[];
}

type Lookup = { phase: "loading" } | { phase: "ok"; def: Definition } | { phase: "none" } | { phase: "error" };

// Per-tab memory: a word looked up twice asks the server once.
const seen = new Map<string, Lookup>();

export const DEFINE_COPY = {
  loading: "Looking it up…",
  none: (w: string) => `No definition found for “${w}”.`,
  error: "The dictionary is out for a moment. Try again soon.",
  source: "Free Dictionary",
} as const;

// Keyed by word in the menu, so each word starts fresh.
export function DefineCard({ word }: { word: string }) {
  const [lookup, setLookup] = useState<Lookup>(() => seen.get(word) ?? { phase: "loading" });

  useEffect(() => {
    if (seen.has(word)) return;
    const ctrl = new AbortController();
    fetch(`/api/define?word=${encodeURIComponent(word)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const next: Lookup =
          res.status === 404 ? { phase: "none" } : res.ok ? { phase: "ok", def: (await res.json()) as Definition } : { phase: "error" };
        if (next.phase !== "error") seen.set(word, next);
        setLookup(next);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLookup({ phase: "error" });
      });
    return () => ctrl.abort();
  }, [word]);

  return (
    <div className="define-card" role="status" aria-live="polite">
      {lookup.phase === "loading" ? <p className="define-note">{DEFINE_COPY.loading}</p> : null}
      {lookup.phase === "none" ? <p className="define-note">{DEFINE_COPY.none(word)}</p> : null}
      {lookup.phase === "error" ? <p className="define-note">{DEFINE_COPY.error}</p> : null}
      {lookup.phase === "ok" ? (
        <>
          <p className="define-head">
            <strong>{lookup.def.word}</strong>
            {lookup.def.phonetic ? <span className="define-phon">{lookup.def.phonetic}</span> : null}
          </p>
          {lookup.def.senses.map((s, i) => (
            <div key={i} className="define-sense">
              {s.pos ? <em className="define-pos">{s.pos}</em> : null}
              <ol>
                {s.defs.map((d, j) => (
                  <li key={j}>
                    {d.text}
                    {d.example ? <span className="define-ex"> “{d.example}”</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="define-src">{DEFINE_COPY.source}</p>
        </>
      ) : null}
    </div>
  );
}
