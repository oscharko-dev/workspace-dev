import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_PATH = path.join(
  PACKAGE_ROOT,
  "src/parity/fixtures/golden/rocket/prototype-navigation/figma.json",
);
const FIXTURE_PAYLOAD = readFileSync(FIXTURE_PATH, "utf8");

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
  nextCursor?: string;
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

interface FigmaAnalysisPayload {
  jobId: string;
  artifactVersion: number;
  sourceName: string;
  summary: {
    pageCount: number;
    sectionCount: number;
    topLevelFrameCount: number;
  };
  frameVariantGroups: unknown[];
  appShellSignals: unknown[];
  componentDensity: {
    byFrame: unknown[];
    hotspots: unknown[];
  };
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
    [
      "--import",
      "tsx",
      "./src/cli.ts",
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--preview",
      "true",
    ],
    {
      cwd: PACKAGE_ROOT,
      env: process.env,
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

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealthz({ child, baseUrl, logs, timeoutMs: 15_000 });
  return { child, baseUrl, logs };
};

const stopCliProcess = async (
  child: ChildProcessWithoutNullStreams,
): Promise<void> => {
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
    sleep(5_000).then(() => false),
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
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200) {
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

const submitFixtureJob = async ({
  baseUrl,
}: {
  baseUrl: string;
}): Promise<string> => {
  const response = await fetch(`${baseUrl}/workspace/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      figmaSourceMode: "local_json",
      figmaJsonPath: FIXTURE_PATH,
      llmCodegenMode: "deterministic",
      enableGitPr: false,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  assert.equal(response.status, 202, "submit must return 202");
  const payload = (await response.json()) as Record<string, unknown>;
  const jobId = payload.jobId;
  assert.equal(typeof jobId, "string", "submit payload must include jobId");
  return jobId;
};

const submitPasteFixtureJob = async ({
  baseUrl,
}: {
  baseUrl: string;
}): Promise<string> => {
  const response = await fetch(`${baseUrl}/workspace/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: FIXTURE_PAYLOAD,
      llmCodegenMode: "deterministic",
      enableGitPr: false,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  assert.equal(response.status, 202, "paste submit must return 202");
  const payload = (await response.json()) as Record<string, unknown>;
  const jobId = payload.jobId;
  assert.equal(
    typeof jobId,
    "string",
    "paste submit payload must include jobId",
  );
  return jobId;
};

const pollJobStatus = async ({
  baseUrl,
  jobId,
  timeoutMs,
}: {
  baseUrl: string;
  jobId: string;
  timeoutMs: number;
}): Promise<JobPayload> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}`,
      {
        signal: AbortSignal.timeout(3_000),
      },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as JobPayload;

    if (
      body.status === "completed" ||
      body.status === "failed" ||
      body.status === "canceled"
    ) {
      return body;
    }

    await sleep(250);
  }

  throw new Error(
    `Job ${jobId} did not reach terminal state within ${timeoutMs}ms.`,
  );
};

const waitForPendingEndpoint = async ({
  baseUrl,
  jobId,
  endpoint,
}: {
  baseUrl: string;
  jobId: string;
  endpoint: "design-ir" | "figma-analysis" | "files" | "component-manifest";
}): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/${endpoint}`,
      {
        signal: AbortSignal.timeout(2_000),
      },
    );

    if (response.status === 409) {
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.error, "JOB_NOT_COMPLETED");
      return;
    }

    if (response.status === 200) {
      return;
    }

    await sleep(120);
  }

  throw new Error(
    `Did not observe an available or pending response for endpoint '${endpoint}'.`,
  );
};

const fetchDesignIr = async ({
  baseUrl,
  jobId,
}: {
  baseUrl: string;
  jobId: string;
}): Promise<DesignIrPayload> => {
  const response = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/design-ir`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as DesignIrPayload;
};

const fetchFigmaAnalysis = async ({
  baseUrl,
  jobId,
}: {
  baseUrl: string;
  jobId: string;
}): Promise<FigmaAnalysisPayload> => {
  const response = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/figma-analysis`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as FigmaAnalysisPayload;
};

