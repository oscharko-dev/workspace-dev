#!/usr/bin/env node

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProfileGateArgs,
  profilesFromIds,
  templateMetadata,
} from "./profile-gate-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.WORKSPACE_DEV_PACKAGE_ROOT
  ? path.resolve(process.env.WORKSPACE_DEV_PACKAGE_ROOT)
  : path.resolve(__dirname, "..");

const APPROVED_LICENSES = [
  "(MIT OR CC0-1.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0"
];

const ALLOWED_LICENSES = new Set(APPROVED_LICENSES);
const createPackageManifests = (profile) => [
  {
    label: "workspace-dev",
    packageJsonPath: path.resolve(packageRoot, "package.json"),
    allowRuntimeDependencies: false
  },
  ...profile.templates.map((templateId) => {
    const template = templateMetadata[templateId];
    return {
      label: template.packageRoot,
      packageJsonPath: path.resolve(packageRoot, template.packageRoot, "package.json"),
      allowRuntimeDependencies: true
    };
  })
];

const createTemplateDependencyTrees = (profile) =>
  profile.templates.map((templateId) => {
    const template = templateMetadata[templateId];
    return {
      label: template.packageRoot,
      nodeModulesPath: path.resolve(packageRoot, template.packageRoot, "node_modules")
    };
  });

const formatAllowedLicenses = () => {
  return APPROVED_LICENSES.join(", ");
};

const normalizeLicense = (value) => {
  if (typeof value !== "string") {
    return "UNLICENSED";
  }
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : "UNLICENSED";
};

const loadPackageJson = async (packageJsonPath) => {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
};

const statPath = async (targetPath) => {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const collectPackageEntries = async (nodeModulesPath) => {
  const entries = await readdir(nodeModulesPath, { withFileTypes: true });
  const packageEntryPaths = [];

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith("@")) {
      const scopeEntries = await readdir(entryPath, { withFileTypes: true });
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory() && !scopeEntry.isSymbolicLink()) {
          continue;
        }
        packageEntryPaths.push(path.join(entryPath, scopeEntry.name));
      }
      continue;
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    packageEntryPaths.push(entryPath);
  }

  return packageEntryPaths;
};

const collectInstalledPackages = async (nodeModulesPath) => {
  const pendingNodeModulesPaths = [nodeModulesPath];
  const visitedNodeModulesPaths = new Set();
  const visitedPackagePaths = new Set();
  const packages = [];

  while (pendingNodeModulesPaths.length > 0) {
    const currentNodeModulesPath = pendingNodeModulesPaths.pop();
    if (!currentNodeModulesPath) {
      continue;
    }

    const currentStats = await statPath(currentNodeModulesPath);
    if (!currentStats) {
      continue;
    }

    const realNodeModulesPath = await realpath(currentNodeModulesPath);
    if (visitedNodeModulesPaths.has(realNodeModulesPath)) {
      continue;
    }
    visitedNodeModulesPaths.add(realNodeModulesPath);

    const packageEntryPaths = await collectPackageEntries(realNodeModulesPath);
    for (const packageEntryPath of packageEntryPaths) {
      const realPackagePath = await realpath(packageEntryPath);
      if (visitedPackagePaths.has(realPackagePath)) {
        continue;
      }
      visitedPackagePaths.add(realPackagePath);

      const packageJsonPath = path.join(realPackagePath, "package.json");
      const packageStats = await statPath(packageJsonPath);
      if (!packageStats) {
        continue;
      }

      const packageJson = await loadPackageJson(packageJsonPath);
      packages.push({
        name: String(packageJson.name),
        version: String(packageJson.version),
        license: normalizeLicense(packageJson.license)
      });

      pendingNodeModulesPaths.push(path.join(realPackagePath, "node_modules"));
    }
  }

  return packages;
};

