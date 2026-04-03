import type { DesignIR, FigmaMcpEnrichment } from "./types.js";
import { resolveNodeStyleCatalog } from "./ir-palette.js";
import type { FigmaFile, FigmaNode } from "./ir-helpers.js";
import { collectNodes, countSubtreeNodes } from "./ir-tree.js";
import {
  extractDefaultVariantProperties,
  extractVariantNameProperties,
  extractVariantPropertiesFromComponentProperties,
  normalizeVariantKey,
  normalizeVariantValue
} from "./ir-variants.js";

export interface FigmaAnalysisDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  reasons: string[];
  nodeIds?: string[];
  styleIds?: string[];
  componentIds?: string[];
}

export interface FigmaAnalysisSummary {
  pageCount: number;
  sectionCount: number;
  topLevelFrameCount: number;
  totalNodeCount: number;
  totalInstanceCount: number;
  localComponentCount: number;
  localStyleCount: number;
  externalComponentCount: number;
}

export interface FigmaAnalysisStyleReferences {
  allStyleIds: string[];
  byType: {
    fill: string[];
    stroke: string[];
    effect: string[];
    text: string[];
    generic: string[];
  };
  localStyleIds: string[];
  linkedStyleIds: string[];
}

export interface FigmaAnalysisTokenSignals {
  boundVariableIds: string[];
  variableModeIds: string[];
  styleReferences: FigmaAnalysisStyleReferences;
}

export interface FigmaAnalysisLayoutPage {
  id: string;
  name: string;
  sectionIds: string[];
  frameIds: string[];
}

export interface FigmaAnalysisLayoutSection {
  id: string;
  name: string;
  pageId: string;
  parentSectionId?: string;
  directChildCount: number;
  childSectionIds: string[];
  frameIds: string[];
}

export interface FigmaAnalysisLayoutFrame {
  id: string;
  name: string;
  pageId: string;
  parentSectionId?: string;
  nodeType: string;
  layoutMode: "HORIZONTAL" | "VERTICAL" | "NONE";
  width: number;
  height: number;
  directChildCount: number;
  subtreeNodeCount: number;
  instanceCount: number;
}

export interface FigmaAnalysisLayoutEdge {
  parentId: string;
  parentType: "page" | "section";
  childId: string;
  childType: "section" | "frame";
}

export interface FigmaAnalysisLayoutGraph {
  pages: FigmaAnalysisLayoutPage[];
  sections: FigmaAnalysisLayoutSection[];
  frames: FigmaAnalysisLayoutFrame[];
  edges: FigmaAnalysisLayoutEdge[];
}

export interface FigmaAnalysisVariantProperty {
  property: string;
  values: string[];
}

export interface FigmaAnalysisComponentFamily {
  familyKey: string;
  familyName: string;
  componentIds: string[];
  componentSetIds: string[];
  referringNodeIds: string[];
  nodeCount: number;
  variantProperties: FigmaAnalysisVariantProperty[];
}

export interface FigmaAnalysisExternalComponent {
  componentId: string;
  componentSetId?: string;
  familyKey: string;
  familyName: string;
  referringNodeIds: string[];
}

export interface FigmaAnalysisVariantAxis {
  axis: string;
  values: string[];
  source: "name" | "text" | "structure";
}

export interface FigmaAnalysisFrameVariantGroup {
  groupId: string;
  frameIds: string[];
  frameNames: string[];
  canonicalFrameId: string;
  confidence: number;
  similarityReasons: string[];
  fallbackReasons: string[];
  variantAxes: FigmaAnalysisVariantAxis[];
}

export interface FigmaAnalysisAppShellSignal {
  signalId: string;
  groupId: string;
  role: "header" | "sidebar" | "navigation" | "frame";
  fingerprint: string;
  frameIds: string[];
  nodeIds: string[];
  confidence: number;
  reasons: string[];
}

export interface FigmaAnalysisDensityFamily {
  familyKey: string;
  familyName: string;
  count: number;
  ratio: number;
}

export interface FigmaAnalysisDensityHotspot {
  hotspotId: string;
  frameId: string;
  nodeId: string;
  nodeName: string;
  subtreeNodeCount: number;
  instanceCount: number;
  density: number;
  dominantFamilies: FigmaAnalysisDensityFamily[];
}

export interface FigmaAnalysisFrameDensity {
  frameId: string;
  frameName: string;
  subtreeNodeCount: number;
  instanceCount: number;
  density: number;
  dominantFamilies: FigmaAnalysisDensityFamily[];
}

export interface FigmaAnalysisComponentDensity {
  boardDominantFamilies: FigmaAnalysisDensityFamily[];
  byFrame: FigmaAnalysisFrameDensity[];
  hotspots: FigmaAnalysisDensityHotspot[];
}

export interface FigmaAnalysis {
  artifactVersion: 1;
  sourceName: string;
  summary: FigmaAnalysisSummary;
  tokenSignals: FigmaAnalysisTokenSignals;
  layoutGraph: FigmaAnalysisLayoutGraph;
  componentFamilies: FigmaAnalysisComponentFamily[];
  externalComponents: FigmaAnalysisExternalComponent[];
  frameVariantGroups: FigmaAnalysisFrameVariantGroup[];
  appShellSignals: FigmaAnalysisAppShellSignal[];
  componentDensity: FigmaAnalysisComponentDensity;
  diagnostics: FigmaAnalysisDiagnostic[];
}

interface FrameContext {
  frame: FigmaNode;
  pageId: string;
  pageName: string;
  parentSectionId?: string;
  parentSectionName?: string;
}

interface SectionContext {
  section: FigmaNode;
  pageId: string;
  pageName: string;
  parentSectionId?: string;
}

interface ComponentFamilyAccumulator {
  familyKey: string;
  familyName: string;
  componentIds: Set<string>;
  componentSetIds: Set<string>;
  nodeIds: Set<string>;
  variantValuesByProperty: Map<string, Set<string>>;
}

