# Causal-validation framework — counterfactual test cases via do-calculus

> Issue [#2180](https://github.com/oscharko-dev/workspace-dev/issues/2180) —
> Wave 7 lighthouse differentiator W7-1.

## Why a causal layer?

Banks and insurers express their fact-checking expectations in causal
language:

* "If the **VAT rate** changes, the **financing need** does not change."
* "If the customer raises the **coverage amount**, the **demands-and-needs
  analysis** is still required."
* "If the customer raises the **purchase price**, the **financing need**
  must not decrease."

Every one of those sentences is a **do-calculus** statement of the form

```
P(effect | do(cause = X))   vs.   P(effect | do(cause = Y))
```

The harness already enforces these claims when the **invariant** has a
text-level evidence anchor (Issue #2040 / #2108). What we did **not** have
before this issue was a way to prove the claim *operationally* — to put two
test cases side by side that differ only in the cause field and verify the
projected effect.

This module fixes that by deriving **counterfactual test pairs** from the
registered domain invariants (and operator-supplied hypotheses), feeding
the variant values from the deterministic test-data oracle (Issue #2071),
and aggregating the satisfaction rate into a top-level
`causalCoverage` KPI on `policy-report.json`.

The result is a Pearl-grade causal proof for every active dataset:
**not just "the invariant fired", but "we generated two tests that
differ only in the cause and the effect did the right thing across the
two."**

## A 90-second do-calculus primer

The canonical reference is Pearl, *Causality* (2nd ed., Cambridge UP,
2009), Chapters 3–7. The framework only needs three ideas:

1. **Intervention vs. observation.** The expression `P(Y | X = x)` is the
   *observed* distribution of `Y` when we see `X = x` (which can be
   confounded). The expression `P(Y | do(X = x))` is the *interventional*
   distribution — what `Y` looks like when we **set** `X` to `x` from
   the outside, breaking any confounding paths into `X`. The framework
   evaluates the second.

2. **Counterfactual identifiability.** When `Y = f(X, U)` with `U` an
   unobserved noise term, the difference `Y(do(X = x₂)) − Y(do(X = x₁))`
   is identifiable by sampling two siblings whose `X` values differ
   only on the cause field. That is exactly what a counterfactual pair
   is.

3. **Causal-effect kinds.** We support five — *no-effect*,
   *monotonic-up*, *monotonic-down*, *linear*, *discrete-mapping*. A
   declared invariant pins the kind; the framework projects the right
   effect-side assertion onto the variants.

Pearl's book has the formal proofs. Everything below is the operational
projection.

## Architecture

```
domain-invariant-registry.ts        ──┐
   (Issue #2040 + #2108)               │
                                       ▼
                  causal-hypothesis-registry.ts     ◀── operator fixtures
                  (resolves cause/effect SemanticFieldIds against the
                   active TestDesignModel; merges operator-declared
                   hypotheses)
                                       │
                                       ▼
                 causal-validation-framework.ts
                  (deriveCounterfactualPairs uses the test-data oracle
                   for every value variation; evaluateCounterfactualPairs
                   builds the persisted CausalValidationReport)
                                       │
                                       ▼
              causal-validation-report.json (per-run)
              policy-report.json#causalCoverage   (compact KPI)
```

* **Determinism.** Identical `(cases, invariants, model,
  operatorHypotheses, now, seed)` tuples produce **byte-identical**
  output. The framework never calls an LLM and never reads wall-clock
  time directly — the caller anchors `now` at the same value used for
  the rest of the run.
* **FinOps.** Pair generation is fully deterministic; under default
  operation the additional token cost ratio is `0`. The cap exposed
  via `CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP` (`0.3`) is a hard
  ceiling for downstream callers that wire LLM-judging into pair
  scoring.

## SemanticFieldId

Every cause / effect side is a branded `SemanticFieldId` — the
canonical form is `<screenId>#<elementId>`. Use the
`semanticFieldId(screenId, elementId)` constructor; never assemble the
string directly.

```ts
import {
  semanticFieldId,
  parseSemanticFieldId,
} from "workspace-dev/test-intelligence/causal-hypothesis-registry";

const vatField = semanticFieldId("s-loan", "e-vat");
// → "s-loan#e-vat"
parseSemanticFieldId(vatField);
// → { screenId: "s-loan", elementId: "e-vat" }
```

## Hypothesis catalog

The framework derives hypotheses from the registered domain invariants
through an explicit catalog (`INVARIANT_HYPOTHESIS_CATALOG`). Today the
catalog covers four invariants — the table below mirrors it line for
line.

| Invariant id              | Cause label substring(s)                     | Effect label substring(s)                                          | Relationship  |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ------------- |
| `INV-VAT-01`              | `vat`, `mwst`, `mehrwertsteuer`              | `financing need`, `finanzierungsbedarf`                            | `no-effect`   |
| `INV-FINANCING-NEED-01`   | `kaufpreis`, `purchase price`, `price`       | `financing need`, `finanzierungsbedarf`                            | `monotonic-up`|
| `INV-SOLVENCY2-COOLOFF-01`| `premium`, `prämie`, `beitrag`               | `cooling-off`, `widerruf`, `withdrawal period`                     | `no-effect`   |
| `INV-IDD-DEMANDS-01`      | `coverage`, `versicherungssumme`             | `demands and needs`, `bedarfsanalyse`                              | `no-effect`   |

The catalog is intentionally explicit (no predicate-body parsing) so the
hypothesis projection stays auditable. Adding a new invariant-derived
hypothesis is an additive append to `INVARIANT_HYPOTHESIS_CATALOG`.

## Operator-declared hypotheses

Operators may register additional hypotheses via a fixture file. The
loader is permissive (accepts both a top-level array and a
`{ hypotheses: [...] }` envelope) and validates every entry against
the canonical shape:

```jsonc
{
  "hypotheses": [
    {
      "hypothesisId": "OP-LOAN-001",
      "cause":        "s-loan#e-rate",
      "effect":       "s-loan#e-monthly-payment",
      "relationship": "monotonic-up",
      "source": {
        "kind":       "operator-declared",
        "declaredAt": "2026-05-10T08:00:00.000Z"
      },
      "rationale": "Higher interest rates monotonically increase the monthly payment."
    }
  ]
}
```

Identifiers must match `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`. The
`declaredAt` field is required and must be an ISO-8601 UTC timestamp;
malformed entries fail loudly with `E_INVALID_HYPOTHESIS` so stale
fixtures break at load time, not at run time.

## Pair semantics

Each pair anchors to one hypothesis and varies **only** the cause
field. The expected effect-assertion is projected from the
relationship kind:

| Relationship       | Assertion encoded into both variants                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `no-effect`        | `effect` value is **identical** across A and B.                                                        |
| `monotonic-up`     | `effect` value **does not decrease** when `cause` increases (and vice versa).                          |
| `monotonic-down`   | `effect` value **does not increase** when `cause` increases.                                           |
| `linear`           | `effect` moves in the **same direction** as `cause`. Exact slope is out of scope at the harness layer. |
| `discrete-mapping` | `effect` is a **deterministic function** of `cause`: equal cause-values imply equal effect-values.     |

## Worked example #1 (banking) — `INV-VAT-01`

Source: VAT exclusion on the financing-need calculation, anchored on
the German `MaRisk` AC04 fact-check.

* **Cause field:** VAT-rate select on the loan calculator screen.
* **Effect field:** financing-need result on the same screen.
* **Hypothesis:** `no-effect` — toggling the VAT rate must not move the
  financing-need result.

The framework synthesizes a pair like:

```
Variant A
  Set "VAT rate" to oracle.boundary_min  (e.g. "0%")
  Expected: Financing need is identical across variants A and B.

Variant B
  Set "VAT rate" to oracle.boundary_max  (e.g. "19%")
  Expected: Financing need is identical across variants A and B.
```

If the SUT computes a different financing need under variant B (e.g.
because someone wired the VAT line into the formula), the pair has
detected a causal violation that conventional positive/negative tests
would miss.

## Worked example #2 (insurance) — `INV-SOLVENCY2-COOLOFF-01`

Source: Solvency II cooling-off-period requirement for long-term
insurance contracts.

* **Cause field:** premium amount on the policy issuance screen.
* **Effect field:** cooling-off-period flag (or copy block) on the
  same screen.
* **Hypothesis:** `no-effect` — raising the premium must not strip the
  cooling-off period.

The framework synthesizes a pair like:

```
Variant A
  Set "Prämie" to oracle.boundary_min
  Expected: Cooling-off / withdrawal period is identical across A and B.

Variant B
  Set "Prämie" to oracle.boundary_max
  Expected: Cooling-off / withdrawal period is identical across A and B.
```

If the SUT suppresses the cooling-off block above a threshold premium,
the pair flags it. The legal authority is `VVG § 8` and `Solvency II
Directive 2009/138/EC`, both already cited on `INV-SOLVENCY2-COOLOFF-01`.

## Persisted artifacts

When the runner is invoked with `causalValidation.enabled === true`,
two new artifacts appear next to the existing per-run files:

1. `causal-validation-report.json` — full per-hypothesis evaluation,
   including `pairsGenerated`, `pairsViolated`, `satisfied`, the
   originating `source`, and the rationale carried over from the
   invariant. Sorted by `hypothesisId` for byte-stability.
2. `policy-report.json#causalCoverage` — compact KPI block:
   `hypothesesEvaluated`, `pairsGenerated`, `pairsViolated`,
   `causalCoverageRatio` (= `(pairsGenerated - pairsViolated) /
   pairsGenerated`, rounded to six digits, `0` when no pairs were
   generated).

Both are sealed into the standard evidence manifest so the
audit-dossier (Issue #2175) covers them automatically.

## CLI / programmatic entry points

Programmatic API (preferred for benchmark harnesses):

```ts
import {
  buildCausalHypothesisRegistry,
} from "workspace-dev/test-intelligence/causal-hypothesis-registry";
import {
  deriveCounterfactualPairs,
  evaluateCounterfactualPairs,
} from "workspace-dev/test-intelligence/causal-validation-framework";

const hypotheses = buildCausalHypothesisRegistry({
  invariants: registry.list(),
  model:      testDesignModel,
  operatorHypotheses, // optional, loaded via loadOperatorHypotheses()
});
const pairs  = await deriveCounterfactualPairs({
  cases, invariants, model, jobId, generatedAt,
  hypotheses, now, seed,
});
const report = evaluateCounterfactualPairs({
  jobId, generatedAt, hypotheses, pairs,
});
```

Production-runner integration (opt-in):

```ts
const result = await runFigmaToQcTestCases({
  /* ...other inputs... */
  causalValidation: {
    enabled: true,
    operatorHypotheses, // optional
  },
});
// result.artifactPaths.causalValidationReport now points at the JSON file.
// result.policy.causalCoverage carries the compact KPI block.
```

## Out-of-scope

The same items as the issue spec — left here so contributors do not
file issues that have already been deferred:

* Live SUT execution against the counterfactual pairs. The framework
  is a **generation** layer, not an E2E driver.
* Bayesian causal-inference learning of new hypotheses from production
  traffic. A Wave-8 candidate.
* Cross-screen causal hypotheses. Single-screen first; multi-screen
  is a follow-on issue.

## References

* Issue [#2180](https://github.com/oscharko-dev/workspace-dev/issues/2180) — this work.
* Parent epic [#2167](https://github.com/oscharko-dev/workspace-dev/issues/2167) — Test-Intelligence Tier-1 Production Roadmap (Wave 7).
* Predecessor [#2040](https://github.com/oscharko-dev/workspace-dev/issues/2040) — domain-invariant registry (cause/effect anchors).
* Predecessor [#2108](https://github.com/oscharko-dev/workspace-dev/issues/2108) — EU banking + insurance compliance invariants.
* Predecessor [#2071](https://github.com/oscharko-dev/workspace-dev/issues/2071) — deterministic test-data oracle (BVA values).
* Standard: ISO/IEC/IEEE 29119-4 (causal coverage).
* Foundational reference: Pearl, *Causality* (2nd ed., Cambridge UP, 2009).
