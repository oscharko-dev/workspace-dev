#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_OUTPUT_PATH = "artifacts/figma/visible-figma.json";
const MAX_ERROR_BODY_CHARS = 500;

const sleep = async (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toRetryDelayMs = (attempt) => {
  const cappedBase = Math.min(8_000, 400 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 200);
  return cappedBase + jitter;
};

const isRecord = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeNodeId = (rawNodeId) => {
  const trimmed = rawNodeId.trim();
  if (/^\d+-\d+$/.test(trimmed)) {
    return trimmed.replace("-", ":");
  }
  return trimmed;
};

const parsePositiveInteger = ({ label, value }) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: '${value}'. Expected a positive integer.`);
  }
  return parsed;
};

const parseCliArgs = (argv) => {
  const options = {
    fileKey: "",
    nodeId: undefined,
    token: process.env.FIGMA_ACCESS_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN_NEW ?? "",
    out: DEFAULT_OUTPUT_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument '${arg}'. Use --help for usage.`);
    }

    const [rawKey, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[i + 1];
    const key = rawKey.slice(2);
    if (nextValue === undefined) {
      throw new Error(`Missing value for option '${rawKey}'.`);
    }

    switch (key) {
      case "fileKey":
        options.fileKey = nextValue.trim();
        break;
      case "nodeId":
        options.nodeId = normalizeNodeId(nextValue);
        break;
      case "token":
        options.token = nextValue.trim();
        break;
      case "out":
        options.out = nextValue.trim();
        break;
      case "timeoutMs":
        options.timeoutMs = parsePositiveInteger({ label: "timeoutMs", value: nextValue });
        break;
      case "maxRetries":
        options.maxRetries = parsePositiveInteger({ label: "maxRetries", value: nextValue });
        break;
      default:
        throw new Error(`Unknown option '--${key}'. Use --help for usage.`);
    }

    if (inlineValue === undefined) {
      i += 1;
    }
  }

  return options;
};

const renderHelpText = () => {
  return [
    "Export visible nodes from Figma to JSON (hidden nodes are removed).",
    "",
    "Usage:",
    "  node scripts/export-visible-figma-json.mjs --fileKey <FIGMA_FILE_KEY> [options]",
    "",
    "Options:",
    "  --fileKey <key>       Required. Figma file key.",
    "  --token <pat>         Figma Personal Access Token.",
    "                        Default: FIGMA_ACCESS_TOKEN or FIGMA_ACCESS_TOKEN_NEW env var",
    "  --nodeId <id>         Optional. Export only one subtree via /files/:key/nodes.",
    "                        Supports 12:34 and 12-34 formats.",
    `  --out <path>          Output path (default: ${DEFAULT_OUTPUT_PATH})`,
    `  --timeoutMs <ms>      Request timeout (default: ${DEFAULT_TIMEOUT_MS})`,
    `  --maxRetries <n>      Retries for transient failures (default: ${DEFAULT_MAX_RETRIES})`,
    "  -h, --help            Show this help",
    "",
    "Examples:",
    "  node scripts/export-visible-figma-json.mjs --fileKey xZkvYk9KOezMsi9LmPEFGX --out artifacts/figma/board-visible.json",
    "  node scripts/export-visible-figma-json.mjs --fileKey xZkvYk9KOezMsi9LmPEFGX --nodeId 1:2 --out artifacts/figma/subtree-visible.json"
  ].join("\n");
};

const isRetryableStatus = (status) => status === 429 || status >= 500;

const readErrorBody = async (response) => {
  try {
    const body = await response.text();
    if (!body) {
      return "";
    }
    return body.slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    return "";
  }
};

const fetchWithAuthFallback = async ({ url, token, timeoutMs }) => {
  const authVariants = [{ "X-Figma-Token": token }, { Authorization: `Bearer ${token}` }];
  let lastResponse = null;

  for (let index = 0; index < authVariants.length; index += 1) {
    const headers = authVariants[index];
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    lastResponse = response;

    if (response.ok) {
      return response;
    }

    const shouldTryNextAuthVariant =
      (response.status === 401 || response.status === 403) && index < authVariants.length - 1;
    if (shouldTryNextAuthVariant) {
      continue;
    }
    return response;
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw new Error("No response received from Figma API.");
};

const fetchFigmaJson = async ({ url, token, timeoutMs, maxRetries }) => {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const response = await fetchWithAuthFallback({ url, token, timeoutMs });
      if (!response.ok) {
        const body = await readErrorBody(response);
        if (isRetryableStatus(response.status) && attempt <= maxRetries) {
          await sleep(toRetryDelayMs(attempt));
          continue;
        }
        throw new Error(
          `Figma request failed (status=${response.status}, attempt=${attempt}): ${body || "no response body"}`
        );
      }

      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt <= maxRetries) {
        await sleep(toRetryDelayMs(attempt));
        continue;
      }
      throw new Error(`Figma request failed after ${attempt} attempts: ${message}`);
    }
  }

  throw new Error("Figma request failed unexpectedly.");
};

