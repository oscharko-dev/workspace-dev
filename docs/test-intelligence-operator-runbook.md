# Test Intelligence — Operator Runbook (production runner)

Audience: a banking / insurance operator who runs the
`figma_to_qc_test_cases` production runner against a live Azure AI
Foundry deployment, reviews the generated test cases via the inspector,
and exports them for downstream tooling.

This runbook is task-oriented. It assumes you have already shipped the
runner per `docs/test-intelligence.md` and have a working customer
deployment. For the wave-closing policy that decides when a "production-wired"
claim may be merged or released, see
`docs/test-intelligence-live-e2e.md`. Contract-surface changes (new
harness modes, hook events, refusal codes, FinOps fields) follow the
contract-bump workflow in `CONTRIBUTING.md` §Contract changes and are
recorded in `CONTRACT_CHANGELOG.md` + `COMPATIBILITY.md` together with
the snapshot test in `src/contract-version.test.ts`.

---

## Pre-flight (do this once per environment)

### 1. Environment matrix

The production runner reads its model bindings from
`WORKSPACE_TEST_SPACE_*` environment variables. The two endpoint variables
share an Azure AI Foundry account; the per-role deployment variables select
which deployment under that account is used for which agent role.

#### 1a. Endpoint and credential variables

| Variable                                     | Required              | Purpose                                                                                                     |
| -------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`        | yes                   | Base URL of the Azure AI Foundry account that hosts the chat-completion deployments. Includes `/openai/v1`. |
| `WORKSPACE_TEST_SPACE_MODEL_API_KEY`         | yes                   | Bearer token for the gateway. Stored in your secrets manager — never committed.                             |
| `WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT` | yes                   | Base URL for the visual-sidecar deployments. May equal `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`.               |
| `FIGMA_ACCESS_TOKEN`                         | yes for URL ingestion | Bearer for the Figma REST API. Token-scoped, server-side only.                                              |

#### 1b. Role-to-deployment matrix

| Variable                                           | Wave | Required | Role and recommended deployment                                                                                                                                                                                           |
| -------------------------------------------------- | :--: | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`   |  —   | yes      | Generator. Recommended: `mistral-large-3` (cross-vendor against `gpt-oss-120b` Logic-Judge). Backwards-compatible default: `gpt-oss-120b`.                                                                                |
| `WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`   |  —   | yes      | Visual-Sidecar primary describer. Recommended: `llama-4-maverick-vision` (Stable, multimodal chat). The previous `mistral-document-ai-2512` value is invalid for chat-completion paths and must not be used here.         |
| `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`  |  —   | yes      | Visual-Sidecar fallback. Recommended: `phi-4-multimodal-instruct` (cross-vendor diversity, Microsoft, Stable, multimodal).                                                                                                |
| `WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT`      |  1   | optional | Logic-Judge. Falls back to `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT` when unset. Recommended: `gpt-oss-120b` when the generator is `mistral-large-3` (cross-model voting). Activated by issue #1932.               |
| `WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT` |  2   | optional | Coverage-Planner LLM augmentation. Deterministic-only when unset. Recommended: `phi-4-mini-instruct`. Activated by issue #1934.                                                                                           |
| `WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT`      |  2   | optional | Risk-Ranker LLM augmentation. Deterministic-only when unset. Recommended: `phi-4`. Activated by issue #1935.                                                                                                              |
| `WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT`       |  2   | optional | LLM-augmented A11y-Judge. Deterministic eval still runs when unset. Recommended: `phi-4-multimodal-instruct` (may share the deployment with `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`). Activated by issue #1940. |

Verification: `pnpm exec node scripts/check-live-smoke-env.mjs` exits 0
when the endpoint and credential variables are complete. The role-to-deployment
variables marked **Wave 1+** are read by the corresponding follow-up issues
once they ship; they are safe to set in advance.

#### 1c. Recommended Azure AI Foundry deployments

The deployments below are the production-ready, Stable Azure AI Foundry
models that the multi-agent topology was validated against. Each row maps a
role to the catalog model name, the deployment name we recommend, and the
SKU configuration we exercised.

