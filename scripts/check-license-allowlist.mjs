#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.resolve(packageRoot, "package.json");

const ALLOWED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);

const main = async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (!packageJson.license || !ALLOWED_LICENSES.has(packageJson.license)) {
    throw new Error(
      `Package license '${String(packageJson.license)}' is not in the allowlist (${[
        ...ALLOWED_LICENSES
      ].join(", ")}).`
    );
  }

  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
  if (runtimeDependencies.length > 0) {
    throw new Error(
      `Runtime dependencies are not permitted for workspace-dev: ${runtimeDependencies.join(", ")}`
    );
  }

  console.log(
    `License allowlist gate passed for ${packageJson.name}: ${packageJson.license}; runtime dependencies: 0`
  );
};

main().catch((error) => {
  console.error("[license-allowlist] Failed:", error);
  process.exit(1);
});
