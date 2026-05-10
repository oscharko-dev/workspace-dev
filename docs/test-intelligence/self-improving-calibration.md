# Self-improving judge-calibration loop (Issue #2182)

> **Status:** Tier-1 production. Implements Wave-7 W7-3.
> **Module:** `src/test-intelligence/self-improving-calibration.ts`.
> **CI guard:** `G11_CALIBRATION_REFIT_SAFETY` (`scripts/check-calibration-refit-safety.mjs`).
> **Standards:** ISO/IEC 23894 (uncertainty quantification), EU AI Act Art. 9
> (post-market monitoring), DSGVO Art. 22 (operator-in-the-loop).

## Why

Today's calibration is **static** — fitted offline, checked in as fixtures,
ECE-monitored at runtime but never refit automatically. Over time:

- New regulations land → rule packs change → calibration drifts.
- New human reviewers join the queue (W6-5) → labelling distribution drifts.
- Customer-facing language norms shift seasonally (e.g. quarterly DACH
  banking-jargon updates).
- Judge-model upgrades (`gpt-oss-120b` → `gpt-oss-130b`) move the judge prior.

`#2103` (drift detection MVP) detects the shift. `#2119` (active learning)
grows the gold set. This issue closes the loop: a **scheduled refit driver**
proposes a new Platt-sigmoid curve per `(SupportedLocale, RegulatedRiskClass)`
cell and a **hard rollback safety mechanism** rejects any refit that
regresses ECE > 0.02 or κ < 0.7 on the held-out gold set.

## Flow diagram

```
                     ┌───────────────────────────────────────┐
                     │  Quarterly cron OR drift-alert (#2103) │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
        ┌──────────────────────────────────────────────────────────┐
        │ proposeCalibrationRefit({ locale, riskClass, … })         │
        │  1. Pull gold-set entries since the last refit            │
        │     (W6-5 human verdicts + accepted runs scoring ≥ 90/100)│
        │  2. Filter to (locale, riskClass) cell                    │
        │  3. Deterministic 80/20 split (sorted by entryId)         │
        │  4. Fit Platt sigmoid on the 80% (lr=0.5, 2000 iters)     │
        │  5. Evaluate held-out ECE, Cohen's κ, per-class ECE       │
        │  6. Run gate evaluation against current production curve  │
        │  7. Persist proposal-<…>.json (atomic temp+rename)        │
        └─────────────────────────────────┬────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────┐
                    │ Operator review (CLI dry-run by default)│
                    │  Reviews `failedGates` and metrics      │
                    └────────────────────┬────────────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
                ▼                        ▼                        ▼
    ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────┐
    │ Gates pass + Op key  │   │ Any gate fails       │   │ --force-rollback│
    │ → ratifyOrRollback   │   │ → automatic rollback  │   │ → operator      │
    │   {signKeyPath}      │   │ (no signing required) │   │   override      │
    │                      │   │                      │   │                │
    │ Writes:              │   │ Writes:              │   │ Writes:        │
    │  • signed proposal   │   │  • proposal record   │   │  • proposal +  │
    │  • production curve  │   │  • -rejected sidecar │   │    -rejected   │
    └──────────────────────┘   └──────────────────────┘   │    sidecar      │
                                                          └────────────────┘
```

## Hard rollback gates

A proposal is **promoted** to production only when **every** gate below passes.
Any single failure forces a rollback that leaves the prior production curve
untouched and writes a `*-rejected.json` sidecar carrying the failure list.

| Gate | Threshold | Source |
| ---- | --------- | ------ |
| Held-out ECE absolute ceiling | `heldOutEce ≤ 0.02` | Issue #2182 §AC |
| Held-out Cohen's κ floor | `heldOutKappa ≥ 0.7` | Issue #2182 §AC |
| Relative ECE regression | `proposedEce ≤ currentEce + 0.005` | Issue #2182 §AC |
| Relative κ regression | `proposedKappa ≥ currentKappa − 0.02` | Issue #2182 §AC |
| Per-class ECE regression | `≤ 0.02` per `RegulatedRiskClass` | Issue #2182 §AC |
| Operator approval | Ed25519 signature whose key is on the audit-dossier allowlist | Issue #2182 §AC |

The `forceRollback` operator override lets reviewers reject a proposal that
passes all automated gates if they spot a qualitative issue (e.g. corpus
contamination, biased sampling). The override path still writes a sidecar
record so regulators see the rationale.

## Storage layout

```
fixtures/test-intelligence/calibration-curves/
├── README.md
├── <locale>__<riskClass>.json                  ← production curve, written only by ratification
└── proposals/
    ├── README.md
    ├── proposal-<locale>-<riskClass>-<digest>.json           ← every refit attempt (open / ratified / rolled-back)
    └── proposal-<locale>-<riskClass>-<digest>-rejected.json  ← rollback sidecar
```

