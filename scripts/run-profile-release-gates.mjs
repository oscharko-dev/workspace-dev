#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseProfileGateArgs,
  profilesFromIds,
  sbomDocumentsForProfile,
} from "./profile-gate-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const buildProfileArtifactRoot = path.resolve(packageRoot, "artifacts/build-profiles");
const sbomArtifactRoot = path.resolve(packageRoot, "artifacts/sbom");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const profileArgs = [];
  const options = {
    npmSbomSmoke: process.env.WORKSPACE_DEV_NPM_SBOM_SMOKE === "true",
    skipAirgap: false,
    skipReproducible: false,
  };

  for (const current of args) {
    if (current === "--npm-sbom-smoke") {
      options.npmSbomSmoke = true;
      continue;
    }
    if (current === "--no-npm-sbom-smoke") {
      options.npmSbomSmoke = false;
      continue;
    }
    if (current === "--skip-airgap") {
      options.skipAirgap = true;
      continue;
    }
    if (current === "--skip-reproducible") {
      options.skipReproducible = true;
      continue;
    }
    profileArgs.push(current);
  }

  const { profileIds } = parseProfileGateArgs(profileArgs);
  return {
    ...options,
    profiles: profilesFromIds(profileIds),
  };
};

const run = (command, args, { cwd = packageRoot } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`));
    });
  });

const findSingleTarball = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const tarballs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => path.join(directory, entry.name))
    .sort((first, second) => first.localeCompare(second));

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one .tgz in ${directory}, found ${tarballs.length}.`);
  }
  return tarballs[0];
};

const extractTarball = async (tarballPath, profile) => {
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-${profile.id}-release-`));
  await run("tar", ["-xzf", tarballPath, "-C", extractRoot]);
  return {
    cleanup: async () => {
      await rm(extractRoot, { recursive: true, force: true });
    },
    packageRootPath: path.join(extractRoot, "package"),
  };
};

const buildAndVerifyProfileTarball = async (profile) => {
  const profileArtifactDir = path.join(buildProfileArtifactRoot, profile.id);
  await rm(profileArtifactDir, { recursive: true, force: true });
  await mkdir(profileArtifactDir, { recursive: true });

  await run("node", [
    "scripts/build-profile.mjs",
    "--profile",
    profile.id,
    "--verify",
    "--pack-destination",
    profileArtifactDir,
  ]);

  return await findSingleTarball(profileArtifactDir);
};

const runTarballTooling = async (tarballPath) => {
  await run("pnpm", ["exec", "publint", "run", tarballPath]);
  await run("pnpm", ["exec", "attw", tarballPath, "--config-path", ".attw.json"]);
};

const writeMinimalPackageLock = async (packageRootPath) => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRootPath, "package.json"), "utf8"),
  );
  await writeFile(
    path.join(packageRootPath, "package-lock.json"),
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

const generateProfileSboms = async ({ extractedPackageRoot, profile }) => {
  const profileSbomDir = path.join(sbomArtifactRoot, profile.id);
  await rm(profileSbomDir, { recursive: true, force: true });
  await mkdir(profileSbomDir, { recursive: true });

  for (const document of sbomDocumentsForProfile(profile)) {
    const packageRootPath =
      document.packageRoot === "."
        ? extractedPackageRoot
        : path.resolve(packageRoot, document.packageRoot);
    if (document.packageRoot === ".") {
      await writeMinimalPackageLock(packageRootPath);
    }
    await run("node", [
      "scripts/generate-cyclonedx.mjs",
      path.join(profileSbomDir, document.cyclonedxFileName),
      "--package-root",
      packageRootPath,
      "--ignore-npm-errors",
    ]);
    await run("node", [
      "scripts/generate-spdx.mjs",
      path.join(profileSbomDir, document.spdxFileName),
      "--package-root",
      packageRootPath,
    ]);
  }

  await run("node", [
    "scripts/check-sbom-parity.mjs",
    "--profile",
    profile.id,
    "--directory",
    profileSbomDir,
  ]);
};

const verifyProfile = async ({ npmSbomSmoke, profile, skipAirgap, skipReproducible }) => {
  console.log(`[profile-gates] Starting profile '${profile.id}'.`);
  const tarballPath = await buildAndVerifyProfileTarball(profile);
  const extracted = await extractTarball(tarballPath, profile);

  try {
    await runTarballTooling(tarballPath);
    await run("node", ["scripts/check-license-allowlist.mjs", "--profile", profile.id]);
    await run("node", ["scripts/check-no-telemetry.mjs", "--profile", profile.id]);
    await run("node", [
      "scripts/check-profile-package-boundary.mjs",
      "--profile",
      profile.id,
      "--tarball",
      tarballPath,
    ]);

    if (!skipReproducible) {
      await run("node", ["scripts/verify-reproducible-build.mjs", "--profile", profile.id]);
    }

    await generateProfileSboms({
      extractedPackageRoot: extracted.packageRootPath,
      profile,
    });

    if (npmSbomSmoke) {
      await run("node", [
        "scripts/npm-sbom-smoke.mjs",
        "--profile",
        profile.id,
        "--package-root",
        extracted.packageRootPath,
      ]);
    }

    if (!skipAirgap) {
      await run("node", [
        "scripts/verify-airgap-install.mjs",
        "--profile",
        profile.id,
        "--tarball",
        tarballPath,
      ]);
    }
  } finally {
    await extracted.cleanup();
  }

  console.log(`[profile-gates] Completed profile '${profile.id}'.`);
};

const main = async () => {
  const options = parseArgs();
  for (const profile of options.profiles) {
    await verifyProfile({ ...options, profile });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[profile-gates] Failed:", error);
    process.exit(1);
  });
}
