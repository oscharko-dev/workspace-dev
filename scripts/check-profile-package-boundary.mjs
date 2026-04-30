#!/usr/bin/env node

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyPath, scanContent } from "./check-secrets.mjs";
import { findViolationsInLine, hasIncludedExtension, hasTestSuffix } from "./check-no-telemetry.mjs";
import { parseProfileGateArgs, profilesFromIds } from "./profile-gate-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".d.cts",
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
const TELEMETRY_ALLOWED_FILES = new Set([
  "template/react-mui-app/src/performance/report-web-vitals.ts",
]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const profileArgs = [];
  let tarballPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--tarball") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --tarball.");
      }
      tarballPath = path.resolve(packageRoot, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--tarball=")) {
      tarballPath = path.resolve(packageRoot, current.slice("--tarball=".length));
      continue;
    }
    profileArgs.push(current);
  }

  const { profileIds } = parseProfileGateArgs(profileArgs);
  if (profileIds.length !== 1) {
    throw new Error("Expected exactly one --profile for package-boundary scanning.");
  }
  if (!tarballPath) {
    throw new Error("Missing required --tarball.");
  }

  return {
    profile: profilesFromIds(profileIds)[0],
    tarballPath,
  };
};

const run = (command, args, { cwd = packageRoot, stdio = "inherit" } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`));
    });
  });

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
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
  const basename = path.basename(filePath);
  if (basename === "LICENSE" || basename === "README.md") {
    return true;
  }
  const extension = path.extname(filePath);
  return TEXT_EXTENSIONS.has(extension);
};

const shouldScanTelemetry = (relativePath) => {
  const basename = path.basename(relativePath);
  if (!hasIncludedExtension(basename) || hasTestSuffix(basename)) {
    return false;
  }
  return (
    relativePath.startsWith("dist/") ||
    relativePath.startsWith("template/")
  );
};

const assertManifestProfile = async ({ packageRootPath, profile }) => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRootPath, "package.json"), "utf8"),
  );
  if (manifest.workspaceDev?.buildProfile !== profile.id) {
    throw new Error(
      `Package boundary profile mismatch: expected '${profile.id}', found '${manifest.workspaceDev?.buildProfile}'.`,
    );
  }
};

const verifyTarballBoundary = async ({ profile, tarballPath }) => {
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-${profile.id}-boundary-`));

  try {
    await run("tar", ["-xzf", tarballPath, "-C", extractRoot], {
      stdio: "ignore",
    });
    const extractedPackageRoot = path.join(extractRoot, "package");
    await assertManifestProfile({ packageRootPath: extractedPackageRoot, profile });

    const files = await collectFiles(extractedPackageRoot);
    const pathViolations = [];
    const secretFindings = [];
    const telemetryFindings = [];

    for (const filePath of files) {
      const relativePath = path
        .relative(extractedPackageRoot, filePath)
        .split(path.sep)
        .join("/");
      const classification = classifyPath(relativePath);
      if (classification) {
        pathViolations.push({ file: relativePath, reason: classification.reason });
      }

      if (!isTextFile(relativePath)) {
        continue;
      }
      const content = await readFile(filePath, "utf8");
      secretFindings.push(...scanContent(content, { filename: relativePath }));

      if (shouldScanTelemetry(relativePath)) {
        if (TELEMETRY_ALLOWED_FILES.has(relativePath)) {
          continue;
        }
        const lines = content.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          for (const reason of findViolationsInLine(lines[index] ?? "")) {
            telemetryFindings.push({
              file: relativePath,
              line: index + 1,
              reason,
            });
          }
        }
      }
    }

    if (pathViolations.length > 0 || secretFindings.length > 0 || telemetryFindings.length > 0) {
      if (pathViolations.length > 0) {
        console.error("[profile-boundary] Blocked package path(s):");
        for (const violation of pathViolations) {
          console.error(` - ${violation.file} [${violation.reason}]`);
        }
      }
      if (secretFindings.length > 0) {
        console.error("[profile-boundary] Secret pattern matches in package:");
        for (const finding of secretFindings) {
          console.error(` - ${finding.file}:${finding.line} [${finding.patternId}] ${finding.description}`);
        }
      }
      if (telemetryFindings.length > 0) {
        console.error("[profile-boundary] Telemetry pattern matches in package:");
        for (const finding of telemetryFindings) {
          console.error(` - ${finding.file}:${finding.line} [${finding.reason}]`);
        }
      }
      throw new Error(`Profile '${profile.id}' package boundary scan failed.`);
    }

    console.log(
      `[profile-boundary] Profile '${profile.id}' package scan passed (${files.length} files).`,
    );
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  await verifyTarballBoundary(parseArgs());
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[profile-boundary] Failed:", error);
    process.exit(1);
  });
}
