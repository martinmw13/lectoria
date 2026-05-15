## ADDED Requirements

### Requirement: Music crossfade duration
The reader SHALL crossfade between music tracks over a short fixed duration (approximately 2 seconds) configurable in the music player component.

#### Scenario: Crossfade completes within target window
- **WHEN** a crossfade is triggered between scenes
- **THEN** the audio transition completes in the configured millisecond window (default 2000ms)

### Requirement: Developer panel dismissal
The developer debug panel SHALL provide an explicit close control that clears dev mode, in addition to any existing keyboard shortcut.

#### Scenario: Close from panel
- **WHEN** the user clicks the close control on the developer panel
- **THEN** the panel is hidden and dev mode is turned off

### Requirement: Cached on-demand image display
When the user navigates to a scene that has a previously saved on-demand image file, the reader SHALL display that image without calling the generate API.

#### Scenario: Revisit scene with cache
- **WHEN** the user opens a page belonging to a scene that has `images/on_demand/ch{N}_sc{M}.png` present
- **THEN** the UI shows that image (e.g. via static URL) without regenerating

#### Scenario: Fresh generation uses cache URL
- **WHEN** the user generates a new on-demand image and the API returns `cache_url`
- **THEN** the client displays the image using that URL (with cache-busting as needed) rather than only an ephemeral data URL
