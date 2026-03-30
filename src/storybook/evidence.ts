import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  extractCssCustomProperties,
  extractMdxImageSources,
  extractMdxLinks,
  extractMdxTextBlocks,
  extractStoryDesignUrls,
  extractThemeMarkers,
  collectTopLevelFieldKeys
} from "./bundle-analysis.js";
import { extractImportPathToBundlePath, resolveIframeBundlePath } from "./iframe-import-map.js";
import { normalizePosixPath, uniqueSorted } from "./text.js";
import type {
  StorybookBuildContext,
  StorybookEvidenceArtifact,
  StorybookEvidenceItem,
  StorybookEvidenceReliability,
  StorybookEvidenceSource,
  StorybookEvidenceSummary,
  StorybookEvidenceType,
  StorybookEvidenceUsage,
  StorybookIndexEntry
} from "./types.js";

const STORYBOOK_EVIDENCE_TYPES: StorybookEvidenceType[] = [
  "story_componentPath",
  "story_argTypes",
  "story_args",
  "story_design_link",
  "theme_bundle",
  "css",
  "mdx_link",
  "docs_image",
  "docs_text"
];

const STORYBOOK_EVIDENCE_RELIABILITIES: StorybookEvidenceReliability[] = [
  "authoritative",
  "reference_only",
  "derived"
];

const STORYBOOK_EVIDENCE_OUTPUT_FILE_NAME = "storybook.evidence.json";

interface StorybookIndexFile {
  v: number;
  entries: Record<string, StorybookIndexEntry>;
}

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
};

const toStableJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const objectEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    const stableRecord: Record<string, JsonValue> = {};
    for (const [key, objectValue] of objectEntries) {
      stableRecord[key] = toStableJsonValue(objectValue);
    }
    return stableRecord;
  }
  return value;
};

const toStableJsonString = (value: JsonValue): string => {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
};

const resolveEvidenceReliability = (type: StorybookEvidenceType): StorybookEvidenceReliability => {
  switch (type) {
    case "story_componentPath":
    case "story_argTypes":
    case "story_args":
    case "theme_bundle":
    case "css":
      return "authoritative";
    case "story_design_link":
    case "mdx_link":
    case "docs_image":
    case "docs_text":
      return "reference_only";
  }
};

const resolveEvidenceUsage = (type: StorybookEvidenceType): StorybookEvidenceUsage => {
  switch (type) {
    case "story_componentPath":
      return {
        canDriveTokens: false,
        canDriveProps: false,
        canDriveImports: true,
        canDriveStyling: false,
        canProvideMatchHints: true
      };
    case "story_argTypes":
    case "story_args":
      return {
        canDriveTokens: true,
        canDriveProps: true,
        canDriveImports: false,
        canDriveStyling: true,
        canProvideMatchHints: true
      };
    case "theme_bundle":
    case "css":
      return {
        canDriveTokens: true,
        canDriveProps: false,
        canDriveImports: false,
        canDriveStyling: true,
        canProvideMatchHints: true
      };
    case "story_design_link":
    case "mdx_link":
    case "docs_text":
      return {
        canDriveTokens: false,
        canDriveProps: false,
        canDriveImports: false,
        canDriveStyling: false,
        canProvideMatchHints: true
      };
    case "docs_image":
      return {
        canDriveTokens: false,
        canDriveProps: false,
        canDriveImports: false,
        canDriveStyling: false,
        canProvideMatchHints: true
      };
  }
};

const buildEvidenceId = ({
  type,
  source,
  subjectKey
}: {
  type: StorybookEvidenceType;
  source: StorybookEvidenceSource;
  subjectKey: string;
}): string => {
  const keyMaterial = JSON.stringify({
    type,
    source,
    subjectKey
  });
  const hash = createHash("sha256").update(keyMaterial).digest("hex").slice(0, 16);
  return `${type}:${hash}`;
};

const createEvidenceItem = ({
  type,
  source,
  subjectKey,
  summary
}: {
  type: StorybookEvidenceType;
  source: StorybookEvidenceSource;
  subjectKey: string;
  summary: StorybookEvidenceSummary;
}): StorybookEvidenceItem => {
  return {
    id: buildEvidenceId({ type, source, subjectKey }),
    type,
    reliability: resolveEvidenceReliability(type),
    source,
    usage: resolveEvidenceUsage(type),
    summary
  };
};

