#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPath,
  scanContent,
} from "./check-secrets.mjs";
import {
  defaultBuildProfileIds,
  profileDefinitions,
  resolveBuildProfiles,
} from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".d.ts",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const parseArgs = (argv) => {
  const profiles = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--profile" || current === "-p") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      profiles.push(next);
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      profiles.push(current.slice("--profile=".length));
      continue;
    }
    if (!current.startsWith("-")) {
      profiles.push(current);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return profiles.length > 0 ? resolveBuildProfiles(profiles) : defaultBuildProfileIds;
};

const run = (command, args, { cwd = packageRoot, stdio = "inherit" } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio,
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

  return files.sort((first, second) => first.localeCompare(second));
};

const isTextFile = (filePath) => {
  if (filePath.endsWith(".d.ts") || filePath.endsWith(".d.cts")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(filePath));
};

const readTextIfSafe = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  return content.includes("\u0000") ? null : content;
};

const findSingleTarball = async (packDir) => {
  const entries = await readdir(packDir);
  const tarballs = entries
    .filter((entry) => entry.endsWith(".tgz"))
    .sort((first, second) => first.localeCompare(second));
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one profile tarball in ${packDir}, found ${tarballs.length}.`,
    );
  }
  return path.join(packDir, tarballs[0]);
};

const scanExtractedProfile = async ({ extractRoot, profile }) => {
  const packageDir = path.join(extractRoot, "package");
  await stat(packageDir);
  const files = await collectFiles(packageDir);
  const pathViolations = [];
  const contentFindings = [];
  let scannedTextFiles = 0;

  for (const filePath of files) {
    const relativePath = path
      .relative(packageDir, filePath)
      .split(path.sep)
      .join("/");
    const classification = classifyPath(relativePath);
    if (classification) {
      pathViolations.push({ file: relativePath, reason: classification.reason });
    }

    if (!isTextFile(relativePath)) {
      continue;
    }

    const content = readTextIfSafe(filePath);
    if (content === null) {
      continue;
    }
    scannedTextFiles += 1;
    contentFindings.push(
      ...scanContent(content, {
        filename: relativePath,
        startLine: 1,
      }),
    );
  }

  if (pathViolations.length > 0 || contentFindings.length > 0) {
    if (pathViolations.length > 0) {
      console.error(
        `[check-profile-tarball-secrets] Profile '${profile.id}' contains blocked path(s):`,
      );
      for (const violation of pathViolations) {
        console.error(` - ${violation.file} [${violation.reason}]`);
      }
    }
    if (contentFindings.length > 0) {
      console.error(
        `[check-profile-tarball-secrets] Profile '${profile.id}' contains secret pattern matches:`,
      );
      for (const finding of contentFindings) {
        console.error(
          ` - ${finding.file}:${finding.line} [${finding.patternId}] ${finding.description}`,
        );
      }
    }
    throw new Error(`Profile '${profile.id}' tarball secret scan failed.`);
  }

  console.log(
    `[check-profile-tarball-secrets] Profile '${profile.id}' passed. Scanned ${scannedTextFiles} text file(s) from ${files.length} packaged file(s).`,
  );
};

const scanProfile = async (profile) => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-${profile.id}-tarball-secrets-`),
  );
  const packDir = path.join(tmpRoot, "pack");

  try {
    await run("node", [
      "scripts/build-profile.mjs",
      "--skip-build",
      "--profile",
      profile.id,
      "--pack-destination",
      packDir,
    ]);
    const tarballPath = await findSingleTarball(packDir);
    await scanProfileTarball({ tarballPath, profile });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

const scanProfileTarball = async ({ tarballPath, profile }) => {
  const extractRoot = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-${profile.id}-tarball-scan-`),
  );

  try {
    await run("tar", ["-xzf", tarballPath, "-C", extractRoot], {
      stdio: "ignore",
    });
    await scanExtractedProfile({ extractRoot, profile });
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  const profileIds = parseArgs(process.argv.slice(2));
  for (const profileId of profileIds) {
    await scanProfile(profileDefinitions[profileId]);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[check-profile-tarball-secrets] Failed:", error);
    process.exit(1);
  });
}

export {
  parseArgs as parseProfileTarballSecretArgs,
  scanProfile,
  scanProfileTarball,
};
