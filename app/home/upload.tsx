"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RawSection } from "@/core/clean-types";
import { EPUB_ERROR_MESSAGES, EpubError, readEpubFileWithSections, type EpubBook } from "@/core/epub";
import { UPLOAD_MESSAGES } from "@/core/uploads";
import { approxPages, FREE_BOOK_MAX_WORDS, uploadRoute } from "@/core/upload-policy";
import { setReaderKey } from "../leer/reader-key";
import { TurnstileWidget } from "../turnstile";
import { BookCard } from "./book-card";
import { ByokStep } from "./byok";
import { countFreeBookToday, getFreeBooksToday } from "./free-book";
import { FRIEND_WELCOME, FriendCode } from "./friend-code";
import { HomeIcon } from "./home-icons";
import { saveMyBook } from "./my-books";
import { driveUpload, UploadFlowError, type FlowCode, type FlowProgress } from "./upload-flow";

interface ParsedBook {
  book: EpubBook;
  sections: RawSection[];
}

type Status =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "error"; message: string }
  | { step: "parsed"; parsed: ParsedBook }
  | { step: "working"; parsed: ParsedBook; key: string | null; progress: FlowProgress | null }
  | { step: "finishing"; parsed: ParsedBook; id: string; progress: FlowProgress }
  | {
      step: "failed";
      parsed: ParsedBook;
      key: string | null;
      code: FlowCode;
      progress: FlowProgress | null;
    };

const NETWORK_MESSAGE = "We lost the connection for a moment. Try again?";

function progressCopy(progress: FlowProgress | null): string {
  if (!progress) return "Reading your book…";
  if (progress.total > 0 && progress.done >= progress.total) return "Setting it to music…";
  if (progress.done <= 0) return "Finding the scenes…";
  return `Listening for the mood of chapter ${progress.done + 1} of ${progress.total}…`;
}

function progressPercent(progress: FlowProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}

