#!/usr/bin/env node

/**
 * Supply-chain guard: require `persist-credentials: false` on every
 * actions/checkout step in CI workflows.
 *
 * Persisting credentials writes the GITHUB_TOKEN into .git/config on the
 * runner disk, where any subsequent step can read it via `cat .git/config`.
 * Most jobs never need authenticated git writes; for those, token exposure
 * is pure downside.
 *
 * Allowlisted files may use `persist-credentials: true` for jobs that
 * explicitly require write access (e.g. changeset publish + gh release
 * create). All other checkouts must set `persist-credentials: false`.
 *
 * Allowlisted files (persist-credentials: true is accepted):
 *   - .github/workflows/changesets-release.yml  — release job does git writes
 */

import { readdir, readFile } from "node:fs/promises";
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

const CHECKOUT_PATTERN = /\bactions\/checkout@/;
const PERSIST_CREDENTIALS_FALSE = /\bpersist-credentials:\s*false\b/;
const PERSIST_CREDENTIALS_ANY = /\bpersist-credentials:/;
const YAML_COMMENT_LINE = /^\s*#/;

// Files where `persist-credentials: true` is acceptable because the job
// performs authenticated git writes (changeset publish, gh release create).
const PERSIST_TRUE_ALLOWLIST = new Set([
  ".github/workflows/changesets-release.yml",
]);

const leadingSpaces = (line) => line.match(/^(\s*)/)?.[1]?.length ?? 0;

export const scanWorkflowContent = (content, relativePath = "") => {
  const findings = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!CHECKOUT_PATTERN.test(line)) {
      continue;
    }
    if (YAML_COMMENT_LINE.test(line)) {
      continue;
    }

    // The step item starts with `      - uses:` at stepIndent spaces before `-`.
    const stepIndent = leadingSpaces(line);

    // Scan forward through lines belonging to this step (deeper-indented or
    // blank) looking for an explicit persist-credentials setting.
    let foundPersistFalse = false;
    let foundPersistTrue = false;

    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const nextLine = lines[j] ?? "";
      if (nextLine.trim() === "") {
        continue;
      }
      const nextIndent = leadingSpaces(nextLine);
      // A new YAML list item at the same level means we've left this step.
      if (nextIndent <= stepIndent && nextLine.trimStart().startsWith("-")) {
        break;
      }
      if (PERSIST_CREDENTIALS_FALSE.test(nextLine)) {
        foundPersistFalse = true;
        break;
      }
      if (PERSIST_CREDENTIALS_ANY.test(nextLine)) {
        foundPersistTrue = true;
        break;
      }
    }

    if (foundPersistFalse) {
      continue;
    }

    if (foundPersistTrue) {
      if (!PERSIST_TRUE_ALLOWLIST.has(relativePath)) {
        findings.push({
          line: i + 1,
          content: line.trim(),
          reason: "persist-credentials: true requires explicit allowlist entry",
        });
      }
      continue;
    }

    // No persist-credentials key at all — always a violation.
    findings.push({
      line: i + 1,
      content: line.trim(),
      reason: "missing explicit persist-credentials: false",
    });
  }

  return findings;
};

const collectWorkflowFiles = async (workflowDir) => {
  let entries;
  try {
    entries = await readdir(workflowDir, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) {
      continue;
    }
    files.push(path.join(workflowDir, entry.name));
  }
  return files.sort();
};

const toRelativePosix = (filePath, packageRoot) =>
  path.relative(packageRoot, filePath).split(path.sep).join("/");

export const runGuard = async ({
  packageRoot = resolvePackageRoot(),
  readTextFile = readFile,
  listWorkflowFiles,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const workflowDir = path.join(packageRoot, ".github", "workflows");
  const workflowFiles = await (listWorkflowFiles
    ? listWorkflowFiles(workflowDir)
    : collectWorkflowFiles(workflowDir));

  const violations = [];

  for (const filePath of workflowFiles) {
    const content = await readTextFile(filePath, "utf8");
    const relativePath = toRelativePosix(filePath, packageRoot);
    const fileFindings = scanWorkflowContent(content, relativePath);
    for (const finding of fileFindings) {
      violations.push({
        file: relativePath,
        line: finding.line,
        content: finding.content,
        reason: finding.reason,
      });
    }
  }

  if (violations.length > 0) {
    stderr(
      "[check-workflow-persist-credentials] Missing persist-credentials: false on actions/checkout steps:",
    );
    for (const v of violations) {
      stderr(` - ${v.file}:${v.line} ${v.content} [${v.reason}]`);
    }
    stderr(
      "[check-workflow-persist-credentials] Add `persist-credentials: false` to prevent GITHUB_TOKEN disk persistence.",
    );
    return 1;
  }

  stdout(
    `[check-workflow-persist-credentials] Passed. Scanned ${workflowFiles.length} workflow file(s).`,
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
