# Mutation-killing eval (Issue #2041)

Coverage metrics describe what the generated test suite *exercises*; the
mutation-killing eval describes what it *detects*. A suite can hit 100 %
field coverage and still miss every regression — coverage alone is not a
defensible answer to a DORA-grade audit that asks "how do you know your
test generation is effective?".

This module injects a curated catalog of synthetic SUT bugs ("mutations")
into a deterministic synthetic SUT stub derived from the customer-eval
rubric, runs every accepted test case against every mutated SUT, and
surfaces the resulting `mutationKillRate` KPI alongside
`policy-report.json`. A test case "kills" a mutation when its expected
results are specific enough to distinguish the mutated SUT from the
baseline. The KPI is the share of *applicable* mutations killed by at
least one accepted case.

The default kill-rate threshold is `0.85` — the primary success
criterion the multi-agent harness has carried since Issue #1753. The
production runner does not enforce the threshold as a hard gate today;
it persists the result so downstream CI (or a future `G-MUTKILL` gate)
can reproduce the pass/fail decision without re-running the evaluator.

## Module surface

```ts
import {
  ALLOWED_MUTATION_CLASSES,
  buildDefaultMutationCatalog,
  buildMutationKillRateSummary,
  createMutationCatalog,
  evaluateMutationKillingSuite,
  MUTATION_KILL_RATE_DEFAULT_THRESHOLD,
  MUTATION_REPORT_ARTIFACT_FILENAME,
  registerDefaultMutations,
  writeMutationReportArtifact,
  type Mutation,
  type MutationCatalog,
  type MutationClass,
  type MutationContext,
  type MutationReport,
} from "workspace-dev/test-intelligence";
```

The DSL is intentionally narrow:

```ts
interface Mutation {
  readonly id: string;          // matches /^MUT-[A-Z0-9-]{1,60}$/
  readonly mutationClass: MutationClass;
  readonly description: string;
  readonly source: string;      // e.g. "Issue #2041 (registered)"
  readonly severity: "error" | "warning";
  readonly applies: (testCase, ctx) => boolean;  // case is in scope
  readonly kills:   (testCase, ctx) => boolean;  // case detects the bug
}
```

`applies` selects the in-scope cases (the synthetic SUT path the
mutation perturbs). `kills` answers "is this case's expected result
specific enough to detect the mutated behavior?". Both predicates are
evaluated against the `BusinessTestIntentIr`-derived context; neither
calls the LLM gateway. A predicate that throws is wrapped into a
deterministic error so a malformed mutation cannot crash the runner.

## Catalog classes

Every class declared in `ALLOWED_MUTATION_CLASSES` ships at least one
catalog entry, and every domain invariant registered by Issue #2040 has
at least one mutation that violates it (the property-based safety
predicates and the mutation-killing detection predicates form a dual
under the same catalog of bug archetypes).

| Class | What it injects | What kills it |
| --- | --- | --- |
| `field-required-flipped` | Required input flipped to optional | Cases asserting submit blocked when the required field is empty |
| `vat-applied-to-netto` | VAT added on top of a Netto amount | Cases pinning a VAT-excluded total or a Netto-only result |
| `currency-rounding-off-by-one` | Totals drift by one cent | Cases pinning the expected total to two decimals |
| `boundary-off-by-one` | `>=` flipped to `>` at a boundary | Boundary-class cases asserting the exact boundary value |
| `state-transition-skipped` | Workflow step (e.g. receipt) skipped | Workflow / navigation cases asserting the post-transition screen |
| `regex-relaxed` | Validation pattern accepts bad input | Validation cases asserting that off-pattern input is rejected |
| `null-equals-empty` | `null` treated as empty (or vice versa) | Cases that exercise the null/empty distinction |
| `optional-cost-treated-required` | Optional cost field made required | Positive-flow cases that do not select the optional cost |
| `currency-locale-confusion` | Euro treated as USD | Cases pinning the currency code in the expected total |
| `error-message-suppressed` | Required error text removed | Negative-flow cases asserting the error message |
| `accessibility-name-removed` | Labelled element loses accessible name | Accessibility cases asserting the screen-reader / focus contract |
| `iban-checksum-skipped` | IBAN checksum bypassed | Negative-flow cases that present an invalid IBAN |
| `pii-redaction-disabled` | PII appears unredacted | Cases asserting redaction / masking |
| `four-eyes-principle-skipped` | Dual-control bypass | Workflow cases asserting the second-approver requirement |
| `audit-log-omitted` | Audit row not written | Cases asserting the audit row / trail |