// Client upload: the EPUB parses in the browser, then the sections POST
// to /api/uploads and the steps run until done. Keys live in state only.
export function UploadSection() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const [freeCount, setFreeCount] = useState(0);
  // Friend code lives in state only: never stored, never logged. When
  // one is entered the server decides the quota, not the local hint.
  const [friendCode, setFriendCode] = useState("");
  const [friendWelcome, setFriendWelcome] = useState(false);
  // Typing after a result clears it: the welcome note follows the code.
  const onFriendCode = (value: string) => {
    setFriendCode(value);
    setFriendWelcome(false);
  };
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  // Tab-only scratch: never stored, logged, or sent; dies with this component.
  const [idleKey, setIdleKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const freePages = approxPages(FREE_BOOK_MAX_WORDS);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only free-book count from localStorage after hydration
  useEffect(() => setFreeCount(getFreeBooksToday()), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  // The result views replace the drop zone, so move focus into the
  // result; otherwise keyboard focus is lost when it unmounts.
  useEffect(() => {
    if (status.step !== "idle" && status.step !== "reading" && status.step !== "error") {
      resultRef.current?.focus();
    }
  }, [status]);

  const parsed =
    status.step === "parsed" ||
    status.step === "working" ||
    status.step === "finishing" ||
    status.step === "failed"
      ? status.parsed
      : null;
  const book = parsed?.book ?? null;
  useEffect(() => {
    if (!book?.cover) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cover blob URL follows the parsed book
      setCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([book.cover.bytes as BlobPart], { type: book.cover.mediaType }));
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [book]);

  async function openFile(file: File) {
    setFriendWelcome(false);
    setStatus({ step: "reading" });
    try {
      const { book: parsedBook, sections } = await readEpubFileWithSections(file);
      setStatus({ step: "parsed", parsed: { book: parsedBook, sections } });
    } catch (err) {
      const message =
        err instanceof EpubError ? EPUB_ERROR_MESSAGES[err.code] : EPUB_ERROR_MESSAGES.unreadable;
      setStatus({ step: "error", message });
    }
  }

  function reset() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setIdleKey("");
    setShowKey(false);
    setFriendWelcome(false);
    setStatus({ step: "idle" });
  }

  function startDrive(
    next: ParsedBook,
    opts: { key: string | null; token?: string | null; jobId?: string | null; progress?: FlowProgress | null },
  ) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const run = (runRef.current += 1);
    const alive = (): boolean => runRef.current === run && !ctrl.signal.aborted;
    const key = opts.key;
    let counted = opts.jobId != null;
    let latest = opts.progress ?? null;
    // A fresh create re-validates the code; until it answers, no welcome.
    if (opts.jobId == null) setFriendWelcome(false);
    setStatus({ step: "working", parsed: next, key, progress: latest });
    void driveUpload({
      title: next.book.title,
      author: next.book.author,
      sections: next.sections,
      key,
      friendCode: key ? null : friendCode.trim() || null,
      token: opts.token ?? null,
      jobId: opts.jobId ?? null,
      signal: ctrl.signal,
      onFriendAccepted: (accepted) => {
        if (alive()) setFriendWelcome(accepted);
      },
      onProgress: (progress) => {
        if (!alive()) return;
        if (!counted) {
          counted = true;
          if (!key) {
            countFreeBookToday();
            setFreeCount(getFreeBooksToday());
          }
        }
        latest = progress;
        setStatus({ step: "working", parsed: next, key, progress });
      },
    }).then(
      ({ id, chapters }) => {
        if (!alive()) return;
        // Every key in this flow is Meta (the steps are metaOnly), so the
        // reader can picture the book on it; module memory dies on reload.
        if (key) setReaderKey(id, key);
        saveMyBook({ id, title: next.book.title, author: next.book.author ?? "Unknown author", savedAt: Date.now() });
        setStatus({
          step: "finishing",
          parsed: next,
          id,
          progress: latest ?? { jobId: id, done: 1, total: 1, chapters },
        });
        router.push(`/read/${id}`);
      },
      (err: unknown) => {
        if (!alive()) return;
        if (err instanceof UploadFlowError) {
          setStatus({ step: "failed", parsed: next, key, code: err.code, progress: latest });
          return;
        }
        setStatus({ step: "failed", parsed: next, key, code: "unavailable", progress: latest });
      },
    );
  }

  // With a code entered, the server decides; a wrong code still lands
  // on the BYOK step via too_long or daily_books_reached.
  const route =
    status.step === "parsed"
      ? uploadRoute(status.parsed.book.words, freeCount, friendCode.trim() !== "")
      : null;

  if (status.step === "working" || status.step === "finishing") {
    const progress = status.progress;
    return (
      <section className="ob-bring" aria-label="Bring your own book">
        <div ref={resultRef} tabIndex={-1}>
          <BookCard book={status.parsed.book} coverUrl={coverUrl} />
          <div
            className="ob-progress"
            role="progressbar"
            aria-label="Preparing your book"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent(progress)}
          >
            <div className="ob-progress-fill" style={{ width: `${progressPercent(progress)}%` }} />
          </div>
          <p className="ob-note" aria-live="polite">
            {progressCopy(progress)}
          </p>
          {friendWelcome && (
            <p className="ob-friend-ok" role="status">
              {FRIEND_WELCOME}
            </p>
          )}
        </div>
      </section>
    );
  }

  if (status.step === "failed") {
    return (
      <section className="ob-bring" aria-label="Bring your own book">
        <div ref={resultRef} tabIndex={-1}>
          <BookCard book={status.parsed.book} coverUrl={coverUrl} />
          <FailedView
            status={status}
            idleKey={idleKey}
            friendCode={friendCode}
            friendWelcome={friendWelcome}
            onFriendCode={onFriendCode}
            onFriendAccepted={() => setFriendWelcome(true)}
            onRetryKey={(key) =>
              startDrive(status.parsed, { key, progress: null })
            }
            onRetryToken={(token) =>
              startDrive(status.parsed, {
                key: status.key,
                token,
                jobId: status.progress?.jobId ?? null,
                progress: status.progress,
              })
            }
            onRetry={() =>
              startDrive(status.parsed, {
                key: status.key,
                jobId: status.progress?.jobId ?? null,
                progress: status.progress,
              })
            }
            onReset={reset}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="ob-bring" aria-label="Bring your own book">
      {status.step === "parsed" && route ? (
        <div ref={resultRef} tabIndex={-1}>
          <BookCard book={status.parsed.book} coverUrl={coverUrl} />
          <FriendCode
            code={friendCode}
            onCode={onFriendCode}
            welcome={friendWelcome}
            onAccepted={() => setFriendWelcome(true)}
          />
          {route.kind === "free" ? (
            <div className="ob-actions">
              <button
                className="ob-action"
                type="button"
                onClick={() => startDrive(status.parsed, { key: null })}
              >
                Read with soundtrack
              </button>
              <button className="ob-quiet" type="button" onClick={reset}>
                Choose another book
              </button>
            </div>
          ) : (
            <div>
              <ByokStep
                metaOnly
                reason={route.reason}
                initialKey={idleKey}
                onSubmit={(key) => {
                  setIdleKey("");
                  setShowKey(false);
                  startDrive(status.parsed, { key });
                }}
              />
              <div className="ob-actions">
                <button className="ob-quiet" type="button" onClick={reset}>
                  Choose another book
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div
            className={dragging ? "ob-drop over" : "ob-drop"}
            role="button"
            tabIndex={0}
            aria-label="Drop an EPUB here, or choose a file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void openFile(file);
            }}
          >
            <HomeIcon name="upload" />
            <p>
              Drop an EPUB here, or <span className="ob-pick">choose a file</span>
            </p>
            <small>EPUB only, up to 20 MB. Nothing leaves your computer until you choose to read it.</small>
            <input
              ref={inputRef}
              type="file"
              accept=".epub,application/epub+zip"
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void openFile(file);
              }}
            />
          </div>
          <div aria-live="polite">
            {status.step === "reading" && <p className="ob-file">Opening your book…</p>}
            {status.step === "error" && (
              <div className="ob-file-row">
                <p className="ob-file ob-err">{status.message}</p>
                <button className="ob-quiet" type="button" onClick={reset}>
                  Try another file
                </button>
              </div>
            )}
          </div>
          <div className="ob-picks" role="group" aria-label="How much reading to take">
            <button
              type="button"
              className="ob-pickbtn"
              aria-pressed={!keyOpen}
              onClick={() => {
                setKeyOpen(false);
                setIdleKey("");
                setShowKey(false);
              }}
            >
              <span className="ob-box" aria-hidden="true">
                <HomeIcon name="check-box" />
              </span>
              <span>
                <b>Free</b>
                <small>One free book a day is on us, up to about {freePages} pages each.</small>
              </span>
            </button>
            <button
              type="button"
              className="ob-pickbtn"
              aria-pressed={keyOpen}
              aria-expanded={keyOpen}
              aria-controls="obKeybox"
              onClick={() => {
                if (keyOpen) {
                  setIdleKey("");
                  setShowKey(false);
                }
                setKeyOpen(!keyOpen);
              }}
            >
              <span className="ob-keydoodle" aria-hidden="true">
                <HomeIcon name="key" />
              </span>
              <span>
                <b>Bring your own key!</b>
                <small>Longer books, or more of them? Use your own Meta key.</small>
              </span>
            </button>
          </div>
          <div className="ob-keybox" id="obKeybox" hidden={!keyOpen}>
            <div className="ob-keyrow">
              <label className="sr-only" htmlFor="obKey">
                Paste your API key
              </label>
              <input
                id="obKey"
                type={showKey ? "text" : "password"}
                placeholder="Paste your API key"
                autoComplete="off"
                spellCheck={false}
                name="transient-key"
                value={idleKey}
                onChange={(event) => setIdleKey(event.target.value)}
              />
              <button
                type="button"
                className="ob-eye"
                aria-label={showKey ? "Hide API key" : "Show API key"}
                aria-pressed={showKey}
                onClick={() => setShowKey((show) => !show)}
              >
                <HomeIcon name={showKey ? "eye-off" : "eye"} />
              </button>
            </div>
            <p className="ob-fine">It stays in this tab only. We never save it.</p>
          </div>
          <FriendCode
            code={friendCode}
            onCode={onFriendCode}
            welcome={friendWelcome}
            onAccepted={() => setFriendWelcome(true)}
          />
        </div>
      )}
    </section>
  );
}

