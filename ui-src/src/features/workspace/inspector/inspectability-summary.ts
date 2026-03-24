export type InspectabilityAvailability = "loading" | "ready" | "unavailable";

export type InspectorDataStatus = "loading" | "ready" | "empty" | "error";

export interface InspectabilityDesignIrNode {
  id: string;
  children?: InspectabilityDesignIrNode[];
}

export interface InspectabilityDesignIrScreen {
  id: string;
  children: InspectabilityDesignIrNode[];
}

export interface InspectabilityManifestEntry {
  irNodeId: string;
}

export interface InspectabilityManifestScreen {
  screenId: string;
  components: InspectabilityManifestEntry[];
}

export interface InspectabilityManifestPayload {
  screens: InspectabilityManifestScreen[];
}

export interface InspectabilityGenerationMetricsPayload {
  skippedHidden?: unknown;
  skippedPlaceholders?: unknown;
  truncatedScreens?: unknown;
  depthTruncatedScreens?: unknown;
  classificationFallbacks?: unknown;
  degradedGeometryNodes?: unknown;
}

export interface InspectabilityCoverageSummary {
  status: InspectabilityAvailability;
  mappedNodes: number;
  unmappedNodes: number;
  totalNodes: number;
  mappedPercent: number;
  message: string | null;
}

export interface InspectabilityOmissionSummary {
  status: InspectabilityAvailability;
  skippedHidden: number;
  skippedPlaceholders: number;
  truncatedByBudget: number;
  depthTruncatedBranches: number;
  classificationFallbacks: number;
  degradedGeometryNodes: number;
  message: string | null;
}

export interface InspectabilitySummary {
  manifestCoverage: InspectabilityCoverageSummary;
  omissionMetrics: InspectabilityOmissionSummary;
  aggregateOnlyNote: string;
}

export interface DeriveInspectabilitySummaryInput {
  designIrStatus: InspectorDataStatus;
  designIrScreens: InspectabilityDesignIrScreen[];
  manifestStatus: InspectorDataStatus;
  manifest: InspectabilityManifestPayload | null;
  metricsStatus: InspectabilityAvailability;
  metrics: InspectabilityGenerationMetricsPayload | null;
}

export const INSPECTABILITY_AGGREGATE_ONLY_NOTE =
  "Aggregate-only summary. Node-level reasons are not available in this version.";

const DEFAULT_COVERAGE_SUMMARY: InspectabilityCoverageSummary = {
  status: "unavailable",
  mappedNodes: 0,
  unmappedNodes: 0,
  totalNodes: 0,
  mappedPercent: 0,
  message: null
};

const DEFAULT_OMISSION_SUMMARY: InspectabilityOmissionSummary = {
  status: "unavailable",
  skippedHidden: 0,
  skippedPlaceholders: 0,
  truncatedByBudget: 0,
  depthTruncatedBranches: 0,
  classificationFallbacks: 0,
  degradedGeometryNodes: 0,
  message: null
};

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function countArrayEntries(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function toRoundedPercent(mappedNodes: number, totalNodes: number): number {
  if (totalNodes <= 0) {
    return 0;
  }
  const ratio = (mappedNodes / totalNodes) * 100;
  return Math.round(ratio * 10) / 10;
}

export function collectIrNodeIds(screens: InspectabilityDesignIrScreen[]): Set<string> {
  const allIds = new Set<string>();
  const stack: InspectabilityDesignIrNode[] = [];

  for (const screen of screens) {
    if (typeof screen.id === "string" && screen.id.length > 0) {
      allIds.add(screen.id);
    }
    if (Array.isArray(screen.children)) {
      for (const child of screen.children) {
        stack.push(child);
      }
    }
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (typeof current.id === "string" && current.id.length > 0) {
      allIds.add(current.id);
    }
    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        stack.push(child);
      }
    }
  }

  return allIds;
}

function collectManifestMappedIds(manifest: InspectabilityManifestPayload): Set<string> {
  const mappedIds = new Set<string>();
  for (const screen of manifest.screens) {
    if (typeof screen.screenId === "string" && screen.screenId.length > 0) {
      mappedIds.add(screen.screenId);
    }
    for (const component of screen.components) {
      if (typeof component.irNodeId === "string" && component.irNodeId.length > 0) {
        mappedIds.add(component.irNodeId);
      }
    }
  }
  return mappedIds;
}