interface FrameSignature {
  frameId: string;
  frameName: string;
  pageId: string;
  width: number;
  height: number;
  nodeCount: number;
  instanceCount: number;
  nameTokens: Set<string>;
  textTokens: Set<string>;
  familyKeys: Set<string>;
  topChildFingerprints: Set<string>;
}

const ZERO_BOUNDS = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

const NUMERIC_ID_PATTERN = /^\d+:\d+$/;

const sortStrings = (values: Iterable<string>): string[] => {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
};

const roundTo = (value: number, precision: number): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const asFiniteNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeNodeName = (name: string | undefined): string => {
  return (name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[,|]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeFamilyName = (name: string | undefined): string => {
  const normalized = normalizeNodeName(name);
  if (!normalized) {
    return "Unnamed component";
  }
  const beforeVariantAssignments = normalized.split(",")[0]?.trim() ?? normalized;
  return beforeVariantAssignments.length > 0 ? beforeVariantAssignments : normalized;
};

const toSlug = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  return normalized.length > 0 ? normalized : "group";
};

const tokenize = (value: string | undefined): Set<string> => {
  const normalized = normalizeNodeName(value)
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\b(v|ver|version)\s*\d+\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return new Set<string>();
  }
  return new Set(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
};

const listNodeTextTokens = (root: FigmaNode): Set<string> => {
  const tokens = new Set<string>();
  const nodes = collectNodes(root, () => true);
  for (const node of nodes) {
    if (node.type !== "TEXT" || typeof node.characters !== "string") {
      continue;
    }
    for (const token of tokenize(node.characters)) {
      tokens.add(token);
    }
  }
  return tokens;
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  const union = new Set<string>([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
};

const compareNumbers = (left: number, right: number): number => {
  return left - right;
};

const compareStrings = (left: string, right: string): number => {
  return left.localeCompare(right);
};

const collectDirectStyleReferences = (node: FigmaNode): Array<{ styleId: string; type: keyof FigmaAnalysisStyleReferences["byType"] }> => {
  const references: Array<{ styleId: string; type: keyof FigmaAnalysisStyleReferences["byType"] }> = [];
  const pushReference = (
    styleId: string | undefined,
    type: keyof FigmaAnalysisStyleReferences["byType"]
  ): void => {
    if (typeof styleId === "string" && styleId.trim().length > 0) {
      references.push({ styleId: styleId.trim(), type });
    }
  };

  for (const styleId of Object.values(node.styles ?? {})) {
    pushReference(typeof styleId === "string" ? styleId : undefined, "generic");
  }
  pushReference(node.fillStyleId, "fill");
  pushReference(node.strokeStyleId, "stroke");
  pushReference(node.effectStyleId, "effect");
  pushReference(node.textStyleId, "text");
  return references;
};

const collectBoundVariableSignals = ({
  value,
  variableIds,
  variableModeIds
}: {
  value: unknown;
  variableIds: Set<string>;
  variableModeIds: Set<string>;
}): void => {
  const visit = (candidate: unknown, parentKey: string | undefined): void => {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (!NUMERIC_ID_PATTERN.test(normalized)) {
        return;
      }
      const normalizedParentKey = parentKey?.toLowerCase() ?? "";
      if (normalizedParentKey.includes("mode")) {
        variableModeIds.add(normalized);
        return;
      }
      variableIds.add(normalized);
      return;
    }

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, parentKey);
      }
      return;
    }

    if (!candidate || typeof candidate !== "object") {
      return;
    }

    for (const [key, entry] of Object.entries(candidate)) {
      visit(entry, key);
    }
  };

  visit(value, undefined);
};

