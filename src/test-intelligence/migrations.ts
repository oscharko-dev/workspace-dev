import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ALLOWED_MIGRATION_REFUSAL_CODES,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  MIGRATION_BUNDLE_SCHEMA_VERSION,
  MIGRATIONS_LOG_ARTIFACT_FILENAME,
  type MigrationRefusalCode,
  type SignedMigrationBundle,
  type SignedMigrationBundleEntry,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

export interface Migration {
  readonly id: string;
  readonly description: string;
  /**
   * Optional stable hash registered in a signed migration bundle. When omitted
   * the runner derives a hash from the canonical migration descriptor.
   */
  readonly hash?: string;
  /**
   * When true, banking-profile runs require an explicit rollback handler and
   * failure paths must execute it cleanly before the runner refuses.
   */
  readonly evidenceBearing?: boolean;
  readonly condition: (state: unknown) => boolean;
  readonly apply: (state: unknown) => unknown;
  readonly rollback?: (state: unknown) => unknown;
}

export interface MigrationAuditEntry {
  readonly id: string;
  readonly ts: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}

export interface RunMigrationsOptions {
  readonly runDir: string;
  readonly generatedAt?: string | (() => string);
  readonly policyProfileId?: string;
  readonly signedBundle?: SignedMigrationBundle;
}

export interface MigrationSuccessResult {
  readonly status: "ok";
  readonly state: unknown;
  readonly applied: readonly MigrationAuditEntry[];
  readonly skippedIds: readonly string[];
  readonly auditLogPath: string;
}

export interface MigrationRefusalResult {
  readonly status: "refused";
  readonly code: MigrationRefusalCode;
  readonly message: string;
  readonly state: unknown;
  readonly migrationId?: string;
  readonly rolledBack: boolean;
  readonly auditLogPath?: string;
  readonly cause?: unknown;
}

export type MigrationResult = MigrationSuccessResult | MigrationRefusalResult;

const HEX_64_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MIGRATION_SENTINELS_KEY = "__workspaceDevMigrations";

type JsonObject = Record<string, unknown>;

interface ResolvedOptions {
  readonly runDir: string;
  readonly generatedAt: string;
  readonly policyProfileId?: string;
  readonly signedBundle?: SignedMigrationBundle;
}

interface AppliedMigrationRuntime {
  readonly migration: Migration;
  readonly hash: string;
  readonly evidenceBearing: boolean;
  readonly beforeState: unknown;
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeFunctionSource = (fn: (...args: never[]) => unknown): string =>
  fn.toString().replace(/\s+/gu, " ").trim();

const cloneState = <T>(value: T): T => structuredClone(value);

const createRefusal = (
  code: MigrationRefusalCode,
  message: string,
  state: unknown,
  overrides: Partial<
    Omit<MigrationRefusalResult, "status" | "code" | "message" | "state">
  > = {},
): MigrationRefusalResult => ({
  status: "refused",
  code,
  message,
  state,
  rolledBack: false,
  ...overrides,
});

const isAllowedMigrationRefusalCode = (
  value: unknown,
): value is MigrationRefusalCode =>
  typeof value === "string" &&
  (ALLOWED_MIGRATION_REFUSAL_CODES as readonly string[]).includes(value);

export const buildMigrationHash = (migration: Migration): string => {
  return sha256Hex({
    id: migration.id,
    description: migration.description,
    condition: normalizeFunctionSource(
      migration.condition as (...args: never[]) => unknown,
    ),
    apply: normalizeFunctionSource(
      migration.apply as (...args: never[]) => unknown,
    ),
    ...(migration.evidenceBearing === true ? { evidenceBearing: true } : {}),
    ...(migration.rollback !== undefined
      ? {
          rollback: normalizeFunctionSource(
            migration.rollback as (...args: never[]) => unknown,
          ),
        }
      : {}),
  });
};

const resolveMigrationHash = (migration: Migration): string => {
  const explicit = migration.hash?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  return buildMigrationHash(migration);
};

const resolveGeneratedAt = (
  value: RunMigrationsOptions["generatedAt"],
): string => {
  const resolved =
    typeof value === "function" ? value() : (value ?? new Date().toISOString());
  if (!ISO_8601_PATTERN.test(resolved)) {
    throw new TypeError(
      "runMigrations: generatedAt must resolve to an ISO-8601 timestamp",
    );
  }
  return resolved;
};

const resolveStatePolicyProfileId = (state: JsonObject): string | undefined => {
  const policyProfileId = state["policyProfileId"];
  if (typeof policyProfileId === "string" && policyProfileId.length > 0) {
    return policyProfileId;
  }
  const policyProfile = state["policyProfile"];
  if (isRecord(policyProfile)) {
    const id = policyProfile["id"];
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return undefined;
};

const resolveStateRunDir = (state: JsonObject): string | undefined => {
  const runDir = state["runDir"];
  if (typeof runDir === "string" && runDir.length > 0) {
    return runDir;
  }
  const paths = state["paths"];
  if (isRecord(paths)) {
    const nested = paths["runDir"];
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }
  return undefined;
};

const isSignedMigrationBundleEntry = (
  value: unknown,
): value is SignedMigrationBundleEntry => {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["hash"] === "string" &&
    HEX_64_PATTERN.test(value["hash"]) &&
    typeof value["description"] === "string" &&
    value["description"].length > 0 &&
    (value["evidenceBearing"] === undefined ||
      value["evidenceBearing"] === true ||
      value["evidenceBearing"] === false)
  );
};

const isSignedMigrationBundle = (
  value: unknown,
): value is SignedMigrationBundle => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== MIGRATION_BUNDLE_SCHEMA_VERSION ||
    typeof value["contractVersion"] !== "string" ||
    !Array.isArray(value["entries"])
  ) {
    return false;
  }
  return (value["entries"] as readonly unknown[]).every(
    isSignedMigrationBundleEntry,
  );
};

