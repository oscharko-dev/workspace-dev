import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_STRICT_TRANSPORT_SECURITY } from "./constants.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ARTIFACT_DIR = path.join(PACKAGE_ROOT, "artifacts", "testing", "dast-smoke");
const HOST = "127.0.0.1";

interface RunningCli {
  child: ChildProcessWithoutNullStreams;
  port: number;
  baseUrl: string;
  logs: string[];
}

interface RawHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface Observation {
  method: string;
  path: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const allocatePort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an ephemeral port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });

const startCliProcess = async (
  envOverrides: NodeJS.ProcessEnv = {},
  logs: string[] = [],
): Promise<RunningCli> => {
  const port = await allocatePort();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "./src/cli.ts",
      "start",
      "--host",
      HOST,
      "--port",
      String(port),
      "--preview",
      "true",
    ],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    logs.push(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    logs.push(chunk);
  });

  const baseUrl = `http://${HOST}:${port}`;
  try {
    await waitForHealthz({ child, baseUrl, logs, timeoutMs: 15_000 });
  } catch (error) {
    await stopCliProcess(child);
    throw error;
  }
  return { child, port, baseUrl, logs };
};

const stopCliProcess = async (
  child: ChildProcessWithoutNullStreams,
): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }

  const exitEvent = once(child, "exit");
  child.kill("SIGTERM");

  const gracefulExit = await Promise.race([
    exitEvent.then(() => true),
    sleep(5_000).then(() => false),
  ]);

  if (!gracefulExit && child.exitCode === null) {
    const forcedExitEvent = once(child, "exit");
    child.kill("SIGKILL");
    await forcedExitEvent;
  }
};

const waitForHealthz = async ({
  child,
  baseUrl,
  logs,
  timeoutMs,
}: {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
  timeoutMs: number;
}): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `workspace-dev CLI exited before health check succeeded (exit=${child.exitCode}). Logs:\n${logs.join("")}`,
      );
    }

    try {
      const response = await rawHttpRequest({
        port: Number(new URL(baseUrl).port),
        method: "GET",
        path: "/healthz",
      });
      if (response.statusCode === 200) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(120);
  }

  throw new Error(
    `workspace-dev health check timeout after ${timeoutMs}ms. Logs:\n${logs.join("")}`,
  );
};

const rawHttpRequest = async ({
  port,
  method,
  path: requestPath,
  headers,
  body,
}: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<RawHttpResponse> =>
  await new Promise<RawHttpResponse>((resolve, reject) => {
    const request = http.request(
      {
        host: HOST,
        port,
        method,
        path: requestPath,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.on("error", reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });

const getHeader = (
  response: RawHttpResponse,
  name: string,
): string | undefined => {
  const value = response.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value;
};

const writeArtifacts = async ({
  prefix,
  logs,
  observations,
}: {
  prefix: string;
  logs: string[];
  observations: Observation[];
}): Promise<void> => {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACT_DIR, `${prefix}.log`), logs.join(""), "utf8");
  await writeFile(
    path.join(ARTIFACT_DIR, `${prefix}.json`),
    `${JSON.stringify(observations, null, 2)}\n`,
    "utf8",
  );
};

test("runtime DAST smoke covers headers, same-origin enforcement, and traversal rejection", async () => {
  const logs: string[] = [];
  const observations: Observation[] = [];
  let runtime: RunningCli | undefined;

  try {
    runtime = await startCliProcess({}, logs);
    const healthz = await rawHttpRequest({
      port: runtime.port,
      method: "GET",
      path: "/healthz",
    });
    observations.push({
      method: "GET",
      path: "/healthz",
      statusCode: healthz.statusCode,
      headers: healthz.headers,
    });

    assert.equal(healthz.statusCode, 200);
    assert.match(getHeader(healthz, "content-security-policy") ?? "", /\S+/);
    assert.equal(getHeader(healthz, "x-content-type-options"), "nosniff");
    assert.match(
      getHeader(healthz, "x-frame-options") ?? "",
      /^(DENY|SAMEORIGIN)$/,
    );
    assert.equal(getHeader(healthz, "strict-transport-security"), undefined);

    const preflight = await rawHttpRequest({
      port: runtime.port,
      method: "OPTIONS",
      path: "/workspace/submit",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    observations.push({
      method: "OPTIONS",
      path: "/workspace/submit",
      statusCode: preflight.statusCode,
      headers: preflight.headers,
    });

    assert.equal(preflight.statusCode, 405);
    assert.equal(getHeader(preflight, "access-control-allow-origin"), undefined);

    for (const requestPath of [
      "/workspace/ui/../../etc/passwd",
      "/workspace/ui/..%2F..%2Fetc/passwd",
      "/workspace/ui/assets%00app.js",
      "/workspace/ui/..%5C..%5Cwindows%5Cwin.ini",
    ]) {
      const response = await rawHttpRequest({
        port: runtime.port,
        method: "GET",
        path: requestPath,
      });
      observations.push({
        method: "GET",
        path: requestPath,
        statusCode: response.statusCode,
        headers: response.headers,
      });

      assert.ok(
        response.statusCode === 400 || response.statusCode === 403,
        `Expected ${requestPath} to be rejected, received ${response.statusCode}`,
      );
      const responseText = response.body.toString("utf8");
      assert.doesNotMatch(responseText, /root:|daemon:|\/bin\/bash/i);
      assert.doesNotMatch(responseText, /<!doctype html>|<html/i);
    }
  } finally {
    await writeArtifacts({
      prefix: "default-runtime",
      logs,
      observations,
    });
    if (runtime !== undefined) {
      await stopCliProcess(runtime.child);
    }
  }
});

test("runtime DAST smoke exposes HSTS only when explicitly enabled", async () => {
  const logs: string[] = [];
  const observations: Observation[] = [];
  let runtime: RunningCli | undefined;

  try {
    runtime = await startCliProcess(
      {
        FIGMAPIPE_WORKSPACE_ENABLE_HSTS: "true",
      },
      logs,
    );
    const healthz = await rawHttpRequest({
      port: runtime.port,
      method: "GET",
      path: "/healthz",
    });
    observations.push({
      method: "GET",
      path: "/healthz",
      statusCode: healthz.statusCode,
      headers: healthz.headers,
    });

    assert.equal(healthz.statusCode, 200);
    assert.equal(
      getHeader(healthz, "strict-transport-security"),
      DEFAULT_STRICT_TRANSPORT_SECURITY,
    );
  } finally {
    await writeArtifacts({
      prefix: "hsts-enabled-runtime",
      logs,
      observations,
    });
    if (runtime !== undefined) {
      await stopCliProcess(runtime.child);
    }
  }
});
