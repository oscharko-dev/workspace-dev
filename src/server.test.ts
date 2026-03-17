import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkspaceServer } from "./server.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_NODE_MODULES_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app/node_modules");

const createLocalFigmaPayload = () => ({
  name: "Workspace Dev Demo",
  document: {
    id: "0:1",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          {
            id: "2:1",
            name: "Landing",
            type: "FRAME",
            absoluteBoundingBox: { width: 1440, height: 1024 },
            children: [
              { id: "3:1", name: "Header", type: "FRAME", children: [] },
              { id: "3:2", name: "Hero", type: "FRAME", children: [] }
            ]
          },
          {
            id: "2:2",
            name: "Checkout",
            type: "FRAME",
            absoluteBoundingBox: { width: 390, height: 844 },
            children: [{ id: "4:1", name: "Container", type: "FRAME", children: [] }]
          }
        ]
      }
    ]
  }
});

const createFakeFigmaFetch = (): typeof fetch => {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("https://api.figma.com/v1/files/")) {
      return new Response(JSON.stringify({ error: "unexpected-url" }), {
        status: 404,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    const payload = createLocalFigmaPayload();

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  };
};

const waitForJobTerminalState = async ({
  server,
  jobId,
  timeoutMs = 10_000
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  jobId: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();

    if (body.status === "completed" || body.status === "failed") {
      return body;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }

  throw new Error(`Timed out waiting for terminal state of job ${jobId}`);
};

const createTempOutputRoot = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-"));
};

const isPathWithinRoot = ({ candidatePath, rootPath }: { candidatePath: string; rootPath: string }): boolean => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
};

const collectSymlinkTargets = async ({ rootDir }: { rootDir: string }): Promise<string[]> => {
  const pendingDirs: string[] = [rootDir];
  const resolvedTargets: string[] = [];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
        continue;
      }
      if (!entry.isSymbolicLink()) {
        continue;
      }
      const target = await readlink(entryPath);
      resolvedTargets.push(path.resolve(path.dirname(entryPath), target));
    }
  }

  return resolvedTargets;
};

const extractUiAssetUrls = ({ html }: { html: string }): string[] => {
  const matches = [...html.matchAll(/(?:src|href)=["'](\/workspace\/ui\/assets\/[^"']+)["']/g)];
  const urls = new Set(matches.map((match) => match[1]).filter((entry): entry is string => Boolean(entry)));
  return [...urls];
};

