---
"workspace-dev": minor
---

Add human-oversight review queue + decision-capture surface for Issue #2179.

- New `src/test-intelligence/human-review-queue.ts` module with
  enqueue / fetch / record-verdict / SLA tracking / replay-determinism
  helpers. Verdicts carry detached ed25519 signatures over the
  canonical-JSON serialisation of the verdict body and are verified
  before persistence.
- New CLI subcommands `workspace-dev test-intelligence review
  list|get|decide` for operator-side queue inspection and signed
  verdict capture.
- New framework-agnostic HTTP route handlers under
  `src/test-intelligence/human-review-http-routes.ts`
  (`GET /api/human-review/queue`, `GET /api/human-review/items/:id`,
  `POST /api/human-review/decisions`).
- New minimal React UI mounted at `/workspace/ui/human-review`.
- Audit-dossier (Issue #2175) now bundles `human-review-log.json` when
  present and exposes new EU AI Act Art. 14 + DSGVO Art. 22 regulator-
  coverage rows that reference the per-run human-oversight evidence.
- New documentation page `docs/test-intelligence/human-oversight.md`
  covering the legal basis (DSGVO Art. 22, EU AI Act Art. 14, DORA
  Art. 28) and the operational flow.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.28.0` → `1.29.0`;
  `CONTRACT_VERSION` bumped `4.63.0` → `4.64.0`. All changes are
  additive — no existing field, type, or command was removed or
  renamed.
