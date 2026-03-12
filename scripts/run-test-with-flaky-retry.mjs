#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const artifactDir = path.resolve(packageRoot, "artifacts/testing");
const artifactPath = path.resolve(artifactDir, "flaky-retry-report.json");

const command = process.env.WORKSPACE_DEV_TEST_COMMAND ?? "pnpm run test:ci";
const parsedRetries = Number.parseInt(process.env.WORKSPACE_DEV_TEST_RETRIES ?? "1", 10);
const maxRetries = Number.isFinite(parsedRetries) && parsedRetries >= 0 ? parsedRetries : 1;

const runAttempt = async (attempt) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: packageRoot,
      env: process.env,
      shell: true,
      stdio: "inherit"
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code, signal) => {
      resolve({
        attempt,
        exitCode: code ?? 1,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt
      });
    });
  });

const main = async () => {
  const attempts = [];
  let finalResult = await runAttempt(1);
  attempts.push(finalResult);

  for (let retryNumber = 1; retryNumber <= maxRetries && finalResult.exitCode !== 0; retryNumber += 1) {
    const nextAttempt = retryNumber + 1;
    console.error(
      `[flaky-retry] Attempt ${retryNumber} failed. Retrying (${retryNumber}/${maxRetries}): "${command}"`
    );
    finalResult = await runAttempt(nextAttempt);
    attempts.push(finalResult);
  }
  const retriesUsed = Math.max(0, attempts.length - 1);

  const report = {
    generatedAt: new Date().toISOString(),
    command,
    maxRetries,
    retriesUsed,
    totalAttempts: attempts.length,
    finalExitCode: finalResult.exitCode,
    attempts
  };

  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (finalResult.exitCode !== 0) {
    console.error(`[flaky-retry] Command failed after ${attempts.length} attempt(s). Report: ${artifactPath}`);
  } else {
    console.log(`[flaky-retry] Command passed${retriesUsed ? " after retry" : " on first attempt"}. Report: ${artifactPath}`);
  }

  process.exit(finalResult.exitCode);
};

main().catch(async (error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    command,
    maxRetries,
    retriesUsed: 0,
    finalExitCode: 1,
    error: error instanceof Error ? error.message : String(error)
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error("[flaky-retry] Runner failed:", error);
  process.exit(1);
});