const countSubtreeNodes = (node) => {
  if (!isRecord(node)) {
    return 0;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  let count = 1;
  for (const child of children) {
    count += countSubtreeNodes(child);
  }
  return count;
};

const pruneInvisibleNodes = ({ node, metrics }) => {
  if (!isRecord(node)) {
    return null;
  }

  metrics.totalNodes += 1;
  if (node.visible === false) {
    const hiddenSubtreeNodes = countSubtreeNodes(node);
    metrics.hiddenNodes += hiddenSubtreeNodes;
    metrics.totalNodes += hiddenSubtreeNodes - 1;
    return null;
  }

  metrics.exportedNodes += 1;
  const clonedNode = { ...node };
  if (!Array.isArray(node.children)) {
    return clonedNode;
  }

  const nextChildren = [];
  for (const child of node.children) {
    const prunedChild = pruneInvisibleNodes({ node: child, metrics });
    if (prunedChild) {
      nextChildren.push(prunedChild);
    }
  }

  if (nextChildren.length > 0) {
    clonedNode.children = nextChildren;
  } else {
    delete clonedNode.children;
  }
  return clonedNode;
};

const resolveNodeEntry = ({ payload, nodeId }) => {
  if (!isRecord(payload.nodes)) {
    return undefined;
  }

  const direct = payload.nodes[nodeId];
  if (direct !== undefined) {
    return { entry: direct, key: nodeId };
  }

  const alternateId = nodeId.includes(":") ? nodeId.replace(":", "-") : nodeId.replace("-", ":");
  const alternate = payload.nodes[alternateId];
  if (alternate !== undefined) {
    return { entry: alternate, key: alternateId };
  }

  return undefined;
};

const createRequestUrl = ({ fileKey, nodeId }) => {
  const encodedFileKey = encodeURIComponent(fileKey);
  if (nodeId) {
    return `https://api.figma.com/v1/files/${encodedFileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`;
  }
  return `https://api.figma.com/v1/files/${encodedFileKey}?geometry=paths`;
};

const exportVisibleFigmaJson = async ({ fileKey, nodeId, token, timeoutMs, maxRetries, out }) => {
  const requestUrl = createRequestUrl({ fileKey, nodeId });
  const payload = await fetchFigmaJson({ url: requestUrl, token, timeoutMs, maxRetries });
  if (!isRecord(payload)) {
    throw new Error("Unexpected Figma payload: root must be an object.");
  }

  const metrics = {
    totalNodes: 0,
    exportedNodes: 0,
    hiddenNodes: 0
  };

  let outputPayload = payload;
  if (nodeId) {
    const resolved = resolveNodeEntry({ payload, nodeId });
    if (!resolved || !isRecord(resolved.entry) || !isRecord(resolved.entry.document)) {
      throw new Error(`Node '${nodeId}' not found in Figma response.`);
    }

    const prunedDocument = pruneInvisibleNodes({ node: resolved.entry.document, metrics });
    if (!prunedDocument) {
      throw new Error(`Node '${nodeId}' is hidden; exported payload would be empty.`);
    }

    outputPayload = {
      ...payload,
      nodes: {
        ...payload.nodes,
        [resolved.key]: {
          ...resolved.entry,
          document: prunedDocument
        }
      }
    };
  } else {
    if (!isRecord(payload.document)) {
      throw new Error("Unexpected Figma payload: document is missing.");
    }

    const prunedDocument = pruneInvisibleNodes({ node: payload.document, metrics });
    if (!prunedDocument) {
      throw new Error("Figma document root is hidden; exported payload would be empty.");
    }
    outputPayload = {
      ...payload,
      document: prunedDocument
    };
  }

  const outputPath = path.resolve(packageRoot, out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(outputPayload, null, 2)}\n`, "utf8");

  console.log(`[figma-export] Wrote visible JSON to ${outputPath}`);
  console.log(
    `[figma-export] Nodes: total=${metrics.totalNodes}, visible=${metrics.exportedNodes}, hidden-excluded=${metrics.hiddenNodes}`
  );
};

const main = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(renderHelpText());
    return;
  }

  if (!args.fileKey) {
    throw new Error("Missing required option '--fileKey'.");
  }
  if (!args.token) {
    throw new Error(
      "Missing Figma token. Use '--token <PAT>' or set FIGMA_ACCESS_TOKEN / FIGMA_ACCESS_TOKEN_NEW."
    );
  }

  await exportVisibleFigmaJson(args);
};

main().catch((error) => {
  console.error("[figma-export] Failed:", error);
  process.exit(1);
});
