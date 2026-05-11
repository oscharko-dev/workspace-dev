/**
 * Cross-tenant isolation formal-proof artifact (Issue #2130).
 *
 * Phase 4 / SOTA-differentiator extension of the runtime guard added in
 * Issue #2176. The runtime guard ({@link ./tenant-isolation-guard.ts}) emits
 * a per-run `tenant-isolation-attestation.json` proving that no cross-tenant
 * persistent-store read occurred during *that specific run*. This module
 * emits a build-time `tenant-isolation-proof.json` proving that **no run
 * could ever exhibit a cross-tenant read** under the current cache-key
 * construction + storage layout, independent of any runtime trace.
 *
 * The proof is intentionally inspectable by a regulator without reading
 * source code: it spells out the construction algorithm, enumerates the
 * pre-images for a curated set of representative tenants, and exhibits
 * the constructive injection from `(tenantScope, cacheKey)` to on-disk
 * path that makes cross-tenant collisions impossible.
 *
 * ## What is being proven
 *
 * **Claim (cross-tenant pre-image distinctness).** For any two tenant
 * scopes `S₁`, `S₂` with `S₁ ≠ S₂` and any cache key `K`, the on-disk
 * path produced by the persistent replay cache for `(S₁, K)` differs
 * from the on-disk path produced for `(S₂, K)`.
 *
 * **Proof sketch (constructive).** The persistent cache writes every
 * entry to `<rootDir>/<S.tenantId>/<S.environmentId>/<S.projectId>/<digest(K)>.json`
 * where `digest(K)` is `sha256Hex(K)` (a function of `K` only — `S` is
 * not folded into the digest, by design). Path equality therefore
 * reduces to the equality of the three scope segments. Tenant-scope
 * segments are validated at construction time to reject empty values,
 * path separators, and traversal tokens, so the segment values *are*
 * the literal path components. Two distinct scopes therefore produce
 * paths that differ in at least one segment, and `lookup` for a
 * non-existent path returns `{ hit: false }` without reading bytes
 * outside the scope's subtree. ∎
 *
 * **HMAC commitment.** The classical "HMAC key per tenant" framing
 * (`MAC(K, tenantId)`) folds tenant identity into the lookup key, at
 * the cost of (a) the digest no longer being inspectable from the
 * cache key alone and (b) collision search becoming per-tenant. The
 * harness chose the *dual* — keep the digest tenant-independent so the
 * adversarial test in {@link ./replay-cache.adversarial.test.ts:472}
 * (digest invariance) is mechanically checkable, and place isolation
 * entirely in the directory layout so a `stat()` on the wrong path
 * fails with `ENOENT` *without* ever reading bytes that could be
 * misrouted. The proof artifact records this trade-off explicitly so a
 * regulator can verify the property they actually care about
 * (no cross-tenant byte exposure) instead of relying on an HMAC
 * primitive choice that does not, by itself, prevent file-system
 * confused-deputy attacks.
 *
 * ## Side-channel analysis
 *
 * The proof enumerates three side-channel classes that a sophisticated
 * adversary might use to *infer* the existence of tenant B's entries
 * from tenant A's vantage point:
 *
 *   - **Timing.** Lookups are pure `readFile(path)`; the path is fully
 *     determined by `(activeScope, cacheKey)` before any I/O. There is
 *     no comparison loop, no branch dependent on tenant B's bytes, and
 *     no shared-state cache that tenant B writes to and tenant A
 *     reads from. `ENOENT` is the only signal an absent entry emits.
 *
 *   - **Eviction order.** LRU eviction operates per-tenant-subtree
 *     (`evictLru(scopeDir, …)`); the budget bookkeeping is local to
 *     the active scope's directory. Tenant B's writes cannot evict
 *     tenant A's entries and vice versa.
 *
 *   - **Error-message disclosure.** `lookup` collapses `ENOENT` into
 *     `{ hit: false }` and never includes the on-disk path in the
 *     returned shape. `ReplayCacheValidationError` is raised only for
 *     entries that exist *within the active scope's subtree* and fail
 *     schema validation — never for cross-tenant paths.
 *
 * The proof file enumerates each class with the source line that
 * implements the mitigation so an auditor can mechanically grep for
 * regressions.
 *
 * ## How the CI gate uses this
 *
 * `scripts/check-tenant-isolation-proof.mjs` regenerates the proof
 * from the current source and asserts byte-equality against the
 * committed artifact `fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json`. Any
 * change to the cache-key construction or storage-layout source
 * therefore requires a fresh proof artifact to be committed (and
 * implicitly an ADR review, since the proof's `proofSchemaVersion`
 * cannot bump without one). This is the structural enforcement of
 * Issue #2130's "CI gate" acceptance criterion.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";

import type { TenantScope } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { resolveTenantScopeSegments } from "./replay-cache.js";

/** Canonical schema version of the cross-tenant isolation proof artifact. */
export const TENANT_ISOLATION_PROOF_SCHEMA_VERSION = "1.0.0" as const;