const fetchFiles = async ({
  baseUrl,
  jobId,
  dir,
  limit,
  cursor,
}: {
  baseUrl: string;
  jobId: string;
  dir?: string;
  limit?: number | string;
  cursor?: string;
}): Promise<FilesPayload> => {
  const url = new URL(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files`,
  );
  if (dir) {
    url.searchParams.set("dir", dir);
  }
  if (limit !== undefined) {
    url.searchParams.set("limit", String(limit));
  }
  if (cursor !== undefined) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as FilesPayload;
};

const fetchComponentManifest = async ({
  baseUrl,
  jobId,
}: {
  baseUrl: string;
  jobId: string;
}): Promise<ComponentManifestPayload> => {
  const response = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/component-manifest`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as ComponentManifestPayload;
};

const fetchGeneratedFile = async ({
  baseUrl,
  jobId,
  filePath,
}: {
  baseUrl: string;
  jobId: string;
  filePath: string;
}): Promise<string> => {
  const response = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(filePath)}`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/i);
  return await response.text();
};

const assertCompletedFixtureArtifacts = async ({
  baseUrl,
  jobId,
}: {
  baseUrl: string;
  jobId: string;
}): Promise<void> => {
  const designIr = await fetchDesignIr({ baseUrl, jobId });
  const figmaAnalysis = await fetchFigmaAnalysis({ baseUrl, jobId });
  assert.equal(designIr.jobId, jobId);
  assert.equal(Array.isArray(designIr.screens), true);
  assert.equal(
    designIr.screens.length,
    2,
    "prototype-navigation fixture should expose exactly 2 screens",
  );
  assert.equal(typeof designIr.tokens, "object");
  assert.equal(figmaAnalysis.jobId, jobId);
  assert.equal(figmaAnalysis.artifactVersion, 1);
  assert.equal(typeof figmaAnalysis.sourceName, "string");
  assert.equal(figmaAnalysis.summary.pageCount >= 1, true);
  assert.equal(
    figmaAnalysis.summary.topLevelFrameCount,
    designIr.screens.length,
  );
  assert.equal(Array.isArray(figmaAnalysis.frameVariantGroups), true);
  assert.equal(Array.isArray(figmaAnalysis.appShellSignals), true);
  assert.equal(Array.isArray(figmaAnalysis.componentDensity.byFrame), true);

  for (const screen of designIr.screens) {
    assert.equal(typeof screen.id, "string");
    assert.equal(typeof screen.name, "string");
    assert.equal(Array.isArray(screen.children), true);

    assert.equal(
      typeof screen.generatedFile,
      "string",
      `screen '${screen.id}' must include generatedFile mapping`,
    );
    assert.match(screen.generatedFile ?? "", /^src\/(pages|screens)\//);
    assert.equal(screen.generatedFile?.endsWith(".tsx"), true);
    assert.equal(
      screen.generatedFile?.startsWith("/"),
      false,
      "generatedFile must not expose absolute paths",
    );
  }

  const fileList = await fetchFiles({ baseUrl, jobId });
  assert.equal(fileList.jobId, jobId);
  assert.equal(fileList.files.length > 0, true);

  const filePaths = fileList.files.map((entry) => entry.path);
  assert.equal(filePaths.includes("src/App.tsx"), true);
  assert.equal(filePaths.includes("src/pages/home.tsx"), true);
  assert.equal(filePaths.includes("src/pages/details.tsx"), true);
  assert.equal(
    filePaths.some((entry) => /tailwind\.config/.test(entry)),
    false,
  );
  assert.equal(
    filePaths.some(
      (entry) =>
        (entry.endsWith(".css") || entry.endsWith(".scss")) &&
        entry !== "src/theme/tokens.css" &&
        entry !== "src/styles.css",
    ),
    false,
  );

  for (const file of fileList.files) {
    assert.equal(
      file.path.startsWith("/"),
      false,
      "listed files must always be relative paths",
    );
    assert.equal(
      file.path.includes("node_modules"),
      false,
      "node_modules must be excluded from listing",
    );
    assert.equal(
      file.path.startsWith("dist/"),
      false,
      "dist directory must be excluded from listing",
    );
    assert.equal(typeof file.sizeBytes, "number");
  }

  const screenDirFiles = await fetchFiles({
    baseUrl,
    jobId,
    dir: "src/pages",
  });
  assert.equal(screenDirFiles.files.length >= 2, true);
  for (const file of screenDirFiles.files) {
    assert.equal(file.path.startsWith("src/pages/"), true);
  }

  const homeContent = await fetchGeneratedFile({
    baseUrl,
    jobId,
    filePath: "src/pages/home.tsx",
  });
  assert.equal(homeContent.length > 0, true);
  assert.equal(homeContent.includes("sx={"), false);
  assert.equal(homeContent.includes("className"), true);

  const traversalResponse = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/..%2F..%2Fetc%2Fpasswd.ts`,
    { signal: AbortSignal.timeout(3_000) },
  );
  assert.equal(traversalResponse.status, 403);
  const traversalBody = (await traversalResponse.json()) as Record<
    string,
    unknown
  >;
  assert.equal(traversalBody.error, "FORBIDDEN_PATH");

  const blockedDirFilterResponse = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files?dir=node_modules`,
    { signal: AbortSignal.timeout(3_000) },
  );
  assert.equal(blockedDirFilterResponse.status, 403);
  const blockedDirFilterBody =
    (await blockedDirFilterResponse.json()) as Record<string, unknown>;
  assert.equal(blockedDirFilterBody.error, "FORBIDDEN_PATH");

  const blockedExtensionResponse = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/script.js`,
    { signal: AbortSignal.timeout(3_000) },
  );
  assert.equal(blockedExtensionResponse.status, 403);

  const missingFileResponse = await fetch(
    `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/files/src/pages/does-not-exist.tsx`,
    { signal: AbortSignal.timeout(3_000) },
  );
  assert.equal(missingFileResponse.status, 404);

  const manifest = await fetchComponentManifest({ baseUrl, jobId });
  assert.equal(manifest.jobId, jobId);
  assert.equal(manifest.screens.length, 2);

  const previewIndexResponse = await fetch(
    `${baseUrl}/workspace/repros/${encodeURIComponent(jobId)}/`,
    { signal: AbortSignal.timeout(5_000) },
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
    assert.equal(
      designScreenIds.has(screen.screenId),
      true,
      "manifest screen must map to design-ir screen",
    );
    assert.equal(typeof screen.screenName, "string");
    assert.equal(typeof screen.file, "string");
    assert.equal(Array.isArray(screen.components), true);
    assert.equal(
      filePaths.includes(screen.file),
      true,
      `manifest screen file '${screen.file}' must exist in files list`,
    );

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
        assert.equal(
          component.extractedComponent,
          true,
          "extractedComponent must be true when present",
        );
      }
    }
  }
};

