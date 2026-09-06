# Transcription reliability incident — September 6, 2026

## User-visible symptom

Five document images were uploaded together. Only one appeared to transcribe initially; the other four required manual retranscription.

## Read-only production evidence

All five document rows were created within 57 milliseconds. The highest-ID document received five separate transcription rows between 12:12:02 and 12:13:16 UTC, while the other four had no initial transcription. Their first transcription rows appeared later, between 12:14:34 and 12:21:05 UTC, after manual retries. Two successfully transcribed documents still displayed an earlier timeout message. No single-document job rows existed for the incident.

No document contents were read, changed, retranscribed, or deleted during the investigation.

## Root causes

The upload procedure inserted the correct document but discarded the returned row. It then queried the project document list and returned `docs[0]`, meaning “the newest document in the project.” Under parallel uploads, every response could therefore return the same final document ID. The client correctly used the ID it received, so all five initial transcription requests targeted that one document.

The single-document transcription procedure also lacked an atomic processing claim, allowing duplicate requests for the same document to run concurrently. Successful status transitions did not clear a previous `errorMessage`, and the Upload interface treated server-declared failures as completed. Finally, the direct Gemini client imposed a 120-second timeout, which is too short for some dense Gemini 3.1 Pro page transcriptions.

## Fixes

The upload procedure now returns the exact `createDocument()` result from its own request. Single-document transcription atomically changes a non-processing document to `processing`; a concurrent duplicate receives a conflict response before storage or model work begins. Successful and in-progress status changes clear stale error text. Every single-document attempt records non-blocking job telemetry, including completion or failure.

The direct Gemini timeout is now five minutes, and one bounded automatic retry is performed for transient timeout, abort, network, capacity, or 502–504 failures. Deterministic schema/validation failures are not retried. The Upload interface now distinguishes completed, still-processing, and failed files rather than labeling every submitted request successful.

## Validation

An isolated regression reproduced the exact five-upload defect before the fix: five inserts produced five responses containing one shared document ID. After the fix, all five responses contain distinct IDs and the correct filenames. Additional regressions cover duplicate-request suppression, successful job telemetry, stale-error clearing, honest client timeout states, automatic transient retry, and retry classification.

The final validation passed 224 tests across 26 files, TypeScript checking, the production build, and the production dependency audit with no known vulnerabilities. The development server restarted cleanly. No database migration was required.