const resolveStateSignedBundle = (
  state: JsonObject,
): SignedMigrationBundle | undefined => {
  const direct = state["signedMigrationBundle"];
  return isSignedMigrationBundle(direct) ? direct : undefined;
};

const resolveOptions = (
  state: unknown,
  options: RunMigrationsOptions | undefined,
):
  | { ok: true; value: ResolvedOptions }
  | { ok: false; result: MigrationRefusalResult } => {
  if (options !== undefined) {
    if (typeof options.runDir !== "string" || options.runDir.length === 0) {
      return {
        ok: false,
        result: createRefusal(
          "migration_state_invalid",
          "runMigrations: options.runDir must be a non-empty string",
          state,
        ),
      };
    }
    return {
      ok: true,
      value: {
        runDir: options.runDir,
        generatedAt: resolveGeneratedAt(options.generatedAt),
        ...(options.policyProfileId !== undefined
          ? { policyProfileId: options.policyProfileId }
          : {}),
        ...(options.signedBundle !== undefined
          ? { signedBundle: options.signedBundle }
          : {}),
      },
    };
  }
  if (!isRecord(state)) {
    return {
      ok: false,
      result: createRefusal(
        "migration_state_invalid",
        "runMigrations: state must be an object when options are omitted",
        state,
      ),
    };
  }
  const runDir = resolveStateRunDir(state);
  const policyProfileId = resolveStatePolicyProfileId(state);
  const signedBundle = resolveStateSignedBundle(state);
  if (runDir === undefined) {
    return {
      ok: false,
      result: createRefusal(
        "migration_state_invalid",
        "runMigrations: state must expose runDir (or paths.runDir) when options are omitted",
        state,
      ),
    };
  }
  return {
    ok: true,
    value: {
      runDir,
      generatedAt: resolveGeneratedAt(undefined),
      ...(policyProfileId !== undefined ? { policyProfileId } : {}),
      ...(signedBundle !== undefined ? { signedBundle } : {}),
    },
  };
};

