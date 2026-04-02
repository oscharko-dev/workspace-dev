import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectStorybookAssetMetadata, type StorybookAssetKind } from "../icon-library-resolution.js";
import { extractMdxLinks, extractStoryDesignUrls } from "./bundle-analysis.js";
import {
  buildStorybookEvidenceArtifact,
  getDefaultStorybookBuildDir,
  loadStorybookBuildContext
} from "./evidence.js";
import { extractStaticObjectField } from "./static-object-field.js";
import { normalizePosixPath, uniqueSorted } from "./text.js";
import type {
  StorybookBuildContext,
  StorybookCatalogArtifact,
  StorybookCatalogDocsAttachment,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookCatalogJsonValue,
  StorybookCatalogLinkMetadata,
  StorybookCatalogResolvedDocsLink,
  StorybookCatalogSignalReferences,
  StorybookCatalogSignalType,
  StorybookEntryType,
  StorybookEvidenceArtifact,
  StorybookIndexEntry
} from "./types.js";

const STORYBOOK_CATALOG_OUTPUT_FILE_NAME = "storybook.catalog.json";

const STORYBOOK_CATALOG_SIGNAL_TYPES: StorybookCatalogSignalType[] = [
  "componentPath",
  "args",
  "argTypes",
  "designLinks",
  "mdxLinks",
  "docsImages",
  "docsText",
  "themeBundles",
  "css"
];

const STORYBOOK_CATALOG_DOCS_ATTACHMENTS: StorybookCatalogDocsAttachment[] = [
  "attached",
  "unattached",
  "not_applicable"
];

type JsonValue = StorybookCatalogJsonValue;

interface StorybookStoryBundleMetadata {
  args?: Record<string, StorybookCatalogJsonValue>;
  argTypes?: Record<string, StorybookCatalogJsonValue>;
  designUrls: string[];
}

interface StorybookDocsBundleMetadata {
  mdxLinks: StorybookCatalogLinkMetadata;
}

interface StorybookFamilyAccumulator {
  id: string;
  title: string;
  name: string;
  tier: string;
  isDocsOnlyTier: boolean;
  entryIds: Set<string>;
  storyEntryIds: Set<string>;
  docsEntryIds: Set<string>;
  componentPaths: Set<string>;
  propKeys: Set<string>;
  designUrls: Set<string>;
  assetKeys: Set<string>;
  assetKinds: Set<StorybookAssetKind>;
  internalDocsLinks: Map<string, StorybookCatalogResolvedDocsLink>;
  externalDocsLinks: Set<string>;
  signalReferences: StorybookCatalogSignalReferences;
}

const toStableJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (typeof value === "object" && value !== null) {
    const sortedEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    const stableObject: Record<string, JsonValue> = {};
    for (const [key, entryValue] of sortedEntries) {
      stableObject[key] = toStableJsonValue(entryValue);
    }
    return stableObject;
  }

  return value;
};

const toStableJsonString = (value: JsonValue): string => {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
};

const buildStableId = (prefix: string, value: unknown): string => {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
};

const buildFamilyId = (title: string): string => {
  return buildStableId("family", { title });
};

const createEmptySignalReferences = (): StorybookCatalogSignalReferences => ({
  componentPath: [],
  args: [],
  argTypes: [],
  designLinks: [],
  mdxLinks: [],
  docsImages: [],
  docsText: [],
  themeBundles: [],
  css: []
});

const createEmptyLinkMetadata = (): StorybookCatalogLinkMetadata => ({
  internal: [],
  external: []
});

const cloneSignalReferences = (value: StorybookCatalogSignalReferences): StorybookCatalogSignalReferences => ({
  componentPath: [...value.componentPath],
  args: [...value.args],
  argTypes: [...value.argTypes],
  designLinks: [...value.designLinks],
  mdxLinks: [...value.mdxLinks],
  docsImages: [...value.docsImages],
  docsText: [...value.docsText],
  themeBundles: [...value.themeBundles],
  css: [...value.css]
});

const cloneLinkMetadata = (value: StorybookCatalogLinkMetadata): StorybookCatalogLinkMetadata => ({
  internal: value.internal.map((link) => ({ ...link })),
  external: [...value.external]
});

