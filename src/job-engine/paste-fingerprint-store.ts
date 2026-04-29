// ---------------------------------------------------------------------------
// paste-fingerprint-store.ts — Per-paste fingerprint manifest store.
// JSON-on-disk store with LRU eviction (by access mtime) and TTL, keyed by
// a stable "paste identity" (figma file key + root node ids). Powers the
// incremental delta-import flow: on each paste we persist subtree hashes
// so future pastes of the same component can be diffed against the prior
// manifest. See issue #992.
// ---------------------------------------------------------------------------
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONTRACT_VERSION,
  type WorkspaceImportMode,
  type WorkspacePasteDeltaStrategy,
  type WorkspacePasteDeltaSummary,
} from "../contracts/index.js";

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
const IDENTITY_KEY_LENGTH = 32;
const PASTE_DELTA_COMPATIBILITY_VERSION = 2;

export interface PasteFingerprintNode {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly subtreeHash: string;
  readonly depth: number;
}

export interface PasteGeneratedArtifactHash {
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface PasteFingerprintExecution {
  readonly requestedMode: WorkspaceImportMode;
  readonly effectiveMode: WorkspacePasteDeltaSummary["mode"];
  readonly strategy: WorkspacePasteDeltaStrategy;
  readonly changedNodeIds: readonly string[];
  readonly changedRootNodeIds: readonly string[];
  readonly compatibilityFingerprint?: string;
  readonly generatedArtifactHashes?: readonly PasteGeneratedArtifactHash[];
}

export interface PasteFingerprintManifest {
  readonly contractVersion: string;
  readonly pasteIdentityKey: string;
  readonly createdAt: string;
  readonly rootNodeIds: readonly string[];
  readonly nodes: readonly PasteFingerprintNode[];
  readonly figmaFileKey?: string;
  readonly sourceJobId?: string;
  readonly execution?: PasteFingerprintExecution;
}

export interface PasteFingerprintStoreOptions {
  readonly rootDir: string;
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface PasteFingerprintStore {
  load(identityKey: string): Promise<PasteFingerprintManifest | undefined>;
  save(manifest: PasteFingerprintManifest): Promise<void>;
  delete(identityKey: string): Promise<void>;
  size(): Promise<number>;
}

const toCanonicalJsonValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      output[key] = toCanonicalJsonValue(record[key]);
    }
    return output;
  }
  return value;
};

const sortedUnique = (values: readonly string[]): string[] => {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
};

export const computePasteIdentityKey = (input: {
  readonly figmaFileKey?: string;
  readonly rootNodeIds: readonly string[];
}): string => {
  if (input.rootNodeIds.length === 0) {
    throw new Error("rootNodeIds cannot be empty");
  }
  const rootNodeIds = sortedUnique(input.rootNodeIds);
  const payload: Record<string, unknown> = { rootNodeIds };
  if (input.figmaFileKey !== undefined) {
    payload.figmaFileKey = input.figmaFileKey;
  }
  const canonical = JSON.stringify(toCanonicalJsonValue(payload));
  return createHash("sha256").update(canonical).digest("hex").slice(0, IDENTITY_KEY_LENGTH);
};

export const computePasteCompatibilityFingerprint = (input: {
  readonly pipelineId?: string;
  readonly templateBundleId?: string;
  readonly figmaSourceMode: string;
  readonly brandTheme: string;
  readonly customerBrandId?: string;
  readonly customerProfileSnapshot?: unknown;
  readonly componentMappings?: unknown;
  readonly storybookStaticDir?: string;
  readonly generationLocale: string;
  readonly formHandlingMode: string;
  readonly routerMode: string;
  readonly screenElementBudget: number;
  readonly screenElementMaxDepth: number;
  readonly exportImages: boolean;
}): string => {
  const canonical = JSON.stringify(
    toCanonicalJsonValue({
      figmaSourceMode: input.figmaSourceMode,
      ...(input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
      ...(input.templateBundleId !== undefined
        ? { templateBundleId: input.templateBundleId }
        : {}),
      brandTheme: input.brandTheme,
      ...(input.customerBrandId !== undefined
        ? { customerBrandId: input.customerBrandId }
        : {}),
      ...(input.customerProfileSnapshot !== undefined
        ? { customerProfileSnapshot: input.customerProfileSnapshot }
        : {}),
      ...(input.componentMappings !== undefined
        ? { componentMappings: input.componentMappings }
        : {}),
      ...(input.storybookStaticDir !== undefined
        ? { storybookStaticDir: input.storybookStaticDir }
        : {}),
      generationLocale: input.generationLocale,
      formHandlingMode: input.formHandlingMode,
      routerMode: input.routerMode,
      screenElementBudget: input.screenElementBudget,
      screenElementMaxDepth: input.screenElementMaxDepth,
      exportImages: input.exportImages,
      contractVersion: CONTRACT_VERSION,
      pasteDeltaCompatibilityVersion: PASTE_DELTA_COMPATIBILITY_VERSION,
    }),
  );
  return createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, IDENTITY_KEY_LENGTH);
};

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error;
};

