#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

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

const resolvePublishEnv = () => {
  const publishEnv = { ...process.env };
  const publishAuthMode = String(
    publishEnv.WORKSPACE_DEV_PUBLISH_AUTH_MODE ?? "trusted-publisher-oidc"
  ).trim();

  if (publishEnv.GITHUB_ACTIONS === "true" && publishAuthMode !== "trusted-publisher-oidc") {
    throw new Error(
      "Trusted publishing is mandatory in GitHub Actions. Set WORKSPACE_DEV_PUBLISH_AUTH_MODE=trusted-publisher-oidc."
    );
  }

  if (publishEnv.GITHUB_ACTIONS === "true") {
    if (!publishEnv.ACTIONS_ID_TOKEN_REQUEST_URL || !publishEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
      throw new Error("Trusted publishing prerequisites missing: id-token permission is not available.");
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

const main = async () => {
  const packageJsonPath = path.resolve(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageVersion = String(packageJson.version ?? "").trim();

  if (!packageVersion) {
    throw new Error("package.json is missing a valid version.");
  }

  const npmTag = packageVersion.includes("-") ? "next" : "latest";

  console.log(`[changesets-publish] Publishing ${packageJson.name}@${packageVersion} with npm tag '${npmTag}'.`);
  await run("pnpm", [
    "changeset",
    "publish",
    "--access",
    "public",
    "--provenance",
    "--tag",
    npmTag
  ], resolvePublishEnv());
};

main().catch((error) => {
  console.error("[changesets-publish] Failed:", error);
  process.exit(1);
});
