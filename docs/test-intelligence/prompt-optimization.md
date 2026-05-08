# DSPy-style prompt optimization (Issue #2044)

> Wave 3 innovation roadmap — contract bump
> `TEST_INTELLIGENCE_CONTRACT_VERSION` 1.16.0 → 1.17.0
> (additive; no breaking changes to standard runs).

The prompt optimizer replaces manual prompt curation with an *offline,
deterministic* DSPy/MIPRO-style search loop. It mines bootstrapped
few-shot exemplars from accepted runs, evaluates a closed set of
additive directive variants against a deterministic synthetic eval, and
records the winning template as an *additive* lock-file entry. The base
prompt template is never rewritten — the prompt-compiler SHA pin
enforced by `scripts/check-prompt-template-version.mjs` remains the
authoritative artifact.

## Why

Prompt curation has been hand-tuned and locked in
[`docs/test-intelligence-prompt-template-version.lock.json`](../test-intelligence-prompt-template-version.lock.json).
Every tweak is a manual experiment; eval feedback has not driven the
next iteration. Many improvements observed in the G0/H0/I0 sequence
were prompt refinements that the existing benchmark suite could have
discovered automatically. DSPy / TextGrad / MIPRO make that loop
reproducible and auditable, which matters for DORA and EU AI Act
record-keeping.

## What ships

The optimizer is *offline-only*. The standard production runner does
not invoke it. Operators trigger it explicitly via:

```bash
pnpm tsx scripts/run-prompt-optimization.ts \
  --fixture path/to/fixture.json \
  --seed 0xC0FFEE \
  --search-budget 16
```

A run produces:

1. `prompt-optimization-report.json` — the canonical-JSON report
   artifact (schema 1.0.0). Byte-stable across reruns with identical
   inputs and seed.
2. An additive entry under `optimizedTemplates[]` in the lock file
   (`docs/test-intelligence-prompt-template-version.lock.json`). The
   base-template `version` and `promptCompilerSha256` fields are
   preserved verbatim.
3. A PROV-DM provenance node attached to the report
   (`provenance.activityId`, `provenance.entityId`, `wasInformedBy`).
   Downstream graph builders reuse the node verbatim — see
   [`provenance.md`](provenance.md) for the full graph shape.

## Module surface

```ts
import {
  bootstrapExemplars,
  runPromptOptimizationCycle,
  writePromptOptimizationReportArtifact,
  appendOptimizedTemplateToLockFile,
  PROMPT_OPTIMIZER_VERSION,
  PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
  PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET,
  PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS,
  PROMPT_OPTIMIZER_DIRECTIVE_IDS,
} from "workspace-dev/test-intelligence";
```

## Bootstrap pipeline

`bootstrapExemplars({ acceptedRuns, qualityGate, datasetId })` mines
few-shot exemplars from accepted runs:

- Filters runs by `score >= qualityGate` (default 90 / 100).
- Optionally filters by dataset id so cross-dataset exemplars are not
  conflated.
- Promotes each accepted test case into a content-addressed exemplar:
  `exemplarId = "EX-<sha8>"`. Cases with identical content collapse
  into a single exemplar, so the output is deterministic regardless
  of source ordering.

## Search

The cycle enumerates up to `searchBudget` candidate variants (default
16). A candidate is `(directiveSubset, exemplarSubset)`. Each
candidate has a synthetic token cost:

```
cost = 128 + 32 * |directives| + 96 * |exemplars|
```

Cumulative cost is hard-capped at
`budgetMultiplier * baselineTokenCost` (default 5x). A candidate
that would push the cumulative cost past the cap is *skipped*, never
throttled after-the-fact — the run remains deterministic.

The search uses a Mulberry32 PRNG seeded by either `--seed <n>` or a
SHA-256-derived integer from the job id. Identical inputs produce
byte-identical reports.

In addition to the random proposals, every cycle deterministically
evaluates two anchor candidates so the empirical-lift demonstration
does not depend on the RNG order:

- The **baseline** candidate (no directives, no exemplars) — the
  score of the unmodified base prompt template on the eval set.
- The **all-directives** candidate (every directive, no exemplars).

## Synthetic eval

The eval is purely functional — no LLM calls. Each candidate template
is scored against a fixed eval set by counting `directive × case`
satisfaction tuples. The closed directive set
([`PROMPT_OPTIMIZER_DIRECTIVE_IDS`](../../src/contracts/index.ts)):

