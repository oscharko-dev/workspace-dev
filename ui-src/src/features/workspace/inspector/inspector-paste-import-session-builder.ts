// ---------------------------------------------------------------------------
// Paste Import Session Builder (Issue #1010)
//
// Pure module that derives a PasteImportSession record from the pipeline
// state at the moment an import completes. Callers own id generation and
// the completion timestamp so the module remains deterministic.
// ---------------------------------------------------------------------------

import type { PastePipelineState } from "./paste-pipeline";
import type { PasteImportSession } from "./paste-import-history";

export interface BuildPasteImportSessionInput {
  /** The pipeline state at completion. */
  readonly pipelineState: PastePipelineState;
  /** When the import is from a Figma URL submit, the parsed key + node. Otherwise null. */
  readonly urlContext: { fileKey: string; nodeId: string | null } | null;
  /** Generated session id (caller controls generation — typically `generateImportSessionId()`). */
  readonly sessionId: string;
  /** ISO timestamp of completion (caller controls; usually `new Date().toISOString()`). */
  readonly completedAt: string;
}

interface NodeWithChildren {
  readonly children?: readonly NodeWithChildren[];
}

function countNodesRecursively(
  nodes: readonly NodeWithChildren[] | undefined,
): number {
  if (nodes === undefined) {
    return 0;
  }
  let total = 0;
  for (const node of nodes) {
    total += 1;
    total += countNodesRecursively(node.children);
  }
  return total;
}

function resolveNodeName(
  pipelineState: PastePipelineState,
  urlContext: { fileKey: string; nodeId: string | null } | null,
): string {
  const designIrName = pipelineState.designIR?.screens[0]?.name;
  if (typeof designIrName === "string" && designIrName.length > 0) {
    return designIrName;
  }
  const sourceScreenName = pipelineState.sourceScreens?.[0]?.name;
  if (typeof sourceScreenName === "string" && sourceScreenName.length > 0) {
    return sourceScreenName;
  }
  return urlContext?.fileKey ?? "";
}

function sumComponentMappings(pipelineState: PastePipelineState): number {
  const screens = pipelineState.componentManifest?.screens;
  if (screens === undefined) {
    return 0;
  }
  let total = 0;
  for (const screen of screens) {
    total += screen.components.length;
  }
  return total;
}

export function buildPasteImportSession(
  input: BuildPasteImportSessionInput,
): PasteImportSession | null {
  const { pipelineState, urlContext, sessionId, completedAt } = input;

  if (pipelineState.jobId === undefined) {
    return null;
  }
  if (pipelineState.stage !== "ready" && pipelineState.stage !== "partial") {
    return null;
  }

  const nodeCount = countNodesRecursively(pipelineState.designIR?.screens);

  const echoedScope = pipelineState.selectedNodeIds ?? [];
  const scope: "all" | "partial" = echoedScope.length > 0 ? "partial" : "all";

  return {
    id: sessionId,
    jobId: pipelineState.jobId,
    fileKey: urlContext?.fileKey ?? "",
    nodeId: urlContext?.nodeId ?? "",
    nodeName: resolveNodeName(pipelineState, urlContext),
    importedAt: completedAt,
    nodeCount,
    fileCount: pipelineState.generatedFiles?.length ?? 0,
    selectedNodes: [...echoedScope],
    scope,
    componentMappings: sumComponentMappings(pipelineState),
    pasteIdentityKey: pipelineState.pasteIdentityKey ?? null,
  };
}
