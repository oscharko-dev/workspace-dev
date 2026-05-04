import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_VERSION,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  MIGRATION_BUNDLE_SCHEMA_VERSION,
  MIGRATIONS_LOG_ARTIFACT_FILENAME,
  type SignedMigrationBundle,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildMigrationHash,
  runMigrations,
  type Migration,
} from "./migrations.js";

const FIXED_TS = "2026-05-04T12:00:00.000Z";

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(join(tmpdir(), "workspace-dev-migrations-"));
  await fn(runDir);
};

const buildBundle = (
  migrations: readonly Migration[],
): SignedMigrationBundle => ({
  schemaVersion: MIGRATION_BUNDLE_SCHEMA_VERSION,
  contractVersion: CONTRACT_VERSION,
  entries: migrations.map((migration) => ({
    id: migration.id,
    hash: buildMigrationHash(migration),
    description: migration.description,
    ...(migration.evidenceBearing === true ? { evidenceBearing: true } : {}),
  })),
});

test("AT-039 equivalent: unsigned banking migration is refused without mutating state or writing audit", async () => {
  await withRunDir(async (runDir) => {
    const migration: Migration = {
      id: "banking-upgrade",
      description: "Adds a banking-only settings field",
      condition: () => true,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        upgraded: true,
      }),
    };
    const initialState = {
      runDir,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      upgraded: false,
    };

    const result = await runMigrations(initialState, [migration], {
      runDir,
      generatedAt: FIXED_TS,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    });

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_unsigned");
    assert.equal((result.state as { upgraded: boolean }).upgraded, false);
    await assert.rejects(
      readFile(join(runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME), "utf8"),
    );
  });
});

test("signed migration applies once, writes canonical JSONL, and re-run is idempotent", async () => {
  await withRunDir(async (runDir) => {
    const migration: Migration = {
      id: "normalize-settings-shape",
      description: "Promote the legacy settings version marker",
      condition: (state) => (state as { version?: number }).version !== 2,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        version: 2,
      }),
    };
    const bundle = buildBundle([migration]);

    const first = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        version: 1,
      },
      [migration],
      {
        runDir,
        generatedAt: FIXED_TS,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        signedBundle: bundle,
      },
    );

    assert.equal(first.status, "ok");
    assert.equal((first.state as { version: number }).version, 2);
    assert.deepEqual(first.skippedIds, []);
    assert.equal(first.applied.length, 1);

    const expectedLine = `${canonicalJson(first.applied[0])}\n`;
    const auditLogPath = join(runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME);
    assert.equal(await readFile(auditLogPath, "utf8"), expectedLine);

    const second = await runMigrations(first.state, [migration], {
      runDir,
      generatedAt: FIXED_TS,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      signedBundle: bundle,
    });

    assert.equal(second.status, "ok");
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skippedIds, ["normalize-settings-shape"]);
    assert.equal(await readFile(auditLogPath, "utf8"), expectedLine);
  });
});

test("stale signed bundle contract versions are refused for both option-supplied and state-derived bundles", async () => {
  await withRunDir(async (runDir) => {
    const migration: Migration = {
      id: "bundle-version-check",
      description: "Requires a current signed bundle contract version",
      condition: () => true,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        upgraded: true,
      }),
    };
    const staleBundle: SignedMigrationBundle = {
      ...buildBundle([migration]),
      contractVersion: "0.0.1" as typeof CONTRACT_VERSION,
    };

    const viaOptions = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        upgraded: false,
      },
      [migration],
      {
        runDir,
        generatedAt: FIXED_TS,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        signedBundle: staleBundle,
      },
    );
    assert.equal(viaOptions.status, "refused");
    assert.equal(viaOptions.code, "migration_state_invalid");

    const viaState = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        upgraded: false,
        signedMigrationBundle: staleBundle,
      },
      [migration],
    );
    assert.equal(viaState.status, "refused");
    assert.equal(viaState.code, "migration_unsigned");
  });
});

test("evidence-bearing migration without rollback is refused before apply", async () => {
  await withRunDir(async (runDir) => {
    let applied = false;
    const migration: Migration = {
      id: "evidence-shape-upgrade",
      description: "Mutates evidence-bearing state",
      evidenceBearing: true,
      condition: () => true,
      apply: () => {
        applied = true;
        return { changed: true };
      },
    };

    const result = await runMigrations(
      { runDir, changed: false },
      [migration],
      {
        runDir,
        generatedAt: FIXED_TS,
      },
    );

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_rollback_required");
    assert.equal(applied, false);
  });
});

