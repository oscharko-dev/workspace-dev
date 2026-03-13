import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";

const PACKAGE_ROOT = new URL("../", import.meta.url);

interface RunningCli {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
}

const allocatePort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", (error) => {
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an ephemeral port for integration test."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const startCliProcess = async (): Promise<RunningCli> => {
  const port = await allocatePort();
  const logs: string[] = [];
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "./src/cli.ts", "start", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: PACKAGE_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    logs.push(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    logs.push(chunk);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealthz({ child, baseUrl, logs, timeoutMs: 8_000 });
  return { child, baseUrl, logs };
};

const waitForHealthz = async ({
  child,
  baseUrl,
  logs,
  timeoutMs
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
        `workspace-dev CLI exited before health check succeeded (exit=${child.exitCode}). Logs:\n${logs.join("")}`
      );
    }

    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`workspace-dev health check timeout after ${timeoutMs}ms. Logs:\n${logs.join("")}`);
};

const stopCliProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await once(child, "exit");
};

test("cli integration: start serves /workspace over real HTTP", async () => {
  const running = await startCliProcess();
  try {
    const workspaceResponse = await fetch(`${running.baseUrl}/workspace`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(workspaceResponse.status, 200);

    const body = (await workspaceResponse.json()) as Record<string, unknown>;
    assert.equal(body.running, true);
    assert.equal(body.host, "127.0.0.1");
    assert.equal(body.figmaSourceMode, "rest");
    assert.equal(body.llmCodegenMode, "deterministic");
  } finally {
    await stopCliProcess(running.child);
  }
});

test("cli integration: submit mode-lock is enforced through network boundary", async () => {
  const running = await startCliProcess();
  try {
    const submitResponse = await fetch(`${running.baseUrl}/workspace/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        figmaFileKey: "demo",
        figmaAccessToken: "figd_xxx",
        repoUrl: "https://github.com/example/repo.git",
        repoToken: "ghp_xxx",
        figmaSourceMode: "mcp",
        llmCodegenMode: "deterministic"
      }),
      signal: AbortSignal.timeout(2_000)
    });
    assert.equal(submitResponse.status, 400);

    const body = (await submitResponse.json()) as Record<string, unknown>;
    assert.equal(body.error, "MODE_LOCK_VIOLATION");
    assert.equal(typeof body.message, "string");
  } finally {
    await stopCliProcess(running.child);
  }
});
