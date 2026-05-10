/**
 * Multi-tenant isolation runtime guard (Issue #2176).
 *
 * Tier-1 / W6-2 hardening for the test-intelligence harness: every shared
 * persistent store, calibration corpus, and replay cache must crash on
 * cross-tenant access instead of silently returning bytes from the wrong
 * tenant's directory.
 *
 * Design:
 *
 *   - `withTenantScope(scope, fn)` opens an `AsyncLocalStorage` context
 *     so all nested async work inherits the active {@link TenantScope}
 *     without re-passing `tenantId` through every call site.
 *
 *   - `assertTenantScope(operation, expected, actual)` is the catastrophic
 *     guard. A mismatch throws {@link TenantIsolationViolation}; callers
 *     do **not** catch — the harness aborts the run, which is the only
 *     defensible posture against silent cross-tenant data exposure.
 *
 *   - `recordPersistentStoreRead(operation, scope)` is the
 *     audit-evidence hook. It validates the read's scope against the
 *     active ALS scope (`assertTenantScope` semantics) and appends an
 *     entry to the per-run attestation buffer when a context is active.
 *     Outside a `withTenantScope` block (e.g. unit tests, single-tenant
 *     CLI usage) it records nothing and asserts nothing — the active
 *     scope is the source of truth.
 *
 *   - `buildTenantIsolationAttestation(input)` produces the byte-stable
 *     `tenant-isolation-attestation.json` artifact. The attestation
 *     digest is pinned in `provenance.jsonld` (`ti:tenantIsolationAttestationSha256`).
 *
 * Failure mode: a `TenantIsolationViolation` is **catastrophic**. Do not
 * retry. Abort the run, page the operator, isolate the misconfigured
 * tenant before any subsequent run.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import type { TenantScope } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/** Schema version pinned on every persisted tenant-isolation attestation. */
export const TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION = "1.0.0" as const;

/** Filename of the per-run tenant-isolation attestation artifact. */
export const TENANT_ISOLATION_ATTESTATION_ARTIFACT_FILENAME =
  "tenant-isolation-attestation.json" as const;

/**
 * Catastrophic error raised when a persistent-store access executes
 * under a tenant scope that does not match the scope the bytes were
 * written under.
 *
 * The harness must not catch this error. Aborting the run is the
 * defensible posture — a recoverable mismatch implies the operator's
 * tenant routing is broken and any further read could leak bytes from
 * one customer to another.
 */
export class TenantIsolationViolation extends Error {
  readonly operation: string;
  readonly expected: TenantScope;
  readonly actual: TenantScope;
  /** Stable, machine-readable error code for downstream classifiers. */
  readonly code = "TENANT_ISOLATION_VIOLATION" as const;

  constructor(input: {
    readonly operation: string;
    readonly expected: TenantScope;
    readonly actual: TenantScope;
  }) {
    super(
      `tenant-isolation-guard: ${input.operation} attempted under tenant ` +
        `"${input.actual.tenantId}/${input.actual.environmentId}/${input.actual.projectId ?? "default"}" ` +
        `but the bytes belong to tenant ` +
        `"${input.expected.tenantId}/${input.expected.environmentId}/${input.expected.projectId ?? "default"}"`,
    );
    this.name = "TenantIsolationViolation";
    this.operation = input.operation;
    this.expected = input.expected;
    this.actual = input.actual;
  }
}

/** A single persistent-store access under an active tenant scope. */
export interface TenantIsolationReadEntry {
  readonly operation: string;
  readonly scope: TenantScope;
  /**
   * Per-run monotonic sequence number. Stable across replays so the
   * attestation bytes are deterministic for the same logical run; we do
   * not record wall-clock time because that would make the attestation
   * non-deterministic and useless as a Merkle leaf.
   */
  readonly sequence: number;
}

interface TenantIsolationContext {
  readonly scope: TenantScope;
  readonly reads: TenantIsolationReadEntry[];
  /**
   * Mutable monotonic counter shared by all nested calls under the same
   * `withTenantScope` block. Stored on the context object so concurrent
   * scopes (test parallelism) cannot collide on the sequence number.
   */
  nextSequence: number;
}

const storage = new AsyncLocalStorage<TenantIsolationContext>();