const mergeSignalReferences = ({
  target,
  source
}: {
  target: StorybookCatalogSignalReferences;
  source: StorybookCatalogSignalReferences;
}): void => {
  for (const signalType of STORYBOOK_CATALOG_SIGNAL_TYPES) {
    target[signalType] = uniqueSorted([...target[signalType], ...source[signalType]]);
  }
};

const addSignalReference = ({
  target,
  signalType,
  evidenceId
}: {
  target: StorybookCatalogSignalReferences;
  signalType: StorybookCatalogSignalType;
  evidenceId: string;
}): void => {
  target[signalType] = uniqueSorted([...target[signalType], evidenceId]);
};

const resolveTier = (title: string): string => {
  return title.split("/")[0] ?? title;
};

const resolveDocsAttachment = (entry: StorybookIndexEntry): StorybookCatalogDocsAttachment => {
  if (entry.type === "story") {
    return "not_applicable";
  }

  if (entry.tags.includes("attached-mdx")) {
    return "attached";
  }

  if (entry.tags.includes("unattached-mdx")) {
    return "unattached";
  }

  return entry.storiesImports.length > 0 ? "attached" : "unattached";
};

const toCatalogSignalType = (evidenceType: StorybookEvidenceArtifact["evidence"][number]["type"]): StorybookCatalogSignalType => {
  switch (evidenceType) {
    case "story_componentPath":
      return "componentPath";
    case "story_args":
      return "args";
    case "story_argTypes":
      return "argTypes";
    case "story_design_link":
      return "designLinks";
    case "mdx_link":
      return "mdxLinks";
    case "docs_image":
      return "docsImages";
    case "docs_text":
      return "docsText";
    case "theme_bundle":
      return "themeBundles";
    case "css":
      return "css";
    default: {
      const _exhaustive: never = evidenceType;
      throw new Error(`Unhandled evidence type: ${String(_exhaustive)}`);
    }
  }
};

