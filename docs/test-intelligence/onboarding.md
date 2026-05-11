# Self-Service Customer Onboarding (`ti onboard`)

> **Issue #2185** — A bank's operator runs **one command** and ends up
> with a fully-provisioned tenant directory: tenant bundle, calibration
> corpus slot, three signing keys, an ICT register entry, and an audit
> trail. No operator hand-holding required.

## Why

Tier-1 onboarding used to take ≈ 4 hours of operator-led work per tenant:

1. Hand-create the tenant id and policy profile.
2. Hand-allocate the calibration corpus directory.
3. Hand-generate audit-dossier (W6-1), region-attestation (W6-3), and
   reviewer (W6-5) signing keys, then record their fingerprints.
4. Hand-author the DORA Art. 28 ICT register entry.
5. Hand-run a smoke test.

That is the gating operational scalability bottleneck above ≈ 5 tenants.
This subcommand collapses the whole flow to one CLI call so the customer
operates self-service.

## 5-Minute Walkthrough

```bash
# 1. Provision the tenant (~5 seconds).
pnpm exec tsx src/cli.ts test-intelligence onboard \
  --tenant-id acme-bank \
  --legal-name "Acme Bank AG" \
  --policy-profile eu-banking-default \
  --output-root ./onboarded

# 2. Sanity-check what landed on disk.
pnpm exec tsx src/cli.ts test-intelligence onboard --doctor \
  --tenant-id acme-bank --output-root ./onboarded

# 3. Smoke-test against a small mask using the freshly-provisioned bundle.
pnpm exec tsx src/cli.ts test-intelligence run \
  --tenant-bundle ./onboarded/tenants/acme-bank/tenant-bundle.json \
  --figma-json-file ./fixtures/example-mask.json \
  --output ./out \
  --model-endpoint <…> --model-api-key <…> --mode deterministic_llm
```

The first command prints **public-key fingerprints** for the three
signing keys to stdout. **Record them** — the harness never reprints
the private keys. The operator owns key custody from the moment the
keys land on disk.

## What `onboard` lays down

```
<output-root>/tenants/<tenant-id>/
  tenant-bundle.json                   # minimal valid bundle (W8-2)
  calibration-corpus/                  # empty, ready to grow
  signing-keys/
    audit-dossier.ed25519.private.pem        # W6-1, mode 0600
    audit-dossier.ed25519.public.pem
    region-attestation.hmac.key              # W6-3, hex secret, mode 0600
    reviewer-signing.ed25519.private.pem     # W6-5, mode 0600
    reviewer-signing.ed25519.public.pem
    fingerprints.json                        # public summary
  ict-register.json                    # DORA Art. 28 register entry
  onboarding-evidence.json             # audit trail of the onboard flow
```

