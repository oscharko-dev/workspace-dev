# Test Intelligence — Operator Runbook (production runner)

Audience: a banking / insurance operator who runs the
`figma_to_qc_test_cases` production runner against a live Azure AI
Foundry deployment, reviews the generated test cases via the inspector,
and exports them for downstream tooling.

This runbook is task-oriented. It assumes you have already shipped the
runner per `docs/test-intelligence.md` and have a working customer
deployment.

---

## Pre-flight (do this once per environment)

### 1. Environment matrix

| Variable                                                | Required              | Purpose                                                                         |
| ------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `WORKSPACE_AZURE_AI_FOUNDRY_ENDPOINT`                   | yes                   | Base URL of the Azure AI Foundry deployment.                                    |
| `WORKSPACE_AZURE_AI_FOUNDRY_API_KEY`                    | yes                   | Bearer token for the gateway. Stored in your secrets manager — never committed. |
| `WORKSPACE_AZURE_AI_FOUNDRY_TEST_GENERATION_DEPLOYMENT` | yes                   | Deployment name for the test-generation model (default: `gpt-oss-120b`).        |
| `WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_PRIMARY_DEPLOYMENT`  | yes                   | Deployment for the primary visual sidecar (e.g. `llama-4-maverick-vision`).     |
| `WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_FALLBACK_DEPLOYMENT` | optional              | Lighter deployment used when primary refuses or times out.                      |
| `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN`                 | yes for URL ingestion | Bearer for the Figma REST API. Token-scoped, server-side only.                  |

Verification: `pnpm exec node scripts/check-live-smoke-env.mjs` exits 0
when the matrix is complete.

### 2. Enable the runner

Pass `--enable-test-intelligence` when starting the workspace HTTP
server (or set the equivalent runtime flag). When the flag is off, every
TI route returns `503 TI_DISABLED` and the inspector hides itself —
this is the default to keep the surface area small for non-customers.

### 3. Pick a FinOps envelope

The runner ships with two named envelopes:

- `DEFAULT_FINOPS_BUDGET_ENVELOPE` — permissive, intended for the
  `poc-harness` and fixture replays. Do **not** use in production.
- `PRODUCTION_FINOPS_BUDGET_ENVELOPE` — fail-closed, calibrated for
  the `gpt-oss-120b` + visual-sidecar topology. Every role has caps
  on tokens, attempts, wall clock, and image payload size.

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
`docs/four-eyes-review.md` for the policy.

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

Every job produces an evidence bundle (`evidence/manifest.json` plus
artifact hashes). To verify a bundle has not been tampered with:

```
pnpm exec tsx scripts/verify-evidence-manifest.ts \
  --job-dir <artifactRoot>/<jobId>
```

The script recomputes every artifact hash and exits non-zero on any
mismatch.

### Four-eyes approvals

For test cases flagged with `fourEyesEnforced=true`, two distinct
reviewers must approve before the case can be exported. The detail
panel surfaces:

- the enforcement reason (risk category, visual low-confidence,
  multi-source conflict, etc.);
- the list of approvers so far;
- a guard that prevents the same reviewer approving twice.

The audit trail lives in `review-events.jsonl` next to the artifacts.

---

## Recovery

### Gateway timeout (5xx, network error)

The runner retries per the role's `maxRetriesPerRequest` (test
generation: 2, visual: 1). On exhaustion the job fails with
`reason="gateway-timeout"` and the partial artifacts are kept under
`<artifactRoot>/<jobId>/` for debugging.

Action: verify the Azure deployment is reachable
(`scripts/check-live-smoke-env.mjs`), then re-submit the job.
Re-submission gets a fresh job id — this is intentional so the failed
run stays auditable.

### Circuit open

If the gateway client trips a circuit breaker (consecutive 5xx beyond
the threshold), the runner refuses new requests until the cooldown
elapses and emits `reason="circuit-open"`.

Action: wait for the cooldown to elapse (the error message includes
the remaining ms), then re-submit. Frequent circuit trips usually
indicate a deployment-side problem — check the Azure portal before
retrying.

### FinOps breach

The runner aborts as soon as a role exceeds its cap and emits
`reason="finops-breach"` with the breached field name (e.g.
`maxTotalOutputTokens`). The job id, the role, and the actual vs.
budgeted values are logged.

Action: if the breach is legitimate (the spec drifted, the design got
larger), provide a wider envelope explicitly via
`RunFigmaToQcTestCasesInput.finopsBudget`. If the breach is
unexpected, treat it as a degradation signal — investigate before
loosening the cap.

### Policy refusal

The policy engine can refuse to export a case
(`reason="policy-blocked"`) for reasons such as missing four-eyes,
PII-in-input, or a regulated-data flag without a rationale. The
inspector surfaces the violations in the policy summary panel.

Action: address the violations in the inspector (add rationale,
secure a second approver, redact PII), then export again. The runner
itself does not re-evaluate policy; the inspector does, on demand.

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
forecast.

---

## See also

- `docs/test-intelligence.md` — feature overview, event taxonomy, live
  smoke instructions.
- `docs/test-intelligence-dpia-production-runner.md` — data flows and
  DORA mapping for the production runner.
- `docs/four-eyes-review.md` — review policy.
- `src/test-intelligence/finops-budget.ts` — envelope source of truth.