test("inspector endpoints: unknown jobs return 404", async () => {
  const running = await startCliProcess();

  try {
    for (const endpoint of [
      "design-ir",
      "figma-analysis",
      "files",
      "component-manifest",
    ] as const) {
      const response = await fetch(
        `${running.baseUrl}/workspace/jobs/nonexistent-job/${endpoint}`,
        {
          signal: AbortSignal.timeout(2_000),
        },
      );
      assert.equal(
        response.status,
        404,
        `${endpoint} should return 404 for unknown job`,
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.error, "JOB_NOT_FOUND");
    }
  } finally {
    await stopCliProcess(running.child);
  }
});

test(
  "inspector endpoints: pending jobs gate terminal artifacts and may expose running files",
  { timeout: 120_000 },
  async () => {
    const running = await startCliProcess();

    try {
      const jobId = await submitFixtureJob({ baseUrl: running.baseUrl });

      await waitForPendingEndpoint({
        baseUrl: running.baseUrl,
        jobId,
        endpoint: "design-ir",
      });
      await waitForPendingEndpoint({
        baseUrl: running.baseUrl,
        jobId,
        endpoint: "figma-analysis",
      });
      await waitForPendingEndpoint({
        baseUrl: running.baseUrl,
        jobId,
        endpoint: "files",
      });
      await waitForPendingEndpoint({
        baseUrl: running.baseUrl,
        jobId,
        endpoint: "component-manifest",
      });

      const terminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        terminal.status,
        "completed",
        "fixture-backed job must complete successfully",
      );
    } finally {
      await stopCliProcess(running.child);
    }
  },
);

