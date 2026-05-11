/**
 * Guided override remap suggestions for stale Inspector drafts.
 *
 * Compares two IR trees (source and latest) and produces explicit,
 * rule-based remap suggestions for override node IDs that changed
 * between jobs. No opaque heuristics — every suggestion is tagged
 * with the rule that produced it and a confidence level.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/466
 */

import type {
  WorkspaceRemapRejection,
  WorkspaceRemapSuggestion,
  WorkspaceRemapSuggestResult
} from "../contracts/index.js";
import type { DesignIR, ScreenElementIR, ScreenIR } from "../parity/types-ir.js";

// ---------------------------------------------------------------------------
// Internal node descriptor for comparison
// ---------------------------------------------------------------------------

interface IrNodeDescriptor {
  id: string;
  name: string;
  type: string;
  parentName: string | null;
  screenName: string;
  ancestryPath: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// IR tree flattening
// ---------------------------------------------------------------------------

function flattenElement(
  element: ScreenElementIR,
  screenName: string,
  parentName: string | null,
  ancestryPath: string,
  depth: number,
  out: IrNodeDescriptor[]
): void {
  const currentPath = ancestryPath ? `${ancestryPath}/${element.name}` : element.name;
  out.push({
    id: element.id,
    name: element.name,
    type: element.type,
    parentName,
    screenName,
    ancestryPath: currentPath,
    depth
  });
  if (element.children) {
    for (const child of element.children) {
      flattenElement(child, screenName, element.name, currentPath, depth + 1, out);
    }
  }
}

function flattenScreen(screen: ScreenIR, out: IrNodeDescriptor[]): void {
  out.push({
    id: screen.id,
    name: screen.name,
    type: "screen",
    parentName: null,
    screenName: screen.name,
    ancestryPath: screen.name,
    depth: 0
  });
  for (const child of screen.children) {
    flattenElement(child, screen.name, screen.name, screen.name, 1, out);
  }
}

function flattenIr(ir: DesignIR): IrNodeDescriptor[] {
  const descriptors: IrNodeDescriptor[] = [];
  for (const screen of ir.screens) {
    flattenScreen(screen, descriptors);
  }
  return descriptors;
}

// ---------------------------------------------------------------------------
// Normalisation for fuzzy name comparison
// ---------------------------------------------------------------------------

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Remap rules (applied in priority order)
// ---------------------------------------------------------------------------

function tryExactIdMatch(
  sourceNode: IrNodeDescriptor,
  targetNodes: IrNodeDescriptor[]
): WorkspaceRemapSuggestion | null {
  const match = targetNodes.find((t) => t.id === sourceNode.id);
  if (!match) {
    return null;
  }
  return {
    sourceNodeId: sourceNode.id,
    sourceNodeName: sourceNode.name,
    sourceNodeType: sourceNode.type,
    targetNodeId: match.id,
    targetNodeName: match.name,
    targetNodeType: match.type,
    rule: "exact-id",
    confidence: "high",
    reason: `Node ID '${sourceNode.id}' exists in the latest IR with same identity.`
  };
}

function tryNameAndTypeMatch(
  sourceNode: IrNodeDescriptor,
  targetNodes: IrNodeDescriptor[],
  alreadyMapped: Set<string>
): WorkspaceRemapSuggestion | null {
  const candidates = targetNodes.filter(
    (t) =>
      !alreadyMapped.has(t.id) &&
      t.name === sourceNode.name &&
      t.type === sourceNode.type &&
      t.screenName === sourceNode.screenName
  );
  if (candidates.length !== 1) {
    return null;
  }
  const match = candidates[0]!;
  return {
    sourceNodeId: sourceNode.id,
    sourceNodeName: sourceNode.name,
    sourceNodeType: sourceNode.type,
    targetNodeId: match.id,
    targetNodeName: match.name,
    targetNodeType: match.type,
    rule: "name-and-type",
    confidence: "high",
    reason: `Unique name+type match '${sourceNode.name}' (${sourceNode.type}) in screen '${sourceNode.screenName}'.`
  };
}

function tryFuzzyNameAndTypeMatch(
  sourceNode: IrNodeDescriptor,
  targetNodes: IrNodeDescriptor[],
  alreadyMapped: Set<string>
): WorkspaceRemapSuggestion | null {
  const normSource = normaliseName(sourceNode.name);
  if (!normSource) {
    return null;
  }
  const candidates = targetNodes.filter(
    (t) =>
      !alreadyMapped.has(t.id) &&
      normaliseName(t.name) === normSource &&
      t.type === sourceNode.type &&
      t.screenName === sourceNode.screenName
  );
  if (candidates.length !== 1) {
    return null;
  }
  const match = candidates[0]!;
  return {
    sourceNodeId: sourceNode.id,
    sourceNodeName: sourceNode.name,
    sourceNodeType: sourceNode.type,
    targetNodeId: match.id,
    targetNodeName: match.name,
    targetNodeType: match.type,
    rule: "name-fuzzy-and-type",
    confidence: "medium",
    reason: `Fuzzy name match '${sourceNode.name}' → '${match.name}' (${sourceNode.type}) in screen '${sourceNode.screenName}'.`
  };
}

function tryAncestryAndTypeMatch(
  sourceNode: IrNodeDescriptor,
  targetNodes: IrNodeDescriptor[],
  alreadyMapped: Set<string>
): WorkspaceRemapSuggestion | null {
  if (!sourceNode.parentName) {
    return null;
  }
  const candidates = targetNodes.filter(
    (t) =>
      !alreadyMapped.has(t.id) &&
      t.type === sourceNode.type &&
      t.parentName === sourceNode.parentName &&
      t.screenName === sourceNode.screenName &&
      t.depth === sourceNode.depth
  );
  if (candidates.length !== 1) {
    return null;
  }
  const match = candidates[0]!;
  return {
    sourceNodeId: sourceNode.id,
    sourceNodeName: sourceNode.name,
    sourceNodeType: sourceNode.type,
    targetNodeId: match.id,
    targetNodeName: match.name,
    targetNodeType: match.type,
    rule: "ancestry-and-type",
    confidence: "low",
    reason: `Same type '${sourceNode.type}' under parent '${sourceNode.parentName}' at depth ${String(sourceNode.depth)} in screen '${sourceNode.screenName}'.`
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateRemapSuggestionsInput {
  sourceIr: DesignIR;
  latestIr: DesignIR;
  unmappedNodeIds: string[];
  sourceJobId: string;
  latestJobId: string;
}

export function generateRemapSuggestions({
  sourceIr,
  latestIr,
  unmappedNodeIds,
  sourceJobId,
  latestJobId
}: GenerateRemapSuggestionsInput): WorkspaceRemapSuggestResult {
  if (unmappedNodeIds.length === 0) {
    return {
      sourceJobId,
      latestJobId,
      suggestions: [],
      rejections: [],
      message: "No unmapped nodes to remap."
    };
  }

  const sourceDescriptors = flattenIr(sourceIr);
  const targetDescriptors = flattenIr(latestIr);

  // Build lookup for source nodes by ID
  const sourceById = new Map<string, IrNodeDescriptor>();
  for (const desc of sourceDescriptors) {
    sourceById.set(desc.id, desc);
  }

  const suggestions: WorkspaceRemapSuggestion[] = [];
  const rejections: WorkspaceRemapRejection[] = [];
  const alreadyMapped = new Set<string>();

  // Process each unmapped node through the rule cascade
  for (const nodeId of unmappedNodeIds) {
    const sourceNode = sourceById.get(nodeId);
    if (!sourceNode) {
      rejections.push({
        sourceNodeId: nodeId,
        sourceNodeName: "(unknown)",
        sourceNodeType: "(unknown)",
        reason: `Node '${nodeId}' was not found in the source IR.`
      });
      continue;
    }

    // Rule cascade: highest confidence first
    const rules: Array<(
      src: IrNodeDescriptor,
      targets: IrNodeDescriptor[],
      mapped: Set<string>
    ) => WorkspaceRemapSuggestion | null> = [
      (src, targets) => tryExactIdMatch(src, targets),
      (src, targets, mapped) => tryNameAndTypeMatch(src, targets, mapped),
      (src, targets, mapped) => tryFuzzyNameAndTypeMatch(src, targets, mapped),
      (src, targets, mapped) => tryAncestryAndTypeMatch(src, targets, mapped)
    ];

    let matched = false;
    for (const rule of rules) {
      const suggestion = rule(sourceNode, targetDescriptors, alreadyMapped);
      if (suggestion) {
        suggestions.push(suggestion);
        alreadyMapped.add(suggestion.targetNodeId);
        matched = true;
        break;
      }
    }

    if (!matched) {
      rejections.push({
        sourceNodeId: sourceNode.id,
        sourceNodeName: sourceNode.name,
        sourceNodeType: sourceNode.type,
        reason: `No matching node found in the latest IR for '${sourceNode.name}' (${sourceNode.type}).`
      });
    }
  }

  const totalRequested = unmappedNodeIds.length;
  const suggestedCount = suggestions.length;
  const rejectedCount = rejections.length;

  let message: string;
  if (rejectedCount === 0) {
    message = `All ${String(totalRequested)} unmapped node(s) have remap suggestions.`;
  } else if (suggestedCount === 0) {
    message = `No remap suggestions could be determined for any of the ${String(totalRequested)} unmapped node(s).`;
  } else {
    message = `${String(suggestedCount)} of ${String(totalRequested)} unmapped node(s) have remap suggestions. ${String(rejectedCount)} could not be mapped.`;
  }

  return {
    sourceJobId,
    latestJobId,
    suggestions,
    rejections,
    message
  };
}