const collectInstalledPackagesFromPnpmStore = async (pnpmStorePath) => {
  const storeEntries = await readdir(pnpmStorePath, { withFileTypes: true });
  const seenPackages = new Set();
  const packages = [];

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory() || storeEntry.name.startsWith(".")) {
      continue;
    }

    const storeNodeModulesPath = path.join(pnpmStorePath, storeEntry.name, "node_modules");
    const storeNodeModulesStats = await statPath(storeNodeModulesPath);
    if (!storeNodeModulesStats) {
      continue;
    }

    const packageEntryPaths = await collectPackageEntries(storeNodeModulesPath);
    for (const packageEntryPath of packageEntryPaths) {
      const packageJsonPath = path.join(packageEntryPath, "package.json");
      const packageStats = await statPath(packageJsonPath);
      if (!packageStats) {
        continue;
      }

      const packageJson = await loadPackageJson(packageJsonPath);
      const packageKey = `${String(packageJson.name)}@${String(packageJson.version)}`;
      if (seenPackages.has(packageKey)) {
        continue;
      }
      seenPackages.add(packageKey);

      packages.push({
        name: String(packageJson.name),
        version: String(packageJson.version),
        license: normalizeLicense(packageJson.license)
      });
    }
  }

  return packages;
};

const assertManifestPolicy = async (manifest) => {
  const packageJson = await loadPackageJson(manifest.packageJsonPath);
  const manifestLicense = normalizeLicense(packageJson.license);

  if (!ALLOWED_LICENSES.has(manifestLicense)) {
    throw new Error(
      `${manifest.label} license '${manifestLicense}' is not in the allowlist (${formatAllowedLicenses()}).`
    );
  }

  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
  if (!manifest.allowRuntimeDependencies && runtimeDependencies.length > 0) {
    throw new Error(`Runtime dependencies are not permitted for ${manifest.label}: ${runtimeDependencies.join(", ")}`);
  }

  console.log(
    `License allowlist gate passed for ${manifest.label}: ${manifestLicense}; runtime dependencies: ${runtimeDependencies.length}`
  );
};

const assertTemplateDependencyTreePolicy = async ({ label, nodeModulesPath }) => {
  const nodeModulesStats = await statPath(nodeModulesPath);
  if (!nodeModulesStats) {
    throw new Error(
      `${label} node_modules is missing at '${nodeModulesPath}'. Run 'pnpm --dir ${label} install' before 'pnpm run verify:licenses'.`
    );
  }

  const templatePnpmStorePath = path.join(nodeModulesPath, ".pnpm");
  const pnpmStoreStats = await statPath(templatePnpmStorePath);
  const packages = pnpmStoreStats
    ? await collectInstalledPackagesFromPnpmStore(templatePnpmStorePath)
    : await collectInstalledPackages(nodeModulesPath);
  const disallowedPackages = packages
    .filter((packageEntry) => !ALLOWED_LICENSES.has(packageEntry.license))
    .sort((first, second) => {
      const nameComparison = first.name.localeCompare(second.name);
      return nameComparison !== 0 ? nameComparison : first.version.localeCompare(second.version);
    });

  if (disallowedPackages.length > 0) {
    const details = disallowedPackages
      .map((packageEntry) => `- ${packageEntry.name}@${packageEntry.version}: ${packageEntry.license}`)
      .join("\n");
    throw new Error(
      `${label} dependency tree contains ${disallowedPackages.length} package(s) with disallowed licenses:\n${details}\nAllowed licenses: ${formatAllowedLicenses()}`
    );
  }

  const uniqueLicenses = [...new Set(packages.map((packageEntry) => packageEntry.license))].sort();
  console.log(
    `License allowlist gate passed for ${label} installed dependency tree: ${packages.length} packages; licenses: ${uniqueLicenses.join(", ")}`
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const { profileIds } = parseProfileGateArgs(args);
  const profiles =
    args.length === 0
      ? [{ id: "all", templates: ["react-mui-app", "react-tailwind-app"] }]
      : profilesFromIds(profileIds);

  for (const profile of profiles) {
    console.log(`[license-allowlist] Checking profile '${profile.id}'.`);
    for (const manifest of createPackageManifests(profile)) {
      await assertManifestPolicy(manifest);
    }

    for (const templateDependencyTree of createTemplateDependencyTrees(profile)) {
      await assertTemplateDependencyTreePolicy(templateDependencyTree);
    }
  }
};

main().catch((error) => {
  console.error("[license-allowlist] Failed:", error);
  process.exit(1);
});