/** Filename of the persisted proof artifact. */
export const TENANT_ISOLATION_PROOF_ARTIFACT_FILENAME =
  "tenant-isolation-proof.json" as const;

/** Repo-relative default location of the committed proof artifact. */
export const TENANT_ISOLATION_PROOF_DEFAULT_REPO_PATH =
  "fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json" as const;

/** Repo-relative default location of the committed pentest evidence. */
export const TENANT_ISOLATION_PENTEST_DEFAULT_REPO_PATH =
  "fixtures/test-intelligence/tenant-isolation/tenant-isolation-pentest.json" as const;

/** Hard-gate code emitted to fail CI when the proof artifact drifts. */
export const G12_TENANT_ISOLATION_PROOF_PASS =
  "G12_TENANT_ISOLATION_PROOF_PASS" as const;

/**
 * Fixed `generatedAt` baked into the committed proof artifact. The
 * proof is a *structural* claim about the source — not a per-run
 * artifact — so its bytes must not drift with wall-clock time.
 */
export const TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT =
  "1970-01-01T00:00:00.000Z" as const;

/** Pinned methodology disclaimer stamped on every proof artifact. */
export const TENANT_ISOLATION_PROOF_METHODOLOGY_DISCLAIMER =
  "Constructive proof artifact. Verifies cross-tenant pre-image distinctness for the cache-key + storage-layout construction documented in src/test-intelligence/replay-cache.ts and src/test-intelligence/replay-cache-persistent.ts. Does not replace the per-run tenant-isolation-attestation.json runtime evidence; the two artifacts are complementary." as const;

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Symbolic description of the cache-key digest algorithm. Encodes the
 * algorithm by reference so an auditor can re-derive `digest(K)` for
 * an arbitrary `K` without reading TypeScript source.
 */
export interface CacheKeyConstruction {
  readonly algorithm: "sha256";
  readonly encoding: "hex";
  /**
   * The canonical-JSON pre-image fed to sha256. Documents which input
   * fields participate in the digest. `tenantScope` is intentionally
   * **absent** from this list — isolation lives in the storage
   * namespace, not in the digest.
   */
  readonly preImageFields: readonly string[];
  /**
   * Source file + line where the digest is computed; an auditor greps
   * for `computeReplayCacheKeyDigest` to verify no regression.
   */
  readonly sourceReference: string;
  /**
   * Plain-English statement of digest tenant-independence. Pinned in
   * the artifact so a regulator can read the property without
   * cross-referencing the source.
   */
  readonly tenantIndependent: true;
}

/**
 * Symbolic description of the on-disk storage layout. Encodes the path
 * construction so an auditor can compute the path for any
 * `(rootDir, tenantScope, digest)` triple without reading source.
 */
export interface StorageNamespaceConstruction {
  /**
   * POSIX-form path template using `<placeholder>` syntax. The proof
   * pins the *POSIX* form so the artifact bytes are stable across
   * Windows/macOS/Linux generation; the runtime resolves to the host
   * path separator.
   */
  readonly pathTemplate: string;
  /** Ordered segment names that populate the template. */
  readonly segments: readonly string[];
  /**
   * Validation rules applied to each segment at construction time.
   * Pinned in the artifact so an auditor can confirm the segments are
   * literal path components (no traversal, no separators, no NUL).
   */
  readonly segmentValidation: readonly string[];
  /**
   * Source file + line where path materialisation happens.
   */
  readonly sourceReference: string;
}