## Evaluation contract

`evaluateMutationKillingSuite` returns a fully deterministic
`MutationReport`:

```ts
interface MutationReport {
  readonly schemaVersion: "1.0.0";
  readonly contractVersion: "1.16.0";
  readonly generatedAt: string;
  readonly jobId: string;
  readonly policyProfileId: string;
  readonly totalTestCases: number;
  readonly totalMutations: number;
  readonly applicableMutations: number;
  readonly killedMutations: number;
  readonly killRate: number;          // killed / applicable, rounded to 6 digits
  readonly threshold: number;         // configured KPI threshold
  readonly meetsThreshold: boolean;   // killRate >= threshold
  readonly byClass: readonly MutationClassKillRate[];   // closed enum order
  readonly mutations: readonly MutationEvaluation[];    // sorted by mutationId
  readonly unkilledMutations: readonly string[];        // sorted by mutationId
}
```

Determinism guarantees:

- Per-mutation rows are sorted alphabetically by `mutationId`.
- Per-class rows follow the closed `ALLOWED_MUTATION_CLASSES` order so
  byte-shape stays stable when new classes are appended.
- `applicableTestCaseIds` and `killingTestCaseIds` on every per-mutation
  row are deduplicated and sorted alphabetically.
- All ratios are rounded to six digits, matching the canonical-JSON
  contract used by `coverage-report.json` and `validation-report.json`.

## Wiring through the production runner

Default behavior is unchanged: the runner does not invoke the
evaluator unless the operator opts in via the input or the CLI flag.

```ts
await runFigmaToQcTestCases({
  // ...
  mutationEval: { enabled: true, thresholdRatio: 0.85 },
});
```

Or via the CLI:

```sh
workspace-dev test-intelligence run \
  --figma-url https://www.figma.com/file/... \
  --output ./out \
  --enable-mutation-eval
```

The env override `FIGMAPIPE_WORKSPACE_TI_ENABLE_MUTATION_EVAL=1`
flips the default for benchmark CI lanes. The inverse
`--no-mutation-eval` flag force-disables the evaluator regardless of the
env override.

When enabled the runner persists `mutation-report.json` (canonical-JSON,
atomic temp+rename) and embeds the summary into
`policy-report.json#mutationKillRate`:

```jsonc
{
  "mutationKillRate": {
    "artifactFilename": "mutation-report.json",
    "killRate": 0.928571,
    "totalMutations": 15,
    "applicableMutations": 14,
    "killedMutations": 13,
    "threshold": 0.85,
    "meetsThreshold": true
  }
}
```

The artifact is added to the Wave-1 evidence manifest under category
`manifest`, so a tampered `mutation-report.json` fails the
post-write evidence verification just like every other manifest
artifact.

## FinOps cap

The evaluator is fully deterministic and never calls an LLM. The
documented FinOps cap (`MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP = 0.20`) is
a hard ceiling, not a quota: under default operation the actual ratio
is `0`. Future variants that consult an LLM (e.g. higher-order mutation
generation, deferred to Issue #2041's out-of-scope list) must respect
the cap.

## Out-of-scope

- Real-SUT mutation testing (requires CI integration; future issue).
- Higher-order mutations (combinations) — first-order only initially.
- Auto-generation of mutations from spec drift — manually curated for
  now.

## References

- Parent epic: Test Intelligence 2026-Q3 Innovation Roadmap.
- Related: #2025, #1753 (defines `mutationKillRate >= 0.85`),
  #1947 (technique-coverage hard gate),
  #2040 (property-based domain-invariant registry).
- Local benchmark protocol:
  [`local-benchmark-protocol.md`](./local-benchmark-protocol.md).
- Standards: DORA Article 28, BaFin VAIT.
