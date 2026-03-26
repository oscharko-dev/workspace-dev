#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const ALLOWED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);
const PACKAGE_MANIFESTS = [
  {
    label: "workspace-dev",
    packageJsonPath: path.resolve(packageRoot, "package.json"),
    allowRuntimeDependencies: false
  },
  {
    label: "template/react-mui-app",
    packageJsonPath: path.resolve(packageRoot, "template/react-mui-app/package.json"),
    allowRuntimeDependencies: true
  }
];

const main = async () => {
  for (const manifest of PACKAGE_MANIFESTS) {
    const packageJson = JSON.parse(await readFile(manifest.packageJsonPath, "utf8"));

    if (!packageJson.license || !ALLOWED_LICENSES.has(packageJson.license)) {
      throw new Error(
        `${manifest.label} license '${String(packageJson.license)}' is not in the allowlist (${[
          ...ALLOWED_LICENSES
        ].join(", ")}).`
      );
    }

    const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
    if (!manifest.allowRuntimeDependencies && runtimeDependencies.length > 0) {
      throw new Error(
        `Runtime dependencies are not permitted for ${manifest.label}: ${runtimeDependencies.join(", ")}`
      );
    }

    console.log(
      `License allowlist gate passed for ${manifest.label}: ${packageJson.license}; runtime dependencies: ${runtimeDependencies.length}`
    );
  }
};

main().catch((error) => {
  console.error("[license-allowlist] Failed:", error);
  process.exit(1);
});
