import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectNormalizedIconKeys } from "../icon-library-resolution.js";
import { normalizeVariantKey, normalizeVariantValue } from "../parity/ir-variants.js";
import { resolveComponentApiContract } from "./component-api-resolver.js";
import {
  isCustomerProfileIconFallbackAllowed,
  isCustomerProfileMuiFallbackAllowed,
  resolveCustomerProfileIconFallbackWrapper,
  resolveCustomerProfileIconImport,
  resolveCustomerProfileComponentImport,
  resolveCustomerProfileFamily,
  type ResolvedCustomerProfile
} from "../customer-profile.js";
import type {
  FigmaAnalysis,
  FigmaAnalysisComponentFamily,
  FigmaAnalysisVariantProperty
} from "../parity/figma-analysis.js";
import type {
  FigmaLibraryResolutionArtifact,
  FigmaLibraryResolutionEntry
} from "../job-engine/figma-library-resolution.js";
import type { ResolvedStorybookTheme } from "./theme-resolver.js";
import { uniqueSorted } from "./text.js";
import type {
  ComponentMatchConfidence,
  ComponentMatchEvidenceClass,
  ComponentMatchFallbackReason,
  ComponentMatchReportFigmaLibraryDesignLink,
  ComponentMatchReportFigmaLibraryIssue,
  ComponentMatchReportFigmaLibraryResolution,
  ComponentMatchReportIconFallbackWrapperImport,
  ComponentMatchReportIconResolution,
  ComponentMatchReportIconResolutionRecord,
  ComponentMatchReportIconResolvedImport,
  ComponentMatchIconResolutionReason,
  ComponentMatchIconResolutionStatus,
  ComponentMatchLibraryResolutionReason,
  ComponentMatchLibraryResolutionStatus,
  ComponentMatchRejectionReason,
  ComponentMatchReportArtifact,
  ComponentMatchReportEntry,
  ComponentMatchReportFigmaFamily,
  ComponentMatchReportResolvedImport,
  ComponentMatchReportStoryVariant,
  ComponentMatchReportUsedEvidence,
  ComponentMatchSemanticBucket,
  ComponentMatchStatus,
  ComponentMatchReportVariantProperty,
  StorybookCatalogArtifact,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookCatalogJsonValue,
  StorybookEvidenceArtifact,
  StorybookEvidenceReliability,
  StorybookPublicComponentsArtifact
} from "./types.js";

const COMPONENT_MATCH_REPORT_OUTPUT_FILE_NAME = "component-match-report.json";
const MAX_CONFIDENCE_SCORE = 100;
const MAX_REFERENCE_ONLY_DOCS_SCORE = 5;
const MAX_VARIANT_OR_PROP_SCORE = 10;
const MATCHED_PRIMARY_THRESHOLD = 35;
const MATCHED_TOTAL_THRESHOLD = 45;
const AMBIGUOUS_PRIMARY_MIN = 20;
const PRIMARY_LEAD_THRESHOLD = 8;
const COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES = [
  "resolved_import",
  "mui_fallback_allowed",
  "mui_fallback_denied",
  "not_applicable"
] as const satisfies readonly ComponentMatchLibraryResolutionStatus[];
const COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS = [
  "profile_import_resolved",
  "profile_import_missing",
  "profile_import_family_mismatch",
  "profile_family_unresolved",
  "match_ambiguous",
  "match_unmatched"
] as const satisfies readonly ComponentMatchLibraryResolutionReason[];
const COMPONENT_MATCH_ICON_RESOLUTION_STATUSES = [
  "resolved_import",
  "wrapper_fallback_allowed",
  "wrapper_fallback_denied",
  "unresolved",
  "ambiguous",
  "not_applicable"
] as const satisfies readonly ComponentMatchIconResolutionStatus[];
const COMPONENT_MATCH_ICON_RESOLUTION_REASONS = [
  "profile_icon_import_resolved",
  "profile_icon_import_missing",
  "profile_icon_wrapper_allowed",
  "profile_icon_wrapper_denied",
  "profile_icon_wrapper_missing",
  "match_ambiguous",
  "match_unmatched",
  "not_icon_family"
] as const satisfies readonly ComponentMatchIconResolutionReason[];

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface BuildComponentMatchReportArtifactInput {
  figmaAnalysis: FigmaAnalysis;
  catalogArtifact: StorybookCatalogArtifact;
  evidenceArtifact: StorybookEvidenceArtifact;
  componentsArtifact?: StorybookPublicComponentsArtifact;
  figmaLibraryResolutionArtifact?: FigmaLibraryResolutionArtifact;
  resolvedCustomerProfile?: ResolvedCustomerProfile;
  resolvedStorybookTheme?: ResolvedStorybookTheme;
}

interface ParsedFigmaLink {
  fileKey: string;
  nodeId?: string;
}

interface AggregatedFigmaResolution {
  canonicalFamilyName?: string;
  variantProperties: ComponentMatchReportVariantProperty[];
  designLinks: ComponentMatchReportFigmaLibraryDesignLink[];
  fallbackReasons: ComponentMatchFallbackReason[];
  figmaLibraryResolution?: ComponentMatchReportFigmaLibraryResolution;
}

interface ResolvedFigmaFamily {
  figma: ComponentMatchReportFigmaFamily;
  semanticBucket: ComponentMatchSemanticBucket;
  canonicalName: string;
  canonicalTokens: string[];
  iconKeys: string[];
  variantSignals: string[];
  variantValueSignals: string[];
  designLinks: ParsedFigmaLink[];
  fallbackReasons: ComponentMatchFallbackReason[];
}

interface CandidateScore {
  family: StorybookCatalogFamily;
  totalScore: number;
  primaryScore: number;
  usedEvidence: ComponentMatchReportUsedEvidence[];
  fallbackReasons: ComponentMatchFallbackReason[];
  referenceOnlyDocsScore: number;
}

interface VariantSelectionResult {
  storyVariant?: ComponentMatchReportStoryVariant;
  usedEvidence: ComponentMatchReportUsedEvidence[];
  fallbackReasons: ComponentMatchFallbackReason[];
}

interface StorybookLookup {
  entriesById: Map<string, StorybookCatalogEntry>;
  evidenceByFamilyId: Map<string, StorybookEvidenceArtifact["evidence"]>;
}

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const sortUniqueStrings = <T extends string>(values: readonly T[]): T[] => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Set<T> spread loses the T narrowing
  return [...new Set(values)].sort(compareStrings) as T[];
};

const toStableJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of entries) {
      result[key] = toStableJsonValue(entryValue);
    }
    return result;
  }
  return value;
};

const toStableJsonString = (value: JsonValue): string => {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
};

const createLibraryResolutionStatusCounts = (): Record<ComponentMatchLibraryResolutionStatus, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES.map((status) => [status, 0])
  ) as Record<ComponentMatchLibraryResolutionStatus, number>;
};

const createLibraryResolutionReasonCounts = (): Record<ComponentMatchLibraryResolutionReason, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS.map((reason) => [reason, 0])
  ) as Record<ComponentMatchLibraryResolutionReason, number>;
};

