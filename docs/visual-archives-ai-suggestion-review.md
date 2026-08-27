# Visual Archives AI Suggestion Review

## Updated behavior

Visual Archives now asks Gemini 3.1 Pro to produce a precise VRA-aligned description and, where visual features support it, up to three **candidate identifications**. A candidate includes its name, classification, location, visual rationale, calibrated confidence, and a human verification note.

Candidate identifications are displayed in a distinct amber review panel and are never copied into human-reviewed metadata automatically. The existing **Accept suggestion** controls remain field-specific. A suggested title has its own explicit acceptance action, while **Use as title, then save** merely fills the editable title field and still requires the reviewer to save.

## Live owner-authorized validation

The Image record titled `images-1-` in Adam’s test Visual Archives project was regenerated after the prompt update. Gemini returned the suggested title **“Nasir al-Mulk Mosque (Pink Mosque), Winter Prayer Hall”** and one high-confidence candidate: **Nasir al-Mulk Mosque**, Mosque, Shiraz, Iran. The UI rendered the candidate’s rationale and a verification instruction to confirm the spiral columns and tile patterns against an authoritative architectural or institutional reference.

The regeneration changed only the separate AI-suggestion and provenance fields. Its human-reviewed catalog metadata was verified unchanged. No AI assertion was accepted, saved as reviewed data, or approved during this validation.

## Reviewer guidance

Even a high-confidence identification is a hypothesis, not an authoritative catalog claim. A reviewer should compare the candidate with collection documentation, an institutional record, or a reliable architectural source before accepting the title, location, creator, date, or contextual fields. This preserves the usefulness of Gemini’s recognition while maintaining archival authority and revision provenance.