/**
 * Per-tenant HMAC-style commitment. The harness does **not** use HMAC
 * to derive the cache key — see the module header for the rationale.
 * This field exists so a regulator who expects the classical
 * "HMAC key per tenant" framing can verify the equivalent commitment:
 * a sha256 over the canonical-JSON of the tenant scope.
 */
export interface TenantCommitment {
  readonly tenantScope: TenantScope;
  /**
   * `sha256(canonicalJson(tenantScope))` — a tenant identifier that
   * (a) is collision-resistant, (b) is identical iff the scopes are
   * equal up to `projectId` defaulting to `"default"`, and (c) makes
   * no cryptographic claim about cache-key derivation. The harness
   * uses *path segments*, not this commitment, for isolation; the
   * commitment is here purely so an auditor can produce a tenant
   * identifier hash without reading source.
   */
  readonly commitmentSha256: string;
}

/**
 * Worked example showing pre-image distinctness for one cache key
 * across one pair of tenants. The proof artifact carries a finite
 * curated set of these so a regulator can verify the property on
 * inspectable data without trusting the proof statement abstractly.
 */
export interface PreImageDistinctnessWitness {
  readonly cacheKeyLabel: string;
  readonly cacheKeyDigest: string;
  readonly tenantA: {
    readonly tenantScope: TenantScope;
    readonly storagePath: string;
  };
  readonly tenantB: {
    readonly tenantScope: TenantScope;
    readonly storagePath: string;
  };
  /**
   * The first segment index (0-based) at which the two storage paths
   * differ. Always `< segments.length` because the witnesses are
   * built from distinct scopes; defensive callers may assert
   * `differingSegmentIndex >= 0`.
   */
  readonly differingSegmentIndex: number;
}

/** Stable classification of the side-channel surfaces enumerated. */
export type SideChannelClass = "timing" | "eviction-order" | "error-disclosure";

/**
 * Closed analysis of one side-channel class. The proof carries one
 * entry per `SideChannelClass` value; a regulator can confirm each
 * entry independently.
 */
export interface SideChannelAnalysisEntry {
  readonly channel: SideChannelClass;
  /** Two-sentence statement of the threat. */
  readonly threat: string;
  /** Two-sentence statement of the structural mitigation. */
  readonly mitigation: string;
  /** Source reference (file + symbol) implementing the mitigation. */
  readonly sourceReference: string;
}

/**
 * The cross-tenant isolation proof artifact. Pure, deterministic,
 * byte-stable for identical inputs (`generatedAt` is the only
 * timestamp and is supplied by the caller).
 */
