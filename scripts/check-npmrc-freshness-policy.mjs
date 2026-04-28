#!/usr/bin/env node

/**
 * Supply-chain guard: require a non-zero `minimum-release-age` in every .npmrc.
 *
 * Scans the root `.npmrc` and bundled template `.npmrc` files to confirm that
 * `minimum-release-age` is present and set to a positive integer (minutes).
 * A zero or absent value means freshly-published packages can land in
 * node_modules immediately, eliminating the cooldown window that blocks
 * supply-chain worms during the npm takedown delay.
 *
 * This check is complementary to `check-workflow-install-scripts`: scripts
 * block execution if a bad version lands; freshness prevents it from landing.
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

const NPMRC_TARGETS = [
  ".npmrc",
  path.join("template", "react-mui-app", ".npmrc"),
  path.join("template", "react-tailwind-app", ".npmrc"),
];

// Matches `minimum-release-age=<value>` lines, ignoring inline comments.
const MINIMUM_RELEASE_AGE_LINE =
  /^\s*minimum-release-age\s*=\s*(.+?)\s*(?:#.*)?$/;
const COMMENT_LINE = /^\s*#/;

/**
 * Parse npmrc content and return the numeric value of `minimum-release-age`,
 * or `null` if the key is absent.
 */
export const parseMinimumReleaseAge = (content) => {
  for (const raw of content.split("\n")) {
    if (COMMENT_LINE.test(raw)) {
      continue;
    }
    const match = MINIMUM_RELEASE_AGE_LINE.exec(raw);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
  }
  return null;
};

/**
 * Validate a single .npmrc file content.
 * Returns a violation string, or `null` when compliant.
 */
export const checkNpmrcContent = (content, filePath) => {
  const value = parseMinimumReleaseAge(content);
  if (value === null) {
    return `${filePath}: missing \`minimum-release-age\` — add a non-zero value (e.g. 10080 for 7 days).`;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return `${filePath}: \`minimum-release-age\` must be a positive integer (minutes); got: ${value}.`;
  }
  return null;
};

export const runGuard = async ({
  packageRoot = resolvePackageRoot(),
  readTextFile = readFile,
  targets = NPMRC_TARGETS,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const violations = [];

  for (const rel of targets) {
    const filePath = path.join(packageRoot, rel);
    let content;
    try {
      content = await readTextFile(filePath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        violations.push(
          `${rel}: file not found — every .npmrc must set minimum-release-age.`,
        );
        continue;
      }
      throw error;
    }
    const violation = checkNpmrcContent(content, rel);
    if (violation !== null) {
      violations.push(violation);
    }
  }

  if (violations.length > 0) {
    stderr(
      "[check-npmrc-freshness-policy] Missing or invalid minimum-release-age:",
    );
    for (const v of violations) {
      stderr(` - ${v}`);
    }
    stderr(
      "[check-npmrc-freshness-policy] Set minimum-release-age to a positive integer (minutes) in each .npmrc." +
        " This is a zero-knowledge supply-chain defense: packages published within the window cannot enter node_modules.",
    );
    return 1;
  }

  stdout(
    `[check-npmrc-freshness-policy] Passed. Scanned ${targets.length} .npmrc file(s).`,
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
