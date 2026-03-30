import { normalizePosixPath } from "./text.js";

const IFRAME_BUNDLE_PATTERN =
  /<script\s+type="module"\s+crossorigin\s+src="\.\/(assets\/iframe-[^"]+\.js)">/u;

const IMPORT_MAP_ENTRY_PATTERN =
  /"(\.\/(?:docs|src)\/[^"]+\.(?:stories\.(?:jsx|mjs|ts|tsx|mdx)|mdx))":\s*n\(\(\)\s*=>\s*c0\(\(\)\s*=>\s*import\("(\.\/[^"]+\.js)"/gu;

export const resolveIframeBundlePath = (iframeHtmlText: string): string => {
  const match = iframeHtmlText.match(IFRAME_BUNDLE_PATTERN);
  const iframeBundlePath = match?.[1];
  if (!iframeBundlePath) {
    throw new Error("Unable to resolve the Storybook iframe bundle path from iframe.html.");
  }
  return normalizePosixPath(iframeBundlePath);
};

export const extractImportPathToBundlePath = (iframeBundleText: string): Map<string, string> => {
  const importPathToBundlePath = new Map<string, string>();
  for (const match of iframeBundleText.matchAll(IMPORT_MAP_ENTRY_PATTERN)) {
    const importPathMatch = match[1];
    const bundlePathMatch = match[2];
    if (!importPathMatch || !bundlePathMatch) {
      continue;
    }

    const importPath = normalizePosixPath(importPathMatch);
    const bundlePath = normalizePosixPath(`assets/${bundlePathMatch.replace(/^\.\//u, "")}`);
    importPathToBundlePath.set(importPath, bundlePath);
  }

  if (importPathToBundlePath.size === 0) {
    throw new Error("Unable to extract the Storybook iframe import map from the hashed iframe bundle.");
  }

  return importPathToBundlePath;
};