const normalizeDocsRoutePath = (value: string): string => {
  const [pathWithoutQuery] = value.split(/[?#]/u, 1);
  return pathWithoutQuery ?? value;
};

const resolveDocsRouteEntryId = (value: string): string | undefined => {
  const normalizedPath = normalizeDocsRoutePath(value);
  if (!normalizedPath.startsWith("/docs/")) {
    return undefined;
  }

  const candidate = decodeURIComponent(normalizedPath.slice("/docs/".length)).trim();
  return candidate.length > 0 ? candidate : undefined;
};

const compareResolvedDocsLinks = (
  left: StorybookCatalogResolvedDocsLink,
  right: StorybookCatalogResolvedDocsLink
): number => {
  const byPath = left.path.localeCompare(right.path);
  if (byPath !== 0) {
    return byPath;
  }
  return (left.entryId ?? "").localeCompare(right.entryId ?? "");
};

const compareCatalogEntries = (left: StorybookCatalogEntry, right: StorybookCatalogEntry): number => {
  return left.id.localeCompare(right.id);
};

const compareCatalogFamilies = (left: StorybookCatalogFamily, right: StorybookCatalogFamily): number => {
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return left.id.localeCompare(right.id);
};

const buildEntrySignalReferenceMap = (
  evidenceArtifact: StorybookEvidenceArtifact
): {
  byEntryId: Map<string, StorybookCatalogSignalReferences>;
  globalSignalReferences: StorybookCatalogSignalReferences;
} => {
  const byEntryId = new Map<string, StorybookCatalogSignalReferences>();
  const globalSignalReferences = createEmptySignalReferences();

  const getEntrySignalReferences = (entryId: string): StorybookCatalogSignalReferences => {
    const existing = byEntryId.get(entryId);
    if (existing) {
      return existing;
    }
    const created = createEmptySignalReferences();
    byEntryId.set(entryId, created);
    return created;
  };

  for (const evidenceItem of evidenceArtifact.evidence) {
    const signalType = toCatalogSignalType(evidenceItem.type);
    if (signalType === "themeBundles" || signalType === "css") {
      addSignalReference({
        target: globalSignalReferences,
        signalType,
        evidenceId: evidenceItem.id
      });
      continue;
    }

    const entryId = evidenceItem.source.entryId;
    if (typeof entryId === "string") {
      addSignalReference({
        target: getEntrySignalReferences(entryId),
        signalType,
        evidenceId: evidenceItem.id
      });
    }

    for (const sourceEntryId of evidenceItem.source.entryIds ?? []) {
      addSignalReference({
        target: getEntrySignalReferences(sourceEntryId),
        signalType,
        evidenceId: evidenceItem.id
      });
    }
  }

  return {
    byEntryId,
    globalSignalReferences
  };
};

const buildStoryMetadataByImportPath = async ({
  buildDir,
  buildContext,
  storyEntries
}: {
  buildDir: string;
  buildContext: StorybookBuildContext;
  storyEntries: StorybookIndexEntry[];
}): Promise<Map<string, StorybookStoryBundleMetadata>> => {
  const metadataByImportPath = new Map<string, StorybookStoryBundleMetadata>();
  for (const importPath of uniqueSorted(storyEntries.map((entry) => normalizePosixPath(entry.importPath)))) {
    const bundlePath = buildContext.importPathToBundlePath.get(importPath);
    if (!bundlePath) {
      throw new Error(`Missing Storybook bundle mapping for story source '${importPath}'.`);
    }

    const bundleText = await readFile(path.join(buildDir, bundlePath), "utf8");
    const args = extractStaticObjectField({
      bundleText,
      fieldName: "args"
    });
    const argTypes = extractStaticObjectField({
      bundleText,
      fieldName: "argTypes"
    });
    metadataByImportPath.set(importPath, {
      ...(args ? { args } : {}),
      ...(argTypes ? { argTypes } : {}),
      designUrls: extractStoryDesignUrls(bundleText)
    });
  }

  return metadataByImportPath;
};

const buildDocsMetadataByImportPath = async ({
  buildDir,
  buildContext,
  docsEntries,
  entryById
}: {
  buildDir: string;
  buildContext: StorybookBuildContext;
  docsEntries: StorybookIndexEntry[];
  entryById: ReadonlyMap<string, StorybookIndexEntry>;
}): Promise<Map<string, StorybookDocsBundleMetadata>> => {
  const metadataByImportPath = new Map<string, StorybookDocsBundleMetadata>();

  for (const entry of docsEntries) {
    const importPath = normalizePosixPath(entry.importPath);
    const bundlePath = buildContext.importPathToBundlePath.get(importPath);
    if (!bundlePath) {
      throw new Error(`Missing Storybook bundle mapping for docs source '${importPath}'.`);
    }

    const bundleText = await readFile(path.join(buildDir, bundlePath), "utf8");
    const internal: StorybookCatalogResolvedDocsLink[] = [];
    const external: string[] = [];

    for (const linkTarget of extractMdxLinks(bundleText)) {
      if (linkTarget.startsWith("/docs/")) {
        const linkedEntryId = resolveDocsRouteEntryId(linkTarget);
        const linkedEntry = linkedEntryId ? entryById.get(linkedEntryId) : undefined;
        internal.push({
          path: linkTarget,
          ...(linkedEntryId ? { entryId: linkedEntryId } : {}),
          ...(linkedEntry
            ? {
                familyId: buildFamilyId(linkedEntry.title),
                familyTitle: linkedEntry.title
              }
            : {})
        });
        continue;
      }

      external.push(linkTarget);
    }

    metadataByImportPath.set(importPath, {
      mdxLinks: {
        internal: internal.sort(compareResolvedDocsLinks),
        external: uniqueSorted(external)
      }
    });
  }

  return metadataByImportPath;
};

const buildCatalogEntries = ({
  buildContext,
  docsOnlyTiers,
  globalSignalReferences,
  signalReferencesByEntryId,
  storyMetadataByImportPath,
  docsMetadataByImportPath
}: {
  buildContext: StorybookBuildContext;
  docsOnlyTiers: ReadonlySet<string>;
  globalSignalReferences: StorybookCatalogSignalReferences;
  signalReferencesByEntryId: ReadonlyMap<string, StorybookCatalogSignalReferences>;
  storyMetadataByImportPath: ReadonlyMap<string, StorybookStoryBundleMetadata>;
  docsMetadataByImportPath: ReadonlyMap<string, StorybookDocsBundleMetadata>;
}): StorybookCatalogEntry[] => {
  return buildContext.indexEntries
    .map((entry) => {
      const normalizedImportPath = normalizePosixPath(entry.importPath);
      const tier = resolveTier(entry.title);
      const storyMetadata = storyMetadataByImportPath.get(normalizedImportPath);
      const docsMetadata = docsMetadataByImportPath.get(normalizedImportPath);
      const assetMetadata = collectStorybookAssetMetadata({
        title: entry.title,
        name: entry.name,
        tags: entry.tags,
        ...(entry.componentPath ? { componentPath: entry.componentPath } : {}),
        ...(entry.type === "story" && storyMetadata?.args ? { args: storyMetadata.args } : {}),
        ...(entry.type === "story" && storyMetadata?.argTypes ? { argTypes: storyMetadata.argTypes } : {})
      });
      const signalReferences = cloneSignalReferences(globalSignalReferences);
      const entrySignalReferences = signalReferencesByEntryId.get(entry.id);

      if (entrySignalReferences) {
        mergeSignalReferences({
          target: signalReferences,
          source: entrySignalReferences
        });
      }

      return {
        id: entry.id,
        title: entry.title,
        name: entry.name,
        type: entry.type,
        tier,
        tags: uniqueSorted(entry.tags),
        importPath: normalizedImportPath,
        storiesImports: uniqueSorted(entry.storiesImports.map((storiesImport) => normalizePosixPath(storiesImport))),
        docsAttachment: resolveDocsAttachment(entry),
        familyId: buildFamilyId(entry.title),
        familyTitle: entry.title,
        isDocsOnlyTier: docsOnlyTiers.has(tier),
        ...(entry.componentPath ? { componentPath: entry.componentPath } : {}),
        signalReferences,
        metadata: {
          ...(entry.type === "story" && storyMetadata?.args ? { args: storyMetadata.args } : {}),
          ...(entry.type === "story" && storyMetadata?.argTypes ? { argTypes: storyMetadata.argTypes } : {}),
          designUrls: entry.type === "story" ? storyMetadata?.designUrls ?? [] : [],
          mdxLinks: entry.type === "docs" ? cloneLinkMetadata(docsMetadata?.mdxLinks ?? createEmptyLinkMetadata()) : createEmptyLinkMetadata(),
          assetKeys: assetMetadata.assetKeys,
          ...(assetMetadata.assetKind ? { assetKind: assetMetadata.assetKind } : {})
        }
      } satisfies StorybookCatalogEntry;
    })
    .sort(compareCatalogEntries);
};

const buildCatalogFamilies = ({
  entries
}: {
  entries: StorybookCatalogEntry[];
}): StorybookCatalogFamily[] => {
  const families = new Map<string, StorybookFamilyAccumulator>();

  const getFamilyAccumulator = (entry: StorybookCatalogEntry): StorybookFamilyAccumulator => {
    const existing = families.get(entry.familyId);
    if (existing) {
      return existing;
    }

    const created: StorybookFamilyAccumulator = {
      id: entry.familyId,
      title: entry.familyTitle,
      name: entry.title.split("/").at(-1) ?? entry.title,
      tier: entry.tier,
      isDocsOnlyTier: entry.isDocsOnlyTier,
      entryIds: new Set<string>(),
      storyEntryIds: new Set<string>(),
      docsEntryIds: new Set<string>(),
      componentPaths: new Set<string>(),
      propKeys: new Set<string>(),
      designUrls: new Set<string>(),
      assetKeys: new Set<string>(),
      assetKinds: new Set<StorybookAssetKind>(),
      internalDocsLinks: new Map<string, StorybookCatalogResolvedDocsLink>(),
      externalDocsLinks: new Set<string>(),
      signalReferences: createEmptySignalReferences()
    };
    families.set(entry.familyId, created);
    return created;
  };

  for (const entry of entries) {
    const family = getFamilyAccumulator(entry);
    family.entryIds.add(entry.id);
    mergeSignalReferences({
      target: family.signalReferences,
      source: entry.signalReferences
    });

    if (entry.type === "story") {
      family.storyEntryIds.add(entry.id);
      for (const key of Object.keys(entry.metadata.args ?? {})) {
        family.propKeys.add(key);
      }
      for (const key of Object.keys(entry.metadata.argTypes ?? {})) {
        family.propKeys.add(key);
      }
      for (const designUrl of entry.metadata.designUrls) {
        family.designUrls.add(designUrl);
      }
      for (const assetKey of entry.metadata.assetKeys) {
        family.assetKeys.add(assetKey);
      }
      if (entry.metadata.assetKind) {
        family.assetKinds.add(entry.metadata.assetKind);
      }
      if (entry.componentPath) {
        family.componentPaths.add(entry.componentPath);
      }
      continue;
    }

    family.docsEntryIds.add(entry.id);
    for (const assetKey of entry.metadata.assetKeys) {
      family.assetKeys.add(assetKey);
    }
    if (entry.metadata.assetKind) {
      family.assetKinds.add(entry.metadata.assetKind);
    }
    for (const link of entry.metadata.mdxLinks.internal) {
      family.internalDocsLinks.set(`${link.path}|${link.entryId ?? ""}`, link);
    }
    for (const link of entry.metadata.mdxLinks.external) {
      family.externalDocsLinks.add(link);
    }
  }

  return [...families.values()]
    .map((family) => {
      const componentPaths = uniqueSorted(family.componentPaths);
      return {
        id: family.id,
        title: family.title,
        name: family.name,
        tier: family.tier,
        isDocsOnlyTier: family.isDocsOnlyTier,
        entryIds: uniqueSorted(family.entryIds),
        storyEntryIds: uniqueSorted(family.storyEntryIds),
        docsEntryIds: uniqueSorted(family.docsEntryIds),
        storyCount: family.storyEntryIds.size,
        propKeys: uniqueSorted(family.propKeys),
        hasDesignReference: family.designUrls.size > 0,
        ...(componentPaths.length === 1 ? { componentPath: componentPaths[0] } : {}),
        signalReferences: cloneSignalReferences(family.signalReferences),
        metadata: {
          designUrls: uniqueSorted(family.designUrls),
          mdxLinks: {
            internal: [...family.internalDocsLinks.values()].sort(compareResolvedDocsLinks),
            external: uniqueSorted(family.externalDocsLinks)
          },
          assetKeys: uniqueSorted(family.assetKeys),
          ...(family.assetKinds.has("icon")
            ? { assetKind: "icon" as const }
            : family.assetKinds.has("illustration")
              ? { assetKind: "illustration" as const }
              : {})
        }
      } satisfies StorybookCatalogFamily;
    })
    .sort(compareCatalogFamilies);
};

const buildCatalogStats = ({
  entries,
  families,
  docsOnlyTiers
}: {
  entries: StorybookCatalogEntry[];
  families: StorybookCatalogFamily[];
  docsOnlyTiers: string[];
}): StorybookCatalogArtifact["stats"] => {
  const byEntryType: Record<StorybookEntryType, number> = {
    story: 0,
    docs: 0
  };
  const byTier: Record<string, number> = {};
  const byDocsAttachment = Object.fromEntries(
    STORYBOOK_CATALOG_DOCS_ATTACHMENTS.map((attachment) => [attachment, 0])
  ) as Record<StorybookCatalogDocsAttachment, number>;
  const byReferencedSignal = Object.fromEntries(
    STORYBOOK_CATALOG_SIGNAL_TYPES.map((signalType) => [signalType, 0])
  ) as Record<StorybookCatalogSignalType, number>;

  for (const entry of entries) {
    byEntryType[entry.type] += 1;
    byTier[entry.tier] = (byTier[entry.tier] ?? 0) + 1;
    byDocsAttachment[entry.docsAttachment] += 1;

    for (const signalType of STORYBOOK_CATALOG_SIGNAL_TYPES) {
      if (entry.signalReferences[signalType].length > 0) {
        byReferencedSignal[signalType] += 1;
      }
    }
  }

  return {
    entryCount: entries.length,
    familyCount: families.length,
    byEntryType,
    byTier: Object.fromEntries(Object.entries(byTier).sort(([left], [right]) => left.localeCompare(right))),
    byDocsAttachment,
    docsOnlyTiers,
    byReferencedSignal
  };
};

export const buildStorybookCatalogArtifact = async ({
  buildDir,
  buildContext,
  evidenceArtifact
}: {
  buildDir: string;
  buildContext?: StorybookBuildContext;
  evidenceArtifact?: StorybookEvidenceArtifact;
}): Promise<StorybookCatalogArtifact> => {
  const resolvedBuildContext = buildContext ?? (await loadStorybookBuildContext({ buildDir }));
  const resolvedEvidenceArtifact =
    evidenceArtifact ?? (await buildStorybookEvidenceArtifact({ buildDir, buildContext: resolvedBuildContext }));
  const entryById = new Map(resolvedBuildContext.indexEntries.map((entry) => [entry.id, entry] as const));
  const storyEntries = resolvedBuildContext.indexEntries.filter((entry) => entry.type === "story");
  const docsEntries = resolvedBuildContext.indexEntries.filter((entry) => entry.type === "docs");
  const tierHasNonDocs = new Map<string, boolean>();
  for (const entry of resolvedBuildContext.indexEntries) {
    const tier = resolveTier(entry.title);
    if (entry.type !== "docs") {
      tierHasNonDocs.set(tier, true);
    } else if (!tierHasNonDocs.has(tier)) {
      tierHasNonDocs.set(tier, false);
    }
  }
  const docsOnlyTiers = uniqueSorted(
    [...tierHasNonDocs.entries()]
      .filter(([, hasNonDocs]) => !hasNonDocs)
      .map(([tier]) => tier)
  );

  const storyMetadataByImportPath = await buildStoryMetadataByImportPath({
    buildDir,
    buildContext: resolvedBuildContext,
    storyEntries
  });
  const docsMetadataByImportPath = await buildDocsMetadataByImportPath({
    buildDir,
    buildContext: resolvedBuildContext,
    docsEntries,
    entryById
  });
  const { byEntryId, globalSignalReferences } = buildEntrySignalReferenceMap(resolvedEvidenceArtifact);
  const catalogEntries = buildCatalogEntries({
    buildContext: resolvedBuildContext,
    docsOnlyTiers: new Set(docsOnlyTiers),
    globalSignalReferences,
    signalReferencesByEntryId: byEntryId,
    storyMetadataByImportPath,
    docsMetadataByImportPath
  });
  const catalogFamilies = buildCatalogFamilies({
    entries: catalogEntries
  });

  return {
    artifact: "storybook.catalog",
    version: 1,
    stats: buildCatalogStats({
      entries: catalogEntries,
      families: catalogFamilies,
      docsOnlyTiers
    }),
    entries: catalogEntries,
    families: catalogFamilies
  };
};

export const writeStorybookCatalogArtifact = async ({
  buildDir,
  artifact,
  outputFilePath
}: {
  buildDir: string;
  artifact: StorybookCatalogArtifact;
  outputFilePath?: string;
}): Promise<string> => {
  const outputPath = outputFilePath ?? path.join(buildDir, STORYBOOK_CATALOG_OUTPUT_FILE_NAME);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, toStableJsonString(artifact as unknown as JsonValue), "utf8");
  return outputPath;
};

export const generateStorybookCatalogArtifact = async ({
  buildDir,
  outputFilePath
}: {
  buildDir: string;
  outputFilePath?: string;
}): Promise<{ artifact: StorybookCatalogArtifact; outputPath: string }> => {
  const artifact = await buildStorybookCatalogArtifact({ buildDir });
  const outputPath = await writeStorybookCatalogArtifact({
    buildDir,
    artifact,
    ...(outputFilePath ? { outputFilePath } : {})
  });
  return {
    artifact,
    outputPath
  };
};

export const getStorybookCatalogOutputFileName = (): string => {
  return STORYBOOK_CATALOG_OUTPUT_FILE_NAME;
};

export const getDefaultStorybookCatalogBuildDir = (): string => {
  return getDefaultStorybookBuildDir();
};
