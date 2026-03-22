/**
 * Node-level diff resolution for Inspector cross-job comparison.
 *
 * Given the current and previous job manifests, resolves the mapping
 * for a selected node in both jobs so the diff can focus on the right
 * file/range — even when file paths change between job runs.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/448
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

export interface ManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
  components: ManifestEntry[];
}

export interface ManifestPayload {
  jobId: string;
  screens: ManifestScreen[];
}

export interface NodeDiffMapping {
  /** File path in the previous job. */
  file: string;
  /** Start line in the previous job (1-based). */
  startLine: number;
  /** End line in the previous job (1-based). */
  endLine: number;
}

export type NodeDiffStatus =
  /** Node is mapped in both current and previous jobs. */
  | "mapped"
  /** Node is not mapped in the previous job (new node or unmapped). */
  | "unmapped-in-previous"
  /** Node is not mapped in the current job. */
  | "unmapped-in-current"
  /** No previous manifest is available. */
  | "no-previous-manifest";

export interface NodeDiffResult {
  /** Resolution status. */
  status: NodeDiffStatus;
  /** Mapping in the previous job. Null when the node is unmapped there. */
  previousMapping: NodeDiffMapping | null;
  /** Whether the node mapped to a different file in the previous job. */
  fileChanged: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the previous-job mapping for a given node.
 *
 * Searches the previous manifest for the same `irNodeId`. If found,
 * returns the file/range from that job. If the node maps to a
 * different file across jobs, `fileChanged` is set to `true` so the
 * caller knows to fetch alternate previous-file content.
 *
 * @param nodeId            The IR node ID to resolve.
 * @param currentFile       File the node is mapped to in the current job.
 * @param previousManifest  Component manifest from the previous job (null if unavailable).
 * @returns Resolution result with status, mapping, and file-change flag.
 */
export function resolveNodeDiffMapping(
  nodeId: string,
  currentFile: string | null,
  previousManifest: ManifestPayload | null
): NodeDiffResult {
  if (!previousManifest) {
    return {
      status: "no-previous-manifest",
      previousMapping: null,
      fileChanged: false
    };
  }

  if (!currentFile) {
    return {
      status: "unmapped-in-current",
      previousMapping: null,
      fileChanged: false
    };
  }

  // Search all screens for the node in the previous manifest
  for (const screen of previousManifest.screens) {
    // Check if it's the screen node itself
    if (screen.screenId === nodeId) {
      const mapping: NodeDiffMapping = {
        file: screen.file,
        startLine: 1,
        endLine: 1
      };
      return {
        status: "mapped",
        previousMapping: mapping,
        fileChanged: screen.file !== currentFile
      };
    }

    // Check component entries
    for (const entry of screen.components) {
      if (entry.irNodeId === nodeId) {
        const mapping: NodeDiffMapping = {
          file: entry.file,
          startLine: entry.startLine,
          endLine: entry.endLine
        };
        return {
          status: "mapped",
          previousMapping: mapping,
          fileChanged: entry.file !== currentFile
        };
      }
    }
  }

  // Node was not found in the previous manifest
  return {
    status: "unmapped-in-previous",
    previousMapping: null,
    fileChanged: false
  };
}

/**
 * Determine whether node-scoped diff is available for a given resolution.
 *
 * Node-scoped diff requires the node to be mapped in both jobs.
 * When it's not, the caller should fall back to the full-file diff.
 */
export function isNodeScopedDiffAvailable(result: NodeDiffResult): boolean {
  return result.status === "mapped" && result.previousMapping !== null;
}

/**
 * Human-readable explanation for why node-scoped diff is unavailable.
 */
export function nodeDiffUnavailableReason(status: NodeDiffStatus): string | null {
  switch (status) {
    case "mapped":
      return null;
    case "unmapped-in-previous":
      return "This node was not present in the previous generation. The full-file diff is shown instead.";
    case "unmapped-in-current":
      return "This node is not mapped to a specific code region. The full-file diff is shown instead.";
    case "no-previous-manifest":
      return "The previous job's component manifest is not available. The full-file diff is shown instead.";
  }
}
