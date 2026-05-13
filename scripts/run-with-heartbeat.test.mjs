import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";

const script = "scripts/run-with-heartbeat.mjs";

const runHeartbeat = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, output });
    });
  });

test("run-with-heartbeat emits periodic progress while child is silent", async () => {
  const result = await runHeartbeat([
    "--label",
    "silent test command",
    "--interval-seconds",
    "0.05",
    "--",
    process.execPath,
    "-e",
    "setTimeout(() => process.exit(0), 180)",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.output, /\[heartbeat\] Starting silent test command:/);
  assert.match(
    result.output,
    /\[heartbeat\] silent test command still running after/,
  );
  assert.match(
    result.output,
    /\[heartbeat\] silent test command finished after .* with exit code 0/,
  );
});

test("run-with-heartbeat propagates child exit code", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--label",
      "failing command",
      "--",
      process.execPath,
      "-e",
      "process.exit(7)",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 7);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /\[heartbeat\] failing command finished after .* with exit code 7/,
  );
});