`<digest>` is the first 16 hex chars of the SHA-256 of the canonical-JSON
proposal body, so identical inputs produce identical filenames (audit replay).

## CI guard `G11_CALIBRATION_REFIT_SAFETY`

`scripts/check-calibration-refit-safety.mjs` walks the production curves
directory and asserts that each `<locale>__<riskClass>.json` is backed by a
matching ratified proposal in `proposals/` whose `proposedCurveDigest` equals
the curve's `digest` AND whose Ed25519 signature verifies against the proposal
body. The guard also recomputes each curve's `digest` field, so a hand-edit
that flips an `intercept` or `slope` is caught even when the digest field is
preserved.

PRs that hand-edit production curves without a corresponding ratified proposal
fail with a `G11_CALIBRATION_REFIT_SAFETY` violation listing every offending
file. The guard is wired into both `pr-quality-gate.yml` and
`dev-quality-gate.yml` so the policy holds across every code path that lands
in `dev` or `main`.

## Operator approval procedure

1. **Schedule a dry-run.** Either on the quarterly cron or in response to a
   drift-canary (#2103) alert. Run the CLI with `--dry-run`:

   ```bash
   pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
     --locale DE-DE --risk-class regulated_data \
     --gold-entries path/to/gold-2026-q2.json \
     --proposed-at 2026-05-11T00:00:00.000Z \
     --dry-run
   ```

   The CLI emits a canonical-JSON summary to stdout including the
   `failedGates` list. The proposal record lands in
   `fixtures/test-intelligence/calibration-curves/proposals/`.

2. **Review the proposal.** A reviewer inspects the proposal record, the gate
   evaluation, and the per-class ECE breakdown. Cross-reference the gold-set
   manifest if the regression looks suspicious.

3. **Ratify with the audit-dossier signing key.** Re-run the CLI with
   `--sign-key` pointing at the same Ed25519 PEM/JWK that the audit-dossier
   pipeline (Issue #2179) consumes:

   ```bash
   pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
     --locale DE-DE --risk-class regulated_data \
     --gold-entries path/to/gold-2026-q2.json \
     --proposed-at 2026-05-11T00:00:00.000Z \
     --sign-key fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json \
     --decided-at 2026-05-11T01:00:00.000Z
   ```

   The CLI computes the same proposal (deterministic), then ratifies it: the
   production curve is atomically promoted and the proposal record is updated
   with `ratifiedAt` and a detached Ed25519 signature.

4. **Land the change.** Open a PR. The `G11_CALIBRATION_REFIT_SAFETY` guard
   verifies the new production curve matches the signed proposal and that the
   signature key is on the operator allowlist (when one is configured).

## Worked example: rollback path

A refit lands in production after a quarterly drift alert. The reviewer runs:

```bash
pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
  --locale FR-FR --risk-class high \
  --gold-entries gold-2026-q2.json \
  --proposed-at 2026-05-11T00:00:00.000Z \
  --dry-run
```

The summary shows:

```json
{
  "proposalId": "proposal-FR-FR-high-7c1f…",
  "heldOutEce": 0.041,
  "heldOutKappa": 0.62,
  "perClassHeldOutEce": { "high": 0.041, "regulated_data": 0.018, "financial_transaction": 0.022 },
  "failedGates": [
    "heldOutEce=0.041 exceeds absolute ceiling 0.02",
    "heldOutKappa=0.62 below absolute floor 0.7"
  ]
}
```

Because two hard gates failed, the next CLI invocation skips the signing
requirement and rolls back automatically:

```bash
pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
  --locale FR-FR --risk-class high \
  --gold-entries gold-2026-q2.json \
  --proposed-at 2026-05-11T00:00:00.000Z \
  --decided-at 2026-05-11T01:00:00.000Z \
  --sign-key fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json
```

The CLI writes:

- `proposals/proposal-FR-FR-high-7c1f….json` — the proposal record with
  `rolledBack: true` and the gate-failure list as `rollbackReason`.
- `proposals/proposal-FR-FR-high-7c1f…-rejected.json` — the audit sidecar.

The previous production curve (if any) at
`fixtures/test-intelligence/calibration-curves/FR-FR__high.json` stays
untouched.

## Out of scope

- Online (per-call) calibration adjustment — refits stay batch / scheduled.
- Cross-tenant calibration aggregation — single-tenant only for now.
- Conformal-prediction interval refit — separate Wave-8 candidate, layered on
  this issue's infrastructure.
