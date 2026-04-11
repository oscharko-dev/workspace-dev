import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMatchReportArtifact,
  ComponentMatchReportEntry,
  ComponentMatchReportFigmaReferenceNode,
  ComponentMatchStatus,
  StorybookCatalogArtifact,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookComponentVisualCatalogArtifact,
  StorybookComponentVisualCatalogEntry,
  StorybookComponentVisualSkipReason,
  StorybookEvidenceArtifact
} from "./types.js";

const STORYBOOK_COMPONENT_VISUAL_CATALOG_OUTPUT_FILE_NAME = "storybook.component-visual-catalog.json";
const DEFAULT_CAPTURE_PADDING = 16;
const DEFAULT_CAPTURE_STRATEGY = "storybook_root_union";
const DEFAULT_COMPONENT_ID_SUFFIX = "unresolved";
const COMPONENT_VISUAL_SKIP_REASONS: StorybookComponentVisualSkipReason[] = [
  "unmatched",
  "ambiguous",
  "docs_only",
  "missing_story",
  "missing_reference_node",
  "missing_authoritative_story"
];
const COMPONENT_MATCH_STATUSES: ComponentMatchStatus[] = ["matched", "ambiguous", "unmatched"];

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface BuildStorybookComponentVisualCatalogArtifactInput {
  componentMatchReportArtifact: ComponentMatchReportArtifact;
  catalogArtifact: StorybookCatalogArtifact;
  evidenceArtifact: StorybookEvidenceArtifact;
}

interface SelectedStoryTarget {
  entry: StorybookCatalogEntry;
  warnings: string[];
}

interface SelectedReferenceNode {
  node: ComponentMatchReportFigmaReferenceNode;
  warnings: string[];
}

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const compareCatalogEntries = (left: StorybookCatalogEntry, right: StorybookCatalogEntry): number => {
  const byId = left.id.localeCompare(right.id);
  if (byId !== 0) {
    return byId;
  }
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return left.name.localeCompare(right.name);
};

const compareComponentVisualEntries = (
  left: StorybookComponentVisualCatalogEntry,
  right: StorybookComponentVisualCatalogEntry
): number => {
  const byFamilyName = left.figmaFamilyName.localeCompare(right.figmaFamilyName);
  if (byFamilyName !== 0) {
    return byFamilyName;
  }
  const byFamilyKey = left.figmaFamilyKey.localeCompare(right.figmaFamilyKey);
  if (byFamilyKey !== 0) {
    return byFamilyKey;
  }
  return left.componentId.localeCompare(right.componentId);
};

const toStableJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      result[key] = toStableJsonValue(entryValue);
    }
    return result;
  }
  return value;
};

