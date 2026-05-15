# Tasks -- pipeline observability and scene image generation

## Token logging

- [x] 1.1 Add `CompletionResult` dataclass to `lectoria/providers/base.py`; update `LLMProvider.complete` return type
- [x] 1.2 Update `lectoria/providers/llm/google.py` to extract `usage_metadata` and return `CompletionResult`; log per-call tokens
- [x] 1.3 Update `lectoria/services/narrative.py` call sites to use `.text`; accumulate and return token counts from `analyze_book` and `analyze_chapter`
- [x] 1.4 Update `lectoria/services/pipeline.py` to emit token totals in SSE progress events after LLM 1 and LLM 2

## Rate-limit resilience

- [x] 2.1 Add 429 detection and backoff retry logic in `lectoria/providers/llm/google.py`
- [x] 2.2 Reduce `llm2_concurrency` from 3 to 2 in `lectoria/services/pipeline.py`

## Scene image generation

- [x] 3.1 Add `POST /{book_id}/images/scene` endpoint in `lectoria/api/routes/images.py`
- [x] 3.2 Add `generateSceneImage()` function in `frontend/src/api/client.ts`
- [x] 3.3 Add "Picture scene" button with confirm dialog in `frontend/src/components/PageView.tsx`; hide when image exists
- [x] 3.4 Add CSS for the button in `frontend/src/index.css`

## Tests

- [x] 4.1 Update existing tests that call `provider.complete()` to handle `CompletionResult`
- [x] 4.2 Run full test suite and fix any breakage