const createIconResolutionStatusCounts = (): Record<ComponentMatchIconResolutionStatus, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_ICON_RESOLUTION_STATUSES.map((status) => [status, 0])
  ) as Record<ComponentMatchIconResolutionStatus, number>;
};

const createIconResolutionReasonCounts = (): Record<ComponentMatchIconResolutionReason, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_ICON_RESOLUTION_REASONS.map((reason) => [reason, 0])
  ) as Record<ComponentMatchIconResolutionReason, number>;
};

const toResolvedImportForReport = ({
  packageName,
  exportName,
  localName,
  propMappings
}: {
  packageName: string;
  exportName: string;
  localName: string;
  propMappings: Record<string, string>;
}): ComponentMatchReportResolvedImport => {
  const normalizedPropMappings = Object.fromEntries(
    Object.entries(propMappings).sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    package: packageName,
    exportName,
    localName,
    ...(Object.keys(normalizedPropMappings).length > 0 ? { propMappings: normalizedPropMappings } : {})
  };
};

const toIconResolvedImportForReport = ({
  packageName,
  exportName,
  localName
}: {
  packageName: string;
  exportName: string;
  localName: string;
}): ComponentMatchReportIconResolvedImport => {
  return {
    package: packageName,
    exportName,
    localName
  };
};

const toIconFallbackWrapperForReport = ({
  packageName,
  exportName,
  localName,
  iconPropName
}: {
  packageName: string;
  exportName: string;
  localName: string;
  iconPropName: string;
}): ComponentMatchReportIconFallbackWrapperImport => {
  return {
    package: packageName,
    exportName,
    localName,
    iconPropName
  };
};

const normalizeNodeId = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/-/gu, ":");
  return normalized.length > 0 ? normalized : undefined;
};

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

const toCanonicalAnalysisFamilyName = (value: string | undefined): string => {
  const normalized = (value ?? "").trim().replace(/\s+/gu, " ");
  if (!normalized) {
    return "";
  }
  const firstChunk = normalized.split(",")[0]?.trim() ?? normalized;
  const assignmentMatch = /\s+[A-Za-z0-9 _-]+=/u.exec(firstChunk);
  if (assignmentMatch && assignmentMatch.index > 0) {
    const candidate = firstChunk.slice(0, assignmentMatch.index).trim();
    if (candidate.length > 0) {
      return candidate;
    }
  }
  return firstChunk;
};

const toComparableTokens = (value: string | undefined): string[] => {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return [];
  }
  return uniqueSorted(normalized.split(" ").filter((token) => token.length > 0));
};

const toSortedVariantProperties = (
  variantProperties: FigmaAnalysisVariantProperty[] | ComponentMatchReportVariantProperty[]
): ComponentMatchReportVariantProperty[] => {
  const byProperty = new Map<string, Set<string>>();
  for (const variantProperty of variantProperties) {
    const property = normalizeVariantKey(variantProperty.property) ?? normalizeComparableText(variantProperty.property);
    if (!property) {
      continue;
    }
    const values = byProperty.get(property) ?? new Set<string>();
    for (const rawValue of variantProperty.values) {
      const normalizedValue = normalizeVariantValue(rawValue);
      if (normalizedValue.length === 0) {
        continue;
      }
      values.add(normalizedValue);
    }
    byProperty.set(property, values);
  }

  return [...byProperty.entries()]
    .map(([property, values]) => ({
      property,
      values: [...values].sort(compareStrings)
    }))
    .sort((left, right) => left.property.localeCompare(right.property));
};

const compareFigmaLibraryResolutionIssues = (
  left: ComponentMatchReportFigmaLibraryIssue,
  right: ComponentMatchReportFigmaLibraryIssue
): number => {
  const byCode = left.code.localeCompare(right.code);
  if (byCode !== 0) {
    return byCode;
  }
  const byScope = left.scope.localeCompare(right.scope);
  if (byScope !== 0) {
    return byScope;
  }
  const byMessage = left.message.localeCompare(right.message);
  if (byMessage !== 0) {
    return byMessage;
  }
  const leftRetriable = left.retriable === true ? 1 : 0;
  const rightRetriable = right.retriable === true ? 1 : 0;
  return leftRetriable - rightRetriable;
};

const toUniqueFigmaLibraryResolutionIssues = (
  issues: readonly ComponentMatchReportFigmaLibraryIssue[]
): ComponentMatchReportFigmaLibraryIssue[] => {
  const byKey = new Map<string, ComponentMatchReportFigmaLibraryIssue>();
  for (const issue of issues) {
    byKey.set(`${issue.code}:${issue.scope}:${issue.message}:${issue.retriable === true ? "1" : "0"}`, {
      code: issue.code,
      message: issue.message,
      scope: issue.scope,
      ...(issue.retriable !== undefined ? { retriable: issue.retriable } : {})
    });
  }
  return [...byKey.values()].sort(compareFigmaLibraryResolutionIssues);
};

const toFigmaLibraryDesignLink = (asset: { fileKey: string; nodeId: string }): ComponentMatchReportFigmaLibraryDesignLink => {
  return {
    fileKey: asset.fileKey,
    nodeId: asset.nodeId
  };
};

const parseFigmaLink = (value: string | undefined): ParsedFigmaLink | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(value);
    const pathSegments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
    const markerIndex = pathSegments.findIndex((segment) => segment === "design" || segment === "file");
    const fileKey = pathSegments[markerIndex + 1]?.trim();
    if (!fileKey) {
      return undefined;
    }
    const nodeId = normalizeNodeId(parsedUrl.searchParams.get("node-id") ?? undefined);
    return {
      fileKey,
      ...(nodeId ? { nodeId } : {})
    };
  } catch {
    return undefined;
  }
};

const collectJsonSignals = (value: StorybookCatalogJsonValue | undefined, target: Set<string>): void => {
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
      collectJsonSignals(entryValue, target);
    }
    return;
  }
  addNormalizedSignals(target, String(value));
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

const toSemanticBucket = (values: string[]): ComponentMatchSemanticBucket => {
  const tokenSet = new Set(values.flatMap((value) => toComparableTokens(value)));
  const hasAll = (...tokens: string[]): boolean => tokens.every((token) => tokenSet.has(token));
  const hasAny = (...tokens: string[]): boolean => tokens.some((token) => tokenSet.has(token));

  if (hasAll("text", "field") || hasAny("textfield")) {
    return "text_field";
  }
  if (hasAll("date", "picker") || hasAny("datepicker", "calendar")) {
    return "date_picker";
  }
  if (hasAny("accordion")) {
    return "accordion";
  }
  if (hasAny("typography", "headline", "heading")) {
    return "typography";
  }
  if (hasAny("dialog", "modal")) {
    return "dialog";
  }
  if (hasAny("navigation", "navbar", "sidebar", "menu", "tabs", "breadcrumb", "pager")) {
    return "navigation";
  }
  if (hasAny("button")) {
    return "button";
  }
  const hasIcTokenIconAlias = hasAny("ic") && tokenSet.size > 1;
  if (hasAny("icon", "icons") || hasIcTokenIconAlias) {
    return "icon";
  }
  if (hasAny("card")) {
    return "card";
  }
  if (hasAny("chip", "tag", "badge")) {
    return "chip";
  }
  if (hasAny("table", "grid", "datatable")) {
    return "table";
  }
  return "unknown";
};

