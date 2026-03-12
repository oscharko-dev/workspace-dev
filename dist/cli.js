#!/usr/bin/env node

// src/server.ts
import { access, readFile } from "fs/promises";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

// src/error-sanitization.ts
var EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
var PAN_PATTERN = /\b\d{13,19}\b/g;
var SECRET_TOKEN_PATTERN = /\b(?:Bearer|Token|Secret|Api[-_ ]?Key|Password)\s*[:=]?\s*[A-Za-z0-9._-]{8,}\b/gi;
var MAX_MESSAGE_LENGTH = 240;
function redact(input) {
  return input.replace(EMAIL_PATTERN, "[redacted-email]").replace(PAN_PATTERN, "[redacted-pan]").replace(SECRET_TOKEN_PATTERN, "[redacted-secret]");
}
function sanitizeErrorMessage({
  error,
  fallback
}) {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const sanitized = redact(error.message).replace(/\s+/g, " ").trim();
  if (sanitized.length < 1) {
    return fallback;
  }
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    return `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}...`;
  }
  return sanitized;
}

// src/mode-lock.ts
var ALLOWED_FIGMA_SOURCE_MODE = "rest";
var ALLOWED_LLM_CODEGEN_MODE = "deterministic";
var BLOCKED_FIGMA_MODES = ["mcp", "hybrid"];
var BLOCKED_CODEGEN_MODES = ["hybrid", "llm_strict"];
function validateModeLock(input) {
  const errors = [];
  const figmaMode = input.figmaSourceMode?.trim().toLowerCase();
  if (figmaMode && figmaMode !== ALLOWED_FIGMA_SOURCE_MODE) {
    const isKnownBlocked = BLOCKED_FIGMA_MODES.includes(figmaMode);
    if (isKnownBlocked) {
      errors.push(
        `Mode '${figmaMode}' is not available in workspace-dev. Only 'rest' is supported. MCP and hybrid modes require the full FigmaPipe deployment.`
      );
    } else {
      errors.push(
        `Unknown figmaSourceMode '${figmaMode}'. workspace-dev supports only 'rest'.`
      );
    }
  }
  const codegenMode = input.llmCodegenMode?.trim().toLowerCase();
  if (codegenMode && codegenMode !== ALLOWED_LLM_CODEGEN_MODE) {
    const isKnownBlocked = BLOCKED_CODEGEN_MODES.includes(codegenMode);
    if (isKnownBlocked) {
      errors.push(
        `Mode '${codegenMode}' is not available in workspace-dev. Only 'deterministic' is supported. LLM-based codegen modes require the full FigmaPipe deployment.`
      );
    } else {
      errors.push(
        `Unknown llmCodegenMode '${codegenMode}'. workspace-dev supports only 'deterministic'.`
      );
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function enforceModeLock(input) {
  const result = validateModeLock(input);
  if (!result.valid) {
    throw new Error(
      `Mode-lock violation in workspace-dev:
${result.errors.map((entry) => `  \u2022 ${entry}`).join("\n")}`
    );
  }
}
function getWorkspaceDefaults() {
  return {
    figmaSourceMode: ALLOWED_FIGMA_SOURCE_MODE,
    llmCodegenMode: ALLOWED_LLM_CODEGEN_MODE
  };
}

// src/schemas.ts
function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function pushIssue(issues, path2, message) {
  issues.push({ path: path2, message });
}
function parseStringField({
  input,
  key,
  required,
  issues
}) {
  const value = input[key];
  if (value === void 0) {
    if (required) {
      pushIssue(issues, [key], `${key} is required`);
    }
    return void 0;
  }
  if (typeof value !== "string") {
    pushIssue(issues, [key], `${key} must be a string`);
    return void 0;
  }
  if (key === "figmaFileKey" && value.length < 1) {
    pushIssue(issues, [key], "figmaFileKey must not be empty");
    return void 0;
  }
  return value;
}
function parseSubmitRequest(input) {
  const issues = [];
  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "figmaFileKey",
    "figmaSourceMode",
    "llmCodegenMode",
    "projectName"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }
  const figmaFileKey = parseStringField({
    input,
    key: "figmaFileKey",
    required: true,
    issues
  });
  const figmaSourceMode = parseStringField({
    input,
    key: "figmaSourceMode",
    required: false,
    issues
  });
  const llmCodegenMode = parseStringField({
    input,
    key: "llmCodegenMode",
    required: false,
    issues
  });
  const projectName = parseStringField({
    input,
    key: "projectName",
    required: false,
    issues
  });
  if (issues.length > 0 || figmaFileKey === void 0) {
    return { success: false, error: { issues } };
  }
  return {
    success: true,
    data: {
      figmaFileKey,
      figmaSourceMode,
      llmCodegenMode,
      projectName
    }
  };
}
var SubmitRequestSchema = {
  safeParse: parseSubmitRequest
};
function formatZodError(validationError) {
  return {
    error: "VALIDATION_ERROR",
    message: "Request validation failed.",
    issues: validationError.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message
    }))
  };
}