| Role                                | Catalog model                               | Deployment name (recommended) | SKU              | Capacity |
| ----------------------------------- | ------------------------------------------- | ----------------------------- | ---------------- | -------- |
| Generator (cross-vendor primary)    | `Mistral-Large-3` (Mistral AI, v1)          | `mistral-large-3`             | `GlobalStandard` | ≥ 10     |
| Generator (legacy)                  | `gpt-oss-120b` (OpenAI-OSS, v1)             | `gpt-oss-120b`                | `GlobalStandard` | ≥ 10     |
| Logic-Judge (cross-model)           | `gpt-oss-120b` (OpenAI-OSS, v1)             | `gpt-oss-120b`                | `GlobalStandard` | shared   |
| Visual-Primary                      | `Llama-4-Maverick-17B-128E-Instruct-FP8`    | `llama-4-maverick-vision`     | `GlobalStandard` | ≥ 10     |
| Visual-Fallback                     | `Phi-4-multimodal-instruct` (Microsoft, v1) | `phi-4-multimodal-instruct`   | `GlobalStandard` | ≥ 1      |
| Coverage-Planner (LLM augmentation) | `Phi-4-mini-instruct` (Microsoft, v1)       | `phi-4-mini-instruct`         | `GlobalStandard` | ≥ 1      |
| Risk-Ranker (LLM augmentation)      | `Phi-4` (Microsoft, v7)                     | `phi-4`                       | `GlobalStandard` | ≥ 1      |
| A11y-Judge (LLM augmentation)       | `Phi-4-multimodal-instruct` (Microsoft, v1) | `phi-4-multimodal-instruct`   | `GlobalStandard` | shared   |

