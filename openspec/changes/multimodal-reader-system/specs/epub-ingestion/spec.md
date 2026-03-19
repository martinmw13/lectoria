## ADDED Requirements

### Requirement: EPUB text extraction
The system SHALL accept an EPUB file and extract clean text content preserving chapter structure and paragraph boundaries.

#### Scenario: Valid EPUB upload
- **WHEN** a user uploads a valid EPUB file
- **THEN** the system extracts text from all content chapters, strips HTML tags, and produces a structured list of chapters each containing numbered paragraphs

#### Scenario: EPUB with images or embedded media
- **WHEN** an EPUB contains embedded images or media
- **THEN** the system ignores non-text content and extracts only the textual portions

#### Scenario: Invalid or corrupted file
- **WHEN** a user uploads a non-EPUB file or a corrupted EPUB
- **THEN** the system returns a clear error message without crashing

### Requirement: Chapter-paragraph structure output
The system SHALL produce a JSON structure where each chapter contains an ordered list of paragraphs, each with a unique integer index within the chapter.

#### Scenario: Multi-chapter book
- **WHEN** an EPUB with N chapters is processed
- **THEN** the output contains N chapter entries, each with paragraphs numbered starting from 1

#### Scenario: Chapter with no meaningful text
- **WHEN** a chapter contains only metadata (e.g., title page, copyright)
- **THEN** the chapter is either skipped or flagged as non-narrative
