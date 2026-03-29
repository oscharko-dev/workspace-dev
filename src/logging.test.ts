import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceLogger } from "./logging.js";

test("createWorkspaceLogger emits newline-delimited JSON records with correlation fields", () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const logger = createWorkspaceLogger({
    format: "json",
    now: () => "2026-03-27T12:00:00.000Z",
    stdoutWriter: (line) => {
      stdoutLines.push(line);
    },
    stderrWriter: (line) => {
      stderrLines.push(line);
    }
  });

  logger.log({
    level: "info",
    message: "Stage started",
    jobId: "job-123",
    stage: "ir.derive",
    requestId: "req-123",
    event: "workspace.submit.accepted",
    method: "POST",
    path: "/workspace/submit",
    statusCode: 202
  });
  logger.log({
    level: "error",
    message: "authorization: bearer super-secret",
    jobId: "job-123"
  });

  assert.equal(stdoutLines.length, 1);
  assert.equal(stderrLines.length, 1);

  const infoRecord = JSON.parse(stdoutLines[0]) as Record<string, string>;
  assert.deepEqual(infoRecord, {
    ts: "2026-03-27T12:00:00.000Z",
    level: "info",
    msg: "Stage started",
    jobId: "job-123",
    stage: "ir.derive",
    requestId: "req-123",
    event: "workspace.submit.accepted",
    method: "POST",
    path: "/workspace/submit",
    statusCode: 202
  });

  const errorRecord = JSON.parse(stderrLines[0]) as Record<string, string>;
  assert.equal(errorRecord.ts, "2026-03-27T12:00:00.000Z");
  assert.equal(errorRecord.level, "error");
  assert.equal(errorRecord.jobId, "job-123");
  assert.equal(errorRecord.msg, "authorization: bearer [REDACTED]");
  assert.equal("stage" in errorRecord, false);
});

test("createWorkspaceLogger keeps text mode human-readable with correlation prefixes", () => {
  const stdoutLines: string[] = [];
  const logger = createWorkspaceLogger({
    format: "text",
    stdoutWriter: (line) => {
      stdoutLines.push(line);
    }
  });

  logger.log({
    level: "info",
    message: "Completed stage 'figma.source'.",
    jobId: "job-abc",
    stage: "figma.source",
    requestId: "req-abc",
    event: "workspace.sync.applied",
    method: "POST",
    path: "/workspace/jobs/job-abc/sync",
    statusCode: 200
  });

  assert.equal(
    stdoutLines[0],
    "[workspace-dev][job=job-abc][stage=figma.source][request=req-abc][event=workspace.sync.applied][method=POST][path=/workspace/jobs/job-abc/sync][status=200] Completed stage 'figma.source'.\n"
  );
});

test("createWorkspaceLogger routes warnings to stderr in text mode", () => {
  const stderrLines: string[] = [];
  const logger = createWorkspaceLogger({
    format: "text",
    stderrWriter: (line) => {
      stderrLines.push(line);
    }
  });

  logger.log({
    level: "warn",
    message: "token=my-secret-token"
  });

  assert.equal(stderrLines[0], "[workspace-dev][warn] token=[REDACTED]\n");
});
