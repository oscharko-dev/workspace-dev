import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File-level hash entry stored per board key for cross-generation comparison.
 */
export interface FileHashEntry {
  /** Relative path within the generated project directory. */
  relativePath: string;
  /** SHA-256 hex digest of the file content. */
  sha256: string;
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Persisted hash snapshot for a single generation run.
 */
export interface GenerationHashSnapshot {
  boardKey: string;
  jobId: string;
  generatedAt: string;
  files: FileHashEntry[];
}

/**
 * Describes a modified file in the diff report.
 */
export interface GenerationDiffModifiedFile {
  file: string;
  previousHash: string;
  currentHash: string;
}

/**
 * Full generation diff report comparing the current run with the previous snapshot.
 */
export interface GenerationDiffReport {
  boardKey: string;
  currentJobId: string;
  previousJobId: string | null;
  generatedAt: string;
  added: string[];
  modified: GenerationDiffModifiedFile[];
  removed: string[];
  unchanged: string[];
  summary: string;
}

/**
 * Internal pipeline context required to compute a canonical generation diff.
 */
export interface GenerationDiffContext {
  boardKey: string;
}

/**
 * Prepared final diff data that can be persisted once validation succeeds.
 */
export interface PreparedGenerationDiff {
  report: GenerationDiffReport;
  snapshot: GenerationHashSnapshot;
}

const HASH_STORE_DIR_NAME = "generation-hashes";
const DIFF_REPORT_FILE_NAME = "generation-diff.json";

/**
 * Computes SHA-256 hex digest for the given buffer.
 */
const computeSha256 = (content: Buffer): string => {
  return createHash("sha256").update(content).digest("hex");
};

/**
 * Recursively collects all files in a directory and computes their hashes.
 */
const collectFileHashes = async ({
  projectDir,
  baseDir,
  onLog,
}: {
  projectDir: string;
  baseDir?: string;
  onLog?: (message: string) => void;
}): Promise<FileHashEntry[]> => {
  const root = baseDir ?? projectDir;
  const entries: FileHashEntry[] = [];

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    onLog?.(
      `Generation diff debug: operation=collectFileHashes.readdir; projectDir='${projectDir}'; error=${error instanceof Error ? error.message : String(error)}.`,
    );
    return entries;
  }

  for (const entry of dirEntries) {
    const fullPath = path.join(projectDir, entry.name);

    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    if (entry.isDirectory()) {
      const subEntries = await collectFileHashes({
        projectDir: fullPath,
        baseDir: root,
        ...(onLog ? { onLog } : {}),
      });
      entries.push(...subEntries);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      entries.push({
        relativePath: path.relative(root, fullPath),
        sha256: computeSha256(content),
        sizeBytes: content.byteLength,
      });
    }
  }

  return entries;
};

/**
 * Resolves the path to the hash store directory for a board key.
 */
const resolveHashStoreDir = ({
  outputRoot,
}: {
  outputRoot: string;
}): string => {
  return path.join(outputRoot, HASH_STORE_DIR_NAME);
};

/**
 * Resolves the path to the hash snapshot file for a given board key.
 */
const resolveHashSnapshotPath = ({
  outputRoot,
  boardKey,
}: {
  outputRoot: string;
  boardKey: string;
}): string => {
  return path.join(resolveHashStoreDir({ outputRoot }), `${boardKey}.json`);
};

/**
 * Loads the previous generation hash snapshot for a board key, or null if none exists.
 */
export const loadPreviousSnapshot = async ({
  outputRoot,
  boardKey,
  onLog,
}: {
  outputRoot: string;
  boardKey: string;
  onLog?: (message: string) => void;
}): Promise<GenerationHashSnapshot | null> => {
  const snapshotPath = resolveHashSnapshotPath({ outputRoot, boardKey });
  try {
    const raw = await readFile(snapshotPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      onLog?.(
        `Generation diff debug: operation=loadPreviousSnapshot.parse; boardKey='${boardKey}'; snapshotPath='${snapshotPath}'; error=${error instanceof Error ? error.message : String(error)}.`,
      );
      return null;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "boardKey" in parsed &&
      "jobId" in parsed &&
      "files" in parsed &&
      Array.isArray((parsed as GenerationHashSnapshot).files)
    ) {
      return parsed as GenerationHashSnapshot;
    }
    return null;
  } catch (error) {
    onLog?.(
      `Generation diff debug: operation=loadPreviousSnapshot.read; boardKey='${boardKey}'; snapshotPath='${snapshotPath}'; error=${error instanceof Error ? error.message : String(error)}.`,
    );
    return null;
  }
};

/**
 * Saves the current generation hash snapshot for a board key.
 */
