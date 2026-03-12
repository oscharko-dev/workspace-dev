/**
 * Workspace-dev HTTP server.
 *
 * Provides a local UI shell (`/workspace/ui` and `/workspace/:figmaFileKey`),
 * runtime status (`/workspace`), job submission and polling endpoints,
 * and integrated preview serving from local generated artifacts.
 *
 * All execution stays in-process and local:
 * - Figma source via REST only
 * - deterministic code generation only
 * - no FigmaPipe API/backend dependencies
 */

import { access, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceStartOptions, WorkspaceStatus } from "./contracts/index.js";
import { sanitizeErrorMessage } from "./error-sanitization.js";
import { createJobEngine, resolveRuntimeSettings } from "./job-engine.js";
import { enforceModeLock, getWorkspaceDefaults } from "./mode-lock.js";
import { SubmitRequestSchema, formatZodError } from "./schemas.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 1983;
const DEFAULT_OUTPUT_ROOT = ".workspace-dev";
const MAX_REQUEST_BODY_BYTES = 1_048_576;
const UI_ROUTE_PREFIX = "/workspace/ui";
const JOB_ROUTE_PREFIX = "/workspace/jobs/";
const REPRO_ROUTE_PREFIX = "/workspace/repros/";

type UiAssetName = "index.html" | "app.css" | "app.js";

interface UiAsset {
  contentType: string;
  content: string;
}

const UI_ASSET_DEFINITIONS: Array<{ name: UiAssetName; contentType: string }> = [
  { name: "index.html", contentType: "text/html; charset=utf-8" },
  { name: "app.css", contentType: "text/css; charset=utf-8" },
  { name: "app.js", contentType: "application/javascript; charset=utf-8" }
];

let uiAssetsPromise: Promise<Map<UiAssetName, UiAsset>> | null = null;

interface InjectResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json: <T = unknown>() => T;
}

interface InjectRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}

type InjectBody = string | Uint8Array | undefined;

interface WorkspaceServerApp {
  close: () => Promise<void>;
  inject: (request: InjectRequest) => Promise<InjectResponse>;
  addresses: () => Array<{ address: string; family: string; port: number }>;
}

export interface WorkspaceServer {
  app: WorkspaceServerApp;
  url: string;
  host: string;
  port: number;
  startedAt: number;
}

function sendJson({
  response,
  statusCode,
  payload
}: {
  response: ServerResponse;
  statusCode: number;
  payload: unknown;
}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: string;
  cacheControl?: string;
}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  if (cacheControl) {
    response.setHeader("cache-control", cacheControl);
  }
  response.end(payload);
}

function sendBuffer({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: Buffer;
  cacheControl?: string;
}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  if (cacheControl) {
    response.setHeader("cache-control", cacheControl);
  }
  response.end(payload);
}

function resolveUiAssetName(pathname: string): UiAssetName | null {
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

function isWorkspaceProjectRoute(pathname: string): boolean {
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

function parseJobRoute(pathname: string): { jobId: string; resultOnly: boolean } | undefined {
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

function parseReproRoute(pathname: string): { jobId: string; previewPath: string } | undefined {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUiSourceDir(): Promise<string | null> {
  const candidates = [path.resolve(MODULE_DIR, "ui"), path.resolve(MODULE_DIR, "../ui-src")];
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

async function loadUiAssets(): Promise<Map<UiAssetName, UiAsset>> {
  const sourceDir = await resolveUiSourceDir();
  if (!sourceDir) {
    throw new Error("UI assets not found. Expected dist/ui or ui-src to be present.");
  }

  const assets = new Map<UiAssetName, UiAsset>();
  for (const assetDefinition of UI_ASSET_DEFINITIONS) {
    const assetPath = path.join(sourceDir, assetDefinition.name);
    const content = await readFile(assetPath, "utf8");
    assets.set(assetDefinition.name, {
      contentType: assetDefinition.contentType,
      content
    });
  }

  return assets;
}

async function getUiAssets(): Promise<Map<UiAssetName, UiAsset>> {
  if (!uiAssetsPromise) {
    uiAssetsPromise = loadUiAssets().catch((error) => {
      uiAssetsPromise = null;
      throw error;
    });
  }

  return await uiAssetsPromise;
}

async function readJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, error: "Request body exceeds 1 MiB size limit." };
    }
  }

  if (body.trim().length === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, error: "Invalid JSON payload." };
  }
}

