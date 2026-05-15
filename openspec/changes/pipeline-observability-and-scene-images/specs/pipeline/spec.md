## ADDED Requirements

### Requirement: Token usage logging per LLM call
The LLM provider SHALL return prompt and completion token counts alongside the generated text for each API call.

#### Scenario: Successful completion
- **WHEN** `provider.complete()` returns successfully
- **THEN** the result includes `prompt_tokens` and `completion_tokens` from the API response metadata

#### Scenario: Provider does not support usage metadata
- **WHEN** a provider cannot report token counts (e.g., future non-Google adapter)
- **THEN** `prompt_tokens` and `completion_tokens` are None and no error is raised

### Requirement: Pipeline token usage reporting
The pipeline SHALL log accumulated token usage at the end of LLM 1 and LLM 2 phases, and emit the totals as SSE progress events visible to the user.

#### Scenario: LLM 1 completes
- **WHEN** LLM 1 finishes successfully
- **THEN** a progress event reports prompt tokens, completion tokens, and total

#### Scenario: LLM 2 completes all chapters
- **WHEN** all LLM 2 chapter analyses finish
- **THEN** a progress event reports total tokens across all chapters

### Requirement: Rate-limit retry in LLM provider
The Gemini LLM adapter SHALL detect 429 RESOURCE_EXHAUSTED errors and retry with backoff before raising to the caller.

#### Scenario: 429 with retryDelay in error
- **WHEN** the API returns 429 with a `retryDelay` field
- **THEN** the adapter waits for the specified delay and retries, up to 3 times

#### Scenario: 429 without retryDelay
- **WHEN** the API returns 429 without delay information
- **THEN** the adapter uses exponential backoff (30s, 60s, 120s) and retries up to 3 times

#### Scenario: Exhausted rate-limit retries
- **WHEN** all 3 rate-limit retries fail
- **THEN** the error is raised to the caller as a RuntimeError

### Requirement: Reduced default LLM 2 concurrency
The pipeline SHALL default to 2 concurrent LLM 2 chapter analyses (reduced from 3) to lower burst pressure on rate-limited APIs.