test("simulated failure rolls back cleanly and does not persist partial audit entries", async () => {
  await withRunDir(async (runDir) => {
    let firstRollbackCount = 0;
    let secondRollbackCount = 0;
    const first: Migration = {
      id: "first-evidence-migration",
      description: "Applies the first evidence-bearing change",
      evidenceBearing: true,
      condition: () => true,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        count: 1,
      }),
      rollback: (state) => {
        firstRollbackCount += 1;
        return {
          ...(state as Record<string, unknown>),
          count: 0,
        };
      },
    };
    const second: Migration = {
      id: "second-evidence-migration",
      description: "Fails after mutating evidence-bearing state",
      evidenceBearing: true,
      condition: () => true,
      apply: (state) => {
        (state as Record<string, unknown>)["count"] = 2;
        throw new Error("boom");
      },
      rollback: (state) => {
        secondRollbackCount += 1;
        return {
          ...(state as Record<string, unknown>),
          count: 1,
        };
      },
    };
    const bundle = buildBundle([first, second]);

    const result = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        count: 0,
      },
      [first, second],
      {
        runDir,
        generatedAt: FIXED_TS,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        signedBundle: bundle,
      },
    );

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_apply_failed");
    assert.equal(result.rolledBack, true);
    assert.equal((result.state as { count: number }).count, 0);
    assert.equal(firstRollbackCount, 1);
    assert.equal(secondRollbackCount, 1);
    await assert.rejects(
      readFile(join(runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME), "utf8"),
    );
  });
});

test("throwing migration condition rolls back prior evidence-bearing migrations", async () => {
  await withRunDir(async (runDir) => {
    let firstRollbackCount = 0;
    const first: Migration = {
      id: "first-condition-chain",
      description: "Applies before a later condition throws",
      evidenceBearing: true,
      condition: () => true,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        count: 1,
      }),
      rollback: (state) => {
        firstRollbackCount += 1;
        return {
          ...(state as Record<string, unknown>),
          count: 0,
        };
      },
    };
    const second: Migration = {
      id: "second-condition-throws",
      description: "Throws during condition evaluation",
      evidenceBearing: true,
      condition: () => {
        throw new Error("condition-boom");
      },
      apply: (state) => state,
      rollback: (state) => state,
    };
    const bundle = buildBundle([first, second]);

    const result = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        count: 0,
      },
      [first, second],
      {
        runDir,
        generatedAt: FIXED_TS,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        signedBundle: bundle,
      },
    );

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_apply_failed");
    assert.equal(result.rolledBack, true);
    assert.equal((result.state as { count: number }).count, 0);
    assert.equal(firstRollbackCount, 1);
  });
});

test("audit-log refusal rolls back evidence-bearing migrations and returns original state", async () => {
  await withRunDir(async (runDir) => {
    let rollbackCount = 0;
    const migration: Migration = {
      id: "audit-log-rollback",
      description: "Rolls back when the existing audit log is malformed",
      evidenceBearing: true,
      condition: () => true,
      apply: (state) => ({
        ...(state as Record<string, unknown>),
        count: 1,
      }),
      rollback: (state) => {
        rollbackCount += 1;
        return {
          ...(state as Record<string, unknown>),
          count: 0,
        };
      },
    };

    await writeFile(
      join(runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME),
      '{"broken":true}',
      "utf8",
    );

    const result = await runMigrations(
      {
        runDir,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        count: 0,
      },
      [migration],
      {
        runDir,
        generatedAt: FIXED_TS,
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        signedBundle: buildBundle([migration]),
      },
    );

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_apply_failed");
    assert.equal(result.rolledBack, true);
    assert.equal((result.state as { count: number }).count, 0);
    assert.equal(rollbackCount, 1);
    assert.equal(
      await readFile(join(runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME), "utf8"),
      '{"broken":true}',
    );
  });
});

test("duplicate migration ids fail closed", async () => {
  await withRunDir(async (runDir) => {
    const migration: Migration = {
      id: "dup-id",
      description: "Duplicate id fixture",
      condition: () => false,
      apply: (state) => state,
    };

    const result = await runMigrations({ runDir }, [migration, migration], {
      runDir,
      generatedAt: FIXED_TS,
    });

    assert.equal(result.status, "refused");
    assert.equal(result.code, "migration_registry_invalid");
  });
});
