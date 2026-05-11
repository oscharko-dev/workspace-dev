#!/usr/bin/env node

/**
 * Supply-chain guard: enforce pnpm onlyBuiltDependencies allowlist.
 *
 * Verifies that:
 *  1. Both root and template package.json define pnpm.onlyBuiltDependencies
 *     as an array (the explicit lifecycle-script allowlist introduced in
 *     pnpm 10).
 *  2. Every package listed in the allowlist actually exists in the
 *     corresponding lockfile's packages/snapshots section, so stale entries
 *     don't give false confidence.
 *  3. No package in the lockfile is recorded as requiresBuild: true unless
 *     it appears in the allowlist — guards against new transitive deps
 *     silently gaining install-script execution rights.
 *
 * Runs against the root workspace and bundled application templates.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");

const resolvePackageRoot = (env = process.env) => {
  const override = env.WORKSPACE_DEV_PACKAGE_ROOT;
  if (typeof override === "string" && override.length > 0) {
    return path.resolve(override);
  }
  return DEFAULT_PACKAGE_ROOT;
};

const TARGETS = [
  { label: "root", pkgRel: "package.json", lockRel: "pnpm-lock.yaml" },
  {
    label: "template/react-mui-app",
    pkgRel: "template/react-mui-app/package.json",
    lockRel: "template/react-mui-app/pnpm-lock.yaml",
  },
  {
    label: "template/react-tailwind-app",
    pkgRel: "template/react-tailwind-app/package.json",
    lockRel: "template/react-tailwind-app/pnpm-lock.yaml",
  },
];

/**
 * Parse the set of package names that appear as keys in the lockfile's
 * packages: or snapshots: section, and the set with requiresBuild: true.
 */
export const parseLockfile = (content) => {
  const knownPackages = new Set();
  const requiresBuildPackages = new Set();

  // pnpm lockfile v9: top-level sections are "packages:" and "snapshots:".
  // Package keys look like:  /name@version:  or  name@version:
  // Strip version and leading slash to get the bare package name for checks.
  const requiresBuildPattern = /requiresBuild: true/;

  const lines = content.split("\n");
  let currentPkg = null;

  for (const line of lines) {
    const keyMatch = /^  ([@/\w][^:\s][^:]*):$/.exec(line);
    if (keyMatch) {
      currentPkg = keyMatch[1];
      const atIdx = currentPkg.lastIndexOf("@");
      const name = atIdx > 0 ? currentPkg.slice(0, atIdx) : currentPkg;
      knownPackages.add(name.replace(/^\//, ""));
    } else if (requiresBuildPattern.test(line) && currentPkg !== null) {
      const atIdx = currentPkg.lastIndexOf("@");
      const name = atIdx > 0 ? currentPkg.slice(0, atIdx) : currentPkg;
      requiresBuildPackages.add(name.replace(/^\//, ""));
    }
  }

  return { knownPackages, requiresBuildPackages };
};

export const runCheck = async ({
  packageRoot = resolvePackageRoot(),
  readTextFile = readFile,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const allViolations = [];

  for (const target of TARGETS) {
    const pkgPath = path.join(packageRoot, target.pkgRel);
    const lockPath = path.join(packageRoot, target.lockRel);

    let pkg;
    try {
      pkg = JSON.parse(await readTextFile(pkgPath, "utf8"));
    } catch (error) {
      allViolations.push(
        `[${target.label}] Could not read ${target.pkgRel}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }

    const allowlist = pkg?.pnpm?.onlyBuiltDependencies;

    if (!Array.isArray(allowlist)) {
      allViolations.push(
        `[${target.label}] ${target.pkgRel} is missing pnpm.onlyBuiltDependencies array. ` +
          `Add "onlyBuiltDependencies": [] to the "pnpm" block to explicitly allowlist packages permitted to run lifecycle scripts.`,
      );
      continue;
    }

    let lockContent;
    try {
      lockContent = await readTextFile(lockPath, "utf8");
    } catch (error) {
      allViolations.push(
        `[${target.label}] Could not read ${target.lockRel}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }

    const { knownPackages, requiresBuildPackages } = parseLockfile(lockContent);

    // Check 1: every allowlisted package exists in the lockfile.
    for (const entry of allowlist) {
      if (!knownPackages.has(entry)) {
        allViolations.push(
          `[${target.label}] onlyBuiltDependencies entry "${entry}" does not appear in ${target.lockRel}. ` +
            `Remove stale entries from the allowlist.`,
        );
      }
    }

    // Check 2: no requiresBuild package is absent from the allowlist.
    const allowlistSet = new Set(allowlist);
    for (const pkg of requiresBuildPackages) {
      if (!allowlistSet.has(pkg)) {
        allViolations.push(
          `[${target.label}] Package "${pkg}" has requiresBuild: true in ${target.lockRel} but is not listed in ` +
            `pnpm.onlyBuiltDependencies in ${target.pkgRel}. Add it to the allowlist or remove the dependency.`,
        );
      }
    }

    stdout(
      `[built-deps-allowlist] ${target.label}: allowlist has ${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"}, ` +
        `${requiresBuildPackages.size} requiresBuild package(s) in lockfile — OK`,
    );
  }

  if (allViolations.length > 0) {
    stderr("[built-deps-allowlist] Violations found:");
    for (const v of allViolations) {
      stderr(`  - ${v}`);
    }
    return 1;
  }

  stdout("[built-deps-allowlist] Passed.");
  return 0;
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  const exitCode = await runCheck();
  process.exit(exitCode);
}