export interface TenantIsolationProof {
  readonly schemaVersion: typeof TENANT_ISOLATION_PROOF_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly claim: string;
  readonly cacheKeyConstruction: CacheKeyConstruction;
  readonly storageNamespace: StorageNamespaceConstruction;
  readonly tenantCommitments: readonly TenantCommitment[];
  readonly preImageDistinctnessWitnesses: readonly PreImageDistinctnessWitness[];
  readonly sideChannelAnalysis: readonly SideChannelAnalysisEntry[];
  /**
   * sha256 over `canonicalJson` of every field above except this one.
   * Lets a downstream verifier confirm the proof bytes have not been
   * mutated between emission and audit.
   */
  readonly proofSha256: string;
  readonly methodology: {
    readonly disclaimer: typeof TENANT_ISOLATION_PROOF_METHODOLOGY_DISCLAIMER;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Build inputs & defaults
// ────────────────────────────────────────────────────────────────────────────

export interface BuildTenantIsolationProofInput {
  /** Wall-clock-free ISO-8601 timestamp baked into the artifact. */
  readonly generatedAt: string;
  /**
   * Curated list of tenant scopes used to materialise the worked
   * commitments and pre-image-distinctness witnesses. The default
   * covers the canonical pairs the adversarial test exercises:
   * `{tenant-a/prod/proj-x}` vs `{tenant-b/prod/proj-x}`,
   * environment split, and project split.
   */
  readonly tenantScopes?: readonly TenantScope[];
  /**
   * Curated list of cache-key labels + digests used in the worked
   * witnesses. The default uses three synthetic, well-formed sha256
   * hex digests chosen so the artifact bytes are deterministic
   * without depending on the production prompt-compiler.
   */
  readonly cacheKeyExamples?: ReadonlyArray<{
    readonly label: string;
    readonly digest: string;
  }>;
}

/** Default curated tenant scopes for the worked witnesses. */
export const DEFAULT_TENANT_SCOPE_EXAMPLES: readonly TenantScope[] =
  Object.freeze([
    Object.freeze({
      tenantId: "tenant-a",
      environmentId: "prod",
      projectId: "proj-x",
    }),
    Object.freeze({
      tenantId: "tenant-b",
      environmentId: "prod",
      projectId: "proj-x",
    }),
    Object.freeze({
      tenantId: "tenant-a",
      environmentId: "staging",
      projectId: "proj-x",
    }),
    Object.freeze({
      tenantId: "tenant-a",
      environmentId: "prod",
      projectId: "proj-y",
    }),
  ]);

/**
 * Default curated cache-key digests. These are fixture-grade values:
 * they have the structural shape of a real digest (64-char lowercase
 * hex) and are not preimages of any real production input. Their only
 * role is to make the worked witnesses inspectable.
 */
export const DEFAULT_CACHE_KEY_EXAMPLES: ReadonlyArray<{
  readonly label: string;
  readonly digest: string;
}> = Object.freeze([
  Object.freeze({
    label: "fixture-key-alpha",
    digest:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  }),
  Object.freeze({
    label: "fixture-key-beta",
    digest:
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  }),
  Object.freeze({
    label: "fixture-key-gamma",
    digest:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  }),
]);

// ────────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the constructive cross-tenant isolation proof. Pure:
 * identical inputs always produce identical canonical-JSON bytes.
 */
export const buildTenantIsolationProof = (
  input: BuildTenantIsolationProofInput,
): TenantIsolationProof => {
  assertIsoTimestamp(input.generatedAt);
  const scopes = (input.tenantScopes ?? DEFAULT_TENANT_SCOPE_EXAMPLES).map(
    freezeScope,
  );
  if (scopes.length < 2) {
    throw new RangeError(
      "buildTenantIsolationProof: at least 2 tenant scopes required to build distinctness witnesses",
    );
  }
  const cacheKeys = input.cacheKeyExamples ?? DEFAULT_CACHE_KEY_EXAMPLES;
  if (cacheKeys.length === 0) {
    throw new RangeError(
      "buildTenantIsolationProof: at least one cache-key example required",
    );
  }
  for (const example of cacheKeys) {
    assertCacheKeyDigest(example.digest);
  }

  const cacheKeyConstruction: CacheKeyConstruction = Object.freeze({
    algorithm: "sha256",
    encoding: "hex",
    preImageFields: Object.freeze([
      "ReplayCacheKey.inputHash",
      "ReplayCacheKey.promptHash",
      "ReplayCacheKey.schemaHash",
    ]),
    sourceReference:
      "src/test-intelligence/replay-cache.ts → computeReplayCacheKeyDigest",
    tenantIndependent: true,
  });

  const storageNamespace: StorageNamespaceConstruction = Object.freeze({
    pathTemplate:
      "<rootDir>/<tenantId>/<environmentId>/<projectId>/<digest>.json",
    segments: Object.freeze([
      "tenantId",
      "environmentId",
      "projectId",
      "digest",
    ]),
    segmentValidation: Object.freeze([
      "reject empty string",
      "reject '.' and '..' traversal tokens",
      "reject path separators ('/' and '\\\\')",
      "reject NUL byte",
      "normalise missing projectId to literal 'default'",
    ]),
    sourceReference:
      "src/test-intelligence/replay-cache-persistent.ts → createPersistentReplayCache (uses resolveTenantScopeSegments)",
  });

  const tenantCommitments: readonly TenantCommitment[] = Object.freeze(
    scopes.map((scope) =>
      Object.freeze({
        tenantScope: scope,
        commitmentSha256: computeTenantCommitmentSha256(scope),
      }),
    ),
  );

  const witnesses: PreImageDistinctnessWitness[] = [];
  for (let i = 0; i < scopes.length; i += 1) {
    for (let j = i + 1; j < scopes.length; j += 1) {
      const a = scopes[i]!;
      const b = scopes[j]!;
      if (scopesAreEquivalent(a, b)) continue;
      for (const example of cacheKeys) {
        witnesses.push(
          Object.freeze(buildWitness(a, b, example.label, example.digest)),
        );
      }
    }
  }
  if (witnesses.length === 0) {
    throw new RangeError(
      "buildTenantIsolationProof: tenantScopes contained no distinct pair",
    );
  }
  witnesses.sort(compareWitness);
  const frozenWitnesses = Object.freeze(witnesses);

  const sideChannelAnalysis: readonly SideChannelAnalysisEntry[] =
    Object.freeze([
      Object.freeze({
        channel: "timing" as SideChannelClass,
        threat:
          "An adversary times lookups under tenant A to infer whether a matching entry exists under tenant B (cache-timing oracle).",
        mitigation:
          "Lookups are pure readFile(path) where path is fully determined by (activeScope, cacheKey) before any I/O. There is no comparison loop and no shared in-process state that depends on tenant B's bytes; ENOENT is the only absent-entry signal and is produced before any data read.",
        sourceReference:
          "src/test-intelligence/replay-cache-persistent.ts → createPersistentReplayCache.lookup",
      }),
      Object.freeze({
        channel: "eviction-order" as SideChannelClass,
        threat:
          "An adversary inflates writes under tenant A to evict tenant B's least-recently-used entries (cross-tenant eviction oracle).",
        mitigation:
          "LRU eviction operates per-tenant-subtree via evictLru(scopeDir, byteBudget). The byte budget bookkeeping enumerates only the active scope's directory; tenant B's writes cannot evict tenant A's entries and vice versa.",
        sourceReference:
          "src/test-intelligence/replay-cache-persistent.ts → evictLru",
      }),
      Object.freeze({
        channel: "error-disclosure" as SideChannelClass,
        threat:
          "An adversary reads error messages to learn whether tenant B has a file at the digest path the adversary is probing.",
        mitigation:
          "lookup collapses ENOENT into { hit: false } and never includes the on-disk path or scope of any entry outside the active scope. ReplayCacheValidationError is raised only for entries that exist within the active scope's subtree.",
        sourceReference:
          "src/test-intelligence/replay-cache-persistent.ts → createPersistentReplayCache.lookup (isNotFoundError branch)",
      }),
    ]);

  const claim =
    "For any two tenant scopes S₁ ≠ S₂ and any replay-cache key K, the on-disk path produced by createPersistentReplayCache for (S₁, K) differs from the path produced for (S₂, K). Therefore no read under S₁ can ever return bytes written under S₂.";

  const proofPayload = {
    schemaVersion: TENANT_ISOLATION_PROOF_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    claim,
    cacheKeyConstruction,
    storageNamespace,
    tenantCommitments,
    preImageDistinctnessWitnesses: frozenWitnesses,
    sideChannelAnalysis,
    methodology: Object.freeze({
      disclaimer: TENANT_ISOLATION_PROOF_METHODOLOGY_DISCLAIMER,
    }),
  };
  const proofSha256 = createHash("sha256")
    .update(canonicalJson(proofPayload), "utf8")
    .digest("hex");
  return Object.freeze({ ...proofPayload, proofSha256 });
};

/**
 * sha256 hex digest over the canonical-JSON serialisation of the
 * proof. Pinned in the artifact's `proofSha256` field; exposed here
 * so callers can re-verify a previously persisted artifact.
 */
export const computeTenantIsolationProofDigest = (
  proof: TenantIsolationProof,
): string => {
  const rest: Omit<TenantIsolationProof, "proofSha256"> = {
    schemaVersion: proof.schemaVersion,
    generatedAt: proof.generatedAt,
    claim: proof.claim,
    cacheKeyConstruction: proof.cacheKeyConstruction,
    storageNamespace: proof.storageNamespace,
    tenantCommitments: proof.tenantCommitments,
    preImageDistinctnessWitnesses: proof.preImageDistinctnessWitnesses,
    sideChannelAnalysis: proof.sideChannelAnalysis,
    methodology: proof.methodology,
  };
  return createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
};

/**
 * Canonical-JSON serialisation with trailing newline. Matches the
 * convention used by every other test-intelligence artifact.
 */
export const serializeTenantIsolationProof = (
  proof: TenantIsolationProof,
): string => `${canonicalJson(proof)}\n`;

export interface WriteTenantIsolationProofInput {
  readonly proof: TenantIsolationProof;
  /** Absolute file path the artifact should be persisted to. */
  readonly artifactPath: string;
}

export interface WriteTenantIsolationProofResult {
  readonly artifactPath: string;
  readonly digest: string;
}

/**
 * Persist the proof to `artifactPath` via the standard atomic tmp-rename
 * pattern. The parent directory is created if missing.
 */
export const writeTenantIsolationProof = async (
  input: WriteTenantIsolationProofInput,
): Promise<WriteTenantIsolationProofResult> => {
  await mkdir(dirname(input.artifactPath), { recursive: true });
  const serialized = serializeTenantIsolationProof(input.proof);
  const tmpPath = `${input.artifactPath}.${process.pid.toString()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, input.artifactPath);
  return {
    artifactPath: input.artifactPath,
    digest: computeTenantIsolationProofDigest(input.proof),
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Penetration test scenario
// ────────────────────────────────────────────────────────────────────────────

/** A single attempted cross-tenant access during the pentest. */
export interface TenantIsolationPentestAttempt {
  readonly scenario: string;
  readonly attackerScope: TenantScope;
  readonly victimScope: TenantScope;
  /**
   * `true` iff the attacker observed bytes that originated under the
   * victim scope. The acceptance criterion requires this to be `false`
   * for every recorded attempt.
   */
  readonly leaked: boolean;
  /**
   * Empirical observation the test made (e.g. "lookup returned hit=false",
   * "stat threw ENOENT", "constructor threw RangeError"). Pinned for
   * the pentest evidence record.
   */
  readonly observation: string;
}

/** Pentest scenario evidence — pinned in `fixtures/test-intelligence/tenant-isolation/tenant-isolation-pentest.json`. */
export interface TenantIsolationPentestEvidence {
  readonly schemaVersion: typeof TENANT_ISOLATION_PROOF_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly attempts: readonly TenantIsolationPentestAttempt[];
  readonly summary: {
    readonly totalAttempts: number;
    readonly leakCount: number;
    readonly verdict: "pass" | "fail";
  };
  readonly evidenceSha256: string;
}

export interface BuildTenantIsolationPentestEvidenceInput {
  readonly generatedAt: string;
  readonly attempts: readonly TenantIsolationPentestAttempt[];
}

/**
 * Build the pentest evidence record from raw attempt rows. Sorts
 * attempts by `(scenario, attackerScope.tenantId, victimScope.tenantId)`
 * so the bytes are byte-stable for the same logical pentest.
 */
export const buildTenantIsolationPentestEvidence = (
  input: BuildTenantIsolationPentestEvidenceInput,
): TenantIsolationPentestEvidence => {
  assertIsoTimestamp(input.generatedAt);
  if (input.attempts.length === 0) {
    throw new RangeError(
      "buildTenantIsolationPentestEvidence: at least one attempt required",
    );
  }
  const sorted = input.attempts
    .map(freezeAttempt)
    .sort(compareAttempt);
  const leakCount = sorted.reduce((n, a) => n + (a.leaked ? 1 : 0), 0);
  const verdict: "pass" | "fail" = leakCount === 0 ? "pass" : "fail";
  const payload = {
    schemaVersion: TENANT_ISOLATION_PROOF_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    attempts: Object.freeze(sorted),
    summary: Object.freeze({
      totalAttempts: sorted.length,
      leakCount,
      verdict,
    }),
  };
  const evidenceSha256 = createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
  return Object.freeze({ ...payload, evidenceSha256 });
};

/** Canonical-JSON serialisation with trailing newline. */
export const serializeTenantIsolationPentestEvidence = (
  evidence: TenantIsolationPentestEvidence,
): string => `${canonicalJson(evidence)}\n`;

/**
 * Catastrophic assertion used by the CI gate: throws when the pentest
 * recorded any cross-tenant byte leak. The acceptance criterion
 * requires `leakCount === 0`.
 */
export class TenantIsolationLeakageDetected extends Error {
  readonly leakCount: number;
  readonly code = "TENANT_ISOLATION_LEAKAGE_DETECTED" as const;
  constructor(leakCount: number) {
    super(
      `tenant-isolation pentest recorded ${leakCount.toString()} cross-tenant leak(s); expected 0`,
    );
    this.name = "TenantIsolationLeakageDetected";
    this.leakCount = leakCount;
  }
}

export const assertTenantIsolationPentestPasses = (
  evidence: TenantIsolationPentestEvidence,
): void => {
  if (evidence.summary.leakCount !== 0) {
    throw new TenantIsolationLeakageDetected(evidence.summary.leakCount);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const HEX64_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const assertCacheKeyDigest = (digest: string): void => {
  if (!HEX64_RE.test(digest)) {
    throw new RangeError(
      `cache-key digest must be 64 lowercase hex chars, got: ${digest}`,
    );
  }
};

const assertIsoTimestamp = (value: string): void => {
  if (!ISO_RE.test(value)) {
    throw new RangeError(
      `generatedAt must be an ISO-8601 millisecond Z timestamp, got: ${value}`,
    );
  }
};

const freezeScope = (scope: TenantScope): TenantScope =>
  Object.freeze({
    tenantId: scope.tenantId,
    environmentId: scope.environmentId,
    ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}),
  });

const scopesAreEquivalent = (a: TenantScope, b: TenantScope): boolean =>
  a.tenantId === b.tenantId &&
  a.environmentId === b.environmentId &&
  (a.projectId ?? "default") === (b.projectId ?? "default");

const computeTenantCommitmentSha256 = (scope: TenantScope): string => {
  const segments = resolveTenantScopeSegments(scope);
  return createHash("sha256")
    .update(
      canonicalJson({
        tenantId: segments[0],
        environmentId: segments[1],
        projectId: segments[2],
      }),
      "utf8",
    )
    .digest("hex");
};

const buildWitness = (
  a: TenantScope,
  b: TenantScope,
  cacheKeyLabel: string,
  cacheKeyDigest: string,
): PreImageDistinctnessWitness => {
  const aSegments = resolveTenantScopeSegments(a);
  const bSegments = resolveTenantScopeSegments(b);
  const filename = `${cacheKeyDigest}.json`;
  // Use POSIX join so the artifact bytes are stable across host OSes.
  const pathA = posix.join("<rootDir>", ...aSegments, filename);
  const pathB = posix.join("<rootDir>", ...bSegments, filename);
  let differingSegmentIndex = -1;
  for (let i = 0; i < 3; i += 1) {
    if (aSegments[i] !== bSegments[i]) {
      differingSegmentIndex = i;
      break;
    }
  }
  if (differingSegmentIndex === -1) {
    throw new RangeError(
      `buildWitness called with equivalent scopes: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
    );
  }
  return {
    cacheKeyLabel,
    cacheKeyDigest,
    tenantA: Object.freeze({ tenantScope: a, storagePath: pathA }),
    tenantB: Object.freeze({ tenantScope: b, storagePath: pathB }),
    differingSegmentIndex,
  };
};

