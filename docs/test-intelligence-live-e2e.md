# Live-E2E Closing Gate For Production-Wired Claims

Audience: maintainers and operators closing a story or PR that claims the
test-intelligence production path is "wired" against live infrastructure.

This document defines the closing-gate policy for `pnpm run test:ti-live-e2e`.
Use it together with `docs/test-intelligence.md` and
`docs/test-intelligence-operator-runbook.md`.

---

## 1. Closing-gate rule

Treat the live-E2E lane as the final gate for any claim that the
test-intelligence production runner is wired to real provider infrastructure.

A claim is "production-wired" when the story, PR, or release notes say that one
or more of the following paths work against live operator infrastructure rather
than only deterministic mocks:

- Azure AI Foundry-backed test generation.
- Live visual sidecar requests.
- Live Figma URL ingestion using the server-side Figma token.
- Optional Jira-backed source enrichment or downstream transfer flows.

To close that claim:

1. Run `pnpm run test:ti-live-e2e` at least once against the operator
   environment that backs the claim.
2. Confirm that the run exits `0` and emits the required artifacts listed in
   §5.
3. Review the command output and any preserved workflow logs in sanitized form.
   The review must confirm that deployment ids and artifact paths are
   intelligible for debugging, while API keys, bearer tokens, prompt bodies, and
   raw secret values stay absent.
4. Record the outcome in the PR description:
   either a short live-E2E summary or an explicit waiver with reason.

`pnpm run test:ti-live-e2e` is not part of the default PR pipeline. The absence
of a live-E2E result is therefore a release blocker for a production-wired
claim, not a test failure in the ordinary hermetic CI lane.

---

## 2. Required environment

### Minimum environment for the lane itself

The lane entrypoint is defined in `package.json` as:

```sh
WORKSPACE_TEST_SPACE_LIVE_E2E=1 \
node scripts/check-live-smoke-env.mjs && \
WORKSPACE_TEST_SPACE_LIVE_E2E=1 \
tsx --test src/test-intelligence/production-runner.live-e2e.test.ts
```

At minimum, the command requires:

- `WORKSPACE_TEST_SPACE_LIVE_E2E=1`
- `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_API_KEY` or `WORKSPACE_TEST_SPACE_MODEL_API_KEY`

The env checker also validates the visual-sidecar variables so the same operator
environment can exercise the full production shape:

- `WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`

Redacted example using loopback placeholders:

```sh
export WORKSPACE_TEST_SPACE_LIVE_E2E=1
export WORKSPACE_TEST_SPACE_MODEL_ENDPOINT="https://127.0.0.1/redacted-azure-foundry"
export WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT="redacted-test-generation"
export WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT="https://127.0.0.1/redacted-azure-vision"
export WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT="redacted-visual-primary"
export WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT="redacted-visual-fallback"
export WORKSPACE_TEST_SPACE_API_KEY="redacted-non-prod-key"
pnpm run test:ti-live-e2e
```

### Credentials required for the broader claim

The fixture-based lane itself does not fetch Figma or Jira data. A
production-wired claim often covers those adjacent surfaces as well, so keep the
operator environment aligned with the runbook:

| Surface | Required when the claim includes | Credential / env | Loopback-redacted example |
| --- | --- | --- | --- |
| Azure AI Foundry gateway | Any live-E2E run | `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`, `WORKSPACE_TEST_SPACE_API_KEY` or `WORKSPACE_TEST_SPACE_MODEL_API_KEY` | `https://127.0.0.1/redacted-azure-foundry`, `redacted-non-prod-key` |
| Figma URL ingestion | Live URL ingestion, inspector submit flow, or server-side file fetch | `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN` | `redacted-figma-pat` |
| Jira Cloud API token | Jira REST-backed source claim | `WORKSPACE_TI_JIRA_EMAIL`, `WORKSPACE_TI_JIRA_API_TOKEN` | `operator@example.invalid`, `redacted-jira-api-token` |
| Jira OAuth 2.0 | Jira REST-backed source claim using 3LO | `JIRA_OAUTH_ACCESS_TOKEN` | `redacted-jira-oauth-token` |
| Jira Data Center PAT | Jira REST-backed source claim using bearer auth | `WORKSPACE_TI_JIRA_PAT` | `redacted-jira-pat` |

If the story claims only Azure-backed generation and not Figma URL ingestion or
Jira enrichment, note that scope explicitly in the PR summary.

---

## 3. Duration and rate-limit expectations

The lane is intentionally opt-in because it is bounded, billable, and sensitive
to provider-side throttling.

