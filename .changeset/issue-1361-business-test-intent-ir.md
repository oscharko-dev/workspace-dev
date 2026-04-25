---
"workspace-dev": minor
---

Add Business Test Intent IR derivation and PII redaction for Issue #1361.

- Export `BusinessTestIntentIr` and supporting types (contracts 3.19.0).
- Add pure `deriveBusinessTestIntentIr`, `detectPii`, `redactPii`, and `reconcileSources` helpers under `src/test-intelligence/`.
- Add `businessTestIntentIr` artifact key and `WorkspaceJobArtifacts.businessTestIntentIrFile` for persisting the derived IR.
- Golden fixture + tests cover IBAN, PAN, email, phone, full-name, and Steuer-ID redaction with trace refs.
