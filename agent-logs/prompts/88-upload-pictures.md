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
# Task: pictures, chapter panels and the Picture Vault for uploaded books

Uploaded EPUB books (ids matching `isUploadId` in core/uploads.ts, `u-` prefix) must get everything shelf books get in the reader: "Picture this" passage pictures, "Relive this chapter in panels" (chapter panels), and the Picture Vault right column. Today PR #138 deliberately hides them:
- app/leer/book-view.tsx ~line 49: `visualsOn = visualsOnProp ?? !isUploadId(model.bookId)`; app/reader.tsx ~line 404 has the same flag (leave `chatOn` there alone).
- server/images/handler.ts rejects non-shelf ids with `isReadyBookId` and loads with `loadBookData` (shelf only). `loadBook` in server/books.ts already loads finished uploads (returns notFound() when missing/expired).

Owner decisions (binding):
1. Character context: uploads have no pregenerated bookmap. Degrade gracefully: `getBookmap` already yields "" for unknown books, so prompts are built from the passage / scene / chapter text alone. Do NOT add a bookmap step to the upload pipeline.
2. Quotas: image requests for uploads count against exactly the same per-person image quota (DAILY_IMAGE_LIMIT via takeDualQuota) and the same spend caps as shelf books. Nothing new to configure.
3. BYOK: add an optional reader key on POST /api/images using the existing `BYOK_HEADER` from core/chat.ts (same header the upload flow and chat send). Parse/trim it the way server/chat/handler.ts does. When present: generate with that key (createMetaClient(byokKey)), still take the per-person image quota (same limit), but skip our spend reserve (reserveSpend) since we don't pay. Never persist, cache, log or echo the key; never include it in errors. Only Meta keys make pictures, so the client only sends it when the upload was done with provider "meta".
   Client side: keep the key in memory only. Add a tiny client module (e.g. app/leer/reader-key.ts) with a module-level Map<bookId, key> and set/get functions. In app/home/upload.tsx, when an upload finishes with a Meta BYOK key, store it for that book id right before `router.push` (client-side navigation keeps module memory; a reload loses it and the reader then falls back to our key under the normal quota, which is fine). The pictures fetch (find where usePictures / the panels request call /api/images) adds the header when a key exists for that book. No localStorage/sessionStorage for the key. Check how byok.tsx returns provider info; if the provider isn't exposed to upload.tsx, pass it through minimally.
4. Spoiler safety stays: panels only for chapters the reader reached (reachedCh / `ch > reachedCh` refusal already exists; make sure it applies to uploads too).
5. Book text is untrusted: keep it delimited as data in prompts exactly the way shelf passages are (reuse the same prompt builders, don't build new prompt strings). Content-filter or other failures must show the existing friendly retry UI; no raw errors to the client.
6. Missing/expired/unfinished upload ids must return the existing `bad_request` JSON (400), not a 503 or a thrown notFound. Unknown non-upload ids still 400 before env/quota/spend as today.
7. Cleanup: upload images live in the public image Blob store at `images/<u-id>/...` (core/images.ts imageKey). The daily cron (app/api/cron/cleanup-uploads -> server/uploads/cleanup.ts) must also delete image blobs under `images/u-` older than UPLOAD_TTL_DAYS, using the image store (default BLOB_READ_WRITE_TOKEN store, not the private uploads token). Keep the "one failure never stops the rest" style. Add a test with a fake store.
8. Shelf books must behave and look exactly the same (same DOM, same requests, same cache keys). Do not change PROMPT_VERSION / CHAPTER_PROMPT_VERSION.

Tests (mock Meta, Blob, Redis): update/replace the #138 tests that assert pictures are hidden for uploads (grep for isUploadId / "u-" / no-visuals in *.test.ts(x), e.g. app/reader-upload.test.tsx, book-view tests, server/images/handler.test.ts, server/books.test.ts) so they now assert pictures are shown/served for uploads. Add handler tests: upload id served via loadBook (inject a loader dep rather than real Blob), missing upload -> 400, BYOK header uses the reader key and skips spend reserve but still takes quota, no BYOK -> our key + spend reserve, key never appears in the response. Update comments that say uploads are shelf-only for pictures. Also run `npm run lint` and `npm run build` at the end if they exist in package.json (build must pass; it needs no secrets).
