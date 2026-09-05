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
- The authenticated live sandbox preview cannot complete Google OAuth because its temporary callback URI is not registered. Responsive search/chat checks therefore use the production client bundle with local-only intercepted authentication and synthetic Visual Archives API data. Real private-record approval and Gemini follow-up smoke tests remain appropriate after publishing to an authorized TURATH domain.

## Verification

- Independent focused validation: 56 Visual Archives tests across 9 suites passed.
- Independent full validation: 217 tests across 25 suites passed, including document review, billing, authorization, and tenant isolation.
- TypeScript, production build, `git diff --check`, and the production dependency audit passed; no known production dependency vulnerabilities were reported.
- `scripts/visual-review-search-chat-ui-qa.mjs` passed desktop (1440px) and mobile (390px) search/chat checks with no horizontal overflow or browser page errors, using synthetic local-only data.
