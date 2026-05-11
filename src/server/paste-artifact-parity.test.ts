/**
 * HTTP-level artifact parity tests for figma_paste vs local_json (Issue #988, Wave 3).
 *
 * Submitting the same fixture via `local_json` (file path) and via `figma_paste`
 * (inline JSON payload) MUST produce identical generated artifacts. The paste
 * handler normalizes into `local_json` before queueing the job, so the only
 * expected differences between the two HTTP responses are non-deterministic
 * fields (job IDs, timestamps, tmp paths). After normalizing those away,
 * `design-ir`, `component-manifest`, and the `/files` listing should match.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkspaceServer } from "../server.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  MODULE_DIR,
  "../parity/fixtures/golden/rocket/prototype-navigation/figma.json",
);
const ENVELOPE_FIXTURE_PATH = path.resolve(
  MODULE_DIR,
  "../../integration/fixtures/figma-paste-pipeline/envelopes/single-selection-envelope.json",
);

const PARITY_JOB_TIMEOUT_MS = 120_000;
const REQUIRED_DEFAULT_FIXTURE_FILES = [
  "component-manifest.json",
  "quality-passport.json",
  "src/App.tsx",
  "src/pages/home.tsx",
  "src/pages/details.tsx",
  "src/styles.css",
  "src/theme/tokens.css",
  "src/theme/tokens.json",
] as const;

interface WorkspaceServerInstance {
  app: {
    inject: (opts: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: unknown;
    }) => Promise<{
      statusCode: number;
      json: <T = unknown>() => T;
      body: string;
    }>;
    close: () => Promise<void>;
  };
}

const createTempWorkspaceLayout = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-paste-parity-"));
  const workspaceRoot = path.join(root, "workspace");
  return {
    root,
    workspaceRoot,
    outputRoot: path.join(root, "workspace-output"),
  };
};

const allocateRandomPort = (): number => 0;

const waitForJobTerminalState = async ({
  server,
  jobId,
  timeoutMs,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}`,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();
    if (body.status === "completed") {
      return body;
    }
    if (
      body.status === "failed" ||
      body.status === "canceled" ||
      body.status === "partial"
    ) {
      throw new Error(
        `Job ${jobId} reached unexpected terminal status ${body.status}: ${JSON.stringify(body)}`,
      );
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }
  throw new Error(`Timed out waiting for terminal state of job ${jobId}`);
};

const submitLocalJsonJob = async ({
  server,
  fixturePath,
}: {
  server: WorkspaceServerInstance;
  fixturePath: string;
}): Promise<string> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "local_json",
      figmaJsonPath: fixturePath,
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(
    response.statusCode,
    202,
    `local_json submit expected 202, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<Record<string, unknown>>();
  const jobId = body.jobId;
  assert.equal(typeof jobId, "string");
  return String(jobId);
};

const submitPasteJob = async ({
  server,
  payload,
}: {
  server: WorkspaceServerInstance;
  payload: string;
}): Promise<string> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: payload,
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(
    response.statusCode,
    202,
    `figma_paste submit expected 202, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<Record<string, unknown>>();
  const jobId = body.jobId;
  assert.equal(typeof jobId, "string");
  return String(jobId);
};

const submitPluginJob = async ({
  server,
  payload,
}: {
  server: WorkspaceServerInstance;
  payload: string;
}): Promise<string> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "figma_plugin",
      figmaJsonPayload: payload,
      importIntent: "FIGMA_PLUGIN_ENVELOPE",
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(
    response.statusCode,
    202,
    `figma_plugin submit expected 202, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<Record<string, unknown>>();
  const jobId = body.jobId;
  assert.equal(typeof jobId, "string");
  return String(jobId);
};

/**
 * Strip non-deterministic fields so two responses from different jobs can be
 * compared for semantic equality. The only expected divergence between
 * local_json and figma_paste is the job ID.
 */
const normalizeForComparison = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const normalized: Record<string, unknown> = {};
    for (const [key, raw] of entries) {
      if (key === "jobId" || key === "validatedAt" || key === "generatedAt") continue;
      normalized[key] = normalizeForComparison(raw);
    }
    return normalized;
  }
  return value;
};

const normalizeGeneratedFileContent = ({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}): string => {
  if (!filePath.endsWith(".json")) {
    return content;
  }
  try {
    return `${JSON.stringify(normalizeForComparison(JSON.parse(content)))}\n`;
  } catch {
    return content;
  }
};

const fetchDesignIr = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/design-ir`,
  });
  assert.equal(
    response.statusCode,
    200,
    `design-ir expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.json<Record<string, unknown>>();
};

const fetchComponentManifest = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/component-manifest`,
  });
  assert.equal(
    response.statusCode,
    200,
    `component-manifest expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.json<Record<string, unknown>>();
};

