"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadMyBooks, removeMyBook, type MyBook } from "./my-books";
import { continueHref, loadAllProgress, type BookProgress } from "../reading-progress";

// Books this browser finished uploading: links back to the reader.
// Loads after mount so the server render matches everywhere.
export function YourBooks() {
  const [books, setBooks] = useState<MyBook[] | null>(null);
  const [progress, setProgress] = useState<Record<string, BookProgress>>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only book list from localStorage after hydration
    setBooks(loadMyBooks());
    setProgress(loadAllProgress());
  }, []);

  if (!books || books.length === 0) return null;
  return (
    <section aria-label="Your books">
      <h2 className="ob-sec-t">Your books</h2>
      <ul className="ob-mine">
        {books.map((entry) => {
          const resume = continueHref(entry.id, progress);
          return (
            <li key={entry.id} className="ob-mine-row">
              <Link className="ob-action" href={resume ?? `/read/${entry.id}`}>
                {entry.title}
              </Link>
              <span className="ob-mini-meta">{entry.author}</span>
              {resume && (
                <Link className="ob-mini-meta ob-continue" href={resume} aria-label={`Continue reading ${entry.title}`}>
                  Continue reading
                </Link>
              )}
              <button
                type="button"
                className="ob-quiet"
                aria-label={`Forget ${entry.title}`}
                onClick={() => setBooks(removeMyBook(entry.id))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