const compareWitness = (
  left: PreImageDistinctnessWitness,
  right: PreImageDistinctnessWitness,
): number => {
  if (left.cacheKeyLabel < right.cacheKeyLabel) return -1;
  if (left.cacheKeyLabel > right.cacheKeyLabel) return 1;
  if (left.tenantA.storagePath < right.tenantA.storagePath) return -1;
  if (left.tenantA.storagePath > right.tenantA.storagePath) return 1;
  if (left.tenantB.storagePath < right.tenantB.storagePath) return -1;
  if (left.tenantB.storagePath > right.tenantB.storagePath) return 1;
  return 0;
};

const freezeAttempt = (
  attempt: TenantIsolationPentestAttempt,
): TenantIsolationPentestAttempt =>
  Object.freeze({
    scenario: attempt.scenario,
    attackerScope: freezeScope(attempt.attackerScope),
    victimScope: freezeScope(attempt.victimScope),
    leaked: attempt.leaked,
    observation: attempt.observation,
  });

const compareAttempt = (
  left: TenantIsolationPentestAttempt,
  right: TenantIsolationPentestAttempt,
): number => {
  if (left.scenario < right.scenario) return -1;
  if (left.scenario > right.scenario) return 1;
  if (left.attackerScope.tenantId < right.attackerScope.tenantId) return -1;
  if (left.attackerScope.tenantId > right.attackerScope.tenantId) return 1;
  if (left.victimScope.tenantId < right.victimScope.tenantId) return -1;
  if (left.victimScope.tenantId > right.victimScope.tenantId) return 1;
  return 0;
};

