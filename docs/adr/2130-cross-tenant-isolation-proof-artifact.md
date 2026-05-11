# ADR 2130: Cross-Tenant Isolation Formal Proof Artifact

- Status: Accepted
- Date: 2026-05-11
- Deciders: CTO delegate via Issue #2130 autonomous implementation

## Context

Issue [#2176](../../) added a *runtime* tenant-isolation guard
(`AsyncLocalStorage` + `assertTenantScope`) and persisted a per-run
`tenant-isolation-attestation.json` certifying that *that specific run*
observed no cross-tenant persistent-store read. The attestation is
empirical: it records *what happened* during one harness execution.

Regulators inspecting a DORA-scoped ICT service ask a structurally
stronger question: *"can any run, under the current cache-key
construction and storage layout, leak bytes across tenants?"* That
property cannot be answered by a per-run trace. It requires an
inspectable, source-derived artifact that pins:

1. the cache-key digest algorithm and its pre-image fields,
2. the on-disk storage layout the loader uses,
3. the segment-validation rules that make tenant-scope segments
   literal path components, and
4. side-channel analysis covering timing, eviction-order, and
   error-disclosure.

The runtime attestation cannot replace this artifact: it is downstream
of the structural property and would silently start emitting `pass`
even if a regression re-folded tenant identity into the digest, as
long as the operator did not happen to cross tenants in *that* run.

## Decision

Add `src/test-intelligence/tenant-isolation-proof.ts` and persist a
deterministic `fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json` artifact that
encodes the four properties above as machine-readable structure with
plain-English commentary regulator-grade reviewers can read without
source access. The artifact carries a `proofSha256` over its own
canonical-JSON serialisation so a downstream verifier can confirm the
bytes have not been mutated between emission and audit.

Enforce drift via `scripts/check-tenant-isolation-proof.mjs`
(`G12_TENANT_ISOLATION_PROOF_PASS`). The gate regenerates the proof
from the current source and asserts byte-equality against the
committed artifact. Any change to:

- `src/test-intelligence/replay-cache.ts`
- `src/test-intelligence/replay-cache-persistent.ts`
- `src/test-intelligence/tenant-isolation-proof.ts`

that affects the proof bytes will fail the gate until the operator
runs `pnpm run generate:tenant-isolation-proof` and **lands an ADR
review** for the regenerated artifact. The ADR is the human gate on
top of the mechanical gate; a numeric drift without ADR review is
never an acceptable resolution.

Run an empirical adversarial pentest via
`scripts/run-tenant-isolation-pentest.mjs` and persist its result as
`fixtures/test-intelligence/tenant-isolation/tenant-isolation-pentest.json` (verdict `pass` with
`leakCount === 0`). The pentest exercises the replay-cache,
logic-judge, faithfulness-judge, and a11y-judge loaders across two
tenant scopes; path-traversal injection is exercised across all four
cache constructors. The acceptance criterion is a closed-form empty
cross-tenant leakage record.

### What is intentionally **not** done

- **HMAC-based cache key.** The classical "HMAC key per tenant"
  framing would fold tenant identity into the lookup key, defeating
  the digest-invariance property the adversarial test in
  `replay-cache.adversarial.test.ts:472` relies on. The chosen dual —
  tenant-independent digest + path-segment isolation — is structurally
  stronger because `stat(wrong_path)` fails with ENOENT *before* any
  byte read, where an HMAC-based scheme would still touch the wrong
  bytes if directory routing were misconfigured. The proof artifact
  records the trade-off explicitly so a reviewer who expected the
  HMAC framing can verify the equivalent commitment via
  `tenantCommitments[].commitmentSha256`.
- **Network-layer isolation, per-tenant quotas, per-artifact tenant
  signing.** All three are out of scope and tracked separately under
  the W6-3 region work and the FinOps tenant-budget roadmap.
- **Symbolic model-checker.** The pre-image distinctness claim is
  small enough that exhibiting one constructive injection
  (`(tenantScope, cacheKey) → on-disk path`) and bounding the segment
  validation rules suffices. A formal NuSMV proof would be
  disproportionate; the existing `formal-verification.ts` pilot covers
  the cases where state-space search is the right tool.

## Consequences

- One new artifact in source control: `fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json`
  (committed) plus `fixtures/test-intelligence/tenant-isolation/tenant-isolation-pentest.json`.
- One new CI gate (`G12`) wired into `pr-quality-gate.yml`.
- Two new `pnpm` scripts: `generate:tenant-isolation-proof` and
  `test:ti-tenant-isolation-pentest`.
- Any future change to the cache-key construction or storage layout
  requires an ADR amendment (this file) plus a regenerated proof
  artifact. Reviewers can read the ADR + new proof bytes side-by-side
  to confirm the property is preserved under the new layout.
- The runtime attestation (`tenant-isolation-attestation.json`,
  Issue #2176) is unchanged. The two artifacts are complementary: the
  attestation proves "this run did not cross"; the proof proves "no
  run can cross."

## References

- Issue [#2130](../../) — implementation issue (this ADR).
- Issue [#2176](../../) — runtime guard (predecessor).
- DORA Article 9 (ICT risk management framework) and Article 28 (ICT
  third-party risk) — see
  [`docs/dora/multi-tenant-isolation.md`](../dora/multi-tenant-isolation.md).
- Adversarial test fixture: `src/test-intelligence/replay-cache.adversarial.test.ts`.
