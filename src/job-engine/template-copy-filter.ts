import path from "node:path";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".idea",
  ".vscode",
  ".vite",
  "dist",
  "build",
  "artifacts"
]);

const EXCLUDED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", ".env.local"]);

const toPathSegments = (relativePath: string): string[] => {
  return relativePath.split(path.sep).filter((entry) => entry.length > 0);
};

export const shouldIncludeTemplateCopyPath = ({
  templateRoot,
  sourcePath
}: {
  templateRoot: string;
  sourcePath: string;
}): boolean => {
  const normalizedTemplateRoot = path.resolve(templateRoot);
  const normalizedSourcePath = path.resolve(sourcePath);

  if (normalizedSourcePath === normalizedTemplateRoot) {
    return true;
  }

  const relativePath = path.relative(normalizedTemplateRoot, normalizedSourcePath);
  if (relativePath.length === 0 || relativePath === ".") {
    return true;
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }

  const segments = toPathSegments(relativePath);
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    return false;
  }

  const baseName = path.basename(normalizedSourcePath);
  if (EXCLUDED_FILE_NAMES.has(baseName)) {
    return false;
  }
  if (baseName.endsWith(".log")) {
    return false;
  }
  return true;
};

export const createTemplateCopyFilter = ({
  templateRoot
}: {
  templateRoot: string;
}): ((sourcePath: string) => boolean) => {
  const normalizedTemplateRoot = path.resolve(templateRoot);
  return (sourcePath: string): boolean => {
    return shouldIncludeTemplateCopyPath({
      templateRoot: normalizedTemplateRoot,
      sourcePath
    });
  };
};
