# Calibration curves (Issue #2182)

Production per-cell Platt-curve fits for the self-improving judge-calibration
loop. Each `<locale>__<riskClass>.json` file holds the curve currently in
production for a `(SupportedLocale, RegulatedRiskClass)` cell.

## Layout

```
calibration-curves/
├── README.md                                 ← this file
├── <locale>__<riskClass>.json                ← production curve, written only via ratification
└── proposals/
    ├── README.md
    ├── proposal-<locale>-<riskClass>-<digest>.json           ← refit proposal (ratified or open)
    └── proposal-<locale>-<riskClass>-<digest>-rejected.json  ← rollback sidecar (rejected refits only)
```

## Promotion rules (CI guard `G11_CALIBRATION_REFIT_SAFETY`)

A production curve **must** be backed by a ratified proposal in `proposals/` whose
`proposedCurveDigest` matches the production curve's `digest`. The proposal must
carry a valid Ed25519 operator signature. PRs that hand-edit production curves
without a corresponding ratified proposal are rejected by the dev-quality-gate
workflow.

The proposal record is the source of truth for the audit trail: it captures the
held-out ECE, Cohen's κ, per-class ECE breakdown, gate evaluation, and operator
signature. The audit-dossier renderer reads this directory to surface the
per-locale + per-class refit history table.

## Operator workflow

```
# 1. Dry-run a refit. The proposal lands in proposals/ with gateEvaluation
#    populated; nothing is promoted to production.
pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
  --locale DE-DE --risk-class regulated_data \
  --gold-entries path/to/gold.json \
  --proposed-at 2026-05-11T00:00:00.000Z \
  --dry-run

# 2. Operator reviews the proposal record. If gates pass, ratify with the
#    audit-dossier signing key.
pnpm exec tsx src/cli.ts test-intelligence calibration-refit \
  --locale DE-DE --risk-class regulated_data \
  --gold-entries path/to/gold.json \
  --proposed-at 2026-05-11T00:00:00.000Z \
  --sign-key fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json \
  --decided-at 2026-05-11T01:00:00.000Z
```

See `docs/test-intelligence/self-improving-calibration.md` for the full flow
diagram, the rollback worked example, and the operator approval procedure.
