import path from "node:path";
import {
  JOB_ROUTE_PREFIX,
  REPRO_ROUTE_PREFIX,
  TEST_SPACE_RUNS_ROUTE_PREFIX,
  TEST_SPACE_UI_ROUTE_PREFIX,
  UI_ROUTE_PREFIX,
  type UiAssetPath,
} from "./constants.js";
import {
  INVALID_PATH_ENCODING,
  normalizePlatformPath,
  safeDecode,
} from "./route-params.js";

const UI_ROUTE_PREFIXES = [UI_ROUTE_PREFIX, TEST_SPACE_UI_ROUTE_PREFIX] as const;

function normalizeUiRoutePath(
  pathname: string,
): UiAssetPath | null | undefined {
  for (const routePrefix of UI_ROUTE_PREFIXES) {
    if (pathname === routePrefix || pathname === `${routePrefix}/`) {
      return "index.html";
    }

    if (!pathname.startsWith(`${routePrefix}/`)) {
      continue;
    }

    const requestedAsset = pathname.slice(`${routePrefix}/`.length);
    if (requestedAsset.length === 0) {
      return "index.html";
    }

    const decodedPath = safeDecode(requestedAsset);
    if (decodedPath === INVALID_PATH_ENCODING || decodedPath.includes("\0")) {
      return null;
    }

    const normalizedPath = normalizePlatformPath(decodedPath);
    if (!normalizedPath.ok) {
      return null;
    }

    const segments = normalizedPath.normalized
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return "index.html";
    }

    if (segments.some((segment) => segment === "." || segment === "..")) {
      return null;
    }

    return segments.join("/");
  }

  return undefined;
}

export function resolveUiAssetPath(pathname: string): UiAssetPath | null {
  const normalizedPath = normalizeUiRoutePath(pathname);
  if (normalizedPath === undefined) {
    return null;
  }
  return normalizedPath;
}

export function isForbiddenUiAssetPath(pathname: string): boolean {
  return (
    UI_ROUTE_PREFIXES.some((routePrefix) =>
      pathname.startsWith(`${routePrefix}/`),
    ) && normalizeUiRoutePath(pathname) === null
  );
}

export function shouldFallbackToUiEntrypoint(pathname: string): boolean {
  const requestedPath = normalizeUiRoutePath(pathname);
  if (requestedPath === undefined || requestedPath === null) {
    return false;
  }

  if (requestedPath === "index.html") {
    return false;
  }

  if (requestedPath.startsWith("assets/")) {
    return false;
  }

  return !path.posix.basename(requestedPath).includes(".");
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

  if (
    withoutPrefix === "ui" ||
    withoutPrefix === "submit" ||
    withoutPrefix === "inspector-policy"
  ) {
    return false;
  }

  return (
    !withoutPrefix.startsWith("jobs") && !withoutPrefix.startsWith("repros")
  );
}

export function parseTestSpaceRunRoute(pathname: string):
  | {
      runId: string;
      action: "collection" | "detail" | "test-cases" | "markdown";
    }
  | undefined {
  if (
    pathname === TEST_SPACE_RUNS_ROUTE_PREFIX ||
    pathname === `${TEST_SPACE_RUNS_ROUTE_PREFIX}/`
  ) {
    return {
      runId: "",
      action: "collection",
    };
  }

  if (!pathname.startsWith(`${TEST_SPACE_RUNS_ROUTE_PREFIX}/`)) {
    return undefined;
  }

  const rest = pathname.slice(`${TEST_SPACE_RUNS_ROUTE_PREFIX}/`.length);
  if (rest.length === 0) {
    return undefined;
  }

  if (rest.endsWith("/test-cases.md")) {
    const runId = rest.slice(0, -"/test-cases.md".length);
    if (!runId || runId.includes("/")) {
      return undefined;
    }
    return {
      runId,
      action: "markdown",
    };
  }

  if (rest.endsWith("/test-cases")) {
    const runId = rest.slice(0, -"/test-cases".length);
    if (!runId || runId.includes("/")) {
      return undefined;
    }
    return {
      runId,
      action: "test-cases",
    };
  }

  if (rest.includes("/")) {
    return undefined;
  }

  return {
    runId: rest,
    action: "detail",
  };
}

export function parseImportSessionRoute(pathname: string):
  | {
      sessionId: string;
      action: "detail" | "reimport" | "events" | "approve";
    }
  | undefined {
  if (pathname === "/workspace/import-sessions") {
    return {
      sessionId: "",
      action: "detail",
    };
  }

  const prefix = "/workspace/import-sessions/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  const rest = pathname.slice(prefix.length);
  if (rest.length === 0) {
    return undefined;
  }

  if (rest.endsWith("/reimport")) {
    const sessionId = rest.slice(0, -"/reimport".length);
    if (!sessionId || sessionId.includes("/")) {
      return undefined;
    }
    return {
      sessionId,
      action: "reimport",
    };
  }

  if (rest.endsWith("/events")) {
    const sessionId = rest.slice(0, -"/events".length);
    if (!sessionId || sessionId.includes("/")) {
      return undefined;
    }
    return {
      sessionId,
      action: "events",
    };
  }

  if (rest.endsWith("/approve")) {
    const sessionId = rest.slice(0, -"/approve".length);
    if (!sessionId || sessionId.includes("/")) {
      return undefined;
    }
    return {
      sessionId,
      action: "approve",
    };
  }

  if (rest.includes("/")) {
    return undefined;
  }

  return {
    sessionId: rest,
    action: "detail",
  };
}

