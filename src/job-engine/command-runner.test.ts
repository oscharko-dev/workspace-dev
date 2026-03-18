import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { redactValue, runCommand } from "./command-runner.js";

test("redactValue replaces sensitive token occurrences", () => {
  const output = redactValue({ value: "token=abc123 token=abc123", secret: "abc123" });
  assert.equal(output, "token=[REDACTED] token=[REDACTED]");
  assert.equal(redactValue({ value: "unchanged" }), "unchanged");
});

test("runCommand captures stdout/stderr and applies redactions", async () => {
  const result = await runCommand({
    cwd: os.tmpdir(),
    command: "node",
    args: ["-e", "console.log('hello-secret'); console.error('err-secret')"],
    redactions: ["secret"]
  });

  assert.equal(result.success, true);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes("hello-[REDACTED]"));
  assert.ok(result.stderr.includes("err-[REDACTED]"));
  assert.ok(result.combined.includes("[REDACTED]"));
});

test("runCommand returns structured failure on spawn error", async () => {
  const result = await runCommand({
    cwd: os.tmpdir(),
    command: "definitely-not-a-real-command-workspace-dev",
    args: []
  });

  assert.equal(result.success, false);
  assert.equal(result.code, null);
  assert.ok(result.combined.length > 0);
});

test("runCommand terminates process when timeout is exceeded", async () => {
  const result = await runCommand({
    cwd: os.tmpdir(),
    command: "node",
    args: ["-e", "setTimeout(() => console.log('done'), 30_000)"],
    timeoutMs: 1_000
  });

  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.ok((result.durationMs ?? 0) >= 900);
  assert.ok(result.combined.includes("Command timed out"));
});

test("runCommand terminates process when abort signal is triggered", async () => {
  const abortController = new AbortController();
  setTimeout(() => {
    abortController.abort();
  }, 200);

  const result = await runCommand({
    cwd: os.tmpdir(),
    command: "node",
    args: ["-e", "setTimeout(() => console.log('done'), 30_000)"],
    abortSignal: abortController.signal
  });

  assert.equal(result.success, false);
  assert.equal(result.canceled, true);
  assert.ok(result.combined.includes("Command canceled"));
});
