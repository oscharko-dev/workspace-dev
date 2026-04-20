import path from "node:path";

export const DEFAULT_TARGET_PATH = "figma-generated";

export const sanitizeTargetPath = (rawTargetPath: string | undefined): string => {
  const candidate = rawTargetPath && rawTargetPath.trim().length > 0 ? rawTargetPath.trim() : DEFAULT_TARGET_PATH;
  const normalizedInput = candidate.replace(/\\/g, "/");

  if (candidate.includes("\0")) {
    throw new Error(`Invalid targetPath '${candidate}'. Expected a safe relative path.`);
  }

  if (/^[a-zA-Z]:/.test(normalizedInput) || normalizedInput.startsWith("//")) {
    throw new Error(`Invalid targetPath '${candidate}'. Expected a safe relative path.`);
  }

  const normalized = path.posix.normalize(normalizedInput);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized.includes("..\\")
  ) {
    throw new Error(`Invalid targetPath '${candidate}'. Expected a safe relative path.`);
  }

  return normalized;
};

export const toScopePath = ({
  targetPath,
  boardKey
}: {
  targetPath: string;
  boardKey: string;
}): string => {
  return path.posix.join(targetPath, boardKey);
};