const toStableJsonString = (value: JsonValue): string => `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;

const normalizeComparableText = (value: string | undefined): string => {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2")
    .replace(/[_/\\-]+/gu, " ")
    .replace(/[^a-zA-Z0-9\s]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
};

const addNormalizedSignals = (target: Set<string>, value: string | undefined): void => {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return;
  }
  target.add(normalized);
  for (const token of normalized.split(" ")) {
    if (token.length > 0) {
      target.add(token);
    }
  }
};

const collectJsonSignals = (value: StorybookCatalogEntry["metadata"]["args"] | StorybookCatalogEntry["metadata"]["argTypes"], target: Set<string>): void => {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonSignals(entry, target);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, entryValue] of Object.entries(value)) {
      addNormalizedSignals(target, key);
      collectJsonSignals(entryValue as StorybookCatalogEntry["metadata"]["args"], target);
    }
    return;
  }
  addNormalizedSignals(target, String(value));
};

const createSkipReasonCounts = (): Record<StorybookComponentVisualSkipReason, number> => {
  return Object.fromEntries(COMPONENT_VISUAL_SKIP_REASONS.map((reason) => [reason, 0])) as Record<
    StorybookComponentVisualSkipReason,
    number
  >;
};

const createMatchStatusCounts = (): Record<ComponentMatchStatus, number> => {
  return Object.fromEntries(COMPONENT_MATCH_STATUSES.map((status) => [status, 0])) as Record<ComponentMatchStatus, number>;
};

const toUniqueSortedWarnings = (warnings: string[]): string[] => [...new Set(warnings)].sort(compareStrings);

const buildStorySignals = (entry: StorybookCatalogEntry): Set<string> => {
  const signals = new Set<string>();
  addNormalizedSignals(signals, entry.title);
  addNormalizedSignals(signals, entry.name);
  collectJsonSignals(entry.metadata.args, signals);
  collectJsonSignals(entry.metadata.argTypes, signals);
  return signals;
};

const buildAuthoritativeStoryEntryIds = ({
  evidenceArtifact,
  entriesById
}: {
  evidenceArtifact: StorybookEvidenceArtifact;
  entriesById: Map<string, StorybookCatalogEntry>;
}): Set<string> => {
  const authoritativeStoryEntryIds = new Set<string>();
  for (const evidence of evidenceArtifact.evidence) {
    if (evidence.reliability !== "authoritative") {
      continue;
    }
    const sourceEntryIds = [evidence.source.entryId ?? "", ...(evidence.source.entryIds ?? [])]
      .map((entryId) => entryId.trim())
      .filter((entryId) => entryId.length > 0);
    for (const entryId of sourceEntryIds) {
      const entry = entriesById.get(entryId);
      if (entry?.type === "story") {
        authoritativeStoryEntryIds.add(entryId);
      }
    }
  }
  return authoritativeStoryEntryIds;
};

const toStoryTitle = (entry: StorybookCatalogEntry): string => `${entry.title}/${entry.name}`;

const buildComponentId = ({
  figmaFamilyKey,
  storyEntryId,
  suffix
}: {
  figmaFamilyKey: string;
  storyEntryId?: string;
  suffix?: string;
}): string => `${figmaFamilyKey}::${storyEntryId ?? suffix ?? DEFAULT_COMPONENT_ID_SUFFIX}`;

const selectStoryTarget = ({
  componentEntry,
  storybookFamily,
  entriesById,
  authoritativeStoryEntryIds
}: {
  componentEntry: ComponentMatchReportEntry;
  storybookFamily: StorybookCatalogFamily;
  entriesById: Map<string, StorybookCatalogEntry>;
  authoritativeStoryEntryIds: Set<string>;
}): {
  skipReason?: StorybookComponentVisualSkipReason;
  selectedStory?: SelectedStoryTarget;
} => {
  if (componentEntry.storyVariant) {
    const selectedEntry = entriesById.get(componentEntry.storyVariant.entryId);
    if (!selectedEntry || selectedEntry.type !== "story" || selectedEntry.familyId !== storybookFamily.id) {
      return {
        skipReason: "missing_story"
      };
    }
    return {
      selectedStory: {
        entry: selectedEntry,
        warnings: []
      }
    };
  }

  if (storybookFamily.storyEntryIds.length === 0) {
    return {
      skipReason: storybookFamily.docsEntryIds.length > 0 || storybookFamily.isDocsOnlyTier ? "docs_only" : "missing_story"
    };
  }

  const authoritativeStories = storybookFamily.storyEntryIds
    .map((entryId) => entriesById.get(entryId))
    .filter((entry): entry is StorybookCatalogEntry => entry !== undefined && entry.type === "story")
    .filter((entry) => authoritativeStoryEntryIds.has(entry.id))
    .sort(compareCatalogEntries);

  const selectedEntry = authoritativeStories[0];
  if (!selectedEntry) {
    return {
      skipReason: "missing_authoritative_story"
    };
  }

  return {
    selectedStory: {
      entry: selectedEntry,
      warnings: ["story_selected_from_authoritative_fallback"]
    }
  };
};

const hasDefaultReferenceSignal = (candidate: ComponentMatchReportFigmaReferenceNode): boolean => {
  if (candidate.source === "published_component_set") {
    return true;
  }
  if (candidate.variantProperties.length === 0) {
    return true;
  }
  const signals = new Set<string>();
  addNormalizedSignals(signals, candidate.nodeName);
  for (const variantProperty of candidate.variantProperties) {
    addNormalizedSignals(signals, variantProperty.property);
    for (const value of variantProperty.values) {
      addNormalizedSignals(signals, value);
    }
  }
  return signals.has("default") || signals.has("base") || signals.has("canonical");
};

const buildReferenceNodeSignals = (candidate: ComponentMatchReportFigmaReferenceNode): Set<string> => {
  const signals = new Set<string>();
  addNormalizedSignals(signals, candidate.nodeName);
  for (const variantProperty of candidate.variantProperties) {
    addNormalizedSignals(signals, variantProperty.property);
    for (const value of variantProperty.values) {
      addNormalizedSignals(signals, value);
    }
  }
  return signals;
};

const compareReferenceNodeCandidates = ({
  left,
  right,
  storySignals
}: {
  left: ComponentMatchReportFigmaReferenceNode;
  right: ComponentMatchReportFigmaReferenceNode;
  storySignals: Set<string>;
}): number => {
  const leftSignals = buildReferenceNodeSignals(left);
  const rightSignals = buildReferenceNodeSignals(right);
  const leftOverlap = [...leftSignals].filter((signal) => storySignals.has(signal)).length;
  const rightOverlap = [...rightSignals].filter((signal) => storySignals.has(signal)).length;
  if (leftOverlap !== rightOverlap) {
    return rightOverlap - leftOverlap;
  }

  const leftDefaultRank = hasDefaultReferenceSignal(left) ? 0 : 1;
  const rightDefaultRank = hasDefaultReferenceSignal(right) ? 0 : 1;
  if (leftDefaultRank !== rightDefaultRank) {
    return leftDefaultRank - rightDefaultRank;
  }

  const byFileKey = left.fileKey.localeCompare(right.fileKey);
  if (byFileKey !== 0) {
    return byFileKey;
  }
  return left.nodeId.localeCompare(right.nodeId);
};

const selectReferenceNode = ({
  referenceNodes,
  storyEntry
}: {
  referenceNodes: ComponentMatchReportFigmaReferenceNode[];
  storyEntry: StorybookCatalogEntry;
}): SelectedReferenceNode | undefined => {
  if (referenceNodes.length === 0) {
    return undefined;
  }

  const storySignals = buildStorySignals(storyEntry);
  const sortedCandidates = [...referenceNodes].sort((left, right) =>
    compareReferenceNodeCandidates({
      left,
      right,
      storySignals
    })
  );
  const selectedNode = sortedCandidates[0];
  if (!selectedNode) {
    return undefined;
  }

  const warnings: string[] = [];
  const selectedSignals = buildReferenceNodeSignals(selectedNode);
  const selectedOverlapCount = [...selectedSignals].filter((signal) => storySignals.has(signal)).length;
  if (selectedOverlapCount === 0 && hasDefaultReferenceSignal(selectedNode)) {
    warnings.push("reference_node_selected_from_default_fallback");
  }

  const runnerUp = sortedCandidates[1];
  if (runnerUp) {
    const comparison = compareReferenceNodeCandidates({
      left: selectedNode,
      right: runnerUp,
      storySignals
    });
    if (comparison === 0) {
      warnings.push("reference_node_selected_by_lexical_node_id");
    }
  }

  return {
    node: selectedNode,
    warnings
  };
};

const createSkippedEntry = ({
  componentEntry,
  storybookFamily,
  skipReason,
  storyEntryId,
  warnings
}: {
  componentEntry: ComponentMatchReportEntry;
  storybookFamily?: StorybookCatalogFamily;
  skipReason: StorybookComponentVisualSkipReason;
  storyEntryId?: string;
  warnings?: string[];
}): StorybookComponentVisualCatalogEntry => {
  return {
    componentId: buildComponentId({
      figmaFamilyKey: componentEntry.figma.familyKey,
      ...(storyEntryId ? { storyEntryId } : { suffix: skipReason })
    }),
    figmaFamilyKey: componentEntry.figma.familyKey,
    figmaFamilyName: componentEntry.figma.familyName,
    matchStatus: componentEntry.match.status,
    comparisonStatus: "skipped",
    ...(storybookFamily ? { familyId: storybookFamily.id } : {}),
    skipReason,
    warnings: toUniqueSortedWarnings(warnings ?? [])
  };
};

export const getStorybookComponentVisualCatalogOutputFileName = (): string => STORYBOOK_COMPONENT_VISUAL_CATALOG_OUTPUT_FILE_NAME;

export const serializeStorybookComponentVisualCatalogArtifact = ({
  artifact
}: {
  artifact: StorybookComponentVisualCatalogArtifact;
}): string => {
  return toStableJsonString(artifact as unknown as JsonValue);
};

export const writeStorybookComponentVisualCatalogArtifact = async ({
  artifact,
  outputFilePath
}: {
  artifact: StorybookComponentVisualCatalogArtifact;
  outputFilePath: string;
}): Promise<string> => {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await writeFile(outputFilePath, serializeStorybookComponentVisualCatalogArtifact({ artifact }), "utf8");
  return outputFilePath;
};

export const buildStorybookComponentVisualCatalogArtifact = ({
  componentMatchReportArtifact,
  catalogArtifact,
  evidenceArtifact
}: BuildStorybookComponentVisualCatalogArtifactInput): StorybookComponentVisualCatalogArtifact => {
  const entriesById = new Map(catalogArtifact.entries.map((entry) => [entry.id, entry]));
  const familiesById = new Map(catalogArtifact.families.map((family) => [family.id, family]));
  const authoritativeStoryEntryIds = buildAuthoritativeStoryEntryIds({
    evidenceArtifact,
    entriesById
  });

  const byMatchStatus = createMatchStatusCounts();
  const bySkipReason = createSkipReasonCounts();
  const entries = componentMatchReportArtifact.entries
    .map((componentEntry) => {
      byMatchStatus[componentEntry.match.status] += 1;

      const storybookFamily = componentEntry.storybookFamily
        ? familiesById.get(componentEntry.storybookFamily.familyId)
        : undefined;
      if (componentEntry.match.status !== "matched") {
        const skipReason = componentEntry.match.status;
        bySkipReason[skipReason] += 1;
        return createSkippedEntry({
          componentEntry,
          ...(storybookFamily ? { storybookFamily } : {}),
          skipReason
        });
      }

      if (!storybookFamily) {
        bySkipReason.missing_story += 1;
        return createSkippedEntry({
          componentEntry,
          skipReason: "missing_story",
          warnings: ["storybook_family_missing_from_catalog"]
        });
      }

      const storySelection = selectStoryTarget({
        componentEntry,
        storybookFamily,
        entriesById,
        authoritativeStoryEntryIds
      });
      if (!storySelection.selectedStory) {
        const skipReason = storySelection.skipReason ?? "missing_story";
        bySkipReason[skipReason] += 1;
        return createSkippedEntry({
          componentEntry,
          storybookFamily,
          skipReason,
          ...(componentEntry.storyVariant ? { storyEntryId: componentEntry.storyVariant.entryId } : {})
        });
      }

      const referenceNodeSelection = selectReferenceNode({
        referenceNodes: componentEntry.figma.referenceNodes ?? [],
        storyEntry: storySelection.selectedStory.entry
      });
      if (!referenceNodeSelection) {
        bySkipReason.missing_reference_node += 1;
        return createSkippedEntry({
          componentEntry,
          storybookFamily,
          skipReason: "missing_reference_node",
          storyEntryId: storySelection.selectedStory.entry.id,
          warnings: storySelection.selectedStory.warnings
        });
      }

      return {
        componentId: buildComponentId({
          figmaFamilyKey: componentEntry.figma.familyKey,
          storyEntryId: storySelection.selectedStory.entry.id
        }),
        familyId: storybookFamily.id,
        figmaFamilyKey: componentEntry.figma.familyKey,
        figmaFamilyName: componentEntry.figma.familyName,
        matchStatus: componentEntry.match.status,
        comparisonStatus: "ready",
        storyEntryId: storySelection.selectedStory.entry.id,
        storyTitle: toStoryTitle(storySelection.selectedStory.entry),
        iframeId: storySelection.selectedStory.entry.id,
        referenceFileKey: referenceNodeSelection.node.fileKey,
        referenceNodeId: referenceNodeSelection.node.nodeId,
        captureStrategy: DEFAULT_CAPTURE_STRATEGY,
        baselineCanvas: {
          padding: DEFAULT_CAPTURE_PADDING
        },
        warnings: toUniqueSortedWarnings([...storySelection.selectedStory.warnings, ...referenceNodeSelection.warnings])
      } satisfies StorybookComponentVisualCatalogEntry;
    })
    .sort(compareComponentVisualEntries);

  const readyCount = entries.filter((entry) => entry.comparisonStatus === "ready").length;
  const skippedCount = entries.length - readyCount;
  return {
    artifact: "storybook.component-visual-catalog",
    version: 1,
    stats: {
      totalCount: entries.length,
      readyCount,
      skippedCount,
      byMatchStatus,
      bySkipReason
    },
    entries
  };
};
