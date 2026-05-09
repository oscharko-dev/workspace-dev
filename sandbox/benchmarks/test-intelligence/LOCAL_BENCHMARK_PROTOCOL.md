# WorkspaceDev Test Intelligence - Local Benchmark Protocol

Status: local-only, not for public repository docs  
Owner: WorkspaceDev Test Intelligence development team  
Initial dataset: `T7l7m8T8501lxLZZFQrwJC`  
Baseline run: `2026-05-07T06-11-39-900Z`

## 1. Purpose

This benchmark protocol gives us a repeatable way to measure whether a Test Intelligence optimization is an improvement or a regression.

The procedure is intentionally local. It lives under `sandbox/`, which is ignored by git. Do not move this file into `docs/`, do not publish it in the public repository, and do not include generated benchmark artifacts in PRs.

The benchmark answers three questions after every change:

- Did the run become more correct?
- Did the run become more customer-ready?
- Did the run stay within governance, cost, and runtime limits?

## 2. Benchmark Dataset Registry

### Dataset `T7l7m8T8501lxLZZFQrwJC`

Current status: active baseline dataset.

Inputs:

- Figma mask: `https://www.figma.com/design/T7l7m8T8501lxLZZFQrwJC/TestForSimpleComponent?node-id=1-11309`
- Jira/custom context: `/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/Jira-Story.md`
- Customer evaluation rubric: `/Users/oscharko-dev/Projects/workspace-dev/fixtures/test-intelligence/customer-evals/Testfall-eines-Anwendungstests.md`
- Output base: `/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC`

Known source facts:

- The mask is about calculating `Finanzierungsbedarf des Investitionsobjekts`.
- The UI and Jira story state that VAT is not part of the financing need.
- The visible example shows `45.000,00 + 5.000,00 = 50.000,00 EUR`, without VAT being added.
- The Jira story explicitly says calculation details and validation rules still need clarification.
- The customer rubric requires title, description, sequential test steps, one test action per step, expected result per step, and positive plus negative use cases.

Known risk traps for this dataset:

- Do not add VAT into financing need when the source says VAT is excluded.
- Do not invent exact validation messages or hard limits when validation rules are not specified.
- Do not invent IBAN, BIC, contract number, submit button, four-eyes approval, audit trail, or account-number behavior.
- Do not treat decorative labels or technical Figma nodes as business test targets.
- Cover both `Netto` and `Brutto` contexts, or explicitly mark missing behavior as an open question.

## 3. Official Benchmark Command

Run from repo root:

```bash
cd /Users/oscharko-dev/Projects/workspace-dev && \
set -a && source /Users/oscharko-dev/Projects/workspace-dev/.env && set +a && \
FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 \
WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED=1 \
pnpm exec tsx src/cli.ts test-intelligence run \
  --figma-url "https://www.figma.com/design/T7l7m8T8501lxLZZFQrwJC/TestForSimpleComponent?node-id=1-11309" \
  --custom-context-markdown "/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/Jira-Story.md" \
  --customer-eval-markdown "/Users/oscharko-dev/Projects/workspace-dev/fixtures/test-intelligence/customer-evals/Testfall-eines-Anwendungstests.md" \
  --output "/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC" \
  --ict-register-ref "workspace-dev-local-test-intelligence" \
  --enable-visual-sidecar \
  --allow-policy-blocked
```

The command creates a timestamped run folder under:

```text
/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/<timestamp>
```

## 4. Benchmark Run Discipline

### 4.1 Before each benchmark run

Record:

- Git branch
- Git commit SHA
- Linked PR or issue IDs
- What change is being benchmarked
- Whether `.env` model deployments were changed
- Date/time
- Operator

Command:

