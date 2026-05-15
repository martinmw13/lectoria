## MODIFIED Requirements

### Requirement: On-demand image generation (raw text)
The system SHALL allow the user to select a text passage and send it directly to the image generation API without LLM processing.

#### Scenario: User selects text
- **WHEN** the user selects a text fragment and triggers image generation
- **THEN** the system sends the raw selected text to the user-selected image generation API and displays the resulting image

#### Scenario: Character enrichment
- **WHEN** the selected text contains a character name or alias matching the NCM character list
- **THEN** the system appends the character's physical_description to the prompt before sending to the image API

#### Scenario: Generation latency
- **WHEN** an on-demand image is requested
- **THEN** the system shows a loading indicator and delivers the image within 15 seconds under normal API conditions

## ADDED Requirements

### Requirement: On-demand image persistence per scene
The system SHALL save each successful on-demand image to disk keyed by book, chapter index, and scene index, and SHALL expose a URL for that file in the generate response when chapter and scene indices are provided.

#### Scenario: Cache file written
- **WHEN** on-demand generation succeeds and chapter_index and scene_index are present in the request
- **THEN** the image bytes are written to `images/on_demand/ch{N}_sc{M}.png` under the book directory

#### Scenario: API returns cache URL
- **WHEN** generation succeeds with chapter and scene indices
- **THEN** the API response includes a `cache_url` path under `/api/data/books/{book_id}/images/on_demand/...` suitable for `<img src>`

#### Scenario: Regenerate overwrites
- **WHEN** the user generates again for the same chapter/scene
- **THEN** the cache file is overwritten with the new image

### Requirement: Google image provider model path
The default Google image adapter SHALL use Gemini native image generation (`generate_content` with an image-capable Gemini model), not Imagen `generate_images`, unless a future configuration explicitly selects Imagen.

#### Scenario: Free or standard Gemini keys
- **WHEN** the user selects Google as the image provider with a typical Gemini API key
- **THEN** image generation uses the documented Gemini image model and does not depend on deprecated Imagen 3 model IDs