const buildLayoutGraph = (file: FigmaFile): {
  layoutGraph: FigmaAnalysisLayoutGraph;
  frameContexts: FrameContext[];
} => {
  const pages: FigmaAnalysisLayoutPage[] = [];
  const sections: FigmaAnalysisLayoutSection[] = [];
  const frames: FigmaAnalysisLayoutFrame[] = [];
  const edges: FigmaAnalysisLayoutEdge[] = [];
  const frameContexts: FrameContext[] = [];

  const documentChildren = Array.isArray(file.document?.children) ? file.document.children : [];
  for (const page of documentChildren) {
    if (page.type !== "CANVAS") {
      continue;
    }
    const pageSections: string[] = [];
    const pageFrames: string[] = [];
    const pageName = normalizeNodeName(page.name) || page.id;
    const pageChildren = Array.isArray(page.children) ? page.children : [];

    const visitSection = ({ section, pageId, pageName, parentSectionId }: SectionContext): void => {
      const childSectionIds: string[] = [];
      const frameIds: string[] = [];
      const children = Array.isArray(section.children) ? section.children : [];

      for (const child of children) {
        if (child.type === "SECTION") {
          childSectionIds.push(child.id);
          edges.push({
            parentId: section.id,
            parentType: "section",
            childId: child.id,
            childType: "section"
          });
          visitSection({
            section: child,
            pageId,
            pageName,
            parentSectionId: section.id
          });
          continue;
        }
        if (child.type !== "FRAME" && child.type !== "COMPONENT") {
          continue;
        }
        frameIds.push(child.id);
        edges.push({
          parentId: section.id,
          parentType: "section",
          childId: child.id,
          childType: "frame"
        });
        frameContexts.push({
          frame: child,
          pageId,
          pageName,
          parentSectionId: section.id,
          parentSectionName: normalizeNodeName(section.name) || section.id
        });
      }

      sections.push({
        id: section.id,
        name: normalizeNodeName(section.name) || section.id,
        pageId,
        ...(parentSectionId ? { parentSectionId } : {}),
        directChildCount: children.length,
        childSectionIds: childSectionIds.sort(compareStrings),
        frameIds: frameIds.sort(compareStrings)
      });
    };

    for (const child of pageChildren) {
      if (child.type === "SECTION") {
        pageSections.push(child.id);
        edges.push({
          parentId: page.id,
          parentType: "page",
          childId: child.id,
          childType: "section"
        });
        visitSection({
          section: child,
          pageId: page.id,
          pageName
        });
        continue;
      }
      if (child.type !== "FRAME" && child.type !== "COMPONENT") {
        continue;
      }
      pageFrames.push(child.id);
      edges.push({
        parentId: page.id,
        parentType: "page",
        childId: child.id,
        childType: "frame"
      });
      frameContexts.push({
        frame: child,
        pageId: page.id,
        pageName
      });
    }

    pages.push({
      id: page.id,
      name: pageName,
      sectionIds: pageSections.sort(compareStrings),
      frameIds: pageFrames.sort(compareStrings)
    });
  }

  for (const context of frameContexts) {
    const bounds = context.frame.absoluteBoundingBox ?? ZERO_BOUNDS;
    const subtreeNodes = collectNodes(context.frame, () => true);
    frames.push({
      id: context.frame.id,
      name: normalizeNodeName(context.frame.name) || context.frame.id,
      pageId: context.pageId,
      ...(context.parentSectionId ? { parentSectionId: context.parentSectionId } : {}),
      nodeType: context.frame.type,
      layoutMode: context.frame.layoutMode ?? "NONE",
      width: roundTo(asFiniteNumber(bounds.width), 2),
      height: roundTo(asFiniteNumber(bounds.height), 2),
      directChildCount: Array.isArray(context.frame.children) ? context.frame.children.length : 0,
      subtreeNodeCount: countSubtreeNodes(context.frame),
      instanceCount: subtreeNodes.filter((node) => node.type === "INSTANCE").length
    });
  }

  return {
    layoutGraph: {
      pages: pages.sort((left, right) => compareStrings(left.id, right.id)),
      sections: sections.sort((left, right) => compareStrings(left.id, right.id)),
      frames: frames.sort((left, right) => compareStrings(left.id, right.id)),
      edges: edges.sort((left, right) => {
        if (left.parentId !== right.parentId) {
          return compareStrings(left.parentId, right.parentId);
        }
        if (left.childId !== right.childId) {
          return compareStrings(left.childId, right.childId);
        }
        if (left.parentType !== right.parentType) {
          return compareStrings(left.parentType, right.parentType);
        }
        return compareStrings(left.childType, right.childType);
      })
    },
    frameContexts: frameContexts.sort((left, right) => compareStrings(left.frame.id, right.frame.id))
  };
};

const resolveFamilyName = (node: FigmaNode): string => {
  const variantProperties = extractVariantNameProperties(node.name);
  const hasVariantAssignment = Object.keys(variantProperties).length > 0;
  if (hasVariantAssignment) {
    const normalized = normalizeNodeName(node.name);
    const commaIndex = normalized.indexOf(",");
    if (commaIndex > 0) {
      return normalizeFamilyName(normalized.slice(0, commaIndex));
    }
  }
  return normalizeFamilyName(node.name);
};

const resolveFamilyKey = (node: FigmaNode): string => {
  if (typeof node.componentSetId === "string" && node.componentSetId.trim().length > 0) {
    return `component-set:${node.componentSetId.trim()}`;
  }
  if (typeof node.componentId === "string" && node.componentId.trim().length > 0) {
    return `component:${node.componentId.trim()}`;
  }
  return `name:${toSlug(resolveFamilyName(node))}`;
};

const collectVariantProperties = (node: FigmaNode): Record<string, string> => {
  const values: Record<string, string> = {};
  const mergeProperty = (rawKey: string, rawValue: string): void => {
    const key = normalizeVariantKey(rawKey);
    const value = normalizeVariantValue(rawValue);
    if (!key || value.length === 0) {
      return;
    }
    values[key] = value;
  };

  for (const [key, value] of Object.entries(extractVariantNameProperties(node.name))) {
    mergeProperty(key, value);
  }
  for (const [key, value] of Object.entries(extractVariantPropertiesFromComponentProperties(node.componentProperties))) {
    mergeProperty(key, value);
  }
  for (const [key, value] of Object.entries(extractDefaultVariantProperties(node.componentPropertyDefinitions))) {
    mergeProperty(key, value);
  }
  const definitionEntries = Object.entries(node.componentPropertyDefinitions ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [rawKey, definition] of definitionEntries) {
    const definitionType = typeof definition.type === "string" ? definition.type.toUpperCase() : "";
    if (definitionType !== "VARIANT") {
      continue;
    }
    if (Array.isArray(definition.variantOptions)) {
      const options = (definition.variantOptions as unknown[]).filter((option): option is string => typeof option === "string");
      options.sort((left, right) => left.localeCompare(right));
      for (const option of options) {
        if (typeof option === "string") {
          mergeProperty(rawKey, option);
        }
      }
    }
  }
  return values;
};

