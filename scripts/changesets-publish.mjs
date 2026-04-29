#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProfileTarball } from "./check-profile-tarball-secrets.mjs";
import { profileDefinitions } from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const REQUIRED_DIST_FILES = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.cjs",
  "dist/contracts/index.js",
  "dist/contracts/index.cjs",
];

const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env,
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

const resolvePublishEnv = () => {
  const publishEnv = { ...process.env };
  const publishAuthMode = String(
    publishEnv.WORKSPACE_DEV_PUBLISH_AUTH_MODE ?? "trusted-publisher-oidc",
  ).trim();

  if (
    publishEnv.GITHUB_ACTIONS === "true" &&
    publishAuthMode !== "trusted-publisher-oidc"
  ) {
    throw new Error(
      "Trusted publishing is mandatory in GitHub Actions. Set WORKSPACE_DEV_PUBLISH_AUTH_MODE=trusted-publisher-oidc.",
    );
  }

  if (publishEnv.GITHUB_ACTIONS === "true") {
    if (
      !publishEnv.ACTIONS_ID_TOKEN_REQUEST_URL ||
      !publishEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    ) {
      throw new Error(
        "Trusted publishing prerequisites missing: id-token permission is not available.",
      );
    }

    // Enforce OIDC trusted publishing and prevent token fallback in CI.
    delete publishEnv.NODE_AUTH_TOKEN;
    delete publishEnv.NPM_TOKEN;
    delete publishEnv.npm_config__authToken;
    delete publishEnv.NPM_CONFIG__AUTH_TOKEN;

    // The release workflow already runs exhaustive quality gates in dedicated jobs.
    // Re-running package lifecycle scripts during publish introduces flaky ELIFECYCLE
    // failures in CI while adding no additional release confidence.
    publishEnv.npm_config_ignore_scripts = "true";
    publishEnv.NPM_CONFIG_IGNORE_SCRIPTS = "true";
  }

  return publishEnv;
};

const assertPathExists = async (relativePath) => {
  const absolutePath = path.resolve(packageRoot, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(
        `Expected file but found non-file entry: ${relativePath}`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing required publish artifact '${relativePath}': ${reason}`,
    );
  }
};

const ensurePublishArtifacts = async () => {
  console.log(
    "[changesets-publish] Building package artifacts before publish.",
  );
  await run("pnpm", ["run", "build"]);

  for (const relativePath of REQUIRED_DIST_FILES) {
    await assertPathExists(relativePath);
  }
  console.log(
    "[changesets-publish] Verified required dist artifacts for publish.",
  );
};

const findProfileTarball = async (packDir) => {
  const entries = await readdir(packDir, { withFileTypes: true });
  const tarballs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => path.join(packDir, entry.name))
    .sort((first, second) => first.localeCompare(second));
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one profile tarball in ${packDir}, found ${tarballs.length}.`,
    );
  }
  return tarballs[0];
};

const main = async () => {
  const packageJsonPath = path.resolve(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageVersion = String(packageJson.version ?? "").trim();

  if (!packageVersion) {
    throw new Error("package.json is missing a valid version.");
  }

  const npmTag = packageVersion.includes("-") ? "next" : "latest";

  console.log(
    `[changesets-publish] Publishing ${packageJson.name}@${packageVersion} with npm tag '${npmTag}'.`,
  );
  await ensurePublishArtifacts();
  const packDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-publish-pack-"),
  );
  try {
    await run("node", [
      "scripts/build-profile.mjs",
      "--skip-build",
      "--profile",
      "default-rocket",
      "--verify",
      "--pack-destination",
      packDir,
    ]);
    const tarballPath = await findProfileTarball(packDir);
    await scanProfileTarball({
      tarballPath,
      profile: profileDefinitions["default-rocket"],
    });
    await run(
      "npm",
      [
        "publish",
        tarballPath,
        "--access",
        "public",
        "--provenance",
        "--tag",
        npmTag,
      ],
      resolvePublishEnv(),
    );
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error("[changesets-publish] Failed:", error);
  process.exit(1);
});