function toAddressList(server: Server): Array<{ address: string; family: string; port: number }> {
  const resolved = server.address();
  if (resolved === null) {
    return [];
  }

  const addressInfo = resolved as Exclude<typeof resolved, null | string>;
  return [{ address: addressInfo.address, family: addressInfo.family, port: addressInfo.port }];
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveInjectRequest({
  request,
  host,
  port
}: {
  request: InjectRequest;
  host: string;
  port: number;
}): { url: URL; init: RequestInit } {
  const method = request.method.toUpperCase();
  const headerEntries = Object.entries(request.headers ?? {});
  const headers: Record<string, string> = {};
  for (const [key, value] of headerEntries) {
    headers[key.toLowerCase()] = value;
  }

  let body: InjectBody;
  if (request.payload !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof request.payload === "string" || request.payload instanceof Uint8Array) {
      body = request.payload;
    } else {
      body = JSON.stringify(request.payload);
      headers["content-type"] = "application/json";
    }
  }

  return {
    url: new URL(request.url, `http://${host}:${port}`),
    init: { method, headers, body }
  };
}

function buildApp({
  server,
  host,
  port
}: {
  server: Server;
  host: string;
  port: number;
}): WorkspaceServerApp {
  return {
    close: async () => {
      await closeServer(server);
    },
    inject: async (request: InjectRequest) => {
      const { url, init } = resolveInjectRequest({ request, host, port });
      const response = await fetch(url, init);
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      return {
        statusCode: response.status,
        body,
        headers,
        json: <T = unknown>(): T => JSON.parse(body) as T
      };
    },
    addresses: () => toAddressList(server)
  };
}

