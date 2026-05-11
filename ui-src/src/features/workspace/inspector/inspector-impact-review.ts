import type { InspectorOverrideDraft } from "./inspector-override-draft";

export type InspectorImpactChangeCategory = "visual" | "layout" | "validation" | "other";

export interface InspectorImpactCategoryCounts {
  visual: number;
  layout: number;
  validation: number;
  other: number;
}

export interface InspectorImpactReviewManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
}

export interface InspectorImpactReviewManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
  components: InspectorImpactReviewManifestEntry[];
}

export interface InspectorImpactReviewManifest {
  screens: InspectorImpactReviewManifestScreen[];
}

export interface InspectorImpactReviewEntry {
  nodeId: string;
  field: string;
}

export interface InspectorImpactReviewOverride {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  field: string;
  category: InspectorImpactChangeCategory;
}

export interface InspectorImpactReviewFile {
  filePath: string;
  overrideCount: number;
  categories: InspectorImpactCategoryCounts;
  overrides: InspectorImpactReviewOverride[];
}

export interface InspectorImpactReviewUnmappedOverride {
  nodeId: string;
  field: string;
  category: InspectorImpactChangeCategory;
}

export interface InspectorImpactReviewSummary {
  totalOverrides: number;
  affectedFiles: number;
  mappedOverrides: number;
  unmappedOverrides: number;
  categories: InspectorImpactCategoryCounts;
}

export interface InspectorImpactReviewModel {
  empty: boolean;
  summary: InspectorImpactReviewSummary;
  files: InspectorImpactReviewFile[];
  unmapped: InspectorImpactReviewUnmappedOverride[];
}

const VISUAL_FIELDS = new Set([
  "fillColor",
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "fontFamily"
]);

const LAYOUT_FIELDS = new Set([
  "padding",
  "gap",
  "width",
  "height",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems"
]);

const VALIDATION_FIELDS = new Set([
  "required",
  "validationType",
  "validationMessage"
]);

function toEmptyCategoryCounts(): InspectorImpactCategoryCounts {
  return {
    visual: 0,
    layout: 0,
    validation: 0,
    other: 0
  };
}

function incrementCategoryCount({
  target,
  category
}: {
  target: InspectorImpactCategoryCounts;
  category: InspectorImpactChangeCategory;
}): void {
  if (category === "visual") {
    target.visual += 1;
    return;
  }
  if (category === "layout") {
    target.layout += 1;
    return;
  }
  if (category === "validation") {
    target.validation += 1;
    return;
  }
  target.other += 1;
}

function classifyImpactCategory(field: string): InspectorImpactChangeCategory {
  if (VALIDATION_FIELDS.has(field)) {
    return "validation";
  }
  if (LAYOUT_FIELDS.has(field)) {
    return "layout";
  }
  if (VISUAL_FIELDS.has(field)) {
    return "visual";
  }
  return "other";
}

function sortEntries<TEntry extends { nodeId: string; field: string }>(
  entries: readonly TEntry[]
): TEntry[] {
  return [...entries].sort((left, right) => {
    if (left.nodeId !== right.nodeId) {
      return left.nodeId.localeCompare(right.nodeId);
    }
    return left.field.localeCompare(right.field);
  });
}

function resolveManifestMapping({
  nodeId,
  manifest
}: {
  nodeId: string;
  manifest: InspectorImpactReviewManifest | null;
}): { filePath: string; nodeName: string; nodeType: string } | null {
  if (!manifest) {
    return null;
  }

  for (const screen of manifest.screens) {
    if (screen.screenId === nodeId) {
      return {
        filePath: screen.file,
        nodeName: screen.screenName,
        nodeType: "screen"
      };
    }

    for (const component of screen.components) {
      if (component.irNodeId === nodeId) {
        return {
          filePath: component.file,
          nodeName: component.irNodeName,
          nodeType: component.irNodeType
        };
      }
    }
  }

  return null;
}

export function deriveInspectorImpactReviewModel({
  entries,
  manifest
}: {
  entries: readonly InspectorImpactReviewEntry[] | InspectorOverrideDraft["entries"];
  manifest: InspectorImpactReviewManifest | null;
}): InspectorImpactReviewModel {
  const normalizedEntries = sortEntries(entries);
  const summaryCategories = toEmptyCategoryCounts();
  const byFile = new Map<string, InspectorImpactReviewFile>();
  const unmapped: InspectorImpactReviewUnmappedOverride[] = [];

  for (const entry of normalizedEntries) {
    const category = classifyImpactCategory(entry.field);
    incrementCategoryCount({
      target: summaryCategories,
      category
    });

    const mapping = resolveManifestMapping({
      nodeId: entry.nodeId,
      manifest
    });

    if (!mapping) {
      unmapped.push({
        nodeId: entry.nodeId,
        field: entry.field,
        category
      });
      continue;
    }

    const existing = byFile.get(mapping.filePath);
    if (existing) {
      existing.overrideCount += 1;
      incrementCategoryCount({
        target: existing.categories,
        category
      });
      existing.overrides.push({
        nodeId: entry.nodeId,
        nodeName: mapping.nodeName,
        nodeType: mapping.nodeType,
        field: entry.field,
        category
      });
      continue;
    }

    byFile.set(mapping.filePath, {
      filePath: mapping.filePath,
      overrideCount: 1,
      categories: {
        visual: category === "visual" ? 1 : 0,
        layout: category === "layout" ? 1 : 0,
        validation: category === "validation" ? 1 : 0,
        other: category === "other" ? 1 : 0
      },
      overrides: [{
        nodeId: entry.nodeId,
        nodeName: mapping.nodeName,
        nodeType: mapping.nodeType,
        field: entry.field,
        category
      }]
    });
  }

  const files = Array.from(byFile.values())
    .map((fileReview) => ({
      ...fileReview,
      overrides: sortEntries(fileReview.overrides)
        .map((entry) => ({
          ...entry
        }))
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  const sortedUnmapped = sortEntries(unmapped).map((entry) => ({
    ...entry
  }));

  const totalOverrides = normalizedEntries.length;
  const unmappedOverrides = sortedUnmapped.length;
  const mappedOverrides = totalOverrides - unmappedOverrides;

  return {
    empty: totalOverrides === 0,
    summary: {
      totalOverrides,
      affectedFiles: files.length,
      mappedOverrides,
      unmappedOverrides,
      categories: summaryCategories
    },
    files,
    unmapped: sortedUnmapped
  };
}