const inferFigmaResolution = ({
  family,
  figmaLibraryResolutionArtifact
}: {
  family: FigmaAnalysisComponentFamily;
  figmaLibraryResolutionArtifact: FigmaLibraryResolutionArtifact | undefined;
}): AggregatedFigmaResolution => {
  if (!figmaLibraryResolutionArtifact) {
    return {
      variantProperties: [],
      designLinks: [],
      fallbackReasons: ["used_figma_analysis_family_name"]
    };
  }

  const familyEntries = figmaLibraryResolutionArtifact.entries.filter((entry) => entry.familyKey === family.familyKey);
  if (familyEntries.length === 0) {
    return {
      variantProperties: [],
      designLinks: [],
      fallbackReasons: ["used_figma_analysis_family_name"]
    };
  }

  const statusRank = (value: FigmaLibraryResolutionEntry["status"]): number => {
    switch (value) {
      case "resolved":
        return 0;
      case "partial":
        return 1;
      case "error":
        return 2;
    }
  };

  const sourceRank = (value: FigmaLibraryResolutionEntry["canonicalFamilyNameSource"]): number => {
    switch (value) {
      case "published_component_set":
        return 0;
      case "published_component":
        return 1;
      case "analysis":
        return 2;
    }
  };

  const sortedEntries = [...familyEntries].sort((left, right) => {
    const byStatus = statusRank(left.status) - statusRank(right.status);
    if (byStatus !== 0) {
      return byStatus;
    }
    const bySource = sourceRank(left.canonicalFamilyNameSource) - sourceRank(right.canonicalFamilyNameSource);
    if (bySource !== 0) {
      return bySource;
    }
    const byName = left.canonicalFamilyName.localeCompare(right.canonicalFamilyName);
    if (byName !== 0) {
      return byName;
    }
    return left.componentId.localeCompare(right.componentId);
  });

  const selectedEntry = sortedEntries[0];
  if (!selectedEntry) {
    return {
      variantProperties: [],
      designLinks: [],
      fallbackReasons: ["used_figma_analysis_family_name"]
    };
  }
  const designLinkMap = new Map<string, ComponentMatchReportFigmaLibraryDesignLink>();
  for (const entry of sortedEntries) {
    for (const asset of [entry.publishedComponentSet, entry.publishedComponent]) {
      if (!asset) {
        continue;
      }
      const normalizedNodeId = normalizeNodeId(asset.nodeId);
      const parsedLink = toFigmaLibraryDesignLink({
        fileKey: asset.fileKey,
        nodeId: normalizedNodeId ?? asset.nodeId
      });
      designLinkMap.set(`${parsedLink.fileKey}:${parsedLink.nodeId ?? "*"}`, parsedLink);
    }
  }

  const figmaLibraryResolution: ComponentMatchReportFigmaLibraryResolution = {
    status: selectedEntry.status,
    resolutionSource: selectedEntry.resolutionSource,
    ...(selectedEntry.originFileKey ? { originFileKey: selectedEntry.originFileKey } : {}),
    canonicalFamilyName: selectedEntry.canonicalFamilyName,
    canonicalFamilyNameSource: selectedEntry.canonicalFamilyNameSource,
    issues: toUniqueFigmaLibraryResolutionIssues(sortedEntries.flatMap((entry) => entry.issues ?? [])),
    designLinks: [...designLinkMap.values()].sort((left, right) => {
      const byFileKey = left.fileKey.localeCompare(right.fileKey);
      if (byFileKey !== 0) {
        return byFileKey;
      }
      return (left.nodeId ?? "").localeCompare(right.nodeId ?? "");
    })
  };

  const canonicalFamilyName =
    selectedEntry.canonicalFamilyNameSource === "analysis"
      ? toCanonicalAnalysisFamilyName(selectedEntry.canonicalFamilyName)
      : selectedEntry.canonicalFamilyName;
  const fallbackReasons: ComponentMatchFallbackReason[] =
    selectedEntry.canonicalFamilyNameSource === "analysis"
      ? ["used_figma_analysis_family_name"]
      : ["used_library_resolution_canonical_name"];

  return {
    ...(canonicalFamilyName ? { canonicalFamilyName } : {}),
    variantProperties: toSortedVariantProperties(sortedEntries.flatMap((entry) => entry.variantProperties)),
    designLinks: figmaLibraryResolution.designLinks,
    fallbackReasons,
    figmaLibraryResolution
  };
};

const buildResolvedFigmaFamily = ({
  family,
  figmaLibraryResolutionArtifact
}: {
  family: FigmaAnalysisComponentFamily;
  figmaLibraryResolutionArtifact: FigmaLibraryResolutionArtifact | undefined;
}): ResolvedFigmaFamily => {
  const resolution = inferFigmaResolution({ family, figmaLibraryResolutionArtifact });
  const variantProperties =
    resolution.variantProperties.length > 0
      ? toSortedVariantProperties([...family.variantProperties, ...resolution.variantProperties])
      : toSortedVariantProperties(family.variantProperties);
  const canonicalFamilyName = resolution.canonicalFamilyName?.trim() || toCanonicalAnalysisFamilyName(family.familyName) || family.familyName;
  const canonicalTokens = toComparableTokens(canonicalFamilyName);

  const variantSignals = uniqueSorted(
    variantProperties.flatMap((variantProperty) => [variantProperty.property, ...variantProperty.values].map((value) => normalizeComparableText(value)))
  ).filter((value) => value.length > 0);
  const variantValueSignals = uniqueSorted(
    variantProperties.flatMap((variantProperty) => variantProperty.values.map((value) => normalizeComparableText(value)))
  ).filter((value) => value.length > 0);

  return {
    figma: {
      familyKey: family.familyKey,
      familyName: family.familyName,
      nodeCount: family.nodeCount,
      variantProperties,
      ...(canonicalFamilyName !== family.familyName ? { canonicalFamilyName } : {}),
      ...(resolution.figmaLibraryResolution ? { figmaLibraryResolution: resolution.figmaLibraryResolution } : {})
    },
    semanticBucket: toSemanticBucket([canonicalFamilyName, family.familyName]),
    canonicalName: canonicalFamilyName,
    canonicalTokens,
    iconKeys: collectNormalizedIconKeys({
      candidates: [canonicalFamilyName, family.familyName],
      variantProperties
    }),
    variantSignals,
    variantValueSignals,
    designLinks: resolution.designLinks,
    fallbackReasons: resolution.fallbackReasons
  };
};