const compareEvidenceItems = (left: StorybookEvidenceItem, right: StorybookEvidenceItem): number => {
  return left.id.localeCompare(right.id);
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const validateStorybookIndexEntry = (id: string, value: unknown): StorybookIndexEntry => {
  if (!isObjectRecord(value)) {
    throw new Error(`Storybook index entry '${id}' is not an object.`);
  }

  const title = value.title;
  const name = value.name;
  const importPath = value.importPath;
  const storiesImports = value.storiesImports;
  const type = value.type;
  const tags = value.tags;
  const componentPath = value.componentPath;

  if (
    typeof title !== "string" ||
    typeof name !== "string" ||
    typeof importPath !== "string" ||
    (type !== "story" && type !== "docs") ||
    !isStringArray(tags)
  ) {
    throw new Error(`Storybook index entry '${id}' has an unsupported shape.`);
  }

  return {
    id,
    title,
    name,
    importPath,
    storiesImports: isStringArray(storiesImports) ? storiesImports : [],
    type,
    tags,
    ...(typeof componentPath === "string" ? { componentPath } : {})
  };
};

const loadBuildContext = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<StorybookBuildContext> => {
  const indexPath = path.join(buildDir, "index.json");
  const iframeHtmlPath = path.join(buildDir, "iframe.html");
  const buildRoot = normalizePosixPath(path.relative(process.cwd(), buildDir) || ".");

  const indexFile = await readJsonFile<StorybookIndexFile>(indexPath);
  if (!isObjectRecord(indexFile) || !isObjectRecord(indexFile.entries)) {
    throw new Error("Storybook index.json has an unsupported shape.");
  }

  const indexEntries = Object.entries(indexFile.entries)
    .map(([entryId, entryValue]) => validateStorybookIndexEntry(entryId, entryValue))
    .sort((left, right) => left.id.localeCompare(right.id));

  const iframeHtmlText = await readFile(iframeHtmlPath, "utf8");
  const iframeBundlePath = resolveIframeBundlePath(iframeHtmlText);
  const iframeBundleText = await readFile(path.join(buildDir, iframeBundlePath), "utf8");
  const importPathToBundlePath = extractImportPathToBundlePath(iframeBundleText);

  return {
    buildDir,
    buildRoot,
    iframeBundlePath,
    importPathToBundlePath,
    indexEntries
  };
};

const createStorySource = ({
  entryIds,
  importPath,
  bundlePath
}: {
  entryIds: string[];
  importPath: string;
  bundlePath: string;
}): StorybookEvidenceSource => {
  return {
    entryIds: [...entryIds].sort((left, right) => left.localeCompare(right)),
    entryType: "story",
    importPath,
    bundlePath
  };
};

const createDocsSource = ({
  entryId,
  title,
  importPath,
  bundlePath
}: {
  entryId: string;
  title: string;
  importPath: string;
  bundlePath: string;
}): StorybookEvidenceSource => {
  return {
    entryId,
    entryType: "docs",
    title,
    importPath,
    bundlePath
  };
};

export const buildStorybookEvidenceArtifact = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<StorybookEvidenceArtifact> => {
  const context = await loadBuildContext({ buildDir });
  const evidenceItems: StorybookEvidenceItem[] = [];

  const storyEntries = context.indexEntries.filter((entry) => entry.type === "story");
  const docsEntries = context.indexEntries.filter((entry) => entry.type === "docs");

  const storyEntryIdsByImportPath = new Map<string, string[]>();
  for (const entry of storyEntries) {
    const importPath = normalizePosixPath(entry.importPath);
    const existingEntryIds = storyEntryIdsByImportPath.get(importPath) ?? [];
    existingEntryIds.push(entry.id);
    storyEntryIdsByImportPath.set(importPath, existingEntryIds);
  }

  for (const entry of storyEntries) {
    if (entry.componentPath) {
      const importPath = normalizePosixPath(entry.importPath);
      const bundlePath = context.importPathToBundlePath.get(importPath);
      if (!bundlePath) {
        throw new Error(`Missing Storybook bundle mapping for story import '${importPath}'.`);
      }

      const source: StorybookEvidenceSource = {
        entryId: entry.id,
        entryType: "story",
        title: entry.title,
        importPath,
        bundlePath
      };
      evidenceItems.push(
        createEvidenceItem({
          type: "story_componentPath",
          source,
          subjectKey: entry.componentPath,
          summary: {
            componentPath: entry.componentPath
          }
        })
      );
    }
  }

  const storyImportPaths = uniqueSorted([
    ...storyEntries.map((entry) => normalizePosixPath(entry.importPath)),
    ...docsEntries.flatMap((entry) => entry.storiesImports.map((storiesImport) => normalizePosixPath(storiesImport)))
  ]);

  for (const importPath of storyImportPaths) {
    const bundlePath = context.importPathToBundlePath.get(importPath);
    if (!bundlePath) {
      throw new Error(`Missing Storybook bundle mapping for story source '${importPath}'.`);
    }

    const absoluteBundlePath = path.join(context.buildDir, bundlePath);
    const bundleText = await readFile(absoluteBundlePath, "utf8");
    const entryIds = uniqueSorted(storyEntryIdsByImportPath.get(importPath) ?? []);
    const source = createStorySource({ entryIds, importPath, bundlePath });

    const argTypeKeys = collectTopLevelFieldKeys({
      bundleText,
      fieldName: "argTypes"
    });
    if (argTypeKeys.length > 0) {
      evidenceItems.push(
        createEvidenceItem({
          type: "story_argTypes",
          source,
          subjectKey: argTypeKeys.join("|"),
          summary: {
            keys: argTypeKeys
          }
        })
      );
    }

    const argKeys = collectTopLevelFieldKeys({
      bundleText,
      fieldName: "args"
    });
    if (argKeys.length > 0) {
      evidenceItems.push(
        createEvidenceItem({
          type: "story_args",
          source,
          subjectKey: argKeys.join("|"),
          summary: {
            keys: argKeys
          }
        })
      );
    }

    for (const url of extractStoryDesignUrls(bundleText)) {
      evidenceItems.push(
        createEvidenceItem({
          type: "story_design_link",
          source,
          subjectKey: url,
          summary: {
            url
          }
        })
      );
    }
  }

  for (const entry of docsEntries) {
    const importPath = normalizePosixPath(entry.importPath);
    const bundlePath = context.importPathToBundlePath.get(importPath);
    if (!bundlePath) {
      throw new Error(`Missing Storybook bundle mapping for docs source '${importPath}'.`);
    }

    const bundleText = await readFile(path.join(context.buildDir, bundlePath), "utf8");
    const source = createDocsSource({
      entryId: entry.id,
      title: entry.title,
      importPath,
      bundlePath
    });

    for (const linkTarget of extractMdxLinks(bundleText)) {
      evidenceItems.push(
        createEvidenceItem({
          type: "mdx_link",
          source,
          subjectKey: linkTarget,
          summary: {
            linkTarget
          }
        })
      );
    }

    for (const imagePath of extractMdxImageSources(bundleText)) {
      evidenceItems.push(
        createEvidenceItem({
          type: "docs_image",
          source,
          subjectKey: imagePath,
          summary: {
            imagePath
          }
        })
      );
    }

    for (const text of extractMdxTextBlocks(bundleText)) {
      evidenceItems.push(
        createEvidenceItem({
          type: "docs_text",
          source,
          subjectKey: text,
          summary: {
            text
          }
        })
      );
    }
  }

  const javascriptFiles = (await readdir(context.buildDir, { recursive: true }))
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js"))
    .map((entry) => normalizePosixPath(entry))
    .sort((left, right) => left.localeCompare(right));

  for (const bundlePath of javascriptFiles) {
    const bundleText = await readFile(path.join(context.buildDir, bundlePath), "utf8");
    const themeMarkers = extractThemeMarkers(bundleText);
    if (themeMarkers.length > 0) {
      const source: StorybookEvidenceSource = {
        bundlePath
      };
      evidenceItems.push(
        createEvidenceItem({
          type: "theme_bundle",
          source,
          subjectKey: `${bundlePath}|${themeMarkers.join("|")}`,
          summary: {
            themeMarkers
          }
        })
      );
    }
  }

  const cssFiles = (await readdir(context.buildDir, { recursive: true }))
    .filter((entry) => typeof entry === "string" && entry.endsWith(".css"))
    .map((entry) => normalizePosixPath(entry))
    .sort((left, right) => left.localeCompare(right));

  for (const cssPath of cssFiles) {
    const cssText = await readFile(path.join(context.buildDir, cssPath), "utf8");
    evidenceItems.push(
      createEvidenceItem({
        type: "css",
        source: {
          stylesheetPath: cssPath
        },
        subjectKey: cssPath,
        summary: {
          customProperties: extractCssCustomProperties(cssText)
        }
      })
    );
  }

  evidenceItems.sort(compareEvidenceItems);

  const byType: Record<StorybookEvidenceType, number> = Object.fromEntries(
    STORYBOOK_EVIDENCE_TYPES.map((type) => [type, 0])
  ) as Record<StorybookEvidenceType, number>;
  const byReliability: Record<StorybookEvidenceReliability, number> = Object.fromEntries(
    STORYBOOK_EVIDENCE_RELIABILITIES.map((reliability) => [reliability, 0])
  ) as Record<StorybookEvidenceReliability, number>;

  for (const evidenceItem of evidenceItems) {
    byType[evidenceItem.type] += 1;
    byReliability[evidenceItem.reliability] += 1;
  }

  return {
    artifact: "storybook.evidence",
    version: 1,
    buildRoot: context.buildRoot,
    iframeBundlePath: context.iframeBundlePath,
    stats: {
      entryCount: context.indexEntries.length,
      evidenceCount: evidenceItems.length,
      byType,
      byReliability
    },
    evidence: evidenceItems
  };
};

export const writeStorybookEvidenceArtifact = async ({
  buildDir,
  artifact
}: {
  buildDir: string;
  artifact: StorybookEvidenceArtifact;
}): Promise<string> => {
  const outputPath = path.join(buildDir, STORYBOOK_EVIDENCE_OUTPUT_FILE_NAME);
  await writeFile(outputPath, toStableJsonString(artifact as unknown as JsonValue), "utf8");
  return outputPath;
};

export const generateStorybookEvidenceArtifact = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<{ artifact: StorybookEvidenceArtifact; outputPath: string }> => {
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });
  const outputPath = await writeStorybookEvidenceArtifact({ buildDir, artifact });
  return { artifact, outputPath };
};

export const getDefaultStorybookBuildDir = (): string => {
  return path.resolve(process.cwd(), "storybook-static", "storybook-static");
};

export const getStorybookEvidenceOutputFileName = (): string => {
  return STORYBOOK_EVIDENCE_OUTPUT_FILE_NAME;
};
