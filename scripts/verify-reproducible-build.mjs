#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(packageRoot, "dist");
const artifactDir = path.resolve(packageRoot, "artifacts/reproducibility");
const artifactPath = path.resolve(artifactDir, "dist-hashes.json");

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

const collectFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
};

const computeDistHashes = async () => {
  const files = await collectFiles(distDir);
  const hashes = [];

  for (const filePath of files) {
    const content = await readFile(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    hashes.push({
      file: path.relative(packageRoot, filePath),
      sha256: hash
    });
  }

  return hashes;
};

const main = async () => {
  await run("pnpm", ["run", "build"]);
  const firstHashes = await computeDistHashes();

  await run("pnpm", ["run", "build"]);
  const secondHashes = await computeDistHashes();

  const firstSerialized = JSON.stringify(firstHashes);
  const secondSerialized = JSON.stringify(secondHashes);
  if (firstSerialized !== secondSerialized) {
    throw new Error("Build output is not reproducible. Hashes differ between consecutive builds.");
  }

  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files: firstHashes
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`[reproducible-build] Verified dist hash reproducibility. Report: ${artifactPath}`);
};

main().catch((error) => {
  console.error("[reproducible-build] Failed:", error);
  process.exit(1);
});
