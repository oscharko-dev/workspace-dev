import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 5000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

test("createJobEngine accepts jobs and exposes queued status", () => {
  const tempRoot = path.join(os.tmpdir(), "workspace-dev-engine-accept");
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: false, figmaMaxRetries: 1, figmaRequestTimeoutMs: 1000 })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  assert.equal(accepted.status, "queued");
  assert.equal(accepted.acceptedModes.figmaSourceMode, "rest");
  assert.equal(accepted.acceptedModes.llmCodegenMode, "deterministic");
  assert.equal(engine.getJob("unknown"), undefined);
  assert.equal(engine.getJobResult("unknown"), undefined);
});

test("createJobEngine marks jobs failed when figma source cannot be fetched", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-fail-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("network down");
      }
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_FIGMA_NETWORK");
  assert.equal(status.error?.stage, "figma.source");
});

test("resolvePreviewAsset enforces safe job id/path and supports index fallback", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-preview-"));
  const reproDir = path.join(tempRoot, "repros", "safe-job");
  await mkdir(reproDir, { recursive: true });
  await writeFile(path.join(reproDir, "index.html"), "<html>ok</html>\n", "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: true, figmaMaxRetries: 1, figmaRequestTimeoutMs: 1000 })
  });

  const bad = await engine.resolvePreviewAsset("../unsafe", "index.html");
  assert.equal(bad, undefined);

  const fallback = await engine.resolvePreviewAsset("safe-job", "missing.txt");
  assert.ok(fallback);
  assert.equal(fallback?.contentType, "text/html; charset=utf-8");
  assert.ok(fallback?.content.toString("utf8").includes("ok"));
});