export const createWorkspaceServer = async (options: WorkspaceStartOptions = {}): Promise<WorkspaceServer> => {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const workDir = options.workDir ?? process.cwd();
  const outputRoot =
    typeof options.outputRoot === "string" && options.outputRoot.trim().length > 0
      ? options.outputRoot
      : DEFAULT_OUTPUT_ROOT;
  const absoluteOutputRoot = path.isAbsolute(outputRoot)
    ? path.normalize(outputRoot)
    : path.resolve(workDir, outputRoot);

  const startedAt = Date.now();
  const defaults = getWorkspaceDefaults();
  const runtime = resolveRuntimeSettings({
    figmaRequestTimeoutMs: options.figmaRequestTimeoutMs,
    figmaMaxRetries: options.figmaMaxRetries,
    enablePreview: options.enablePreview,
    fetchImpl: options.fetchImpl
  });

  let resolvedPort = port;
  const jobEngine = createJobEngine({
    resolveBaseUrl: () => `http://${host}:${resolvedPort}`,
    paths: {
      outputRoot: absoluteOutputRoot,
      jobsRoot: path.join(absoluteOutputRoot, "jobs"),
      reprosRoot: path.join(absoluteOutputRoot, "repros")
    },
    runtime
  });

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", "http://workspace-dev.local");
    const pathname = requestUrl.pathname;

    if (method === "GET" && pathname === "/workspace") {
      const status: WorkspaceStatus = {
        running: true,
        url: `http://${host}:${resolvedPort}`,
        host,
        port: resolvedPort,
        figmaSourceMode: defaults.figmaSourceMode,
        llmCodegenMode: defaults.llmCodegenMode,
        uptimeMs: Date.now() - startedAt,
        outputRoot: absoluteOutputRoot,
        previewEnabled: runtime.previewEnabled
      };
      sendJson({ response, statusCode: 200, payload: status });
      return;
    }

    if (method === "GET" && pathname === "/healthz") {
      sendJson({ response, statusCode: 200, payload: { ok: true, service: "workspace-dev" } });
      return;
    }

    if (method === "GET") {
      const parsedJobRoute = parseJobRoute(pathname);
      if (parsedJobRoute) {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        if (parsedJobRoute.resultOnly) {
          const jobResult = jobEngine.getJobResult(jobId);
          if (!jobResult) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`
              }
            });
            return;
          }
          sendJson({ response, statusCode: 200, payload: jobResult });
          return;
        }

        const job = jobEngine.getJob(jobId);
        if (!job) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "JOB_NOT_FOUND",
              message: `Unknown job '${jobId}'.`
            }
          });
          return;
        }

        sendJson({ response, statusCode: 200, payload: job });
        return;
      }

      const parsedReproRoute = parseReproRoute(pathname);
      if (parsedReproRoute) {
        const previewAsset = await jobEngine.resolvePreviewAsset(
          decodeURIComponent(parsedReproRoute.jobId),
          decodeURIComponent(parsedReproRoute.previewPath)
        );

        if (!previewAsset) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "PREVIEW_NOT_FOUND",
              message: `No preview artifact found for '${parsedReproRoute.jobId}'.`
            }
          });
          return;
        }

        sendBuffer({
          response,
          statusCode: 200,
          contentType: previewAsset.contentType,
          payload: previewAsset.content,
          cacheControl: "no-store, no-cache, must-revalidate, max-age=0"
        });
        return;
      }

      const uiAssetName = resolveUiAssetName(pathname);
      const shouldServeWorkspaceAlias = isWorkspaceProjectRoute(pathname);
      if (uiAssetName || shouldServeWorkspaceAlias) {
        try {
          const uiAssets = await getUiAssets();
          const uiAsset = uiAssets.get(uiAssetName ?? "index.html");
          if (!uiAsset) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "NOT_FOUND",
                message: `Unknown route: ${method} ${pathname}`
              }
            });
            return;
          }

          sendText({
            response,
            statusCode: 200,
            contentType: uiAsset.contentType,
            payload: uiAsset.content,
            cacheControl: "no-store, no-cache, must-revalidate, max-age=0"
          });
          return;
        } catch {
          sendJson({
            response,
            statusCode: 503,
            payload: {
              error: "UI_ASSETS_UNAVAILABLE",
              message: "workspace-dev UI assets are not available in this runtime."
            }
          });
          return;
        }
      }
    }

    if (method === "POST" && pathname === "/workspace/submit") {
      const rawBody = await readJsonBody(request);
      if (!rawBody.ok) {
        sendJson({
          response,
          statusCode: 400,
          payload: {
            error: "VALIDATION_ERROR",
            message: "Request validation failed.",
            issues: [{ path: "(root)", message: rawBody.error }]
          }
        });
        return;
      }

      const parsed = SubmitRequestSchema.safeParse(rawBody.value);
      if (!parsed.success) {
        sendJson({ response, statusCode: 400, payload: formatZodError(parsed.error) });
        return;
      }

      const { figmaSourceMode, llmCodegenMode } = parsed.data;

      try {
        enforceModeLock({ figmaSourceMode, llmCodegenMode });
      } catch (error) {
        sendJson({
          response,
          statusCode: 400,
          payload: {
            error: "MODE_LOCK_VIOLATION",
            message: sanitizeErrorMessage({
              error,
              fallback: "Mode validation failed"
            }),
            allowedModes: {
              figmaSourceMode: defaults.figmaSourceMode,
              llmCodegenMode: defaults.llmCodegenMode
            }
          }
        });
        return;
      }

      const accepted = jobEngine.submitJob({
        ...parsed.data,
        figmaSourceMode: defaults.figmaSourceMode,
        llmCodegenMode: defaults.llmCodegenMode
      });

      sendJson({
        response,
        statusCode: 202,
        payload: accepted
      });
      return;
    }

    sendJson({
      response,
      statusCode: 404,
      payload: {
        error: "NOT_FOUND",
        message: `Unknown route: ${method} ${pathname}`
      }
    });
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  } catch (error) {
    const isAddrInUse =
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (isAddrInUse) {
      throw new Error(
        `Port ${port} is already in use. ` +
          `Another instance of workspace-dev (or figmapipe-workspace-dev) or another service may be running on this port. ` +
          `Use FIGMAPIPE_WORKSPACE_PORT to configure an alternative port.`
      );
    }
    throw error;
  }

  const addresses = toAddressList(server);
  if (addresses.length > 0) {
    resolvedPort = addresses[0].port;
  }

  const app = buildApp({
    server,
    host,
    port: resolvedPort
  });

  return { app, url: `http://${host}:${resolvedPort}`, host, port: resolvedPort, startedAt };
};
