# Observability & Production Readiness

## Structured Logging

Use `logger` with context, never `print()`.

```python
import logging
logger = logging.getLogger(__name__)

# Include identifiers for traceability
logger.info("Processing started", extra={"job_id": job_id, "batch_size": len(items)})
logger.error("Processing failed", extra={"job_id": job_id, "error": str(e)})
```

<!-- ADAPT: Add domain-specific observability. Examples:
  Data pipelines: Log at pipeline boundaries, include row counts, track schema changes
  AI/ML: Log experiment metadata, track model performance, log prediction latency
  Infrastructure: Log plan/apply operations, track drift detection, monitor cost changes
-->

## Error Handling

- Errors MUST be logged with context before re-raising or returning error responses.
  This covers **unexpected / server-side failures** (5xx) and swallowed exceptions —
  the failures you would not otherwise see.
- **Expected client errors (4xx) are control flow, not failures.** A `404` for a
  not-found book/scene, a `400` for a bad style, or a `409` for an already-processed
  book is communicated to the caller via the status code — that *is* the observable
  signal. Do NOT log these at `info`/`error` (it adds noise and a log-flood vector).
  If a specific case needs traceability, use `logger.debug`.
- No bare `except: pass` — always log or re-raise
- External API calls MUST have timeout and failure handling
- Background tasks MUST log failures visibly (not silently swallow)

## When Modifying Existing Code

If you are modifying code that lacks proper logging, add it as part of your change. Don't leave observability gaps in code you touch.
