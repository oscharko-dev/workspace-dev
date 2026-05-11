import assert from "node:assert/strict";
import test from "node:test";

import type { TenantScope } from "../contracts/index.js";
import {
  assertTenantScope,
  buildTenantIsolationAttestation,
  getCurrentTenantScope,
  recordActiveTenantRead,
  recordPersistentStoreRead,
  recordTenantIdRead,
  serializeTenantIsolationAttestation,
  snapshotTenantIsolationReads,
  TENANT_ISOLATION_ATTESTATION_ARTIFACT_FILENAME,
  TENANT_ISOLATION_ATTESTATION_CERTIFICATION,
  TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION,
  TenantIsolationViolation,
  withTenantScope,
} from "./tenant-isolation-guard.js";

const tenantA: TenantScope = {
  tenantId: "tenant-a",
  environmentId: "prod",
  projectId: "default",
};

const tenantB: TenantScope = {
  tenantId: "tenant-b",
  environmentId: "prod",
  projectId: "default",
};

test("constants are stable per Issue #2176 contract", () => {
  assert.equal(TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION, "1.0.0");
  assert.equal(
    TENANT_ISOLATION_ATTESTATION_ARTIFACT_FILENAME,
    "tenant-isolation-attestation.json",
  );
  assert.equal(
    TENANT_ISOLATION_ATTESTATION_CERTIFICATION,
    "no cross-tenant persistent-store read occurred during this run",
  );
});

test("assertTenantScope: identical scopes do not throw", () => {
  assert.doesNotThrow(() =>
    assertTenantScope("op", tenantA, { ...tenantA }),
  );
});

test("assertTenantScope: undefined projectId equals 'default'", () => {
  const a: TenantScope = { tenantId: "x", environmentId: "y" };
  const b: TenantScope = { tenantId: "x", environmentId: "y", projectId: "default" };
  assert.doesNotThrow(() => assertTenantScope("op", a, b));
});

test("assertTenantScope: tenantId mismatch throws TenantIsolationViolation", () => {
  assert.throws(
    () => assertTenantScope("read", tenantA, tenantB),
    (err: unknown) => {
      assert.ok(err instanceof TenantIsolationViolation);
      assert.equal(err.code, "TENANT_ISOLATION_VIOLATION");
      assert.equal(err.operation, "read");
      assert.equal(err.expected.tenantId, "tenant-a");
      assert.equal(err.actual.tenantId, "tenant-b");
      return true;
    },
  );
});

test("assertTenantScope: environmentId mismatch throws", () => {
  assert.throws(
    () =>
      assertTenantScope("read", tenantA, {
        ...tenantA,
        environmentId: "staging",
      }),
    TenantIsolationViolation,
  );
});

test("assertTenantScope: projectId mismatch throws", () => {
  assert.throws(
    () =>
      assertTenantScope("read", tenantA, {
        ...tenantA,
        projectId: "other-project",
      }),
    TenantIsolationViolation,
  );
});

test("withTenantScope: nested same-scope is a no-op on context", async () => {
  await withTenantScope(tenantA, async () => {
    assert.deepEqual(getCurrentTenantScope(), tenantA);
    await withTenantScope({ ...tenantA }, async () => {
      assert.deepEqual(getCurrentTenantScope(), tenantA);
    });
  });
});

test("withTenantScope: nested different-scope throws eagerly", async () => {
  await withTenantScope(tenantA, async () => {
    await assert.rejects(
      async () => withTenantScope(tenantB, async () => undefined),
      TenantIsolationViolation,
    );
  });
});

test("getCurrentTenantScope is undefined outside any block", () => {
  assert.equal(getCurrentTenantScope(), undefined);
});

test("recordPersistentStoreRead: outside withTenantScope is a no-op", () => {
  // Must not throw, must not record anywhere observable.
  recordPersistentStoreRead("op", tenantB);
  assert.deepEqual(snapshotTenantIsolationReads(), []);
});

test("recordPersistentStoreRead: matching scope appends to attestation buffer", async () => {
  await withTenantScope(tenantA, async () => {
    recordPersistentStoreRead("replay-cache.lookup", tenantA);
    recordPersistentStoreRead("replay-cache.store", tenantA);
    const reads = snapshotTenantIsolationReads();
    assert.equal(reads.length, 2);
    assert.equal(reads[0]!.operation, "replay-cache.lookup");
    assert.equal(reads[0]!.sequence, 0);
    assert.equal(reads[1]!.operation, "replay-cache.store");
    assert.equal(reads[1]!.sequence, 1);
  });
});

test("recordPersistentStoreRead: mismatched scope crashes the run", async () => {
  await withTenantScope(tenantA, async () => {
    assert.throws(
      () => recordPersistentStoreRead("replay-cache.lookup", tenantB),
      TenantIsolationViolation,
    );
  });
});

test("recordTenantIdRead: matching tenantId records the read", async () => {
  await withTenantScope(tenantA, async () => {
    recordTenantIdRead("coverage-baseline.load", tenantA.tenantId);
    const reads = snapshotTenantIsolationReads();
    assert.equal(reads.length, 1);
    assert.equal(reads[0]!.operation, "coverage-baseline.load");
  });
});

test("recordTenantIdRead: mismatched tenantId crashes the run", async () => {
  await withTenantScope(tenantA, async () => {
    assert.throws(
      () => recordTenantIdRead("coverage-baseline.load", "tenant-b"),
      (err: unknown) => {
        assert.ok(err instanceof TenantIsolationViolation);
        assert.equal(err.expected.tenantId, "tenant-a");
        assert.equal(err.actual.tenantId, "tenant-b");
        return true;
      },
    );
  });
});

