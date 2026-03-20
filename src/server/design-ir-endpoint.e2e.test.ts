/**
 * E2E test for GET /workspace/jobs/{jobId}/design-ir endpoint.
 *
 * Submits a real Figma job, waits for completion, then validates
 * that the design-ir endpoint returns the enriched IR tree with
 * generatedFile mappings, tokens, and correct error responses.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/379
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
    ? "FIGMA_ACCESS_TOKEN not set — skipping design-ir endpoint E2E tests"
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

test("design-ir endpoint: returns 404 for unknown job", { skip: skipReason }, async () => {
  const running = await startCliProcess();
  try {
    const response = await fetch(`${running.baseUrl}/workspace/jobs/nonexistent-id/design-ir`, {
      signal: AbortSignal.timeout(2_000)
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.error, "JOB_NOT_FOUND");
  } finally {
    await stopCliProcess(running.child);
  }
});

test("design-ir endpoint: returns enriched IR tree for completed job", { skip: skipReason, timeout: 300_000 }, async () => {
  const running = await startCliProcess();
  try {
    // Submit a real job
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

    // Test 409 while job is running — only if the job hasn't already completed
    const earlyResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/design-ir`, {
      signal: AbortSignal.timeout(2_000)
    });
    const earlyStatus = earlyResponse.status;
    // Could be 409 (still running) or 200 (already completed for cached jobs)
    if (earlyStatus === 409) {
      const earlyBody = (await earlyResponse.json()) as Record<string, unknown>;
      assert.equal(earlyBody.error, "JOB_NOT_COMPLETED");
    }

    // Wait for completion
    const terminalJob = await pollJobStatus({
      baseUrl: running.baseUrl,
      jobId,
      timeoutMs: 280_000
    });
    // Job may complete or fail at validate.project — design IR is written during ir.derive
    // and is available regardless of later stage failures.
    const terminalStatus = terminalJob.status as string;
    assert.ok(
      terminalStatus === "completed" || terminalStatus === "failed",
      `Job should reach a terminal state, got '${terminalStatus}'`
    );

    // Hit the design-ir endpoint
    const irResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/design-ir`, {
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(irResponse.status, 200);

    const irBody = (await irResponse.json()) as Record<string, unknown>;

    // Validate top-level shape
    assert.equal(irBody.jobId, jobId);
    assert.equal(typeof irBody.sourceName, "string");
    assert.ok(Array.isArray(irBody.screens), "Expected screens array");
    assert.ok(irBody.tokens !== null && irBody.tokens !== undefined, "Expected tokens");

    // Validate screens structure
    const screens = irBody.screens as Array<Record<string, unknown>>;
    assert.ok(screens.length > 0, "Expected at least one screen");

    for (const screen of screens) {
      assert.equal(typeof screen.id, "string", "Screen must have id");
      assert.equal(typeof screen.name, "string", "Screen must have name");
      assert.ok(Array.isArray(screen.children), "Screen must have children array");

      // generatedFile mapping must be present
      assert.equal(typeof screen.generatedFile, "string", "Screen must have generatedFile mapping");
      assert.ok(
        (screen.generatedFile as string).startsWith("src/screens/"),
        `generatedFile should start with src/screens/, got: ${screen.generatedFile}`
      );
      assert.ok(
        (screen.generatedFile as string).endsWith(".tsx"),
        `generatedFile should end with .tsx, got: ${screen.generatedFile}`
      );

      // No absolute paths leaked
      assert.ok(
        !(screen.generatedFile as string).startsWith("/"),
        "generatedFile must be a relative path"
      );
    }

    // Validate tokens structure
    const tokens = irBody.tokens as Record<string, unknown>;
    assert.ok("palette" in tokens, "Expected palette in tokens");
    assert.ok("fontFamily" in tokens, "Expected fontFamily in tokens");
  } finally {
    await stopCliProcess(running.child);
  }
});
