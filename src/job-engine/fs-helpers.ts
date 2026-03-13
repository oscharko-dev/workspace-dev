import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { JobEnginePaths } from "./types.js";

export const resolveAbsoluteOutputRoot = ({ outputRoot }: { outputRoot: string }): JobEnginePaths => {
  return {
    outputRoot,
    jobsRoot: path.join(outputRoot, "jobs"),
    reprosRoot: path.join(outputRoot, "repros")
  };
};

export const copyDir = async ({
  sourceDir,
  targetDir,
  filter
}: {
  sourceDir: string;
  targetDir: string;
  filter?: (sourcePath: string) => boolean;
}): Promise<void> => {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter
  });
};

export const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await stat(candidatePath);
    return true;
  } catch {
    return false;
  }
};