interface FileEntry {
  path: string;
  sizeBytes: number;
}

const fetchFilesListing = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<FileEntry[]> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/files`,
  });
  assert.equal(
    response.statusCode,
    200,
    `files expected 200, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<{ files: FileEntry[] }>();
  return body.files;
};

const fetchGeneratedFileContent = async ({
  server,
  jobId,
  filePath,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
  filePath: string;
}): Promise<string> => {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/files/${encodedPath}`,
  });
  assert.equal(
    response.statusCode,
    200,
    `file ${filePath} expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.body;
};

const runParityJobs = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
  server: WorkspaceServerInstance;
  localJobId: string;
  pasteJobId: string;
}> => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  await mkdir(workspaceRoot, { recursive: true });
  const port = allocateRandomPort();
  // local_json mode never performs a network fetch; reject to prove it.
  const server = (await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: async () => {
      throw new Error("Unexpected network fetch in parity test.");
    },
  })) as WorkspaceServerInstance;

  const localFixturePath = path.join(workspaceRoot, "parity-local-fixture.json");
  const fixtureContent = readFileSync(FIXTURE_PATH, "utf8");
  await writeFile(localFixturePath, fixtureContent, "utf8");

  const localJobId = await submitLocalJsonJob({
    server,
    fixturePath: localFixturePath,
  });
  const pasteJobId = await submitPasteJob({ server, payload: fixtureContent });

  await waitForJobTerminalState({
    server,
    jobId: localJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });
  await waitForJobTerminalState({
    server,
    jobId: pasteJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });

  return { root, workspaceRoot, outputRoot, server, localJobId, pasteJobId };
};

/**
 * Suite 1 runner — figma_plugin mode dispatch (raw Figma doc payload).
 *
 * figma_plugin accepts a raw Figma document JSON as figmaJsonPayload (it only
 * invokes envelope normalization when the payload looks like a ClipboardEnvelope).
 * When fed the same raw fixture as local_json, both jobs must produce identical
 * design-ir / manifest / files artifacts.
 */
const runPluginParityJobsRawDoc = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
  server: WorkspaceServerInstance;
  localJobId: string;
  pluginJobId: string;
}> => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  await mkdir(workspaceRoot, { recursive: true });
  const port = allocateRandomPort();
  const server = (await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: async () => {
      throw new Error("Unexpected network fetch in parity test.");
    },
  })) as WorkspaceServerInstance;

  const localFixturePath = path.join(workspaceRoot, "parity-local-fixture.json");
  const fixtureContent = readFileSync(FIXTURE_PATH, "utf8");
  await writeFile(localFixturePath, fixtureContent, "utf8");

  const localJobId = await submitLocalJsonJob({
    server,
    fixturePath: localFixturePath,
  });
  const pluginJobId = await submitPluginJob({
    server,
    payload: fixtureContent,
  });

  await waitForJobTerminalState({
    server,
    jobId: localJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });
  await waitForJobTerminalState({
    server,
    jobId: pluginJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });

  return { root, workspaceRoot, outputRoot, server, localJobId, pluginJobId };
};

/**
 * Suite 2 runner — figma_plugin ↔ figma_paste envelope equivalence.
 *
 * Both modes funnel ClipboardEnvelope payloads through the same
 * normalizeEnvelopeToFigmaFile path in request-handler.ts. Submitting the same
 * envelope JSON to both modes must produce identical artifacts.
 */
const runPluginPasteParityEnvelope = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
  server: WorkspaceServerInstance;
  pluginJobId: string;
  pasteJobId: string;
}> => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  await mkdir(workspaceRoot, { recursive: true });
  const port = allocateRandomPort();
  const server = (await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: async () => {
      throw new Error("Unexpected network fetch in parity test.");
    },
  })) as WorkspaceServerInstance;

  const envelopeContent = readFileSync(ENVELOPE_FIXTURE_PATH, "utf8");

  const pluginJobId = await submitPluginJob({
    server,
    payload: envelopeContent,
  });
  const pasteJobId = await submitPasteJob({
    server,
    payload: envelopeContent,
  });

  await waitForJobTerminalState({
    server,
    jobId: pluginJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });
  await waitForJobTerminalState({
    server,
    jobId: pasteJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });

  return { root, workspaceRoot, outputRoot, server, pluginJobId, pasteJobId };
};

test("waitForJobTerminalState fails fast on partial terminal jobs", async () => {
  const server: WorkspaceServerInstance = {
    app: {
      inject: async () => ({
        statusCode: 200,
        json: () =>
          ({
            jobId: "job-partial",
            status: "partial",
            outcome: "partial",
          }) as Record<string, unknown>,
        body: '{"jobId":"job-partial","status":"partial","outcome":"partial"}',
      }),
      close: async () => {},
    },
  };

  await assert.rejects(
    waitForJobTerminalState({
      server,
      jobId: "job-partial",
      timeoutMs: 1_000,
    }),
    /unexpected terminal status partial/,
  );
});