const buildStorybookLookup = ({
  catalogArtifact,
  evidenceArtifact
}: {
  catalogArtifact: StorybookCatalogArtifact;
  evidenceArtifact: StorybookEvidenceArtifact;
}): StorybookLookup => {
  const entriesById = new Map(catalogArtifact.entries.map((entry) => [entry.id, entry]));
  const familyIdByEntryId = new Map<string, string>();
  for (const family of catalogArtifact.families) {
    for (const entryId of family.entryIds) {
      familyIdByEntryId.set(entryId, family.id);
    }
  }

  const evidenceByFamilyId = new Map<string, StorybookEvidenceArtifact["evidence"]>();
  for (const evidence of evidenceArtifact.evidence) {
    const sourceEntryIds = uniqueSorted([evidence.source.entryId ?? "", ...(evidence.source.entryIds ?? [])]).filter(
      (entryId) => entryId.length > 0
    );
    const familyIds = uniqueSorted(sourceEntryIds.map((entryId) => familyIdByEntryId.get(entryId) ?? "").filter((value) => value.length > 0));
    for (const familyId of familyIds) {
      const existing = evidenceByFamilyId.get(familyId) ?? [];
      existing.push(evidence);
      evidenceByFamilyId.set(familyId, existing);
    }
  }

  for (const [familyId, evidenceItems] of evidenceByFamilyId.entries()) {
    evidenceByFamilyId.set(
      familyId,
      [...evidenceItems].sort((left, right) => left.id.localeCompare(right.id))
    );
  }

  return {
    entriesById,
    evidenceByFamilyId
  };
};

const toStorybookFamilyNameCandidates = (family: StorybookCatalogFamily): string[] => {
  const titleSegments = family.title
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const terminalTitleSegment = titleSegments.at(-1);
  return uniqueSorted([family.name, family.title, terminalTitleSegment ?? ""].filter((value) => value.length > 0));
};

const scoreCanonicalFamilyName = ({
  figmaTokens,
  figmaCanonicalName,
  storybookFamily
}: {
  figmaTokens: string[];
  figmaCanonicalName: string;
  storybookFamily: StorybookCatalogFamily;
}): {
  score: number;
  fallbackReasons: ComponentMatchFallbackReason[];
} => {
  const storybookCandidates = toStorybookFamilyNameCandidates(storybookFamily);
  const normalizedFigmaName = normalizeComparableText(figmaCanonicalName);
  const normalizedStorybookCandidates = storybookCandidates.map((candidate) => normalizeComparableText(candidate)).filter(Boolean);
  if (normalizedStorybookCandidates.includes(normalizedFigmaName)) {
    return { score: 25, fallbackReasons: [] };
  }

  const storybookTokenSet = new Set(storybookCandidates.flatMap((candidate) => toComparableTokens(candidate)));
  const overlapCount = figmaTokens.filter((token) => storybookTokenSet.has(token)).length;
  if (overlapCount >= 2 || (figmaTokens.length > 1 && overlapCount === figmaTokens.length)) {
    return {
      score: 15,
      fallbackReasons: ["used_family_name_token_overlap"]
    };
  }
  if (overlapCount >= 1) {
    return {
      score: 8,
      fallbackReasons: ["used_family_name_token_overlap"]
    };
  }

  return {
    score: 0,
    fallbackReasons: []
  };
};

const scoreDesignLink = ({
  figmaDesignLinks,
  storybookFamily
}: {
  figmaDesignLinks: ParsedFigmaLink[];
  storybookFamily: StorybookCatalogFamily;
}): {
  score: number;
  fallbackReasons: ComponentMatchFallbackReason[];
} => {
  if (figmaDesignLinks.length === 0) {
    return {
      score: 0,
      fallbackReasons: []
    };
  }

  const storybookLinks = storybookFamily.metadata.designUrls
    .map((designUrl) => parseFigmaLink(designUrl))
    .filter((entry): entry is ParsedFigmaLink => entry !== undefined);
  if (storybookLinks.length === 0) {
    return {
      score: 0,
      fallbackReasons: []
    };
  }

  for (const figmaLink of figmaDesignLinks) {
    for (const storybookLink of storybookLinks) {
      if (figmaLink.fileKey !== storybookLink.fileKey) {
        continue;
      }
      if (figmaLink.nodeId && storybookLink.nodeId && figmaLink.nodeId === storybookLink.nodeId) {
        return {
          score: 50,
          fallbackReasons: []
        };
      }
    }
  }

  for (const figmaLink of figmaDesignLinks) {
    for (const storybookLink of storybookLinks) {
      if (figmaLink.fileKey === storybookLink.fileKey) {
        return {
          score: 35,
          fallbackReasons: ["used_file_key_design_link"]
        };
      }
    }
  }

  return {
    score: 0,
    fallbackReasons: []
  };
};

const buildStoryEntrySignals = ({
  entry,
  includeValues
}: {
  entry: StorybookCatalogEntry;
  includeValues: boolean;
}): Set<string> => {
  const signals = new Set<string>();
  addNormalizedSignals(signals, entry.name);
  for (const key of Object.keys(entry.metadata.args ?? {}).sort(compareStrings)) {
    addNormalizedSignals(signals, key);
  }
  for (const key of Object.keys(entry.metadata.argTypes ?? {}).sort(compareStrings)) {
    addNormalizedSignals(signals, key);
  }
  if (includeValues) {
    collectJsonSignals(entry.metadata.args, signals);
    collectJsonSignals(entry.metadata.argTypes, signals);
  }
  return signals;
};

const countSignalOverlap = ({
  signals,
  target
}: {
  signals: string[];
  target: Set<string>;
}): number => {
  return signals.filter((signal) => target.has(signal)).length;
};

const scoreVariantOrPropOverlap = ({
  figmaFamily,
  storybookFamily,
  entriesById
}: {
  figmaFamily: ResolvedFigmaFamily;
  storybookFamily: StorybookCatalogFamily;
  entriesById: Map<string, StorybookCatalogEntry>;
}): number => {
  const relevantEntries = storybookFamily.storyEntryIds
    .map((entryId) => entriesById.get(entryId))
    .filter((entry): entry is StorybookCatalogEntry => entry !== undefined);

  let bestOverlap = 0;
  for (const entry of relevantEntries) {
    const overlapCount = countSignalOverlap({
      signals: figmaFamily.variantSignals,
      target: buildStoryEntrySignals({
        entry,
        includeValues: true
      })
    });
    if (overlapCount > bestOverlap) {
      bestOverlap = overlapCount;
    }
  }

  return Math.min(MAX_VARIANT_OR_PROP_SCORE, bestOverlap * 5);
};

const scoreReferenceOnlyDocs = ({
  figmaFamily,
  storybookFamily,
  lookup
}: {
  figmaFamily: ResolvedFigmaFamily;
  storybookFamily: StorybookCatalogFamily;
  lookup: StorybookLookup;
}): number => {
  const familyEvidence = lookup.evidenceByFamilyId.get(storybookFamily.id) ?? [];
  const docSignals = new Set<string>();
  for (const evidence of familyEvidence) {
    if (evidence.type !== "mdx_link" && evidence.type !== "docs_image" && evidence.type !== "docs_text") {
      continue;
    }
    addNormalizedSignals(docSignals, evidence.summary.linkTarget);
    addNormalizedSignals(docSignals, evidence.summary.imagePath);
    addNormalizedSignals(docSignals, evidence.summary.text);
  }

  const overlapCount = countSignalOverlap({
    signals: figmaFamily.canonicalTokens,
    target: docSignals
  });
  return Math.min(MAX_REFERENCE_ONLY_DOCS_SCORE, overlapCount);
};

