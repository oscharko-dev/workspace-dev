import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_PATH = path.join(PACKAGE_ROOT, "src/parity/fixtures/golden/prototype-navigation/figma.json");

interface RunningCli {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
}

interface JobPayload {
  jobId: string;
  status: string;
}

interface FilesPayload {
  jobId: string;
  files: Array<{
    path: string;
    sizeBytes: number;
  }>;
}

interface DesignIrPayload {
  jobId: string;
  sourceName: string;
  screens: Array<{
    id: string;
    name: string;
    generatedFile?: string;
    children: unknown[];
  }>;
  tokens: Record<string, unknown>;
}

interface ComponentManifestPayload {
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
  await waitForHealthz({ child, baseUrl, logs, timeoutMs: 15_000 });
  return { child, baseUrl, logs };
};

const stopCliProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }

  const exitEvent = once(child, "exit");
  child.kill("SIGTERM");

  if (child.exitCode !== null) {
    return;
  }

  const gracefulExit = await Promise.race([
    exitEvent.then(() => true),
    sleep(5_000).then(() => false)
  ]);

  if (!gracefulExit && child.exitCode === null) {
    const forcedExitEvent = once(child, "exit");
    child.kill("SIGKILL");
    if (child.exitCode === null) {
      await forcedExitEvent;
    }
  }
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

    await sleep(120);
  }

  throw new Error(`workspace-dev health check timeout after ${timeoutMs}ms. Logs:\n${logs.join("")}`);
};

const submitFixtureJob = async ({ baseUrl }: { baseUrl: string }): Promise<string> => {
  const response = await fetch(`${baseUrl}/workspace/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      figmaSourceMode: "local_json",
      figmaJsonPath: FIXTURE_PATH,
      llmCodegenMode: "deterministic",
      enableGitPr: false
    }),
    signal: AbortSignal.timeout(5_000)
  });

  assert.equal(response.status, 202, "submit must return 202");
  const payload = (await response.json()) as Record<string, unknown>;
  const jobId = payload.jobId;
  assert.equal(typeof jobId, "string", "submit payload must include jobId");
  return jobId;
};

const pollJobStatus = async ({
  baseUrl,
  jobId,
  timeoutMs
}: {
  baseUrl: string;
  jobId: string;
  timeoutMs: number;
}): Promise<JobPayload> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(3_000)
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as JobPayload;

    if (body.status === "completed" || body.status === "failed" || body.status === "canceled") {
      return body;
    }

    await sleep(250);
  }

  throw new Error(`Job ${jobId} did not reach terminal state within ${timeoutMs}ms.`);
};

const waitForPendingEndpoint = async ({
  baseUrl,
  jobId,
  endpoint
}: {
  baseUrl: string;
  jobId: string;
  endpoint: "design-ir" | "files" | "component-manifest";
}): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/${endpoint}`, {
      signal: AbortSignal.timeout(2_000)
    });

    if (response.status === 409) {
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.error, "JOB_NOT_COMPLETED");
      return;
    }

    if (response.status === 200) {
      throw new Error(`Expected 409 while job is pending for '${endpoint}', got 200.`);
    }

    await sleep(120);
  }

  throw new Error(`Did not observe 409 pending response for endpoint '${endpoint}'.`);
};

