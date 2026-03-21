import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
  baseDir
}: {
  projectDir: string;
  baseDir?: string;
}): Promise<FileHashEntry[]> => {
  const root = baseDir ?? projectDir;
  const entries: FileHashEntry[] = [];

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    const fullPath = path.join(projectDir, entry.name);

    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    if (entry.isDirectory()) {
      const subEntries = await collectFileHashes({ projectDir: fullPath, baseDir: root });
      entries.push(...subEntries);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      const fileStat = await stat(fullPath);
      entries.push({
        relativePath: path.relative(root, fullPath),
        sha256: computeSha256(content),
        sizeBytes: fileStat.size
      });
    }
  }

  return entries;
};

/**
 * Resolves the path to the hash store directory for a board key.
 */
const resolveHashStoreDir = ({ outputRoot }: { outputRoot: string }): string => {
  return path.join(outputRoot, HASH_STORE_DIR_NAME);
};

/**
 * Resolves the path to the hash snapshot file for a given board key.
 */
const resolveHashSnapshotPath = ({
  outputRoot,
  boardKey
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
  boardKey
}: {
  outputRoot: string;
  boardKey: string;
}): Promise<GenerationHashSnapshot | null> => {
  const snapshotPath = resolveHashSnapshotPath({ outputRoot, boardKey });
  try {
    const raw = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
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
  } catch {
    return null;
  }
};

/**
 * Saves the current generation hash snapshot for a board key.
 */
export const saveCurrentSnapshot = async ({
  outputRoot,
  snapshot
}: {
  outputRoot: string;
  snapshot: GenerationHashSnapshot;
}): Promise<void> => {
  const storeDir = resolveHashStoreDir({ outputRoot });
  await mkdir(storeDir, { recursive: true });
  const snapshotPath = resolveHashSnapshotPath({ outputRoot, boardKey: snapshot.boardKey });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
};

/**
 * Computes the generation diff report by comparing current file hashes with previous snapshot.
 */
export const computeGenerationDiff = ({
  boardKey,
  currentJobId,
  previousSnapshot,
  currentFiles
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
      summary: `${currentFiles.length} files added (first generation)`
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
        currentHash: entry.sha256
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
    parts.push(`${modified.length} file${modified.length === 1 ? "" : "s"} modified`);
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
    summary
  };
};

/**
 * Full generation diff pipeline: collect hashes, load previous, compute diff, persist.
 */
export const runGenerationDiff = async ({
  generatedProjectDir,
  jobDir,
  outputRoot,
  boardKey,
  jobId
}: {
  generatedProjectDir: string;
  jobDir: string;
  outputRoot: string;
  boardKey: string;
  jobId: string;
}): Promise<GenerationDiffReport> => {
  const currentFiles = await collectFileHashes({ projectDir: generatedProjectDir });
  const previousSnapshot = await loadPreviousSnapshot({ outputRoot, boardKey });

  const report = computeGenerationDiff({
    boardKey,
    currentJobId: jobId,
    previousSnapshot,
    currentFiles
  });

  const reportPath = path.join(jobDir, DIFF_REPORT_FILE_NAME);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const currentSnapshot: GenerationHashSnapshot = {
    boardKey,
    jobId,
    generatedAt: new Date().toISOString(),
    files: currentFiles
  };
  await saveCurrentSnapshot({ outputRoot, snapshot: currentSnapshot });

  return report;
};

/**
 * Formats a diff report summary for use in PR descriptions.
 */
export const formatDiffForPrDescription = (report: GenerationDiffReport): string => {
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
