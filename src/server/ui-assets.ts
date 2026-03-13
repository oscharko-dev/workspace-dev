import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { type UiAsset, type UiAssetPath } from "./constants.js";

const uiAssetsCache = new Map<string, Promise<Map<UiAssetPath, UiAsset>>>();

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUiSourceDir(moduleDir: string): Promise<string | null> {
  const candidates = [
    path.resolve(moduleDir, "ui"),
    path.resolve(moduleDir, "../dist/ui"),
    path.resolve(moduleDir, "../ui-src/dist")
  ];
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function normalizeUiAssetPath(input: string): UiAssetPath | null {
  if (!input || input === "/") {
    return "index.html";
  }

  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  const normalized = decoded.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "index.html";
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

function toContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

async function collectAssets({
  sourceDir,
  currentDir,
  assets
}: {
  sourceDir: string;
  currentDir: string;
  assets: Map<UiAssetPath, UiAsset>;
}): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectAssets({
        sourceDir,
        currentDir: absolutePath,
        assets
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(sourceDir, absolutePath).replaceAll(path.sep, "/");
    const normalizedPath = normalizeUiAssetPath(relativePath);
    if (!normalizedPath) {
      continue;
    }

    const content = await readFile(absolutePath);
    assets.set(normalizedPath, {
      contentType: toContentType(absolutePath),
      content
    });
  }
}

async function loadUiAssets(moduleDir: string): Promise<Map<UiAssetPath, UiAsset>> {
  const sourceDir = await resolveUiSourceDir(moduleDir);
  if (!sourceDir) {
    throw new Error("UI assets not found. Expected dist/ui or ui-src/dist to be present.");
  }

  const assets = new Map<UiAssetPath, UiAsset>();
  await collectAssets({
    sourceDir,
    currentDir: sourceDir,
    assets
  });

  if (!assets.has("index.html")) {
    throw new Error("UI assets not found. Missing index.html in the resolved UI source directory.");
  }

  return assets;
}

export function getUiAsset({
  assets,
  assetPath
}: {
  assets: Map<UiAssetPath, UiAsset>;
  assetPath: string;
}): UiAsset | undefined {
  const normalizedPath = normalizeUiAssetPath(assetPath);
  if (!normalizedPath) {
    return undefined;
  }
  return assets.get(normalizedPath);
}

export async function getUiAssets(moduleDir: string): Promise<Map<UiAssetPath, UiAsset>> {
  const cacheKey = path.resolve(moduleDir);
  const existing = uiAssetsCache.get(cacheKey);
  if (existing) {
    return await existing;
  }

  const loadPromise = loadUiAssets(cacheKey).catch((error) => {
    uiAssetsCache.delete(cacheKey);
    throw error;
  });

  uiAssetsCache.set(cacheKey, loadPromise);
  return await loadPromise;
}
