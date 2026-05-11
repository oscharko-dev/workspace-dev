import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Scenario =
  | { kind: "ok" }
  | {
      kind: "rate-limit";
      /** Seconds to report in the `Retry-After` response header (default: 1). */
      retryAfterSeconds?: number;
      /**
       * Number of consecutive requests to fail before reverting to `ok`.
       * If omitted, every request is rate-limited.
       */
      failTimes?: number;
    }
  | {
      kind: "server-error";
      /**
       * Number of consecutive requests to fail before reverting to `ok`.
       * If omitted, every request returns 500.
       */
      failTimes?: number;
    }
  | {
      kind: "slow";
      /** Milliseconds to wait before writing the ok payload (default: 250). */
      delayMs?: number;
    }
  | { kind: "partial" }
  | {
      kind: "mcp-error-envelope";
      /** Error message reported in the MCP `{error:{message}}` envelope. */
      message?: string;
      failTimes?: number;
    }
  | { kind: "auth-error"; status?: 401 | 403 }
  | { kind: "not-found" }
  | { kind: "invalid-request" };

export interface MockMcpServer {
  readonly url: string;
  close(): Promise<void>;
  setScenario(tool: string, scenario: Scenario): void;
  reset(): void;
}

export interface StartMockMcpServerOptions {
  port?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SUPPORTED_TOOLS = new Set([
  "get_design_context",
  "get_metadata",
  "get_screenshot",
  "get_variable_defs",
  "search_design_system",
]);

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/figma-paste-pipeline/mcp",
);

const LOOPBACK_HOST = "127.0.0.1";

interface ToolState {
  scenario: Scenario;
  consumedFailures: number;
}

interface McpRequestBody {
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const readFixture = async (relativePath: string): Promise<string> =>
  readFile(path.join(FIXTURE_ROOT, relativePath), "utf8");

const getOkPayload = async (toolName: string): Promise<unknown> => {
  switch (toolName) {
    case "get_design_context":
      return JSON.parse(await readFixture("design-context-success.json"));
    case "get_metadata":
      return { xml: (await readFixture("metadata-small.xml")).trim() };
    case "get_screenshot":
      return JSON.parse(await readFixture("screenshot-success.json"));
    case "get_variable_defs":
      return JSON.parse(await readFixture("variable-defs-success.json"));
    case "search_design_system":
      return JSON.parse(await readFixture("search-design-system-success.json"));
    default:
      throw new Error(`Unknown tool '${toolName}' has no fixture`);
  }
};

// ---------------------------------------------------------------------------
// Request body helpers
// ---------------------------------------------------------------------------

const readRequestBody = (req: IncomingMessage): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const parseMcpBody = (raw: string): McpRequestBody => {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("request body is not an object");
  }
  return parsed as McpRequestBody;
};

// ---------------------------------------------------------------------------
// Response writers
// ---------------------------------------------------------------------------

const writeJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString(),
    ...extraHeaders,
  });
  res.end(payload);
};

const writePartialAndDestroy = (res: ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write('{"result":{"code":"partial');
  res.socket?.destroy();
};

const isHostAllowed = (hostHeader: string | undefined): boolean => {
  if (!hostHeader) {
    return false;
  }
  const host = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  return host === LOOPBACK_HOST;
};

// ---------------------------------------------------------------------------
// Scenario execution
// ---------------------------------------------------------------------------

const shouldApplyFailure = (state: ToolState): boolean => {
  const { scenario } = state;
  if ("failTimes" in scenario && typeof scenario.failTimes === "number") {
    if (state.consumedFailures >= scenario.failTimes) {
      return false;
    }
    state.consumedFailures += 1;
    return true;
  }
  return true;
};

