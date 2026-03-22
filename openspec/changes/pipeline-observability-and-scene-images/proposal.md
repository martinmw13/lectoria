# Pipeline observability and scene image generation

## Why

After processing a 26-chapter book on the Gemini free tier, three gaps surfaced:

1. **No token visibility.** The pipeline logs stage names and attempt counts but never reports how many tokens were consumed. Debugging quota issues or estimating cost requires guessing.
2. **Rate-limit crashes.** LLM 2 runs 3 chapters in parallel. On the free tier (20 RPM for gemini-2.5-flash), burst calls + retries quickly trigger 429 RESOURCE_EXHAUSTED. The provider treats all errors the same -- no backoff, no retry on rate-limit.
3. **No UI path for scene images.** The NCM stores an `image_prompt` per scene (written by LLM 2), and the service layer has `generate_scene_image()`, but nothing wires them to the reader UI. The user can only generate images from manually selected text ("Picture this"), not from the LLM-crafted prompt.

## What changes

- **Token logging:** `complete()` returns a result object with token counts; LLM 1 and LLM 2 log per-call usage; pipeline reports totals in SSE progress events.
- **Rate-limit resilience:** The Gemini adapter retries on 429 with backoff parsed from the API error; default LLM 2 concurrency is reduced from 3 to 2.
- **"Picture scene" button:** A fixed button in the reader triggers `generate_scene_image()` via a new API endpoint, with a confirmation dialog. The image is saved to the same path the automatic pipeline would use, and is displayed on revisit.

## Non-goals

- Batch "generate all images" endpoint or button (out of scope for now).
- Token-based cost estimation UI.
- Changing the LLM provider protocol beyond the return type of `complete()`.
