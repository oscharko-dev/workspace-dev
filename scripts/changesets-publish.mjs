#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const REQUIRED_DIST_FILES = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.cjs",
  "dist/contracts/index.js",
  "dist/contracts/index.cjs"
];

const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
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

const SUPPORTED_PUBLISH_AUTH_MODES = new Set([
  "trusted-publisher-oidc",
  "npm-token"
]);

export const resolvePublishEnv = () => {
  const publishEnv = { ...process.env };
  const publishAuthMode = String(
    publishEnv.WORKSPACE_DEV_PUBLISH_AUTH_MODE ?? "trusted-publisher-oidc"
  ).trim();

  if (!SUPPORTED_PUBLISH_AUTH_MODES.has(publishAuthMode)) {
    throw new Error(
      `Unsupported WORKSPACE_DEV_PUBLISH_AUTH_MODE '${publishAuthMode}'. Expected trusted-publisher-oidc or npm-token.`
    );
  }

  if (publishAuthMode === "npm-token") {
    const token = String(
      publishEnv.NODE_AUTH_TOKEN ?? publishEnv.NPM_TOKEN ?? ""
    ).trim();
    if (!token) {
      throw new Error(
        "NPM token publishing requested but NODE_AUTH_TOKEN/NPM_TOKEN is missing."
      );
    }
    publishEnv.NODE_AUTH_TOKEN = token;
    publishEnv.NPM_TOKEN = token;
  }

  if (publishEnv.GITHUB_ACTIONS === "true") {
    const hasGitHubOidc =
      Boolean(publishEnv.ACTIONS_ID_TOKEN_REQUEST_URL) &&
      Boolean(publishEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    let publishProvenance = false;

    if (publishAuthMode === "trusted-publisher-oidc") {
      if (!hasGitHubOidc) {
        throw new Error("Trusted publishing prerequisites missing: id-token permission is not available.");
      }
      // Enforce OIDC trusted publishing and prevent token fallback in CI.
      delete publishEnv.NODE_AUTH_TOKEN;
      delete publishEnv.NPM_TOKEN;
      delete publishEnv.npm_config__authToken;
      delete publishEnv.NPM_CONFIG__AUTH_TOKEN;
      publishProvenance = true;
    } else if (publishAuthMode === "npm-token") {
      publishProvenance = hasGitHubOidc;
    }

    // The release workflow already runs exhaustive quality gates in dedicated jobs.
    // Re-running package lifecycle scripts during publish introduces flaky ELIFECYCLE
    // failures in CI while adding no additional release confidence.
    publishEnv.npm_config_ignore_scripts = "true";
    publishEnv.NPM_CONFIG_IGNORE_SCRIPTS = "true";
    publishEnv.npm_config_access = "public";
    publishEnv.NPM_CONFIG_ACCESS = "public";
    publishEnv.npm_config_provenance = publishProvenance ? "true" : "false";
    publishEnv.NPM_CONFIG_PROVENANCE = publishProvenance ? "true" : "false";
  }

  return publishEnv;
};

const assertPathExists = async (relativePath) => {
  const absolutePath = path.resolve(packageRoot, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Expected file but found non-file entry: ${relativePath}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing required publish artifact '${relativePath}': ${reason}`);
  }
};

const ensurePublishArtifacts = async () => {
  console.log("[changesets-publish] Building package artifacts before publish.");
  await run("pnpm", ["run", "build"]);

  for (const relativePath of REQUIRED_DIST_FILES) {
    await assertPathExists(relativePath);
  }
  console.log("[changesets-publish] Verified required dist artifacts for publish.");
};

const main = async () => {
  const packageJsonPath = path.resolve(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageVersion = String(packageJson.version ?? "").trim();

  if (!packageVersion) {
    throw new Error("package.json is missing a valid version.");
  }

  const npmTag = packageVersion.includes("-") ? "next" : "latest";

  console.log(`[changesets-publish] Publishing ${packageJson.name}@${packageVersion} with npm tag '${npmTag}'.`);
  await ensurePublishArtifacts();
  await run("pnpm", [
    "changeset",
    "publish",
    "--tag",
    npmTag
  ], resolvePublishEnv());
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[changesets-publish] Failed:", error);
    process.exit(1);
  });
}
