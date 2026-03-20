/**
 * E2E test for GET /workspace/jobs/{jobId}/component-manifest endpoint.
 *
 * Submits a real Figma job, waits for terminal state, then validates
 * that the component manifest endpoint returns IR-to-source mappings.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/381
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set — skipping component manifest endpoint E2E tests"
    : undefined;

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
        reject(new Error("Failed to allocate an ephemeral port."));
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
    ["--import", "tsx", "./src/cli.ts", "start", "--host", "127.0.0.1", "--port", String(port), "--preview", "false"],
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
  await waitForHealthz({ child, baseUrl, logs, timeoutMs: 10_000 });
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

const pollJobStatus = async ({
  baseUrl,
  jobId,
  timeoutMs
}: {
  baseUrl: string;
  jobId: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/workspace/jobs/${jobId}`, {
      signal: AbortSignal.timeout(2_000)
    });
    const body = (await response.json()) as Record<string, unknown>;
    const status = body.status as string;
    if (status === "completed" || status === "failed" || status === "canceled") {
      return body;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1_000);
    });
  }
  throw new Error(`Job ${jobId} did not reach terminal status within ${timeoutMs}ms.`);
};

test("component-manifest endpoint: 404 for unknown job, 409 while running, manifest structure", { skip: skipReason, timeout: 300_000 }, async () => {
  const running = await startCliProcess();
  try {
    // === 404 for unknown job ===
    const unknownResponse = await fetch(`${running.baseUrl}/workspace/jobs/nonexistent-id/component-manifest`, {
      signal: AbortSignal.timeout(2_000)
    });
    assert.equal(unknownResponse.status, 404);
    const unknownBody = (await unknownResponse.json()) as Record<string, unknown>;
    assert.equal(unknownBody.error, "JOB_NOT_FOUND");

    // === Submit a real job ===
    const submitResponse = await fetch(`${running.baseUrl}/workspace/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        figmaFileKey: FIGMA_FILE_KEY,
        figmaAccessToken: FIGMA_ACCESS_TOKEN,
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
        enableGitPr: false
      }),
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(submitResponse.status, 202);
    const submitBody = (await submitResponse.json()) as Record<string, unknown>;
    const jobId = submitBody.jobId as string;
    assert.ok(jobId, "Expected jobId in submit response");

    // === 409 while job is running (if not already finished) ===
    const earlyResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/component-manifest`, {
      signal: AbortSignal.timeout(2_000)
    });
    if (earlyResponse.status === 409) {
      const earlyBody = (await earlyResponse.json()) as Record<string, unknown>;
      assert.equal(earlyBody.error, "JOB_NOT_COMPLETED");
    }

    // Wait for terminal state
    await pollJobStatus({ baseUrl: running.baseUrl, jobId, timeoutMs: 280_000 });

    // === Get component manifest ===
    const manifestResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/component-manifest`, {
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(manifestResponse.status, 200);

    const manifestBody = (await manifestResponse.json()) as {
      jobId: string;
      screens: Array<{
        screenId: string;
        screenName: string;
        file: string;
        components: Array<{
          irNodeId: string;
          irNodeName: string;
          irNodeType: string;
          file: string;
          startLine: number;
          endLine: number;
          extractedComponent?: true;
        }>;
      }>;
    };

    assert.equal(manifestBody.jobId, jobId);
    assert.ok(Array.isArray(manifestBody.screens), "Expected screens array");
    assert.ok(manifestBody.screens.length > 0, "Expected at least one screen in manifest");

    // Validate screen entries
    for (const screen of manifestBody.screens) {
      assert.equal(typeof screen.screenId, "string", "Screen must have screenId");
      assert.equal(typeof screen.screenName, "string", "Screen must have screenName");
      assert.equal(typeof screen.file, "string", "Screen must have file");
      assert.ok(Array.isArray(screen.components), "Screen must have components array");

      // Validate component entries
      for (const component of screen.components) {
        assert.equal(typeof component.irNodeId, "string", "Component must have irNodeId");
        assert.equal(typeof component.irNodeName, "string", "Component must have irNodeName");
        assert.equal(typeof component.irNodeType, "string", "Component must have irNodeType");
        assert.equal(typeof component.file, "string", "Component must have file");
        assert.equal(typeof component.startLine, "number", "Component must have startLine");
        assert.equal(typeof component.endLine, "number", "Component must have endLine");
        assert.ok(component.startLine >= 1, "startLine must be >= 1");
        assert.ok(component.endLine >= component.startLine, "endLine must be >= startLine");

        if (component.extractedComponent !== undefined) {
          assert.equal(component.extractedComponent, true, "extractedComponent must be true when present");
        }
      }
    }

    // At least one screen should have components (IR markers in generated code)
    const screensWithComponents = manifestBody.screens.filter((s) => s.components.length > 0);
    assert.ok(screensWithComponents.length > 0, "Expected at least one screen with components");
  } finally {
    await stopCliProcess(running.child);
  }
});