test("workspace server starts and responds on /workspace", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspace"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.running, true);
    assert.equal(body.figmaSourceMode, "rest");
    assert.equal(body.llmCodegenMode, "deterministic");
    assert.equal(body.port, port);
    assert.equal(typeof body.uptimeMs, "number");
    assert.equal(typeof body.outputRoot, "string");
    assert.equal(body.previewEnabled, true);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server healthz endpoint", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/healthz"
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, service: "workspace-dev" });
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server serves UI entrypoint on /workspace/ui and /workspace/:key", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const uiResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/ui"
    });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers["content-type"] ?? "", /text\/html/i);
    assert.match(uiResponse.body, /Workspace Dev/i);

    const workspacePathResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/1BvardU9Dtxq2WBTzSRm2S"
    });
    assert.equal(workspacePathResponse.statusCode, 200);
    assert.match(workspacePathResponse.headers["content-type"] ?? "", /text\/html/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server serves UI static assets", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const uiResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/ui"
    });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers["content-type"] ?? "", /text\/html/i);

    const assetUrls = extractUiAssetUrls({ html: uiResponse.body });
    assert.ok(assetUrls.length > 0, "Expected UI entrypoint to reference bundled assets.");
    assert.ok(assetUrls.some((url) => url.endsWith(".css")), "Expected at least one bundled CSS asset.");
    assert.ok(assetUrls.some((url) => url.endsWith(".js")), "Expected at least one bundled JS asset.");

    for (const url of assetUrls) {
      const assetResponse = await server.app.inject({
        method: "GET",
        url
      });
      assert.equal(assetResponse.statusCode, 200, `Expected ${url} to be served`);
      if (url.endsWith(".css")) {
        assert.match(assetResponse.headers["content-type"] ?? "", /text\/css/i);
      }
      if (url.endsWith(".js")) {
        assert.match(assetResponse.headers["content-type"] ?? "", /javascript/i);
      }
    }
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server reports unknown route with deterministic 404 envelope", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/not-found"
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "NOT_FOUND");
    assert.match(String(body.message), /Unknown route/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server blocks mcp mode on submit", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "mcp",
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        repoUrl: "https://github.com/example/repo.git",
        repoToken: "ghp_xxx"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "MODE_LOCK_VIOLATION");
    assert.match(String(body.message), /mcp.*not available/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects invalid JSON payloads", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: "{\"figmaFileKey\":"
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.equal(Array.isArray(body.issues), true);
    assert.match(String((body.issues as Array<{ message: string }>)[0]!.message), /Invalid JSON payload/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects submit requests without required fields", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "demo"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects ambiguous source inputs that mix rest and local_json fields", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "local_json",
        figmaJsonPath: "./figma.json",
        figmaFileKey: "demo",
        figmaAccessToken: "figd_xxx"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server accepts submit with 202 and job polling reaches completed", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const acceptedModes = submitBody.acceptedModes as Record<string, unknown>;
    assert.equal(submitBody.status, "queued");
    assert.equal(acceptedModes.figmaSourceMode, "rest");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");
    assert.equal(typeof submitBody.jobId, "string");

    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({ server, jobId, timeoutMs: 120_000 });
    const request = finalStatus.request as Record<string, unknown>;
    const preview = finalStatus.preview as Record<string, unknown>;
    assert.equal(finalStatus.status, "completed");
    assert.equal(request.repoToken, undefined);
    assert.equal(request.enableGitPr, false);
    assert.equal(request.brandTheme, "derived");
    assert.equal(request.generationLocale, "de-DE");
    assert.equal(preview.enabled, true);

    const generatedProjectDir = path.join(outputRoot, "jobs", jobId, "generated-app");
    const symlinkTargets = await collectSymlinkTargets({ rootDir: generatedProjectDir });
    const hasTemplateNodeModulesSymlink = symlinkTargets.some((target) =>
      isPathWithinRoot({ candidatePath: target, rootPath: TEMPLATE_NODE_MODULES_ROOT })
    );
    assert.equal(
      hasTemplateNodeModulesSymlink,
      false,
      "Generated app must not keep symlinks into template node_modules."
    );
    const generatedRootEntries = await readdir(generatedProjectDir);
    assert.equal(
      generatedRootEntries.includes("artifacts"),
      false,
      "Generated app must not include template artifacts directory."
    );

    const resultResponse = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}/result`
    });
    assert.equal(resultResponse.statusCode, 200);
    const resultBody = resultResponse.json<Record<string, unknown>>();
    assert.equal(resultBody.status, "completed");
    assert.match(String(resultBody.summary), /completed successfully/i);

    const previewResponse = await server.app.inject({
      method: "GET",
      url: `/workspace/repros/${jobId}/`
    });
    assert.equal(previewResponse.statusCode, 200);
    assert.match(previewResponse.headers["content-type"] ?? "", /text\/html/i);
    assert.equal(previewResponse.body.includes('<div id="root"></div>'), true);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server accepts local_json submit and completes without Figma REST fetches", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const localJsonPath = path.join(outputRoot, "local-figma.json");
  await writeFile(localJsonPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  let fetchCalls = 0;
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("Unexpected network fetch in local_json mode.");
    }
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "local_json",
        figmaJsonPath: localJsonPath,
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const acceptedModes = submitBody.acceptedModes as Record<string, unknown>;
    assert.equal(acceptedModes.figmaSourceMode, "local_json");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");

    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({ server, jobId, timeoutMs: 120_000 });
    const request = finalStatus.request as Record<string, unknown>;
    assert.equal(finalStatus.status, "completed");
    assert.equal(request.figmaSourceMode, "local_json");
    assert.equal(request.figmaJsonPath, localJsonPath);
    assert.equal(request.figmaFileKey, undefined);
    assert.equal(fetchCalls, 0);

    const cleanedFigmaPath = path.join(outputRoot, "jobs", jobId, "figma.json");
    const cleanedFigma = await readFile(cleanedFigmaPath, "utf8");
    assert.match(cleanedFigma, /Workspace Dev Demo/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server fails validate.project when skipInstall=true and dependencies are missing", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    skipInstall: true,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({ server, jobId, timeoutMs: 120_000 });
    const error = finalStatus.error as Record<string, unknown> | undefined;

    assert.equal(finalStatus.status, "failed");
    assert.equal(error?.stage, "validate.project");
    assert.match(String(error?.message), /skipInstall=true requires an existing node_modules directory/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server resolves submit brandTheme and generationLocale overrides over server defaults", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    brandTheme: "sparkasse",
    generationLocale: "de-DE",
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        brandTheme: "derived",
        generationLocale: "en-US",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({ server, jobId, timeoutMs: 120_000 });
    const request = finalStatus.request as Record<string, unknown>;

    assert.equal(finalStatus.status, "completed");
    assert.equal(request.brandTheme, "derived");
    assert.equal(request.generationLocale, "en-US");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server applies hash router runtime mode to generated App shell", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    routerMode: "hash",
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({ server, jobId, timeoutMs: 120_000 });
    assert.equal(finalStatus.status, "completed");

    const appPath = path.join(outputRoot, "jobs", jobId, "generated-app", "src", "App.tsx");
    const appContent = await readFile(appPath, "utf8");
    assert.ok(appContent.includes("HashRouter"));
    assert.equal(appContent.includes("BrowserRouter"), false);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server exposes listening address metadata and clears it after close", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  const addressesBeforeClose = server.app.addresses();
  assert.equal(addressesBeforeClose.length > 0, true);
  assert.equal(addressesBeforeClose[0]?.port, server.port);

  await server.app.close();

  const addressesAfterClose = server.app.addresses();
  assert.equal(addressesAfterClose.length, 0);
  await rm(outputRoot, { recursive: true, force: true });
});

test("workspace server close is not silently idempotent", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });
  await server.app.close();
  await assert.rejects(async () => {
    await server.app.close();
  });
  await rm(outputRoot, { recursive: true, force: true });
});

test("workspace server returns JOB_NOT_FOUND for unknown job ids", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch()
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspace/jobs/does-not-exist"
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "JOB_NOT_FOUND");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});
