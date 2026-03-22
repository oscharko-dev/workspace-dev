import { JOB_ROUTE_PREFIX, REPRO_ROUTE_PREFIX, UI_ROUTE_PREFIX, type UiAssetPath } from "./constants.js";

export function resolveUiAssetPath(pathname: string): UiAssetPath | null {
  if (pathname === UI_ROUTE_PREFIX || pathname === `${UI_ROUTE_PREFIX}/`) {
    return "index.html";
  }

  if (!pathname.startsWith(`${UI_ROUTE_PREFIX}/`)) {
    return null;
  }

  const requestedAsset = pathname.slice(`${UI_ROUTE_PREFIX}/`.length);
  if (requestedAsset.length === 0) {
    return "index.html";
  }

  if (requestedAsset.includes("..")) {
    return null;
  }

  return requestedAsset;
}

export function isWorkspaceProjectRoute(pathname: string): boolean {
  if (!pathname.startsWith("/workspace/")) {
    return false;
  }

  const withoutPrefix = pathname.slice("/workspace/".length);
  if (withoutPrefix.length < 1) {
    return false;
  }
  if (withoutPrefix.includes("/")) {
    return false;
  }

  if (withoutPrefix === "ui" || withoutPrefix === "submit") {
    return false;
  }

  return !withoutPrefix.startsWith("jobs") && !withoutPrefix.startsWith("repros");
}

export function parseJobRoute(pathname: string): { jobId: string; action: "status" | "result" | "cancel" | "design-ir" | "component-manifest" | "regenerate" | "sync" | "create-pr" } | undefined {
  if (!pathname.startsWith(JOB_ROUTE_PREFIX)) {
    return undefined;
  }

  const rest = pathname.slice(JOB_ROUTE_PREFIX.length);
  if (!rest) {
    return undefined;
  }

  if (rest.endsWith("/result")) {
    const jobId = rest.slice(0, -"/result".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "result"
    };
  }

  if (rest.endsWith("/cancel")) {
    const jobId = rest.slice(0, -"/cancel".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "cancel"
    };
  }

  if (rest.endsWith("/design-ir")) {
    const jobId = rest.slice(0, -"/design-ir".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "design-ir"
    };
  }

  if (rest.endsWith("/component-manifest")) {
    const jobId = rest.slice(0, -"/component-manifest".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "component-manifest"
    };
  }

  if (rest.endsWith("/regenerate")) {
    const jobId = rest.slice(0, -"/regenerate".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "regenerate"
    };
  }

  if (rest.endsWith("/create-pr")) {
    const jobId = rest.slice(0, -"/create-pr".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "create-pr"
    };
  }

  if (rest.endsWith("/sync")) {
    const jobId = rest.slice(0, -"/sync".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "sync"
    };
  }

  if (rest.includes("/")) {
    return undefined;
  }

  return {
    jobId: rest,
    action: "status"
  };
}

export function parseJobFilesRoute(
  pathname: string
): { jobId: string; filePath: string | undefined } | undefined {
  if (!pathname.startsWith(JOB_ROUTE_PREFIX)) {
    return undefined;
  }

  const rest = pathname.slice(JOB_ROUTE_PREFIX.length);
  if (!rest) {
    return undefined;
  }

  const filesSegment = "/files";
  const filesSegmentIndex = rest.indexOf(filesSegment);
  if (filesSegmentIndex === -1) {
    return undefined;
  }

  const jobId = rest.slice(0, filesSegmentIndex);
  if (!jobId || jobId.includes("/")) {
    return undefined;
  }

  const afterFiles = rest.slice(filesSegmentIndex + filesSegment.length);

  // Exact match: /workspace/jobs/{jobId}/files
  if (afterFiles.length === 0) {
    return { jobId, filePath: undefined };
  }

  // Must have a leading slash for file path
  if (!afterFiles.startsWith("/")) {
    return undefined;
  }

  const filePath = afterFiles.slice(1);
  if (filePath.length === 0) {
    return { jobId, filePath: undefined };
  }

  return { jobId, filePath };
}

/** Allowed extensions for generated source file serving. */
const ALLOWED_FILE_EXTENSIONS = new Set([".tsx", ".ts", ".json", ".css", ".html", ".svg"]);

/** Blocked directory prefixes that must never be served. */
const BLOCKED_PATH_PREFIXES = ["node_modules/", "dist/", ".env"];

export function validateSourceFilePath(
  filePath: string
): { valid: true } | { valid: false; reason: string } {
  if (filePath.length === 0) {
    return { valid: false, reason: "Empty file path." };
  }

  // Reject absolute paths
  if (filePath.startsWith("/")) {
    return { valid: false, reason: "Absolute paths are not allowed." };
  }

  // Reject path traversal
  if (filePath.includes("..")) {
    return { valid: false, reason: "Path traversal is not allowed." };
  }

  // Reject null bytes
  if (filePath.includes("\0")) {
    return { valid: false, reason: "Null bytes in path are not allowed." };
  }

  // Reject blocked prefixes
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (filePath === blocked || filePath.startsWith(blocked)) {
      return { valid: false, reason: `Access to '${blocked}' is forbidden.` };
    }
    // Also block when nested (e.g. "src/node_modules/...")
    if (filePath.includes(`/${blocked}`)) {
      return { valid: false, reason: `Access to '${blocked}' is forbidden.` };
    }
  }

  // Reject files not in the allowlist
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) {
    return { valid: false, reason: "File extension required." };
  }
  const ext = filePath.slice(dotIndex);
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `Extension '${ext}' is not allowed.` };
  }

  return { valid: true };
}

export function parseReproRoute(pathname: string): { jobId: string; previewPath: string } | undefined {
  if (!pathname.startsWith(REPRO_ROUTE_PREFIX)) {
    return undefined;
  }

  const rest = pathname.slice(REPRO_ROUTE_PREFIX.length);
  if (!rest) {
    return undefined;
  }

  const firstSlash = rest.indexOf("/");
  if (firstSlash === -1) {
    return {
      jobId: rest,
      previewPath: "index.html"
    };
  }

  const jobId = rest.slice(0, firstSlash);
  const previewPath = rest.slice(firstSlash + 1);
  if (!jobId) {
    return undefined;
  }

  return {
    jobId,
    previewPath: previewPath || "index.html"
  };
}