Notes on substitutions made versus the original Wave-0 plan (issue #1927):

- `Mistral-Nemo` was the originally proposed Coverage-Planner model. The
  Azure catalog flags `Mistral-Nemo` v1 as `Deprecated` (inference end of
  service 2026-01-30); new deployments are rejected. `Phi-4-mini-instruct`
  is the Stable replacement with a comparable footprint.
- `Phi-3.5-vision-instruct` was the originally proposed A11y-Judge model.
  Azure flags v1 and v2 as `Deprecated` (inference end of service
  2025-08-30). `Phi-4-multimodal-instruct` is the Stable Microsoft
  multimodal-vision successor; we share the same deployment between the
  Visual-Fallback and the A11y-Judge roles to keep the deployment count low.
- `Llama-3.2-90B-Vision-Instruct` was the originally proposed
  Visual-Primary. Azure flags v1, v2, and v3 as `Deprecating` (inference
  end of service 2026-06-13) and rejects new deployments. The existing
  `llama-4-maverick-vision` deployment (Stable, no deprecation date)
  becomes the Visual-Primary; `Phi-4-multimodal-instruct` becomes the
  cross-vendor Visual-Fallback.
- `mistral-document-ai-2512` stays deployed but exposes
  `chatCompletion: false` and is not used in any chat-completion path. It
  is reserved for the Wave-3 OCR-sidecar discussion (separate issue).

#### 1d. Topology doctor

Before a live run, inspect the resolved local role matrix and compare it
against the runbook recommendations:

```bash
pnpm run ti:doctor
```

Direct CLI equivalent:

```bash
pnpm exec tsx src/cli.ts test-intelligence doctor
```

The doctor reads the same `WORKSPACE_TEST_SPACE_*` deployment variables as the
CLI run path, prints a sanitized role-to-deployment matrix, never prints
endpoints or secrets, and returns exit code `1` when it detects an invalid
role contract such as a document model wired into a chat-completion role.
Resolve any `warning` or `error` entries here before starting a live run.

#### 1e. Cross-model logic judge (Issue #1932)

The multi-agent harness's voting property only works when the
Generator and the Logic-Judge run on **different model families**.
When both roles share a deployment, a self-consistency bias from the
Generator is amplified rather than caught by the Judge — the
"two-LLM" topology collapses into a single LLM rated against itself.

Activate the dedicated Logic-Judge deployment by setting:

```bash
# Generator — picks the cross-vendor model deployed in Wave 0.
export WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT="mistral-large-3"

# Logic-Judge — different family from the generator. The runbook
# recommendation is gpt-oss-120b so the judge dissents on the
# generator's blind spots instead of voting in chorus.
export WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT="gpt-oss-120b"
```

The CLI mirrors the env var:

```bash
pnpm run ti:doctor

workspace-dev test-intelligence run \
  --figma-url <url> \
  --model-deployment mistral-large-3 \
  --logic-judge-deployment gpt-oss-120b \
  --mode deterministic_llm
```

When `WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT` is unset (or its
value matches the generator deployment), the runner falls back to the
generator client and the topology degrades to the legacy single-model
behaviour. This is preserved on purpose so existing operator
configurations keep working unchanged during the rollout.

FinOps attribution: per-source counters under
`bySource.judge_primary` record the **judge** deployment label so
cross-model topology shows up in the per-job report. The same
attempt is also rolled into the `byRole.test_generation` counters —
both judge and generator share the `test_generation` FinOps role
because they consume the same role-level budget envelope.

Faithfulness-judge swap is out of scope here: the faithfulness path
is already model-distinct via `bundle.visualPrimary` /
`bundle.visualFallback`.

### 2. Enable the runner

Pass `--enable-test-intelligence` when starting the workspace HTTP
server (or set the equivalent runtime flag). When the flag is off, every
TI route returns `503 TI_DISABLED` and the inspector hides itself —
this is the default to keep the surface area small for non-customers.

### 3. Pick a FinOps envelope

The runner ships with two named envelopes:

- `DEFAULT_FINOPS_BUDGET_ENVELOPE` — permissive, intended for the
  `validation-harness` and fixture replays. Do **not** use in production.
- `PRODUCTION_FINOPS_BUDGET_ENVELOPE` — fail-closed, calibrated for
  the `gpt-oss-120b` + visual-sidecar topology. Every role has caps
  on tokens, attempts, wall clock, and image payload size, plus a
  job-wide `maxJobWallClockMs` (5 min) and `maxReplayCacheMissRate`
  (0.5).

The production runner uses `PRODUCTION_FINOPS_BUDGET_ENVELOPE`
automatically. Operators who want a different envelope must pass it
explicitly via `RunFigmaToQcTestCasesInput.finopsBudget`; the runner
does **not** merge — the operator's value wins outright.

### 4. Reviewer setup

Each operator who reviews test cases needs:

- a stable `reviewerHandle` (e.g. their corporate email-local-part —
  the inspector persists this in `localStorage` per browser);
- a bearer token that the workspace HTTP server accepts (the inspector
  persists this in `sessionStorage` so it does not survive a tab close).

Four-eyes is enforced on regulated-data and high-risk cases — see
`src/test-intelligence/policy-gate.ts` and the inspector's policy panel
for the live rule list.

### 5. Pick a multi-agent harness mode

The production runner exposes three modes via
`RunFigmaToQcTestCasesInput.harness?.mode`:

| Mode          | Default | Behavior                                                                                                                                                                                                                                                                     |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`         | yes     | Single-pass LLM call. Failure classification = legacy. No harness step artifact written. Use for hermetic CI fixtures and any operator that has not yet enrolled in the harness rollout.                                                                                     |
| `shadow_eval` | no      | Single-pass LLM call still drives the terminal decision, but the runner additionally classifies the result through `runAgentHarnessStep` and persists a per-step artifact under `<runDir>/agent-role-runs/`. Use for A/B comparison before flipping to enforcement.          |
| `enforced`    | no      | Harness owns the terminal decision. A non-`accepted` outcome refuses the run with the same `ProductionRunnerError` failure-class envelope as legacy callers (`LLM_REFUSAL`, `LLM_RESPONSE_INVALID`, …) so request handlers and exporters do not need a second mapping table. |

`testDepth` (`standard` | `exhaustive`) controls iteration budget when
the mode is not `off`. The harness summary
(`RunFigmaToQcTestCasesResult.harness`) is present only for
`shadow_eval` and `enforced` so legacy callers see no field-shape
change. Bumping the mode enum is a contract change — record it in
`CONTRACT_CHANGELOG.md` + `COMPATIBILITY.md`.

For Issue #1800, the hermetic eval lane turns the curated
`src/test-intelligence/fixtures/eval-ab-input.json` sample into
canonical `eval-ab-<archetype>.json` reports. Those reports are the
CI-facing A/B artifact for `shadow_eval` rollout decisions: they expose
per-pipeline metric deltas, human-calibration error per criterion, and
the active bias controls.

Bias controls enforced by the A/B lane:

- Position bias: empirical-CDF post-hoc calibration on per-judge pointwise
  scores. No naive shuffling.
- Verbosity bias: concise output cap only; no hard length normalization in
  the score path.
- Self-preference: cross-family panel (`gpt-oss-120b`,
  `phi-4-multimodal-poc`).

For Issue #1804, `agent-eval-online-sampler.ts` runs an air-gapped online
evaluator over a deterministic sample of redacted production traces. The
sample rate defaults to 1%; sampling is deterministic given the seed and
sample rate (SHA-256 of `seed::traceId` truncated to 48 bits, compared
against the rate). PII is redacted before the evaluator sees the trace,
using whole-field token replacement to match the rest of the
test-intelligence redaction surface. Results land under
`<runDir>/agent-online-eval-report.json` as canonical JSON; no external
service is contacted by the default evaluator.

### 7. Tenant-scoped replay cache (Issue #1944)

Multi-tenant deployments must isolate replay-cache and judge-cache
entries per tenant so that one customer's prompt fragments cannot
leak into another customer's run result, even at the cache-hit
level.

The runner accepts a structured `TenantScope` on
`RunFigmaToQcTestCasesInput.replayCacheTenantScope`:

```ts
import type { TenantScope } from "workspace-dev/contracts";

const tenantScope: TenantScope = {
  tenantId: "acme-corp",
  environmentId: "prod",
  projectId: "checkout",   // optional; omit to use "default"
};

await runFigmaToQcTestCases({ /* … */, replayCacheTenantScope: tenantScope });
```

When omitted, the runner falls back to `DEFAULT_TENANT_SCOPE`
(`tenantId: "default"`, `environmentId: "default"`,
`projectId: "default"`) — preserving single-tenant behaviour for
callers that have not yet adopted the structured scope.

**On-disk layout.** The replay cache and every judge cache write to
a strict three-segment partition:

```
<outputRoot>/test-intelligence/replay-cache/
  <tenantId>/<environmentId>/<projectId>/<sha256>.json
<outputRoot>/test-intelligence/replay-cache/logic-judge/
  <tenantId>/<environmentId>/<projectId>/<sha256>.logic-judge.json
<outputRoot>/test-intelligence/replay-cache/a11y-judge/
  <tenantId>/<environmentId>/<projectId>/<sha256>.a11y-judge.json
<outputRoot>/test-intelligence/replay-cache/faithfulness-judge/
  <tenantId>/<environmentId>/<projectId>/<sha256>.faithfulness-judge.json
```

Each cache loader is bound to exactly one `tenantScope` at
construction time; cross-tenant reads are denied at the loader
level because the cache exposes no API to address paths outside
its scope directory. The deterministic key digest stays
tenant-agnostic, so two tenants with identical inputs share the
key but never share entries.

**Segment validation.** `tenantId`, `environmentId`, and
`projectId` are each treated as a single path component. Empty
values, the traversal tokens `.` / `..`, path separators (`/`,
`\`), and NUL bytes are rejected with a `RangeError` at cache
construction time. Use stable, non-PII identifiers (e.g. customer
org id), not raw API tokens.

**Migration from `replayCacheTokenScope`.**
The flat string field `replayCacheTokenScope` was replaced by the
structured `replayCacheTenantScope` in Issue #1944. Map existing
values as follows:

| Before                                 | After                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `replayCacheTokenScope` omitted        | omit `replayCacheTenantScope`, or pass `DEFAULT_TENANT_SCOPE`                          |
| `replayCacheTokenScope: "default"`     | `replayCacheTenantScope: { tenantId: "default", environmentId: "default" }`            |
| `replayCacheTokenScope: "<sha-token>"` | `replayCacheTenantScope: { tenantId: "<tenant-id>", environmentId: "<env-id>" }`       |

Existing on-disk cache entries written under the old single-segment
layout (`<rootDir>/<tokenScope>/...`) are not auto-migrated.
Operators that need to preserve cache hits across the migration
must move existing files into the new layout, e.g.:

```
mv <outputRoot>/test-intelligence/replay-cache/<oldScope> \
   <outputRoot>/test-intelligence/replay-cache/<tenantId>/<envId>/default
```

If preserving hits is not required (the more common case), simply
delete the old `<oldScope>` directory and let the cache repopulate
on the next run.

---

## Day-2 operations

### Submit a job

**From the inspector (preferred for ad-hoc runs):**

1. Open `/workspace/ui/inspector/test-intelligence`.
2. Use the Figma URL tab and paste a Figma file URL (or the raw file
   key).
3. The runner is auto-wired: a job id is allocated, ingestion runs
   server-side (token-bound), and the inspector navigates to the new
   job's results page when the runner finishes.

**From the CLI (preferred for batch / nightly runs):**

```
pnpm exec tsx src/test-intelligence/cli/run-production-runner.ts \
  --figma-url "https://www.figma.com/file/<KEY>/<NAME>" \
  --reviewer-handle "operator-1"
```

The runner emits artifacts under
`<artifactRoot>/<jobId>/` and prints the path on completion.

### Poll status (CLI / scripts)

```
curl -sS "http://localhost:3000/workspace/test-intelligence/jobs/<jobId>" | jq .
```

For real-time progress (UI uses this internally):

```
curl -N "http://localhost:3000/workspace/test-intelligence/jobs/<jobId>/events"
```

The events endpoint is an SSE stream — see
`docs/test-intelligence.md` for the event taxonomy.

### Retrieve artifacts

The inspector "Recent jobs" right rail lists the last 10 jobs; click
a row to open it. From the loaded job page:

- **Markdown** — single combined `testfaelle.md`.
- **ZIP bundle** — combined Markdown + per-case Markdown files +
  intermediate-representation JSON + manifest + summary.

CLI equivalents (server-relative paths under `/workspace`):

```
GET /workspace/test-intelligence/jobs/<jobId>/customer-markdown
GET /workspace/test-intelligence/jobs/<jobId>/customer-markdown.zip
```

### Verify evidence

Every job produces an evidence bundle at
`<runDir>/test-intelligence/`. The seal file
(`PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME`) contains
`headOfChainHash` + `chainLength` (Merkle-style hash chain over the
agent-harness checkpoints under `agent-harness-checkpoints/<jobId>/`),
the per-source FinOps `bySourceHash`, the `genealogyDagHash`, and the
visual-evidence per-screen hashes. The CycloneDX 1.7 ML-BOM lands at
`evidence/ml-bom/cyclonedx-1.7-ml-bom.json`.

To verify a bundle has not been tampered with:

```
pnpm exec tsx scripts/verify-evidence-manifest.ts \
  --job-dir <artifactRoot>/<jobId>
```

The script recomputes every artifact hash and the chain head and exits
non-zero on any mismatch. Auditors can run it without read access to the
source.

### Four-eyes approvals

For test cases flagged with `fourEyesEnforced=true`, two distinct
reviewers must approve before the case can be exported. The detail
panel surfaces:

- the enforcement reason (risk category, visual low-confidence,
  multi-source conflict, etc.);
- the list of approvers so far;
- a guard that prevents the same reviewer approving twice.

The audit trail lives in `review-events.jsonl` next to the artifacts.

### Catch-Up Brief

When a reviewer is mid-decision and a job has been idle longer than
`CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS` (5 minutes), the runner can
compose a 1–3 sentence brief summarising what changed. Two generator
modes are available:

- `deterministic` (default) — pure function over the on-disk event log.
  Same input ⇒ byte-identical output. Safe to surface unconditionally.
- `no_tools_llm` (opt-in) — small LLM call constrained to **no tools**.
  The composer falls back to `deterministic` if the response contains
  any tool-call shape, is empty/oversized, fails the
  `semantic-content-sanitization` filter, or throws.

Briefs land at `<runDir>/briefs/<safe-iso>.json` (each `:` and `.`
replaced) and surface in the Inspector "Catch-Up Brief" tab. A brief
never leaks raw event bodies; only event kinds + bounded "significant
ids" lists (≤ 16 each) are included.

### Hooks

Operators can wire hook matchers
(`src/test-intelligence/harness-hooks.ts`) to fire on harness lifecycle
events: `OnEvidenceSeal`, `OnExportComplete`, `OnFourEyesPending`,
`OnNeedsReview`, `OnStop`, `OnSubagentStop`, plus `Pre*` / `Post*`
variants for `RoleCall`, `JudgePanel`, `GapFinder`, `Repair`, and
`VisualSidecar`. Four command kinds are supported:

| Kind      | Purpose                                               | Notes                                                                                                                        |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `command` | Spawn a local shell process (`cmd`, `args`, `cwd`).   | Bounded by `timeoutMs`. Operator-managed environment.                                                                        |
| `prompt`  | Run a registered prompt with no tools.                | Pinned to `promptVersion` + `modelBinding`.                                                                                  |
| `http`    | POST a templated body to an allow-listed URL.         | Only `POST`. URLs must match `HookRuntimePolicy.allowedHttpHosts`. Header values may interpolate `${ENV}` from an allowlist. |
| `agent`   | Invoke a role profile (manager/judge/generator/etc.). | Subject to the same FinOps + ICT-register rules as the runner's primary roles.                                               |

**Signed-bundle requirement.** Banking-profile operators must register
hook bundles under their corporate signing root and pin the bundle id in
`HookMatcher.signedBundleId`. The runtime extracts registered ids from
`CONTRACT_CHANGELOG.md` via
`extractRegisteredSignedBundleIdsFromContractChangelog` and refuses
unregistered or unsigned bundles. Refusal codes you may observe:

| Refusal code                       | Meaning                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `hook_async_rewake_requires_async` | `asyncRewake: true` requires `async: true`.                               |
| `hook_bundle_unregistered`         | `signedBundleId` not present in the runtime registry.                     |
| `hook_bundle_unsigned`             | Policy requires a signed bundle; matcher omitted `signedBundleId`.        |
| `hook_http_domain_not_allowlisted` | Target host not in `HookRuntimePolicy.allowedHttpHosts`.                  |
| `hook_http_header_invalid`         | Header name empty, or interpolation references a non-allowlisted env var. |
| `hook_http_method_unsupported`     | Method other than `POST`.                                                 |
| `hook_if_invalid`                  | `if` expression failed to parse.                                          |
| `hook_schema_invalid`              | Matcher fails schema validation (unknown event, etc.).                    |
| `hook_telemetry_url_blocked`       | URL resembles a telemetry/analytics/beacon endpoint.                      |

Refusal records land in the harness execution log alongside successful
hook runs so auditors see a complete picture of what fired and what was
suppressed.

### FinOps interpretation

Every job emits a FinOps report at `<runDir>/finops-report.json`. Two
shapes matter for day-2 operations:

- **Per-source `bySource` map** — keyed by the agent source label
  (`manager`, `judge_primary`, `judge_secondary`, `visual_primary`,
  `visual_fallback`, `generator`, `gap_finder`, `repair_planner`,
  `ir_mutation_oracle`, or `hook:<bundleId>`). For each source the
  report records `costMinorUnits`, `tokensIn`, `tokensOut`, `callCount`,
  `inFlightDedupHits`, and `idempotentReplayHits`. The map is sealed
  with `bySourceSealedAt` and hashed into the evidence seal as
  `bySourceHash` so any post-hoc edit breaks chain verification.
- **Cache and replay metrics** — `replayCacheHitRate` and
  `promptCacheHitRate` (currently mirrored from the same replay-cache
  signal until the gateway exposes a separate prompt-cache counter).
  `inFlightDedupHits` are deduplicated requests _within the same job_;
  `idempotentReplayHits` are disk-backed replay-cache hits across jobs.
  Treat the two counters as distinct: a high in-flight dedup count
  usually means a fan-out role over-issued requests; a high idempotent
  replay rate means the operator is replaying a fixture and is the
  intended steady state for `validation-harness` lanes.

The envelope's `maxReplayCacheMissRate` (default 0.5) caps drift away
from the replay cache: if the live miss rate climbs above the cap, the
report records a `replay_cache_miss_rate_breach` outcome and the job is
marked `needs_review`. Pair this with the `maxJobWallClockMs` cap (5
min) for a fail-closed budget envelope.

---

## Recovery

### Resume from the evidence chain head

Every harness step writes an `AgentHarnessCheckpoint` under
`<runDir>/agent-harness-checkpoints/<jobId>/`. Each checkpoint carries a
`parentHash` (sha256 of the previous checkpoint's canonical-JSON) and a
monotonic `chainIndex`. The root checkpoint's `parentHash` is the
64-char zero-hash sentinel (`AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH`).
Allowed statuses are `started`, `completed`, `failed`, `canceled`, and
`skipped`.

To resume after a crash:

1. List the per-job checkpoint directory and pick the highest
   `chainIndex` whose status is `completed` — that is the chain head.
2. Re-submit the job with the same `jobId`. The runner is idempotent at
   the checkpoint level: it re-emits any already-completed step from
   disk and starts fresh work at `chainIndex + 1`.
3. After the run finishes, run `scripts/verify-evidence-manifest.ts`.
   The verifier walks the chain end-to-end and reports a `chain_break`
   at the first affected `chainIndex` if any link is missing or
   tampered.

If the chain is broken, the safe action is to fail the job and let the
operator submit a fresh job id; the broken chain stays under the
artifact root for incident review.

### Idempotent re-submission

Apart from the checkpoint chain, two mechanisms keep replays safe:

- **In-flight deduplication.** Identical role-call requests within a
  single job are deduplicated; the duplicate is recorded as
  `inFlightDedupHits` rather than re-issued.
- **Replay cache.** When enabled, identical requests across jobs hit a
  disk-backed cache. Hits are surfaced as `idempotentReplayHits`. The
  cache key never includes raw bodies — see DPIA §1.4.

A re-submission of a failed job always allocates a fresh `jobId`. The
failed run stays under the artifact root for incident review; the new
run starts a new chain.

### Break-glass switches

| Situation                                                 | Switch                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Disable the runner entirely.                              | Restart the HTTP server without `--enable-test-intelligence`. Routes return `503 TI_DISABLED`; the inspector hides.                                                |
| Drop the multi-agent harness back to single-pass.         | Set `harness.mode` to `"off"` for the operator's submission profile. Pre-existing artifacts remain valid; no chain break is raised.                                |
| Suspend a non-essential hook.                             | Remove its matcher from the operator's hook configuration; runtime no longer fires it. Already-recorded executions remain auditable.                               |
| Stop accepting new Figma URL submissions.                 | Unset `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN`. URL ingestion fails fast with `FIGMA_URL_REJECTED`; paste-based submissions continue.                               |
| Force every job to `needs_review` (e.g. incident triage). | Lower the active policy profile to `eu-banking-default`; combined with `untrustedContentReport` severity escalations this routes every export to four-eyes review. |

Apply break-glass changes in version-controlled configuration; the
audit log records who flipped what and when.

### Gateway timeout (5xx, network error)

The runner retries per the role's `maxRetriesPerRequest` (test
generation: 2, visual: 1). On exhaustion the job fails with
`failureClass="LLM_GATEWAY_FAILED"` (or `FIGMA_FETCH_FAILED` for the
ingestion path) and the partial artifacts are kept under
`<artifactRoot>/<jobId>/` for debugging.

Action: verify the Azure deployment is reachable
(`scripts/check-live-smoke-env.mjs`), then re-submit the job.
Re-submission gets a fresh job id — this is intentional so the failed
run stays auditable.

### Circuit open

If the gateway client trips a circuit breaker (consecutive 5xx beyond
the threshold), the runner refuses new requests until the cooldown
elapses. The error message includes the remaining ms and the live-E2E
taxonomy maps it to `circuit_breaker_open`.

Action: wait for the cooldown to elapse, then re-submit. Frequent
circuit trips usually indicate a deployment-side problem — check the
Azure portal before retrying.

### FinOps breach

The runner aborts as soon as a role exceeds its cap and emits
`FINOPS_BUDGET_INVALID` (envelope-level) or a per-role
`<role>_finops_breach` outcome with the breached field name (e.g.
`maxTotalOutputTokens`). The job id, the role, and the actual vs.
budgeted values are logged.

Action: if the breach is legitimate (the spec drifted, the design got
larger), provide a wider envelope explicitly via
`RunFigmaToQcTestCasesInput.finopsBudget`. If the breach is
unexpected, treat it as a degradation signal — investigate before
loosening the cap.

### Policy refusal

The policy engine can block export
(`policy_blocked_cases_present`) for reasons such as missing four-eyes,
PII-in-input, regulated-data flags without rationale, or — under
`eu-banking-default` — an active model binding without an
`ictRegisterRef` (`ict_register_ref_required`). The inspector surfaces
the violations in the policy summary panel.

Action: address the violations in the inspector (add rationale,
secure a second approver, redact PII, register the ICT reference for
the binding), then export again. The runner itself does not re-evaluate
policy; the inspector does, on demand.

### Visual sidecar refusal

When the visual sidecar exhausts both deployments or detects possible
PII in a screen, the runner publishes a complete artifact set but routes
every test case to `needs_review` via the policy gate. Common refusal
codes you may see in the policy report:

- `both_sidecars_failed` — primary + fallback both exhausted.
- `visual_possible_pii` — a screen carries PII-shaped content; reviewer
  must redact before export.
- `schema_invalid_response` — a sidecar response failed schema validation.

Pre-flight failure classes (`image_payload_too_large`,
`empty_screen_capture_set`, `duplicate_screen_id`,
`image_mime_unsupported`, `non_figma_url_source`) are caller bugs and
still fail the runner fast.

### Harness refusal (enforced mode)

When `harness.mode === "enforced"`, the harness can refuse to accept the
LLM output. Outcomes map to the existing failure-class envelope as
follows:

| Harness `errorClass`  | Mapped `ProductionRunnerError.failureClass` | Operator response                                                                                            |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `judge_rejection`     | `LLM_REFUSAL`                               | Inspect judge panel artifact; if the judge is right, fix the source. If wrong, file a judge-eval ticket.     |
| `schema_validation`   | `LLM_RESPONSE_INVALID`                      | Re-run; persistent invalid responses indicate a prompt drift or model regression.                            |
| `policy_refusal`      | `LLM_REFUSAL`                               | Same path as the policy-refusal recovery above.                                                              |
| `budget_exhausted`    | `FINOPS_BUDGET_INVALID` (envelope-derived)  | Same path as the FinOps-breach recovery above.                                                               |
| `iteration_exhausted` | `LLM_REFUSAL`                               | Increase `testDepth` to `exhaustive` only with explicit operator approval; otherwise treat as a real defect. |
| `timeout`             | `LLM_GATEWAY_FAILED`                        | Same path as the gateway-timeout recovery above.                                                             |
| `gateway_error`       | `LLM_GATEWAY_FAILED`                        | As above.                                                                                                    |
| `internal_error`      | `LLM_GATEWAY_FAILED`                        | File a runner bug — internal errors are never expected in steady state.                                      |

### Untrusted-content escalation

`UntrustedContentNormalizer` (DPIA §1.5) runs before any LLM call. Any
exception during traversal escalates the job to `needs_review` with the
`adf_collapsed_node` carrier, and `sentinelLayerNames > 0` (a layer
named like a sentinel value, e.g. `__system__`) routes the job to
`needs_review` even when the rest of the source is clean. The
normalization report is byte-stable and persisted alongside the
generated artifacts; reviewers should consult its `dropCounts` summary
before exporting.

---

## Incident classes (release-summary taxonomy)

For wave-closing PR notes and release waivers, normalize per-job signals
into the release-summary taxonomy in
`docs/test-intelligence-live-e2e.md` §4 (`provider_unavailable`,
`quota_exceeded`, `policy_block`, `schema_invalid_response`,
`circuit_breaker_open`). Quick-reference mapping for the operator-facing
codes most commonly seen in day-2 ops:

| Operator-facing signal                                                                               | Release-summary class     |
| ---------------------------------------------------------------------------------------------------- | ------------------------- |
| `LLM_GATEWAY_FAILED`, `FIGMA_FETCH_FAILED`, gateway `transport`/`timeout`                            | `provider_unavailable`    |
| `rate_limited`, `primary_quota_exceeded`                                                             | `quota_exceeded`          |
| `policy_blocked_cases_present`, `ict_register_ref_required`, `visual_possible_pii`, `policy_blocked` | `policy_block`            |
| `LLM_RESPONSE_INVALID`, sidecar `schema_invalid_response`                                            | `schema_invalid_response` |
| Gateway `transport` with message `circuit breaker is open`                                           | `circuit_breaker_open`    |

`protocol` and `canceled` stay verbatim per the live-E2E doc:
`protocol` indicates operator/configuration repair is required, while
`canceled` indicates a caller-side abort rather than provider
instability.

---

## Cost ceiling — worked example

The `PRODUCTION_FINOPS_BUDGET_ENVELOPE` caps the test-generation role
at `maxTotalInputTokens=80,000` and `maxTotalOutputTokens=8,000`.

Assume the operator's contract with the model vendor is `$1` per
million input tokens and `$5` per million output tokens for
`gpt-oss-120b`. **(Example only — your actual contract may differ.
Operators must verify their per-million pricing with the vendor.)**

- Input ceiling: 80,000 tokens × $1 / 1,000,000 = **$0.08**
- Output ceiling: 8,000 tokens × $5 / 1,000,000 = **$0.04**
- Per-job test-generation ceiling: **$0.12**

Visual sidecars add cost only when actually invoked. The visual_primary
role caps at 40,000 input + 4,000 output per request, with up to 2
attempts (primary then fallback). At the same example pricing, one
visual call ceilings at $0.06 input + $0.02 output = $0.08.
Worst-case three visual calls per job (primary + fallback + a retry):
$0.24. Combined per-job worst case: **≈ $0.36**.

Multiply by your daily job count for a daily cost ceiling. The runner
abort-on-cap behavior makes this a hard upper bound rather than a
forecast. The per-source cost map (see "FinOps interpretation") makes
the daily breakdown auditable per role + hook bundle.

---

## Live-E2E lane

The live-E2E lane is the closing gate for any "production-wired" claim
and is opt-in. The full policy is in
`docs/test-intelligence-live-e2e.md`; the operator-facing summary:

- **Required env**: `WORKSPACE_TEST_SPACE_LIVE_E2E=1`,
  `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`,
  `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`,
  `WORKSPACE_TEST_SPACE_API_KEY` or
  `WORKSPACE_TEST_SPACE_MODEL_API_KEY`. Visual + Jira variables are
  required only when the claim covers those surfaces. See the
  live-E2E doc §2 for the full matrix and redacted examples.
- **Expected duration**: ≤ 5 minutes per run, capped by the production
  envelope's `maxJobWallClockMs`. A single test-generation request caps
  at 120 s; visual at 60 s. The GitHub Actions workflow has a 15-minute
  job timeout to leave room for install + artifact upload on failure.
- **Trigger**: `workflow_dispatch` + nightly at 03:00 Europe/Berlin in
  `.github/workflows/test-intelligence-live-e2e.yml`. **Not** part of
  the default `pull_request` path.
- **Failure-class taxonomy**: see "Incident classes" above and the
  live-E2E doc §4.

A claim closes only when the run produces all required artifacts
(`business-intent-ir.json`, `compiled-prompt.json`,
`generated-testcases.json`, `validation-report.json`,
`policy-report.json`, `coverage-report.json`,
`customer-markdown/testfaelle.md`) and the PR description records
either a sanitized run-log review or an explicit waiver.

---

## See also

- `docs/test-intelligence-live-e2e.md` — closing-gate policy for
  production-wired claims, full env matrix, and failure taxonomy.
- `docs/test-intelligence.md` — feature overview, event taxonomy, live
  smoke instructions.
- `docs/test-intelligence-observability.md` — optional OpenTelemetry span
  names, counter name, stable attributes, and severity mapping.
- `docs/test-intelligence-dpia-production-runner.md` — data flows,
  redaction layers, evidence chain, ICT-register references, and
  DORA mapping for the production runner.
- `docs/runbooks/jira-source-setup.md` — Jira credential setup for
  claims that extend into Jira-backed source flows.
- `CONTRIBUTING.md` §Contract changes — contract-bump workflow.
- `CONTRACT_CHANGELOG.md` — versioning rules and registered signed
  bundle ids (read by
  `extractRegisteredSignedBundleIdsFromContractChangelog`).
- `COMPATIBILITY.md` — supported deprecation windows and harness mode
  rollout policy.
- `src/test-intelligence/finops-budget.ts` — envelope source of truth.
- `src/test-intelligence/harness-hooks.ts` — hook event list, command
  shapes, refusal codes.
- `src/test-intelligence/agent-harness-checkpoint.ts` — checkpoint
  chain semantics and verification rules.
- `src/test-intelligence/production-runner-evidence.ts` — evidence
  seal shape and `headOfChainHash` derivation.
