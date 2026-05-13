#!/usr/bin/env node

/**
 * Supply-chain guard: enforce pnpm's repository-level hardening switches.
 *
 * These settings complement `.npmrc` and package-level
 * `pnpm.onlyBuiltDependencies`: they block newly published versions, refuse
 * unreviewed dependency build scripts, prevent transitive exotic resolvers, and
 * fail trust downgrades in sensitive dependency updates.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");

const POLICY_TARGETS = [
  {
    label: "root",
    workspaceRel: "pnpm-workspace.yaml",
    minimumReleaseAge: 10080,
    minimumReleaseAgeExclude: ["fast-uri"],
  },
  {
    label: "template/react-mui-app",
    workspaceRel: "template/react-mui-app/pnpm-workspace.yaml",
    minimumReleaseAge: 4320,
    minimumReleaseAgeExclude: [],
  },
  {
    label: "template/react-tailwind-app",
    workspaceRel: "template/react-tailwind-app/pnpm-workspace.yaml",
    minimumReleaseAge: 4320,
    minimumReleaseAgeExclude: [],
  },
];

const scalarValue = (raw) => {
  const value = raw.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "{}") {
    return {};
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value.replace(/^['"]|['"]$/g, "");
};

export const parseSimpleYaml = (content) => {
  const parsed = {};
  let currentArrayKey = null;
  let currentMapKey = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }

    const topLevel = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (topLevel) {
      const [, key, rawValue] = topLevel;
      currentArrayKey = null;
      currentMapKey = null;

      if (rawValue.length === 0) {
        parsed[key] = [];
        currentArrayKey = key;
        currentMapKey = key;
        continue;
      }

      parsed[key] = scalarValue(rawValue);
      if (
        parsed[key] &&
        typeof parsed[key] === "object" &&
        !Array.isArray(parsed[key])
      ) {
        currentMapKey = key;
      }
      continue;
    }

    const arrayItem = /^\s+-\s+(.+)$/.exec(line);
    if (arrayItem && currentArrayKey !== null) {
      if (!Array.isArray(parsed[currentArrayKey])) {
        throw new Error(`${currentArrayKey} is not an array`);
      }
      parsed[currentArrayKey].push(scalarValue(arrayItem[1]));
      continue;
    }

    const mapItem = /^\s+([^:\s][^:]*)\s*:\s*(.+)$/.exec(line);
    if (mapItem && currentMapKey !== null) {
      if (Array.isArray(parsed[currentMapKey])) {
        if (parsed[currentMapKey].length > 0) {
          throw new Error(`${currentMapKey} cannot mix array and map items`);
        }
        parsed[currentMapKey] = {};
      }
      parsed[currentMapKey][mapItem[1].trim()] = scalarValue(mapItem[2]);
      continue;
    }

    throw new Error(`Unsupported pnpm-workspace.yaml line: ${rawLine}`);
  }

  return parsed;
};

const sameStringArray = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((entry, index) => entry === expected[index]);

export const checkWorkspacePolicy = (content, target) => {
  const violations = [];
  let policy;

  try {
    policy = parseSimpleYaml(content);
  } catch (error) {
    return [
      `[${target.label}] ${target.workspaceRel} could not be parsed: ${
        error instanceof Error ? error.message : error
      }`,
    ];
  }

  if (!Array.isArray(policy.packages) || !policy.packages.includes(".")) {
    violations.push(
      `[${target.label}] packages must include "." to keep pnpm policy scoped and explicit.`,
    );
  }

  if (
    !Number.isInteger(policy.minimumReleaseAge) ||
    policy.minimumReleaseAge < target.minimumReleaseAge
  ) {
    violations.push(
      `[${target.label}] minimumReleaseAge must be at least ${target.minimumReleaseAge} minutes.`,
    );
  }

  const actualExclude = policy.minimumReleaseAgeExclude ?? [];
  if (!sameStringArray(actualExclude, target.minimumReleaseAgeExclude)) {
    violations.push(
      `[${target.label}] minimumReleaseAgeExclude must be exactly [${target.minimumReleaseAgeExclude.join(
        ", ",
      )}].`,
    );
  }

  if (policy.strictDepBuilds !== true) {
    violations.push(`[${target.label}] strictDepBuilds must be true.`);
  }

  if (
    !policy.allowBuilds ||
    typeof policy.allowBuilds !== "object" ||
    Array.isArray(policy.allowBuilds)
  ) {
    violations.push(`[${target.label}] allowBuilds must be an explicit map.`);
  } else {
    for (const [pkg, allowed] of Object.entries(policy.allowBuilds)) {
      if (allowed === true) {
        violations.push(
          `[${target.label}] allowBuilds.${pkg} grants install-script execution; use only after explicit security review.`,
        );
      }
    }
  }

  if (policy.dangerouslyAllowAllBuilds !== false) {
    violations.push(
      `[${target.label}] dangerouslyAllowAllBuilds must be false.`,
    );
  }

  if (policy.blockExoticSubdeps !== true) {
    violations.push(`[${target.label}] blockExoticSubdeps must be true.`);
  }

  if (policy.trustPolicy !== "no-downgrade") {
    violations.push(`[${target.label}] trustPolicy must be no-downgrade.`);
  }

  if (
    !Number.isInteger(policy.trustPolicyIgnoreAfter) ||
    policy.trustPolicyIgnoreAfter < 525600
  ) {
    violations.push(
      `[${target.label}] trustPolicyIgnoreAfter must be at least 525600 minutes.`,
    );
  }

  return violations;
};

export const runGuard = async ({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  readTextFile = readFile,
  targets = POLICY_TARGETS,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const violations = [];

  for (const target of targets) {
    const filePath = path.join(packageRoot, target.workspaceRel);
    let content;

    try {
      content = await readTextFile(filePath, "utf8");
    } catch (error) {
      violations.push(
        `[${target.label}] ${target.workspaceRel} could not be read: ${
          error instanceof Error ? error.message : error
        }`,
      );
      continue;
    }

    violations.push(...checkWorkspacePolicy(content, target));
  }

  if (violations.length > 0) {
    stderr("[check-pnpm-supply-chain-policy] Violations found:");
    for (const violation of violations) {
      stderr(` - ${violation}`);
    }
    return 1;
  }

  stdout(
    `[check-pnpm-supply-chain-policy] Passed. Scanned ${targets.length} pnpm workspace policy file(s).`,
  );
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
  const exitCode = await runGuard();
  process.exit(exitCode);
}
