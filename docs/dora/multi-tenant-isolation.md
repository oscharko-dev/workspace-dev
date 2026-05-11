# Multi-Tenant Isolation — DORA Mapping (Issue #2130)

The test-intelligence harness ships two complementary tenant-isolation
artifacts. This document describes how each maps onto the
[**Digital Operational Resilience Act (DORA, EU 2022/2554)**](https://eur-lex.europa.eu/eli/reg/2022/2554/oj)
articles a regulator inspects during a TIBER-EU or supervisory review
of a financial-entity ICT service.

| Artifact                                  | Issue   | Cadence            | Scope                                                                 |
| ----------------------------------------- | ------- | ------------------ | --------------------------------------------------------------------- |
| `tenant-isolation-attestation.json`       | #2176   | per-run            | Empirical: certifies *this run* observed no cross-tenant read.        |
| `tenant-isolation-proof.json`             | #2130   | build-time         | Structural: certifies *no run can ever* observe a cross-tenant read.  |
| `tenant-isolation-pentest.json`           | #2130   | build-time         | Adversarial: empty cross-tenant leakage evidence from a live driver.  |

The runtime attestation answers *"did this specific run leak?"*. The
proof artifact answers *"can any run leak under the current code?"*.
The pentest evidence answers *"does an attacker driving the loader
across tenants observe any leak today?"*. A regulator typically asks
the third question first; the harness can answer all three without
re-running the production pipeline.

## Mapped DORA articles

### Article 9 — ICT risk management framework

> *"Financial entities shall set up, maintain and review a sound,
> comprehensive and well-documented ICT risk management framework."*

| Sub-requirement                                                      | Evidence                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Art. 9(2): identification and classification of ICT-related risks    | `tenant-isolation-proof.json` enumerates the *cache-key construction* and *storage namespace* surfaces that carry tenant-segregation responsibility. |
| Art. 9(3)(a): segregation and management of ICT systems              | The proof's `storageNamespace.pathTemplate` pins the partitioning algorithm — auditor can re-derive every tenant's on-disk path without source access. |
| Art. 9(3)(b): protection from intrusion and data abuse               | `sideChannelAnalysis` covers timing, eviction-order, and error-disclosure surfaces; each entry cites the source symbol implementing the mitigation. |
| Art. 9(3)(d): minimisation of the impact of ICT risk                 | The runtime guard (`TenantIsolationViolation`) aborts the harness on a mismatched read; the proof guarantees the *structural* impossibility of such a mismatch under the documented layout. |
| Art. 9(4): identifying and locating relevant information assets      | `tenantCommitments[]` provides a sha256 identifier per tenant scope; the regulator can pin a tenant in a TIBER-EU red-team scope without naming PII. |

### Article 28 — General principles (ICT third-party risk)

> *"Financial entities shall manage ICT third-party risk as an integral
> component of ICT risk … and shall maintain a register of information."*

| Sub-requirement                                                      | Evidence                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Art. 28(1): risk management of ICT services from third-party providers | The proof artifact gives a downstream financial entity an *inspectable* claim it can include in its own third-party-risk register, without taking the harness's word for the partitioning property. |
| Art. 28(3): contractual provisions on availability, integrity, confidentiality | `tenant-isolation-proof.json` is a contract-grade artifact: the `proofSha256` field anchors a digest the financial entity can include in the procurement contract; subsequent harness releases must produce a byte-identical artifact (or land an ADR) to satisfy the same contract. |
| Art. 28(4): exit-strategy and termination                            | The proof artifact survives offline review; an exiting tenant can extract their own `tenant-isolation-attestation.json` runs alongside the proof and verify their data never crossed into a co-tenant's subtree. |

## Threat model

| Threat                                                              | Mitigation                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Misconfigured operator routes tenant A → tenant B's directory       | Construction-time scope validation (`resolveTenantScopeSegments`) + ALS guard (`assertTenantScope`). |
| Cache-key digest accidentally collides across tenants               | Pre-image distinctness theorem: tenant scope is *not* in the digest pre-image; isolation is structural in the path. |
| Adversary observes tenant B's writes through LRU eviction on tenant A | `evictLru(scopeDir, byteBudget)` enumerates only the active scope's subtree — proven in `sideChannelAnalysis[1]`. |
| Adversary times tenant A lookups to infer tenant B's entries        | `lookup` is `readFile(path)`; path is fully determined by `(activeScope, cacheKey)` before any I/O — proven in `sideChannelAnalysis[0]`. |
| Error messages reveal that tenant B has a file at the probed path   | `lookup` collapses ENOENT into `{ hit: false }` and never returns the on-disk path — proven in `sideChannelAnalysis[2]`. |
| Path-traversal injection via crafted tenant-scope segments          | Constructor-level `RangeError` on `''`, `'.'`, `'..'`, separators, NUL bytes — exercised in `tenant-isolation-pentest.json` ("path-traversal-rejection" scenarios). |
| Regression silently re-folds tenant identity into the cache-key digest | Mechanical assertion in `replay-cache.adversarial.test.ts:472` + the structural claim in `tenant-isolation-proof.json:cacheKeyConstruction.tenantIndependent`. |

## CI gate (`G12_TENANT_ISOLATION_PROOF_PASS`)

`scripts/check-tenant-isolation-proof.mjs` regenerates the proof from
the current source and asserts byte-equality against the committed
`fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json`. The gate runs on every PR to
`dev` as part of `pr-quality-gate.yml`. Any change to:

- `src/test-intelligence/replay-cache.ts` (cache-key construction)
- `src/test-intelligence/replay-cache-persistent.ts` (storage layout)
- `src/test-intelligence/tenant-isolation-proof.ts` (proof shape itself)

that affects the proof bytes will fail this gate until the operator
runs `pnpm run generate:tenant-isolation-proof` *and* lands an ADR
review for the change — the ADR is the human gate on top of the
mechanical gate, ensuring no proof bytes change without auditor
visibility. See [`docs/adr/2130-cross-tenant-isolation-proof-artifact.md`](../adr/2130-cross-tenant-isolation-proof-artifact.md).

## Regenerating the artifacts

```sh
# Structural proof (committed under fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json)
pnpm run generate:tenant-isolation-proof

# Pentest evidence (committed under fixtures/test-intelligence/tenant-isolation/tenant-isolation-pentest.json)
pnpm run test:ti-tenant-isolation-pentest
```

Both commands are deterministic; identical source produces byte-identical
artifacts. The CI gate enforces this.

## Reading the proof artifact

The artifact is a single JSON object with the following top-level
fields. A regulator can validate the property entirely from this file
without touching the codebase:

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "1970-01-01T00:00:00.000Z",     // fixed: structural claim, not per-run
  "claim": "For any two tenant scopes S₁ ≠ S₂ …", // plain-English statement
  "cacheKeyConstruction": {
    "algorithm": "sha256",
    "encoding": "hex",
    "preImageFields": [                          // tenant scope is NOT in this list
      "ReplayCacheKey.inputHash",
      "ReplayCacheKey.promptHash",
      "ReplayCacheKey.schemaHash"
    ],
    "tenantIndependent": true,
    "sourceReference": "src/test-intelligence/replay-cache.ts → computeReplayCacheKeyDigest"
  },
  "storageNamespace": {
    "pathTemplate": "<rootDir>/<tenantId>/<environmentId>/<projectId>/<digest>.json",
    "segments": ["tenantId", "environmentId", "projectId", "digest"],
    "segmentValidation": [                        // path-component invariants
      "reject empty string",
      "reject '.' and '..' traversal tokens",
      "reject path separators ('/' and '\\\\')",
      "reject NUL byte",
      "normalise missing projectId to literal 'default'"
    ],
    "sourceReference": "src/test-intelligence/replay-cache-persistent.ts → createPersistentReplayCache (uses resolveTenantScopeSegments)"
  },
  "tenantCommitments": [ /* sha256 per scope */ ],
  "preImageDistinctnessWitnesses": [
    {
      "cacheKeyLabel": "fixture-key-alpha",
      "cacheKeyDigest": "0123…",
      "tenantA": { "tenantScope": { … }, "storagePath": "<rootDir>/tenant-a/…" },
      "tenantB": { "tenantScope": { … }, "storagePath": "<rootDir>/tenant-b/…" },
      "differingSegmentIndex": 0                  // tenantA and tenantB differ at index 0 (tenantId)
    },
    // … one witness per distinct (tenant-pair, cache-key) combination
  ],
  "sideChannelAnalysis": [
    { "channel": "timing",          "threat": "…", "mitigation": "…", "sourceReference": "…" },
    { "channel": "eviction-order",  "threat": "…", "mitigation": "…", "sourceReference": "…" },
    { "channel": "error-disclosure","threat": "…", "mitigation": "…", "sourceReference": "…" }
  ],
  "proofSha256": "<sha256 over canonical scope+commitments+witnesses>",
  "methodology": { "disclaimer": "Constructive proof artifact. …" }
}
```

### What the proof does **not** claim

- **Network-layer isolation.** The proof covers on-disk segregation
  inside one harness process. Network ACLs, KMS-key separation, and
  per-tenant TLS termination are deployment concerns, tracked
  separately under W6-3 (region).
- **Per-tenant resource quotas.** The proof does not bound how much
  CPU/RAM tenant A can consume while tenant B is observing the
  harness. FinOps tenant-budget enforcement is a separate issue.
- **Cryptographic per-artifact tenant attestation.** The proof gives
  a *path-level* claim. Per-artifact signing under per-tenant Ed25519
  keys is covered by W6-3 ("region"); the two are complementary.
- **HMAC primitive.** The proof explicitly records that the cache-key
  digest is `sha256(canonicalJson({inputHash,promptHash,schemaHash}))`,
  not `HMAC(tenantKey, …)`. Isolation lives in the directory layout.
  The classical HMAC framing is recorded as a `tenantCommitments[].commitmentSha256`
  identifier so a reviewer who expects "an HMAC key per tenant" can
  pin one without changing the underlying scheme.

## Cross-references

- Per-run runtime attestation: [`docs/test-intelligence/multi-tenant-isolation.md`](../test-intelligence/multi-tenant-isolation.md) (Issue #2176)
- Adversarial test fixture: `src/test-intelligence/replay-cache.adversarial.test.ts`
- Proof generator: `scripts/generate-tenant-isolation-proof.mjs`
- Pentest driver: `scripts/run-tenant-isolation-pentest.mjs`
- CI gate: `scripts/check-tenant-isolation-proof.mjs` (G12)
- ADR: [`docs/adr/2130-cross-tenant-isolation-proof-artifact.md`](../adr/2130-cross-tenant-isolation-proof-artifact.md)
