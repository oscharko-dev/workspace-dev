# Cross-family judge ensemble (Issue #2038)

The cross-family judge ensemble restructures the production-runner judge
panel so each judge role is sourced from a different model family. The
goal is to break the correlated-failure mode that surfaced when all
three judges (logic / faithfulness / accessibility) ran against
in-house clones of the same base model: a single mis-classification
got reinforced by the rest of the panel, and the `logic_judge`
schema-drift incident on the I0 baseline went undetected for two
iterations because all three judges agreed on the wrong shape.

This document describes the cross-family contract, the disagreement
detector, the human-review escalation hook, and how the artifacts
plug into the existing provenance / FinOps surfaces.

## Vocabulary

| Concept | Notes |
| --- | --- |
| **Judge role** | One of `logic_judge`, `faithfulness_judge`, `a11y_judge`, `coverage_judge`, `hallucination_judge`. Each role contributes one verdict per case. |
| **Model family** | `JudgeModelFamily` literal: `anthropic`, `azure-openai`, `google`, `in-house`, `mistral`, `openai`. |
| **Region** | `JudgeModelRegion` literal: `eu`, `global`, `us`. Used by the EU-residency policy gate. |
| **Disagreement decision** | `unanimous_accept` / `unanimous_repair` / `unanimous_reject` / `majority_decision` / `split_decision`. |
| **Escalation action** | `none` or `human_review_required`. |

## Contract additions

The `1.13.0` contract bump adds the following surface (all additive — no
removals, no renames):

- `AgentModelBinding.family?: JudgeModelFamily` and
  `AgentModelBinding.region?: JudgeModelRegion`. Existing bindings that
  omit these continue to validate.
- `JudgeConsensusPanelEntry` gains optional `family`, `region`,
  `modelId`, and `promptVersion` markers. The harness fills them when
  the judge is sourced from a known cross-family deployment;
  consumers ignore them when absent.
- `JudgeConsensusVerdict` gains optional `humanReview: HumanReviewDecision`
  and `crossFamily: JudgeCrossFamilySummary` fields.
- New runtime constants and types under `JUDGE_MODEL_*`,
  `JUDGE_DISAGREEMENT_*`, and `HUMAN_REVIEW_*`.
- New role `human_review` registered in `AGENT_HARNESS_ROLES`.

## Cross-family policy

`src/test-intelligence/cross-family-judge-policy.ts` is a deterministic,
pure-function gate that runs over the panel before / after the run:

```ts
import {
  assessCrossFamilyPanel,
  type JudgeFamilyBinding,
} from "../../src/test-intelligence/cross-family-judge-policy.js";

const bindings: JudgeFamilyBinding[] = [
  { judgeId: "logic_judge", family: "anthropic", modelId: "claude-3.5-sonnet", promptVersion: "logic-judge.v1", region: "eu", verdict: "accept" },
  { judgeId: "faithfulness_judge", family: "openai", modelId: "gpt-4o", promptVersion: "faithfulness-judge.v1", region: "eu", verdict: "repair" },
  { judgeId: "a11y_judge", family: "google", modelId: "gemini-1.5-pro", promptVersion: "a11y-judge.v1", region: "eu", verdict: "accept" },
];

const result = assessCrossFamilyPanel(bindings, {
  requireEuRegion: true,                 // EU-banking residency gate
  mostTrustedFamily: "anthropic",        // case-class lookup
});
// {
//   decision: "majority_decision",
//   escalation: "none",
//   resolvedVerdict: "accept",
//   disagreementRate: 0.333..., escalationRate: 0,
//   families: ["anthropic", "google", "openai"],
// }
```

Hard invariants enforced by the policy:

1. Every binding declares a known `JudgeModelFamily`.
2. No two judge roles in the same run share a family unless the caller
   passes `allowSharedFamily: true` (audit-only override).
3. Under `requireEuRegion: true`, every binding's `region` must equal
   `"eu"`. Non-EU bindings are refused with a `RangeError` carrying the
   offending judge id, family, and observed region.
4. The disagreement decision is computed deterministically from the
   verdicts; `split_decision` (1:1:1) always escalates to
   `human_review_required`. `majority_decision` only escalates when the
   lone dissenter belongs to `mostTrustedFamily`.

## Quorum voting

`resolveQuorumVerdict` mirrors the rules already used in
`judge-consensus.ts`:

| Tally | Resolved verdict |
| --- | --- |
| Strict majority `accept` / `repair` / `reject` | majority verdict wins |
| Tie containing `repair` | `repair` |
| Tie of `accept` + `reject` only | `repair` (defensive downgrade — never silently accept a rejected case) |
| Otherwise | highest-severity tied verdict |

The cross-family policy uses the same resolver so the disagreement
report agrees with the consensus artifact byte-for-byte.

## Human-review agent

`src/test-intelligence/human-review-agent.ts` produces a
`HumanReviewDecision` envelope. The default reviewer kind is
`dry_run_marker` — a deterministic offline-analysis marker:

```ts
import { buildDryRunHumanReviewMarker } from "../../src/test-intelligence/human-review-agent.js";

const marker = buildDryRunHumanReviewMarker({
  rationale: "Split decision (1:1:1) on screen S-101; escalating per AT-2038.",
  decidedAt: "2026-05-08T12:00:00Z",
  triggeredBy: "split_decision",
});
// marker.reviewerKind === "dry_run_marker"
// marker.verdict === "deferred"
// marker.principalHash === sha256("dry-run-marker")
```