| Directive id                       | What it asks of the case                             |
| ---                                 | ---                                                  |
| `prefer-figma-trace-screen-id`      | Cite at least one screenId in `figmaTraceRefs`.      |
| `prefer-figma-trace-node-id`        | Cite at least one nodeId in `figmaTraceRefs`.        |
| `cite-open-questions-verbatim`      | Reproduce open questions verbatim where unresolved.  |
| `accessibility-name-required`       | a11y cases name the labelled control (aria/name).    |
| `boundary-coverage-explicit`        | Boundary cases pin the boundary value.               |
| `negative-flow-pin-error-text`      | Negative/validation cases pin the error wording.     |

Adding a directive id is a MINOR optimizer-version bump; renaming or
retiring one is MAJOR.

## FinOps caps

Per the issue spec, the optimizer's total token budget is capped at
`budgetMultiplier * baselineTokenCost` (default 5x). The cap is a
hard ceiling; candidates that would breach it are skipped and
recorded under `tokenBudget.consumed`. The optimizer never calls an
LLM, so the actual gateway-token consumption is `0`; the cap models
the cost a future LLM-backed search would incur.

## Provenance graph integration

Each report carries a PROV-DM node:

```jsonc
{
  "provenance": {
    "activityId": "urn:ti:prompt-optimizer:activity:<jobId>",
    "entityId":   "urn:ti:prompt-optimizer:entity:<jobId>",
    "wasInformedBy": "urn:ti:prompt-template:<basePromptTemplateVersion>",
    "wasGeneratedAt": "<iso-8601>"
  }
}
```

Downstream graph builders (see [`provenance.md`](provenance.md)) attach
the node verbatim so the lineage from base template → optimized template
→ accepted test case is queryable from the merkle-sealed graph.

## Lock-file shape

The lock file's pre-existing top-level fields (`$schema`, `description`,
`version`, `promptCompilerSha256`) are untouched. Optimized templates
are appended under a new top-level array:

```jsonc
{
  "$schema": "./test-intelligence-prompt-template-version.lock.schema.json",
  "description": "Pin of TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION ...",
  "version": "1.6.2",
  "promptCompilerSha256": "0f78...",
  "optimizedTemplates": [
    {
      "optimizedTemplateId": "opt-<sha8>",
      "optimizerVersion": "1.0.0",
      "basePromptTemplateVersion": "1.6.2",
      "datasetId": "active-dataset",
      "roleStepId": "test_generation",
      "seed": 12648430,
      "generatedAt": "2026-05-08T10:00:00.000Z",
      "baselineScore": 0,
      "optimizedScore": 75,
      "improvementPoints": 75,
      "directiveIds": ["prefer-figma-trace-screen-id", "..."],
      "fewShotExemplarIds": ["EX-..."],
      "reportSha256": "<hex>"
    }
  ]
}
```

The `check-prompt-template-version.mjs` CI guard tolerates additional
top-level fields, so the optimizer's writes never fail the prompt
template guard.

## Hard gates that remain unaffected

The optimizer is offline-only and never modifies the base prompt or
the standard run path. The G1–G7 hard gates (negative-case lift, etc.)
keep their existing semantics. Their evaluators are independent
modules and the prompt-template-version lock file's base-template pin
is preserved verbatim by every optimizer write.

## Operator runbook

1. Build a fixture JSON with the active dataset's eval-set + recent
   accepted runs (>= quality gate). The shape is
   `{ evalSet: GeneratedTestCase[], acceptedRuns: PromptOptimizerAcceptedRun[] }`.
2. Dry-run first:
   `pnpm tsx scripts/run-prompt-optimization.ts --fixture <path> --dry-run`.
3. Inspect the printed lift. The runner exits non-zero if lift falls
   below the >= 3-point floor or the FinOps cap is exceeded.
4. Drop `--dry-run` to append the optimized entry to the lock file.
5. Open a PR. Reviewers see the lock-file diff plus the
   `prompt-optimization-report.json` artifact under
   `storybook-static/eval-reports/`.

## References

- Parent epic: `epic: ti-innovation-roadmap` (Wave 3 specialization).
- Sibling: B.5 cross-family judges
  ([`cross-family-judges.md`](cross-family-judges.md)) — the optimizer
  is intended to evaluate candidate prompts using the cross-family
  panel to avoid overfitting to a single judge's biases. The current
  synthetic eval is judge-free; live LLM-backed search is out of
  scope for this issue.
- Sibling: B.10 provenance graph
  ([`provenance.md`](provenance.md)) — provenance node carried on
  every optimization report.
- Tooling references: DSPy, TextGrad, MIPRO. The implementation is
  vendored / in-house to satisfy EU residency requirements.
