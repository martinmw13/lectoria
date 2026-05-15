## ADDED Requirements

### Requirement: Scene image generation endpoint
The API SHALL expose an endpoint to generate an image for a specific scene using the scene's `image_prompt` from the NCM.

#### Scenario: Scene image does not exist
- **WHEN** `POST /api/books/{book_id}/images/scene` is called with `{ chapter_index, scene_index }` and no cached scene image exists
- **THEN** the system calls `generate_scene_image()` with the scene's `image_prompt`, saves the result to `images/scenes/ch{N}_sc{M}.png`, and returns `{ cache_url, generated: true }`

#### Scenario: Scene image already exists
- **WHEN** the endpoint is called and the scene image file already exists on disk
- **THEN** the system returns the existing `cache_url` immediately without calling the image provider, with `{ cache_url, generated: false }`

#### Scenario: Scene has no image_prompt
- **WHEN** the scene's `image_prompt` is empty
- **THEN** the system returns HTTP 400 with a descriptive message

### Requirement: "Picture scene" button in reader
The reader UI SHALL display a button that triggers scene image generation from the LLM-produced `image_prompt`, with a confirmation step.

#### Scenario: Button visibility
- **WHEN** the current scene has an `image_prompt` and no scene image is currently loaded
- **THEN** a "Picture scene" button is visible in the scene header

#### Scenario: Button hidden when image exists
- **WHEN** the scene image has already been generated or loaded from cache
- **THEN** the button is hidden

#### Scenario: Confirmation before generation
- **WHEN** the user clicks "Picture scene"
- **THEN** a confirmation dialog appears before calling the API

#### Scenario: Image displayed after generation
- **WHEN** the generation succeeds
- **THEN** the scene image is displayed and persists on subsequent visits to the same scene
