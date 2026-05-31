# useBookProcessing Hook + SSE Stream Lifecycle Implementation Plan

> Issue: [#65](https://github.com/martinmw13/lectoria/issues/65) — `refactor(frontend): useBookProcessing hook owns the SSE stream lifecycle`
> Parent: #31 · Blocked by: #64 (PR #75) · Branch/commit prefix: `refactor(frontend):`
> **Build only after #64 merges.** This branch was cut from `main` *before* #64; integrate by
> `git merge origin/main` (not rebase — force-push is blocked) once #64 lands, then implement.

## Overview

Move the book-processing SSE stream lifecycle out of `UploadPage` and the callback-based
`processBook` into a `useBookProcessing` hook bound to the component, so cleanup can't be
forgotten by callers (the dropped-handle bug #64 patched manually). Extract the hand-rolled
SSE wire parsing into a dependency-free module so the wire format is encoded in one place,
and replace the `err.includes('409')` string-match with a typed `ProcessingError` union.

This is the structural fix that makes the #64 force-redirect *impossible to reintroduce*:
the hook aborts on unmount, and routing lives in a `UploadPage` effect that only runs while
mounted.

## Current State Analysis

**`frontend/src/api/client.ts:54-119` — `processBook`:** builds the URL + provider headers,
creates an `AbortController`, runs an async IIFE that `fetch`es `POST .../process`, and
hand-parses the SSE body inline:
- `buffer.split('\n')` — single-line splitter (`client.ts:92`). sse-starlette emits multi-line
  `data` as **multiple `data:` lines** (only the first carries the `error:` prefix), so a
  pipeline `str(e)` containing newlines is mangled: the first line triggers `onError` and the
  function `return`s (`client.ts:102-104`), dropping the rest.
- `event: ping` / `data: keepalive` frames (emitted every 120 s of silence —
  `lectoria/api/routes/books.py:193`) are treated as ordinary `data:` lines and leak into the
  progress log as literal `keepalive` entries (`client.ts:106` → `onProgress`).
- Pre-stream HTTP errors (e.g. the **409** "already processed" raised at
  `books.py:160`, *before* the SSE response opens) surface via `onError(\`HTTP ${res.status}: ...\`)`
  (`client.ts:78-81`); in-stream pipeline failures surface via `onError("error: ...")`
  (`client.ts:102-103`). Both collapse into one `string`.
- `signal.aborted` guard at `client.ts:112` suppresses the post-abort error — **must be preserved.**

**`frontend/src/pages/UploadPage.tsx` (post-#64):** owns `processing`/`progress`/`error`
state, calls `processBook` with five callbacks (capturing the abort handle into
`abortStreamRef` per #64), routes on completion *inside the `onDone` callback*
(`navigate('/reader/<id>')`), and detects overwrite via `err.includes('409')`. The local
`error` string does triple duty: upload errors (`handleUpload` catch), the client-side
"No LLM API key configured … Settings" validation message, and processing errors.

**Backend wire format (authoritative — `books.py:167-203`, sse-starlette
`event.py:32-59`, default sep `\r\n`):**
```
event: progress\r\n   data: <stage>: <detail>\r\n   \r\n      # normal progress
event: progress\r\n   data: done: <book_id>\r\n   \r\n        # completion
event: progress\r\n   data: error: <line1>\r\n   data: <line2>\r\n   \r\n   # multi-line str(e)
event: ping\r\n        data: keepalive\r\n   \r\n               # 120s keepalive
```
Type is double-encoded (in `event:` *and* the `data:` prefix) — a known wart documented in
ADR-0001. **Today** the client keys off the `data:` prefix *alone* and ignores the `event:`
line, so a ping frame's `data: keepalive` leaks as a spurious progress entry; Phase 1's
interpreter fixes this by reading `event:` and dropping `event: ping` frames.

## Desired End State

Three clean layers:
- **`frontend/src/api/sseParser.ts`** (new) — generic, dependency-free SSE framing +
  a pure interpreter. Unit-testable against canned chunk streams (the test runner itself is
  #66, not this slice).
- **`frontend/src/api/client.ts`** — `processBook` removed; a thin `openProcessingStream`
  does only transport (URL/params/headers + `fetch`, returns the `Response`).
- **`frontend/src/hooks/useBookProcessing.ts`** (new) — owns the `AbortController`, drives
  the parser, exposes `{ status, progress, error, finalBookId, start }`, aborts on unmount.
- **`frontend/src/pages/UploadPage.tsx`** — consumes the hook; routing + overwrite detection
  live in effects keyed off `status`/`finalBookId`/`error`.

Verify: `npm run build` + `npm run lint` clean; `just check`/`just test` green; manual smoke
(see Success Criteria) confirms ping-drop, multi-line errors, the 409 dialog, completion
routing, and no force-redirect after navigating away.

## What We're NOT Doing

- **No frontend test runner** (vitest et al.) — deferred to #66. The parser/interpreter are
  *structured* as pure units for those future tests; none are added here.
- **No backend change.** The `event:` / `data:`-prefix double-encoding stays; splitting into
  distinct `event: done`/`event: error` is a separate deferred issue (noted in ADR-0001).
- **Not touching** `PageView.tsx`, `hooks/useSceneImage.ts`, `CONTEXT.md` (#70/#73 territory),
  or any provider/route code.
- **No new ADR** — ADR-0001 (shipped in #64) already covers the fetch-vs-EventSource decision.

---

## Phase 1: SSE parser module (`frontend/src/api/sseParser.ts`)

The leaf layer — no React, no `fetch`, no app types. Two units + their types.

### Changes Required

#### 1. Frame + result types
```ts
export interface SSEFrame {
  event: string;   // defaults to 'message' per the SSE spec when no event: field is sent
  data: string;    // multi-line data joined with '\n' (trailing '\n' stripped)
}

export type ProgressUpdate =
  | { type: 'ping' }                          // keepalive — caller drops
  | { type: 'progress'; message: string }
  | { type: 'done'; bookId: string }
  | { type: 'error'; message: string };       // in-stream pipeline failure (no HTTP status)
```

#### 2. `parseSSEStream` — generic frame reader
**File**: `frontend/src/api/sseParser.ts`
```ts
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame>
```
WHATWG line-parse algorithm, robust to the three concerns #65 calls out:
- **Chunk-boundary buffering**: accumulate decoded text (`TextDecoder`, `{ stream: true }`) in a
  buffer; extract only *complete* lines. A line ends at `\n`, `\r\n`, or a lone `\r` — but a
  trailing lone `\r` at the end of the current buffer is **held back** (it may be the first half
  of a `\r\n` split across chunks).
- **Blank-line event separation**: an empty line dispatches the accumulated event (`yield`) and
  resets `eventType`/`dataLines`.
- **Multi-line `data:`**: each `data:` line's value (one optional leading space stripped after
  the colon) is pushed to `dataLines`; on dispatch, `data = dataLines.join('\n')`. Lines starting
  with `:` are comments (ignored); unknown fields ignored. `event:` sets `eventType`.
- `finally { reader.cancel().catch(() => {}); }` so an early consumer `return` (on done/error)
  tears down the underlying connection instead of leaking it.
- No trailing-event flush at EOF: the backend terminates every event with a blank line, so a
  partial trailing event is never expected (and per spec is not dispatched).

#### 3. `interpretProgressEvent` — pure interpreter
**File**: `frontend/src/api/sseParser.ts`
```ts
export function interpretProgressEvent(frame: SSEFrame): ProgressUpdate
```
- `frame.event === 'ping'` → `{ type: 'ping' }`.
- else dispatch by `data` prefix (preserves the documented "key off the `data:` prefix" contract,
  robust to the `event:` wart):
  - `startsWith('done:')` → `{ type: 'done', bookId: data.slice('done:'.length).trim() }`
  - `startsWith('error:')` → `{ type: 'error', message: data.slice('error:'.length).trim() }`
    (the `.trim()` strips the leading space; interior newlines of a multi-line `str(e)` are
    **preserved**)
  - otherwise → `{ type: 'progress', message: data }`

### Success Criteria
#### Automated
- [ ] `npm run build` (`tsc -b && vite build`) — module type-checks, no `any`.
- [ ] `npm run lint` — clean.

---

## Phase 2: `client.ts` — replace `processBook` with `openProcessingStream`

Transport only. Parsing and lifecycle leave `client.ts`.

### Changes Required
#### 1. Remove `processBook` (`client.ts:54-119`) and add:
**File**: `frontend/src/api/client.ts`
```ts
export interface ProcessOptions { maxChapters?: number; force?: boolean; }

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
```
- The hook inspects `res.ok` / `res.status` / `res.body`; `client.ts` no longer reads the body.
- `providerHeaders()` (`client.ts:3-15`) is unchanged and reused (BYOK headers — D17/D34).

### Success Criteria
#### Automated
- [ ] `npm run build` — no remaining references to `processBook` (compile error if missed).
- [ ] `npm run lint` — clean.

---

## Phase 3: `useBookProcessing` hook (`frontend/src/hooks/useBookProcessing.ts`)

Owns the `AbortController` and all stream state. No navigation here (routing stays in the page).

### Changes Required
#### 1. Public surface + error union
**File**: `frontend/src/hooks/useBookProcessing.ts`
```ts
export type ProcessingError =
  | { kind: 'http'; status: number; message: string }   // pre-stream HTTP (e.g. 409) — carries status
  | { kind: 'stream'; message: string };                 // in-stream pipeline failure — message only

export type ProcessingStatus = 'idle' | 'running' | 'done' | 'error';

export function useBookProcessing(): {
  status: ProcessingStatus;
  progress: string[];
  error: ProcessingError | null;
  finalBookId: string | null;
  start: (bookId: string, opts?: ProcessOptions) => void;
  reset: () => void;   // ← added during implementation (see note below)
};
```

> **Surface addition — `reset()`.** The grilled surface had no `reset`. Implementation
> required one: because `UploadPage` *derives* the overwrite dialog from `error` (rather than
> storing it — see Phase 4), analyzing a *new* book after a 409 must clear the stale error, or
> the dialog would linger. `reset()` returns the hook to idle (abort + clear
> progress/error/finalBookId). Small, implementation-driven extension; flagged for review.

#### 2. Implementation notes (the landmine: two error paths must NOT be flattened)
- `useState` for `status`, `progress`, `error`, `finalBookId`; `useRef<AbortController | null>`
  for the controller.
- `start(bookId, opts)` (wrap in `useCallback`):
  1. `controllerRef.current?.abort()`; create a fresh `AbortController`, store in ref.
  2. Reset state: `status='running'`, `progress=[]`, `error=null`, `finalBookId=null`.
  3. Kick off an async IIFE:
     - `const res = await openProcessingStream(bookId, opts ?? {}, controller.signal);`
     - **`if (!res.ok)`** → read detail (`await res.text().catch(() => res.statusText)`),
       `setError({ kind: 'http', status: res.status, message: detail })`, `setStatus('error')`,
       return. ← **this is where 409 is born, with its status.**
     - `if (!res.body)` → `setError({ kind: 'stream', message: 'empty response body' })`,
       `setStatus('error')`, return.
     - `for await (const frame of parseSSEStream(res.body))`:
       `interpretProgressEvent(frame)` →
       - `ping` → continue (dropped — never enters `progress`)
       - `progress` → `setProgress(prev => [...prev, update.message])`
       - `done` → `setFinalBookId(update.bookId)`, `setStatus('done')`, return
       - `error` → `setError({ kind: 'stream', message: update.message })`, `setStatus('error')`,
         return ← **in-stream error, no status.**
     - `catch (e)`: **`if (!controller.signal.aborted)`** → `setError({ kind: 'stream',
       message: String(e) })`, `setStatus('error')`. (Aborted → swallow: preserves the
       `signal.aborted` guard, so completing-then-unmounting fires no spurious error.)
- **Unmount cleanup**: `useEffect(() => () => controllerRef.current?.abort(), []);`
- No `navigate` and no routing logic in the hook.

### Success Criteria
#### Automated
- [ ] `npm run build` / `npm run lint` — clean, no `any`, `interface`/`type` per the union shape.
#### Manual (after Phase 4 wires it in)
- [ ] `ping` keepalives never appear in the progress log.

---

## Phase 4: `UploadPage` migration

Consume the hook; routing on completion is a mount-scoped effect, and the overwrite dialog is
**derived** from the error (not stored + set in an effect — this repo's eslint rule
`react-hooks/set-state-in-effect` forbids `setState` inside `useEffect`).

### Changes Required
**File**: `frontend/src/pages/UploadPage.tsx`
1. Delete the #64 `abortStreamRef` + its cleanup effect and the local `processing`/`progress`/
   `confirmOverwrite` stream state; replace the destructure with
   `const { status, progress, error: processingError, finalBookId, start, reset } = useBookProcessing();`
   Keep local `error` (rename mentally to "form/validation error") for `handleUpload` failures
   and the missing-key message; keep `estimate`/`maxChapters`/`books`. Derive
   `const processing = status === 'running';`.
2. `startProcessing(force)`: keep the BYOK-key guard (sets local `error` + Settings link), then
   `setError('')` before `start(estimate.book_id, { maxChapters: maxChapters > 0 ? maxChapters : undefined, force })`.
   No `setConfirmOverwrite` needed: `start()` clears the hook error, and the derived
   `confirmOverwrite` follows it — so the **Reprocess** path transitions cleanly from dialog to
   progress panel with no overlap (the other half of the union landmine, now handled by
   derivation rather than a manual reset).
   `handleUpload` calls `reset()` (alongside `setError('')`/`setEstimate(null)`) so analyzing a
   new book clears any stale 409 dialog.
3. **Routing effect (mount-scoped — structurally prevents the #64 redirect):**
   ```ts
   useEffect(() => {
     if (status === 'done' && finalBookId) navigate(`/reader/${finalBookId}`);
   }, [status, finalBookId, navigate]);
   ```
4. **Overwrite detection via the typed union (replaces `err.includes('409')`), derived — not
   an effect** (eslint forbids `setState` in `useEffect`; derivation also clears it for free
   when the error clears):
   ```ts
   const confirmOverwrite = processingError?.kind === 'http' && processingError.status === 409;
   ```
5. **Display error** — show the validation/upload error, else the processing error message,
   *except* the 409-overwrite case (which drives the dialog, not the banner):
   ```ts
   const displayError = error
     ? error
     : processingError && !(processingError.kind === 'http' && processingError.status === 409)
       ? processingError.message
       : null;
   ```
   Render `displayError` in `.error-msg`; the Settings-link check becomes
   `displayError?.includes('Settings')`. A non-409 HTTP error (e.g. 500) and stream errors both
   show their message.
6. Replace every `processing` boolean with `status === 'running'` (button `disabled`, the
   estimate-card render guard, the progress-panel render guard).

### Success Criteria
#### Automated
- [ ] `npm run build` (`tsc -b && vite build`) — clean.
- [ ] `npm run lint` (`eslint .`) — clean, no `any`.
- [ ] `just check` + `just test` — green (backend unaffected).
- [ ] Revert any `uv.lock` 0.2.x version drift before committing (uv re-bumps it).
- [ ] README "Project layout" check — `hooks/` already exists (from #73); add `sseParser.ts` /
      `useBookProcessing.ts` only if that section enumerates individual files.

#### Manual (requires a BYOK LLM key + `just dev-all`)
- [ ] **Happy path**: process a small book → progress lines stream, no `keepalive` lines, on
      completion the page routes to `/reader/<id>`.
- [ ] **409 overwrite**: process an already-processed book → the overwrite dialog appears
      (driven by `kind: 'http'` + `status === 409`), not an error banner; "Reprocess" works.
- [ ] **In-stream error**: force a pipeline failure (e.g. invalid key mid-run) → error banner
      shows the (possibly multi-line) message, no redirect.
- [ ] **Abort-on-unmount (the #64 regression guard)**: start processing, navigate away
      immediately → no force-redirect into the reader when the pipeline finishes, no stray
      callbacks. Completing *then* unmounting fires no spurious error.

---

## Sequencing & Integration

1. **Wait for #64 (PR #75) to merge.** Then in this worktree: `git merge origin/main`
   (brings ADR-0001, the coding-rule update, and #64's `UploadPage` abort wiring — which
   Phase 4 then removes). Resolve the `UploadPage.tsx` overlap in favor of the hook.
2. Implement Phases 1→4 in order (parser → client → hook → page); each phase type-checks on its own.
3. `npm ci` (fresh worktree), then the automated gates; revert `uv.lock` drift.
4. Run the manual smoke (needs a key — coordinate with the maintainer, same constraint as #64).
5. Draft PR via the template, `Closes #65`; no AI co-author / no AI mention; `--no-verify` commit.
6. After merge: this unblocks the `client.ts` contention for #63 (byok), #67 (codegen), #69 (NCM swap).