const isValidNode = (value: unknown): value is PasteFingerprintNode => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    (record.parentId === null || typeof record.parentId === "string") &&
    typeof record.subtreeHash === "string" &&
    typeof record.depth === "number"
  );
};

const isValidGeneratedArtifactHash = (
  value: unknown,
): value is PasteGeneratedArtifactHash => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.relativePath === "string" &&
    typeof record.sha256 === "string" &&
    typeof record.sizeBytes === "number"
  );
};

const isValidExecution = (
  value: unknown,
): value is PasteFingerprintExecution => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.requestedMode !== "string" ||
    typeof record.effectiveMode !== "string" ||
    typeof record.strategy !== "string" ||
    !Array.isArray(record.changedNodeIds) ||
    !Array.isArray(record.changedRootNodeIds)
  ) {
    return false;
  }
  if (!record.changedNodeIds.every((entry) => typeof entry === "string")) {
    return false;
  }
  if (!record.changedRootNodeIds.every((entry) => typeof entry === "string")) {
    return false;
  }
  if (
    record.compatibilityFingerprint !== undefined &&
    typeof record.compatibilityFingerprint !== "string"
  ) {
    return false;
  }
  if (
    record.generatedArtifactHashes !== undefined &&
    (!Array.isArray(record.generatedArtifactHashes) ||
      !record.generatedArtifactHashes.every(isValidGeneratedArtifactHash))
  ) {
    return false;
  }
  return true;
};

const isValidManifest = (value: unknown): value is PasteFingerprintManifest => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.contractVersion !== "string" ||
    typeof record.pasteIdentityKey !== "string" ||
    typeof record.createdAt !== "string" ||
    !Array.isArray(record.rootNodeIds) ||
    !Array.isArray(record.nodes)
  ) {
    return false;
  }
  if (!record.rootNodeIds.every((entry) => typeof entry === "string")) {
    return false;
  }
  if (!record.nodes.every(isValidNode)) {
    return false;
  }
  if (record.figmaFileKey !== undefined && typeof record.figmaFileKey !== "string") {
    return false;
  }
  if (record.sourceJobId !== undefined && typeof record.sourceJobId !== "string") {
    return false;
  }
  if (record.execution !== undefined && !isValidExecution(record.execution)) {
    return false;
  }
  return true;
};

const manifestFilePath = (rootDir: string, identityKey: string): string => {
  return path.join(rootDir, `${identityKey}.json`);
};

const listManifestFiles = async (rootDir: string): Promise<string[]> => {
  try {
    const entries = await readdir(rootDir);
    return entries.filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }
};

const enforceMaxEntries = async ({
  rootDir,
  maxEntries
}: {
  rootDir: string;
  maxEntries: number;
}): Promise<void> => {
  const files = await listManifestFiles(rootDir);
  if (files.length <= maxEntries) {
    return;
  }

  const withStats = await Promise.all(
    files.map(async (name) => {
      const filePath = path.join(rootDir, name);
      try {
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    })
  );

  withStats.sort((left, right) => left.mtimeMs - right.mtimeMs);

  const excess = withStats.length - maxEntries;
  for (let index = 0; index < excess; index += 1) {
    const entry = withStats[index];
    if (entry === undefined) {
      continue;
    }
    try {
      await unlink(entry.filePath);
    } catch {
      // Best-effort eviction.
    }
  }
};

export const createPasteFingerprintStore = (opts: PasteFingerprintStoreOptions): PasteFingerprintStore => {
  const rootDir = opts.rootDir;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;

  const load = async (identityKey: string): Promise<PasteFingerprintManifest | undefined> => {
    const filePath = manifestFilePath(rootDir, identityKey);

    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      return undefined;
    }

    const age = now() - fileStat.mtimeMs;
    if (age > ttlMs) {
      try {
        await unlink(filePath);
      } catch {
        // Best-effort removal.
      }
      return undefined;
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }

    if (!isValidManifest(parsed)) {
      return undefined;
    }

    if (parsed.contractVersion !== CONTRACT_VERSION) {
      return undefined;
    }

    const touchedAt = new Date(now());
    try {
      await utimes(filePath, touchedAt, touchedAt);
    } catch {
      // LRU touch is best-effort.
    }

    return parsed;
  };

  const save = async (manifest: PasteFingerprintManifest): Promise<void> => {
    await mkdir(rootDir, { recursive: true });
    const filePath = manifestFilePath(rootDir, manifest.pasteIdentityKey);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
    await enforceMaxEntries({ rootDir, maxEntries });
  };

  const remove = async (identityKey: string): Promise<void> => {
    const filePath = manifestFilePath(rootDir, identityKey);
    try {
      await unlink(filePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  };

  const size = async (): Promise<number> => {
    const files = await listManifestFiles(rootDir);
    return files.length;
  };

  return {
    load,
    save,
    delete: remove,
    size
  };
};
