# ADR: Issue #1370 Test Intelligence Public Documentation Surface

- Status: Accepted
- Date: 2026-04-25
- Issue: #1370

## Context

The Figma-to-QC Test Case Intelligence subsurface (Roadmap Issue #1359) shipped
its full public-contract footprint across `CONTRACT_VERSION` `3.21.0` through
`3.28.0` between 2026-04-24 and 2026-04-25. The contract surface, schema-version
constants, artifact filenames, and exported types are documented in
`CONTRACT_CHANGELOG.md` and reflected in the auto-generated
`docs/api/contracts/README.md`.

Issue #1370 is the documentation deliverable for Wave 2 (Enterprise hardening).
It does not change runtime behavior or the public contract; it produces public,
professional documentation that:

- A developer can use to enable and run the bundled Wave 1 Validation from public
  docs alone.
- A platform or security reviewer can use to evaluate network calls, secret
  handling, artifact retention, and fail-closed behavior.
- A compliance reviewer can use to understand emitted evidence and which
  decisions remain customer-specific.

The audit for Issue #1370 found:

- `README.md` did not surface the test-intelligence subsurface to package
  consumers, so the feature was discoverable only via `CONTRACT_CHANGELOG.md`
  scans.
- `COMPLIANCE.md` listed DORA controls but did not map the test-intelligence
  evidence onto GDPR or EU AI Act considerations.
- `ZERO_TELEMETRY.md` and `THREAT_MODEL.md` did not yet describe the
  subsurface's network boundary or trust boundary.
- `docs/local-runtime.md` documented the role-specific environment variables
  for the live visual sidecar smoke but did not provide a complete
  enable-and-run walkthrough.

Public-facing classification of the subsurface as a high-risk AI system under
the EU AI Act requires customer-specific deployment context (business process,
risk register, residency, retention policy). The package emits the evidence an
operator typically needs to perform that classification themselves but does not
make the classification on the operator's behalf.

## Decision

Treat the test-intelligence subsurface as a stable, optional, opt-in public
feature with its own user-facing operator guide at `docs/test-intelligence.md`,
and extend the existing root-level documents (`README.md`, `COMPLIANCE.md`,
`ZERO_TELEMETRY.md`, `THREAT_MODEL.md`) with cross-references and the minimal
material their existing structure requires.

Do not introduce a new public API surface for Issue #1370. The Wave 1 / Wave 2
feature surface is already tracked in `CONTRACT_CHANGELOG.md` versions `3.21.0`
through `3.28.0`. No `CONTRACT_VERSION` bump is required.

Do not assert customer-specific risk classification. The documentation
describes what evidence the package emits and points the operator at the
classification questions they must answer themselves.

## Documentation Surface Classification

Operator guide for the subsurface:

- `docs/test-intelligence.md` — enablement, run flow, job type and mode
  namespace, artifact tree, review flow, export-only flow, dry-run flow,
  evidence verification, multimodal sidecar, network boundary, secret
  handling, DORA / GDPR / EU AI Act considerations, gateway operator
  responsibilities, public API references.

Cross-references added to existing documents:

- `README.md` — short discoverability section pointing at
  `docs/test-intelligence.md` and `COMPLIANCE.md`.
- `COMPLIANCE.md` — extends the DORA control mapping with a row for the
  test-intelligence subsurface; adds a dedicated section covering GDPR
  controls, EU AI Act considerations, and gateway operator responsibilities.
- `ZERO_TELEMETRY.md` — describes the optional outbound paths to
  operator-controlled gateway endpoints and the live-smoke gate.
- `THREAT_MODEL.md` — adds a trust-boundary row and an attack-surface entry
  for the subsurface.

Not introduced:

- No new public API surface.
- No new contract symbols or schema versions.
- No new ADR for the runtime architecture (the architecture decisions are
  documented in `CONTRACT_CHANGELOG.md` versions `3.21.0` through `3.28.0`).

## Consequences

- The public docs are now sufficient for a developer to enable and run the
  Wave 1 Validation without reading `src/test-intelligence/` source.
- Compliance reviewers have a single entry point to test-intelligence
  evidence and a positioning statement for DORA, GDPR, and EU AI Act.
- Operators are explicitly informed that they own model-revision pinning,
  gateway release governance, retention configuration, and audit metadata.
- Future test-intelligence waves continue to bump `CONTRACT_VERSION` and
  update the relevant pages; the operator guide stays the canonical entry
  point and absorbs new sections as additional adapters or modes ship.
- No `CONTRACT_VERSION` bump is required for this ADR because the public
  contract surface did not change in Issue #1370.
