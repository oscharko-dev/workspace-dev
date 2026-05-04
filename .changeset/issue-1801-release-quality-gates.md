---
"workspace-dev": minor
---

Add four hard CI gates to `release:quality-gates` (Issue #1801).

- `mutationKillRate >= 0.85` aggregated across curated mutation fixtures, with per-fixture breach attribution.
- `promptCacheHitRate >= 0.7` aggregated across repair iterations 2..N, with per-role breach attribution. Roles with zero counted iterations are excluded so a never-repaired role cannot mask a real cache regression.
- Tamper-detection round-trip: every release-job sample must verify Merkle chain, head-of-chain hash, and ML-BOM hash against the evidence manifest. Any failure (or zero samples) fails the gate.
- `cacheBreakRate <= 5%` aggregated globally, with the offending `querySource` attributed for diff-artifact review.

Each gate writes a section of a single canonical-JSON report to `artifacts/release-quality-gates/release-quality-gates.json` (atomic tmp + rename) and the runner exits non-zero on any threshold breach. New runtime constants `RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME`, `RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION`, `RELEASE_QUALITY_GATES_THRESHOLDS`, and `ALLOWED_RELEASE_QUALITY_GATE_IDS` are exported from the package root. `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.6.0` to `1.7.0`; `CONTRACT_VERSION` bumps from `4.40.0` to `4.41.0`.
