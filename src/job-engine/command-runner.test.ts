import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { redactValue, runCommand } from "./command-runner.js";

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const waitForCondition = async ({
  predicate,
  timeoutMs = 8_000,
  intervalMs = 50
}: {
  predicate: () => boolean | Promise<boolean>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await delay(intervalMs);
  }

  throw new Error(`Condition was not satisfied within ${timeoutMs}ms`);
};

const writeProcessTreeFixture = async ({ rootDir }: { rootDir: string }): Promise<{ parentScriptPath: string; pidFilePath: string }> => {
  const pidFilePath = path.join(rootDir, "descendant.pid");
  const childScriptPath = path.join(rootDir, "descendant-child.cjs");
  const parentScriptPath = path.join(rootDir, "descendant-parent.cjs");

  await writeFile(
    childScriptPath,
    `const fs = require("node:fs");
fs.writeFileSync(process.argv[2], String(process.pid), "utf8");
setInterval(() => {}, 1_000);
`,
    "utf8"
  );
  await writeFile(
    parentScriptPath,
    `const { spawn } = require("node:child_process");
const childScriptPath = process.argv[2];
const pidFilePath = process.argv[3];
spawn(process.execPath, [childScriptPath, pidFilePath], {
  stdio: "ignore"
});
setInterval(() => {}, 1_000);
`,
    "utf8"
  );

  return { parentScriptPath, pidFilePath };
};

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
  assert.equal(result.stdoutMetadata?.truncated, false);
  assert.equal(result.stderrMetadata?.truncated, false);
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
  assert.equal(result.stderrMetadata?.truncated, false);
});

test("runCommand terminates timed-out descendant processes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-command-timeout-tree-"));

  try {
    const { parentScriptPath, pidFilePath } = await writeProcessTreeFixture({ rootDir });
    const result = await runCommand({
      cwd: rootDir,
      command: process.execPath,
      args: [parentScriptPath, path.join(rootDir, "descendant-child.cjs"), pidFilePath],
      timeoutMs: 1_000
    });

    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
    assert.ok((result.durationMs ?? 0) >= 900);
    assert.ok(result.combined.includes("Command timed out"));

    await waitForCondition({
      predicate: async () => {
        try {
          const pid = Number.parseInt((await readFile(pidFilePath, "utf8")).trim(), 10);
          return Number.isFinite(pid) && !isProcessRunning(pid);
        } catch {
          return false;
        }
      }
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runCommand terminates aborted descendant processes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-command-abort-tree-"));
  const abortController = new AbortController();

  try {
    const { parentScriptPath, pidFilePath } = await writeProcessTreeFixture({ rootDir });
    setTimeout(() => {
      abortController.abort();
    }, 200);

    const result = await runCommand({
      cwd: rootDir,
      command: process.execPath,
      args: [parentScriptPath, path.join(rootDir, "descendant-child.cjs"), pidFilePath],
      abortSignal: abortController.signal
    });

    assert.equal(result.success, false);
    assert.equal(result.canceled, true);
    assert.ok(result.combined.includes("Command canceled"));

    await waitForCondition({
      predicate: async () => {
        try {
          const pid = Number.parseInt((await readFile(pidFilePath, "utf8")).trim(), 10);
          return Number.isFinite(pid) && !isProcessRunning(pid);
        } catch {
          return false;
        }
      }
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runCommand bounds retained stdout/stderr and spools sanitized overflow artifacts", async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-command-output-capture-"));
  const secret = "super-secret-token";
  const stdoutPayload = `stdout:${secret}:`.repeat(32);
  const stderrPayload = `stderr:${secret}:`.repeat(24);

  try {
    const result = await runCommand({
      cwd: jobDir,
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(stdoutPayload)}); process.stderr.write(${JSON.stringify(stderrPayload)});`
      ],
      redactions: [secret],
      outputCapture: {
        jobDir,
        key: "oversized.capture",
        stdoutMaxBytes: 96,
        stderrMaxBytes: 80
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
    assert.ok(result.stdout.includes("[REDACTED]"));
    assert.ok(result.stderr.includes("[REDACTED]"));
    assert.equal(result.stdoutMetadata?.truncated, true);
    assert.equal(result.stderrMetadata?.truncated, true);
    assert.ok((result.stdoutMetadata?.retainedBytes ?? 0) <= 96);
    assert.ok((result.stderrMetadata?.retainedBytes ?? 0) <= 80);
    assert.ok(result.combined.includes("stdout truncated after retaining"));
    assert.ok(result.combined.includes("stderr truncated after retaining"));

    const stdoutArtifactPath = result.stdoutMetadata?.artifactPath;
    const stderrArtifactPath = result.stderrMetadata?.artifactPath;
    assert.ok(stdoutArtifactPath);
    assert.ok(stderrArtifactPath);
    assert.equal(path.basename(stdoutArtifactPath ?? ""), "oversized_capture.stdout.log");
    assert.equal(path.basename(stderrArtifactPath ?? ""), "oversized_capture.stderr.log");

    const [stdoutArtifact, stderrArtifact] = await Promise.all([
      readFile(stdoutArtifactPath as string, "utf8"),
      readFile(stderrArtifactPath as string, "utf8")
    ]);
    assert.equal(stdoutArtifact.includes(secret), false);
    assert.equal(stderrArtifact.includes(secret), false);
    assert.ok(stdoutArtifact.includes("[REDACTED]"));
    assert.ok(stderrArtifact.includes("[REDACTED]"));
    assert.ok(Buffer.byteLength(stdoutArtifact) > Buffer.byteLength(result.stdout));
    assert.ok(Buffer.byteLength(stderrArtifact) > Buffer.byteLength(result.stderr));
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
});

test("runCommand redacts secrets that span output chunk boundaries", async () => {
  const secret = "cross-boundary-secret";
  const result = await runCommand({
    cwd: os.tmpdir(),
    command: process.execPath,
    args: [
      "-e",
      'process.stdout.write("token=cross-boundary-"); setTimeout(() => { process.stdout.write("secret\\\\n"); }, 20); setTimeout(() => { process.exit(0); }, 60);'
    ],
    redactions: [secret]
  });

  assert.equal(result.success, true);
  assert.equal(result.stdout.includes(secret), false);
  assert.ok(result.stdout.includes("token=[REDACTED]"));
});
