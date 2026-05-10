# Human-oversight review queue (Issue #2179)

## Why this exists

Banking-test generation is **automated decision-making with significant
legal effect** under DSGVO Art. 22, because the generated test cases
become the basis for production-release decisions. EU AI Act Art. 14
requires that a competent human can intervene, override, or audit each
AI-driven decision before it produces such an effect.

Until Issue #2179 the harness only **flagged** disagreements (Issue
#2038): the `human_review` agent role was registered, escalation hooks
existed, and the per-case `needs_review` decision surfaced in
`policy-report.json`, but there was no operator-facing surface that
accepted a verdict or persisted the human decision back into the run
record. This document describes the surface that closes that gap.

## Legal basis

| Regulation         | Article | What this surface satisfies                                                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| **DSGVO**          | Art. 22 | Right not to be subject to a decision based solely on automated processing — a human reviewer must be reachable per case. |
| **EU AI Act**      | Art. 14 | Human-oversight requirement: a human can intervene, override, or audit each AI-driven decision before it has effect.       |
| **DORA**           | Art. 28 | Escalation evidence is captured per run as a tamper-evident log bundled into the audit-dossier.                            |

## Operational flow

```
┌──────────────┐    enqueue            ┌────────────────────┐
│ harness run  │ ────────────────────▶ │ <root>/<tenant>/   │
│ (judges      │  HumanReviewQueueItem │   queue/<id>.json  │
│  disagree)   │                       └────────────────────┘
└──────────────┘                                │
        ▲                                       │ ti review list
        │                                       │ ti review get <id>
        │                                       ▼
        │                              ┌────────────────────┐
        │       persist + sig-verify   │ reviewer (CLI / UI)│
        │ ◀──────────────────────────  │ ti review decide   │
        │       HumanReviewVerdict     │ ─ rationale        │
        │                              │ ─ ed25519 signature│
        │                              └────────────────────┘
        │                                       │
        │                                       ▼
        │                              ┌────────────────────┐
        │     replay reads verdict     │ <root>/<tenant>/   │
        └────────────────────────────  │   verdicts/<id>    │
                                       │   runs/<run>.log   │
                                       └────────────────────┘
                                                │
                                                │ bundled into
                                                ▼
                                       ┌────────────────────┐
                                       │ audit-dossier      │
                                       │ (Issue #2175)      │
                                       └────────────────────┘
```

### 1. Enqueue (harness side)

