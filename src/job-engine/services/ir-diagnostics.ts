import type { PipelineDiagnosticInput } from "../errors.js";
import type { FigmaFileResponse } from "../types.js";

interface RejectedScreenCandidate {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  reason: "hidden-page" | "hidden-node" | "non-screen-root" | "unsupported-node-type" | "section-without-screen-like-children";
  pageId?: string;
  pageName?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const toFigmaNodeUrl = ({
  fileKey,
  nodeId
}: {
  fileKey: string | undefined;
  nodeId: string | undefined;
}): string | undefined => {
  if (!fileKey || !nodeId) {
    return undefined;
  }
  const trimmedFileKey = fileKey.trim();
  const trimmedNodeId = nodeId.trim();
  if (!trimmedFileKey || !trimmedNodeId) {
    return undefined;
  }
  return `https://www.figma.com/design/${encodeURIComponent(trimmedFileKey)}?node-id=${encodeURIComponent(
    trimmedNodeId.replace(/:/g, "-")
  )}`;
};

const collectRejectedSectionCandidates = ({
  section,
  pageId,
  pageName
}: {
  section: Record<string, unknown>;
  pageId?: string;
  pageName?: string;
}): RejectedScreenCandidate[] => {
  const sectionChildren = Array.isArray(section.children) ? section.children : [];
  const rejections: RejectedScreenCandidate[] = [];
  let hasNestedScreenLike = false;
  for (const nestedCandidate of sectionChildren) {
    if (!isRecord(nestedCandidate)) {
      continue;
    }
    const nestedType = typeof nestedCandidate.type === "string" ? nestedCandidate.type : "UNKNOWN";
    if (nestedType === "FRAME" || nestedType === "COMPONENT") {
      hasNestedScreenLike = true;
      continue;
    }
    const nestedId = typeof nestedCandidate.id === "string" ? nestedCandidate.id : "unknown";
    const nestedName = typeof nestedCandidate.name === "string" ? nestedCandidate.name : nestedType;
    if (nestedType === "SECTION") {
      const nestedSectionRejections = collectRejectedSectionCandidates({
        section: nestedCandidate,
        ...(pageId ? { pageId } : {}),
        ...(pageName ? { pageName } : {})
      });
      if (nestedSectionRejections.length > 0) {
        rejections.push(...nestedSectionRejections);
      }
      continue;
    }
    rejections.push({
      nodeId: nestedId,
      nodeName: nestedName,
      nodeType: nestedType,
      reason: "unsupported-node-type",
      ...(pageId ? { pageId } : {}),
      ...(pageName ? { pageName } : {})
    });
  }
  if (!hasNestedScreenLike) {
    rejections.push({
      nodeId: typeof section.id === "string" ? section.id : "unknown",
      nodeName: typeof section.name === "string" ? section.name : "Section",
      nodeType: "SECTION",
      reason: "section-without-screen-like-children",
      ...(pageId ? { pageId } : {}),
      ...(pageName ? { pageName } : {})
    });
  }
  return rejections;
};

export const analyzeScreenCandidateRejections = ({
  sourceFile
}: {
  sourceFile: FigmaFileResponse;
}): {
  rejectedCandidates: RejectedScreenCandidate[];
  rootCandidateCount: number;
} => {
  const rejectedCandidates: RejectedScreenCandidate[] = [];
  if (!isRecord(sourceFile.document)) {
    return {
      rejectedCandidates,
      rootCandidateCount: 0
    };
  }
  const documentNode = sourceFile.document;
  const pages = Array.isArray(documentNode.children) ? documentNode.children : [];
  let rootCandidateCount = 0;
  for (const pageCandidate of pages) {
    if (!isRecord(pageCandidate)) {
      continue;
    }
    const pageId = typeof pageCandidate.id === "string" ? pageCandidate.id : undefined;
    const pageName = typeof pageCandidate.name === "string" ? pageCandidate.name : undefined;
    if (pageCandidate.visible === false) {
      rejectedCandidates.push({
        nodeId: pageId ?? "unknown",
        nodeName: pageName ?? "Page",
        nodeType: "CANVAS",
        reason: "hidden-page"
      });
      continue;
    }
    const pageChildren = Array.isArray(pageCandidate.children) ? pageCandidate.children : [];
    for (const childCandidate of pageChildren) {
      if (!isRecord(childCandidate)) {
        continue;
      }
      const nodeType = typeof childCandidate.type === "string" ? childCandidate.type : "UNKNOWN";
      const nodeId = typeof childCandidate.id === "string" ? childCandidate.id : "unknown";
      const nodeName = typeof childCandidate.name === "string" ? childCandidate.name : nodeType;
      if (childCandidate.visible === false) {
        rejectedCandidates.push({
          nodeId,
          nodeName,
          nodeType,
          reason: "hidden-node",
          ...(pageId ? { pageId } : {}),
          ...(pageName ? { pageName } : {})
        });
        continue;
      }
      if (nodeType === "FRAME" || nodeType === "COMPONENT") {
        rootCandidateCount += 1;
        continue;
      }
      if (nodeType === "SECTION") {
        const sectionRejections = collectRejectedSectionCandidates({
          section: childCandidate,
          ...(pageId ? { pageId } : {}),
          ...(pageName ? { pageName } : {})
        });
        rejectedCandidates.push(...sectionRejections);
        continue;
      }
      rejectedCandidates.push({
        nodeId,
        nodeName,
        nodeType,
        reason: "non-screen-root",
        ...(pageId ? { pageId } : {}),
        ...(pageName ? { pageName } : {})
      });
    }
  }
  return {
    rejectedCandidates: rejectedCandidates.slice(0, 20),
    rootCandidateCount
  };
};

export const SCREEN_REJECTION_REASON_MESSAGE: Record<RejectedScreenCandidate["reason"], string> = {
  "hidden-page": "The page is hidden.",
  "hidden-node": "The node is hidden.",
  "non-screen-root": "The node is not a supported top-level screen root (expected FRAME/COMPONENT/SECTION).",
  "unsupported-node-type": "The node type is not supported as a screen candidate.",
  "section-without-screen-like-children": "The section has no FRAME/COMPONENT children."
};

export const SCREEN_REJECTION_REASON_SUGGESTION: Record<RejectedScreenCandidate["reason"], string> = {
  "hidden-page": "Unhide the page or move target screens into a visible page.",
  "hidden-node": "Unhide the node or choose a visible FRAME/COMPONENT root.",
  "non-screen-root": "Use FRAME/COMPONENT roots for screen-level content or wrap content in a FRAME.",
  "unsupported-node-type": "Convert or wrap the node into a FRAME/COMPONENT that can be treated as a screen root.",
  "section-without-screen-like-children": "Add at least one FRAME/COMPONENT under this section."
};

export const toSortedReasonCounts = ({
  rejectedCandidates
}: {
  rejectedCandidates: RejectedScreenCandidate[];
}): Record<string, number> => {
  const reasonCounts = new Map<string, number>();
  for (const entry of rejectedCandidates) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }
  return [...reasonCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, number>>((accumulator, [reason, count]) => {
      accumulator[reason] = count;
      return accumulator;
    }, {});
};

export const toMcpCoverageDiagnostics = ({
  stage,
  diagnostics
}: {
  stage: "ir.derive";
  diagnostics: Array<{
    code: string;
    message: string;
    severity: "error" | "warning" | "info";
    source: "metadata" | "variables" | "styles" | "code_connect" | "design_system" | "assets" | "screenshots" | "loader";
  }>;
}): PipelineDiagnosticInput[] => {
  return diagnostics.map((entry) => ({
    code: entry.code,
    message: entry.message,
    suggestion:
      entry.source === "loader"
        ? "Configure a hybrid MCP enrichment loader or use pure REST mode if no MCP data is available."
        : `Check MCP ${entry.source.replace(/_/g, " ")} availability and data coverage for this board.`,
    stage,
    severity: entry.severity
  }));
};