For live operator escalations the caller supplies `reviewerKind:
"principal"` and either `principalId` or a precomputed
`principalHash`. The agent never persists the raw principal id; only
the sha256 hex anchor reaches the consensus artifact.

Length / safety guarantees:

- `rationale` is capped at `HUMAN_REVIEW_RATIONALE_MAX_CHARS` (1024).
- LF, CR, U+2028, and U+2029 are refused — defence-in-depth so
  reviewer prose can never smuggle line endings into evidence.
- `decidedAt` must be a strict ISO-8601 timestamp; the agent is
  clock-free.

## Disagreement report artifact

`src/test-intelligence/judge-disagreement-report.ts` writes the new
`<runDir>/judge-disagreement-report.json` artifact. The report is
produced for **every** run — even unanimous ones — so the
disagreement-rate trending in the provenance graph (B.10) has a
consistent audit anchor.

```text
{
  "schemaVersion": "1.0.0",
  "contractVersion": "1.13.0",
  "generatedAt": "2026-05-08T12:00:00Z",
  "jobId": "run-2038-demo",
  "decision": "split_decision",
  "escalation": "human_review_required",
  "disagreementRate": 0.666667,
  "escalationRate": 1,
  "judges": [
    { "judgeId": "a11y_judge", "family": "google", "modelId": "gemini-1.5-pro", "promptVersion": "a11y-judge.v1", "region": "eu", "verdict": "reject" },
    { "judgeId": "faithfulness_judge", "family": "openai", "modelId": "gpt-4o", "promptVersion": "faithfulness-judge.v1", "region": "eu", "verdict": "repair" },
    { "judgeId": "logic_judge", "family": "anthropic", "modelId": "claude-3.5-sonnet", "promptVersion": "logic-judge.v1", "region": "eu", "verdict": "accept" }
  ],
  "perFamilyAgreement": [
    { "family": "anthropic", "agreements": 0, "dissents": 1, "votes": 1 },
    { "family": "google", "agreements": 0, "dissents": 1, "votes": 1 },
    { "family": "openai", "agreements": 1, "dissents": 0, "votes": 1 }
  ],
  "costByFamily": [
    { "family": "anthropic", "totalTokens": 0, "costMicrounits": 0 },
    { "family": "google", "totalTokens": 0, "costMicrounits": 0 },
    { "family": "openai", "totalTokens": 0, "costMicrounits": 0 }
  ],
  "rawPromptsIncluded": false
}
```

Hard invariants on the artifact:

- Sorted: `judges` by `judgeId`; `perFamilyAgreement` and `costByFamily`
  by `family`. The artifact is byte-stable for byte-identical input.
- `rawPromptsIncluded` is the literal `false` (type-level).
- Atomic write: temp-file + rename, same pattern used by the rest of
  the test-intelligence module.

## Provenance graph integration (B.10)

The disagreement report records every judge family, model id, and
prompt version. The provenance-graph builder (`provenance-graph.ts`)
already serialises `JudgeConsensusPanelEntry` per panel run; the
optional `family` / `region` / `modelId` / `promptVersion` fields flow
through unchanged into the existing `Activity` nodes for the
`judge_consensus` step. No new edge classes were required — the
artifact-class extension carries the new evidence.

## FinOps split per family

The disagreement-report `costByFamily` rollup is the new audit anchor
for per-family cost. The harness can populate the rollup either:

1. Directly when the FinOps recorder is wired through the gateway
   (each judge call's tokens are attributed to the role's
   `modelBinding.family`), or
2. Lazily, by feeding the report builder zero-cost entries for every
   family seen in the run. The artifact then carries the per-family
   shape even when the FinOps recorder is dormant (the dry-run case).

The existing FinOps report (`FinOpsBudgetReport`) is unchanged; the
per-family slice is exposed through the disagreement artifact so the
operator can read both surfaces from one canonical-JSON file.

## EU-residency policy

The `eu-banking-default` profile passes `requireEuRegion: true` to the
cross-family policy. Any judge binding whose `region` is not `"eu"` is
refused before the run starts:

```text
RangeError: assertEuResidency: judge "logic_judge" binds family
"openai" to region "us". The eu-banking-default profile only accepts
EU-region endpoints.
```

This satisfies the DORA Article 28 and BaFin VAIT residency expectations
called out in the issue. The check is non-skippable for `eu-banking-default`;
operators that need to use non-EU endpoints must explicitly switch to a
non-banking profile and accept the audit consequence.

## No regression on hard gates G1–G7

The changes are additive only:

- `JudgeConsensusVerdict.humanReview`/`crossFamily` are optional. Existing
  consumers ignore them; the existing `assertJudgeConsensusVerdict*`
  tests remain green.
- `JudgePanelVerdict` and the semantic-judge panel artifact are
  unchanged. The `judge_panel-verdicts.json` byte-stability invariants
  hold.
- `AGENT_HARNESS_ROLES` adds `"human_review"` alphabetically; the
  `Record<AgentHarnessRole, AgentRoleProfile>` exhaustiveness check
  forced the new entry to be backed by a frozen profile, so the
  harness state machine wires the role at module load with no runtime
  configuration.

## See also

- Parent epic — Test Intelligence: 2026-Q3 Innovation Roadmap (Issue #2018+).
- Related: #2025, #2029 (judge schema), #1753 (panel + ICT register).
- Standards: DORA Article 28, BaFin VAIT.
- Benchmark protocol: `sandbox/benchmarks/test-intelligence/LOCAL_BENCHMARK_PROTOCOL.md`.