const buildComponentFamilies = ({
  file,
  diagnostics
}: {
  file: FigmaFile;
  diagnostics: FigmaAnalysisDiagnostic[];
}): {
  componentFamilies: FigmaAnalysisComponentFamily[];
  externalComponents: FigmaAnalysisExternalComponent[];
  familyKeyByNodeId: Map<string, string>;
} => {
  const localComponentIds = new Set<string>();
  const allNodes = file.document ? collectNodes(file.document, () => true) : [];
  for (const node of allNodes) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      localComponentIds.add(node.id);
    }
  }

  const familyMap = new Map<string, ComponentFamilyAccumulator>();
  const externalMap = new Map<string, FigmaAnalysisExternalComponent>();
  const familyKeyByNodeId = new Map<string, string>();

  for (const node of allNodes) {
    const hasComponentSignals =
      (typeof node.componentId === "string" && node.componentId.trim().length > 0) ||
      (typeof node.componentSetId === "string" && node.componentSetId.trim().length > 0) ||
      node.type === "COMPONENT" ||
      node.type === "COMPONENT_SET" ||
      node.type === "INSTANCE";
    if (!hasComponentSignals) {
      continue;
    }

    const familyKey = resolveFamilyKey(node);
    const familyName = resolveFamilyName(node);
    familyKeyByNodeId.set(node.id, familyKey);

    let family = familyMap.get(familyKey);
    if (!family) {
      family = {
        familyKey,
        familyName,
        componentIds: new Set<string>(),
        componentSetIds: new Set<string>(),
        nodeIds: new Set<string>(),
        variantValuesByProperty: new Map<string, Set<string>>()
      };
      familyMap.set(familyKey, family);
    }

    family.nodeIds.add(node.id);
    if (typeof node.componentId === "string" && node.componentId.trim().length > 0) {
      const componentId = node.componentId.trim();
      family.componentIds.add(componentId);
      if (!localComponentIds.has(componentId)) {
        const externalKey = `${componentId}|${node.componentSetId ?? ""}`;
        const existing = externalMap.get(externalKey);
        const nextNodeIds = existing ? new Set(existing.referringNodeIds) : new Set<string>();
        nextNodeIds.add(node.id);
        externalMap.set(externalKey, {
          componentId,
          ...(typeof node.componentSetId === "string" && node.componentSetId.trim().length > 0
            ? { componentSetId: node.componentSetId.trim() }
            : {}),
          familyKey,
          familyName,
          referringNodeIds: sortStrings(nextNodeIds)
        });
      }
    }
    if (typeof node.componentSetId === "string" && node.componentSetId.trim().length > 0) {
      family.componentSetIds.add(node.componentSetId.trim());
    }

    for (const [property, value] of Object.entries(collectVariantProperties(node))) {
      const values = family.variantValuesByProperty.get(property) ?? new Set<string>();
      values.add(value);
      family.variantValuesByProperty.set(property, values);
    }
  }

  const componentFamilies = [...familyMap.values()]
    .map((family) => ({
      familyKey: family.familyKey,
      familyName: family.familyName,
      componentIds: sortStrings(family.componentIds),
      componentSetIds: sortStrings(family.componentSetIds),
      referringNodeIds: sortStrings(family.nodeIds),
      nodeCount: family.nodeIds.size,
      variantProperties: [...family.variantValuesByProperty.entries()]
        .map(([property, values]) => ({
          property,
          values: sortStrings(values)
        }))
        .sort((left, right) => compareStrings(left.property, right.property))
    }))
    .sort((left, right) => {
      if (left.nodeCount !== right.nodeCount) {
        return right.nodeCount - left.nodeCount;
      }
      if (left.familyName !== right.familyName) {
        return compareStrings(left.familyName, right.familyName);
      }
      return compareStrings(left.familyKey, right.familyKey);
    });

  const externalComponents = [...externalMap.values()].sort((left, right) => {
    if (left.familyName !== right.familyName) {
      return compareStrings(left.familyName, right.familyName);
    }
    return compareStrings(left.componentId, right.componentId);
  });

  if (externalComponents.length > 0) {
    diagnostics.push({
      code: "MISSING_LOCAL_COMPONENTS",
      severity: "warning",
      message: `Detected ${externalComponents.length} external component reference(s) without a local component definition.`,
      reasons: ["Referenced componentId values are not present as local COMPONENT or COMPONENT_SET nodes in the cleaned board."],
      componentIds: externalComponents.map((entry) => entry.componentId)
    });
  }

  return {
    componentFamilies,
    externalComponents,
    familyKeyByNodeId
  };
};

const buildTokenSignals = ({
  file,
  diagnostics
}: {
  file: FigmaFile;
  diagnostics: FigmaAnalysisDiagnostic[];
}): FigmaAnalysisTokenSignals => {
  const variableIds = new Set<string>();
  const variableModeIds = new Set<string>();
  const styleCatalog = resolveNodeStyleCatalog(file);
  const styleIdsByType: Record<keyof FigmaAnalysisStyleReferences["byType"], Set<string>> = {
    fill: new Set<string>(),
    stroke: new Set<string>(),
    effect: new Set<string>(),
    text: new Set<string>(),
    generic: new Set<string>()
  };
  const allStyleIds = new Set<string>();

  const nodes = file.document ? collectNodes(file.document, () => true) : [];
  for (const node of nodes) {
    if (node.boundVariables) {
      collectBoundVariableSignals({
        value: node.boundVariables,
        variableIds,
        variableModeIds
      });
    }
    for (const reference of collectDirectStyleReferences(node)) {
      allStyleIds.add(reference.styleId);
      styleIdsByType[reference.type].add(reference.styleId);
    }
  }

  const localStyleIds = [...allStyleIds].filter((styleId) => styleCatalog.has(styleId));
  const linkedStyleIds = [...allStyleIds].filter((styleId) => !styleCatalog.has(styleId));
  if (linkedStyleIds.length > 0) {
    diagnostics.push({
      code: "MISSING_LOCAL_STYLES",
      severity: "warning",
      message: `Detected ${linkedStyleIds.length} referenced style ID(s) without a local style definition.`,
      reasons: ["Referenced style IDs are used by nodes but are absent from the cleaned file-level style catalog."],
      styleIds: linkedStyleIds.sort(compareStrings)
    });
  }

  return {
    boundVariableIds: sortStrings(variableIds),
    variableModeIds: sortStrings(variableModeIds),
    styleReferences: {
      allStyleIds: sortStrings(allStyleIds),
      byType: {
        fill: sortStrings(styleIdsByType.fill),
        stroke: sortStrings(styleIdsByType.stroke),
        effect: sortStrings(styleIdsByType.effect),
        text: sortStrings(styleIdsByType.text),
        generic: sortStrings(styleIdsByType.generic)
      },
      localStyleIds: localStyleIds.sort(compareStrings),
      linkedStyleIds: linkedStyleIds.sort(compareStrings)
    }
  };
};

