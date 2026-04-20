#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const run = (command, args, { capture = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}${
            capture && stderr ? `\n${stderr.trim()}` : ""
          }`
        )
      );
    });
  });

const main = async () => {
  await run("node", ["scripts/generate-api-docs.mjs"]);
  const { stdout } = await run(
    "git",
    ["status", "--short", "--untracked-files=all", "--", "docs/api"],
    { capture: true }
  );

  if (stdout.trim().length > 0) {
    console.error("[docs:api:check] Generated API reference is stale.");
    console.error("[docs:api:check] Run `pnpm run docs:api` and commit the resulting docs/api changes.");
    console.error(stdout.trim());
    process.exit(1);
  }

  console.log("[docs:api:check] API reference build is valid and up to date.");
};

main().catch((error) => {
  console.error("[docs:api:check] Failed:", error);
  process.exit(1);
});
