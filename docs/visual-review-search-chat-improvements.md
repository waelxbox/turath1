# Image Archive review, retrieval, and chat improvements

## Implemented

- Review completion refreshes the queue, excludes the completed record, and advances in previous queue order, wrapping at the end. A refresh failure leaves the saved record open rather than guessing the next item.
- Discover ranks partial keyword matches, boosts title matches, recognizes a small explicit synonym set, and supports reviewed date intervals through query text or year inputs. Unknown dates are excluded when a date interval is requested. Facets are built from text/date matches.
- Chat uses the same lexical ranking, carries the previous answer's record IDs for contextual follow-ups, and expands approved project-scoped relationships up to two hops. Supplied IDs never grant access.
- Up to twelve records supply evidence, with complete metadata rather than a 700-character substring. Context exceeding 80,000 characters fails with a request to narrow the question. Images are explicitly labeled with their current citation number.
- Prompts distinguish sampled evidence from exhaustive collection analysis. Validation requires valid citations in every paragraph; this is a citation-format guard, not a proof of factual entailment.

## Remaining work / deployment notes

- No schema changes, new provider configuration, or deployment performed.
- This is ranked lexical retrieval, **not embedding-backed semantic search**. The existing perceptual-hash image comparison remains unchanged. True multimodal embeddings, indexing/backfill, stale-revision handling, and relevance evaluation remain to be implemented before claiming semantic visual memory.
- Dates use four-digit years in reviewed `dates` values; complex historic/uncertain date expressions are not fully modeled.
- Search and chat still read the project's approved catalog into memory. Database-ranked retrieval is needed for larger archives.
- Device-local conversation storage remains unchanged. Account-scoped durable conversations are separate work.
- Verify live approval/next navigation, year filters, search results, and conversational follow-ups in a private preview before deploying. No live UI or provider call was exercised in this iteration.

## Verification

- TypeScript: `tsc --noEmit` passed.
- 201 tests across 23 suites passed, including document review, billing, and tenant isolation.
- Credential/live-database suites `google-oauth.test.ts` and `members.test.ts` excluded, as in the preceding dashboard verification.
- `git diff --check` passed.