const buildFrameSignatures = ({
  frameContexts,
  familyKeyByNodeId
}: {
  frameContexts: FrameContext[];
  familyKeyByNodeId: Map<string, string>;
}): FrameSignature[] => {
  return frameContexts.map((context) => {
    const nodes = collectNodes(context.frame, () => true);
    const familyKeys = new Set<string>();
    for (const node of nodes) {
      const familyKey = familyKeyByNodeId.get(node.id);
      if (familyKey) {
        familyKeys.add(familyKey);
      }
    }

    const topChildFingerprints = new Set<string>();
    for (const child of context.frame.children ?? []) {
      const childBounds = child.absoluteBoundingBox ?? ZERO_BOUNDS;
      topChildFingerprints.add(
        [
          normalizeNodeName(child.name).toLowerCase() || child.id.toLowerCase(),
          child.type,
          child.layoutMode ?? "NONE",
          Math.round(asFiniteNumber(childBounds.width) / 32),
          Math.round(asFiniteNumber(childBounds.height) / 32)
        ].join("|")
      );
    }

    const bounds = context.frame.absoluteBoundingBox ?? ZERO_BOUNDS;
    return {
      frameId: context.frame.id,
      frameName: normalizeNodeName(context.frame.name) || context.frame.id,
      pageId: context.pageId,
      width: asFiniteNumber(bounds.width),
      height: asFiniteNumber(bounds.height),
      nodeCount: countSubtreeNodes(context.frame),
      instanceCount: nodes.filter((node) => node.type === "INSTANCE").length,
      nameTokens: tokenize(context.frame.name),
      textTokens: listNodeTextTokens(context.frame),
      familyKeys,
      topChildFingerprints
    };
  });
};

const scoreFrameSimilarity = (left: FrameSignature, right: FrameSignature): { score: number; reasons: string[] } => {
  const reasons: string[] = [];
  const widthSimilarity = Math.abs(left.width - right.width) <= 48 ? 1 : 0;
  if (widthSimilarity === 1) {
    reasons.push("matching-width");
  }
  const nameSimilarity = jaccardSimilarity(left.nameTokens, right.nameTokens);
  if (nameSimilarity > 0) {
    reasons.push("shared-name-tokens");
  }
  const familySimilarity = jaccardSimilarity(left.familyKeys, right.familyKeys);
  if (familySimilarity > 0) {
    reasons.push("shared-component-families");
  }
  const childSimilarity = jaccardSimilarity(left.topChildFingerprints, right.topChildFingerprints);
  if (childSimilarity > 0) {
    reasons.push("shared-top-level-structure");
  }
  const textSimilarity = jaccardSimilarity(left.textTokens, right.textTokens);
  if (textSimilarity > 0) {
    reasons.push("shared-text-signals");
  }
  const heightRatio =
    Math.max(left.height, right.height) > 0 ? Math.min(left.height, right.height) / Math.max(left.height, right.height) : 0;
  const score =
    widthSimilarity * 0.15 +
    nameSimilarity * 0.2 +
    familySimilarity * 0.4 +
    childSimilarity * 0.15 +
    textSimilarity * 0.1 +
    heightRatio * 0.1;
  return {
    score: roundTo(score, 4),
    reasons
  };
};

const resolveVariantAxes = (signatures: FrameSignature[]): FigmaAnalysisVariantAxis[] => {
  const axes: FigmaAnalysisVariantAxis[] = [];
  const nameTokenDiffs = new Set<string>();
  const allNameTokens = signatures.map((signature) => signature.nameTokens);
  const commonNameTokens = new Set<string>(allNameTokens[0] ?? []);
  for (const token of commonNameTokens) {
    if (!allNameTokens.every((entry) => entry.has(token))) {
      commonNameTokens.delete(token);
    }
  }
  for (const signature of signatures) {
    for (const token of signature.nameTokens) {
      if (!commonNameTokens.has(token)) {
        nameTokenDiffs.add(token);
      }
    }
  }
  if (nameTokenDiffs.size > 0) {
    axes.push({
      axis: "name-variants",
      values: sortStrings(nameTokenDiffs),
      source: "name"
    });
  }

  const pricingModeValues = new Set<string>();
  const hasBrutto = signatures.some((signature) => signature.textTokens.has("brutto") || signature.nameTokens.has("brutto"));
  const hasNetto = signatures.some((signature) => signature.textTokens.has("netto") || signature.nameTokens.has("netto"));
  if (hasBrutto) {
    pricingModeValues.add("brutto");
  }
  if (hasNetto) {
    pricingModeValues.add("netto");
  }
  if (pricingModeValues.size > 1) {
    axes.push({
      axis: "pricing-mode",
      values: sortStrings(pricingModeValues),
      source: "text"
    });
  }

  const hasError = signatures.some((signature) => signature.textTokens.has("fehler") || signature.textTokens.has("error"));
  if (hasError) {
    axes.push({
      axis: "validation-state",
      values: ["default", "error"],
      source: "text"
    });
  }

  const heights = signatures.map((signature) => signature.height).sort(compareNumbers);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const hasExpanded = signatures.some((signature) => signature.height > medianHeight * 1.2 || signature.nodeCount > signatures[0]!.nodeCount * 1.15);
  const hasCollapsed = signatures.some((signature) => signature.height <= medianHeight * 1.2);
  if (hasExpanded && hasCollapsed) {
    axes.push({
      axis: "expansion-state",
      values: ["collapsed", "expanded"],
      source: "structure"
    });
  }

  return axes.sort((left, right) => compareStrings(left.axis, right.axis));
};

const chooseCanonicalFrame = (group: FrameSignature[], similarities: Map<string, number>): FrameSignature => {
  return [...group].sort((left, right) => {
    const leftScore = similarities.get(left.frameId) ?? 0;
    const rightScore = similarities.get(right.frameId) ?? 0;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    if (left.height !== right.height) {
      return left.height - right.height;
    }
    if (left.frameName !== right.frameName) {
      return compareStrings(left.frameName, right.frameName);
    }
    return compareStrings(left.frameId, right.frameId);
  })[0]!;
};

