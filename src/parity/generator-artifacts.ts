import path from "node:path";
import type { ScreenIR } from "./types.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";

export interface ScreenArtifactIdentity {
  componentName: string;
  filePath: string;
  routePath: string;
}

export const toComponentName = (rawName: string): string => {
  const safe = sanitizeFileName(rawName);
  const parts = safe.split(/[_-]+/).filter((part) => part.length > 0);
  const pascal = parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return pascal.length > 0 ? pascal : "Screen";
};

const toScreenIdSuffix = (screenId: string): string => {
  const compact = screenId.replace(/[^a-zA-Z0-9]+/g, "");
  if (compact.length >= 6) {
    return compact.slice(-6);
  }
  if (compact.length > 0) {
    return compact;
  }
  return "v2";
};

const toUniqueScreenStem = ({
  baseStem,
  suffix
}: {
  baseStem: string;
  suffix: string;
}): string => {
  return `${baseStem}_${suffix}`;
};

export const toDeterministicScreenPath = (screenName: string): string => {
  return path.posix.join("src", "screens", ensureTsxName(screenName));
};

export const buildScreenArtifactIdentities = (screens: ScreenIR[]): Map<string, ScreenArtifactIdentity> => {
  const byScreenId = new Map<string, ScreenArtifactIdentity>();
  const usedComponentNames = new Set<string>();
  const usedFilePaths = new Set<string>();
  const usedRoutePaths = new Set<string>();

  for (const screen of screens) {
    const baseRoute = `/${sanitizeFileName(screen.name).toLowerCase() || "screen"}`;
    const baseComponent = toComponentName(screen.name);
    const baseStem = sanitizeFileName(screen.name) || "Screen";
    const suffix = toScreenIdSuffix(screen.id);

    let componentName = baseComponent;
    let filePath = toDeterministicScreenPath(baseStem);
    let routePath = baseRoute;
    let attempt = 0;

    while (
      usedComponentNames.has(componentName.toLowerCase()) ||
      usedFilePaths.has(filePath.toLowerCase()) ||
      usedRoutePaths.has(routePath.toLowerCase())
    ) {
      attempt += 1;
      const attemptSuffix = attempt === 1 ? suffix : `${suffix}${attempt + 1}`;
      const nextStem = toUniqueScreenStem({
        baseStem,
        suffix: attemptSuffix
      });
      componentName = toComponentName(nextStem);
      filePath = toDeterministicScreenPath(nextStem);
      routePath = `${baseRoute}-${attemptSuffix.toLowerCase()}`;
    }

    usedComponentNames.add(componentName.toLowerCase());
    usedFilePaths.add(filePath.toLowerCase());
    usedRoutePaths.add(routePath.toLowerCase());
    byScreenId.set(screen.id, {
      componentName,
      filePath,
      routePath
    });
  }

  return byScreenId;
};
