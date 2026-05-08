---
"workspace-dev": minor
---

Add a property-based test layer with a domain-invariant registry for Issue #2040.

- New `src/test-intelligence/domain-invariant-registry` module exposes the typed DSL (`DomainInvariant` with `{ id, scope, forall, holds, severity, source }`) plus `createInvariantRegistry`, `buildActiveDatasetInvariantRegistry`, `registerActiveDatasetInvariants`, `evaluateInvariants`, and `computeInvariantCoverageRatio`.
- New `src/test-intelligence/property-sampler` module derives deterministic seed test data from the registry via `fast-check` (`sampleInvariantSeeds`, `findInvariantsMissingSamplerFactory`).
- The active-dataset registry ships four invariants — `INV-VAT-01` (VAT exclusion), `INV-NETTO-BRUTTO-01` (brutto/netto exclusivity), `INV-OPTIONAL-COST-01` (optional-cost-field semantics), `INV-FINANCING-NEED-01` (financing-need formula bounds).
- Validation pipeline runs the registry by default; matched cases that fail an invariant produce `domain_invariant_violation` issues and block the run when severity is `error`. Set `invariantRegistry: null` on the pipeline input to opt out.
- `coverage-report.json` gains optional additive `invariantCoverage` (`total / exercised / ratio / registeredIds / exercisedIds`) and `invariantAnnotations` (per-case `exercises: ["INV-VAT-01", ...]`) fields.
- Contract version impacts: `CONTRACT_VERSION` 4.53.0 → 4.54.0; `TEST_INTELLIGENCE_CONTRACT_VERSION` 1.14.0 → 1.15.0; both `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION` and `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION` remain `1.0.0`.
- New unit, property-based, and integration tests for the registry, sampler, and pipeline integration; new docs at `docs/test-intelligence/property-based-layer.md` covering the DSL, the active-dataset invariants, and worked banking + insurance examples.