const toReliabilityForEvidenceClass = (value: ComponentMatchEvidenceClass): StorybookEvidenceReliability => {
  switch (value) {
    case "reference_only_docs":
      return "reference_only";
    case "design_link":
    case "canonical_family_name":
    case "semantic_type":
      return "derived";
    case "variant_or_prop_overlap":
    case "component_path_present":
      return "authoritative";
  }
};

const compareUsedEvidence = (left: ComponentMatchReportUsedEvidence, right: ComponentMatchReportUsedEvidence): number => {
  const byClass = left.class.localeCompare(right.class);
  if (byClass !== 0) {
    return byClass;
  }
  const byReliability = left.reliability.localeCompare(right.reliability);
  if (byReliability !== 0) {
    return byReliability;
  }
  return left.role.localeCompare(right.role);
};

const toUniqueUsedEvidence = (values: ComponentMatchReportUsedEvidence[]): ComponentMatchReportUsedEvidence[] => {
  const byKey = new Map<string, ComponentMatchReportUsedEvidence>();
  for (const value of values) {
    byKey.set(`${value.class}:${value.reliability}:${value.role}`, value);
  }
  return [...byKey.values()].sort(compareUsedEvidence);
};

const scoreCandidateFamily = ({
  figmaFamily,
  storybookFamily,
  lookup
}: {
  figmaFamily: ResolvedFigmaFamily;
  storybookFamily: StorybookCatalogFamily;
  lookup: StorybookLookup;
}): CandidateScore => {
  const usedEvidence: ComponentMatchReportUsedEvidence[] = [];
  const fallbackReasons = new Set<ComponentMatchFallbackReason>();

  const designLinkScore = scoreDesignLink({
    figmaDesignLinks: figmaFamily.designLinks,
    storybookFamily
  });
  if (designLinkScore.score > 0) {
    usedEvidence.push({
      class: "design_link",
      reliability: toReliabilityForEvidenceClass("design_link"),
      role: "candidate_selection"
    });
    for (const fallbackReason of designLinkScore.fallbackReasons) {
      fallbackReasons.add(fallbackReason);
    }
  }

  const canonicalNameScore = scoreCanonicalFamilyName({
    figmaTokens: figmaFamily.canonicalTokens,
    figmaCanonicalName: figmaFamily.canonicalName,
    storybookFamily
  });
  if (canonicalNameScore.score > 0) {
    usedEvidence.push({
      class: "canonical_family_name",
      reliability: toReliabilityForEvidenceClass("canonical_family_name"),
      role: "candidate_selection"
    });
    for (const fallbackReason of canonicalNameScore.fallbackReasons) {
      fallbackReasons.add(fallbackReason);
    }
  }

  const storybookSemanticBucket = toSemanticBucket([storybookFamily.title, storybookFamily.name]);
  const semanticScore =
    figmaFamily.semanticBucket !== "unknown" && figmaFamily.semanticBucket === storybookSemanticBucket ? 10 : 0;
  if (semanticScore > 0) {
    usedEvidence.push({
      class: "semantic_type",
      reliability: toReliabilityForEvidenceClass("semantic_type"),
      role: "candidate_selection"
    });
    fallbackReasons.add("used_semantic_bucket");
  }

  const variantOrPropScore = scoreVariantOrPropOverlap({
    figmaFamily,
    storybookFamily,
    entriesById: lookup.entriesById
  });
  if (variantOrPropScore > 0) {
    usedEvidence.push({
      class: "variant_or_prop_overlap",
      reliability: toReliabilityForEvidenceClass("variant_or_prop_overlap"),
      role: "candidate_selection"
    });
  }

  const componentPathScore = storybookFamily.componentPath ? 5 : 0;
  if (componentPathScore > 0) {
    usedEvidence.push({
      class: "component_path_present",
      reliability: toReliabilityForEvidenceClass("component_path_present"),
      role: "candidate_selection"
    });
  }

  const primaryScore =
    designLinkScore.score +
    canonicalNameScore.score +
    semanticScore +
    variantOrPropScore +
    componentPathScore;

  const referenceOnlyDocsScore =
    primaryScore > 0
      ? scoreReferenceOnlyDocs({
          figmaFamily,
          storybookFamily,
          lookup
        })
      : 0;
  if (referenceOnlyDocsScore > 0) {
    usedEvidence.push({
      class: "reference_only_docs",
      reliability: toReliabilityForEvidenceClass("reference_only_docs"),
      role: "tie_breaker"
    });
    fallbackReasons.add("used_reference_only_docs_tiebreaker");
  }

  return {
    family: storybookFamily,
    totalScore: primaryScore + referenceOnlyDocsScore,
    primaryScore,
    referenceOnlyDocsScore,
    usedEvidence: toUniqueUsedEvidence(usedEvidence),
    fallbackReasons: sortUniqueStrings([...fallbackReasons])
  };
};