Every artifact embeds the **tenant scope** (`{tenantId, environmentId,
projectId?}`) so a wrong-tenant read is detectable. The doctor
subcommand re-asserts the scope on each artifact (Issue #2176, W6-2).

## CLI flags

```text
workspace-dev test-intelligence onboard \
  --tenant-id <id>          # ^[a-z0-9][a-z0-9_-]{0,63}$
  --legal-name <name>       # ≤ 256 chars, no control characters
  --policy-profile <id>     # known registry id (eu-banking-default)
  --output-root <dir>       # root under which tenants/<id>/ is created
  [--force]                 # overwrite an existing tenant directory
  [--environment-id <id>]   # default: prod
  [--project-id <id>]       # optional tenant-scope project id
  [--jurisdiction <code>]   # ISO-3166 (default: EU)
  [--effective-date <iso>]  # ISO-8601 (default: today, UTC)
```

**Refusal mode**: an existing `<output-root>/tenants/<tenant-id>/`
directory aborts with exit 1 unless `--force` is passed. `--force`
deletes the previous directory before re-provisioning.

## Doctor mode

```text
workspace-dev test-intelligence onboard --doctor \
  --tenant-id <id> --output-root <dir> \
  [--environment-id <id>] [--project-id <id>]
```

Doctor is the operator's safety net before every production run. It
verifies:

| Check                              | What it asserts                                                          |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `tenant-directory`                 | The tenant directory exists.                                             |
| `calibration-corpus`               | The calibration-corpus subdirectory is accessible.                       |
| `tenant-bundle`                    | The bundle JSON parses through the W8-2 validator and matches the id.   |
| `ict-register-tenant-scope`        | The ICT register's `tenantScope` matches the expected scope (W6-2).      |
| `ict-register-fingerprints`        | All three signing-key fingerprints are present.                          |
| `onboarding-evidence-tenant-scope` | The evidence carries the same scope.                                     |
| `<key>-private-key`                | Each `*.private.pem` parses as Ed25519 and the SHA-256 SPKI fingerprint matches the ICT register. |
| `<key>-public-key`                 | Each `*.public.pem` parses and matches.                                  |
| `region-attestation-key`           | The HMAC secret is hex with ≥ 32 chars and SHA-256 matches the register. |
| `orphaned-files`                   | No unexpected entries inside the tenant directory.                       |

Exit codes:

- `0` — every check passed.
- `1` — operator/config error (missing flag, invalid input).
- `2` — one or more checks failed.

## ICT register (DORA Art. 28)

`ict-register.json` is a self-contained register entry. The fields a
DORA Art. 28 audit cares about are:

```json
{
  "schemaVersion": "1.0.0",
  "regulation": "DORA-Art-28",
  "tenantId": "acme-bank",
  "tenantScope": { "tenantId": "acme-bank", "environmentId": "prod" },
  "legalEntity": { "legalName": "Acme Bank AG", "jurisdiction": "EU" },
  "ictArrangement": {
    "providerName": "workspace-dev",
    "serviceDescription": "Test-intelligence harness…",
    "criticality": "important"
  },
  "policyProfileId": "eu-banking-default",
  "effectiveDate": "2026-05-11",
  "registeredAtUtc": "2026-05-11T08:00:00.000Z",
  "signingKeyFingerprints": {
    "auditDossierEd25519Sha256": "…",
    "regionAttestationHmacSha256": "…",
    "reviewerSigningEd25519Sha256": "…"
  }
}
```

The fingerprints in this register are what an external auditor pins.
**The doctor cross-checks them** against the on-disk keys, so a
silently-rotated key fails closed before the next production run.

## Multi-tenant isolation

Every onboarded artifact carries the tenant scope:

- `tenant-bundle.json` — `tenantId` from W8-2 validation.
- `ict-register.json` — `tenantScope` envelope.
- `onboarding-evidence.json` — `tenantScope` envelope.
- `signing-keys/fingerprints.json` — `tenantScope` envelope.

Doctor refuses an artifact whose embedded `tenantId` differs from the
expected scope. This is the W6-2 invariant: cross-tenant access is
catastrophic and aborts the run rather than silently returning the
wrong customer's bytes.

## Key custody

- Key generation is **strictly local**. The harness uses
  `crypto.generateKeyPairSync("ed25519")` and `crypto.randomBytes(32)`.
  No KMS / HSM call. (HSM integration is a Wave-8 follow-on, see W8-5.)
- Private keys are written with file mode `0600`.
- The harness never reprints the private keys after onboarding. The
  operator is responsible for backing them up before the first
  production run.
- Region-attestation uses HMAC-SHA-256; the secret is wired into the
  production runner via the
  `WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY` env var.
  Onboarding emits the secret to disk; the operator copies it into the
  runtime env.

## Out-of-scope (intentionally)

- Web UI for onboarding (CLI-first; UI is a Wave-9 candidate).
- HSM / cloud KMS integration for keys (filesystem keys first; HSM is a
  sovereign-cloud-profile follow-on, see W8-5).
- Automatic Jira / TMS account provisioning (the operator brings their
  own TMS credentials — see `docs/test-intelligence/tms-adapters/`).
- Cross-tenant sharing of any artifact (multi-tenant isolation
  enforced).

## References

- Parent: epic #2167 — Test-Intelligence Tier-1 Production Roadmap (Wave 8)
- Predecessors:
  - W8-2 [tenant bundles](./tenant-bundles.md)
  - W6-2 [multi-tenant isolation](./multi-tenant-isolation.md)
  - W6-1 [audit dossier](./audit-dossier.md)
  - W6-3 region attestation (`src/test-intelligence/region-attestation.ts`)
  - W6-5 reviewer-signing (`src/test-intelligence-review-cli.ts`)
