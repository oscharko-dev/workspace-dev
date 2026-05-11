# Execution-Evidence Loop (`ti execution-pull`)

> **Issue #2186** — Close the loop from generated test cases back into
> the calibration corpus. When the customer's QA team executes a test
> in their TMS (Xray / ALM / qTest / Polarion), that pass / fail /
> blocked / re-tested signal is pulled by the harness, verified
> against the customer's TMS-admin signing key, and persisted as
> labelled evidence the next quarterly judge-calibration refit (W7-3)
> picks up automatically.

## Why

Today every accepted test case is treated as **presumed correct** —
the harness has no awareness of whether the test actually passed in
production. That is leaving the strongest available calibration
signal on the table:

- A test the harness generated last week that **passed in production**
  is a strong positive sample for the per-class ECE refit.
- A test that **failed in production AND was reverted by the reviewer**
  is a strong negative sample, AND a candidate adversarial case
  (#2122).
- A case where the **reviewer approved** the test but the **execution
  failed** (or vice versa) is a high-value inter-rater κ disagreement
  the human-review queue (W6-5) should escalate.

Wave 8's W8-1 already pushes test cases to the TMS. W8-4 adds the
return path so production execution outcomes feed back into the
self-improving calibration loop instead of being lost.

## Flow Diagram

```
+---------------------------+        +-----------------------------+
| harness generates cases   |        | customer's TMS              |
| (figma_to_qc_test_cases)  |        | (Xray / ALM / qTest /       |
+-------------+-------------+        |  Polarion)                  |
              |                      +--------------+--------------+
              | W8-1 push                          ^
              v                                    |
+---------------------------+                      |
| TMS push pipeline         |                      |
| (W8-1, runTmsPushPipeline)|                      |
+-------------+-------------+                      |
              |                                    |
              | tms-push-report.json               |
              v                                    |
+---------------------------+                      |
| customer QA executes the  |                      |
| test in their TMS         +----------------------+
+-------------+-------------+
              |
              | TMS plugin / webhook signs each row with the
              | tenant's TMS-admin Ed25519 key
              v
+---------------------------+
| ti execution-pull         |
| --tms ... --since ...     |
+-------------+-------------+
              |
              | TmsAdapter.pullExecutions(since)
              v
+---------------------------+
| ingestExecutionEvidence   |  G12_EXECUTION_EVIDENCE_SIGNED
| (canonical-JSON, Ed25519, |  hard gate: any unsigned/tampered
|  per-tenant isolation)    |  row is dropped + reported.
+-------------+-------------+
              |
              v
+--------------------------------------------------+
| <tenantDir>/calibration-corpus/                  |
|   execution-evidence/<yyyy-MM>/<sha256>.json     |  (per-evidence)
|   execution-evidence-report.json                 |  (per-pull report)
+--------------------------------------------------+
              |
              +------> W7-3 quarterly Platt refit (auto-pickup)
              +------> W6-1 audit-dossier (executionEvidenceLoop section)
              +------> W6-5 human-review queue (conflict surfacing)
              +------> #2122 adversarial corpus (failure-promotion job)
```

## Customer's TMS-Admin Signing-Key Setup

Each customer registers **one** Ed25519 keypair per TMS tenant. The
public half lives on the harness side; the private half lives inside
the customer's TMS plugin / webhook signer and never leaves their
infrastructure.

### 1. Generate the keypair (customer side, one-time)

```bash
# Private key (kept inside the customer's TMS plugin secret store).
openssl genpkey -algorithm Ed25519 -out tms-admin.ed25519.private.pem

# Public key (handed to the harness operator).
openssl pkey -in tms-admin.ed25519.private.pem -pubout \
  -out tms-admin.ed25519.public.pem
```

### 2. Register the public key with the harness

Drop the public PEM under the tenant directory laid down by
`test-intelligence onboard`:

```bash
cp tms-admin.ed25519.public.pem \
   <output-root>/tenants/<tenant-id>/signing-keys/tms-admin.ed25519.public.pem
chmod 0644 <output-root>/tenants/<tenant-id>/signing-keys/tms-admin.ed25519.public.pem
```

The CLI auto-discovers the key at this path. To use a key from a
different location pass `--verifying-key <path>` explicitly.

### 3. Sign each evidence row inside the TMS plugin

The signed payload is the canonical JSON of the evidence body with
**sorted keys** and **without** `attestationSignatureHex`:

```jsonc
{
  "executedAt": "2026-05-10T14:32:11.000Z",
  "executionVerdict": "fail",
  "reviewerRationale": "regression in v3.4 on the IBAN field",
  "reviewerVerdict": "rejected",
  "tenantId": "acme-bank",
  "testCaseId": "TC-LOGIN-0007",
  "tmsAdapterId": "xray",
  "tmsCaseId": "JIRA-1234"
}
```

Compute `attestationSignatureHex = hex(Ed25519_sign(privateKey, canonical_json))`.

Optional fields (`reviewerVerdict`, `reviewerRationale`) are
**omitted** from the body when not present — the canonicaliser does
not emit `null` placeholders.

### 4. Pull the evidence

```bash
pnpm exec tsx src/cli.ts test-intelligence execution-pull \
  --tms xray \
  --project ACME \
  --since 2026-04-01T00:00:00Z \
  --tenant acme-bank \
  --output-root ./onboarded
```

Re-runs against the same `--since` are safe — the persisted
filename is `<sha256(body)>.json`, so duplicates collapse onto the
same on-disk record.

## Hard Gates

### `G12_EXECUTION_EVIDENCE_SIGNED`

Every evidence row must verify against the configured TMS-admin
public key. The default ingest is **soft**: rows that fail
verification are dropped with a `signature_invalid` entry on the
per-pull report. Adding `--strict-signature` promotes the gate to a
hard CI failure (exit 2) so an automated cron job can refuse to
proceed silently when the customer's TMS plugin has rotated the
signing key without re-registering it.

### Tenant isolation (W6-2)

The CLI refuses to ingest a row whose `tenantId` does not match
the `--tenant` argument (`tenant_mismatch` rejection). When the
caller is running inside a `withTenantScope` block, an
`ExecutionEvidenceTenantMismatchError` is raised through the
isolation guard — the harness aborts the run rather than silently
landing one tenant's bytes in another tenant's directory.

## Conflict Resolution

Reviewer / execution conflicts are **never resolved silently**. The
ingest module records two conflict classes on the per-pull report:

| Code                                  | When                                         | What downstream does                        |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `execution_fail_reviewer_approved`    | TMS says fail, reviewer says approved        | Item raised for human re-review (W6-5).     |
| `execution_pass_reviewer_rejected`    | TMS says pass, reviewer says rejected        | Item raised for human re-review (W6-5).     |

The audit-dossier surfaces the conflict counts in the
`executionEvidenceLoop` section so a regulator can see the
inter-rater disagreement rate at a glance.

## Storage Layout

```
<output-root>/tenants/<tenant-id>/
  calibration-corpus/
    execution-evidence/
      2026-04/
        a1b2c3...json
        d4e5f6...json
      2026-05/
        9988aa...json
    execution-evidence-report.json     # per-pull, atomic re-write
  signing-keys/
    tms-admin.ed25519.public.pem       # operator-supplied
```

Per-evidence file shape (`<sha256>.json`):

```jsonc
{
  "schemaVersion": "1.0.0",
  "ingestedAt": "2026-05-11T03:14:00.000Z",
  "signingKeyFingerprintSha256": "<sha256 of SPKI DER (base64)>",
  "evidence": {
    "testCaseId": "TC-LOGIN-0007",
    "tenantId": "acme-bank",
    "tmsAdapterId": "xray",
    "tmsCaseId": "JIRA-1234",
    "executionVerdict": "fail",
    "reviewerVerdict": "rejected",
    "reviewerRationale": "regression in v3.4 on the IBAN field",
    "executedAt": "2026-05-10T14:32:11.000Z",
    "attestationSignatureHex": "<128 lowercase hex chars>"
  }
}
```

Per-pull report shape (`execution-evidence-report.json`): see the
`ExecutionEvidenceReport` type exported from
`src/test-intelligence/test-execution-evidence-ingest.ts`.

## Downstream Consumers

| Consumer                              | What it reads                                                    |
| ------------------------------------- | ---------------------------------------------------------------- |
| Self-improving calibration (W7-3)     | `execution-evidence/*.json` — pass rows become positive samples, |
|                                       | reviewer-approved fails become negative samples for the next     |
|                                       | quarterly Platt refit.                                           |
| Audit-dossier (W6-1)                  | `executionEvidenceLoop` section, populated when                  |
|                                       | `executionEvidenceCorpusDir` is passed to `generateAuditDossier`.|
| Human-review queue (W6-5)             | `report.conflicts[]` — operators re-review the disputed cases.   |
| Adversarial corpus expansion (#2122)  | `fail` rows promoted by a reviewer become candidate adversarial  |
|                                       | inputs for the next benchmark cycle.                             |

## Out-of-Scope (Wave 9 candidates)

- Auto-regenerate failed tests (needs human approval — separate ticket).
- Cross-tenant aggregation of execution stats (single-tenant only).
- Push direction (already covered by W8-1).

## See Also

- `src/test-intelligence/test-execution-evidence-ingest.ts` — module.
- `src/test-intelligence-execution-pull-cli.ts` — CLI surface.
- `src/test-intelligence/tms-adapters/tms-adapter-contract.ts` —
  `pullExecutions` adapter method definition.
- `docs/test-intelligence/multi-tenant-isolation.md` — W6-2 background.
- `docs/test-intelligence/self-improving-calibration.md` — W7-3 refit
  loop the evidence feeds.
- `docs/test-intelligence/onboarding.md` — tenant directory layout
  the CLI presupposes.
