import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeTargetPath, toScopePath } from "./target-path.js";

const EXCLUDED_SOURCE_DIRS = new Set(["node_modules"]);
const LOCAL_SYNC_BASELINE_VERSION = 1;
const LOCAL_SYNC_BASELINE_DIR_NAME = "local-sync-baselines";
const LOCAL_SYNC_BASELINE_FILE_NAME = "baseline.json";

export type LocalSyncFileAction = "create" | "overwrite" | "none";
export type LocalSyncFileStatus = "create" | "overwrite" | "conflict" | "untracked" | "unchanged";
export type LocalSyncFileReason =
  | "new_file"
  | "managed_destination_unchanged"
  | "destination_modified_since_sync"
  | "destination_deleted_since_sync"
  | "existing_without_baseline"
  | "already_matches_generated";
export type LocalSyncFileDecision = "write" | "skip";

interface LocalSyncBaselineFileEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
  syncedAt: string;
  jobId: string;
  sourceJobId: string;
}

interface LocalSyncBaselineSnapshot {
  version: number;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  updatedAt: string;
  files: LocalSyncBaselineFileEntry[];
}

interface GeneratedSourceFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface DestinationFileState {
  exists: boolean;
  sha256?: string;
  sizeBytes?: number;
}

export interface LocalSyncPlannedFile {
  relativePath: string;
  sourcePath: string;
  destinationPath: string;
  action: LocalSyncFileAction;
  status: LocalSyncFileStatus;
  reason: LocalSyncFileReason;
  decision: LocalSyncFileDecision;
  selectedByDefault: boolean;
  sizeBytes: number;
  message: string;
  sourceSha256: string;
  destinationSha256?: string;
  baselineSha256?: string;
}

export interface LocalSyncSummary {
  totalFiles: number;
  selectedFiles: number;
  createCount: number;
  overwriteCount: number;
  conflictCount: number;
  untrackedCount: number;
  unchangedCount: number;
  totalBytes: number;
  selectedBytes: number;
}

export interface LocalSyncPlan {
  workspaceRoot: string;
  sourceRoot: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  baselinePath: string;
  baselineSnapshot: LocalSyncBaselineSnapshot | null;
  files: LocalSyncPlannedFile[];
  summary: LocalSyncSummary;
}

export class LocalSyncError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalSyncError";
    this.code = code;
  }
}

const computeSha256 = (content: Buffer): string => {
  return createHash("sha256").update(content).digest("hex");
};

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isWithinRoot = ({
  candidatePath,
  rootPath
}: {
  candidatePath: string;
  rootPath: string;
}): boolean => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
};

const assertWithinRoot = ({
  candidatePath,
  rootPath,
  message
}: {
  candidatePath: string;
  rootPath: string;
  message: string;
}): void => {
  if (!isWithinRoot({ candidatePath, rootPath })) {
    throw new LocalSyncError("E_SYNC_DESTINATION_UNSAFE", message);
  }
};

