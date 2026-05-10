---
"workspace-dev": minor
---

Add semantic equivalence-class verification for generated test cases (Issue #2123).

- New module `src/test-intelligence/equivalence-class-fingerprint.ts` exporting `buildEquivalenceClassFingerprint`, `equivalenceClassKey`, `deriveOraclePolarity`, `detectIntraClassRedundancy`, `detectExactNearDuplicateText`, and `levenshteinCapped`. The fingerprint is derived from `(coveredFieldIds, coveredActionIds, riskClass, technique, oraclePolarity)` — not text — so two cases that differ in a few characters but cover the same equivalence class are now flagged as redundant within the same technique bucket.
- Within an equivalence class, a case is required to add real coverage relative to the prior kept set: a different oracle category, a different action subset, or a different state path (trace path / lifecycle transition / step-action sequence). The validator emits `intra_equivalence_class_redundancy` warnings for cases that fail that test.
- Levenshtein-2 (character-edit distance, capped) is retained as a SEPARATE auxiliary auditor signal: `detectExactNearDuplicateText` flags pairs whose canonicalised `(title, ordered step actions)` differ by ≤ 2 characters, surfaced as `exact_near_duplicate_text` warnings. This is the auxiliary check the AC requires alongside the new equivalence-class verification, not the primary equivalence signal.
- New optional `IntraClassBoundaryClassifier` hook reserved for the `phi-4-mini-instruct` first-pass route declared in #2099. The hook is consulted only for ambiguous boundary cases AFTER deterministic logic has flagged redundancy and can VETO the verdict by returning `"keep"` — the model can never upgrade a deterministic `keep` to a redundancy warning.
- New validation issue codes `intra_equivalence_class_redundancy` and `exact_near_duplicate_text` (both `warning` severity) added to `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`.
- `validateGeneratedTestCasesWithInvariants` now emits the new warnings and surfaces the `IntraClassRedundancyOutcome` (totals, class count, redundancy ratio) on the returned outcome bundle.
- Eingabemasken benchmark (`equivalence-class-fingerprint.benchmark.test.ts`) asserts the redundancy ratio stays below 5% across all fifteen archetype fixtures.
- ADR `docs/decisions/2026-05-10-issue-2123-equivalence-class-fingerprint.md`. Additive re-exports from `src/test-intelligence/index.ts`. No `TEST_INTELLIGENCE_CONTRACT_VERSION` bump (additive issue codes only).