const executeScenario = async (
  res: ServerResponse,
  state: ToolState,
  toolName: string,
  signal: AbortSignal,
): Promise<void> => {
  const { scenario } = state;
  switch (scenario.kind) {
    case "ok": {
      const result = await getOkPayload(toolName);
      writeJson(res, 200, { result });
      return;
    }
    case "rate-limit": {
      if (!shouldApplyFailure(state)) {
        const result = await getOkPayload(toolName);
        writeJson(res, 200, { result });
        return;
      }
      const retryAfterSeconds = scenario.retryAfterSeconds ?? 1;
      writeJson(
        res,
        429,
        { error: { message: "rate limited", code: 429 } },
        { "Retry-After": String(retryAfterSeconds) },
      );
      return;
    }
    case "server-error": {
      if (!shouldApplyFailure(state)) {
        const result = await getOkPayload(toolName);
        writeJson(res, 200, { result });
        return;
      }
      writeJson(res, 500, {
        error: { message: "internal failure", code: 500 },
      });
      return;
    }
    case "slow": {
      const delayMs = scenario.delayMs ?? 250;
      await waitOrAbort(delayMs, signal);
      if (signal.aborted) {
        // Client closed the socket before the delay elapsed; nothing to send.
        return;
      }
      const result = await getOkPayload(toolName);
      writeJson(res, 200, { result });
      return;
    }
    case "partial": {
      writePartialAndDestroy(res);
      return;
    }
    case "mcp-error-envelope": {
      if (!shouldApplyFailure(state)) {
        const result = await getOkPayload(toolName);
        writeJson(res, 200, { result });
        return;
      }
      writeJson(res, 200, {
        error: { message: scenario.message ?? "tool failed", code: 500 },
      });
      return;
    }
    case "auth-error": {
      const status = scenario.status ?? 401;
      writeJson(res, status, {
        error: { message: "unauthorized", code: status },
      });
      return;
    }
    case "not-found": {
      writeJson(res, 404, { error: { message: "not found", code: 404 } });
      return;
    }
    case "invalid-request": {
      writeJson(res, 400, { error: { message: "invalid request", code: 400 } });
      return;
    }
  }
};

const waitOrAbort = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  states: Map<string, ToolState>,
): Promise<void> => {
  if (!isHostAllowed(req.headers.host)) {
    writeJson(res, 403, { error: { message: "forbidden host", code: 403 } });
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, {
      error: { message: "method not allowed", code: 405 },
    });
    return;
  }

  let body: McpRequestBody;
  try {
    const raw = await readRequestBody(req);
    body = parseMcpBody(raw);
  } catch {
    writeJson(res, 400, {
      error: { message: "invalid JSON body", code: 400 },
    });
    return;
  }

  const toolName = body.params?.name;
  if (typeof toolName !== "string" || toolName.length === 0) {
    writeJson(res, 400, {
      error: { message: "missing params.name", code: 400 },
    });
    return;
  }

  if (!SUPPORTED_TOOLS.has(toolName)) {
    writeJson(res, 404, {
      error: { message: `unknown tool '${toolName}'`, code: 404 },
    });
    return;
  }

  const state = states.get(toolName) ?? {
    scenario: { kind: "ok" },
    consumedFailures: 0,
  };
  states.set(toolName, state);

  const abortController = new AbortController();
  const onClose = (): void => {
    abortController.abort();
  };
  req.on("close", onClose);
  try {
    await executeScenario(res, state, toolName, abortController.signal);
  } finally {
    req.off("close", onClose);
  }
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export const startMockMcpServer = async (
  options: StartMockMcpServerOptions = {},
): Promise<MockMcpServer> => {
  const states = new Map<string, ToolState>();

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, states).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        writeJson(res, 500, {
          error: {
            message: `mock server internal error: ${message}`,
            code: 500,
          },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  // Close idle connections on shutdown so `close()` resolves promptly.
  server.on("connection", (socket) => {
    socket.unref();
    socket.on("close", () => {
      socket.ref();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, LOOPBACK_HOST);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock MCP server failed to bind to a TCP address");
  }
  const url = `http://${LOOPBACK_HOST}:${String(address.port)}/mcp`;

  let closed = false;
  const close = (): Promise<void> => {
    if (closed) {
      return Promise.resolve();
    }
    closed = true;
    return new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
  };

  if (options.signal) {
    if (options.signal.aborted) {
      await close();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          void close();
        },
        { once: true },
      );
    }
  }

  return {
    url,
    close,
    setScenario(tool, scenario) {
      if (!SUPPORTED_TOOLS.has(tool)) {
        throw new Error(`cannot set scenario for unsupported tool '${tool}'`);
      }
      states.set(tool, { scenario, consumedFailures: 0 });
    },
    reset() {
      states.clear();
    },
  };
};
