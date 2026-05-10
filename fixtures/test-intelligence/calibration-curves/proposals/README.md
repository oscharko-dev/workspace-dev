# Calibration refit proposals (Issue #2182)

This directory holds every refit attempt: ratified, rolled back, and open
proposals. Files are append-only — even rejected proposals stay on disk so
regulators can see every attempt and every decision.

## File naming

| File pattern                                        | Meaning                                               |
| --------------------------------------------------- | ----------------------------------------------------- |
| `proposal-<locale>-<riskClass>-<digest>.json`       | A refit proposal. Carries `ratifiedAt` if promoted.   |
| `proposal-<locale>-<riskClass>-<digest>-rejected.json` | Sidecar emitted when a proposal is rolled back.    |

`<digest>` is the first 16 hex chars of the SHA-256 of the canonical-JSON
proposal body, so identical inputs produce identical filenames (audit replay).

The CI guard `G11_CALIBRATION_REFIT_SAFETY` walks both directories and verifies
that every production curve has at least one matching ratified proposal.