const assertNoSymlinkOrFileInExistingParents = async ({
  rootPath,
  candidatePath
}: {
  rootPath: string;
  candidatePath: string;
}): Promise<void> => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative.startsWith("..")) {
    throw new LocalSyncError("E_SYNC_DESTINATION_UNSAFE", "Resolved path escapes the allowed destination root.");
  }

  let current = resolvedRoot;
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new LocalSyncError("E_SYNC_DESTINATION_SYMLINK", `Destination path contains a symbolic link: ${current}`);
      }
      if (!currentStat.isDirectory()) {
        throw new LocalSyncError("E_SYNC_DESTINATION_CONFLICT", `Destination parent is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
};

const assertDestinationRootSafety = async ({
  workspaceRoot,
  destinationRoot
}: {
  workspaceRoot: string;
  destinationRoot: string;
}): Promise<void> => {
  assertWithinRoot({
    candidatePath: destinationRoot,
    rootPath: workspaceRoot,
    message: "Resolved sync destination escapes the runtime workspace root."
  });
  await assertNoSymlinkOrFileInExistingParents({
    rootPath: workspaceRoot,
    candidatePath: destinationRoot
  });
};

const readSafeDestinationFileState = async ({
  destinationRoot,
  destinationPath
}: {
  destinationRoot: string;
  destinationPath: string;
}): Promise<DestinationFileState> => {
  assertWithinRoot({
    candidatePath: destinationPath,
    rootPath: destinationRoot,
    message: "Resolved file destination escapes sync destination root."
  });

  await assertNoSymlinkOrFileInExistingParents({
    rootPath: destinationRoot,
    candidatePath: path.dirname(destinationPath)
  });

  try {
    const destinationStat = await lstat(destinationPath);
    if (destinationStat.isSymbolicLink()) {
      throw new LocalSyncError("E_SYNC_DESTINATION_SYMLINK", `Destination path is a symbolic link: ${destinationPath}`);
    }
    if (destinationStat.isDirectory()) {
      throw new LocalSyncError("E_SYNC_DESTINATION_CONFLICT", `Destination path is a directory: ${destinationPath}`);
    }

    const content = await readFile(destinationPath);
    return {
      exists: true,
      sha256: computeSha256(content),
      sizeBytes: destinationStat.size
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false
      };
    }
    throw error;
  }
};

const collectGeneratedSourceFiles = async ({
  sourceRoot
}: {
  sourceRoot: string;
}): Promise<GeneratedSourceFile[]> => {
  const files: GeneratedSourceFile[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(currentDir);
    } catch (error) {
      throw new LocalSyncError(
        "E_SYNC_GENERATED_DIR_MISSING",
        `Could not read generated output directory: ${(error as Error).message}`
      );
    }

    names.sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      if (EXCLUDED_SOURCE_DIRS.has(name)) {
        continue;
      }

      const absolutePath = path.join(currentDir, name);
      let candidateStat: Awaited<ReturnType<typeof lstat>>;
      try {
        candidateStat = await lstat(absolutePath);
      } catch (error) {
        throw new LocalSyncError(
          "E_SYNC_GENERATED_DIR_MISSING",
          `Could not stat generated file '${absolutePath}': ${(error as Error).message}`
        );
      }

      if (candidateStat.isSymbolicLink()) {
        throw new LocalSyncError("E_SYNC_SOURCE_SYMLINK", `Generated output contains unsupported symbolic link '${absolutePath}'.`);
      }

      if (candidateStat.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (candidateStat.isFile()) {
        const content = await readFile(absolutePath);
        files.push({
          absolutePath,
          relativePath: toPosixPath(path.relative(sourceRoot, absolutePath)),
          sizeBytes: candidateStat.size,
          sha256: computeSha256(content)
        });
      }
    }
  };

  await walk(sourceRoot);
  return files;
};

const resolveBaselinePath = ({
  outputRoot,
  scopePath
}: {
  outputRoot: string;
  scopePath: string;
}): string => {
  const segments = scopePath.split("/").filter((segment) => segment.length > 0);
  return path.join(path.resolve(outputRoot), LOCAL_SYNC_BASELINE_DIR_NAME, ...segments, LOCAL_SYNC_BASELINE_FILE_NAME);
};

const isBaselineFileEntry = (value: unknown): value is LocalSyncBaselineFileEntry => {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.sha256 === "string" &&
    typeof value.sizeBytes === "number" &&
    typeof value.syncedAt === "string" &&
    typeof value.jobId === "string" &&
    typeof value.sourceJobId === "string"
  );
};

const isBaselineSnapshot = (value: unknown): value is LocalSyncBaselineSnapshot => {
  return (
    isRecord(value) &&
    value.version === LOCAL_SYNC_BASELINE_VERSION &&
    typeof value.boardKey === "string" &&
    typeof value.targetPath === "string" &&
    typeof value.scopePath === "string" &&
    typeof value.destinationRoot === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.files) &&
    value.files.every((entry) => isBaselineFileEntry(entry))
  );
};

const loadLocalSyncBaseline = async ({
  outputRoot,
  scopePath
}: {
  outputRoot: string;
  scopePath: string;
}): Promise<{ baselinePath: string; snapshot: LocalSyncBaselineSnapshot | null }> => {
  const baselinePath = resolveBaselinePath({ outputRoot, scopePath });
  try {
    const raw = await readFile(baselinePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isBaselineSnapshot(parsed)) {
      throw new LocalSyncError("E_SYNC_BASELINE_INVALID", `Local sync baseline is invalid at '${baselinePath}'.`);
    }
    return {
      baselinePath,
      snapshot: parsed
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        baselinePath,
        snapshot: null
      };
    }
    throw error;
  }
};

const saveLocalSyncBaseline = async ({
  baselinePath,
  snapshot
}: {
  baselinePath: string;
  snapshot: LocalSyncBaselineSnapshot;
}): Promise<void> => {
  try {
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new LocalSyncError(
      "E_SYNC_BASELINE_WRITE_FAILED",
      `Could not persist local sync baseline '${baselinePath}': ${(error as Error).message}`
    );
  }
};

const summarizePlannedFiles = ({
  files
}: {
  files: LocalSyncPlannedFile[];
}): LocalSyncSummary => {
  let createCount = 0;
  let overwriteCount = 0;
  let conflictCount = 0;
  let untrackedCount = 0;
  let unchangedCount = 0;
  let totalBytes = 0;
  let selectedFiles = 0;
  let selectedBytes = 0;

  for (const entry of files) {
    totalBytes += entry.sizeBytes;
    if (entry.decision === "write") {
      selectedFiles += 1;
      selectedBytes += entry.sizeBytes;
    }

    if (entry.status === "create") {
      createCount += 1;
    } else if (entry.status === "overwrite") {
      overwriteCount += 1;
    } else if (entry.status === "conflict") {
      conflictCount += 1;
    } else if (entry.status === "untracked") {
      untrackedCount += 1;
    } else if (entry.status === "unchanged") {
      unchangedCount += 1;
    }
  }

  return {
    totalFiles: files.length,
    selectedFiles,
    createCount,
    overwriteCount,
    conflictCount,
    untrackedCount,
    unchangedCount,
    totalBytes,
    selectedBytes
  };
};

const createPlannedFile = ({
  sourceFile,
  destinationPath,
  destinationState,
  baselineEntry
}: {
  sourceFile: GeneratedSourceFile;
  destinationPath: string;
  destinationState: DestinationFileState;
  baselineEntry: LocalSyncBaselineFileEntry | undefined;
}): LocalSyncPlannedFile => {
  const baseEntry = {
    relativePath: sourceFile.relativePath,
    sourcePath: sourceFile.absolutePath,
    destinationPath,
    sizeBytes: sourceFile.sizeBytes,
    sourceSha256: sourceFile.sha256,
    ...(destinationState.sha256 ? { destinationSha256: destinationState.sha256 } : {}),
    ...(baselineEntry?.sha256 ? { baselineSha256: baselineEntry.sha256 } : {})
  };

  if (!destinationState.exists) {
    if (baselineEntry) {
      return {
        ...baseEntry,
        action: "create",
        status: "conflict",
        reason: "destination_deleted_since_sync",
        decision: "skip",
        selectedByDefault: false,
        message: "Destination file was deleted after the last sync. Review before recreating it."
      };
    }
    return {
      ...baseEntry,
      action: "create",
      status: "create",
      reason: "new_file",
      decision: "write",
      selectedByDefault: true,
      message: "File will be created in the destination tree."
    };
  }

  if (!baselineEntry) {
    if (destinationState.sha256 === sourceFile.sha256) {
      return {
        ...baseEntry,
        action: "none",
        status: "unchanged",
        reason: "already_matches_generated",
        decision: "skip",
        selectedByDefault: false,
        message: "Destination already matches the generated output. No write is needed."
      };
    }
    return {
      ...baseEntry,
      action: "overwrite",
      status: "untracked",
      reason: "existing_without_baseline",
      decision: "skip",
      selectedByDefault: false,
      message: "Destination exists without a local-sync baseline. Review before overwriting it."
    };
  }

  if (destinationState.sha256 === sourceFile.sha256) {
    return {
      ...baseEntry,
      action: "none",
      status: "unchanged",
      reason: "already_matches_generated",
      decision: "skip",
      selectedByDefault: false,
      message: "Destination already matches the generated output. No write is needed."
    };
  }

  if (destinationState.sha256 === baselineEntry.sha256) {
    return {
      ...baseEntry,
      action: "overwrite",
      status: "overwrite",
      reason: "managed_destination_unchanged",
      decision: "write",
      selectedByDefault: true,
      message: "Destination matches the last synced baseline and can be overwritten safely."
    };
  }

  return {
    ...baseEntry,
    action: "overwrite",
    status: "conflict",
    reason: "destination_modified_since_sync",
    decision: "skip",
    selectedByDefault: false,
    message: "Destination was modified after the last sync. Review before overwriting it."
  };
};

const applyDecisionsToPlan = ({
  plan,
  decisionByPath
}: {
  plan: LocalSyncPlan;
  decisionByPath: Map<string, LocalSyncFileDecision>;
}): LocalSyncPlan => {
  const files = plan.files.map((entry) => ({
    ...entry,
    decision: decisionByPath.get(entry.relativePath) ?? entry.decision
  }));
  return {
    ...plan,
    files,
    summary: summarizePlannedFiles({ files })
  };
};

const validateFileDecisions = ({
  plan,
  fileDecisions
}: {
  plan: LocalSyncPlan;
  fileDecisions: Array<{ path: string; decision: LocalSyncFileDecision }>;
}): Map<string, LocalSyncFileDecision> => {
  const decisionByPath = new Map<string, LocalSyncFileDecision>();
  for (const entry of fileDecisions) {
    const normalizedPath = entry.path.trim();
    if (normalizedPath.length === 0) {
      throw new LocalSyncError("E_SYNC_FILE_DECISIONS_INVALID", "File decision paths must be non-empty.");
    }
    if (decisionByPath.has(normalizedPath)) {
      throw new LocalSyncError("E_SYNC_FILE_DECISIONS_INVALID", `Duplicate file decision received for '${normalizedPath}'.`);
    }
    decisionByPath.set(normalizedPath, entry.decision);
  }

  for (const plannedFile of plan.files) {
    const decision = decisionByPath.get(plannedFile.relativePath);
    if (!decision) {
      throw new LocalSyncError(
        "E_SYNC_FILE_DECISIONS_INVALID",
        `Missing file decision for '${plannedFile.relativePath}'.`
      );
    }
    if (plannedFile.action === "none" && decision === "write") {
      throw new LocalSyncError(
        "E_SYNC_FILE_DECISIONS_INVALID",
        `File '${plannedFile.relativePath}' already matches the generated output and cannot be written again.`
      );
    }
  }

  for (const decidedPath of decisionByPath.keys()) {
    if (!plan.files.some((entry) => entry.relativePath === decidedPath)) {
      throw new LocalSyncError(
        "E_SYNC_FILE_DECISIONS_INVALID",
        `Received a file decision for unknown path '${decidedPath}'.`
      );
    }
  }

  const selectedWriteCount = plan.files.filter((entry) => decisionByPath.get(entry.relativePath) === "write").length;
  if (selectedWriteCount === 0) {
    throw new LocalSyncError("E_SYNC_FILE_DECISIONS_INVALID", "Select at least one file to write before applying local sync.");
  }

  return decisionByPath;
};

export const computeLocalSyncPlanFingerprint = ({
  plan
}: {
  plan: LocalSyncPlan;
}): string => {
  const canonical = {
    boardKey: plan.boardKey,
    targetPath: plan.targetPath,
    scopePath: plan.scopePath,
    destinationRoot: plan.destinationRoot,
    files: plan.files.map((entry) => ({
      relativePath: entry.relativePath,
      action: entry.action,
      status: entry.status,
      reason: entry.reason,
      decision: entry.decision,
      selectedByDefault: entry.selectedByDefault,
      sizeBytes: entry.sizeBytes,
      sourceSha256: entry.sourceSha256,
      destinationSha256: entry.destinationSha256 ?? null,
      baselineSha256: entry.baselineSha256 ?? null
    }))
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

export const planLocalSync = async ({
  generatedProjectDir,
  workspaceRoot,
  outputRoot,
  targetPath,
  boardKey
}: {
  generatedProjectDir: string;
  workspaceRoot: string;
  outputRoot: string;
  targetPath: string | undefined;
  boardKey: string;
}): Promise<LocalSyncPlan> => {
  const resolvedSourceRoot = path.resolve(generatedProjectDir);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const normalizedTargetPath = (() => {
    try {
      return sanitizeTargetPath(targetPath);
    } catch (error) {
      throw new LocalSyncError("E_SYNC_TARGET_PATH_INVALID", (error as Error).message);
    }
  })();
  const scopePath = toScopePath({ targetPath: normalizedTargetPath, boardKey });
  const destinationRoot = path.resolve(resolvedWorkspaceRoot, scopePath);

  await assertDestinationRootSafety({
    workspaceRoot: resolvedWorkspaceRoot,
    destinationRoot
  });

  const { baselinePath, snapshot: baselineSnapshot } = await loadLocalSyncBaseline({
    outputRoot: resolvedOutputRoot,
    scopePath
  });
  const baselineByPath = new Map<string, LocalSyncBaselineFileEntry>();
  for (const entry of baselineSnapshot?.files ?? []) {
    baselineByPath.set(entry.path, entry);
  }

  const sourceFiles = await collectGeneratedSourceFiles({ sourceRoot: resolvedSourceRoot });
  const plannedFiles: LocalSyncPlannedFile[] = [];

  for (const sourceFile of sourceFiles) {
    const destinationPath = path.resolve(destinationRoot, sourceFile.relativePath);
    const destinationState = await readSafeDestinationFileState({
      destinationRoot,
      destinationPath
    });
    plannedFiles.push(
      createPlannedFile({
        sourceFile,
        destinationPath,
        destinationState,
        baselineEntry: baselineByPath.get(sourceFile.relativePath)
      })
    );
  }

  plannedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    sourceRoot: resolvedSourceRoot,
    boardKey,
    targetPath: normalizedTargetPath,
    scopePath,
    destinationRoot,
    baselinePath,
    baselineSnapshot,
    files: plannedFiles,
    summary: summarizePlannedFiles({ files: plannedFiles })
  };
};

export const applyLocalSyncPlan = async ({
  plan,
  fileDecisions,
  jobId,
  sourceJobId
}: {
  plan: LocalSyncPlan;
  fileDecisions: Array<{ path: string; decision: LocalSyncFileDecision }>;
  jobId: string;
  sourceJobId: string;
}): Promise<LocalSyncPlan> => {
  await assertDestinationRootSafety({
    workspaceRoot: plan.workspaceRoot,
    destinationRoot: plan.destinationRoot
  });

  const decisionByPath = validateFileDecisions({
    plan,
    fileDecisions
  });

  for (const entry of plan.files) {
    const decision = decisionByPath.get(entry.relativePath) ?? "skip";
    if (decision !== "write") {
      continue;
    }

    const resolvedSourcePath = path.resolve(entry.sourcePath);
    assertWithinRoot({
      candidatePath: resolvedSourcePath,
      rootPath: plan.sourceRoot,
      message: "Planned source file escapes generated project root."
    });

    const currentDestinationState = await readSafeDestinationFileState({
      destinationRoot: plan.destinationRoot,
      destinationPath: entry.destinationPath
    });
    const baselineChanged = (entry.baselineSha256 ?? null) !== (plan.baselineSnapshot?.files.find((candidate) => candidate.path === entry.relativePath)?.sha256 ?? null);
    const destinationChanged = (entry.destinationSha256 ?? null) !== (currentDestinationState.sha256 ?? null);
    if (baselineChanged || destinationChanged) {
      throw new LocalSyncError(
        "E_SYNC_PREVIEW_STALE",
        `Sync preview is stale for '${entry.relativePath}'. Run a new dry-run before applying.`
      );
    }

    const fileContent = await readFile(resolvedSourcePath);
    await mkdir(path.dirname(entry.destinationPath), { recursive: true });
    await writeFile(entry.destinationPath, fileContent);
  }

  const appliedPlan = applyDecisionsToPlan({
    plan,
    decisionByPath
  });

  const updatedAt = new Date().toISOString();
  const baselineEntries = new Map<string, LocalSyncBaselineFileEntry>();
  for (const existingEntry of plan.baselineSnapshot?.files ?? []) {
    baselineEntries.set(existingEntry.path, existingEntry);
  }
  for (const entry of appliedPlan.files) {
    if (entry.decision !== "write") {
      continue;
    }
    baselineEntries.set(entry.relativePath, {
      path: entry.relativePath,
      sha256: entry.sourceSha256,
      sizeBytes: entry.sizeBytes,
      syncedAt: updatedAt,
      jobId,
      sourceJobId
    });
  }

  await saveLocalSyncBaseline({
    baselinePath: plan.baselinePath,
    snapshot: {
      version: LOCAL_SYNC_BASELINE_VERSION,
      boardKey: plan.boardKey,
      targetPath: plan.targetPath,
      scopePath: plan.scopePath,
      destinationRoot: plan.destinationRoot,
      updatedAt,
      files: [...baselineEntries.values()].sort((left, right) => left.path.localeCompare(right.path))
    }
  });

  return {
    ...appliedPlan,
    baselineSnapshot: {
      version: LOCAL_SYNC_BASELINE_VERSION,
      boardKey: plan.boardKey,
      targetPath: plan.targetPath,
      scopePath: plan.scopePath,
      destinationRoot: plan.destinationRoot,
      updatedAt,
      files: [...baselineEntries.values()].sort((left, right) => left.path.localeCompare(right.path))
    }
  };
};
