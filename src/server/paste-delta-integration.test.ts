/**
 * Integration tests for the paste delta-import flow (Issue #992).
 *
 * Exercises the submit path for `figma_paste` / `figma_plugin` modes and
 * asserts that the accepted response carries a correctly resolved
 * `pasteDeltaSummary` — including baseline creation, no-op reuse, partial
 * updates, structural break safety fallback, and graceful skip on unusable
 * payloads.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp, type WorkspaceServerApp } from "./app-inject.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";
import type { JobEngine } from "../job-engine.js";

interface PasteDeltaSummary {
  mode:
    | "full"
    | "delta"
    | "auto_resolved_to_full"
    | "auto_resolved_to_delta";
  strategy: "baseline_created" | "no_changes" | "delta" | "structural_break";
  totalNodes: number;
  nodesReused: number;
  nodesReprocessed: number;
  structuralChangeRatio: number;
  pasteIdentityKey: string;
  priorManifestMissing: boolean;
}

function createStubJobEngine(): JobEngine {
  return {
    submitJob: () =>
      ({
        jobId: "stub-job",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "local_json",
          llmCodegenMode: "deterministic",
        },
      }) as ReturnType<JobEngine["submitJob"]>,
  } as unknown as JobEngine;
}

async function createApp(): Promise<{
  app: WorkspaceServerApp;
  tempRoot: string;
  close: () => Promise<void>;
}> {
  const host = "127.0.0.1";
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-paste-delta-"),
  );
  let resolvedPort = 0;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    workspaceRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: { previewEnabled: false, rateLimitPerMinute: 100 },
    jobEngine: createStubJobEngine(),
    moduleDir: path.resolve(import.meta.dirname ?? ".", ".."),
  });

  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolvedPort = address.port;
      }
      resolve();
    });
  });

  const app = buildApp({ server, host, port: resolvedPort });
  return {
    app,
    tempRoot,
    close: async () => {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

interface TextNodeOpts {
  readonly id: string;
  readonly characters: string;
}
const makeText = ({ id, characters }: TextNodeOpts): Record<string, unknown> => ({
  id,
  type: "TEXT",
  characters,
});

interface FrameOpts {
  readonly id: string;
  readonly name: string;
  readonly children: readonly Record<string, unknown>[];
}
const makeFrame = ({ id, name, children }: FrameOpts): Record<string, unknown> => ({
  id,
  type: "FRAME",
  name,
  children: [...children],
});

const makeDoc = (
  children: readonly Record<string, unknown>[],
): { document: Record<string, unknown> } => ({
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [...children],
  },
});

const submitPaste = async ({
  app,
  payload,
  importMode,
}: {
  app: WorkspaceServerApp;
  payload: unknown;
  importMode?: "full" | "delta" | "auto";
}): Promise<{ statusCode: number; body: Record<string, unknown> }> => {
  const response = await app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "figma_plugin",
      figmaJsonPayload: JSON.stringify(payload),
      ...(importMode !== undefined ? { importMode } : {}),
    },
  });
  return {
    statusCode: response.statusCode,
    body: response.json<Record<string, unknown>>(),
  };
};

test("paste-delta: first paste creates baseline and persists manifest on disk", async () => {
  const { app, tempRoot, close } = await createApp();
  try {
    const payload = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [
          makeText({ id: "1:2", characters: "Welcome" }),
          makeText({ id: "1:3", characters: "Subtitle" }),
        ],
      }),
    ]);

    const result = await submitPaste({ app, payload });
    assert.equal(result.statusCode, 202);
    const summary = result.body.pasteDeltaSummary as PasteDeltaSummary | undefined;
    assert.ok(summary, "expected pasteDeltaSummary on first paste");
    assert.equal(summary.mode, "auto_resolved_to_full");
    assert.equal(summary.strategy, "baseline_created");
    assert.equal(summary.priorManifestMissing, true);
    assert.equal(summary.totalNodes, 3);
    assert.equal(summary.nodesReused, 0);
    assert.equal(summary.nodesReprocessed, 3);

    const manifestsDir = path.join(tempRoot, "paste-fingerprints");
    const manifestsStat = await stat(manifestsDir);
    assert.ok(manifestsStat.isDirectory());
    const files = await readdir(manifestsDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], `${summary.pasteIdentityKey}.json`);
  } finally {
    await close();
  }
});

test("paste-delta: second identical paste reuses all nodes", async () => {
  const { app, close } = await createApp();
  try {
    const payload = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [
          makeText({ id: "1:2", characters: "Welcome" }),
          makeText({ id: "1:3", characters: "Subtitle" }),
        ],
      }),
    ]);

    const first = await submitPaste({ app, payload });
    assert.equal(first.statusCode, 202);

    const second = await submitPaste({ app, payload });
    assert.equal(second.statusCode, 202);
    const summary = second.body.pasteDeltaSummary as
      | PasteDeltaSummary
      | undefined;
    assert.ok(summary);
    assert.equal(summary.strategy, "no_changes");
    assert.equal(summary.mode, "auto_resolved_to_delta");
    assert.equal(summary.priorManifestMissing, false);
    assert.equal(summary.nodesReused, summary.totalNodes);
    assert.equal(summary.nodesReprocessed, 0);
  } finally {
    await close();
  }
});

test("paste-delta: single text-node edit reports a partial delta", async () => {
  const { app, close } = await createApp();
  try {
    // Two sibling root frames so that editing a text node in the first frame
    // leaves the second frame's subtree hash intact — yielding a partial
    // (not whole-tree) reprocess closure.
    const baseline = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [makeText({ id: "1:2", characters: "Welcome" })],
      }),
      makeFrame({
        id: "2:1",
        name: "Footer",
        children: [makeText({ id: "2:2", characters: "Legal" })],
      }),
    ]);
    const edited = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [makeText({ id: "1:2", characters: "NEW WELCOME" })],
      }),
      makeFrame({
        id: "2:1",
        name: "Footer",
        children: [makeText({ id: "2:2", characters: "Legal" })],
      }),
    ]);

    const first = await submitPaste({ app, payload: baseline });
    assert.equal(first.statusCode, 202);

    const second = await submitPaste({ app, payload: edited });
    assert.equal(second.statusCode, 202);
    const summary = second.body.pasteDeltaSummary as
      | PasteDeltaSummary
      | undefined;
    assert.ok(summary);
    assert.equal(summary.strategy, "delta");
    assert.equal(summary.mode, "auto_resolved_to_delta");
    assert.ok(
      summary.nodesReprocessed > 0 &&
        summary.nodesReprocessed < summary.totalNodes,
      `expected 0 < nodesReprocessed < totalNodes, got ${summary.nodesReprocessed}/${summary.totalNodes}`,
    );
  } finally {
    await close();
  }
});

test("paste-delta: explicit importMode=full uses full mode without overriding strategy", async () => {
  const { app, close } = await createApp();
  try {
    const payload = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [makeText({ id: "1:2", characters: "Welcome" })],
      }),
    ]);

    const first = await submitPaste({ app, payload });
    assert.equal(first.statusCode, 202);

    const second = await submitPaste({ app, payload, importMode: "full" });
    assert.equal(second.statusCode, 202);
    const summary = second.body.pasteDeltaSummary as
      | PasteDeltaSummary
      | undefined;
    assert.ok(summary);
    assert.equal(summary.mode, "full");
    // Strategy is untouched by the server's mode-resolution step.
    assert.ok(
      summary.strategy === "no_changes" || summary.strategy === "delta",
      `unexpected strategy for identical repeat paste: ${summary.strategy}`,
    );
  } finally {
    await close();
  }
});

test("paste-delta: unusable payload (zero extractable roots) yields no summary", async () => {
  const { app, close } = await createApp();
  try {
    // Schema-valid Figma document but with no extractable root nodes
    // (empty children array). Delta computation must gracefully skip.
    const emptyDoc = makeDoc([]);

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(emptyDoc),
      },
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.pasteDeltaSummary, undefined);
  } finally {
    await close();
  }
});

test("paste-delta: importMode=delta with structural break falls back to full mode", async () => {
  const { app, close } = await createApp();
  try {
    // Baseline: same root id "1:1" with a broad subtree.
    const baseline = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [
          makeText({ id: "1:2", characters: "A" }),
          makeText({ id: "1:3", characters: "B" }),
          makeText({ id: "1:4", characters: "C" }),
          makeText({ id: "1:5", characters: "D" }),
          makeText({ id: "1:6", characters: "E" }),
        ],
      }),
    ]);
    // Second paste: same root id to preserve identity key, but every child
    // id is renamed so prior's children are all "removed" and the root
    // itself is "updated" — change ratio exceeds the 0.5 threshold.
    const restructured = makeDoc([
      makeFrame({
        id: "1:1",
        name: "Hero",
        children: [
          makeText({ id: "2:2", characters: "A" }),
          makeText({ id: "2:3", characters: "B" }),
          makeText({ id: "2:4", characters: "C" }),
          makeText({ id: "2:5", characters: "D" }),
          makeText({ id: "2:6", characters: "E" }),
        ],
      }),
    ]);

    const first = await submitPaste({ app, payload: baseline });
    assert.equal(first.statusCode, 202);

    const second = await submitPaste({
      app,
      payload: restructured,
      importMode: "delta",
    });
    assert.equal(second.statusCode, 202);
    const summary = second.body.pasteDeltaSummary as
      | PasteDeltaSummary
      | undefined;
    assert.ok(summary);
    assert.equal(summary.strategy, "structural_break");
    assert.equal(summary.mode, "full");
  } finally {
    await close();
  }
});