// src/server.ts
var MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 1983;
var MAX_REQUEST_BODY_BYTES = 1048576;
var UI_ROUTE_PREFIX = "/workspace/ui";
var UI_ASSET_DEFINITIONS = [
  { name: "index.html", contentType: "text/html; charset=utf-8" },
  { name: "app.css", contentType: "text/css; charset=utf-8" },
  { name: "app.js", contentType: "application/javascript; charset=utf-8" }
];
var uiAssetsPromise = null;
function sendJson({
  response,
  statusCode,
  payload
}) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}
`);
}
function sendText({
  response,
  statusCode,
  contentType,
  payload
}) {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.end(payload);
}
function resolveUiAssetName(pathname) {
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
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function resolveUiSourceDir() {
  const candidates = [path.resolve(MODULE_DIR, "ui"), path.resolve(MODULE_DIR, "../ui-src")];
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}
async function loadUiAssets() {
  const sourceDir = await resolveUiSourceDir();
  if (!sourceDir) {
    throw new Error("UI assets not found. Expected dist/ui or ui-src to be present.");
  }
  const assets = /* @__PURE__ */ new Map();
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
async function getUiAssets() {
  if (!uiAssetsPromise) {
    uiAssetsPromise = loadUiAssets().catch((error) => {
      uiAssetsPromise = null;
      throw error;
    });
  }
  return await uiAssetsPromise;
}
async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, error: "Request body exceeds 1 MiB size limit." };
    }
  }
  if (body.trim().length === 0) {
    return { ok: true, value: void 0 };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, error: "Invalid JSON payload." };
  }
}
function toAddressList(server) {
  const resolved = server.address();
  if (resolved === null) {
    return [];
  }
  const addressInfo = resolved;
  return [{ address: addressInfo.address, family: addressInfo.family, port: addressInfo.port }];
}
async function closeServer(server) {
  await new Promise((resolve, reject) => {
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
}) {
  const method = request.method.toUpperCase();
  const headerEntries = Object.entries(request.headers ?? {});
  const headers = {};
  for (const [key, value] of headerEntries) {
    headers[key.toLowerCase()] = value;
  }
  let body;
  if (request.payload !== void 0 && method !== "GET" && method !== "HEAD") {
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
}) {
  return {
    close: async () => {
      await closeServer(server);
    },
    inject: async (request) => {
      const { url, init } = resolveInjectRequest({ request, host, port });
      const response = await fetch(url, init);
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      return {
        statusCode: response.status,
        body,
        headers,
        json: () => JSON.parse(body)
      };
    },
    addresses: () => toAddressList(server)
  };
}
var createWorkspaceServer = async (options = {}) => {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const startedAt = Date.now();
  const defaults = getWorkspaceDefaults();
  let resolvedPort = port;
  const handleRequest = async (request, response) => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", "http://workspace-dev.local");
    const pathname = requestUrl.pathname;
    const uiAssetName = method === "GET" ? resolveUiAssetName(pathname) : null;
    if (uiAssetName) {
      try {
        const uiAssets = await getUiAssets();
        const uiAsset = uiAssets.get(uiAssetName);
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
          payload: uiAsset.content
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
    if (method === "GET" && pathname === "/workspace") {
      const status = {
        running: true,
        url: `http://${host}:${resolvedPort}`,
        host,
        port: resolvedPort,
        figmaSourceMode: defaults.figmaSourceMode,
        llmCodegenMode: defaults.llmCodegenMode,
        uptimeMs: Date.now() - startedAt
      };
      sendJson({ response, statusCode: 200, payload: status });
      return;
    }
    if (method === "GET" && pathname === "/healthz") {
      sendJson({ response, statusCode: 200, payload: { ok: true, service: "workspace-dev" } });
      return;
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
      const { figmaFileKey, figmaSourceMode, llmCodegenMode } = parsed.data;
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
      sendJson({
        response,
        statusCode: 501,
        payload: {
          error: "SUBMIT_NOT_IMPLEMENTED",
          status: "not_implemented",
          message: "workspace-dev validates mode-locked submission requests but does not execute Figma fetch, code generation, or filesystem output.",
          allowedModes: defaults,
          figmaFileKey
        }
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
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  } catch (error) {
    const isAddrInUse = error instanceof Error && "code" in error && error.code === "EADDRINUSE";
    if (isAddrInUse) {
      throw new Error(
        `Port ${port} is already in use. Another instance of workspace-dev (or figmapipe-workspace-dev) or another service may be running on this port. Use FIGMAPIPE_WORKSPACE_PORT to configure an alternative port.`
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

// src/cli.ts
var DEFAULT_PORT2 = 1983;
var DEFAULT_HOST2 = "127.0.0.1";
var parseArgs = (argv) => {
  const args = argv.slice(2);
  const command = args[0] ?? "start";
  let port = DEFAULT_PORT2;
  let host = DEFAULT_HOST2;
  const envPort = process.env.FIGMAPIPE_WORKSPACE_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      port = parsed;
    }
  }
  const envHost = process.env.FIGMAPIPE_WORKSPACE_HOST;
  if (envHost?.trim()) {
    host = envHost.trim();
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        port = parsed;
        i++;
      }
    }
    if (args[i] === "--host" && args[i + 1]) {
      host = args[i + 1].trim();
      i++;
    }
  }
  return { command, port, host };
};
var printHelp = () => {
  console.log(`
workspace-dev - Local workspace status and validation server

Usage:
  workspace-dev start [options]
  workspace-dev --help

Alias:
  figmapipe-workspace-dev start [options]

Options:
  --port <port>    Port to listen on (default: ${DEFAULT_PORT2})
  --host <host>    Host to bind to (default: ${DEFAULT_HOST2})
  --help           Show this help message

Environment variables:
  FIGMAPIPE_WORKSPACE_PORT    Override default port
  FIGMAPIPE_WORKSPACE_HOST    Override default host

Capabilities:
  - GET /workspace          Server status (mode info, uptime)
  - GET /workspace/ui       Storybook-inspired local UI shell
  - GET /healthz            Health check probe
  - POST /workspace/submit  Mode-locked request validation (execution not implemented)

Note:
  This server validates requests but does not execute Figma fetch,
  code generation, or filesystem output.

Examples:
  workspace-dev start
  workspace-dev start --port 3000
  FIGMAPIPE_WORKSPACE_PORT=8080 workspace-dev start
`);
};
var main = async () => {
  const { command, port, host } = parseArgs(process.argv);
  if (command === "--help" || command === "help") {
    printHelp();
    process.exit(0);
  }
  if (command !== "start") {
    console.error(`Unknown command: ${command}`);
    console.error('Use "workspace-dev start" to start the server.');
    console.error('Use "workspace-dev --help" for usage information.');
    process.exit(1);
  }
  console.log(`[workspace-dev] Starting on http://${host}:${port}/workspace`);
  console.log("[workspace-dev] Mode: figmaSourceMode=rest, llmCodegenMode=deterministic");
  try {
    const server = await createWorkspaceServer({ host, port });
    const shutdown = async (signal) => {
      console.log(`
[workspace-dev] Received ${signal}, shutting down...`);
      await server.app.close();
      process.exit(0);
    };
    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    console.log(`[workspace-dev] Server ready at ${server.url}/workspace`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workspace-dev] Failed to start: ${message}`);
    process.exit(1);
  }
};
void main();
//# sourceMappingURL=cli.js.map