import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceLogger,
  redactLogMessage,
  resolveWorkspaceLogLevel,
} from "./logging.js";

test("redactLogMessage redacts shared high-risk secret shapes", async (t) => {
  const cases = [
    {
      name: "repo token assignments",
      input: "repoToken=ghp_secret",
      expected: "repoToken=[REDACTED]"
    },
    {
      name: "figma access token assignments",
      input: "figmaAccessToken=figd_secret",
      expected: "figmaAccessToken=[REDACTED]"
    },
    {
      name: "bare token assignments",
      input: "token=my-secret-token",
      expected: "token=[REDACTED]"
    },
    {
      name: "authorization bearer headers",
      input: "authorization: bearer super-secret-token",
      expected: "authorization: bearer [REDACTED]"
    },
    {
      name: "Authorization Bearer headers",
      input: "Authorization: Bearer super-secret-token",
      expected: "Authorization: Bearer [REDACTED]"
    },
    {
      name: "x-access-token headers",
      input: "x-access-token:abcdef",
      expected: "x-access-token:[REDACTED]"
    },
    {
      name: "x-access-token headers with at signs",
      input: "x-access-token:foo@bar",
      expected: "x-access-token:[REDACTED]"
    }
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const message = redactLogMessage(`leak ${testCase.input}`);
      assert.equal(message, `leak ${testCase.expected}`);
      assert.equal(message.includes(testCase.input), false);
    });
  }
});

test("redactLogMessage preserves benign prose around secret-like words", async (t) => {
  const cases = [
    "Password rotation completed",
    "ApiKey rotation started",
    "PasswordResetFailed"
  ] as const;

  for (const input of cases) {
    await t.test(input, () => {
      const message = redactLogMessage(input);
      assert.equal(message, input);
      assert.equal(message.includes("[REDACTED]"), false);
    });
  }
});

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

test("resolveWorkspaceLogLevel falls back to info for unknown values", () => {
  assert.equal(resolveWorkspaceLogLevel({ value: "debug" }), "debug");
  assert.equal(resolveWorkspaceLogLevel({ value: "WARN" }), "warn");
  assert.equal(resolveWorkspaceLogLevel({ value: "verbose" }), "info");
});

test("createWorkspaceLogger suppresses entries below the configured minimum level", () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const logger = createWorkspaceLogger({
    format: "text",
    minLevel: "warn",
    stdoutWriter: (line) => {
      stdoutLines.push(line);
    },
    stderrWriter: (line) => {
      stderrLines.push(line);
    },
  });

  logger.log({
    level: "debug",
    message: "Hidden debug line",
  });
  logger.log({
    level: "info",
    message: "Hidden info line",
  });
  logger.log({
    level: "warn",
    message: "Shown warning",
  });

  assert.deepEqual(stdoutLines, []);
  assert.deepEqual(stderrLines, ["[workspace-dev][warn] Shown warning\n"]);
});
