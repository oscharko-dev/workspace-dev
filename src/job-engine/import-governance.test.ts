import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { ensureTemplateValidationSeedNodeModules } from "./test-validation-seed.js";

const createLocalFigmaPayload = () => ({
  name: "Governance Test Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Checkout",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "password-1",
                type: "TEXT",
                name: "Password",
                characters: "Password",
                absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
                style: { fontSize: 24, fontWeight: 400, lineHeightPx: 32 },
                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 300_000,
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (
      status &&
      (status.status === "completed" ||
        status.status === "failed" ||
        status.status === "canceled" ||
        status.status === "partial")
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

test.before(async () => {
  await ensureTemplateValidationSeedNodeModules();
});

test("createJobEngine persists import sessions with authoritative governance defaults and updates them from events", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-import-governance-"),
  );
  const figmaPath = path.join(tempRoot, "figma.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
    }),
  });

  const accepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const status = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: accepted.jobId,
  });
  assert.equal(status.status, "completed");

  const sessions = await engine.listImportSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.jobId, accepted.jobId);
  assert.equal(sessions[0]?.status, "imported");
  assert.equal(sessions[0]?.reviewRequired, true);
  assert.equal((sessions[0]?.nodeCount ?? 0) > 0, true);
  assert.equal((sessions[0]?.componentMappings ?? 0) >= 0, true);

  const sessionId = sessions[0]!.id;
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "review_started",
      at: "",
      metadata: {
        qualityScore: 81,
      },
    },
  });

  const callerSuppliedTimestamp = "1999-01-01T00:00:00.000Z";
  const approvedEvent = await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "approved",
      at: callerSuppliedTimestamp,
      actor: "reviewer-1",
    },
  });
  assert.notEqual(approvedEvent.at, callerSuppliedTimestamp);
  assert.equal(approvedEvent.actor, "reviewer-1");

  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "apply_blocked",
      at: "",
      note: "Need explicit override note.",
    },
  });

  const updated = (await engine.listImportSessions()).find(
    (entry) => entry.id === sessionId,
  );
  assert.equal(updated?.status, "approved");
  assert.equal(updated?.qualityScore, 81);
  assert.equal(updated?.userId, "reviewer-1");

  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "applied",
      at: "",
      note: "Approved override.",
    },
  });

  const applied = (await engine.listImportSessions()).find(
    (entry) => entry.id === sessionId,
  );
  assert.equal(applied?.status, "applied");
});
