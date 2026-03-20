/**
 * E2E test for the Inspector panel API layer.
 *
 * Validates the combined API surface that the Inspector UI depends on:
 * - GET /workspace/jobs/{jobId}/files (listing)
 * - GET /workspace/jobs/{jobId}/files/{path} (content)
 * - GET /workspace/jobs/{jobId}/component-manifest (initial file selection)
 *
 * Submits a real Figma job and confirms the full inspector data flow.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/382
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
    ? "FIGMA_ACCESS_TOKEN not set — skipping inspector API E2E tests"
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
    ["--import", "tsx", "./src/cli.ts", "start", "--host", "127.0.0.1", "--port", String(port), "--preview", "true"],
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

test("inspector API: files listing, file content, and component manifest work together", { skip: skipReason, timeout: 300_000 }, async () => {
  const running = await startCliProcess();
  try {
    // Submit a real job with preview enabled
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

    // Wait for terminal state — job may fail at validate.project due to
    // generated-code type errors, but files/manifest are still available.
    const terminalBody = await pollJobStatus({ baseUrl: running.baseUrl, jobId, timeoutMs: 280_000 });
    const terminalStatus = terminalBody.status as string;
    assert.ok(
      terminalStatus === "completed" || terminalStatus === "failed",
      `Job must reach completed or failed (got '${terminalStatus}')`
    );

    // If the job failed, it should have failed at validate.project (after codegen produced files)
    if (terminalStatus === "failed") {
      const error = terminalBody.error as { stage?: string } | undefined;
      assert.ok(
        error?.stage === "validate.project" || error?.stage === "repro.export",
        `Expected failure at validate.project or repro.export stage (got '${error?.stage}')`
      );
    }

    // === Verify preview is enabled ===
    const preview = terminalBody.preview as { enabled?: boolean; url?: string } | undefined;
    assert.ok(preview, "Expected preview object");
    assert.equal(preview.enabled, true, "Preview should be enabled");

    // === GET /workspace/jobs/{jobId}/files ===
    const filesResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/files`, {
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(filesResponse.status, 200);
    const filesBody = (await filesResponse.json()) as { jobId: string; files: Array<{ path: string; sizeBytes: number }> };
    assert.equal(filesBody.jobId, jobId);
    assert.ok(filesBody.files.length > 0, "Expected at least one file");

    const tsxFiles = filesBody.files.filter((f) => f.path.endsWith(".tsx"));
    assert.ok(tsxFiles.length > 0, "Expected .tsx files");

    // === GET /workspace/jobs/{jobId}/component-manifest ===
    const manifestResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/component-manifest`, {
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(manifestResponse.status, 200);
    const manifestBody = (await manifestResponse.json()) as {
      jobId: string;
      screens: Array<{ screenId: string; screenName: string; file: string }>;
    };
    assert.equal(manifestBody.jobId, jobId);
    assert.ok(Array.isArray(manifestBody.screens), "Expected screens array");
    assert.ok(manifestBody.screens.length > 0, "Expected at least one screen");

    // The first screen should have a file path
    const firstScreen = manifestBody.screens[0];
    assert.ok(firstScreen, "Expected first screen");
    assert.ok(firstScreen.file, "Expected file path in screen");
    assert.ok(firstScreen.file.endsWith(".tsx"), "Screen file should be .tsx");

    // The screen file should exist in the files list
    const screenFileInList = filesBody.files.find((f) => f.path === firstScreen.file);
    assert.ok(screenFileInList, `Screen file '${firstScreen.file}' should be in the files listing`);

    // === GET /workspace/jobs/{jobId}/files/{path} ===
    const fileContentResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/${encodeURIComponent(firstScreen.file)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    assert.equal(fileContentResponse.status, 200);
    assert.ok(
      fileContentResponse.headers.get("content-type")?.includes("text/plain"),
      "Expected text/plain content type"
    );

    const fileContent = await fileContentResponse.text();
    assert.ok(fileContent.length > 0, "File content should not be empty");
    assert.ok(fileContent.includes("import"), "Expected import statement in generated file");

    // === Verify all tsx files from the list are readable ===
    for (const tsxFile of tsxFiles.slice(0, 3)) {
      const resp = await fetch(
        `${running.baseUrl}/workspace/jobs/${jobId}/files/${encodeURIComponent(tsxFile.path)}`,
        { signal: AbortSignal.timeout(5_000) }
      );
      assert.equal(resp.status, 200, `Expected 200 for ${tsxFile.path}`);
      const content = await resp.text();
      assert.ok(content.length > 0, `Expected non-empty content for ${tsxFile.path}`);
    }

    // === Verify preview URL serves content (only if job completed) ===
    if (preview.url && terminalStatus === "completed") {
      const previewResponse = await fetch(preview.url, {
        signal: AbortSignal.timeout(5_000)
      });
      assert.equal(previewResponse.status, 200, "Preview URL should return 200");
      const previewContent = await previewResponse.text();
      assert.ok(previewContent.includes("<"), "Preview should contain HTML");
    }
  } finally {
    await stopCliProcess(running.child);
  }
});