const buildFrameVariantGroups = ({
  frameContexts,
  familyKeyByNodeId,
  diagnostics
}: {
  frameContexts: FrameContext[];
  familyKeyByNodeId: Map<string, string>;
  diagnostics: FigmaAnalysisDiagnostic[];
}): FigmaAnalysisFrameVariantGroup[] => {
  const signatures = buildFrameSignatures({ frameContexts, familyKeyByNodeId });
  const visited = new Set<string>();
  const groups: FigmaAnalysisFrameVariantGroup[] = [];

  for (const signature of signatures) {
    if (visited.has(signature.frameId)) {
      continue;
    }
    const matches = signatures
      .filter((candidate) => !visited.has(candidate.frameId))
      .map((candidate) => ({
        candidate,
        result: scoreFrameSimilarity(signature, candidate)
      }))
      .filter(({ candidate, result }) => candidate.frameId === signature.frameId || result.score >= 0.45)
      .map(({ candidate }) => candidate);

    if (matches.length <= 1) {
      continue;
    }

    for (const match of matches) {
      visited.add(match.frameId);
    }

    const pairwiseScores: number[] = [];
    const reasons = new Set<string>();
    const averageSimilarityByFrame = new Map<string, number>();
    for (const left of matches) {
      const scores: number[] = [];
      for (const right of matches) {
        if (left.frameId === right.frameId) {
          continue;
        }
        const result = scoreFrameSimilarity(left, right);
        pairwiseScores.push(result.score);
        scores.push(result.score);
        for (const reason of result.reasons) {
          reasons.add(reason);
        }
      }
      averageSimilarityByFrame.set(
        left.frameId,
        scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0
      );
    }

    const confidence =
      pairwiseScores.length > 0 ? roundTo(pairwiseScores.reduce((sum, value) => sum + value, 0) / pairwiseScores.length, 3) : 1;
    const canonicalFrame = chooseCanonicalFrame(matches, averageSimilarityByFrame);
    const variantAxes = resolveVariantAxes(matches);
    const frameNames = matches.map((entry) => entry.frameName).sort(compareStrings);
    const groupIdBase = frameNames[0] ?? matches[0]!.frameName;
    const fallbackReasons = [
      "Frame grouping is heuristic and based on structural similarity across top-level frames."
    ];

    groups.push({
      groupId: `${toSlug(groupIdBase)}-${matches.length}`,
      frameIds: matches.map((entry) => entry.frameId).sort(compareStrings),
      frameNames,
      canonicalFrameId: canonicalFrame.frameId,
      confidence,
      similarityReasons: sortStrings(reasons),
      fallbackReasons,
      variantAxes
    });

    if (confidence < 0.65) {
      diagnostics.push({
        code: "HEURISTIC_FRAME_VARIANT_GROUP",
        severity: "warning",
        message: `Frame variant grouping for '${groupIdBase}' is heuristic (confidence ${confidence}).`,
        reasons: fallbackReasons,
        nodeIds: matches.map((entry) => entry.frameId).sort(compareStrings)
      });
    }
  }

  return groups.sort((left, right) => compareStrings(left.groupId, right.groupId));
};

const classifyShellRole = ({ node, frame }: { node: FigmaNode; frame: FigmaNode }): "header" | "sidebar" | "navigation" | "frame" => {
  const frameBounds = frame.absoluteBoundingBox ?? ZERO_BOUNDS;
  const nodeBounds = node.absoluteBoundingBox ?? ZERO_BOUNDS;
  const normalizedName = normalizeNodeName(node.name).toLowerCase();
  const topThreshold = asFiniteNumber(frameBounds.height) * 0.18;
  const leftThreshold = asFiniteNumber(frameBounds.width) * 0.18;
  const widthRatio = asFiniteNumber(frameBounds.width) > 0 ? asFiniteNumber(nodeBounds.width) / asFiniteNumber(frameBounds.width) : 0;
  const heightRatio = asFiniteNumber(frameBounds.height) > 0 ? asFiniteNumber(nodeBounds.height) / asFiniteNumber(frameBounds.height) : 0;

  if (normalizedName.includes("nav") || normalizedName.includes("menu") || normalizedName.includes("breadcrumb") || normalizedName.includes("tab")) {
    return "navigation";
  }
  if (asFiniteNumber(nodeBounds.y) - asFiniteNumber(frameBounds.y) <= topThreshold && widthRatio >= 0.55) {
    return "header";
  }
  if (asFiniteNumber(nodeBounds.x) - asFiniteNumber(frameBounds.x) <= leftThreshold && heightRatio >= 0.45 && widthRatio <= 0.35) {
    return "sidebar";
  }
  return "frame";
};