const getSentinelRecord = (
  state: JsonObject,
): Readonly<Record<string, string>> => {
  const sentinels = state[MIGRATION_SENTINELS_KEY];
  if (!isRecord(sentinels)) return {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(sentinels)) {
    if (typeof value === "string" && HEX_64_PATTERN.test(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
};

const withSentinel = (
  state: unknown,
  migrationId: string,
  migrationHash: string,
): unknown => {
  if (!isRecord(state)) return state;
  return {
    ...state,
    [MIGRATION_SENTINELS_KEY]: {
      ...getSentinelRecord(state),
      [migrationId]: migrationHash,
    },
  };
};

const validateRegistry = (
  state: unknown,
  registry: readonly Migration[],
): MigrationRefusalResult | undefined => {
  const seen = new Set<string>();
  for (const migration of registry) {
    if (typeof migration.id !== "string" || migration.id.trim().length === 0) {
      return createRefusal(
        "migration_registry_invalid",
        "runMigrations: every migration must have a non-empty id",
        state,
      );
    }
    if (
      typeof migration.description !== "string" ||
      migration.description.trim().length === 0
    ) {
      return createRefusal(
        "migration_registry_invalid",
        `runMigrations: migration "${migration.id}" must have a non-empty description`,
        state,
        { migrationId: migration.id },
      );
    }
    const hash = resolveMigrationHash(migration);
    if (!HEX_64_PATTERN.test(hash)) {
      return createRefusal(
        "migration_registry_invalid",
        `runMigrations: migration "${migration.id}" hash must be a lowercase sha256 hex string`,
        state,
        { migrationId: migration.id },
      );
    }
    if (
      migration.evidenceBearing === true &&
      migration.rollback === undefined
    ) {
      return createRefusal(
        "migration_rollback_required",
        `runMigrations: migration "${migration.id}" mutates evidence-bearing state and requires rollback`,
        state,
        { migrationId: migration.id },
      );
    }
    if (seen.has(migration.id)) {
      return createRefusal(
        "migration_registry_invalid",
        `runMigrations: duplicate migration id "${migration.id}"`,
        state,
        { migrationId: migration.id },
      );
    }
    seen.add(migration.id);
  }
  return undefined;
};

const parseExistingAuditLog = async (
  auditLogPath: string,
): Promise<readonly MigrationAuditEntry[] | undefined> => {
  try {
    const payload = await readFile(auditLogPath, "utf8");
    return parseMigrationAuditLog(payload);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
};

const persistAuditEntries = async (
  auditLogPath: string,
  entries: readonly MigrationAuditEntry[],
): Promise<true | MigrationRefusalResult> => {
  if (entries.length === 0) return true;
  const existing = await parseExistingAuditLog(auditLogPath);
  if (existing === undefined) {
    return createRefusal(
      "migration_audit_log_invalid",
      `runMigrations: existing migration audit log at "${auditLogPath}" is malformed`,
      undefined,
      { auditLogPath },
    );
  }
  const payload = `${[...existing, ...entries].map((entry) => canonicalJson(entry)).join("\n")}\n`;
  const tmpPath = `${auditLogPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(auditLogPath), { recursive: true });
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, auditLogPath);
  return true;
};

const matchesBundleEntry = (
  entry: SignedMigrationBundleEntry,
  migration: Migration,
  hash: string,
): boolean => entry.id === migration.id && entry.hash === hash;

const requireSignedMigration = (
  migration: Migration,
  hash: string,
  options: ResolvedOptions,
  state: unknown,
  auditLogPath: string,
): MigrationRefusalResult | undefined => {
  if (options.policyProfileId !== EU_BANKING_DEFAULT_POLICY_PROFILE_ID) {
    return undefined;
  }
  if (options.signedBundle === undefined) {
    return createRefusal(
      "migration_unsigned",
      `runMigrations: banking profile requires a signed migration bundle for "${migration.id}"`,
      state,
      {
        migrationId: migration.id,
        auditLogPath,
      },
    );
  }
  const entry = options.signedBundle.entries.find((candidate) =>
    matchesBundleEntry(candidate, migration, hash),
  );
  if (entry === undefined) {
    return createRefusal(
      "migration_unsigned",
      `runMigrations: banking profile requires signed bundle entry for "${migration.id}" (${hash})`,
      state,
      {
        migrationId: migration.id,
        auditLogPath,
      },
    );
  }
  return undefined;
};

const normalizeReturnedState = (
  returned: unknown,
  fallback: unknown,
): unknown => (returned === undefined ? fallback : returned);

const executeRollback = async (
  migration: Migration,
  rollbackState: unknown,
): Promise<unknown> => {
  if (migration.rollback === undefined) {
    return rollbackState;
  }
  const cloned = cloneState(rollbackState);
  const rolledBack = await migration.rollback(cloned);
  return normalizeReturnedState(rolledBack, cloned);
};

export const parseMigrationAuditLog = (
  payload: string,
): readonly MigrationAuditEntry[] | undefined => {
  if (payload.length === 0) return [];
  if (!payload.endsWith("\n")) return undefined;
  const lines = payload.slice(0, -1).split("\n");
  const entries: MigrationAuditEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isRecord(parsed)) return undefined;
    const entry: MigrationAuditEntry = {
      id: parsed["id"] as string,
      ts: parsed["ts"] as string,
      beforeHash: parsed["beforeHash"] as string,
      afterHash: parsed["afterHash"] as string,
    };
    if (
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.ts !== "string" ||
      !ISO_8601_PATTERN.test(entry.ts) ||
      typeof entry.beforeHash !== "string" ||
      !HEX_64_PATTERN.test(entry.beforeHash) ||
      typeof entry.afterHash !== "string" ||
      !HEX_64_PATTERN.test(entry.afterHash)
    ) {
      return undefined;
    }
    entries.push(entry);
  }
  return entries;
};

const getSentinelHash = (
  state: unknown,
  migrationId: string,
): string | undefined => {
  if (!isRecord(state)) return undefined;
  const sentinels = getSentinelRecord(state);
  return sentinels[migrationId];
};

export async function runMigrations(
  state: unknown,
  registry: readonly Migration[],
): Promise<MigrationResult>;
export async function runMigrations(
  state: unknown,
  registry: readonly Migration[],
  options: RunMigrationsOptions,
): Promise<MigrationResult>;
export async function runMigrations(
  state: unknown,
  registry: readonly Migration[],
  options?: RunMigrationsOptions,
): Promise<MigrationResult> {
  const registryValidation = validateRegistry(state, registry);
  if (registryValidation !== undefined) {
    return registryValidation;
  }

  const resolvedOptions = resolveOptions(state, options);
  if (!resolvedOptions.ok) {
    return resolvedOptions.result;
  }
  const config = resolvedOptions.value;
  const auditLogPath = join(config.runDir, MIGRATIONS_LOG_ARTIFACT_FILENAME);

  let workingState = cloneState(state);
  const applied: MigrationAuditEntry[] = [];
  const appliedRuntime: AppliedMigrationRuntime[] = [];
  const skippedIds: string[] = [];

  for (const migration of registry) {
    const migrationHash = resolveMigrationHash(migration);
    const existingSentinel = getSentinelHash(workingState, migration.id);
    if (existingSentinel === migrationHash) {
      skippedIds.push(migration.id);
      continue;
    }
    if (existingSentinel !== undefined && existingSentinel !== migrationHash) {
      return createRefusal(
        "migration_registry_invalid",
        `runMigrations: migration "${migration.id}" was previously applied with a different hash`,
        workingState,
        {
          migrationId: migration.id,
          auditLogPath,
        },
      );
    }
    if (!migration.condition(workingState)) {
      skippedIds.push(migration.id);
      continue;
    }

    const unsignedRefusal = requireSignedMigration(
      migration,
      migrationHash,
      config,
      workingState,
      auditLogPath,
    );
    if (unsignedRefusal !== undefined) {
      return unsignedRefusal;
    }

    const beforeState = cloneState(workingState);
    const beforeHash = sha256Hex(beforeState);
    const candidateState = cloneState(workingState);

    try {
      const appliedState = normalizeReturnedState(
        await migration.apply(candidateState),
        candidateState,
      );
      const nextState = withSentinel(appliedState, migration.id, migrationHash);
      const afterHash = sha256Hex(nextState);
      workingState = nextState;
      applied.push({
        id: migration.id,
        ts: config.generatedAt,
        beforeHash,
        afterHash,
      });
      appliedRuntime.push({
        migration,
        hash: migrationHash,
        evidenceBearing: migration.evidenceBearing === true,
        beforeState,
      });
    } catch (error) {
      try {
        if (migration.evidenceBearing === true) {
          await executeRollback(migration, candidateState);
        }
        let rollbackState = cloneState(workingState);
        for (const appliedMigration of [...appliedRuntime].reverse()) {
          if (appliedMigration.evidenceBearing === true) {
            rollbackState = await executeRollback(
              appliedMigration.migration,
              rollbackState,
            );
          } else {
            rollbackState = cloneState(appliedMigration.beforeState);
          }
        }
      } catch (rollbackError) {
        return createRefusal(
          "migration_rollback_failed",
          `runMigrations: rollback failed after migration "${migration.id}" errored`,
          cloneState(state),
          {
            migrationId: migration.id,
            rolledBack: false,
            auditLogPath,
            cause: rollbackError,
          },
        );
      }
      return createRefusal(
        "migration_apply_failed",
        `runMigrations: migration "${migration.id}" failed and rollback completed cleanly`,
        cloneState(state),
        {
          migrationId: migration.id,
          rolledBack: true,
          auditLogPath,
          cause: error,
        },
      );
    }
  }

  const persisted = await persistAuditEntries(auditLogPath, applied);
  if (persisted !== true) {
    return { ...persisted, state: workingState };
  }

  return {
    status: "ok",
    state: workingState,
    applied,
    skippedIds,
    auditLogPath,
  };
}

// Keep the module-level literal list honest when the contract surface changes.
if (
  !ALLOWED_MIGRATION_REFUSAL_CODES.every((code) =>
    isAllowedMigrationRefusalCode(code),
  )
) {
  throw new TypeError("migration refusal code contract is inconsistent");
}