export function parseJobRoute(pathname: string):
  | {
      jobId: string;
      action:
        | "status"
        | "result"
        | "cancel"
        | "design-ir"
        | "figma-analysis"
        | "component-manifest"
        | "screenshot"
        | "regenerate"
        | "retry-stage"
        | "sync"
        | "create-pr"
        | "stale-check"
        | "remap-suggest"
        | "token-intelligence"
        | "token-decisions";
    }
  | undefined {
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
      action: "result",
    };
  }

  if (rest.endsWith("/cancel")) {
    const jobId = rest.slice(0, -"/cancel".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "cancel",
    };
  }

  if (rest.endsWith("/design-ir")) {
    const jobId = rest.slice(0, -"/design-ir".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "design-ir",
    };
  }

  if (rest.endsWith("/figma-analysis")) {
    const jobId = rest.slice(0, -"/figma-analysis".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "figma-analysis",
    };
  }

  if (rest.endsWith("/component-manifest")) {
    const jobId = rest.slice(0, -"/component-manifest".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "component-manifest",
    };
  }

  if (rest.endsWith("/screenshot")) {
    const jobId = rest.slice(0, -"/screenshot".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "screenshot",
    };
  }

  if (rest.endsWith("/regenerate")) {
    const jobId = rest.slice(0, -"/regenerate".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "regenerate",
    };
  }

  if (rest.endsWith("/retry-stage")) {
    const jobId = rest.slice(0, -"/retry-stage".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "retry-stage",
    };
  }

  if (rest.endsWith("/create-pr")) {
    const jobId = rest.slice(0, -"/create-pr".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "create-pr",
    };
  }

  if (rest.endsWith("/sync")) {
    const jobId = rest.slice(0, -"/sync".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "sync",
    };
  }

  if (rest.endsWith("/stale-check")) {
    const jobId = rest.slice(0, -"/stale-check".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "stale-check",
    };
  }

  if (rest.endsWith("/remap-suggest")) {
    const jobId = rest.slice(0, -"/remap-suggest".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "remap-suggest",
    };
  }

  if (rest.endsWith("/token-intelligence")) {
    const jobId = rest.slice(0, -"/token-intelligence".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "token-intelligence",
    };
  }

  if (rest.endsWith("/token-decisions")) {
    const jobId = rest.slice(0, -"/token-decisions".length);
    if (!jobId || jobId.includes("/")) {
      return undefined;
    }
    return {
      jobId,
      action: "token-decisions",
    };
  }

  if (rest.includes("/")) {
    return undefined;
  }

  return {
    jobId: rest,
    action: "status",
  };
}

export function parseJobFilesRoute(
  pathname: string,
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

export function parseJobPreviewRoute(
  pathname: string,
): { jobId: string; previewPath: string } | undefined {
  if (!pathname.startsWith(JOB_ROUTE_PREFIX)) {
    return undefined;
  }

  const rest = pathname.slice(JOB_ROUTE_PREFIX.length);
  if (!rest) {
    return undefined;
  }

  const previewSegment = "/preview";
  const previewSegmentIndex = rest.indexOf(previewSegment);
  if (previewSegmentIndex === -1) {
    return undefined;
  }

  const jobId = rest.slice(0, previewSegmentIndex);
  if (!jobId || jobId.includes("/")) {
    return undefined;
  }

  const afterPreview = rest.slice(previewSegmentIndex + previewSegment.length);
  if (afterPreview.length === 0 || afterPreview === "/") {
    return { jobId, previewPath: "index.html" };
  }

  if (!afterPreview.startsWith("/")) {
    return undefined;
  }

  const previewPath = afterPreview.slice(1);
  return {
    jobId,
    previewPath: previewPath || "index.html",
  };
}

/** Allowed extensions for generated source file serving. */
const ALLOWED_FILE_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".json",
  ".css",
  ".html",
  ".svg",
]);

/** Blocked directory prefixes that must never be served. */
const BLOCKED_PATH_PREFIXES = ["node_modules/", "dist/", ".env"];

export function validateSourceFilePath(
  filePath: string,
): { valid: true; normalizedPath: string } | { valid: false; reason: string } {
  if (filePath.length === 0) {
    return { valid: false, reason: "Empty file path." };
  }

  // Cross-platform normalization: reject Windows absolute/UNC paths and
  // canonicalize backslash separators before any security check.
  const platformResult = normalizePlatformPath(filePath);
  if (!platformResult.ok) {
    return { valid: false, reason: platformResult.reason };
  }
  const normalized = platformResult.normalized;

  // Reject path traversal
  if (normalized.includes("..")) {
    return { valid: false, reason: "Path traversal is not allowed." };
  }

  // Reject null bytes
  if (normalized.includes("\0")) {
    return { valid: false, reason: "Null bytes in path are not allowed." };
  }

  // Reject blocked prefixes
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (normalized === blocked || normalized.startsWith(blocked)) {
      return { valid: false, reason: `Access to '${blocked}' is forbidden.` };
    }
    // Also block when nested (e.g. "src/node_modules/...")
    if (normalized.includes(`/${blocked}`)) {
      return { valid: false, reason: `Access to '${blocked}' is forbidden.` };
    }
  }

  // Reject files not in the allowlist
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex === -1) {
    return { valid: false, reason: "File extension required." };
  }
  const ext = normalized.slice(dotIndex);
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `Extension '${ext}' is not allowed.` };
  }

  return { valid: true, normalizedPath: normalized };
}

export function parseReproRoute(
  pathname: string,
): { jobId: string; previewPath: string } | undefined {
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
      previewPath: "index.html",
    };
  }

  const jobId = rest.slice(0, firstSlash);
  const previewPath = rest.slice(firstSlash + 1);
  if (!jobId) {
    return undefined;
  }

  return {
    jobId,
    previewPath: previewPath || "index.html",
  };
}