/**
 * Run `fn` under `scope` so every nested call observes the same active
 * tenant via {@link getCurrentTenantScope}. Synchronous and asynchronous
 * `fn` shapes are both supported — the return type is preserved.
 *
 * Nested `withTenantScope` calls under the same scope are no-ops on the
 * audit trail (the inner call shares the outer context). Nested calls
 * under a *different* scope throw {@link TenantIsolationViolation}
 * eagerly because crossing scopes mid-flow is the bug class this guard
 * exists to catch.
 */
export const withTenantScope = <T>(
  scope: TenantScope,
  fn: () => T | Promise<T>,
): T | Promise<T> => {
  const existing = storage.getStore();
  if (existing !== undefined) {
    if (!tenantScopesEqual(existing.scope, scope)) {
      throw new TenantIsolationViolation({
        operation: "withTenantScope",
        expected: existing.scope,
        actual: scope,
      });
    }
    return fn();
  }
  const context: TenantIsolationContext = {
    scope: freezeScope(scope),
    reads: [],
    nextSequence: 0,
  };
  return storage.run(context, fn);
};

/**
 * Return the active tenant scope, or `undefined` when called outside a
 * {@link withTenantScope} block. Production code paths must always be
 * inside a scope; the `undefined` branch is for unit tests and offline
 * benchmark utilities that do not exercise the multi-tenant surface.
 */
export const getCurrentTenantScope = (): TenantScope | undefined => {
  const ctx = storage.getStore();
  return ctx === undefined ? undefined : ctx.scope;
};

/**
 * Throw {@link TenantIsolationViolation} when `expected !== actual`.
 * Public API per Issue #2176 acceptance criteria.
 */
export const assertTenantScope = (
  operation: string,
  expected: TenantScope,
  actual: TenantScope,
): void => {
  if (!tenantScopesEqual(expected, actual)) {
    throw new TenantIsolationViolation({ operation, expected, actual });
  }
};

/**
 * Audit-evidence hook for every persistent-store read.
 *
 * - When called *outside* an active {@link withTenantScope} block: no-op.
 *   Single-tenant test fixtures and offline tools are not subject to the
 *   guarantee, so they continue to work without modification.
 *
 * - When called *inside* an active block: validates `recordedScope`
 *   against the active scope (catastrophic crash on mismatch via
 *   {@link assertTenantScope}) and appends a deterministic audit entry
 *   to the run's attestation buffer.
 *
 * `recordedScope` is the scope the on-disk bytes were written under
 * (e.g. the `TenantScope` baked into the persistent-replay-cache
 * constructor, or the `tenantId` segment of a baseline path). It is
 * **not** the active scope — that is read from ALS.
 */
export const recordPersistentStoreRead = (
  operation: string,
  recordedScope: TenantScope,
): void => {
  const ctx = storage.getStore();
  if (ctx === undefined) return;
  assertTenantScope(operation, ctx.scope, recordedScope);
  ctx.reads.push({
    operation,
    scope: ctx.scope,
    sequence: ctx.nextSequence,
  });
  ctx.nextSequence += 1;
};

/**
 * `tenantId`-only convenience for stores that key on a flat tenant id
 * (coverage-baseline-drift, distribution-shift-detector). Asserts the
 * active scope's `tenantId` matches `recordedTenantId` and records the
 * read against the full active scope.
 */
export const recordTenantIdRead = (
  operation: string,
  recordedTenantId: string,
): void => {
  const ctx = storage.getStore();
  if (ctx === undefined) return;
  if (ctx.scope.tenantId !== recordedTenantId) {
    const recordedScope: TenantScope = {
      tenantId: recordedTenantId,
      environmentId: ctx.scope.environmentId,
      ...(ctx.scope.projectId !== undefined
        ? { projectId: ctx.scope.projectId }
        : {}),
    };
    throw new TenantIsolationViolation({
      operation,
      expected: ctx.scope,
      actual: recordedScope,
    });
  }
  ctx.reads.push({
    operation,
    scope: ctx.scope,
    sequence: ctx.nextSequence,
  });
  ctx.nextSequence += 1;
};

/**
 * Audit-only record for stores that are tenant-scoped *implicitly* via
 * the per-run working directory (e.g. `agent-lessons-memdir`, the
 * lessons consolidation lock). These modules cannot accept a recorded
 * scope because the runDir already partitions tenants — but every read
 * still needs to land in the per-run attestation buffer. When no
 * `withTenantScope` block is active, this is a no-op.
 */
