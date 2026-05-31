# Frontend streaming uses `fetch` + `ReadableStream`, not `EventSource`

The book-processing progress stream is delivered over Server-Sent Events, but the
frontend consumes it with `fetch` + `res.body.getReader()` and an `AbortController`
— **not** the browser-native `EventSource`. This is deliberate: the `POST /api/books/{book_id}/process`
request carries `max_chapters`/`force` as query params and the user's BYOK credentials as
custom request headers (`X-Provider-LLM`, `X-API-Key-LLM`, … — see CONTEXT.md D17/D34).
`EventSource` is GET-only and cannot set request headers, so it cannot carry the keys.
Because the connection is therefore manual, it must be torn down explicitly: today
`UploadPage` aborts the `AbortController` in its unmount cleanup, and the planned
`useBookProcessing` hook will own that controller and teardown.

## Considered options

- **`EventSource`** — native, auto-reconnects, simplest API. Rejected: GET-only and
  cannot set custom headers, so it cannot carry BYOK keys (D17) or a request body.
- **`fetch` + `ReadableStream` reader + `AbortController`** (chosen) — supports POST,
  custom headers, and manual cancellation, at the cost of a hand-rolled SSE frame parser
  (`parseSSEStream`) and explicit lifecycle management.

## Consequences

- The coding rule "SSE connections must be closed on unmount (`EventSource.close()`)"
  is honoured in spirit (abort the reader on unmount), not in letter — `.claude/rules/coding-rules.md`
  points here.
- A hand-rolled SSE frame parser must encode the wire format. The backend
  (`EventSourceResponse` in `lectoria/api/routes/books.py`) currently emits every payload as
  `event: progress` and re-encodes the real type in the `data:` prefix (`done:` / `error:`),
  with `event: ping` keepalives. The frontend keys off the `data:` prefix *alone* and ignores
  the `event:` line entirely, so a ping's `data: keepalive` payload falls through and surfaces
  as a spurious `keepalive` progress line rather than being dropped.
  This double-encoding (type in both `event:` and the `data:` prefix, with the `event:` field
  effectively unused by the client) is a known wart; moving to distinct `event: done` /
  `event: error` types is a backend change deferred to a separate issue.
