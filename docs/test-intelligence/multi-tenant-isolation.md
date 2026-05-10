# Multi-Tenant Isolation — Runtime Enforcement

Issue [#2176](../../) (Wave 6, Tier-1 Production Roadmap) adds **runtime**
enforcement of tenant isolation across every shared cache, persistent
store, and calibration corpus the test-intelligence harness reads from.

The advisory hash-keyed scoping that predates this issue partitioned
on-disk paths but did not crash on cross-tenant access. Banks demand
proof that tenant A's data never touches tenant B's index, replay
cache, calibration corpus, or model-card cache. This document describes
the threat model, the runtime guarantee, and the test methodology that
backs the guarantee.

## Threat model

| Threat                                                      | Mitigation                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Misconfigured operator routes tenant A → tenant B's bucket  | `assertTenantScope` crashes on the first mismatched read             |
| Regression silently mixes scopes mid-flow                   | Nested `withTenantScope` with a different scope throws eagerly       |
| Manually edited cache file with wrong `tenantId` metadata   | `recordTenantIdRead` re-validates against the active ALS scope       |
| Operator can not prove the run was scope-confined           | `tenant-isolation-attestation.json` is byte-stable, hashed, signed   |
| Provenance graph does not pin the attestation               | `provenance.jsonld` carries `ti:tenantIsolationAttestationSha256`    |

Out of scope (separately tracked):

- Formal-proof artifact of isolation: deferred Phase 4 / [#2130](../../).
- Per-tenant resource quotas: FinOps tenant-budget layer, future issue.
- Network-layer isolation: cloud-config concern, not a harness concern.
- Cryptographic per-artifact tenant attestation: covered by W6-3 (region).

## Runtime guarantee

The harness opens an `AsyncLocalStorage` boundary at the top of
`runFigmaToQcTestCases` (the only production-runner entry point) bound
to `input.replayCacheTenantScope ?? DEFAULT_TENANT_SCOPE`. Every nested
async call inherits the active scope without re-passing `tenantId`.

Persistent-store reads in the test-intelligence module pass through
one of three guard helpers exported by `tenant-isolation-guard.ts`:

| Guard                              | Used by                                                                 | Behavior                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `recordPersistentStoreRead`        | `replay-cache-persistent.ts` (lookup, store)                            | Asserts the cache's construction-time `TenantScope` equals the active ALS scope. Records the read.             |
| `recordTenantIdRead`               | `coverage-baseline-drift.ts`, `distribution-shift-detector.ts`          | Asserts the input's `tenantId` equals the active scope's `tenantId`. Records the read.                         |
| `recordActiveTenantRead`           | `agent-lessons-memdir.ts`, `lessons-consolidation-lock.ts`              | Records the read against the active scope. Crash-on-mismatch comes from the runDir partitioning by ALS itself. |

A mismatch raises `TenantIsolationViolation`. The harness must **not**
catch this error. Aborting the run is the only defensible posture — a
recoverable mismatch implies the operator's tenant routing is broken
and any further read could leak bytes from one customer to another.

When called outside an active `withTenantScope` block (single-tenant
unit tests, offline benchmarks), the guards are no-ops. Existing
single-tenant test fixtures continue to pass without modification.

## Audit evidence

Every run emits `tenant-isolation-attestation.json` next to
`provenance.jsonld`. The attestation is byte-stable for the same
logical run; identical inputs produce identical bytes.

```jsonc
{
  "schemaVersion": "1.0.0",
  "jobId": "job-abcd1234",
  "generatedAt": "2026-05-10T00:00:00Z",
  "tenantScope": {
    "tenantId": "bank-acme",
    "environmentId": "prod",
    "projectId": "default"
  },
  "persistentStoreReads": [
    { "operation": "replay-cache.lookup", "scope": { ... }, "sequence": 0 },
    { "operation": "replay-cache.store", "scope": { ... }, "sequence": 1 },
    { "operation": "coverage-baseline.load", "scope": { ... }, "sequence": 2 }
  ],
  "readCount": 3,
  "attestationSha256": "<sha-256 over canonical scope+reads>",
  "certification":
    "no cross-tenant persistent-store read occurred during this run"
}
```

`provenance.jsonld` carries:

- `ti:tenantIsolationAttestationSha256` — pinned digest of the artifact.
- `ti:tenantScope` — the active scope at run time.
- A `prov:Entity` artifact node for `tenant-isolation-attestation.json`.

A downstream verifier reconstructs the chain by:

1. Reading `provenance.jsonld` → `ti:tenantIsolationAttestationSha256`.
2. SHA-256 of the on-disk `tenant-isolation-attestation.json` bytes.
3. Comparing the two digests; refusing the run if they differ.

The attestation builder re-asserts internally that every recorded
read's `scope.tenantId` equals the run's active `tenantScope.tenantId`
before stamping the digest. A run that already saw a cross-tenant read
cannot emit an attestation — the builder throws `TenantIsolationViolation`.

## Test methodology

`src/test-intelligence/tenant-isolation-guard.test.ts` covers:

- **Constants snapshot.** Schema version, artifact filename, certification
  string are pinned per the Issue #2176 contract.
- **Catastrophic crash on mismatch.** Every axis of `TenantScope`
  (`tenantId`, `environmentId`, `projectId`) raises
  `TenantIsolationViolation` when actual ≠ expected.
- **Property-based coverage.** Cartesian product over a small alphabet
  of `(tenantId, environmentId, projectId)` triples asserts every pair
  where actual ≠ expected throws, and every equal pair does not.
- **Concurrent scopes do not cross-contaminate.** Two parallel
  `withTenantScope` blocks each see only their own recorded reads.
- **Nested same-scope is a no-op.** Calling `withTenantScope` again with
  the same scope inherits the outer context.
- **Nested different-scope throws eagerly.** Crossing scopes mid-flow
  is the bug class this guard exists to catch; it crashes before any I/O.
- **Attestation is byte-stable.** Same scope + same read sequence →
  same canonical JSON, same SHA-256.
- **Attestation refuses cross-scope reads.** A read whose
  `scope.tenantId` ≠ run-level `tenantScope.tenantId` cannot be
  serialised — the builder throws `TenantIsolationViolation`.
- **Read sequence is normalized.** Out-of-order recorded sequences are
  re-numbered `0..N-1` on serialisation so the attestation hash is
  invariant under recorder ordering.

Existing test files for the integrated stores
(`replay-cache-persistent.test.ts`, `coverage-baseline-drift.test.ts`,
`distribution-shift-detector.test.ts`, `agent-lessons-memdir.test.ts`,
`lessons-consolidation-lock.test.ts`) continue to pass — they exercise
the no-op-outside-scope branch.

## Failure mode

A `TenantIsolationViolation` is **catastrophic**. Do not retry.

The error surface is:

- `name === "TenantIsolationViolation"`
- `code === "TENANT_ISOLATION_VIOLATION"` (machine-readable)
- `operation` (string) — the persistent-store operation that triggered the crash
- `expected` (`TenantScope`) — the scope the bytes belong to
- `actual` (`TenantScope`) — the scope the call was made under

The harness must abort the run, page the operator, and isolate the
misconfigured tenant before any subsequent run.

## References

- Parent epic: [#2167](../../) — Test-Intelligence Tier-1 Production Roadmap (Wave 6)
- Predecessors: [#2098](../../), [#2130](../../) (formal proof — deferred Phase 4)
- Standards: DORA Art. 28 (ICT third-party risk), EU AI Act Art. 14
  (human oversight), GDPR Art. 32 (security of processing)
- Sources of truth:
  - `src/test-intelligence/tenant-isolation-guard.ts`
  - `src/test-intelligence/tenant-isolation-guard.test.ts`
  - `src/test-intelligence/replay-cache-persistent.ts`
  - `src/test-intelligence/coverage-baseline-drift.ts`
  - `src/test-intelligence/distribution-shift-detector.ts`
  - `src/test-intelligence/agent-lessons-memdir.ts`
  - `src/test-intelligence/lessons-consolidation-lock.ts`
  - `src/test-intelligence/production-runner.ts`
  - `src/test-intelligence/provenance-graph.ts`
