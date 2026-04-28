#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const cyclonedxPackageEntryPath = require.resolve("@cyclonedx/cyclonedx-npm");
const cyclonedxCliPath = path.resolve(
  path.dirname(cyclonedxPackageEntryPath),
  "bin/cyclonedx-npm-cli.js"
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  let outputPath = "artifacts/sbom/workspace-dev.cdx.json";
  let packageRoot = repoRoot;
  let ignoreNpmErrors = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    if (current === "--ignore-npm-errors") {
      ignoreNpmErrors = true;
      continue;
    }
    if (current === "--package-root") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --package-root.");
      }
      packageRoot = path.resolve(repoRoot, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--package-root=")) {
      packageRoot = path.resolve(repoRoot, current.slice("--package-root=".length));
      continue;
    }
    outputPath = current;
  }

  return {
    ignoreNpmErrors,
    outputPath,
    packageRoot
  };
};

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.npm_execpath;

    const child = spawn(command, args, {
      cwd,
      env,
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
  const { ignoreNpmErrors, outputPath, packageRoot } = parseArgs();
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  await run(process.execPath, [
    cyclonedxCliPath,
    ...(ignoreNpmErrors ? ["--ignore-npm-errors"] : []),
    "--omit",
    "dev",
    "--spec-version",
    "1.5",
    "--output-reproducible",
    "--output-file",
    absoluteOutputPath
  ], packageRoot);

  console.log(`[sbom] CycloneDX written to ${absoluteOutputPath} (packageRoot=${packageRoot})`);
};

main().catch((error) => {
  console.error("[sbom] CycloneDX generation failed:", error);
  process.exit(1);
});
