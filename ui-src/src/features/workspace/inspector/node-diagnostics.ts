/**
 * Node-level inspectability diagnostics — data model, derivation, and lookup.
 *
 * Consumes the `nodeDiagnostics` array from generation-metrics.json and
 * cross-references IR nodes against the component manifest to identify
 * unmapped nodes. Provides a `NodeDiagnosticsMap` keyed by node ID for
 * efficient per-node badge rendering in the component tree.
 */

import type {
  InspectabilityDesignIrNode,
  InspectabilityDesignIrScreen,
  InspectabilityManifestPayload,
  InspectorDataStatus
} from "./inspectability-summary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeDiagnosticCategory =
  | "hidden"
  | "placeholder"
  | "truncated"
  | "depth-truncated"
  | "classification-fallback"
  | "degraded-geometry"
  | "unmapped";

export interface NodeDiagnostic {
  nodeId: string;
  category: NodeDiagnosticCategory;
  reason: string;
  screenId?: string;
}

export type NodeDiagnosticsMap = ReadonlyMap<string, readonly NodeDiagnostic[]>;

export interface NodeDiagnosticBadgeConfig {
  label: string;
  abbr: string;
  color: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Badge configuration per category
// ---------------------------------------------------------------------------

const CATEGORY_BADGE_CONFIG: Record<NodeDiagnosticCategory, Omit<NodeDiagnosticBadgeConfig, "title">> = {
  hidden: { label: "Hidden", abbr: "H", color: "bg-gray-200 text-gray-600" },
  placeholder: { label: "Placeholder", abbr: "PH", color: "bg-amber-200 text-amber-700" },
  truncated: { label: "Truncated", abbr: "TR", color: "bg-orange-200 text-orange-700" },
  "depth-truncated": { label: "Depth-truncated", abbr: "DT", color: "bg-orange-200 text-orange-700" },
  "classification-fallback": { label: "Fallback", abbr: "FB", color: "bg-yellow-200 text-yellow-700" },
  "degraded-geometry": { label: "Degraded", abbr: "DG", color: "bg-red-200 text-red-700" },
  unmapped: { label: "Unmapped", abbr: "UM", color: "bg-slate-200 text-slate-600" }
};

const VALID_CATEGORIES = new Set<string>(Object.keys(CATEGORY_BADGE_CONFIG));

// ---------------------------------------------------------------------------
// Derivation input
// ---------------------------------------------------------------------------

export interface DeriveNodeDiagnosticsInput {
  metricsNodeDiagnostics: readonly RawNodeDiagnosticEntry[] | null;
  designIrStatus: InspectorDataStatus;
  designIrScreens: InspectabilityDesignIrScreen[];
  manifestStatus: InspectorDataStatus;
  manifest: InspectabilityManifestPayload | null;
}

export interface RawNodeDiagnosticEntry {
  nodeId?: unknown;
  category?: unknown;
  reason?: unknown;
  screenId?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllIrNodeIds(screens: InspectabilityDesignIrScreen[]): Set<string> {
  const ids = new Set<string>();
  const stack: InspectabilityDesignIrNode[] = [];

  for (const screen of screens) {
    if (typeof screen.id === "string" && screen.id.length > 0) {
      ids.add(screen.id);
    }
    if (Array.isArray(screen.children)) {
      for (const child of screen.children) {
        stack.push(child);
      }
    }
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (typeof current.id === "string" && current.id.length > 0) {
      ids.add(current.id);
    }
    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        stack.push(child);
      }
    }
  }

  return ids;
}

function collectManifestNodeIds(manifest: InspectabilityManifestPayload): Set<string> {
  const ids = new Set<string>();
  for (const screen of manifest.screens) {
    if (typeof screen.screenId === "string" && screen.screenId.length > 0) {
      ids.add(screen.screenId);
    }
    for (const component of screen.components) {
      if (typeof component.irNodeId === "string" && component.irNodeId.length > 0) {
        ids.add(component.irNodeId);
      }
    }
  }
  return ids;
}

function isValidCategory(value: unknown): value is NodeDiagnosticCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value);
}

function isRawNodeDiagnosticEntry(value: unknown): value is RawNodeDiagnosticEntry {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRuntimeNodeDiagnostic(raw: unknown): NodeDiagnostic | null {
  if (!isRawNodeDiagnosticEntry(raw)) {
    return null;
  }

  const nodeId = typeof raw.nodeId === "string" ? raw.nodeId : "";
  if (nodeId.length === 0 || !isValidCategory(raw.category)) {
    return null;
  }

  return {
    nodeId,
    category: raw.category,
    reason: typeof raw.reason === "string" ? raw.reason : `Node diagnosed as ${raw.category}.`,
    ...(typeof raw.screenId === "string" && raw.screenId.length > 0 ? { screenId: raw.screenId } : {})
  };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveNodeDiagnosticsMap(input: DeriveNodeDiagnosticsInput): NodeDiagnosticsMap {
  const map = new Map<string, NodeDiagnostic[]>();

  const addEntry = (entry: NodeDiagnostic): void => {
    const existing = map.get(entry.nodeId);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.nodeId, [entry]);
    }
  };

  // Ingest explicit diagnostics from the runtime
  if (Array.isArray(input.metricsNodeDiagnostics)) {
    for (const raw of input.metricsNodeDiagnostics) {
      const entry = toRuntimeNodeDiagnostic(raw);
      if (entry) {
        addEntry(entry);
      }
    }
  }

  // Derive unmapped diagnostics from IR vs manifest cross-reference
  if (
    input.designIrStatus === "ready" &&
    input.manifestStatus === "ready" &&
    input.manifest
  ) {
    const irNodeIds = collectAllIrNodeIds(input.designIrScreens);
    const manifestNodeIds = collectManifestNodeIds(input.manifest);

    for (const irNodeId of irNodeIds) {
      if (!manifestNodeIds.has(irNodeId) && !map.has(irNodeId)) {
        addEntry({
          nodeId: irNodeId,
          category: "unmapped",
          reason: "Node exists in the Design IR but has no manifest mapping."
        });
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getNodeDiagnostics(map: NodeDiagnosticsMap, nodeId: string): readonly NodeDiagnostic[] {
  return map.get(nodeId) ?? [];
}

export function hasNodeDiagnostics(map: NodeDiagnosticsMap, nodeId: string): boolean {
  const entries = map.get(nodeId);
  return entries !== undefined && entries.length > 0;
}

export function getNodeDiagnosticBadge(category: NodeDiagnosticCategory): NodeDiagnosticBadgeConfig {
  const config = CATEGORY_BADGE_CONFIG[category];
  return {
    ...config,
    title: config.label
  };
}

export function getPrimaryDiagnosticCategory(diagnostics: readonly NodeDiagnostic[]): NodeDiagnosticCategory | null {
  if (diagnostics.length === 0) return null;
  // Priority order: hidden > truncated > depth-truncated > degraded-geometry > classification-fallback > placeholder > unmapped
  const priority: NodeDiagnosticCategory[] = [
    "hidden",
    "truncated",
    "depth-truncated",
    "degraded-geometry",
    "classification-fallback",
    "placeholder",
    "unmapped"
  ];
  for (const cat of priority) {
    if (diagnostics.some((d) => d.category === cat)) {
      return cat;
    }
  }
  return diagnostics[0]?.category ?? null;
}