const buildAppShellSignals = ({
  frameContexts,
  frameVariantGroups,
  diagnostics
}: {
  frameContexts: FrameContext[];
  frameVariantGroups: FigmaAnalysisFrameVariantGroup[];
  diagnostics: FigmaAnalysisDiagnostic[];
}): FigmaAnalysisAppShellSignal[] => {
  const frameById = new Map(frameContexts.map((context) => [context.frame.id, context.frame]));
  const signals: FigmaAnalysisAppShellSignal[] = [];

  for (const group of frameVariantGroups) {
    const fingerprintMap = new Map<
      string,
      {
        role: "header" | "sidebar" | "navigation" | "frame";
        frameIds: Set<string>;
        nodeIds: Set<string>;
      }
    >();

    for (const frameId of group.frameIds) {
      const frame = frameById.get(frameId);
      if (!frame) {
        continue;
      }
      for (const child of frame.children ?? []) {
        const childBounds = child.absoluteBoundingBox ?? ZERO_BOUNDS;
        const fingerprint = [
          normalizeNodeName(child.name).toLowerCase() || child.id.toLowerCase(),
          child.type,
          child.layoutMode ?? "NONE",
          Math.round(asFiniteNumber(childBounds.width) / 48),
          Math.round(asFiniteNumber(childBounds.height) / 48)
        ].join("|");
        const existing = fingerprintMap.get(fingerprint) ?? {
          role: classifyShellRole({ node: child, frame }),
          frameIds: new Set<string>(),
          nodeIds: new Set<string>()
        };
        existing.frameIds.add(frameId);
        existing.nodeIds.add(child.id);
        fingerprintMap.set(fingerprint, existing);
      }
    }

    const minimumFrameCoverage = Math.max(2, Math.ceil(group.frameIds.length * 0.6));
    const groupSignals = [...fingerprintMap.entries()]
      .filter(([, entry]) => entry.frameIds.size >= minimumFrameCoverage)
      .map(([fingerprint, entry], index) => ({
        signalId: `${group.groupId}-shell-${index + 1}`,
        groupId: group.groupId,
        role: entry.role,
        fingerprint,
        frameIds: sortStrings(entry.frameIds),
        nodeIds: sortStrings(entry.nodeIds),
        confidence: roundTo(entry.frameIds.size / group.frameIds.length, 3),
        reasons: [
          `Fingerprint repeated in ${entry.frameIds.size} of ${group.frameIds.length} grouped frames.`,
          "Shell detection is based on repeated top-level structure and positional heuristics."
        ]
      }))
      .sort((left, right) => {
        if (left.role !== right.role) {
          return compareStrings(left.role, right.role);
        }
        if (left.confidence !== right.confidence) {
          return right.confidence - left.confidence;
        }
        return compareStrings(left.fingerprint, right.fingerprint);
      });

    if (groupSignals.length === 0) {
      diagnostics.push({
        code: "HEURISTIC_APP_SHELL_UNRESOLVED",
        severity: "info",
        message: `No repeated shell signal met the confidence threshold for frame group '${group.groupId}'.`,
        reasons: ["Shell extraction relies on repeated top-level structure across grouped frames."],
        nodeIds: [...group.frameIds]
      });
    }

    signals.push(...groupSignals);
  }

  return signals;
};

