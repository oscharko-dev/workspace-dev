import type { Server } from "node:http";

export interface InjectResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json: <T = unknown>() => T;
}

export interface InjectRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}

type InjectBody = string | Uint8Array | undefined;

export interface WorkspaceServerApp {
  close: () => Promise<void>;
  inject: (request: InjectRequest) => Promise<InjectResponse>;
  addresses: () => Array<{ address: string; family: string; port: number }>;
}

export function toAddressList(server: Server): Array<{ address: string; family: string; port: number }> {
  const resolved = server.address();
  if (resolved === null) {
    return [];
  }

  const addressInfo = resolved as Exclude<typeof resolved, null | string>;
  return [{ address: addressInfo.address, family: addressInfo.family, port: addressInfo.port }];
}

export async function closeServer(server: Server): Promise<void> {
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

export function resolveInjectRequest({
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

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = body as BodyInit;
  }

  return {
    url: new URL(request.url, `http://${host}:${port}`),
    init
  };
}

export function buildApp({
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
