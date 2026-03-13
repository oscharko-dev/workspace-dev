import { JOB_ROUTE_PREFIX, REPRO_ROUTE_PREFIX, UI_ROUTE_PREFIX, type UiAssetName } from "./constants.js";

export function resolveUiAssetName(pathname: string): UiAssetName | null {
  if (pathname === UI_ROUTE_PREFIX || pathname === `${UI_ROUTE_PREFIX}/`) {
    return "index.html";
  }

  if (!pathname.startsWith(`${UI_ROUTE_PREFIX}/`)) {
    return null;
  }

  const requestedAsset = pathname.slice(`${UI_ROUTE_PREFIX}/`.length);
  if (requestedAsset === "app.css" || requestedAsset === "app.js") {
    return requestedAsset;
  }

  return null;
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

export function parseJobRoute(pathname: string): { jobId: string; resultOnly: boolean } | undefined {
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
      resultOnly: true
    };
  }

  if (rest.includes("/")) {
    return undefined;
  }

  return {
    jobId: rest,
    resultOnly: false
  };
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
