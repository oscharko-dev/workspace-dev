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

  // Enforce OIDC trusted publishing in GitHub Actions.
  if (publishEnv.GITHUB_ACTIONS === "true") {
    delete publishEnv.NODE_AUTH_TOKEN;
    delete publishEnv.NPM_TOKEN;
    delete publishEnv.npm_config__authToken;
    delete publishEnv.NPM_CONFIG__AUTH_TOKEN;
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
