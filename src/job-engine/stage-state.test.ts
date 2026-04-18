import assert from "node:assert/strict";
import test from "node:test";
import { createInitialStages, pushRuntimeLog } from "./stage-state.js";
import type { JobRecord } from "./types.js";

test("pushRuntimeLog persists debug entries to the job log stream", () => {
  const runtimeEntries: Array<{ level: string; message: string; stage?: string }> = [];
  const job = {
    jobId: "job-debug-log",
    status: "queued",
    submittedAt: new Date().toISOString(),
    request: {} as JobRecord["request"],
    stages: createInitialStages(),
    logs: [],
    artifacts: {},
    preview: { enabled: false },
    queue: { position: 0, ahead: 0 },
  } as JobRecord;

  const entry = pushRuntimeLog({
    job,
    logger: {
      log: (input) => {
        runtimeEntries.push({
          level: input.level,
          message: input.message,
          ...(input.stage ? { stage: input.stage } : {}),
        });
      },
    },
    level: "debug",
    stage: "figma.source",
    message: "debug trace",
  });

  assert.equal(entry.level, "debug");
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0]?.level, "debug");
  assert.equal(job.logs[0]?.message, "debug trace");
  assert.deepEqual(runtimeEntries, [
    {
      level: "debug",
      message: "debug trace",
      stage: "figma.source",
    },
  ]);
});

test("pushRuntimeLog honors configured logLimit", () => {
  const job = {
    jobId: "job-log-limit",
    status: "queued",
    submittedAt: new Date().toISOString(),
    request: {} as JobRecord["request"],
    stages: createInitialStages(),
    logs: [],
    artifacts: {},
    preview: { enabled: false },
    queue: { position: 0, ahead: 0 },
  } as JobRecord;

  for (const message of ["one", "two", "three"]) {
    pushRuntimeLog({
      job,
      logger: { log: () => {} },
      level: "info",
      message,
      logLimit: 2,
    });
  }

  assert.deepEqual(
    job.logs.map((entry) => entry.message),
    ["two", "three"],
  );
});