function deriveTruncatedByBudget(truncatedScreens: unknown): number {
  if (!Array.isArray(truncatedScreens)) {
    return 0;
  }

  let totalDropped = 0;
  for (const entry of truncatedScreens) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as { originalElements?: unknown; retainedElements?: unknown };
    const originalElements = toNonNegativeInteger(record.originalElements);
    const retainedElements = toNonNegativeInteger(record.retainedElements);
    totalDropped += Math.max(0, originalElements - retainedElements);
  }

  return totalDropped;
}

function deriveDepthTruncatedBranches(depthTruncatedScreens: unknown): number {
  if (!Array.isArray(depthTruncatedScreens)) {
    return 0;
  }

  let totalBranches = 0;
  for (const entry of depthTruncatedScreens) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as { truncatedBranchCount?: unknown };
    totalBranches += toNonNegativeInteger(record.truncatedBranchCount);
  }
  return totalBranches;
}

function deriveCoverageSummary({
  designIrStatus,
  designIrScreens,
  manifestStatus,
  manifest
}: Pick<DeriveInspectabilitySummaryInput, "designIrStatus" | "designIrScreens" | "manifestStatus" | "manifest">): InspectabilityCoverageSummary {
  if (designIrStatus === "loading" || manifestStatus === "loading") {
    return {
      ...DEFAULT_COVERAGE_SUMMARY,
      status: "loading",
      message: "Coverage summary is loading."
    };
  }

  if (designIrStatus !== "ready") {
    return {
      ...DEFAULT_COVERAGE_SUMMARY,
      status: "unavailable",
      message: "Coverage summary is unavailable because Design IR data is not ready."
    };
  }

  if (manifestStatus !== "ready" || !manifest) {
    return {
      ...DEFAULT_COVERAGE_SUMMARY,
      status: "unavailable",
      message: "Coverage summary is unavailable because component manifest data is not ready."
    };
  }

  const irNodeIds = collectIrNodeIds(designIrScreens);
  const manifestMappedIds = collectManifestMappedIds(manifest);

  let mappedNodes = 0;
  for (const irNodeId of irNodeIds) {
    if (manifestMappedIds.has(irNodeId)) {
      mappedNodes += 1;
    }
  }

  const totalNodes = irNodeIds.size;
  const unmappedNodes = Math.max(0, totalNodes - mappedNodes);
  return {
    status: "ready",
    mappedNodes,
    unmappedNodes,
    totalNodes,
    mappedPercent: toRoundedPercent(mappedNodes, totalNodes),
    message: null
  };
}

function deriveOmissionSummary({
  metricsStatus,
  metrics
}: Pick<DeriveInspectabilitySummaryInput, "metricsStatus" | "metrics">): InspectabilityOmissionSummary {
  if (metricsStatus === "loading") {
    return {
      ...DEFAULT_OMISSION_SUMMARY,
      status: "loading",
      message: "Design IR omission counters are loading."
    };
  }

  if (metricsStatus !== "ready" || !metrics) {
    return {
      ...DEFAULT_OMISSION_SUMMARY,
      status: "unavailable",
      message: "Design IR omission counters are unavailable for this job."
    };
  }

  return {
    status: "ready",
    skippedHidden: toNonNegativeInteger(metrics.skippedHidden),
    skippedPlaceholders: toNonNegativeInteger(metrics.skippedPlaceholders),
    truncatedByBudget: deriveTruncatedByBudget(metrics.truncatedScreens),
    depthTruncatedBranches: deriveDepthTruncatedBranches(metrics.depthTruncatedScreens),
    classificationFallbacks: countArrayEntries(metrics.classificationFallbacks),
    degradedGeometryNodes: countArrayEntries(metrics.degradedGeometryNodes),
    message: null
  };
}

export function deriveInspectabilitySummary(input: DeriveInspectabilitySummaryInput): InspectabilitySummary {
  return {
    manifestCoverage: deriveCoverageSummary(input),
    omissionMetrics: deriveOmissionSummary(input),
    aggregateOnlyNote: INSPECTABILITY_AGGREGATE_ONLY_NOTE
  };
}
