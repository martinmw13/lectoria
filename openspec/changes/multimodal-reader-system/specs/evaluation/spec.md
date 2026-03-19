## ADDED Requirements

### Requirement: NCM quality evaluation
The system SHALL be evaluated quantitatively against a manually annotated gold standard.

#### Scenario: Scene segmentation quality
- **WHEN** the NCM is generated for a test book with manual scene annotations
- **THEN** scene boundaries are compared using boundary-level precision and recall metrics

#### Scenario: Emotion classification quality
- **WHEN** the NCM's emotion labels are compared against human annotations
- **THEN** weighted F1 is computed and reported (target: > 0.60)

### Requirement: User study
The system SHALL be evaluated with a comparative user study (10-15 participants).

#### Scenario: A/B comparison
- **WHEN** participants read with condition A (NCM-guided enrichment) and condition B (random enrichment)
- **THEN** the study collects preference (which was better), coherence rating (Likert 1-5), and usability score (SUS)

#### Scenario: Statistical analysis
- **WHEN** user study data is collected
- **THEN** Wilcoxon signed-rank test is used to determine if condition A is significantly preferred over condition B

### Requirement: Image quality evaluation
The system SHALL evaluate generated image quality using automated metrics.

#### Scenario: CLIPScore computation
- **WHEN** images are generated from prompts
- **THEN** CLIPScore between the text prompt and the generated image is computed and reported
