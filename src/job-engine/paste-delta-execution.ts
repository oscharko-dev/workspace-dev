import type {
  WorkspaceImportMode,
  WorkspacePasteDeltaSummary,
} from "../contracts/index.js";
import type { PasteDeltaPlan } from "./paste-tree-diff.js";
import type { PasteFingerprintNode } from "./paste-fingerprint-store.js";

export interface PasteDeltaSeedCandidate {
  pasteIdentityKey: string;
  requestedMode: WorkspaceImportMode;
  provisionalSummary?: WorkspacePasteDeltaSummary;
  sourceJobId?: string;
  compatibilityFingerprint?: string;
  figmaFileKey?: string;
}

export interface WorkspacePasteDeltaSeed extends PasteDeltaSeedCandidate {}

export interface PasteDeltaExecutionState {
  pasteIdentityKey: string;
  requestedMode: WorkspaceImportMode;
  summary: WorkspacePasteDeltaSummary;
  currentFingerprintNodes: readonly PasteFingerprintNode[];
  rootNodeIds: readonly string[];
  changedNodeIds: readonly string[];
  changedRootNodeIds: readonly string[];
  sourceJobId?: string;
  compatibilityFingerprint?: string;
  figmaFileKey?: string;
  eligibleForReuse: boolean;
  fallbackReason?: string;
}

const sortedUnique = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

export const resolvePasteDeltaSummary = ({
  allowReuse,
  plan,
  requestedMode,
}: {
  allowReuse: boolean;
  plan: PasteDeltaPlan;
  requestedMode: WorkspaceImportMode;
}): WorkspacePasteDeltaSummary => {
  let mode: WorkspacePasteDeltaSummary["mode"];
  if (!allowReuse) {
    mode = requestedMode === "auto" ? "auto_resolved_to_full" : "full";
  } else if (requestedMode === "full") {
    mode = "full";
  } else if (requestedMode === "delta") {
    mode = plan.strategy === "structural_break" ? "full" : "delta";
  } else if (
    plan.strategy === "structural_break" ||
    plan.strategy === "baseline_created"
  ) {
    mode = "auto_resolved_to_full";
  } else {
    mode = "auto_resolved_to_delta";
  }

  return {
    mode,
    strategy: plan.strategy,
    totalNodes: plan.totalNodes,
    nodesReused: plan.reusedNodes,
    nodesReprocessed: plan.reprocessedNodes,
    structuralChangeRatio: plan.structuralChangeRatio,
    pasteIdentityKey: "",
    priorManifestMissing: false,
  };
};

export const collectChangedNodeIds = ({
  plan,
}: {
  plan: PasteDeltaPlan;
}): string[] => {
  if (plan.strategy === "no_changes") {
    return [];
  }
  return sortedUnique([
    ...plan.addedNodes.map((entry) => entry.id),
    ...plan.updatedNodes.map((entry) => entry.id),
    ...plan.removedNodes.map((entry) => entry.id),
  ]);
};

export const downgradePasteDeltaExecutionToFull = ({
  state,
  fallbackReason,
}: {
  state: PasteDeltaExecutionState;
  fallbackReason: string;
}): PasteDeltaExecutionState => ({
  ...state,
  summary: {
    ...state.summary,
    mode:
      state.requestedMode === "delta" ? "full" : "auto_resolved_to_full",
  },
  eligibleForReuse: false,
  fallbackReason,
});

export const isPasteDeltaExecutionState = (
  value: unknown,
): value is PasteDeltaExecutionState => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.pasteIdentityKey === "string" &&
    typeof record.requestedMode === "string" &&
    typeof record.summary === "object" &&
    record.summary !== null &&
    Array.isArray(record.currentFingerprintNodes) &&
    Array.isArray(record.rootNodeIds) &&
    Array.isArray(record.changedNodeIds) &&
    Array.isArray(record.changedRootNodeIds) &&
    typeof record.eligibleForReuse === "boolean"
  );
};
