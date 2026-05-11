import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

const FINAL_COMPONENT_NOFOLLOW_FLAG =
  typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : undefined;

export const supportsFinalComponentNoFollow: boolean =
  FINAL_COMPONENT_NOFOLLOW_FLAG !== undefined;

export const getContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
};

export const normalizePathPart = (value: string): string | undefined => {
  if (value.includes("\0")) {
    return undefined;
  }

  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.join("/");
};

export const isWithinRoot = ({
  candidatePath,
  rootPath
}: {
  candidatePath: string;
  rootPath: string;
}): boolean => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
};

export const hasSymlinkInPath = async ({
  candidatePath,
  rootPath
}: {
  candidatePath: string;
  rootPath: string;
}): Promise<boolean> => {
  // This path-segment walk catches existing symlinks in the resolved path, but it
  // cannot close the TOCTOU gap if an ancestor is swapped after the check. Callers
  // still need a best-effort final-component O_NOFOLLOW open when the platform supports it.
  if (!isWithinRoot({ candidatePath, rootPath })) {
    return true;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  try {
    const rootStat = await lstat(resolvedRoot);
    if (rootStat.isSymbolicLink()) {
      return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const relativePath = path.relative(resolvedRoot, resolvedCandidate);
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);

  let currentPath = resolvedRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const currentStat = await lstat(currentPath);
      if (currentStat.isSymbolicLink()) {
        return true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  return false;
};

export const readFileWithFinalComponentNoFollow = async (
  filePath: string
): Promise<Buffer> => {
  if (FINAL_COMPONENT_NOFOLLOW_FLAG === undefined) {
    return readFile(filePath);
  }

  const handle = await open(filePath, constants.O_RDONLY | FINAL_COMPONENT_NOFOLLOW_FLAG);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};
