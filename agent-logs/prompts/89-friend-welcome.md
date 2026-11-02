# Task: show a welcome line once the server accepts a friend code (same branch, build on current changes)

Context: branch feat/upload-pictures has friend codes. The create response from POST /api/uploads (server/uploads/handler.ts) already includes `friendAccepted: true|false` after the server re-validated the code with acceptFriendCode. The worktree has uncommitted changes from earlier steps (chat for uploads, FriendCode component in app/home/upload.tsx, friend word cap): keep them, don't revert anything.

Requirement (the product owner's explicit request; Spanish copy is intended for this one string, overriding the English-copy rule): when the server confirms a friend code, show this message to the user exactly (character for character, including accents and punctuation):

Hola, escofletudo, te estaba esperando. Mirá cómo te gusta gastarme los créditos. No pinta, amigo. Literalmente una escofleta.

1. app/home/upload-flow.ts: read `friendAccepted` from the create response (only `=== true` counts; anything else is false) and surface it to the caller (e.g. an optional `onFriendAccepted` callback or a field on the progress/state the flow already reports, whatever fits the existing shape with the least change). Never echo or store the code itself.
2. app/home/upload.tsx: keep a `friendWelcome` boolean in state (reset when a new file is picked / on reset). Show the message only after the server confirmed it, inline where the reader sees it while the book is processing (the working/finishing view) and next to the friend-code field if that field is visible. Put the exact string in one exported constant (e.g. `FRIEND_WELCOME` in app/home/upload.tsx or the existing upload copy module) so tests import it. Render it as a small warm note: `<p className="ob-friend-ok" role="status">`. Add a CSS rule in the existing home/upload stylesheet: light mode, Meta blue accent #0866FF (e.g. a 3px left border in #0866FF, a very light blue background like #F0F6FF, dark readable text, rounded corners, modest padding). Never show it on a wrong code, on the BYOK path, or before the response.
3. Tests (mock fetch; no network):
   - upload-flow test: a create response with friendAccepted true surfaces true; false/missing surfaces false.
   - upload.tsx test: after picking a file, entering a friend code and starting, with the mocked create response `friendAccepted: true`, the exact message appears; with `friendAccepted: false` it does not. Check the message text equals the constant and the code string never appears in the DOM outside the input.
   Keep test files under the 5000-token size limit (bytes/4); make a new small test file if an existing one is near it.
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