export const saveCurrentSnapshot = async ({
  outputRoot,
  snapshot,
}: {
  outputRoot: string;
  snapshot: GenerationHashSnapshot;
}): Promise<void> => {
  const storeDir = resolveHashStoreDir({ outputRoot });
  await mkdir(storeDir, { recursive: true });
  const snapshotPath = resolveHashSnapshotPath({
    outputRoot,
    boardKey: snapshot.boardKey,
  });
  await writeFile(
    snapshotPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
};

/**
 * Computes the generation diff report by comparing current file hashes with previous snapshot.
 */
export const computeGenerationDiff = ({
  boardKey,
  currentJobId,
  previousSnapshot,
  currentFiles,
}: {
  boardKey: string;
  currentJobId: string;
  previousSnapshot: GenerationHashSnapshot | null;
  currentFiles: FileHashEntry[];
}): GenerationDiffReport => {
  const generatedAt = new Date().toISOString();
  const previousJobId = previousSnapshot?.jobId ?? null;

  if (!previousSnapshot) {
    return {
      boardKey,
      currentJobId,
      previousJobId: null,
      generatedAt,
      added: currentFiles.map((f) => f.relativePath),
      modified: [],
      removed: [],
      unchanged: [],
      summary: `${currentFiles.length} files added (first generation)`,
    };
  }

  const previousMap = new Map<string, FileHashEntry>();
  for (const entry of previousSnapshot.files) {
    previousMap.set(entry.relativePath, entry);
  }

  const currentMap = new Map<string, FileHashEntry>();
  for (const entry of currentFiles) {
    currentMap.set(entry.relativePath, entry);
  }

  const added: string[] = [];
  const modified: GenerationDiffModifiedFile[] = [];
  const unchanged: string[] = [];

  for (const entry of currentFiles) {
    const previous = previousMap.get(entry.relativePath);
    if (!previous) {
      added.push(entry.relativePath);
    } else if (previous.sha256 !== entry.sha256) {
      modified.push({
        file: entry.relativePath,
        previousHash: previous.sha256,
        currentHash: entry.sha256,
      });
    } else {
      unchanged.push(entry.relativePath);
    }
  }

  const removed: string[] = [];
  for (const entry of previousSnapshot.files) {
    if (!currentMap.has(entry.relativePath)) {
      removed.push(entry.relativePath);
    }
  }

  const parts: string[] = [];
  if (modified.length > 0) {
    parts.push(
      `${modified.length} file${modified.length === 1 ? "" : "s"} modified`,
    );
  }
  if (added.length > 0) {
    parts.push(`${added.length} added`);
  }
  if (removed.length > 0) {
    parts.push(`${removed.length} removed`);
  }
  if (unchanged.length > 0) {
    parts.push(`${unchanged.length} unchanged`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : "No changes detected";

  return {
    boardKey,
    currentJobId,
    previousJobId,
    generatedAt,
    added,
    modified,
    removed,
    unchanged,
    summary,
  };
};

/**
 * Prepares a generation diff report and final snapshot without persisting either artifact.
 */
export const prepareGenerationDiff = async ({
  generatedProjectDir,
  outputRoot,
  boardKey,
  jobId,
  onLog,
}: {
  generatedProjectDir: string;
  outputRoot: string;
  boardKey: string;
  jobId: string;
  onLog?: (message: string) => void;
}): Promise<PreparedGenerationDiff> => {
  const currentFiles = await collectFileHashes({
    projectDir: generatedProjectDir,
    ...(onLog ? { onLog } : {}),
  });
  const previousSnapshot = await loadPreviousSnapshot({
    outputRoot,
    boardKey,
    ...(onLog ? { onLog } : {}),
  });

  return {
    report: computeGenerationDiff({
      boardKey,
      currentJobId: jobId,
      previousSnapshot,
      currentFiles,
    }),
    snapshot: {
      boardKey,
      jobId,
      generatedAt: new Date().toISOString(),
      files: currentFiles,
    },
  };
};

/**
 * Writes a prepared generation diff report to the job directory.
 */
export const writeGenerationDiffReport = async ({
  jobDir,
  report,
}: {
  jobDir: string;
  report: GenerationDiffReport;
}): Promise<string> => {
  const reportPath = path.join(jobDir, DIFF_REPORT_FILE_NAME);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
};

/**
 * Persists a prepared generation diff report and promotes its snapshot to the next baseline.
 */
export const persistPreparedGenerationDiff = async ({
  jobDir,
  outputRoot,
  preparedDiff,
}: {
  jobDir: string;
  outputRoot: string;
  preparedDiff: PreparedGenerationDiff;
}): Promise<string> => {
  const reportPath = await writeGenerationDiffReport({
    jobDir,
    report: preparedDiff.report,
  });
  await saveCurrentSnapshot({ outputRoot, snapshot: preparedDiff.snapshot });
  return reportPath;
};

/**
 * Full generation diff pipeline: collect hashes, load previous, compute diff, persist.
 */
export const runGenerationDiff = async ({
  generatedProjectDir,
  jobDir,
  outputRoot,
  boardKey,
  jobId,
  onLog,
}: {
  generatedProjectDir: string;
  jobDir: string;
  outputRoot: string;
  boardKey: string;
  jobId: string;
  onLog?: (message: string) => void;
}): Promise<GenerationDiffReport> => {
  const preparedDiff = await prepareGenerationDiff({
    generatedProjectDir,
    outputRoot,
    boardKey,
    jobId,
    ...(onLog ? { onLog } : {}),
  });
  await persistPreparedGenerationDiff({
    jobDir,
    outputRoot,
    preparedDiff,
  });
  return preparedDiff.report;
};

/**
 * Formats a diff report summary for use in PR descriptions.
 */
export const formatDiffForPrDescription = (
  report: GenerationDiffReport,
): string => {
  const lines: string[] = [];
  lines.push("### Generation Diff Report");
  lines.push("");
  lines.push(`**Summary:** ${report.summary}`);
  lines.push("");

  if (report.previousJobId) {
    lines.push(`Previous job: \`${report.previousJobId}\``);
    lines.push("");
  }

  if (report.added.length > 0) {
    lines.push("**Added files:**");
    for (const file of report.added.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (report.added.length > 20) {
      lines.push(`- ... and ${report.added.length - 20} more`);
    }
    lines.push("");
  }

  if (report.modified.length > 0) {
    lines.push("**Modified files:**");
    for (const entry of report.modified.slice(0, 20)) {
      lines.push(`- \`${entry.file}\``);
    }
    if (report.modified.length > 20) {
      lines.push(`- ... and ${report.modified.length - 20} more`);
    }
    lines.push("");
  }

  if (report.removed.length > 0) {
    lines.push("**Removed files:**");
    for (const file of report.removed.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (report.removed.length > 20) {
      lines.push(`- ... and ${report.removed.length - 20} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
};
