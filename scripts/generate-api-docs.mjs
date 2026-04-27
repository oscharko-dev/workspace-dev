#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const manualApiDocPath = path.join(
  packageRoot,
  "docs/api/test-intelligence-multi-source.md",
);

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`,
        ),
      );
    });
  });

const main = async () => {
  let manualApiDoc;
  try {
    manualApiDoc = await readFile(manualApiDocPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    manualApiDoc = undefined;
  }

  await run("pnpm", ["exec", "typedoc", "--options", "typedoc.json"]);

  if (manualApiDoc !== undefined) {
    await mkdir(path.dirname(manualApiDocPath), { recursive: true });
    await writeFile(manualApiDocPath, manualApiDoc, "utf8");
  }

  console.log("[docs:api] Generated Markdown API reference under docs/api.");
};

main().catch((error) => {
  console.error("[docs:api] Failed:", error);
  process.exit(1);
});