// One failed upload: coded errors map to the next step, never a dead end.
function FailedView({
  status,
  idleKey,
  friendCode,
  friendWelcome,
  onFriendCode,
  onFriendAccepted,
  onRetryKey,
  onRetryToken,
  onRetry,
  onReset,
}: {
  status: Extract<Status, { step: "failed" }>;
  idleKey: string;
  friendCode: string;
  friendWelcome: boolean;
  onFriendCode: (code: string) => void;
  onFriendAccepted: () => void;
  onRetryKey: (key: string) => void;
  onRetryToken: (token: string) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const code = status.code;
  // A spent free book, or one over 50k words, still reads free with a
  // friend's code: the retry sends no key, and the server rules on it.
  if (code === "daily_books_reached" || code === "too_long") {
    return (
      <div>
        <ByokStep
          metaOnly
          note={UPLOAD_MESSAGES[code]}
          initialKey={idleKey}
          actionLabel="Bring your own key!"
          onSubmit={onRetryKey}
        />
        <FriendCode
          code={friendCode}
          onCode={onFriendCode}
          welcome={friendWelcome}
          onAccepted={onFriendAccepted}
        />
        <div className="ob-actions">
          <button
            className="ob-quiet"
            type="button"
            onClick={onRetry}
            disabled={friendCode.trim() === ""}
          >
            Try with friend code
          </button>
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "daily_budget_reached") {
    return (
      <div>
        <ByokStep
          metaOnly
          note={UPLOAD_MESSAGES[code]}
          initialKey={idleKey}
          actionLabel="Bring your own key!"
          onSubmit={onRetryKey}
        />
        <div className="ob-actions">
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "human_required") {
    return (
      <div>
        <p className="ob-note">{UPLOAD_MESSAGES.human_required} Complete the check and we&apos;ll pick up where we left off.</p>
        <TurnstileWidget onToken={onRetryToken} />
        <div className="ob-actions">
          <button className="ob-action" type="button" onClick={onRetry}>
            Try again
          </button>
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "expired" || code === "not_found") {
    return (
      <div>
        <p className="ob-note">{UPLOAD_MESSAGES[code]} Upload it again to start over.</p>
        <div className="ob-actions">
          <button className="ob-action" type="button" onClick={onReset}>
            Upload it again
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="ob-note" role="alert">
        {code === "network" ? NETWORK_MESSAGE : UPLOAD_MESSAGES[code]}
      </p>
      <div className="ob-actions">
        <button className="ob-action" type="button" onClick={onRetry}>
          Try again
        </button>
        <button className="ob-quiet" type="button" onClick={onReset}>
          Choose another book
        </button>
      </div>
    </div>
  );
}