test(
  "inspector endpoints: completed jobs expose expected payloads and files security constraints",
  { timeout: 120_000 },
  async () => {
    const running = await startCliProcess();

    try {
      const jobId = await submitFixtureJob({ baseUrl: running.baseUrl });
      const terminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        terminal.status,
        "completed",
        "fixture-backed job must complete successfully",
      );
      await assertCompletedFixtureArtifacts({
        baseUrl: running.baseUrl,
        jobId,
      });
    } finally {
      await stopCliProcess(running.child);
    }
  },
);

test(
  "inspector endpoints: file listing supports cursor-based pagination and clamps limit",
  { timeout: 120_000 },
  async () => {
    const running = await startCliProcess();

    try {
      const jobId = await submitFixtureJob({ baseUrl: running.baseUrl });
      const terminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        terminal.status,
        "completed",
        "fixture-backed job must complete successfully",
      );

      // Full listing (default limit) — baseline for comparison.
      const full = await fetchFiles({ baseUrl: running.baseUrl, jobId });
      assert.equal(full.files.length > 0, true, "fixture should list files");
      assert.equal(
        full.nextCursor,
        undefined,
        "fixture has fewer than 500 files so no cursor is expected",
      );
      const totalCount = full.files.length;
      assert.equal(
        totalCount >= 3,
        true,
        "fixture must produce at least 3 files to exercise pagination",
      );

      // Bounded listing: limit = N-1 returns exactly N-1 files + nextCursor.
      const firstPageLimit = totalCount - 1;
      const firstPage = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId,
        limit: firstPageLimit,
      });
      assert.equal(firstPage.files.length, firstPageLimit);
      assert.equal(typeof firstPage.nextCursor, "string");
      assert.equal(
        firstPage.nextCursor,
        firstPage.files[firstPage.files.length - 1]?.path,
        "nextCursor must equal the last emitted path",
      );
      assert.deepEqual(
        firstPage.files.map((entry) => entry.path),
        full.files.slice(0, firstPageLimit).map((entry) => entry.path),
      );

      // Cursor pagination: a follow-up request returns the remainder with no cursor.
      const secondPage = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId,
        limit: firstPageLimit,
        cursor: firstPage.nextCursor,
      });
      assert.equal(secondPage.files.length, totalCount - firstPageLimit);
      assert.equal(
        secondPage.nextCursor,
        undefined,
        "last page must omit nextCursor",
      );
      assert.deepEqual(
        secondPage.files.map((entry) => entry.path),
        full.files.slice(firstPageLimit).map((entry) => entry.path),
      );

      // Last page: a limit larger than total returns all files and no cursor.
      const unbounded = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId,
        limit: totalCount + 50,
      });
      assert.equal(unbounded.files.length, totalCount);
      assert.equal(unbounded.nextCursor, undefined);

      // Clamp: an out-of-range limit is accepted and never returns more than 1000 files.
      const clamped = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId,
        limit: 9999,
      });
      assert.equal(
        clamped.files.length <= 1000,
        true,
        "limit must be clamped to 1000",
      );
      assert.deepEqual(
        clamped.files.map((entry) => entry.path),
        full.files.map((entry) => entry.path),
      );

      // Invalid limit value falls back to the 500 default.
      const invalid = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId,
        limit: "not-a-number",
      });
      assert.deepEqual(
        invalid.files.map((entry) => entry.path),
        full.files.map((entry) => entry.path),
      );
    } finally {
      await stopCliProcess(running.child);
    }
  },
);

