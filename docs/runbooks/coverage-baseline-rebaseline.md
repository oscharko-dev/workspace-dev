# Runbook — Coverage-Baseline Drift Gate & Re-baseline Workflow

**Audience:** Platform operators monitoring the per-tenant runtime
coverage-baseline drift gate (Issue #1950, Wave-4 production hardening).

**Prerequisite:** The parent test-intelligence gate must already be
enabled (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1`). See
`docs/test-intelligence.md` §1 for the full enablement procedure.

---

## 1. Overview

The coverage-baseline drift gate pins a per-tenant, per-archetype,
per-policy-profile coverage-ratio baseline at:

```
<runtime-root>/coverage-baselines/<tenant-id>/<archetype>.json
```

On every job the production runner extracts the four tracked coverage
ratios from the post-pipeline `coverage-report.json`:

- `fieldCoverage`
- `actionCoverage`
- `validationCoverage`
- `navigationCoverage`

Each ratio is compared against the persisted baseline:

- **First run per archetype** seeds the baseline atomically with the
  current ratios; no drift is evaluated. The per-tenant directory and
  the archetype JSON file are created on demand.
- **Subsequent runs** compare ratios. If the absolute drift on **any**
  axis exceeds **10 %**, the policy gate emits a job-level
  `policy:coverage-drift-exceeded` violation at warning severity. The
  decision class is `needs_review` — operator-actionable but **not
  auto-blocking**, so a single bad day cannot brick production.
- **Operator re-baseline** (`--coverage-baseline-update`) replaces the
  pin atomically with the candidate ratios; drift evaluation is skipped
  for that single run.

---

## 2. Identifiers and storage layout

| Segment        | Source                                                                        | Default     |
| -------------- | ----------------------------------------------------------------------------- | ----------- |
| `runtime-root` | `--coverage-baseline-runtime-root` flag                                       | `<output-root>/test-intelligence` |
| `tenant-id`    | `--coverage-baseline-tenant`, falls back to `WORKSPACE_TEST_SPACE_TENANT_ID`  | `default`   |
| `archetype`    | `--coverage-baseline-archetype` (required to opt in)                          | _(disabled)_ |

`tenant-id` and `archetype` must match `[A-Za-z0-9._-]+`. Path-traversal
segments (`..`, `/`, NUL) are rejected at the CLI parser, so a malformed
identifier never reaches the filesystem.

The baseline file is canonical-JSON serialised (sorted keys, single
trailing newline) and persisted via `tempfile + rename`, so a partial
write is impossible.

```jsonc
{
  "archetype": "customer-self-service",
  "generatedAt": "2026-05-06T10:00:00.000Z",
  "policyProfileId": "eu-banking-default",
  "ratios": {
    "actionCoverage": 0.7,
    "fieldCoverage": 0.8,
    "navigationCoverage": 0.5,
    "validationCoverage": 0.6
  },
  "schemaVersion": "1.0.0",
  "tenantId": "tenant-acme"
}
```

---

## 3. Day-to-day check workflow (default)

Pass `--coverage-baseline-archetype <id>` on every production run for the
archetype you want to track. No other flags are required — the gate is
opt-in per archetype.

```sh
workspace-dev test-intelligence run \
  --figma-url "<figma-deep-link>" \
  --policy-profile eu-banking-default \
  --coverage-baseline-archetype customer-self-service \
  --coverage-baseline-tenant tenant-acme \
  --mode deterministic_llm
```

Possible outcomes recorded in the run summary:

| Summary line                                               | Meaning                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `coverage baseline    : seeded (first run; …)`             | No baseline existed; the current ratios are now the pin.                               |
| `coverage baseline    : within tolerance (±10%; …)`        | Drift is inside the ±10 % band on every tracked axis.                                  |
| `coverage baseline    : drift exceeded 10% on [axes] (…)` | At least one axis drifted past 10 %. The persisted policy report has been augmented with the `policy:coverage-drift-exceeded` job-level violation; review tooling will show the case as `needs_review`. |
| `coverage baseline    : updated (…)`                       | `--coverage-baseline-update` was passed; the baseline was atomically rewritten.       |

### What to do when drift is reported

1. **Confirm the drift is intentional.** Inspect the augmented
   `policy-report.json` (`jobLevelViolations[].rule ===
   "policy:coverage-drift-exceeded"`) for the per-axis findings:

   ```sh
   jq '.jobLevelViolations[] | select(.rule == "policy:coverage-drift-exceeded")' \
     <output-root>/jobs/<job-id>/test-intelligence/policy-report.json
   ```

2. **If the drift is unexpected** (regression in pipeline, prompt-template
   downgrade, customer-profile change), open an incident, **do not
   re-baseline**, and treat the run as `needs_review` until the
   underlying drift is reverted.

3. **If the drift is intentional** (deliberate scope expansion, fixture
   refresh, policy profile change), re-baseline locally, document the
   change in your CR note, and move on (see §4).

The gate is a `needs_review` signal — runs are **not blocked**. The
warning-severity violation does not flip `policy.blocked`; downstream
exporters still receive the run unless another gate trips.

---

## 4. Operator-driven re-baseline

When you have confirmed the drift is intentional, run with the same
identifiers plus `--coverage-baseline-update`:

```sh
workspace-dev test-intelligence run \
  --figma-url "<figma-deep-link>" \
  --policy-profile eu-banking-default \
  --coverage-baseline-archetype customer-self-service \
  --coverage-baseline-tenant tenant-acme \
  --coverage-baseline-update \
  --mode deterministic_llm
```

The runner:

1. Executes the full pipeline and persists every artifact.
2. Atomically replaces the baseline pin at
   `<runtime-root>/coverage-baselines/<tenant>/<archetype>.json` with the
   current run's ratios.
3. **Skips drift evaluation** for the update run — the candidate is the
   new baseline by definition.
4. Logs `coverage baseline    : updated (…)` in the run summary.

The next run on the same archetype will compare against the new pin.

`--coverage-baseline-update` requires `--coverage-baseline-archetype`;
the CLI fails with exit code 1 if you forget the archetype id.

---

## 5. Bootstrapping a new archetype

There is no manual seed step. The first run with
`--coverage-baseline-archetype <new-id>` writes the baseline implicitly
and reports `coverage baseline    : seeded (first run; …)`. From the
second run forward, the gate is active.

If you need to bootstrap a baseline from a known-good run that pre-dates
the gate, copy the canonical-JSON file from a successful subsequent run
into the per-tenant directory, or re-run with
`--coverage-baseline-update` after confirming the run is on-target.

---

## 6. Tampering and recovery

The runtime store is a deterministic per-tenant tree. Bytes are sorted,
trailing-newline-terminated, and identity-checked at load time:

- A `tenantId`, `archetype`, `policyProfileId`, or `schemaVersion`
  mismatch between the file body and the requested path raises a hard
  error before any drift comparison is performed.
- An unparseable JSON body raises a hard error and is **not** silently
  treated as "first run".
- An ENOENT (missing file) is the only condition treated as "first
  run" — i.e., a missing baseline is the only path that triggers the
  implicit seed.

If the gate emits an identity error after a deliberate file move
(e.g. the tenant id was renamed), delete the offending baseline and let
the next run re-seed, or rewrite the file in place using a known-good
canonical-JSON dump.

---

## 7. Cross-references

- Implementation: `src/test-intelligence/coverage-baseline-drift.ts`
- Policy-gate wiring: `src/test-intelligence/policy-gate.ts`
  (`coverageBaselineDrift` input → `policy:coverage-drift-exceeded`)
- CLI surface: `src/test-intelligence-run-cli.ts`
  (`--coverage-baseline-*` flag set)
- Allowed policy outcome: `coverage_drift_exceeded` (added to
  `ALLOWED_TEST_CASE_POLICY_OUTCOMES` in `src/contracts/index.ts`)
- Companion fixture-based regression-eval: `regression-eval.ts` and
  `regression-eval.test.ts`