const toDensityFamilies = ({
  counts,
  familyMap,
  total
}: {
  counts: Map<string, number>;
  familyMap: Map<string, FigmaAnalysisComponentFamily>;
  total: number;
}): FigmaAnalysisDensityFamily[] => {
  return [...counts.entries()]
    .map(([familyKey, count]) => ({
      familyKey,
      familyName: familyMap.get(familyKey)?.familyName ?? familyKey,
      count,
      ratio: total > 0 ? roundTo(count / total, 3) : 0
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return compareStrings(left.familyKey, right.familyKey);
    })
    .slice(0, 8);
};

const buildComponentDensity = ({
  frameContexts,
  familyKeyByNodeId,
  componentFamilies
}: {
  frameContexts: FrameContext[];
  familyKeyByNodeId: Map<string, string>;
  componentFamilies: FigmaAnalysisComponentFamily[];
}): FigmaAnalysisComponentDensity => {
  const familyMap = new Map(componentFamilies.map((family) => [family.familyKey, family]));
  const boardCounts = new Map<string, number>();
  const byFrame: FigmaAnalysisFrameDensity[] = [];
  const hotspots: FigmaAnalysisDensityHotspot[] = [];

  for (const context of frameContexts) {
    const nodes = collectNodes(context.frame, () => true);
    const instanceNodes = nodes.filter((node) => node.type === "INSTANCE");
    const frameCounts = new Map<string, number>();
    for (const node of instanceNodes) {
      const familyKey = familyKeyByNodeId.get(node.id);
      if (!familyKey) {
        continue;
      }
      frameCounts.set(familyKey, (frameCounts.get(familyKey) ?? 0) + 1);
      boardCounts.set(familyKey, (boardCounts.get(familyKey) ?? 0) + 1);
    }

    const subtreeNodeCount = countSubtreeNodes(context.frame);
    const instanceCount = instanceNodes.length;
    byFrame.push({
      frameId: context.frame.id,
      frameName: normalizeNodeName(context.frame.name) || context.frame.id,
      subtreeNodeCount,
      instanceCount,
      density: subtreeNodeCount > 0 ? roundTo(instanceCount / subtreeNodeCount, 3) : 0,
      dominantFamilies: toDensityFamilies({
        counts: frameCounts,
        familyMap,
        total: instanceCount
      })
    });

    const subtreeCandidates = collectNodes(context.frame, (node) => Array.isArray(node.children) && node.children.length > 0);
    for (const candidate of subtreeCandidates) {
      if (candidate.id === context.frame.id) {
        continue;
      }
      const candidateNodes = collectNodes(candidate, () => true);
      const candidateInstances = candidateNodes.filter((node) => node.type === "INSTANCE");
      if (candidateInstances.length < 3) {
        continue;
      }
      const candidateCounts = new Map<string, number>();
      for (const instance of candidateInstances) {
        const familyKey = familyKeyByNodeId.get(instance.id);
        if (!familyKey) {
          continue;
        }
        candidateCounts.set(familyKey, (candidateCounts.get(familyKey) ?? 0) + 1);
      }
      const subtreeCount = countSubtreeNodes(candidate);
      const density = subtreeCount > 0 ? candidateInstances.length / subtreeCount : 0;
      if (density < 0.2 && candidateInstances.length < 5) {
        continue;
      }
      hotspots.push({
        hotspotId: `${context.frame.id}:${candidate.id}`,
        frameId: context.frame.id,
        nodeId: candidate.id,
        nodeName: normalizeNodeName(candidate.name) || candidate.id,
        subtreeNodeCount: subtreeCount,
        instanceCount: candidateInstances.length,
        density: roundTo(density, 3),
        dominantFamilies: toDensityFamilies({
          counts: candidateCounts,
          familyMap,
          total: candidateInstances.length
        })
      });
    }
  }

  return {
    boardDominantFamilies: toDensityFamilies({
      counts: boardCounts,
      familyMap,
      total: [...boardCounts.values()].reduce((sum, value) => sum + value, 0)
    }),
    byFrame: byFrame.sort((left, right) => compareStrings(left.frameId, right.frameId)),
    hotspots: hotspots
      .sort((left, right) => {
        if (left.instanceCount !== right.instanceCount) {
          return right.instanceCount - left.instanceCount;
        }
        if (left.density !== right.density) {
          return right.density - left.density;
        }
        return compareStrings(left.hotspotId, right.hotspotId);
      })
      .slice(0, 20)
  };
};

const sanitizeEnrichmentDiagnostics = (enrichment: FigmaMcpEnrichment | undefined): FigmaAnalysisDiagnostic[] => {
  if (!enrichment) {
    return [];
  }
  return [...(enrichment.diagnostics ?? [])]
    .map((entry) => ({
      code: `HYBRID_${entry.code.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      severity: entry.severity,
      message: entry.message,
      reasons: [`Hybrid enrichment source: ${entry.source}.`]
    }))
    .sort((left, right) => compareStrings(left.code, right.code));
};

export const buildFigmaAnalysis = ({
  file,
  enrichment
}: {
  file: FigmaFile;
  enrichment?: FigmaMcpEnrichment;
}): FigmaAnalysis => {
  const diagnostics: FigmaAnalysisDiagnostic[] = [];
  const { layoutGraph, frameContexts } = buildLayoutGraph(file);
  const tokenSignals = buildTokenSignals({ file, diagnostics });
  const { componentFamilies, externalComponents, familyKeyByNodeId } = buildComponentFamilies({
    file,
    diagnostics
  });
  const frameVariantGroups = buildFrameVariantGroups({
    frameContexts,
    familyKeyByNodeId,
    diagnostics
  });
  const appShellSignals = buildAppShellSignals({
    frameContexts,
    frameVariantGroups,
    diagnostics
  });
  const componentDensity = buildComponentDensity({
    frameContexts,
    familyKeyByNodeId,
    componentFamilies
  });

  diagnostics.push(...sanitizeEnrichmentDiagnostics(enrichment));

  const totalNodeCount = file.document ? countSubtreeNodes(file.document) : 0;
  const totalInstanceCount = file.document ? collectNodes(file.document, (node) => node.type === "INSTANCE").length : 0;
  const allNodes = file.document ? collectNodes(file.document, () => true) : [];
  const localComponentCount = allNodes.filter((node) => node.type === "COMPONENT" || node.type === "COMPONENT_SET").length;

  return {
    artifactVersion: 1,
    sourceName: file.name ?? "Figma File",
    summary: {
      pageCount: layoutGraph.pages.length,
      sectionCount: layoutGraph.sections.length,
      topLevelFrameCount: layoutGraph.frames.length,
      totalNodeCount,
      totalInstanceCount,
      localComponentCount,
      localStyleCount: Object.keys(file.styles ?? {}).length,
      externalComponentCount: externalComponents.length
    },
    tokenSignals,
    layoutGraph,
    componentFamilies,
    externalComponents,
    frameVariantGroups,
    appShellSignals,
    componentDensity,
    diagnostics: diagnostics.sort((left, right) => {
      if (left.code !== right.code) {
        return compareStrings(left.code, right.code);
      }
      return compareStrings(left.message, right.message);
    })
  };
};

export const buildRegenerationFallbackFigmaAnalysis = ({ ir }: { ir: DesignIR }): FigmaAnalysis => {
  const totalElements = ir.screens.reduce((sum, screen) => sum + screen.children.length, 0);
  return {
    artifactVersion: 1,
    sourceName: ir.sourceName,
    summary: {
      pageCount: 0,
      sectionCount: 0,
      topLevelFrameCount: ir.screens.length,
      totalNodeCount: totalElements,
      totalInstanceCount: 0,
      localComponentCount: 0,
      localStyleCount: 0,
      externalComponentCount: 0
    },
    tokenSignals: {
      boundVariableIds: [],
      variableModeIds: [],
      styleReferences: {
        allStyleIds: [],
        byType: {
          fill: [],
          stroke: [],
          effect: [],
          text: [],
          generic: []
        },
        localStyleIds: [],
        linkedStyleIds: []
      }
    },
    layoutGraph: {
      pages: [],
      sections: [],
      frames: ir.screens
        .map((screen) => ({
          id: screen.id,
          name: screen.name,
          pageId: "__regeneration__",
          nodeType: "FRAME",
          layoutMode: screen.layoutMode,
          width: roundTo(asFiniteNumber(screen.width), 2),
          height: roundTo(asFiniteNumber(screen.height), 2),
          directChildCount: screen.children.length,
          subtreeNodeCount: screen.children.length,
          instanceCount: 0
        }))
        .sort((left, right) => compareStrings(left.id, right.id)),
      edges: []
    },
    componentFamilies: [],
    externalComponents: [],
    frameVariantGroups: [],
    appShellSignals: [],
    componentDensity: {
      boardDominantFamilies: [],
      byFrame: ir.screens
        .map((screen) => ({
          frameId: screen.id,
          frameName: screen.name,
          subtreeNodeCount: screen.children.length,
          instanceCount: 0,
          density: 0,
          dominantFamilies: []
        }))
        .sort((left, right) => compareStrings(left.frameId, right.frameId)),
      hotspots: []
    },
    diagnostics: [
      {
        code: "REGEN_SOURCE_ANALYSIS_UNAVAILABLE",
        severity: "warning",
        message: "Reused source job had no figma.analysis artifact; emitted a deterministic fallback summary for regeneration.",
        reasons: ["Regeneration can reuse the source board analysis only when the source job already persisted figma.analysis."]
      }
    ]
  };
};