test(
  "inspector endpoints: completed figma_paste jobs expose the same inspector-consumable artifacts",
  { timeout: 120_000 },
  async () => {
    const running = await startCliProcess();

    try {
      const jobId = await submitPasteFixtureJob({ baseUrl: running.baseUrl });
      const terminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        terminal.status,
        "completed",
        "paste-backed job must complete successfully",
      );

      await assertCompletedFixtureArtifacts({
        baseUrl: running.baseUrl,
        jobId,
      });
    } finally {
      await stopCliProcess(running.child);
    }
  },
);

test(
  "inspector endpoints: fixture runs are deterministic across repeated submissions",
  { timeout: 240_000 },
  async () => {
    const running = await startCliProcess();

    try {
      const firstJobId = await submitFixtureJob({ baseUrl: running.baseUrl });
      const firstTerminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId: firstJobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        firstTerminal.status,
        "completed",
        "first fixture run must complete",
      );

      const secondJobId = await submitFixtureJob({ baseUrl: running.baseUrl });
      const secondTerminal = await pollJobStatus({
        baseUrl: running.baseUrl,
        jobId: secondJobId,
        timeoutMs: 120_000,
      });
      assert.equal(
        secondTerminal.status,
        "completed",
        "second fixture run must complete",
      );

      const firstDesignIr = await fetchDesignIr({
        baseUrl: running.baseUrl,
        jobId: firstJobId,
      });
      const secondDesignIr = await fetchDesignIr({
        baseUrl: running.baseUrl,
        jobId: secondJobId,
      });

      const firstManifest = await fetchComponentManifest({
        baseUrl: running.baseUrl,
        jobId: firstJobId,
      });
      const secondManifest = await fetchComponentManifest({
        baseUrl: running.baseUrl,
        jobId: secondJobId,
      });

      const firstFiles = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId: firstJobId,
      });
      const secondFiles = await fetchFiles({
        baseUrl: running.baseUrl,
        jobId: secondJobId,
      });

      const normalizeDesignIr = ({
        jobId: _jobId,
        ...payload
      }: DesignIrPayload): Omit<DesignIrPayload, "jobId"> => payload;
      const normalizeManifest = ({
        jobId: _jobId,
        ...payload
      }: ComponentManifestPayload): Omit<ComponentManifestPayload, "jobId"> =>
        payload;

      assert.deepEqual(
        normalizeDesignIr(firstDesignIr),
        normalizeDesignIr(secondDesignIr),
      );
      assert.deepEqual(
        normalizeManifest(firstManifest),
        normalizeManifest(secondManifest),
      );
      assert.deepEqual(
        firstFiles.files.map((entry) => entry.path),
        secondFiles.files.map((entry) => entry.path),
        "generated file path list must stay deterministic across repeated fixture runs",
      );

      const firstHomeContent = await fetch(
        `${running.baseUrl}/workspace/jobs/${encodeURIComponent(firstJobId)}/files/${encodeURIComponent("src/pages/home.tsx")}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      const secondHomeContent = await fetch(
        `${running.baseUrl}/workspace/jobs/${encodeURIComponent(secondJobId)}/files/${encodeURIComponent("src/pages/home.tsx")}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      assert.equal(firstHomeContent.status, 200);
      assert.equal(secondHomeContent.status, 200);
      assert.equal(
        await firstHomeContent.text(),
        await secondHomeContent.text(),
      );
    } finally {
      await stopCliProcess(running.child);
    }
  },
);