- The production FinOps envelope caps the total job wall clock at 5 minutes.
- Test-generation requests cap at 120 seconds each, up to 3 total attempts.
- Visual requests cap at 60 seconds each, up to 2 total attempts.
- The GitHub Actions workflow has a 15 minute job timeout to leave room for
  dependency install and artifact upload on failure.
- The nightly workflow runs at 03:00 Europe/Berlin (`0 1 * * *` UTC in summer)
  and is intentionally separated from other live lanes to avoid Azure-side
  rate-limit overlap.
- The workflow is `workflow_dispatch` + nightly only. It is not part of the
  normal `pull_request` path.

If the repository secret `WORKSPACE_TEST_SPACE_MODEL_API_KEY` is absent, the
workflow writes `live-E2E skipped` to the job summary instead of failing red.
That skip is acceptable for the workflow itself, but not for a release that
claims production wiring unless the PR carries an explicit waiver.

---

## 4. Failure taxonomy

The runtime exposes stable failure enums such as `LLM_GATEWAY_FAILED`,
`LLM_RESPONSE_INVALID`, and `FINOPS_BUDGET_INVALID`. For wave-closing and PR
summaries, normalize them into the operator-facing taxonomy below.

| Closing-gate class | Map from current signals | What it means operationally |
| --- | --- | --- |
| `provider_unavailable` | `LLM_GATEWAY_FAILED`, `FIGMA_FETCH_FAILED`, workflow/network 5xx, `reason="gateway-timeout"` | The upstream provider could not be reached or did not answer reliably enough to finish the run. |
| `quota_exceeded` | provider `rate_limited`, visual fallback `primary_quota_exceeded`, FinOps cap breaches such as `reason="finops-breach"` | The run hit a provider or local budget ceiling and must not be counted as a successful wired pass. |
| `policy_block` | `reason="policy-blocked"`, missing approvals, regulated-data policy refusal | The pipeline ran, but policy prevented the operator from treating the output as release-ready evidence. |
| `schema_invalid_response` | `LLM_RESPONSE_INVALID`, sidecar `schema_invalid_response`, malformed structured output | The provider answered, but the response shape was not trustworthy enough to accept. |
| `circuit_breaker_open` | `reason="circuit-open"` | The provider has failed repeatedly enough that the client is in cooldown and new requests are intentionally refused. |

Use these normalized labels in PR summaries and release waivers, then add the
underlying runner/workflow reason for debugging detail.

---

## 5. What counts as "wired"

A production-wired claim closes only when a successful live-E2E run produces all
required artifacts under `<outputRoot>/jobs/<jobId>/test-intelligence/`:

- `business-intent-ir.json`
- `compiled-prompt.json`
- `generated-testcases.json`
- `validation-report.json`
- `policy-report.json`
- `coverage-report.json`
- `customer-markdown/testfaelle.md`
- per-case Markdown files under `customer-markdown/`

The minimum success bar is:

- at least 1 successful `pnpm run test:ti-live-e2e` invocation;
- non-empty generated test cases with non-empty titles and steps;
- a final policy report under `eu-banking-default`;
- the production FinOps envelope in effect;
- a sanitized run-log review recorded in the PR.

If the claim also includes Figma URL ingestion or Jira-backed behavior, note
whether those credentials were present and whether that adjacent surface was
exercised or intentionally waived.

Example PR note:

```md
Live-E2E closing gate:
- `pnpm run test:ti-live-e2e` passed against the non-prod Azure Foundry deployment.
- Artifacts present: `business-intent-ir.json`, `compiled-prompt.json`,
  `generated-testcases.json`, `validation-report.json`, `policy-report.json`,
  `coverage-report.json`, and `customer-markdown/testfaelle.md`.
- Sanitized log review: deployment ids visible for debugging; no keys, bearer
  tokens, or prompt bodies surfaced.
```

Example waiver:

```md
Live-E2E closing gate waiver:
- Reason: operator Azure secret rotation window; repository live-E2E workflow is
  intentionally skipped until the non-prod key is reprovisioned.
- Scope waived: release note wording limited to hermetic CI coverage only; no
  production-wired claim for Figma URL ingestion or Jira export.
```

---

## 6. CI policy

- Live-E2E is opt-in and operator-environment backed.
- Live-E2E is mandatory before tagging a release that claims production wiring.
- Live-E2E is not required for ordinary hermetic PR validation when no
  production-wired claim is made.
- The PR checklist must include: "live-E2E run produces all required artifacts"
  or "explicit waiver with reason".

---

## See also

- `docs/test-intelligence.md` — feature overview and the canonical live-E2E lane
  description.
- `docs/test-intelligence-operator-runbook.md` — operator procedures, recovery,
  and FinOps envelope details.
- `docs/runbooks/jira-source-setup.md` — Jira credential setup for claims that
  extend into Jira-backed source flows.