test(
  "figma_paste produces a design-ir equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localIr = await fetchDesignIr({ server, jobId: localJobId });
      const pasteIr = await fetchDesignIr({ server, jobId: pasteJobId });

      // Sanity: both jobs produced a non-empty screens list for this fixture.
      assert.ok(Array.isArray(localIr.screens));
      assert.ok(
        (localIr.screens as unknown[]).length >= 2,
        "fixture expected >= 2 screens in design-ir",
      );
      assert.equal(
        (localIr.screens as unknown[]).length,
        (pasteIr.screens as unknown[]).length,
        "paste and local screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localIr),
        normalizeForComparison(pasteIr),
        "design-ir payloads diverged between local_json and figma_paste modes",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_paste produces a component-manifest equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localManifest = await fetchComponentManifest({
        server,
        jobId: localJobId,
      });
      const pasteManifest = await fetchComponentManifest({
        server,
        jobId: pasteJobId,
      });

      // Sanity: manifest has the screens array present.
      assert.ok(Array.isArray(localManifest.screens));
      assert.equal(
        (localManifest.screens as unknown[]).length,
        (pasteManifest.screens as unknown[]).length,
        "component manifest screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localManifest),
        normalizeForComparison(pasteManifest),
        "component-manifest payloads diverged between local_json and figma_paste modes",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_paste produces identical generated files as local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localFiles = await fetchFilesListing({ server, jobId: localJobId });
      const pasteFiles = await fetchFilesListing({ server, jobId: pasteJobId });

      const localPaths = localFiles.map((entry) => entry.path).sort();
      const pastePaths = pasteFiles.map((entry) => entry.path).sort();

      assert.ok(
        localPaths.length > 0,
        "local_json mode should generate at least one file",
      );
      assert.deepEqual(
        localPaths,
        pastePaths,
        "generated file path sets diverged between local_json and figma_paste modes",
      );
      for (const expectedPath of REQUIRED_DEFAULT_FIXTURE_FILES) {
        assert.equal(
          localPaths.includes(expectedPath),
          true,
          `generated file set is missing ${expectedPath}`,
        );
      }

      for (const { path: filePath } of localFiles) {
        const [localContent, pasteContent] = await Promise.all([
          fetchGeneratedFileContent({
            server,
            jobId: localJobId,
            filePath,
          }),
          fetchGeneratedFileContent({
            server,
            jobId: pasteJobId,
            filePath,
          }),
        ]);
        assert.equal(
          normalizeGeneratedFileContent({ content: localContent, filePath }),
          normalizeGeneratedFileContent({ content: pasteContent, filePath }),
          `generated file contents diverged for ${filePath}`,
        );
      }
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Suite 1 — figma_plugin mode dispatch (raw Figma doc payload) vs local_json.
// ---------------------------------------------------------------------------

test(
  "figma_plugin produces a design-ir equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pluginJobId } =
      await runPluginParityJobsRawDoc();
    try {
      const localIr = await fetchDesignIr({ server, jobId: localJobId });
      const pluginIr = await fetchDesignIr({ server, jobId: pluginJobId });

      assert.ok(Array.isArray(localIr.screens));
      assert.ok(
        (localIr.screens as unknown[]).length >= 2,
        "fixture expected >= 2 screens in design-ir",
      );
      assert.equal(
        (localIr.screens as unknown[]).length,
        (pluginIr.screens as unknown[]).length,
        "plugin and local screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localIr),
        normalizeForComparison(pluginIr),
        "design-ir payloads diverged between local_json and figma_plugin modes",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_plugin produces a component-manifest equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pluginJobId } =
      await runPluginParityJobsRawDoc();
    try {
      const localManifest = await fetchComponentManifest({
        server,
        jobId: localJobId,
      });
      const pluginManifest = await fetchComponentManifest({
        server,
        jobId: pluginJobId,
      });

      assert.ok(Array.isArray(localManifest.screens));
      assert.equal(
        (localManifest.screens as unknown[]).length,
        (pluginManifest.screens as unknown[]).length,
        "component manifest screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localManifest),
        normalizeForComparison(pluginManifest),
        "component-manifest payloads diverged between local_json and figma_plugin modes",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_plugin produces identical generated files as local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, localJobId, pluginJobId } =
      await runPluginParityJobsRawDoc();
    try {
      const localFiles = await fetchFilesListing({ server, jobId: localJobId });
      const pluginFiles = await fetchFilesListing({
        server,
        jobId: pluginJobId,
      });

      const localPaths = localFiles.map((entry) => entry.path).sort();
      const pluginPaths = pluginFiles.map((entry) => entry.path).sort();

      assert.ok(
        localPaths.length > 0,
        "local_json mode should generate at least one file",
      );
      assert.deepEqual(
        localPaths,
        pluginPaths,
        "generated file path sets diverged between local_json and figma_plugin modes",
      );
      for (const expectedPath of REQUIRED_DEFAULT_FIXTURE_FILES) {
        assert.equal(
          localPaths.includes(expectedPath),
          true,
          `generated file set is missing ${expectedPath}`,
        );
      }

      for (const { path: filePath } of localFiles) {
        const [localContent, pluginContent] = await Promise.all([
          fetchGeneratedFileContent({
            server,
            jobId: localJobId,
            filePath,
          }),
          fetchGeneratedFileContent({
            server,
            jobId: pluginJobId,
            filePath,
          }),
        ]);
        assert.equal(
          normalizeGeneratedFileContent({ content: localContent, filePath }),
          normalizeGeneratedFileContent({ content: pluginContent, filePath }),
          `generated file contents diverged for ${filePath}`,
        );
      }
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Suite 2 — figma_plugin ↔ figma_paste envelope equivalence.
//
// Both modes share the ClipboardEnvelope normalization path in
// request-handler.ts. Submitting the same envelope JSON to both modes must
// yield identical design-ir, component-manifest, and generated files.
// ---------------------------------------------------------------------------

test(
  "figma_plugin and figma_paste produce an equivalent design-ir for the same ClipboardEnvelope",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, pluginJobId, pasteJobId } =
      await runPluginPasteParityEnvelope();
    try {
      const pluginIr = await fetchDesignIr({ server, jobId: pluginJobId });
      const pasteIr = await fetchDesignIr({ server, jobId: pasteJobId });

      assert.ok(Array.isArray(pluginIr.screens));
      assert.ok(
        (pluginIr.screens as unknown[]).length >= 1,
        "envelope fixture expected to produce >= 1 screen",
      );
      assert.equal(
        (pluginIr.screens as unknown[]).length,
        (pasteIr.screens as unknown[]).length,
        "plugin and paste screen counts must match for shared envelope",
      );

      assert.deepEqual(
        normalizeForComparison(pluginIr),
        normalizeForComparison(pasteIr),
        "design-ir diverged between figma_plugin and figma_paste for the same envelope payload",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_plugin and figma_paste produce an equivalent component-manifest for the same ClipboardEnvelope",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, pluginJobId, pasteJobId } =
      await runPluginPasteParityEnvelope();
    try {
      const pluginManifest = await fetchComponentManifest({
        server,
        jobId: pluginJobId,
      });
      const pasteManifest = await fetchComponentManifest({
        server,
        jobId: pasteJobId,
      });

      assert.ok(Array.isArray(pluginManifest.screens));
      assert.equal(
        (pluginManifest.screens as unknown[]).length,
        (pasteManifest.screens as unknown[]).length,
        "component-manifest screen counts must match for shared envelope",
      );

      assert.deepEqual(
        normalizeForComparison(pluginManifest),
        normalizeForComparison(pasteManifest),
        "component-manifest diverged between figma_plugin and figma_paste for the same envelope payload",
      );
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "figma_plugin and figma_paste produce identical generated files for the same ClipboardEnvelope",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { root, server, pluginJobId, pasteJobId } =
      await runPluginPasteParityEnvelope();
    try {
      const pluginFiles = await fetchFilesListing({
        server,
        jobId: pluginJobId,
      });
      const pasteFiles = await fetchFilesListing({ server, jobId: pasteJobId });

      const pluginPaths = pluginFiles.map((entry) => entry.path).sort();
      const pastePaths = pasteFiles.map((entry) => entry.path).sort();

      assert.ok(
        pluginPaths.length > 0,
        "figma_plugin envelope run should generate at least one file",
      );
      assert.deepEqual(
        pluginPaths,
        pastePaths,
        "generated file path sets diverged between figma_plugin and figma_paste for the same envelope payload",
      );

      for (const { path: filePath } of pluginFiles) {
        const [pluginContent, pasteContent] = await Promise.all([
          fetchGeneratedFileContent({
            server,
            jobId: pluginJobId,
            filePath,
          }),
          fetchGeneratedFileContent({
            server,
            jobId: pasteJobId,
            filePath,
          }),
        ]);
        assert.equal(
          normalizeGeneratedFileContent({ content: pluginContent, filePath }),
          normalizeGeneratedFileContent({ content: pasteContent, filePath }),
          `generated file contents diverged for ${filePath} between figma_plugin and figma_paste`,
        );
      }
    } finally {
      await server.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