const fetchDesignIr = async ({ baseUrl, jobId }: { baseUrl: string; jobId: string }): Promise<DesignIrPayload> => {
  const response = await fetch(`${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/design-ir`, {
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(response.status, 200);
  return (await response.json()) as DesignIrPayload;
};

const fetchFiles = async ({
  baseUrl,
  jobId,
  dir
}: {
  baseUrl: string;
  jobId: string;
  dir?: string;
}): Promise<FilesPayload> => {
  const url = new URL(`${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files`);
  if (dir) {
    url.searchParams.set("dir", dir);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(response.status, 200);
  return (await response.json()) as FilesPayload;
};

const fetchComponentManifest = async ({
  baseUrl,
  jobId
}: {
  baseUrl: string;
  jobId: string;
}): Promise<ComponentManifestPayload> => {
  const response = await fetch(`${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/component-manifest`, {
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(response.status, 200);
  return (await response.json()) as ComponentManifestPayload;
};

test("inspector endpoints: unknown jobs return 404", async () => {
  const running = await startCliProcess();

  try {
    for (const endpoint of ["design-ir", "files", "component-manifest"] as const) {
      const response = await fetch(`${running.baseUrl}/workspace/jobs/nonexistent-job/${endpoint}`, {
        signal: AbortSignal.timeout(2_000)
      });
      assert.equal(response.status, 404, `${endpoint} should return 404 for unknown job`);

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.error, "JOB_NOT_FOUND");
    }
  } finally {
    await stopCliProcess(running.child);
  }
});

test("inspector endpoints: pending jobs return 409", { timeout: 120_000 }, async () => {
  const running = await startCliProcess();

  try {
    const jobId = await submitFixtureJob({ baseUrl: running.baseUrl });

    await waitForPendingEndpoint({ baseUrl: running.baseUrl, jobId, endpoint: "design-ir" });
    await waitForPendingEndpoint({ baseUrl: running.baseUrl, jobId, endpoint: "files" });
    await waitForPendingEndpoint({ baseUrl: running.baseUrl, jobId, endpoint: "component-manifest" });

    const terminal = await pollJobStatus({
      baseUrl: running.baseUrl,
      jobId,
      timeoutMs: 120_000
    });
    assert.equal(terminal.status, "completed", "fixture-backed job must complete successfully");
  } finally {
    await stopCliProcess(running.child);
  }
});

test("inspector endpoints: completed jobs expose expected payloads and files security constraints", { timeout: 120_000 }, async () => {
  const running = await startCliProcess();

  try {
    const jobId = await submitFixtureJob({ baseUrl: running.baseUrl });
    const terminal = await pollJobStatus({
      baseUrl: running.baseUrl,
      jobId,
      timeoutMs: 120_000
    });
    assert.equal(terminal.status, "completed", "fixture-backed job must complete successfully");

    const designIr = await fetchDesignIr({ baseUrl: running.baseUrl, jobId });
    assert.equal(designIr.jobId, jobId);
    assert.equal(Array.isArray(designIr.screens), true);
    assert.equal(designIr.screens.length, 2, "prototype-navigation fixture should expose exactly 2 screens");
    assert.equal(typeof designIr.tokens, "object");

    for (const screen of designIr.screens) {
      assert.equal(typeof screen.id, "string");
      assert.equal(typeof screen.name, "string");
      assert.equal(Array.isArray(screen.children), true);

      assert.equal(typeof screen.generatedFile, "string", `screen '${screen.id}' must include generatedFile mapping`);
      assert.equal(screen.generatedFile?.startsWith("src/screens/"), true);
      assert.equal(screen.generatedFile?.endsWith(".tsx"), true);
      assert.equal(screen.generatedFile?.startsWith("/"), false, "generatedFile must not expose absolute paths");
    }

    const fileList = await fetchFiles({ baseUrl: running.baseUrl, jobId });
    assert.equal(fileList.jobId, jobId);
    assert.equal(fileList.files.length > 0, true);

    const filePaths = fileList.files.map((entry) => entry.path);
    assert.equal(filePaths.includes("src/App.tsx"), true);
    assert.equal(filePaths.includes("src/screens/Home.tsx"), true);
    assert.equal(filePaths.includes("src/screens/Details.tsx"), true);

    for (const file of fileList.files) {
      assert.equal(file.path.startsWith("/"), false, "listed files must always be relative paths");
      assert.equal(file.path.includes("node_modules"), false, "node_modules must be excluded from listing");
      assert.equal(file.path.startsWith("dist/"), false, "dist directory must be excluded from listing");
      assert.equal(typeof file.sizeBytes, "number");
    }

    const screenDirFiles = await fetchFiles({
      baseUrl: running.baseUrl,
      jobId,
      dir: "src/screens"
    });
    assert.equal(screenDirFiles.files.length >= 2, true);
    for (const file of screenDirFiles.files) {
      assert.equal(file.path.startsWith("src/screens/"), true);
    }

    const fileResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent("src/screens/Home.tsx")}`,
      {
        signal: AbortSignal.timeout(5_000)
      }
    );
    assert.equal(fileResponse.status, 200);
    assert.match(fileResponse.headers.get("content-type") ?? "", /text\/plain/i);
    const fileContent = await fileResponse.text();
    assert.equal(fileContent.includes("import"), true);

    const traversalResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/..%2F..%2Fetc%2Fpasswd.ts`,
      { signal: AbortSignal.timeout(3_000) }
    );
    assert.equal(traversalResponse.status, 403);
    const traversalBody = (await traversalResponse.json()) as Record<string, unknown>;
    assert.equal(traversalBody.error, "FORBIDDEN_PATH");

    const blockedDirFilterResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files?dir=node_modules`,
      { signal: AbortSignal.timeout(3_000) }
    );
    assert.equal(blockedDirFilterResponse.status, 403);
    const blockedDirFilterBody = (await blockedDirFilterResponse.json()) as Record<string, unknown>;
    assert.equal(blockedDirFilterBody.error, "FORBIDDEN_PATH");

    const blockedExtensionResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/script.js`,
      { signal: AbortSignal.timeout(3_000) }
    );
    assert.equal(blockedExtensionResponse.status, 403);

    const missingFileResponse = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/screens/DoesNotExist.tsx`,
      { signal: AbortSignal.timeout(3_000) }
    );
    assert.equal(missingFileResponse.status, 404);

    const manifest = await fetchComponentManifest({ baseUrl: running.baseUrl, jobId });
    assert.equal(manifest.jobId, jobId);
    assert.equal(manifest.screens.length, 2);

    const previewIndexResponse = await fetch(
      `${running.baseUrl}/workspace/repros/${encodeURIComponent(jobId)}/`,
      { signal: AbortSignal.timeout(5_000) }
    );
    assert.equal(previewIndexResponse.status, 200);
    const previewHtml = await previewIndexResponse.text();
    assert.equal(previewHtml.includes("data-workspace-dev-inspect"), true);
    assert.equal(previewHtml.includes("sessionToken"), true);
    assert.equal(previewHtml.includes("allowedParentOrigin"), true);
    assert.equal(previewHtml.includes("inspect:scope:set"), true);
    assert.equal(previewHtml.includes("inspect:scope:clear"), true);
    assert.equal(previewHtml.includes("data-workspace-dev-inspect-scope"), true);

    const designScreenIds = new Set(designIr.screens.map((screen) => screen.id));
    for (const screen of manifest.screens) {
      assert.equal(designScreenIds.has(screen.screenId), true, "manifest screen must map to design-ir screen");
      assert.equal(typeof screen.screenName, "string");
      assert.equal(typeof screen.file, "string");
      assert.equal(Array.isArray(screen.components), true);
      assert.equal(filePaths.includes(screen.file), true, `manifest screen file '${screen.file}' must exist in files list`);

      for (const component of screen.components) {
        assert.equal(typeof component.irNodeId, "string");
        assert.equal(typeof component.irNodeName, "string");
        assert.equal(typeof component.irNodeType, "string");
        assert.equal(typeof component.file, "string");
        assert.equal(typeof component.startLine, "number");
        assert.equal(typeof component.endLine, "number");
        assert.equal(component.startLine >= 1, true);
        assert.equal(component.endLine >= component.startLine, true);

        if (component.extractedComponent !== undefined) {
          assert.equal(component.extractedComponent, true, "extractedComponent must be true when present");
        }
      }
    }
  } finally {
    await stopCliProcess(running.child);
  }
});

test("inspector endpoints: fixture runs are deterministic across repeated submissions", { timeout: 240_000 }, async () => {
  const running = await startCliProcess();

  try {
    const firstJobId = await submitFixtureJob({ baseUrl: running.baseUrl });
    const firstTerminal = await pollJobStatus({
      baseUrl: running.baseUrl,
      jobId: firstJobId,
      timeoutMs: 120_000
    });
    assert.equal(firstTerminal.status, "completed", "first fixture run must complete");

    const secondJobId = await submitFixtureJob({ baseUrl: running.baseUrl });
    const secondTerminal = await pollJobStatus({
      baseUrl: running.baseUrl,
      jobId: secondJobId,
      timeoutMs: 120_000
    });
    assert.equal(secondTerminal.status, "completed", "second fixture run must complete");

    const firstDesignIr = await fetchDesignIr({ baseUrl: running.baseUrl, jobId: firstJobId });
    const secondDesignIr = await fetchDesignIr({ baseUrl: running.baseUrl, jobId: secondJobId });

    const firstManifest = await fetchComponentManifest({ baseUrl: running.baseUrl, jobId: firstJobId });
    const secondManifest = await fetchComponentManifest({ baseUrl: running.baseUrl, jobId: secondJobId });

    const firstFiles = await fetchFiles({ baseUrl: running.baseUrl, jobId: firstJobId });
    const secondFiles = await fetchFiles({ baseUrl: running.baseUrl, jobId: secondJobId });

    const normalizeDesignIr = ({ jobId: _jobId, ...payload }: DesignIrPayload): Omit<DesignIrPayload, "jobId"> => payload;
    const normalizeManifest = ({
      jobId: _jobId,
      ...payload
    }: ComponentManifestPayload): Omit<ComponentManifestPayload, "jobId"> => payload;

    assert.deepEqual(normalizeDesignIr(firstDesignIr), normalizeDesignIr(secondDesignIr));
    assert.deepEqual(normalizeManifest(firstManifest), normalizeManifest(secondManifest));
    assert.deepEqual(
      firstFiles.files.map((entry) => entry.path),
      secondFiles.files.map((entry) => entry.path),
      "generated file path list must stay deterministic across repeated fixture runs"
    );

    const firstHomeContent = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(firstJobId)}/files/${encodeURIComponent("src/screens/Home.tsx")}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    const secondHomeContent = await fetch(
      `${running.baseUrl}/workspace/jobs/${encodeURIComponent(secondJobId)}/files/${encodeURIComponent("src/screens/Home.tsx")}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    assert.equal(firstHomeContent.status, 200);
    assert.equal(secondHomeContent.status, 200);
    assert.equal(await firstHomeContent.text(), await secondHomeContent.text());
  } finally {
    await stopCliProcess(running.child);
  }
});
