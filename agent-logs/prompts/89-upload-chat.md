# Task: Ask-the-book chat for uploaded books, plus friend-code field after a file is picked

Worktree: this repo, branch feat/upload-pictures (already has pictures/panels/vault for uploaded `u-` books and friend codes). Build on it.

## Part A: chat for uploads (main goal)
Today chat is shelf-only: `app/reader.tsx` sets `chatOn = !isUploadId(bookId)`, and `server/chat/handler.ts` rejects ids that fail `isKnownBookId` and loads via `loadBookData` (shelf only). Change it so uploaded books get chat with exactly the same behaviour as shelf books:
1. `server/chat/handler.ts`: accept `isKnownBookId(id) || isUploadId(id)` (from `@/core/uploads`). Load the book via `loadBook` from `@/server/books` (shelf + finished uploads), injectable through a new optional `deps.loadBook?: (bookId: string) => Promise<BookPayload>` like `server/images/handler.ts` does. A missing/expired/unfinished upload (loadBook throws notFound) must answer 400 `bad_request` with the generic message, never a throw/404/500, and must refund the quota it took (or check the book before taking quota; pick the simpler correct option — loading before quota is fine since it costs no Meta money, but don't let an unknown id consume quota).
2. Keep everything else identical for uploads: same `buildChatSystemPrompt` (same kind "the book has not said so yet" fallback), same spoiler gate `bookTextUpTo(book.paragraphs, book.chapters, body.upToN, body.spoilers)` with the clamp, same per-person dual quota (`CHAT_DAILY_LIMIT` / `CHAT_BYOK_DAILY_LIMIT`), same spend reserve on our key, same BYOK header path (reader key skips our spend reserve, still takes quota, never logged/echoed). Book text is untrusted: it must stay inside the existing delimited data block of the system prompt; do not add book text anywhere else (e.g. not in logs, not in error messages). Logs keep book id only.
3. `app/reader.tsx`: mount `ReaderChat` for uploads too (drop the gate; update the comment).
4. `app/chat/reader-chat.tsx`: when the reader finished the upload with their own key, `getReaderKey(bookId)` from `app/leer/reader-key.ts` returns it (module memory only). Use it as the initial BYOK key for chat on that book, so their questions go on their key. Keep the existing memory-only rule. Closing the panel currently clears `byokKey`; for an upload key from reader-key memory, after close fall back to that reader key again (not null) — simplest: compute `const effectiveKey = byokKey ?? getReaderKey(bookId)` and pass that to useChat and ChatPanel. Never persist or log it.
5. Fix comments that say chat is shelf-only (`server/books.ts` loadBookData comment, `app/reader.tsx`).

Tests (mock Meta, Blob, Redis, Turnstile; no network):
- server chat: an upload id served through injected `loadBook` gets a streamed answer, the system prompt contains only text up to upToN (a marker paragraph after upToN must NOT appear in the upstream messages when spoilers are off), quota taken; a missing upload answers 400 bad_request and takes no quota / refunds it; an upload with BYOK header uses the reader key for the streamer and reserves no spend. Put these in a NEW file `server/chat/handler-uploads.test.ts` (handler.test.ts is near the size limit), reusing `server/chat/test-fixtures.ts` helpers.
- `app/reader-upload.test.tsx`: flip the "hides chat for an upload id" test to "mounts chat for an upload id" and update the file's header comment.
- reader-chat: a test that with a reader key set via `setReaderKey`, the chat request carries the BYOK header (or that useChat receives the key) — keep it small, in an existing chat test file if it fits the size limit, otherwise a new small file.

## Part B: friend-code field after a file is picked (only if simple)
`app/home/upload.tsx` shows "Have a friend code?" / the "Friend code" input only on the idle screen. Extract that block into a small component (same file or `app/home/friend-code.tsx`) and also render it on the parsed screen (after a file is picked, both for the free route and the BYOK route, under the book card, above the actions), and in `FailedView` for `daily_books_reached` (there, add a quiet "Try with friend code" action that retries `onRetry` without a key when a code is entered). The code stays in state only; same input attributes (maxLength 64, autoComplete off, spellCheck false). The route already re-evaluates: `uploadRoute(words, friendCode.trim() ? 0 : freeCount)` so typing a code on the BYOK screen switches to the free route — that's desired. Add a test in `app/home/upload.test.tsx` (or a new small test file if the size limit bites) that the friend field is reachable after a file is picked. Keep copy warm; never the word "Generated".

## Out of scope
Do not build narration/read-aloud or music for uploads. Don't touch pictures code.
## Rules (all mandatory)
- Repo: lectoria (Next.js 16, React 19, vitest). Read AGENTS.md first and follow it.
- Do NOT commit, push, deploy or create branches. Just edit files in this worktree; I review and commit.
- Never read, print or copy .env* files or any secret. Tests must mock Meta, Blob, Redis, Turnstile; no real network calls.
- Never load production music. Do not start dev/prod servers (I do browser checks myself). Don't kill any process you didn't start.
- Keep every file under the repo's size limit (run `npm run check:size`). Split modules if needed.
- UI rules: light mode default, Meta blue #0866FF, never purple. English, warm copy, never the word "Generated". Boxless buttons that still read as clickable. Animate only on hover/click/state change; respect prefers-reduced-motion (no transition under reduce). Keep the string "Bring your own key!" exactly as is.
- Small, focused diff. No unrelated refactors. Add/adjust unit tests for behavior you change.
- Before finishing run: `npm run typecheck`, `npx vitest run`, `npm run check:size`, `npm run check:secrets`. All must pass.
- Final answer: a short summary of what you changed (files) and anything you skipped and why.
- Also run `npx eslint <files you touched>`: introduce no new lint errors in files you touch.
- Be economical: explore only what you need, don't re-read big files repeatedly, don't print huge outputs.
