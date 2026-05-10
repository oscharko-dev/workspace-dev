---
"workspace-dev": minor
---

Add causal-validation framework (counterfactual test cases via do-calculus) for Issue #2180.

- New `src/test-intelligence/causal-hypothesis-registry.ts` exposing
  the branded `SemanticFieldId` type, the
  `semanticFieldId(screenId, elementId)` constructor + reader, the
  `CausalHypothesis` / `CausalRelationship` types, and the
  `buildCausalHypothesisRegistry({ invariants, model,
  operatorHypotheses })` API that derives hypotheses from the
  registered domain invariants (Issue #2040 + Issue #2108) and merges
  operator-declared hypotheses loaded via `loadOperatorHypotheses`.
- New `src/test-intelligence/causal-validation-framework.ts` exposing
  the `CounterfactualPair` interface, the deterministic
  `deriveCounterfactualPairs({ cases, invariants, model,
  operatorHypotheses?, now, seed })` generator (every value variation
  between pair members is supplied by the deterministic test-data
  oracle from Issue #2071), and the `evaluateCounterfactualPairs`
  aggregator that builds the persisted `CausalValidationReport`.
- New `causal-validation-report.json` artifact + `causalCoverage`
  summary block on `policy-report.json`. The KPI carries
  `hypothesesEvaluated`, `pairsGenerated`, `pairsViolated`, and the
  `causalCoverageRatio` (rounded to six digits, `0` when no pairs
  were generated).
- FinOps cap exposed as `CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP`
  (`0.3`). Pair generation is fully deterministic and never calls an
  LLM; under default operation the actual token-cost ratio is `0`.
- New documentation page `docs/test-intelligence/causal-validation.md`
  describing the do-calculus primer, the hypothesis derivation rules,
  and worked banking + insurance examples (VAT-rate vs financing-need
  for banking; insurance-product change vs cooling-off-period for
  insurance).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.29.0` → `1.30.0`;
  `CONTRACT_VERSION` bumped `4.64.0` → `4.65.0`. All changes are
  additive — no existing field, type, or command was removed or
  renamed.
