/**
 * Shared mock-server harness used by every vendored TMS mock under
 * `fixtures/tms-adapters/<name>-mock-server/` (Issue #2183, Wave 8).
 *
 * Each per-TMS mock supplies:
 *   - A `routes` table of `(method, pathPattern) => handler`.
 *   - An optional `authPredicate` to assert the bearer token.
 *
 * The harness handles the boilerplate:
 *   - Listening on a random localhost port.
 *   - Reading + JSON-parsing the request body (utf8, 1 MiB cap).
 *   - Writing the response with the supplied status + JSON body.
 *   - Tracking every request for test assertions.
 *
 * Mocks are intentionally minimal: they only cover the surface the
 * adapter exercises in the integration tests. Anything else returns
 * 404. They are NOT a faithful re-implementation of the real TMS.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface MockRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path matcher — supports plain strings and `*` wildcards. */
  pathPattern: string | RegExp;
  handler: MockRouteHandler;
}

export type MockRouteHandler = (input: {
  request: IncomingMessage;
  body: unknown;
  rawBody: Buffer;
  url: URL;
  pathParams: Record<string, string>;
}) => MockResponse | Promise<MockResponse>;

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyBytes?: Uint8Array;
}

export interface MockServerHandle {
  /** `http://127.0.0.1:<port>`. */
  baseUrl: string;
  /** Stop the server and release the port. */
  stop(): Promise<void>;
  /** Captured request log for test assertions. */
  requests: ReadonlyArray<MockRequestRecord>;
  /** Reset the captured request log without stopping the server. */
  clearRequests(): void;
}

export interface MockRequestRecord {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
}

/** Inputs for `startMockServer`. */
export interface StartMockServerInput {
  routes: readonly MockRoute[];
  /**
   * Optional predicate run on every request to enforce bearer auth.
   * Return `false` to short-circuit with 401.
   */
  authPredicate?: (req: IncomingMessage) => boolean;
}

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Start a mock server on a random localhost port. Returns a handle
 * the test can stop in `after()`. The harness is safe to re-use across
 * tests — each call returns a fresh server.
 */
export const startMockServer = async (
  input: StartMockServerInput,
): Promise<MockServerHandle> => {
  const requests: MockRequestRecord[] = [];
  const server: Server = createServer((req, res) => {
    handleRequest({ req, res, routes: input.routes, requests, authPredicate: input.authPredicate });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    requests,
    clearRequests(): void {
      requests.length = 0;
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
};

const handleRequest = async (input: {
  req: IncomingMessage;
  res: ServerResponse;
  routes: readonly MockRoute[];
  requests: MockRequestRecord[];
  authPredicate?: ((req: IncomingMessage) => boolean) | undefined;
}): Promise<void> => {
  const rawBody = await readBodyBytes(input.req);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.req.headers)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
    else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
  }
  let parsedBody: unknown;
  if (rawBody.length > 0) {
    const ct = (input.req.headers["content-type"] ?? "").toString().toLowerCase();
    if (ct.includes("application/json")) {
      try {
        parsedBody = JSON.parse(rawBody.toString("utf8"));
      } catch {
        parsedBody = undefined;
      }
    } else {
      parsedBody = rawBody.toString("utf8");
    }
  }
  const url = new URL(input.req.url ?? "/", `http://127.0.0.1`);
  input.requests.push({
    method: input.req.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    headers,
    body: parsedBody,
    rawBody: rawBody.toString("utf8"),
  });
  if (input.authPredicate !== undefined && !input.authPredicate(input.req)) {
    sendJson(input.res, 401, { message: "auth rejected" });
    return;
  }
  const matched = matchRoute(input.routes, input.req.method ?? "GET", url);
  if (matched === undefined) {
    sendJson(input.res, 404, { message: `no route for ${input.req.method} ${url.pathname}` });
    return;
  }
  let response: MockResponse;
  try {
    response = await matched.route.handler({
      request: input.req,
      body: parsedBody,
      rawBody,
      url,
      pathParams: matched.pathParams,
    });
  } catch (err) {
    sendJson(input.res, 500, {
      message: `mock handler threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (response.bodyBytes !== undefined) {
    input.res.writeHead(response.status, response.headers ?? {});
    input.res.end(Buffer.from(response.bodyBytes));
    return;
  }
  if (response.body !== undefined) {
    sendJson(input.res, response.status, response.body, response.headers);
    return;
  }
  input.res.writeHead(response.status, response.headers ?? {});
  input.res.end();
};

const matchRoute = (
  routes: readonly MockRoute[],
  method: string,
  url: URL,
): { route: MockRoute; pathParams: Record<string, string> } | undefined => {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.pathPattern instanceof RegExp) {
      const m = route.pathPattern.exec(url.pathname);
      if (m === null) continue;
      const pathParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(m.groups ?? {})) {
        if (typeof value === "string") {
          pathParams[key] = decodeURIComponent(value);
        }
      }
      return { route, pathParams };
    }
    if (matchPlainPath(route.pathPattern, url.pathname)) {
      return { route, pathParams: {} };
    }
  }
  return undefined;
};

const matchPlainPath = (pattern: string, path: string): boolean => {
  if (pattern === path) return true;
  if (!pattern.includes("*")) return false;
  const regex = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return regex.test(path);
};

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload, "utf8").toString(),
    ...(extraHeaders ?? {}),
  });
  res.end(payload);
};

const readBodyBytes = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error(`mock-server: request body exceeded ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};
