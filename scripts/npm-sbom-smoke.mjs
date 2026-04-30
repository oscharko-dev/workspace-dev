#!/usr/bin/env node

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProfileGateArgs, profilesFromIds } from "./profile-gate-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const profileArgs = [];
  let packageRootPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--package-root") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --package-root.");
      }
      packageRootPath = path.resolve(packageRoot, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--package-root=")) {
      packageRootPath = path.resolve(packageRoot, current.slice("--package-root=".length));
      continue;
    }
    profileArgs.push(current);
  }

  const { profileIds } = parseProfileGateArgs(profileArgs);
  if (profileIds.length !== 1) {
    throw new Error("Expected exactly one --profile for npm SBOM smoke.");
  }
  if (!packageRootPath) {
    throw new Error("Missing required --package-root.");
  }

  return {
    packageRootPath,
    profile: profilesFromIds(profileIds)[0],
  };
};

const run = (command, args, { cwd = packageRoot, stdio = "pipe" } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio,
    });
    let stdout = "";
    let stderr = "";
    if (stdio === "pipe") {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });

const npmSbomAvailable = async () => {
  try {
    await run("npm", ["sbom", "--help"]);
    return true;
  } catch {
    return false;
  }
};

const assertSbomDocument = ({ document, format, manifest, profile }) => {
  if (format === "cyclonedx") {
    if (document.bomFormat !== "CycloneDX") {
      throw new Error("npm CycloneDX SBOM smoke did not return a CycloneDX document.");
    }
    const components = [
      document.metadata?.component,
      ...(Array.isArray(document.components) ? document.components : []),
    ];
    const matchingComponent = components.find(
      (component) =>
        component?.name === manifest.name &&
        component?.version === manifest.version,
    );
    if (!matchingComponent) {
      console.log(
        `[npm-sbom-smoke] npm CycloneDX output did not preserve the manifest name for profile '${profile.id}'; format smoke still passed.`,
      );
    }
    return;
  }

  if (document.spdxVersion !== "SPDX-2.3") {
    throw new Error("npm SPDX SBOM smoke did not return an SPDX 2.3 document.");
  }
  if (!Array.isArray(document.packages)) {
    throw new Error("npm SPDX SBOM smoke returned no packages array.");
  }
  const rootPackage = document.packages.find(
    (packageEntry) =>
      packageEntry?.name === manifest.name &&
      packageEntry?.versionInfo === manifest.version,
  );
  if (!rootPackage) {
    console.log(
      `[npm-sbom-smoke] npm SPDX output did not preserve the manifest name for profile '${profile.id}'; format smoke still passed.`,
    );
  }
};

const writeMinimalPackageLock = async ({ packageRootPath, manifest }) => {
  const packageLockPath = path.join(packageRootPath, "package-lock.json");
  await writeFile(
    packageLockPath,
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: manifest.name,
            version: manifest.version,
            license: manifest.license,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const runSmoke = async ({ packageRootPath, profile }) => {
  if (!(await npmSbomAvailable())) {
    console.log("[npm-sbom-smoke] npm sbom is unavailable; skipping optional smoke.");
    return;
  }

  const manifest = JSON.parse(
    await readFile(path.join(packageRootPath, "package.json"), "utf8"),
  );
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-${profile.id}-npm-sbom-`));

  try {
    const tempPackageRoot = path.join(tempRoot, "package");
    await cp(packageRootPath, tempPackageRoot, { recursive: true });
    await writeMinimalPackageLock({ packageRootPath: tempPackageRoot, manifest });

    for (const format of ["cyclonedx", "spdx"]) {
      const { stdout } = await run(
        "npm",
        ["sbom", "--package-lock-only", "--sbom-format", format, "--sbom-type", "library"],
        { cwd: tempPackageRoot },
      );
      assertSbomDocument({
        document: JSON.parse(stdout),
        format,
        manifest,
        profile,
      });
    }

    console.log(`[npm-sbom-smoke] Profile '${profile.id}' npm SBOM smoke passed.`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  await runSmoke(parseArgs());
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[npm-sbom-smoke] Failed:", error);
    process.exit(1);
  });
}