When the cross-family judge panel disagrees above threshold (Issue
#2038), the harness builds a `HumanReviewQueueItem` and writes it to
`<root>/<tenantId>/queue/<itemId>.json`. The `itemId` is derived
deterministically from `(tenantId, runId, testCaseId)` so re-runs of
the same logical case land on the same id and any pre-existing verdict
is reused (replay determinism).

### 2. List + inspect (reviewer side)

```bash
workspace-dev test-intelligence review list \
  --tenant acme [--profile default] [--sla-due-by 2026-05-11T09:00:00Z]
```

Emits a canonical-JSON `{ items: [...] }` array of pending queue items
for the named tenant. Filters are applied server-side; the surface
never crosses tenant boundaries (Issue #2176).

```bash
workspace-dev test-intelligence review get <itemId> --tenant acme
```

Emits the full `HumanReviewQueueItem` JSON for one case so the reviewer
can inspect the judge-disagreement context offline.

### 3. Decide (reviewer side)

```bash
workspace-dev test-intelligence review decide <itemId> \
  --tenant acme \
  --verdict approved \
  --rationale rationale.md \
  --sign-key reviewer.pem \
  --decided-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The CLI:

1. Loads the queue item from disk.
2. Reads the rationale Markdown file (length-capped, no LF/CR/U+2028/U+2029).
3. Loads the reviewer's ed25519 private key (PEM or JWK).
4. Builds a canonical-JSON verdict body (every field except
   `signatureHex`).
5. Signs the canonical bytes with the reviewer's key.
6. Hands the signed verdict to the queue store, which **re-verifies the
   signature** before persisting it to
   `<root>/<tenantId>/verdicts/<itemId>.json`. A bad signature throws
   and writes nothing.

For a revised verdict pass `--verdict revised --revised-tc tc.json`;
the JSON object is stored verbatim and is consumed by the production
runner on replay.

### 4. Persist (queue side)

Decisions are persisted into three on-disk locations:

- **`run-quality.json`** — the case decision references the verdict
  via the queue item id.
- **`provenance.jsonld`** — a PROV `wasInformedBy` link from the
  human-review verdict to the original judge-disagreement artifact.
- **`<runDir>/human-review-log.json`** — per-run audit trail listing
  every queue item, every recorded verdict, and every SLA breach.

The audit-dossier bundle (Issue #2175) automatically picks up the
log when present and extends the EU AI Act Art. 14 + DSGVO Art. 22
regulator-coverage rows to reference it.

## Reviewer key material

Reviewers use **ed25519** detached signatures. The same key shape is
already accepted by the audit-dossier signing path (Issue #2175). Keys
may be supplied as PEM or JWK.

The reviewer's stable identifier is **never persisted in the clear**.
The queue stores `reviewerPrincipalHash`, the sha256 of the principal
id, mirroring the convention in `human-review-agent.ts` (Issue #2038).
The principal id is derived from the `--reviewer-principal` flag; if
omitted, the CLI uses a stable hash of the key path so dry runs stay
deterministic.

## SLA tracking

Every `HumanReviewQueueItem` carries `slaDeadlineAt`. Items past their
deadline that have **no recorded verdict** are surfaced by
`findHumanReviewSlaBreaches(rootDir, tenantId, nowIso)`.

When a follow-up run consumes the breach list, it emits a
`policy:human-review-sla-breach` warning per breached item. Operators
can grep policy reports for this rule to identify reviewers / tenants
that are missing SLAs.

## HTTP surface

The framework-agnostic route handlers live in
[`src/test-intelligence/human-review-http-routes.ts`](../../src/test-intelligence/human-review-http-routes.ts).
They expose three endpoints suitable for embedding in an Express,
Fastify, or sovereign-cloud air-gap server:

| Method | Path                                    | Purpose                                |
| ------ | --------------------------------------- | -------------------------------------- |
| GET    | `/api/human-review/queue?tenant=…`      | List pending items, optional filters   |
| GET    | `/api/human-review/items/:id?tenant=…`  | Fetch one item                         |
| POST   | `/api/human-review/decisions`           | Persist a signed verdict (body = JSON) |

Authorisation is the host's responsibility — these handlers rely on
the cryptographic signature for reviewer-identity proof and on the
calling router for transport authentication / authorisation gating.

## Minimal UI

A read-only-friendly React surface lives at
`/workspace/ui/human-review` (see
[`ui-src/src/features/human-review/human-review-page.tsx`](../../ui-src/src/features/human-review/human-review-page.tsx)).
The UI **does not handle private keys** — reviewers sign verdicts off-
line via the CLI and paste the resulting JSON into the UI for
persistence. This keeps the queue air-gap-deployable and avoids
shipping reviewer keys through any browser context.

## Replay determinism

`loadHumanReviewVerdictsForRun(rootDir, tenantId, runId)` returns the
persisted verdicts for a given run id. The production runner consumes
this on replay to short-circuit any case that already carries a human
decision: no LLM re-prompt, no re-judging, byte-identical output.

## Out of scope (Wave-7+)

- Slack / Teams / Jira queue notifications.
- Reviewer training / qualification tracking.
- Multi-reviewer collaboration on a single item (single reviewer per
  item shipped first; multi-reviewer is a Wave-8 extension).
- Auto-approval ML model that learns reviewer patterns (would require
  Issue #2132 self-improving loop infrastructure).
