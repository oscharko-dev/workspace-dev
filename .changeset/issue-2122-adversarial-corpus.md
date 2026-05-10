---
"workspace-dev": minor
---

Add curated adversarial corpus + CI gate for Issue #2122.

- New top-level catalogue at `fixtures/adversarial-corpus/catalog.json` (versioned `1.0.0`, calendar `version` `2026.05.10`, quarterly review cadence) with 56 entries spanning all 15 categories required by the AC: prompt injection (direct, indirect via Figma / Jira / custom markdown), data exfiltration, instruction-following hijack, role confusion, output-side injection (shell, JNDI, XSS), oracle bypass, ranking manipulation, context stuffing, charset tricks (zero-width, RTL override). Each entry: `{ id, category, payload, expectedOutcome, citation }`. Provenance recorded as `mistral-large-3` design-time generation + SME review.
- New module `src/test-intelligence/adversarial-corpus.ts` exporting `loadAdversarialCorpus`, `validateAdversarialCorpus`, `runAdversarialCorpusGate`, `loadAndRunAdversarialCorpusGate`, `isAdversarialCorpusReviewOverdue`, `adversarialCorpusCoversAllRequiredCategories`, plus the corpus types and `AdversarialCorpusValidationError`. Pure / deterministic; no model invoked at gate time.
- New `src/test-intelligence/adversarial-corpus.test.ts` CI gate: shape + coverage invariants, ≥ 50 entries floor, unique ids, deterministic per-entry outcome assertion, review-cadence ordering, validator rejection paths, and a synthetic-mismatch backstop.
- Additive widening of `untrusted-content-normalizer.ts:ZERO_WIDTH_RE` to also strip Unicode bidirectional override / isolate codepoints (`U+2028`, `U+2029`, `U+202A`–`U+202E`, `U+2066`–`U+2069`). Persisted `zeroWidthCharacters` count name preserved for backwards compatibility.
- New ADR `docs/decisions/2026-05-10-issue-2122-adversarial-corpus.md` with the full decision record.
- Additive re-exports from `src/test-intelligence/index.ts`. No public API in `src/index.ts` changes; no `TEST_INTELLIGENCE_CONTRACT_VERSION` bump.
