#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`));
    });
  });

const main = async () => {
  await run("pnpm", ["exec", "typedoc", "--options", "typedoc.json"]);
  console.log("[docs:api] Generated Markdown API reference under docs/api.");
};

main().catch((error) => {
  console.error("[docs:api] Failed:", error);
  process.exit(1);
});
