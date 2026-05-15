# Design: Pipeline observability and scene image generation

## D31 -- CompletionResult return type

**Decision:** `LLMProvider.complete()` returns a `CompletionResult` dataclass instead of a plain `str`. The dataclass carries `text`, `prompt_tokens`, and `completion_tokens`.

**Rationale:** Keeps the provider protocol simple (one return value) while surfacing usage metadata that the Gemini SDK already provides (`response.usage_metadata`). Callers that only need text use `.text`.

**Tradeoff:** All call sites of `provider.complete()` must be updated to use `.text`. The change is mechanical.

## D32 -- 429 backoff inside the provider

**Decision:** When the Gemini adapter catches a 429 / RESOURCE_EXHAUSTED error, it retries up to 3 times with a delay parsed from the API's `retryDelay` field (or exponential backoff starting at 30s if absent). This is separate from the content-level retries in `narrative.py`.

**Rationale:** Rate-limit errors are transient infrastructure issues, not content failures. Handling them at the provider layer avoids burning `narrative.py`'s limited retry budget on recoverable errors. Default LLM 2 concurrency is also reduced from 3 to 2 to lower burst pressure on free-tier quotas.

## D33 -- Scene image endpoint and "Picture scene" button

**Decision:** A new `POST /api/books/{book_id}/images/scene` endpoint accepts `{ chapter_index, scene_index }`, checks for a cached image on disk, and if absent calls `generate_scene_image()`. The frontend adds a "Picture scene" button in the scene header that triggers this endpoint after a confirmation dialog. The image is saved to `images/scenes/ch{N}_sc{M}.png` -- the same path used by the automatic pipeline -- so it loads automatically on revisit.

**Rationale:** Reuses existing `generate_scene_image()` and the static file serving mount. No new caching path or storage format is needed. The confirmation avoids accidental API calls.
