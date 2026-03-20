/**
 * E2E test for GET /workspace/jobs/{jobId}/files endpoint.
 *
 * Submits a real Figma job, waits for terminal state, then validates
 * that the files list and file content endpoints work correctly,
 * including security checks (path traversal, blocked dirs, etc.).
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/380
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
    ? "FIGMA_ACCESS_TOKEN not set — skipping files endpoint E2E tests"
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

test("files endpoint: 404 for unknown job, security checks, file listing and content", { skip: skipReason, timeout: 300_000 }, async () => {
  const running = await startCliProcess();
  try {
    // === 404 for unknown job ===
    const unknownResponse = await fetch(`${running.baseUrl}/workspace/jobs/nonexistent-id/files`, {
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
    const earlyResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/files`, {
      signal: AbortSignal.timeout(2_000)
    });
    if (earlyResponse.status === 409) {
      const earlyBody = (await earlyResponse.json()) as Record<string, unknown>;
      assert.equal(earlyBody.error, "JOB_NOT_COMPLETED");
    }

    // Wait for terminal state
    await pollJobStatus({ baseUrl: running.baseUrl, jobId, timeoutMs: 280_000 });

    // === Security: path traversal ===
    const traversalResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/src/..%2F..%2F..%2Fetc%2Fpasswd.ts`,
      { signal: AbortSignal.timeout(2_000) }
    );
    assert.equal(traversalResponse.status, 403);
    const traversalBody = (await traversalResponse.json()) as Record<string, unknown>;
    assert.equal(traversalBody.error, "FORBIDDEN_PATH");

    // === Security: node_modules ===
    const nmResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/node_modules/react/index.ts`,
      { signal: AbortSignal.timeout(2_000) }
    );
    assert.equal(nmResponse.status, 403);

    // === Security: disallowed extension ===
    const jsResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/src/script.js`,
      { signal: AbortSignal.timeout(2_000) }
    );
    assert.equal(jsResponse.status, 403);

    // === List all files ===
    const listResponse = await fetch(`${running.baseUrl}/workspace/jobs/${jobId}/files`, {
      signal: AbortSignal.timeout(5_000)
    });
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as { jobId: string; files: Array<{ path: string; sizeBytes: number }> };
    assert.equal(listBody.jobId, jobId);
    assert.ok(Array.isArray(listBody.files), "Expected files array");
    assert.ok(listBody.files.length > 0, "Expected at least one file");

    // Validate file entries
    for (const file of listBody.files) {
      assert.equal(typeof file.path, "string", "File must have path");
      assert.equal(typeof file.sizeBytes, "number", "File must have sizeBytes");
      assert.ok(!file.path.startsWith("/"), "File path must be relative");
      assert.ok(!file.path.includes("node_modules"), "node_modules must not appear");
      assert.ok(!file.path.startsWith("dist/"), "dist/ must not appear");
    }

    // Should contain generated screen files
    const tsxFiles = listBody.files.filter((f) => f.path.endsWith(".tsx"));
    assert.ok(tsxFiles.length > 0, "Expected at least one .tsx file");

    // Should contain App.tsx
    const appTsx = listBody.files.find((f) => f.path === "src/App.tsx");
    assert.ok(appTsx, "Expected src/App.tsx in file list");

    // === Filter by directory ===
    const screensResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files?dir=src/screens`,
      { signal: AbortSignal.timeout(5_000) }
    );
    assert.equal(screensResponse.status, 200);
    const screensBody = (await screensResponse.json()) as { files: Array<{ path: string; sizeBytes: number }> };
    assert.ok(screensBody.files.length > 0, "Expected files in src/screens");
    for (const file of screensBody.files) {
      assert.ok(file.path.startsWith("src/screens/"), `File '${file.path}' should be under src/screens/`);
    }

    // === Read single file ===
    const targetFile = appTsx ?? tsxFiles[0];
    assert.ok(targetFile, "Need a file to read");

    const fileResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/${targetFile.path}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    assert.equal(fileResponse.status, 200);
    assert.ok(
      fileResponse.headers.get("content-type")?.includes("text/plain"),
      "Expected text/plain content type"
    );

    const fileContent = await fileResponse.text();
    assert.ok(fileContent.length > 0, "File content should not be empty");
    assert.ok(fileContent.includes("import"), "Expected import statement in .tsx file");

    // === Read non-existent file ===
    const missingResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${jobId}/files/src/NonExistent.tsx`,
      { signal: AbortSignal.timeout(2_000) }
    );
    assert.equal(missingResponse.status, 404);
    const missingBody = (await missingResponse.json()) as Record<string, unknown>;
    assert.equal(missingBody.error, "FILE_NOT_FOUND");
  } finally {
    await stopCliProcess(running.child);
  }
});