test("recordTenantIdRead: outside scope is a no-op", () => {
  assert.doesNotThrow(() => recordTenantIdRead("op", "anything"));
});

test("recordActiveTenantRead: appends scoped entry inside block", async () => {
  await withTenantScope(tenantA, async () => {
    recordActiveTenantRead("agent-lessons.scan");
    const reads = snapshotTenantIsolationReads();
    assert.equal(reads.length, 1);
    assert.equal(reads[0]!.operation, "agent-lessons.scan");
    assert.deepEqual(reads[0]!.scope, tenantA);
  });
});

test("recordActiveTenantRead: outside block is a no-op", () => {
  assert.doesNotThrow(() => recordActiveTenantRead("op"));
});

test("buildTenantIsolationAttestation: byte-stable across identical inputs", async () => {
  const reads = await withTenantScope(tenantA, async () => {
    recordPersistentStoreRead("replay-cache.lookup", tenantA);
    recordPersistentStoreRead("replay-cache.store", tenantA);
    return snapshotTenantIsolationReads();
  });
  const a = buildTenantIsolationAttestation({
    jobId: "job-1",
    generatedAt: "2026-05-10T00:00:00Z",
    tenantScope: tenantA,
    reads,
  });
  const b = buildTenantIsolationAttestation({
    jobId: "job-1",
    generatedAt: "2026-05-10T00:00:00Z",
    tenantScope: tenantA,
    reads,
  });
  assert.equal(
    serializeTenantIsolationAttestation(a),
    serializeTenantIsolationAttestation(b),
  );
  assert.equal(a.attestationSha256, b.attestationSha256);
});

test("buildTenantIsolationAttestation: refuses to emit when reads cross scopes", () => {
  assert.throws(
    () =>
      buildTenantIsolationAttestation({
        jobId: "job-1",
        generatedAt: "2026-05-10T00:00:00Z",
        tenantScope: tenantA,
        reads: [
          { operation: "leaked", scope: tenantB, sequence: 0 },
        ],
      }),
    TenantIsolationViolation,
  );
});

test("buildTenantIsolationAttestation: digest is over canonical scope+reads only", () => {
  const reads = [
    { operation: "op-a", scope: tenantA, sequence: 0 },
    { operation: "op-b", scope: tenantA, sequence: 1 },
  ];
  const a = buildTenantIsolationAttestation({
    jobId: "job-1",
    generatedAt: "2026-05-10T00:00:00Z",
    tenantScope: tenantA,
    reads,
  });
  const b = buildTenantIsolationAttestation({
    jobId: "job-2",
    generatedAt: "2027-01-01T00:00:00Z",
    tenantScope: tenantA,
    reads,
  });
  // The digest excludes jobId / generatedAt — those are recorded at the
  // top level of the attestation but not part of the integrity hash.
  assert.equal(a.attestationSha256, b.attestationSha256);
});

test("buildTenantIsolationAttestation: read sequence is normalized 0..N-1", () => {
  const attestation = buildTenantIsolationAttestation({
    jobId: "job-1",
    generatedAt: "2026-05-10T00:00:00Z",
    tenantScope: tenantA,
    reads: [
      { operation: "third", scope: tenantA, sequence: 99 },
      { operation: "first", scope: tenantA, sequence: 0 },
      { operation: "second", scope: tenantA, sequence: 50 },
    ],
  });
  assert.deepEqual(
    attestation.persistentStoreReads.map((r) => r.operation),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    attestation.persistentStoreReads.map((r) => r.sequence),
    [0, 1, 2],
  );
});

test("withTenantScope: context isolation between concurrent scopes", async () => {
  // AsyncLocalStorage must keep two parallel scopes from cross-contaminating.
  const [aReads, bReads] = await Promise.all([
    withTenantScope(tenantA, async () => {
      recordPersistentStoreRead("op-a-1", tenantA);
      await new Promise((resolve) => setImmediate(resolve));
      recordPersistentStoreRead("op-a-2", tenantA);
      return snapshotTenantIsolationReads();
    }),
    withTenantScope(tenantB, async () => {
      recordPersistentStoreRead("op-b-1", tenantB);
      await new Promise((resolve) => setImmediate(resolve));
      recordPersistentStoreRead("op-b-2", tenantB);
      return snapshotTenantIsolationReads();
    }),
  ]);
  assert.deepEqual(
    aReads.map((r) => r.operation),
    ["op-a-1", "op-a-2"],
  );
  assert.deepEqual(
    bReads.map((r) => r.operation),
    ["op-b-1", "op-b-2"],
  );
});

test("property: every random tenant pair where tenantA !== tenantB throws", () => {
  // Compact property-based test. A real fast-check would be ideal but
  // node:test has no fast-check binding here; the explicit cartesian
  // product over a small alphabet covers the "every pair crashes" claim
  // demanded by Issue #2176 without an external dep.
  const tenantIds = ["alpha", "beta", "gamma"];
  const envIds = ["prod", "staging"];
  const projectIds: (string | undefined)[] = [undefined, "p1", "p2"];
  const all: TenantScope[] = [];
  for (const t of tenantIds) {
    for (const e of envIds) {
      for (const p of projectIds) {
        all.push(p === undefined ? { tenantId: t, environmentId: e } : { tenantId: t, environmentId: e, projectId: p });
      }
    }
  }
  for (const expected of all) {
    for (const actual of all) {
      const equal =
        expected.tenantId === actual.tenantId &&
        expected.environmentId === actual.environmentId &&
        (expected.projectId ?? "default") === (actual.projectId ?? "default");
      if (equal) {
        assert.doesNotThrow(() => assertTenantScope("op", expected, actual));
      } else {
        assert.throws(
          () => assertTenantScope("op", expected, actual),
          TenantIsolationViolation,
        );
      }
    }
  }
});
