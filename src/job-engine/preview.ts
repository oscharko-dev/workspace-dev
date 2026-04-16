import { lstat } from "node:fs/promises";
import path from "node:path";

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
