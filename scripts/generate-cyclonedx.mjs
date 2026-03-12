#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
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
  const outputPath = process.argv[2] ?? "artifacts/sbom/workspace-dev.cdx.json";
  const absoluteOutputPath = path.resolve(packageRoot, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  await run("npm", [
    "exec",
    "--yes",
    "--",
    "cyclonedx-npm",
    "--ignore-npm-errors",
    "--omit",
    "dev",
    "--spec-version",
    "1.5",
    "--output-reproducible",
    "--output-file",
    absoluteOutputPath
  ]);

  console.log(`[sbom] CycloneDX written to ${absoluteOutputPath}`);
};

main().catch((error) => {
  console.error("[sbom] CycloneDX generation failed:", error);
  process.exit(1);
});
