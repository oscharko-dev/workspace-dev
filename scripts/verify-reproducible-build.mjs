#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(packageRoot, "dist");
const artifactDir = path.resolve(packageRoot, "artifacts/reproducibility");
const artifactPath = path.resolve(artifactDir, "dist-hashes.json");

export const run = (command, args) =>
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

export const collectFiles = async (dir) => {
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

export const computeFileHash = async (filePath) => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

export const computeDistHashes = async () => {
  const files = await collectFiles(distDir);
  const hashes = [];

  for (const filePath of files) {
    hashes.push({
      file: path.relative(packageRoot, filePath),
      sha256: await computeFileHash(filePath)
    });
  }

  return hashes;
};

export const findSingleTarballPath = async (packDir) => {
  const entries = await readdir(packDir, { withFileTypes: true });
  const tarballs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one .tgz in ${packDir}, found ${tarballs.length}.`);
  }

  return path.resolve(packDir, tarballs[0]);
};

export const buildArtifactReport = ({ generatedAt, distHashes, tarballs }) => ({
  generatedAt,
  dist: {
    reproducible: true,
    files: distHashes
  },
  tarball: {
    reproducible: true,
    first: tarballs.first,
    second: tarballs.second
  }
});

const runIteration = async () => {
  await rm(distDir, { recursive: true, force: true });
  await run("pnpm", ["run", "build"]);

  const distHashes = await computeDistHashes();
  const packDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-"));

  try {
    await run("pnpm", ["pack", "--pack-destination", packDir]);
    const tarballPath = await findSingleTarballPath(packDir);

    return {
      distHashes,
      tarball: {
        file: path.basename(tarballPath),
        sha256: await computeFileHash(tarballPath)
      }
    };
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
};

export const main = async () => {
  const firstIteration = await runIteration();
  const secondIteration = await runIteration();

  const firstSerialized = JSON.stringify(firstIteration.distHashes);
  const secondSerialized = JSON.stringify(secondIteration.distHashes);
  if (firstSerialized !== secondSerialized) {
    throw new Error("Build output is not reproducible. Dist hashes differ between consecutive clean iterations.");
  }

  if (firstIteration.tarball.sha256 !== secondIteration.tarball.sha256) {
    throw new Error("Build output is not reproducible. Tarball hashes differ between consecutive clean iterations.");
  }

  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(
      buildArtifactReport({
        generatedAt: new Date().toISOString(),
        distHashes: firstIteration.distHashes,
        tarballs: {
          first: firstIteration.tarball,
          second: secondIteration.tarball
        }
      }),
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    `[reproducible-build] Verified dist and tarball reproducibility. Report: ${artifactPath}`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[reproducible-build] Failed:", error);
    process.exit(1);
  });
}