export const recordActiveTenantRead = (operation: string): void => {
  const ctx = storage.getStore();
  if (ctx === undefined) return;
  ctx.reads.push({
    operation,
    scope: ctx.scope,
    sequence: ctx.nextSequence,
  });
  ctx.nextSequence += 1;
};

/** Snapshot of the recorded reads for the active scope (test/inspection only). */
export const snapshotTenantIsolationReads = (): readonly TenantIsolationReadEntry[] => {
  const ctx = storage.getStore();
  if (ctx === undefined) return Object.freeze([]);
  return Object.freeze(ctx.reads.map((entry) => ({ ...entry })));
};

export interface TenantIsolationAttestation {
  readonly schemaVersion: typeof TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly tenantScope: TenantScope;
  readonly persistentStoreReads: readonly TenantIsolationReadEntry[];
  /**
   * SHA-256 hex digest of the canonical-JSON serialisation of
   * `{ tenantScope, persistentStoreReads }`. Pinned in
   * `provenance.jsonld` as `ti:tenantIsolationAttestationSha256` so a
   * downstream verifier can confirm the attestation has not been
   * mutated between emission and audit.
   */
  readonly attestationSha256: string;
  /**
   * Count of recorded reads. Redundant with `persistentStoreReads.length`
   * but emitted as a top-level field so an auditor can index the
   * attestation without parsing the array.
   */
  readonly readCount: number;
  /**
   * Stable certification line. The harness asserts every recorded
   * read's `scope.tenantId` equals `tenantScope.tenantId`; this string
   * is the human-readable reflection of that runtime invariant.
   */
  readonly certification: typeof TENANT_ISOLATION_ATTESTATION_CERTIFICATION;
}

export const TENANT_ISOLATION_ATTESTATION_CERTIFICATION =
  "no cross-tenant persistent-store read occurred during this run" as const;

export interface BuildTenantIsolationAttestationInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly tenantScope: TenantScope;
  readonly reads: readonly TenantIsolationReadEntry[];
}

/**
 * Build the per-run attestation artifact. Pure: identical inputs always
 * produce identical canonical JSON bytes (the digest is over the
 * canonical-JSON of the scope + reads).
 *
 * Internally, the function re-validates that every recorded read's
 * `scope.tenantId` equals `tenantScope.tenantId`. If it does not, the
 * function throws {@link TenantIsolationViolation} — the attestation
 * cannot be emitted for a run that already saw a cross-tenant read.
 */
export const buildTenantIsolationAttestation = (
  input: BuildTenantIsolationAttestationInput,
): TenantIsolationAttestation => {
  const tenantScope = freezeScope(input.tenantScope);
  const reads = Object.freeze(
    input.reads
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((entry, index) => {
        if (entry.scope.tenantId !== tenantScope.tenantId) {
          throw new TenantIsolationViolation({
            operation: entry.operation,
            expected: tenantScope,
            actual: entry.scope,
          });
        }
        return Object.freeze({
          operation: entry.operation,
          scope: freezeScope(entry.scope),
          sequence: index,
        });
      }),
  ) as readonly TenantIsolationReadEntry[];
  const digestPayload = canonicalJson({
    schemaVersion: TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION,
    tenantScope,
    persistentStoreReads: reads,
  });
  const attestationSha256 = createHash("sha256")
    .update(digestPayload)
    .digest("hex");
  return Object.freeze({
    schemaVersion: TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    tenantScope,
    persistentStoreReads: reads,
    readCount: reads.length,
    attestationSha256,
    certification: TENANT_ISOLATION_ATTESTATION_CERTIFICATION,
  });
};

/**
 * Canonical-JSON serialisation of an attestation, with a trailing
 * newline to match the convention used by every other test-intelligence
 * artifact written through `writeAtomicBytes`.
 */
export const serializeTenantIsolationAttestation = (
  attestation: TenantIsolationAttestation,
): string => `${canonicalJson(attestation)}\n`;

const tenantScopesEqual = (left: TenantScope, right: TenantScope): boolean =>
  left.tenantId === right.tenantId &&
  left.environmentId === right.environmentId &&
  (left.projectId ?? "default") === (right.projectId ?? "default");

const freezeScope = (scope: TenantScope): TenantScope =>
  Object.freeze({
    tenantId: scope.tenantId,
    environmentId: scope.environmentId,
    ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}),
  });
