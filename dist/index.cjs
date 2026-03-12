"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  CONTRACT_VERSION: () => CONTRACT_VERSION,
  createProjectInstance: () => createProjectInstance,
  createWorkspaceServer: () => createWorkspaceServer,
  enforceModeLock: () => enforceModeLock,
  getProjectInstance: () => getProjectInstance,
  getWorkspaceDefaults: () => getWorkspaceDefaults,
  listProjectInstances: () => listProjectInstances,
  removeAllInstances: () => removeAllInstances,
  removeProjectInstance: () => removeProjectInstance,
  validateModeLock: () => validateModeLock
});
module.exports = __toCommonJS(src_exports);

// src/contracts/index.ts
var CONTRACT_VERSION = "1.0.0";

// src/server.ts
var import_promises = require("fs/promises");
var import_node_http = require("http");
var import_node_path = __toESM(require("path"), 1);
var import_node_url = require("url");

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
function pushIssue(issues, path3, message) {
  issues.push({ path: path3, message });
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
var import_meta = {};
var MODULE_DIR = typeof __dirname === "string" ? __dirname : import_node_path.default.dirname((0, import_node_url.fileURLToPath)(import_meta.url));
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
    await (0, import_promises.access)(filePath);
    return true;
  } catch {
    return false;
  }
}
async function resolveUiSourceDir() {
  const candidates = [import_node_path.default.resolve(MODULE_DIR, "ui"), import_node_path.default.resolve(MODULE_DIR, "../ui-src")];
  for (const candidate of candidates) {
    if (await fileExists(import_node_path.default.join(candidate, "index.html"))) {
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
    const assetPath = import_node_path.default.join(sourceDir, assetDefinition.name);
    const content = await (0, import_promises.readFile)(assetPath, "utf8");
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
  const server = (0, import_node_http.createServer)((request, response) => {
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

// src/isolation.ts
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_node_module = require("module");
var import_node_path2 = __toESM(require("path"), 1);
var PACKAGE_NAME = "workspace-dev";
var resolvePackageRoot = () => {
  const fromCwdRequire = (0, import_node_module.createRequire)(import_node_path2.default.resolve(process.cwd(), "__workspace-dev-resolver__.cjs"));
  const candidateSpecifiers = [`${PACKAGE_NAME}/package.json`, "./package.json"];
  for (const specifier of candidateSpecifiers) {
    try {
      const resolved = fromCwdRequire.resolve(specifier);
      return import_node_path2.default.dirname(resolved);
    } catch {
    }
  }
  return process.cwd();
};
var packageRoot = resolvePackageRoot();
var activeInstances = /* @__PURE__ */ new Map();
var toPublicInstance = (instance) => ({
  instanceId: instance.instanceId,
  projectKey: instance.projectKey,
  workDir: instance.workDir,
  host: instance.host,
  port: instance.port,
  createdAt: instance.createdAt
});
var cleanupRegistered = false;
var registerParentCleanup = () => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const killAll = () => {
    for (const [key, inst] of activeInstances) {
      try {
        inst.process.kill("SIGTERM");
      } catch {
      }
      activeInstances.delete(key);
    }
  };
  process.on("exit", killAll);
  process.on("SIGINT", () => {
    killAll();
    process.exit(128 + 2);
  });
  process.on("SIGTERM", () => {
    killAll();
    process.exit(128 + 15);
  });
  process.on("uncaughtException", (err) => {
    console.error("[isolation] uncaughtException \u2014 cleaning up instances", err);
    killAll();
    process.exit(1);
  });
};
var resolveTsExecArgv = () => {
  const args = [...process.execArgv];
  const hasTsxImport = args.some((arg, index) => arg === "--import" && args[index + 1] === "tsx");
  if (!hasTsxImport) {
    args.push("--import", "tsx");
  }
  return args;
};
var resolveEntryPoint = () => {
  const jsPath = import_node_path2.default.join(packageRoot, "dist", "isolated-server-entry.js");
  if ((0, import_node_fs.existsSync)(jsPath)) {
    return { path: jsPath, execArgv: [] };
  }
  const tsPath = import_node_path2.default.join(packageRoot, "src", "isolated-server-entry.ts");
  if ((0, import_node_fs.existsSync)(tsPath)) {
    return { path: tsPath, execArgv: resolveTsExecArgv() };
  }
  throw new Error(
    "Unable to resolve isolated-server entrypoint. Expected dist/isolated-server-entry.js or src/isolated-server-entry.ts."
  );
};
var createProjectInstance = async (projectKey, options = {}) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) {
    throw new Error(`Invalid projectKey '${projectKey}'. Only alphanumeric, dashes, and underscores are permitted.`);
  }
  if (activeInstances.has(projectKey)) {
    throw new Error(`Instance for project '${projectKey}' already exists. Remove it first.`);
  }
  registerParentCleanup();
  const baseDir = options.workDir ?? process.cwd();
  const workDir = import_node_path2.default.join(baseDir, ".figmapipe", projectKey);
  await (0, import_promises2.mkdir)(workDir, { recursive: true });
  const host = options.host ?? "127.0.0.1";
  const entryPoint = resolveEntryPoint();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Instance for '${projectKey}' timed out during startup (10s).`));
    }, 1e4);
    const child = (0, import_node_child_process.fork)(entryPoint.path, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: entryPoint.execArgv,
      env: { ...process.env, NODE_ENV: "production" }
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      activeInstances.delete(projectKey);
      reject(new Error(`Failed to fork instance for '${projectKey}': ${err.message}`));
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      activeInstances.delete(projectKey);
      void (0, import_promises2.rm)(workDir, { recursive: true, force: true }).catch(() => {
      });
    });
    child.on("message", (msg) => {
      const message = msg;
      if (message.type === "awaiting_config") {
        child.send({
          type: "start",
          config: {
            host,
            workDir,
            targetPath: options.targetPath ?? "figma-generated"
          }
        });
      } else if (message.type === "ready") {
        clearTimeout(timeout);
        const instance = {
          instanceId: message.instanceId,
          projectKey,
          workDir,
          host,
          port: message.port,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          process: child
        };
        activeInstances.set(projectKey, instance);
        resolve(toPublicInstance(instance));
      } else if (message.type === "error") {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        const errorMessage = typeof message.message === "string" ? message.message : "unknown startup error";
        reject(new Error(`Instance for '${projectKey}' failed: ${errorMessage}`));
      }
    });
  });
};
var getProjectInstance = (projectKey) => {
  const inst = activeInstances.get(projectKey);
  if (!inst) return void 0;
  return toPublicInstance(inst);
};
var removeProjectInstance = async (projectKey) => {
  const inst = activeInstances.get(projectKey);
  if (!inst) return false;
  try {
    inst.process.send({ type: "shutdown" });
  } catch {
  }
  await new Promise((resolve) => {
    const forceKillTimeout = setTimeout(() => {
      try {
        inst.process.kill("SIGKILL");
      } catch {
      }
      resolve();
    }, 3e3);
    inst.process.on("exit", () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });
  });
  activeInstances.delete(projectKey);
  try {
    await (0, import_promises2.rm)(inst.workDir, { recursive: true, force: true });
  } catch {
  }
  return true;
};
var listProjectInstances = () => {
  const result = /* @__PURE__ */ new Map();
  for (const [key, inst] of activeInstances) {
    result.set(key, toPublicInstance(inst));
  }
  return result;
};
var removeAllInstances = async () => {
  const keys = [...activeInstances.keys()];
  await Promise.all(keys.map((k) => removeProjectInstance(k)));
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CONTRACT_VERSION,
  createProjectInstance,
  createWorkspaceServer,
  enforceModeLock,
  getProjectInstance,
  getWorkspaceDefaults,
  listProjectInstances,
  removeAllInstances,
  removeProjectInstance,
  validateModeLock
});
//# sourceMappingURL=index.cjs.map