```bash
cd /Users/oscharko-dev/Projects/workspace-dev
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Rules:

- Do not compare runs across different `.env` model topology unless the topology change itself is the benchmark subject.
- Do not compare a run with visual sidecar disabled against a run with visual sidecar enabled.
- Do not manually edit generated artifacts before scoring.
- Keep each benchmark run in its own timestamp folder.

### 4.2 Minimum repetition policy

For fast local development:

- Run once after each small change.
- Score the run against hard gates and targeted metrics.

For a meaningful before/after claim:

- Run the candidate three times.
- Use the median score.
- Report variance for non-deterministic values such as generated case count, `needsReviewCount`, runtime, token usage, and visual-sidecar outcome.

For a PR-ready quality claim:

- Candidate median must beat baseline.
- No hard gate may fail.
- No P0 or P1 metric may regress.

## 5. Artifact Checklist

Every valid benchmark run must contain:

- `generated-testcases.json`
- `customer-markdown/testfaelle.md`
- `policy-report.json`
- `validation-report.json`
- `coverage-report.json`
- `finops/budget-report.json`
- `business-intent-ir.json`
- `coverage-plan.json`
- `visual-captures/manifest.json`
- `visual-captures/*.png`
- `visual-sidecar-result.json`
- `wave1-validation-evidence-manifest.json`

Missing required artifacts are a benchmark failure unless the tested change intentionally removes or renames an artifact and the benchmark protocol is updated accordingly.

## 6. Automated Metric Extraction

Set the run folder:

```bash
RUN_DIR="/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/<timestamp>"
```

Extract core metrics:

```bash
jq '{
  totalTestCases,
  blocked,
  approvedCount,
  needsReviewCount,
  blockedCount,
  jobLevelViolations
}' "$RUN_DIR/policy-report.json"

jq '{
  errorCount,
  warningCount,
  findingCount: (.findings // [] | length)
}' "$RUN_DIR/validation-report.json"

jq '{
  fieldCoverage,
  actionCoverage,
  traceCoverage
}' "$RUN_DIR/coverage-report.json"

jq '{
  outcome: .result.outcome,
  failureClass: .result.failureClass,
  failureMessage: .result.failureMessage,
  attempts: .result.attempts,
  captureIdentities: .result.captureIdentities
}' "$RUN_DIR/visual-sidecar-result.json"

jq '{
  totals,
  generator: .bySource.generator,
  judge: .bySource.judge_primary,
  visualPrimary: .bySource.visual_primary,
  visualFallback: .bySource.visual_fallback,
  breaches
}' "$RUN_DIR/finops/budget-report.json"
```

Detect high-risk text patterns:

```bash
rg -n \
  "IBAN|BIC|Kontonummer|account number|Vertragsnummer|contract number|Vier-Augen|four-eyes|Audit|Submit|Kunden-IBAN|Ungültige Kontonummer" \
  "$RUN_DIR/customer-markdown" \
  "$RUN_DIR/generated-testcases.json" || true
```

Detect the known VAT calculation trap:

```bash
rg -n \
  "1\\.380,00|1380|1000 \\+ 19%|MwSt\\..*Teil|VAT.*part|not part of the financing need" \
  "$RUN_DIR/customer-markdown/testfaelle.md" \
  "$RUN_DIR/generated-testcases.json" || true
```

Detect invented validation specifics:

```bash
rg -n \
  "Ungültiges Zahlenformat|Betrag überschreitet|muss größer|must be greater|invalid number format|exceeds allowed" \
  "$RUN_DIR/customer-markdown/testfaelle.md" \
  "$RUN_DIR/generated-testcases.json" || true
```

Check customer Markdown order:

```bash
rg -n "^## TC[0-9]+" "$RUN_DIR/customer-markdown/testfaelle.md"
```

## 7. Hard Gates

A candidate run fails the benchmark immediately if any hard gate fails.

| Gate | Condition | Why |
| --- | --- | --- |
| `G1_EXIT_ZERO` | CLI exits with code `0` | Benchmark must complete. |
| `G2_ARTIFACT_COMPLETE` | Required artifacts exist | No partial runs. |
| `G3_POLICY_NOT_BLOCKED` | `policy-report.blocked=false` | Blocked output is not acceptance-ready. |
| `G4_VALIDATION_CLEAN` | `validation-report.errorCount=0` | Output must satisfy formal validation. |
| `G5_NO_DOMAIN_CONTRADICTION` | No generated test contradicts source facts | Prevents customer-facing false requirements. |
| `G6_NO_UNSUPPORTED_CRITICAL_HALLUCINATION` | No IBAN/BIC/Submit/Four-Eyes/etc. unless present in source | Prevents severe hallucinations. |
| `G7_NO_FINOPS_BREACH` | `finops.breaches=[]` | Keeps optimization economically safe. |

For the current dataset, `G5_NO_DOMAIN_CONTRADICTION` specifically means:

- VAT must not be added to financing need when the source says VAT is excluded.
- If the calculation formula is not fully specified, the output must use `openQuestions` instead of a concrete unsupported result.

## 8. Scorecard

Use this scorecard after hard gates. Maximum score: 100 points.

### 8.1 Domain Faithfulness - 30 points

| Metric | Points |
| --- | ---: |
| Financing calculation respects VAT exclusion or marks formula as open question | 12 |
| No invented exact validation messages or thresholds when source says unspecified | 6 |
| Generated tests reflect all explicit source facts from Figma/Jira/customer rubric | 6 |
| Assumptions and `openQuestions` are used correctly for underspecified behavior | 4 |
| No source contradiction in expected results | 2 |

### 8.2 Semantic Coverage - 20 points

| Metric | Points |
| --- | ---: |
| Covers purchase price amount field | 2 |
| Covers VAT select field | 2 |
| Covers optional additional-cost field | 2 |
| Covers financing-need result display | 3 |
| Covers VAT exclusion hint | 2 |
| Covers both `Netto` and `Brutto` contexts, or flags missing behavior as open question | 4 |
| Includes meaningful positive and negative cases | 3 |
| Avoids atomic tests for decorative labels | 2 |

### 8.3 Traceability and Coverage Metrics - 15 points

| Metric | Points |
| --- | ---: |
| `fieldCoverage.ratio >= 0.60` for this dataset | 4 |
| `traceCoverage.ratio = 1.0` | 3 |
| Important end-to-end and accessibility cases have concrete node references where possible | 3 |
| No hallucinated trace IDs or raw Figma IDs in customer-facing titles | 3 |
| Coverage report uses semantically meaningful targets, not raw decorative nodes | 2 |

### 8.4 Policy, Governance, and Evidence - 15 points

| Metric | Points |
| --- | ---: |
| `policy-report.blocked=false` | 3 |
| `needsReviewCount` is justified and not caused by unrelated job-level warning contamination | 3 |
| Visual-sidecar result is successful or failure is isolated and actionable | 3 |
| FinOps records all model attempts including failed visual attempts | 2 |
| Evidence manifest is complete and internally consistent | 2 |
| No FinOps breaches | 2 |

### 8.5 Customer Output Quality - 15 points

| Metric | Points |
| --- | ---: |
| Markdown follows customer rubric: title, description, sequential steps, expected result per step | 4 |
| Test cases are sorted and easy to review | 2 |
| Customer output avoids unnecessary technical IDs by default | 2 |
| Open questions and assumptions are visible enough for customer review | 3 |
| Language is consistent, professional, and German customer-facing | 2 |
| Customer output contains a useful summary or AC coverage view | 2 |

### 8.6 Runtime Stability - 5 points

| Metric | Points |
| --- | ---: |
| No schema-invalid generation attempt | 2 |
| Judge final state is unambiguous | 1 |
| Runtime remains within current baseline + 30% unless justified | 1 |
| Token usage remains within current baseline + 30% unless justified | 1 |

## 9. Current Baseline B0

Baseline run:

```text
/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/2026-05-07T06-11-39-900Z
```

Measured values:

| Metric | B0 value |
| --- | --- |
| Test cases | 8 |
| Policy blocked | `false` |
| Approved count | 0 |
| Needs review count | 8 |
| Blocked count | 0 |
| Validation errors | 0 |
| Validation warnings | 0 |
| Field coverage | 3 / 7 = 0.428571 |
| Action coverage | 0 / 0 |
| Trace coverage | 8 / 8 = 1.0 |
| Visual sidecar | failure: `both_sidecars_failed` |
| Visual primary failure | `llama-4-maverick-vision`: bounded `timeout` or `protocol` diagnostic |
| Visual fallback failure | `phi-4-multimodal-instruct`: bounded `schema_invalid_response`, `timeout`, or `protocol` diagnostic |
| Generator attempts | 2 |
| Generator failures | 1 |
| Input tokens | 10,419 |
| Output tokens | 5,554 |
| Runtime | 43,575 ms |
| FinOps breaches | 0 |

Known B0 defects:

- P0: Financing-need calculation adds VAT despite source saying VAT is excluded.
- P0: Unspecified validation rules are materialized as exact error messages and thresholds.
- P1: Visual sidecar fails and causes all cases to be `needs_review`.
- P1: Semantic coverage misses `Brutto`, result display, purchase-price question, and some central acceptance criteria.
- P1: FinOps does not count failed visual attempts consistently.
- P2: Customer Markdown ordering starts with `TC04`, then `TC02`, then `TC08`, then `TC01`.
- P2: Logic judge and consensus artifacts are ambiguous after repair.

B0 benchmark verdict:

```text
Hard-gate status: FAIL because G5_NO_DOMAIN_CONTRADICTION fails.
Acceptance status: not customer-acceptance-ready.
Use as baseline for improvement comparison only.
```

Do not treat B0 as acceptable target quality. B0 is the negative baseline we are trying to beat.

## 10. Candidate Comparison Rules

For every optimization, compare candidate `Cn` against baseline `B0` and, once available, the previous best candidate `Cbest`.

### Success

A change is successful if:

- All hard gates pass.
- The targeted issue metric improves.
- Total score improves by at least 5 points or the targeted P0/P1 defect is eliminated.
- No P0 metric regresses.
- No P1 metric regresses by more than one severity level.
- Runtime and token usage stay within +30% unless the quality gain is explicitly worth the cost.

### Regression

A change is a regression if:

- Any hard gate fails that previously passed.
- Domain faithfulness decreases.
- Unsupported hallucinations increase.
- `policy.blocked` becomes `true`.
- `validation.errorCount` becomes greater than `0`.
- `needsReviewCount` increases for reasons unrelated to the targeted change.
- FinOps breaches appear.
- Runtime or token usage increases by more than 30% without documented quality gain.

### Neutral

A change is neutral if:

- Hard gates are unchanged.
- Total score changes by less than 2 points.
- Targeted metric does not improve.
- No meaningful risk reduction is visible.

Neutral changes should not be merged as quality improvements unless they are preparatory refactors with their own engineering justification.

## 11. Scorecard Template

Copy this template into a local file for each candidate run:

```markdown
# TI Benchmark Scorecard

Dataset: T7l7m8T8501lxLZZFQrwJC
Candidate: C<nr>
Run folder:
Git SHA:
Branch:
Compared against: B0 / Cbest
Operator:
Date:
Optimization under test:

## Hard gates

- G1_EXIT_ZERO:
- G2_ARTIFACT_COMPLETE:
- G3_POLICY_NOT_BLOCKED:
- G4_VALIDATION_CLEAN:
- G5_NO_DOMAIN_CONTRADICTION:
- G6_NO_UNSUPPORTED_CRITICAL_HALLUCINATION:
- G7_NO_FINOPS_BREACH:

Hard-gate verdict:

## Automated metrics

- Test cases:
- Policy blocked:
- Approved / needs review / blocked:
- Validation errors / warnings:
- Field coverage:
- Action coverage:
- Trace coverage:
- Visual sidecar outcome:
- FinOps breaches:
- Runtime:
- Input/output tokens:
- Generator attempts/failures:
- Judge status:

## Manual score

- Domain Faithfulness /30:
- Semantic Coverage /20:
- Traceability and Coverage Metrics /15:
- Policy, Governance, and Evidence /15:
- Customer Output Quality /15:
- Runtime Stability /5:

Total /100:

## Findings

P0:
P1:
P2:
P3:

## Decision

Verdict: success / regression / neutral / invalid
Reason:
Next action:
```

## 12. Recommended Local Directory Layout

Use this local layout:

```text
sandbox/benchmarks/test-intelligence/
  LOCAL_BENCHMARK_PROTOCOL.md
  scorecards/
    B0-2026-05-07T06-11-39-900Z.md
    C1-<timestamp>.md
    C2-<timestamp>.md
  comparisons/
    C1-vs-B0.md
    C2-vs-C1.md
```

Do not commit these files.

## 13. Dataset Expansion Rules

When adding the next dataset, add a new entry to this protocol with:

- Stable dataset ID
- Figma source
- Jira/custom context source
- Customer rubric source
- Known source facts
- Known risk traps
- Required hard gates
- Dataset-specific scorecard additions
- Baseline run folder

The first expansion should prioritize:

- A calculation-heavy mask with explicit formula.
- A mask with intentionally ambiguous validation rules.
- A mask with multiple user actions and navigation.
- A mask with regulated data fields, but only if those fields are actually present in the source.

## 14. Current Optimization Targets Mapped to Issues

Use the benchmark after each issue-level fix:

- `#1986`: Domain faithfulness for financing-need calculations.
- `#1987`: Unresolved requirements and invented validation details.
- `#1988`: Semantic IR and coverage planning.
- `#1989`: Visual-sidecar execution and failure isolation.
- `#1990`: FinOps, evidence, and export-state consistency.
- `#1991`: Customer Markdown export polish.
- `#1992`: Judge and harness convergence reporting.

Each issue should include a before/after benchmark result in the implementation PR description.
