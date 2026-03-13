import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { UI_ASSET_DEFINITIONS, type UiAsset, type UiAssetName } from "./constants.js";

const uiAssetsCache = new Map<string, Promise<Map<UiAssetName, UiAsset>>>();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUiSourceDir(moduleDir: string): Promise<string | null> {
  const candidates = [path.resolve(moduleDir, "ui"), path.resolve(moduleDir, "../ui-src")];
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

async function loadUiAssets(moduleDir: string): Promise<Map<UiAssetName, UiAsset>> {
  const sourceDir = await resolveUiSourceDir(moduleDir);
  if (!sourceDir) {
    throw new Error("UI assets not found. Expected dist/ui or ui-src to be present.");
  }

  const assets = new Map<UiAssetName, UiAsset>();
  for (const assetDefinition of UI_ASSET_DEFINITIONS) {
    const assetPath = path.join(sourceDir, assetDefinition.name);
    const content = await readFile(assetPath, "utf8");
    assets.set(assetDefinition.name, {
      contentType: assetDefinition.contentType,
      content
    });
  }

  return assets;
}

export async function getUiAssets(moduleDir: string): Promise<Map<UiAssetName, UiAsset>> {
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
