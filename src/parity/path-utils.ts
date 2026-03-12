import path from "node:path";

export const sanitizeFileName = (name: string): string => {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  return safe.length > 0 ? safe : "Screen";
};

export const ensureTsxName = (name: string): string => {
  const safe = sanitizeFileName(name);
  const normalized = safe.charAt(0).toUpperCase() + safe.slice(1);
  return normalized.endsWith(".tsx") ? normalized : `${normalized}.tsx`;
};

export const resolveInside = (rootDir: string, relativePath: string): string => {
  const resolved = path.resolve(rootDir, relativePath);
  const normalizedRoot = path.resolve(rootDir) + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(rootDir)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  return resolved;
};
