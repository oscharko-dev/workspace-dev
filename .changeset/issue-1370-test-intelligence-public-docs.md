---
"workspace-dev": patch
---

Add public, professional documentation for the Figma-to-QC Test Case Intelligence subsurface (Issue #1370).

- New operator guide at `docs/test-intelligence.md` covering enablement, dual-gate fail-closed behavior, job type and mode namespace, artifact tree, review flow, export-only flow, OpenText ALM dry-run flow, evidence manifest verification, multimodal visual sidecar role separation, network boundary, secret handling, DORA / GDPR / EU AI Act positioning, and gateway operator responsibilities for the structured-test-case generator (`gpt-oss-120b`).
- Extend `COMPLIANCE.md` with a DORA control-mapping row for the subsurface plus a dedicated section on GDPR controls, EU AI Act considerations, and gateway operator responsibilities.
- Extend `ZERO_TELEMETRY.md` with the optional outbound paths to operator-controlled gateway endpoints and the live-smoke gate.
- Extend `THREAT_MODEL.md` with a trust-boundary row and an attack-surface entry for the subsurface.
- Surface the subsurface in `README.md` for package consumers.
- Record the documentation surface decision as ADR `docs/decisions/2026-04-25-issue-1370-test-intelligence-public-docs.md`.

No public contract surface changes; `CONTRACT_VERSION` is not bumped.
