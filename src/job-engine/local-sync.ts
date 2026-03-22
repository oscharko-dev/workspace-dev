import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeTargetPath, toScopePath } from "./target-path.js";

const EXCLUDED_SOURCE_DIRS = new Set(["node_modules"]);

export type LocalSyncFileAction = "create" | "overwrite";

export interface LocalSyncPlannedFile {
  relativePath: string;
  sourcePath: string;
  destinationPath: string;
  action: LocalSyncFileAction;
  sizeBytes: number;
}

export interface LocalSyncSummary {
  totalFiles: number;
  createCount: number;
  overwriteCount: number;
  totalBytes: number;
}

export interface LocalSyncPlan {
  workspaceRoot: string;
  sourceRoot: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
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

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

const isWithinRoot = ({
  candidatePath,
  rootPath
}: {
  candidatePath: string;
  rootPath: string;
}): boolean => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
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

const assertDestinationFileSafety = async ({
  destinationRoot,
  destinationPath
}: {
  destinationRoot: string;
  destinationPath: string;
}): Promise<LocalSyncFileAction> => {
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
    return "overwrite";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "create";
    }
    throw error;
  }
};

const collectGeneratedSourceFiles = async ({
  sourceRoot
}: {
  sourceRoot: string;
}): Promise<Array<{ absolutePath: string; sizeBytes: number }>> => {
  const files: Array<{ absolutePath: string; sizeBytes: number }> = [];

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
        throw new LocalSyncError("E_SYNC_GENERATED_DIR_MISSING", `Could not stat generated file '${absolutePath}': ${(error as Error).message}`);
      }

      if (candidateStat.isSymbolicLink()) {
        throw new LocalSyncError("E_SYNC_SOURCE_SYMLINK", `Generated output contains unsupported symbolic link '${absolutePath}'.`);
      }

      if (candidateStat.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (candidateStat.isFile()) {
        files.push({
          absolutePath,
          sizeBytes: candidateStat.size
        });
      }
    }
  };

  await walk(sourceRoot);
  return files;
};

export const planLocalSync = async ({
  generatedProjectDir,
  workspaceRoot,
  targetPath,
  boardKey
}: {
  generatedProjectDir: string;
  workspaceRoot: string;
  targetPath: string | undefined;
  boardKey: string;
}): Promise<LocalSyncPlan> => {
  const resolvedSourceRoot = path.resolve(generatedProjectDir);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
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

  const sourceFiles = await collectGeneratedSourceFiles({ sourceRoot: resolvedSourceRoot });
  const plannedFiles: LocalSyncPlannedFile[] = [];
  let createCount = 0;
  let overwriteCount = 0;
  let totalBytes = 0;

  for (const sourceFile of sourceFiles) {
    const relativePath = toPosixPath(path.relative(resolvedSourceRoot, sourceFile.absolutePath));
    const destinationPath = path.resolve(destinationRoot, relativePath);
    const action = await assertDestinationFileSafety({
      destinationRoot,
      destinationPath
    });

    if (action === "create") {
      createCount += 1;
    } else {
      overwriteCount += 1;
    }
    totalBytes += sourceFile.sizeBytes;

    plannedFiles.push({
      relativePath,
      sourcePath: sourceFile.absolutePath,
      destinationPath,
      action,
      sizeBytes: sourceFile.sizeBytes
    });
  }

  plannedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    sourceRoot: resolvedSourceRoot,
    boardKey,
    targetPath: normalizedTargetPath,
    scopePath,
    destinationRoot,
    files: plannedFiles,
    summary: {
      totalFiles: plannedFiles.length,
      createCount,
      overwriteCount,
      totalBytes
    }
  };
};

export const applyLocalSyncPlan = async ({
  plan
}: {
  plan: LocalSyncPlan;
}): Promise<void> => {
  await assertDestinationRootSafety({
    workspaceRoot: plan.workspaceRoot,
    destinationRoot: plan.destinationRoot
  });

  for (const entry of plan.files) {
    const resolvedSourcePath = path.resolve(entry.sourcePath);
    assertWithinRoot({
      candidatePath: resolvedSourcePath,
      rootPath: plan.sourceRoot,
      message: "Planned source file escapes generated project root."
    });

    await assertDestinationFileSafety({
      destinationRoot: plan.destinationRoot,
      destinationPath: entry.destinationPath
    });

    const fileContent = await readFile(resolvedSourcePath);
    await mkdir(path.dirname(entry.destinationPath), { recursive: true });
    await writeFile(entry.destinationPath, fileContent);
  }
};
