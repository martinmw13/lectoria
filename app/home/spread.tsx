"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { hasPanels } from "@/core/book-capabilities";
import { useSkin } from "../use-skin";
import { shelf, shelfById } from "./shelf";
import { coverFor, shelfCoverFor } from "./covers";
import { CoverImage } from "./cover";
import { StyleMenu } from "../style-menu";
import { StylePicker } from "./style-picker";
import { UploadSection } from "./upload";
import { YourBooks } from "./your-books";
import { HomeIcon } from "./home-icons";

// The open-book spread: shelf and drop zone on the left page, the
// chosen book's plate on the right. Oz is selected on load. readHrefs
// maps a book to its first scene; a missing entry falls back to the
// /read/<id> redirect.
export function HomeSpread({ readHrefs = {} }: { readHrefs?: Readonly<Record<string, string>> }) {
  const readHref = (id: string) => readHrefs[id] ?? `/read/${id}`;
  const skin = useSkin();
  const [current, setCurrent] = useState("oz");
  const plateRef = useRef<HTMLElement | null>(null);
  const book = shelfById(current) ?? shelf[0]!;

  function choose(id: string) {
    if (id === current) return;
    setCurrent(id);
    const plate = plateRef.current;
    if (!plate) return;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    plate.classList.remove("ob-swap");
    void plate.offsetWidth;
    plate.classList.add("ob-swap");
  }

  return (
    <>
      <StyleMenu placement="home" />
      <div className="ob-book">
        <section className="ob-page ob-left" aria-labelledby="obBrand">
          <div className="ob-rule" aria-hidden="true" />
          <div className="ob-wm-wrap">
            <h1 className="ob-wordmark" id="obBrand">
              Lector<em className="ob-ia">IA</em>
            </h1>
            <span className="ob-lantern" aria-hidden="true">
              <svg viewBox="0 0 22 34">
                <circle className="ob-lantern-glow" cx="11" cy="20" r="13" fill="#FFC25A" />
                <path d="M11 0v6" stroke="#5A3A2A" strokeWidth="1.2" />
                <rect x="6.5" y="6" width="9" height="2.4" rx="1" fill="#3A2A22" />
                <path d="M5 9.5h12c2.6 3.4 2.6 13.6 0 17H5c-2.6-3.4-2.6-13.6 0-17z" fill="#D2452E" />
                <path d="M5.6 14h10.8M5.2 18h11.6M5.6 22h10.8" stroke="#A8301E" strokeWidth=".8" />
                <path d="M9 9.5c-1 3.4-1 13.6 0 17" stroke="#FFD27A" strokeWidth="1.2" fill="none" opacity=".8" />
                <rect x="6.5" y="26.5" width="9" height="2.4" rx="1" fill="#3A2A22" />
                <path d="M11 29v4" stroke="#C99A3A" strokeWidth="1.4" />
              </svg>
            </span>
            <svg className="ob-ink-under" viewBox="0 0 420 20" aria-hidden="true" focusable="false">
              <path d="M6 12 C 90 4, 180 16, 260 9 S 380 6, 414 11" fill="none" stroke="#0866FF" strokeWidth="3.4" strokeLinecap="round" filter="url(#f-wob-s)" />
            </svg>
          </div>
          <div className="ob-rule ob-thin" aria-hidden="true" />
          <div className="ob-flour" aria-hidden="true">
            &#10087;
          </div>
          <p className="ob-intro">Books with pictures, and music that follows every scene.</p>

          <h2 className="ob-sec-t">On the shelf</h2>
          <p className="ob-sec-sub">Ten classics are ready to read, each with music that follows the story.</p>
          <div className="lb lb-grid" role="group" aria-label="Books on the shelf">
            {shelf.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="lb-item"
                data-book={entry.id}
                aria-pressed={entry.id === current}
                aria-label={`${entry.title}, ${entry.author}`}
                onClick={() => choose(entry.id)}
              >
                {entry.favorite && (
                  <span className="lb-heart" aria-hidden="true">
                    <HomeIcon name="heart" />
                  </span>
                )}
                <CoverImage title={entry.title} url={shelfCoverFor(entry.id, skin)} />
                <span className="lb-name">{entry.label}</span>
              </button>
            ))}
          </div>

          <h2 className="ob-sec-t">Or bring your own book</h2>
          <UploadSection />
          <YourBooks />

          <footer className="ob-foot">
            Want more? Find free classics at{" "}
            <a href="https://www.gutenberg.org/" target="_blank" rel="noopener noreferrer">
              Project Gutenberg <HomeIcon name="external" />
            </a>{" "}
            and{" "}
            <a href="https://standardebooks.org/" target="_blank" rel="noopener noreferrer">
              Standard Ebooks <HomeIcon name="external" />
            </a>
            , then bring them here.
          </footer>
        </section>
        <div className="ob-gutter" aria-hidden="true" />
        <section className="ob-page ob-right" aria-labelledby="obPlateTitle">
          <StylePicker />
          <figure
            className="ob-plate"
            ref={plateRef}
            onAnimationEnd={() => plateRef.current?.classList.remove("ob-swap")}
          >
            <span className="ob-corner tl" aria-hidden="true" />
            <span className="ob-corner tr" aria-hidden="true" />
            <span className="ob-corner bl" aria-hidden="true" />
            <span className="ob-corner br" aria-hidden="true" />
            <span className="ob-tape tl" aria-hidden="true" />
            <span className="ob-tape tr" aria-hidden="true" />
            <span className="ob-badge">
              <HomeIcon name={book.favorite ? "heart" : "book"} />
              {book.tag}
            </span>
            <CoverImage title={book.title} url={coverFor(book.id, skin)} className="ob-art" eager />
            <div className="ob-txt">
              <h2 id="obPlateTitle">{book.title}</h2>
              <p className="ob-by">
                {book.author} &middot; {book.year} &middot; {book.time}
              </p>
              <p className="ob-line">
                {book.hook}
                <span className="ob-ready">
                  {book.ready
                    ? hasPanels(book.id)
                      ? "Pictures and music are ready, scene by scene."
                      : "Music is ready, scene by scene."
                    : "Coming soon. We're still setting this one to music."}
                </span>
              </p>
            </div>
            {book.ready ? (
              <Link className="ob-read" href={readHref(book.id)} aria-label={`Start reading ${book.title}`}>
                Start reading
                <svg className="ob-arr ob-arr--e" viewBox="0 0 120 30" aria-hidden="true" focusable="false">
                  <path d="M4 15 H100" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M100 8 L110 15 L100 22" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="110" y="12" width="6" height="6" transform="rotate(45 113 15)" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <svg className="ob-arr ob-arr--w" viewBox="0 0 120 30" aria-hidden="true" focusable="false">
                  <path d="M4 18 C 40 8, 70 26, 104 14" fill="none" stroke="#8DB8FF" strokeWidth="9" strokeLinecap="round" opacity=".7" />
                  <path d="M4 18 C 40 8, 70 26, 104 14 M104 14 l-12 -1 M104 14 l-4 -11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <svg className="ob-arr ob-arr--i" viewBox="0 0 120 30" aria-hidden="true" focusable="false">
                  <path d="M4 20 C 30 6, 44 28, 66 14 S 96 8, 104 15 M104 15 l-13 1 M104 15 l-3 -12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </Link>
            ) : (
              <p className="ob-cta-soon">
                <span className="ob-soon">Coming soon</span>
                <Link className="ob-wait" href={readHref("oz")}>
                  Read Oz while you wait
                </Link>
              </p>
            )}
          </figure>
        </section>
      </div>
    </>
  );
}