const buildCompareCandidateScores = ({
  tierPriorityByAlias
}: {
  tierPriorityByAlias?: ReadonlyMap<string, number>;
}): ((left: CandidateScore, right: CandidateScore) => number) => {
  return (left, right) => {
    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }
    if (left.primaryScore !== right.primaryScore) {
      return right.primaryScore - left.primaryScore;
    }
    if (tierPriorityByAlias && tierPriorityByAlias.size > 0) {
      const leftPriority = tierPriorityByAlias.get(left.family.tier.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = tierPriorityByAlias.get(right.family.tier.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
    }
    const byTitle = left.family.title.localeCompare(right.family.title);
    if (byTitle !== 0) {
      return byTitle;
    }
    return left.family.id.localeCompare(right.family.id);
  };
};

const toConfidenceScore = (totalScore: number): number => Math.max(0, Math.min(MAX_CONFIDENCE_SCORE, totalScore));

const toConfidence = (totalScore: number): ComponentMatchConfidence => {
  if (totalScore >= 70) {
    return "high";
  }
  if (totalScore >= 55) {
    return "medium";
  }
  if (totalScore >= MATCHED_TOTAL_THRESHOLD) {
    return "low";
  }
  return "none";
};

const resolveMatchStatus = ({
  topCandidate,
  runnerUp
}: {
  topCandidate: CandidateScore | undefined;
  runnerUp: CandidateScore | undefined;
}): {
  status: ComponentMatchStatus;
  rejectionReasons: ComponentMatchRejectionReason[];
} => {
  if (!topCandidate || topCandidate.totalScore === 0) {
    return {
      status: "unmatched",
      rejectionReasons: ["no_candidates"]
    };
  }

  const primaryLead = topCandidate.primaryScore - (runnerUp?.primaryScore ?? 0);
  if (
    topCandidate.primaryScore >= MATCHED_PRIMARY_THRESHOLD &&
    topCandidate.totalScore >= MATCHED_TOTAL_THRESHOLD &&
    primaryLead >= PRIMARY_LEAD_THRESHOLD
  ) {
    return {
      status: "matched",
      rejectionReasons: []
    };
  }

  const hasViableCandidate =
    topCandidate.primaryScore >= AMBIGUOUS_PRIMARY_MIN || topCandidate.totalScore >= MATCHED_TOTAL_THRESHOLD;
  if (hasViableCandidate) {
    const rejectionReasons: ComponentMatchRejectionReason[] = [];
    if (topCandidate.primaryScore < MATCHED_PRIMARY_THRESHOLD) {
      rejectionReasons.push("insufficient_primary_score");
    }
    if (topCandidate.totalScore < MATCHED_TOTAL_THRESHOLD) {
      rejectionReasons.push("insufficient_total_score");
    }
    if (primaryLead < PRIMARY_LEAD_THRESHOLD) {
      rejectionReasons.push("insufficient_primary_lead");
    }
    return {
      status: "ambiguous",
      rejectionReasons: sortUniqueStrings(rejectionReasons)
    };
  }

  const rejectionReasons: ComponentMatchRejectionReason[] = [];
  if (topCandidate.primaryScore < MATCHED_PRIMARY_THRESHOLD) {
    rejectionReasons.push("insufficient_primary_score");
  }
  if (topCandidate.totalScore < MATCHED_TOTAL_THRESHOLD) {
    rejectionReasons.push("insufficient_total_score");
  }
  return {
    status: "unmatched",
    rejectionReasons: sortUniqueStrings(rejectionReasons)
  };
};

const selectStoryVariant = ({
  storybookFamily,
  figmaFamily,
  lookup
}: {
  storybookFamily: StorybookCatalogFamily;
  figmaFamily: ResolvedFigmaFamily;
  lookup: StorybookLookup;
}): VariantSelectionResult => {
  const preferredEntries = (
    storybookFamily.storyEntryIds.length > 0 ? storybookFamily.storyEntryIds : storybookFamily.entryIds
  )
    .map((entryId) => lookup.entriesById.get(entryId))
    .filter((entry): entry is StorybookCatalogEntry => entry !== undefined);
  if (preferredEntries.length === 0) {
    return {
      usedEvidence: [],
      fallbackReasons: []
    };
  }

  const docsOnlyFamily = preferredEntries.every((entry) => entry.type === "docs");
  const scoredEntries = preferredEntries.map((entry) => ({
    entry,
    overlapCount: countSignalOverlap({
      signals: figmaFamily.variantValueSignals,
      target: buildStoryEntrySignals({
        entry,
        includeValues: false
      })
    }),
    storyPreferenceRank: entry.type === "story" ? 0 : entry.docsAttachment === "attached" ? 1 : 2
  }));

  scoredEntries.sort((left, right) => {
    if (left.overlapCount !== right.overlapCount) {
      return right.overlapCount - left.overlapCount;
    }
    if (left.storyPreferenceRank !== right.storyPreferenceRank) {
      return left.storyPreferenceRank - right.storyPreferenceRank;
    }
    return left.entry.id.localeCompare(right.entry.id);
  });

  const [selectedEntry, runnerUp] = scoredEntries;
  if (!selectedEntry) {
    return {
      usedEvidence: [],
      fallbackReasons: []
    };
  }

  const fallbackReasons = new Set<ComponentMatchFallbackReason>();
  const usedEvidence: ComponentMatchReportUsedEvidence[] = [];
  if (docsOnlyFamily) {
    fallbackReasons.add("selected_docs_entry_fallback");
  }
  if (selectedEntry.overlapCount > 0) {
    fallbackReasons.add("selected_variant_by_overlap");
    usedEvidence.push({
      class: "variant_or_prop_overlap",
      reliability: toReliabilityForEvidenceClass("variant_or_prop_overlap"),
      role: "story_variant_selection"
    });
  } else if (selectedEntry.storyPreferenceRank > 0) {
    fallbackReasons.add("selected_docs_entry_fallback");
  }

  if (
    runnerUp &&
    selectedEntry.overlapCount === runnerUp.overlapCount &&
    selectedEntry.storyPreferenceRank < runnerUp.storyPreferenceRank
  ) {
    fallbackReasons.add("selected_variant_by_attached_story_tiebreak");
  }
  if (
    runnerUp &&
    selectedEntry.overlapCount === runnerUp.overlapCount &&
    selectedEntry.storyPreferenceRank === runnerUp.storyPreferenceRank &&
    selectedEntry.entry.id !== runnerUp.entry.id
  ) {
    fallbackReasons.add("selected_variant_by_entry_id_tiebreak");
  }

  return {
    storyVariant: {
      entryId: selectedEntry.entry.id,
      storyName: selectedEntry.entry.name
    },
    usedEvidence: toUniqueUsedEvidence(usedEvidence),
    fallbackReasons: sortUniqueStrings([...fallbackReasons])
  };
};

const resolveLibraryResolution = ({
  matchStatus,
  selectedFamily,
  resolvedCustomerProfile
}: {
  matchStatus: ComponentMatchStatus;
  selectedFamily?: ComponentMatchReportEntry["storybookFamily"];
  resolvedCustomerProfile?: ResolvedCustomerProfile;
}): ComponentMatchReportEntry["libraryResolution"] => {
  if (matchStatus === "ambiguous") {
    return {
      status: "not_applicable",
      reason: "match_ambiguous"
    };
  }
  if (matchStatus === "unmatched" || !selectedFamily) {
    return {
      status: "not_applicable",
      reason: "match_unmatched"
    };
  }

  const componentKey = selectedFamily.name.trim();
  const storybookTier = selectedFamily.tier.trim();
  const baseResolution = {
    storybookTier,
    componentKey
  };

  if (!resolvedCustomerProfile) {
    return {
      status: "mui_fallback_denied",
      reason: "profile_family_unresolved",
      ...baseResolution
    };
  }

  const profileFamily = resolveCustomerProfileFamily({
    profile: resolvedCustomerProfile,
    candidate: storybookTier
  });
  const baseResolutionWithFamily = profileFamily
    ? {
        ...baseResolution,
        profileFamily: profileFamily.id
      }
    : baseResolution;

  if (!profileFamily) {
    const fallbackAllowed = isCustomerProfileMuiFallbackAllowed({
      profile: resolvedCustomerProfile,
      componentKey
    });
    return {
      status: fallbackAllowed ? "mui_fallback_allowed" : "mui_fallback_denied",
      reason: "profile_family_unresolved",
      ...baseResolutionWithFamily
    };
  }

  const resolvedImport = resolveCustomerProfileComponentImport({
    profile: resolvedCustomerProfile,
    componentKey,
    familyId: profileFamily.id
  });
  if (resolvedImport) {
    return {
      status: "resolved_import",
      reason: "profile_import_resolved",
      ...baseResolutionWithFamily,
      import: toResolvedImportForReport({
        packageName: resolvedImport.package,
        exportName: resolvedImport.exportName,
        localName: resolvedImport.localName,
        propMappings: resolvedImport.propMappings
      })
    };
  }

  const configuredImport = resolveCustomerProfileComponentImport({
    profile: resolvedCustomerProfile,
    componentKey
  });
  const reason: ComponentMatchLibraryResolutionReason = configuredImport
    ? "profile_import_family_mismatch"
    : "profile_import_missing";
  const fallbackAllowed = isCustomerProfileMuiFallbackAllowed({
    profile: resolvedCustomerProfile,
    componentKey
  });

  return {
    status: fallbackAllowed ? "mui_fallback_allowed" : "mui_fallback_denied",
    reason,
    ...baseResolutionWithFamily
  };
};

const resolveEntryIconKeys = ({
  figmaFamily,
  selectedFamily
}: {
  figmaFamily: ResolvedFigmaFamily;
  selectedFamily?: StorybookCatalogFamily;
}): string[] => {
  const storybookAssetKeys = selectedFamily?.metadata.assetKeys ?? [];
  const figmaAssetKeys = figmaFamily.iconKeys;
  if (storybookAssetKeys.length === 0) {
    return figmaAssetKeys;
  }
  if (figmaAssetKeys.length === 0) {
    return storybookAssetKeys;
  }
  const storybookKeySet = new Set(storybookAssetKeys);
  const sharedKeys = figmaAssetKeys.filter((iconKey) => storybookKeySet.has(iconKey));
  return sharedKeys.length > 0 ? sharedKeys : sortUniqueStrings([...figmaAssetKeys, ...storybookAssetKeys]);
};

const createIconResolutionSummary = (): ComponentMatchReportIconResolution["counts"] => {
  return {
    exactImportResolved: 0,
    wrapperFallbackAllowed: 0,
    wrapperFallbackDenied: 0,
    unresolved: 0,
    ambiguous: 0
  };
};

const incrementIconResolutionSummary = ({
  summary,
  status
}: {
  summary: ComponentMatchReportIconResolution["counts"];
  status: ComponentMatchIconResolutionStatus;
}): void => {
  if (status === "resolved_import") {
    summary.exactImportResolved += 1;
    return;
  }
  if (status === "wrapper_fallback_allowed") {
    summary.wrapperFallbackAllowed += 1;
    return;
  }
  if (status === "wrapper_fallback_denied") {
    summary.wrapperFallbackDenied += 1;
    return;
  }
  if (status === "ambiguous") {
    summary.ambiguous += 1;
    return;
  }
  if (status === "unresolved") {
    summary.unresolved += 1;
  }
};

const resolveIconResolution = ({
  matchStatus,
  selectedFamily,
  figmaFamily,
  resolvedCustomerProfile
}: {
  matchStatus: ComponentMatchStatus;
  selectedFamily?: StorybookCatalogFamily;
  figmaFamily: ResolvedFigmaFamily;
  resolvedCustomerProfile?: ResolvedCustomerProfile;
}): ComponentMatchReportIconResolution | undefined => {
  const isIconFamily = selectedFamily?.metadata.assetKind === "icon" || figmaFamily.semanticBucket === "icon";
  if (!isIconFamily) {
    return undefined;
  }

  const iconKeys = resolveEntryIconKeys({
    figmaFamily,
    ...(selectedFamily ? { selectedFamily } : {})
  });
  const fallbackIconKey = collectNormalizedIconKeys({
    candidates: [figmaFamily.canonicalName, figmaFamily.figma.familyName]
  })[0];
  const resolvedIconKeys = iconKeys.length > 0 ? iconKeys : fallbackIconKey ? [fallbackIconKey] : [];
  if (resolvedIconKeys.length === 0) {
    return undefined;
  }

  const counts = createIconResolutionSummary();
  const byKey: Record<string, ComponentMatchReportIconResolutionRecord> = {};

  for (const iconKey of resolvedIconKeys) {
    let resolution: ComponentMatchReportIconResolutionRecord;
    if (matchStatus === "ambiguous") {
      resolution = {
        iconKey,
        status: "ambiguous",
        reason: "match_ambiguous"
      };
    } else if (matchStatus === "unmatched" || !selectedFamily) {
      resolution = {
        iconKey,
        status: "unresolved",
        reason: "match_unmatched"
      };
    } else if (!resolvedCustomerProfile) {
      resolution = {
        iconKey,
        status: "unresolved",
        reason: "profile_icon_import_missing"
      };
    } else {
      const resolvedImport = resolveCustomerProfileIconImport({
        profile: resolvedCustomerProfile,
        iconKey
      });
      if (resolvedImport) {
        resolution = {
          iconKey,
          status: "resolved_import",
          reason: "profile_icon_import_resolved",
          import: toIconResolvedImportForReport({
            packageName: resolvedImport.package,
            exportName: resolvedImport.exportName,
            localName: resolvedImport.localName
          })
        };
      } else {
        const fallbackAllowed = isCustomerProfileIconFallbackAllowed({
          profile: resolvedCustomerProfile,
          iconKey
        });
        if (!fallbackAllowed) {
          resolution = {
            iconKey,
            status: "wrapper_fallback_denied",
            reason: "profile_icon_wrapper_denied"
          };
        } else {
          const wrapper = resolveCustomerProfileIconFallbackWrapper({
            profile: resolvedCustomerProfile
          });
          resolution = wrapper
            ? {
                iconKey,
                status: "wrapper_fallback_allowed",
                reason: "profile_icon_wrapper_allowed",
                wrapper: toIconFallbackWrapperForReport({
                  packageName: wrapper.package,
                  exportName: wrapper.exportName,
                  localName: wrapper.localName,
                  iconPropName: wrapper.iconPropName
                })
              }
            : {
                iconKey,
                status: "unresolved",
                reason: "profile_icon_wrapper_missing"
              };
        }
      }
    }

    byKey[iconKey] = resolution;
    incrementIconResolutionSummary({
      summary: counts,
      status: resolution.status
    });
  }

  return {
    assetKind: "icon",
    iconKeys: resolvedIconKeys,
    byKey,
    counts
  };
};

const compareReportEntries = (left: ComponentMatchReportEntry, right: ComponentMatchReportEntry): number => {
  const byFamilyName = left.figma.familyName.localeCompare(right.figma.familyName);
  if (byFamilyName !== 0) {
    return byFamilyName;
  }
  return left.figma.familyKey.localeCompare(right.figma.familyKey);
};

export const getComponentMatchReportOutputFileName = (): string => COMPONENT_MATCH_REPORT_OUTPUT_FILE_NAME;

export const serializeComponentMatchReportArtifact = ({
  artifact
}: {
  artifact: ComponentMatchReportArtifact;
}): string => {
  return toStableJsonString(artifact as unknown as JsonValue);
};

export const writeComponentMatchReportArtifact = async ({
  artifact,
  outputFilePath
}: {
  artifact: ComponentMatchReportArtifact;
  outputFilePath: string;
}): Promise<string> => {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await writeFile(outputFilePath, serializeComponentMatchReportArtifact({ artifact }), "utf8");
  return outputFilePath;
};

export const buildComponentMatchReportArtifact = ({
  figmaAnalysis,
  catalogArtifact,
  evidenceArtifact,
  componentsArtifact,
  figmaLibraryResolutionArtifact,
  resolvedCustomerProfile,
  resolvedStorybookTheme
}: BuildComponentMatchReportArtifactInput): ComponentMatchReportArtifact => {
  const lookup = buildStorybookLookup({
    catalogArtifact,
    evidenceArtifact
  });

  const tierPriorityByAlias = new Map<string, number>();
  if (resolvedCustomerProfile) {
    for (const family of resolvedCustomerProfile.families) {
      const priority = family.tierPriority;
      tierPriorityByAlias.set(family.id.toLowerCase(), priority);
      for (const source of ["figma", "storybook", "code"] as const) {
        for (const alias of family.aliases[source]) {
          tierPriorityByAlias.set(alias.toLowerCase(), priority);
        }
      }
    }
  }

  const entries = [...figmaAnalysis.componentFamilies]
    .sort((left, right) => {
      const byName = left.familyName.localeCompare(right.familyName);
      if (byName !== 0) {
        return byName;
      }
      return left.familyKey.localeCompare(right.familyKey);
    })
    .map((family) => {
      const resolvedFigmaFamily = buildResolvedFigmaFamily({
        family,
        figmaLibraryResolutionArtifact
      });
      const candidates = catalogArtifact.families
        .map((storybookFamily) =>
          scoreCandidateFamily({
            figmaFamily: resolvedFigmaFamily,
            storybookFamily,
            lookup
          })
        )
        .sort(buildCompareCandidateScores({ tierPriorityByAlias }));
      const topCandidate = candidates[0];
      const runnerUp = candidates[1];
      if (
        topCandidate &&
        runnerUp &&
        topCandidate.totalScore === runnerUp.totalScore &&
        topCandidate.primaryScore === runnerUp.primaryScore &&
        tierPriorityByAlias.size > 0
      ) {
        const topPriority = tierPriorityByAlias.get(topCandidate.family.tier.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        const runnerUpPriority = tierPriorityByAlias.get(runnerUp.family.tier.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        if (topPriority !== runnerUpPriority) {
          topCandidate.fallbackReasons.push("used_customer_profile_tier_priority_tiebreaker");
        }
      }
      const match = resolveMatchStatus({
        topCandidate,
        runnerUp
      });

      const selectedFamily =
        topCandidate && topCandidate.totalScore > 0
          ? {
              familyId: topCandidate.family.id,
              title: topCandidate.family.title,
              name: topCandidate.family.name,
              tier: topCandidate.family.tier,
              storyCount: topCandidate.family.storyCount
            }
          : undefined;
      const storyVariant =
        selectedFamily && topCandidate
          ? selectStoryVariant({
              storybookFamily: topCandidate.family,
              figmaFamily: resolvedFigmaFamily,
              lookup
            })
          : {
              usedEvidence: [],
              fallbackReasons: []
            };

      const fallbackReasons = sortUniqueStrings([
        ...resolvedFigmaFamily.fallbackReasons,
        ...(topCandidate?.fallbackReasons ?? []),
        ...storyVariant.fallbackReasons
      ]);
      const usedEvidence = toUniqueUsedEvidence([...(topCandidate?.usedEvidence ?? []), ...storyVariant.usedEvidence]);
      const confidenceScore = toConfidenceScore(topCandidate?.totalScore ?? 0);
      const libraryResolution = resolveLibraryResolution({
        matchStatus: match.status,
        ...(selectedFamily ? { selectedFamily } : {}),
        ...(resolvedCustomerProfile ? { resolvedCustomerProfile } : {})
      });
      const iconResolution = resolveIconResolution({
        matchStatus: match.status,
        ...(topCandidate ? { selectedFamily: topCandidate.family } : {}),
        figmaFamily: resolvedFigmaFamily,
        ...(resolvedCustomerProfile ? { resolvedCustomerProfile } : {})
      });
      const selectedStoryEntry = storyVariant.storyVariant
        ? lookup.entriesById.get(storyVariant.storyVariant.entryId)
        : undefined;
      const fallbackPolicy =
        resolvedCustomerProfile && libraryResolution.componentKey
          ? (isCustomerProfileMuiFallbackAllowed({
              profile: resolvedCustomerProfile,
              componentKey: libraryResolution.componentKey
            })
              ? "allow"
              : "deny")
          : undefined;
      const { resolvedApi, resolvedProps } = resolveComponentApiContract({
        figmaFamily: resolvedFigmaFamily.figma,
        libraryResolution,
        ...(topCandidate ? { storybookFamily: topCandidate.family } : {}),
        ...(selectedStoryEntry ? { storyEntry: selectedStoryEntry } : {}),
        ...(componentsArtifact ? { componentsArtifact } : {}),
        ...(resolvedStorybookTheme ? { resolvedStorybookTheme } : {}),
        ...(fallbackPolicy ? { fallbackPolicy } : {})
      });

      return {
        figma: resolvedFigmaFamily.figma,
        match: {
          status: match.status,
          confidence: toConfidence(topCandidate?.totalScore ?? 0),
          confidenceScore
        },
        usedEvidence,
        rejectionReasons: match.rejectionReasons,
        fallbackReasons,
        libraryResolution,
        ...(iconResolution ? { iconResolution } : {}),
        ...(selectedFamily ? { storybookFamily: selectedFamily } : {}),
        ...(storyVariant.storyVariant ? { storyVariant: storyVariant.storyVariant } : {}),
        resolvedApi,
        resolvedProps
      } satisfies ComponentMatchReportEntry;
    })
    .sort(compareReportEntries);

  const libraryResolutionStatusCounts = createLibraryResolutionStatusCounts();
  const libraryResolutionReasonCounts = createLibraryResolutionReasonCounts();
  const iconResolutionStatusCounts = createIconResolutionStatusCounts();
  const iconResolutionReasonCounts = createIconResolutionReasonCounts();
  for (const entry of entries) {
    libraryResolutionStatusCounts[entry.libraryResolution.status] += 1;
    libraryResolutionReasonCounts[entry.libraryResolution.reason] += 1;
    if (!entry.iconResolution) {
      iconResolutionStatusCounts.not_applicable += 1;
      iconResolutionReasonCounts.not_icon_family += 1;
      continue;
    }
    for (const resolution of Object.values(entry.iconResolution.byKey)) {
      iconResolutionStatusCounts[resolution.status] += 1;
      iconResolutionReasonCounts[resolution.reason] += 1;
    }
  }

  return {
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: entries.length,
      storybookFamilyCount: catalogArtifact.families.length,
      storybookEntryCount: catalogArtifact.entries.length,
      matched: entries.filter((entry) => entry.match.status === "matched").length,
      ambiguous: entries.filter((entry) => entry.match.status === "ambiguous").length,
      unmatched: entries.filter((entry) => entry.match.status === "unmatched").length,
      libraryResolution: {
        byStatus: libraryResolutionStatusCounts,
        byReason: libraryResolutionReasonCounts
      },
      iconResolution: {
        byStatus: iconResolutionStatusCounts,
        byReason: iconResolutionReasonCounts
      }
    },
    entries
  };
};
