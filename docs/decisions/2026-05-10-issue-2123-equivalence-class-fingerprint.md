# 2026-05-10 — Issue #2123: Semantic equivalence-class verification

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2123](https://github.com/oscharkowski/workspace-dev/issues/2123) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 3 — P3 reach SOTA bar

## Context

The pre-#2123 duplicate detector ([`test-case-duplicate.ts`](../../src/test-intelligence/test-case-duplicate.ts)) collapses every generated test case to a token-and-shingle Jaccard fingerprint and flags pairs above a similarity threshold. The signal is purely textual; it has two failure modes the SOTA bar cannot accept:

1. **False negatives.** Two cases with the same equivalence class but different cosmetic wording — e.g. `"Enter IBAN DE89..."` and `"Enter IBAN AT..."` — differ in roughly five characters. They drop below typical Jaccard thresholds and survive into review even though their oracle, covered fields, and risk class are identical.
2. **False positives.** Two cases with character-equivalent wording but distinct covered states (different action subset, different navigation path, different oracle category) get merged because Jaccard cannot read the equivalence-class structure that lives in `qualitySignals`.

The acceptance criteria for #2123 is therefore explicit: equivalence is a derived property of `(coveredFieldIds, coveredActionIds, riskClass, technique, oraclePolarity)`, not a property of the case text. Within an equivalence class, every case must add real coverage, and the validator must surface intra-class redundancy as a warning. Levenshtein-2 (character-distance) is retained as a separate auditor signal — it spots cosmetic near-duplicates the equivalence-class check intentionally tolerates when those cases DO add real coverage — but it stops being the primary equivalence test.

## Decision

We add a deterministic semantic fingerprint and an intra-class redundancy detector. The detector emits warnings through the existing validation pipeline; the legacy text-distance check is preserved alongside it under a clearly distinct issue code.

### 1. Equivalence-class fingerprint

`EquivalenceClassFingerprint` (declared in [`src/contracts/index.ts`](../../src/contracts/index.ts)) is a closed record `{ coveredFieldIds, coveredActionIds, riskClass, technique, oraclePolarity }`. Both id arrays are sorted and de-duplicated before comparison so two emissions that differ only in id ordering hash to the same key.

`oraclePolarity` is the coarsest semantic axis relevant for redundancy:

| Polarity        | Meaning                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `positive`      | Oracle expects acceptance / advancement.                                                                                     |
| `negative`      | Oracle expects rejection (covers `negative` and `validation` `polarity` and `type` discriminants — both expect a rejection). |
| `boundary`      | Oracle exercises a partition boundary.                                                                                       |
| `navigation`    | Oracle asserts navigation graph behaviour.                                                                                   |
| `accessibility` | Oracle asserts an accessibility property.                                                                                    |

Resolution order: persisted `polarity` (Issue #2030) when present, falling back to `type` for older 1.0.0 / 1.1.0 emissions. The fall-back keeps the fingerprint byte-stable across schema versions.

### 2. Intra-class redundancy detector

`detectIntraClassRedundancy` (declared in [`src/test-intelligence/equivalence-class-fingerprint.ts`](../../src/test-intelligence/equivalence-class-fingerprint.ts)) groups cases by `equivalenceClassKey` (canonical-JSON of the fingerprint). Within each class, the first case (by stable id ordering) is the representative; every subsequent case must satisfy at least one distinctness reason against AT LEAST ONE prior kept case:

- `different_oracle_category` — distinct `category` (with type-derived fallback for older emissions).
- `different_action_subset` — distinct `coveredActionIds` set.
- `different_state_path` — distinct figma trace path set, lifecycle-transition set, or ordered step-action sequence.

A case that fails every distinctness check against every prior kept case is recorded as redundant.

### 3. Optional `phi-4-mini-instruct` first-pass classifier

`IntraClassBoundaryClassifier` is a caller-supplied hook that may route through `phi-4-mini-instruct` (per parent epic [#2099](https://github.com/oscharkowski/workspace-dev/issues/2099)). The hook is consulted ONLY for ambiguous boundary cases (a `boundary_value_analysis` technique on `boundary` polarity, or a case with non-empty `assumptions` / `openQuestions`) AFTER the deterministic logic has already flagged redundancy. Veto rules:

- Verdict `"keep"` → the deterministic redundancy flag is downgraded; the case stays.
- Verdict `"redundant"` → the redundancy finding is recorded with `source: "deterministic+classifier"`.

The classifier can never UPGRADE a deterministic `keep` to a redundancy warning. Deterministic logic vetoes false negatives; the model is purely a tie-breaker on the ambiguous boundary slice. Air-gapped pipelines leave the hook undefined and the validator stays fully offline.

### 4. Auxiliary Levenshtein-2 (text-distance) check

`detectExactNearDuplicateText` keeps the Levenshtein-2 contract from the legacy detector — but as an INDEPENDENT auditor signal, not the primary equivalence check. Its canonical input is `(title, ordered step actions)` lower-cased and joined with a record separator; pairs whose character-edit distance is ≤ 2 are flagged as `exact_near_duplicate_text` warnings. Implementation uses a row-banded Levenshtein with an early-out cap so the check stays linear on long step bodies.

### 5. Validation-pipeline integration

`validateGeneratedTestCasesWithInvariants` now:

- Calls `detectIntraClassRedundancy` and emits one `intra_equivalence_class_redundancy` warning per redundant case, anchored to `$.testCases[i].qualitySignals`. Cases that fail the distinctness test alone produce `source: "deterministic"`; cases that also tripped the optional classifier produce `source: "deterministic+classifier"`.
- Calls `detectExactNearDuplicateText` (default budget 2) and emits one `exact_near_duplicate_text` warning per cosmetic near-duplicate pair, anchored to `$.testCases[j].title`.
- Returns the full `IntraClassRedundancyOutcome` (totals, class count, ratio) on the `InvariantValidationOutcome` bundle so downstream consumers can stamp the ratio onto coverage / observability artifacts without recomputing the fingerprint.

### 6. Eingabemasken benchmark gate

A new `equivalence-class-fingerprint.benchmark.test.ts` synthesises generated cases for each of the fifteen Eingabemasken archetype fixtures, runs the redundancy detector, and asserts the per-fixture `redundancyRatio` stays under `0.05`. The synthesizer is the deterministic `synthesizeGeneratedTestCases` already used by the baseline-eval suite, so the benchmark is fully air-gapped and CI-safe.

## Consequences

- The validator now has TWO independent redundancy signals at warning severity: equivalence-class redundancy (semantic) and Levenshtein-2 (textual). Operators see both codes side by side in `validation-report.json` and can tune downstream gates separately.
- No `TEST_INTELLIGENCE_CONTRACT_VERSION` bump: only validation issue codes are added, and they extend the open-ended `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES` list. The persisted `TestCaseValidationReport` shape is unchanged.
- The legacy `detectDuplicateTestCases` Jaccard path remains in place for historical artifacts and dedupe-pipeline orchestration; nothing is removed.
- The `IntraClassBoundaryClassifier` interface gives operators a clean injection point to wire a `phi-4-mini-instruct` route once the production runner exposes one, without re-opening this module.

## Alternatives considered

- **Bump the validation-report schema.** Rejected — adding a code to a runtime allowlist is the established additive-bump pattern in this codebase (see #2104, #2111, #2122) and avoids forcing every persisted artifact in the wild to re-emit.
- **Replace Levenshtein with the equivalence-class fingerprint outright.** Rejected — the AC explicitly retains Levenshtein-2 as a separate auditor signal because the two checks answer different questions: "is the equivalence class duplicated" versus "is the wording duplicated".
- **Run the `phi-4-mini-instruct` classifier as the primary path.** Rejected — the AC mandates deterministic logic as the source of truth, with the model as a low-cost first-pass on boundary ambiguity only. Inverting that order would make the validator non-deterministic and break replay-cache stability.
