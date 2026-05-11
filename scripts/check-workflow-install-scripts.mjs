#!/usr/bin/env node

/**
 * Supply-chain guard: require `--ignore-scripts` on every CI dependency install.
 *
 * Scans `.github/workflows/*.yml` and `package.json` script values for any
 * `pnpm install`, `npm install`, or `npm ci` invocation missing
 * `--ignore-scripts`. Blocks lifecycle-script execution during CI installs
 * so a compromised dependency cannot run code before audit / signature gates.
 *
 * Guard operates per-line. If the install token is on one line and
 * `--ignore-scripts` is on a continuation line, the line is flagged.
 * Single-line installs are required.
 *
 * Allowlisted patterns (not dependency installs):
 *   - `pnpm exec playwright install` / `install-deps` — playwright browser CLI
 *   - yaml comment lines starting with `#`
 *   - `pnpm run <script>` and similar invocations that do not match an install token
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

// Tokens that trigger the guard. Whitespace (incl. tabs / multi-space) between
// `pnpm`/`npm` and the subcommand is tolerated so obfuscation does not bypass.
// `pnpm install` variants tolerated: `pnpm install`, `pnpm --dir <path> install`,
// `pnpm --dir=<path> install`, `pnpm -C <path> install`.
const PNPM_INSTALL_TOKEN =
  /\bpnpm(?:\s+(?:--dir(?:\s+|=)\S+|-C\s+\S+))?\s+install\b/;
const NPM_INSTALL_TOKEN = /\bnpm\s+install\b/;
const NPM_CI_TOKEN = /\bnpm\s+ci\b/;

// Allowlist: `pnpm exec playwright install` / `install-deps` are playwright's
// own browser-management CLI, not a dependency install.
const PLAYWRIGHT_INSTALL_PATTERN =
  /\bpnpm\s+exec\s+playwright\s+install(?:-deps)?\b/;

// Match the bare `--ignore-scripts` flag only. `--ignore-scripts=false` and
// `--no-ignore-scripts` intentionally do NOT satisfy the rule.
const IGNORE_SCRIPTS_FLAG = /(?:^|\s)--ignore-scripts(?=\s|$)/;

const stripInlineYamlComment = (rawLine) => {
  // A conservative strip: only treat a `#` as a comment marker when preceded
  // by whitespace or at the start of the line. This avoids mangling URLs etc.
  const hashIndex = rawLine.search(/(?:^|\s)#/);
  if (hashIndex === -1) {
    return rawLine;
  }
  if (hashIndex === 0) {
    return "";
  }
  return rawLine.slice(0, hashIndex);
};

const isYamlCommentLine = (line) => {
  return /^\s*#/.test(line);
};

const hasInstallToken = (line) => {
  if (PLAYWRIGHT_INSTALL_PATTERN.test(line)) {
    return false;
  }
  return (
    PNPM_INSTALL_TOKEN.test(line) ||
    NPM_INSTALL_TOKEN.test(line) ||
    NPM_CI_TOKEN.test(line)
  );
};

export const isInstallLineViolation = (rawLine) => {
  if (typeof rawLine !== "string") {
    return false;
  }
  if (rawLine.trim().length === 0) {
    return false;
  }
  if (isYamlCommentLine(rawLine)) {
    return false;
  }
  const lineWithoutComment = stripInlineYamlComment(rawLine);
  if (!hasInstallToken(lineWithoutComment)) {
    return false;
  }
  return !IGNORE_SCRIPTS_FLAG.test(lineWithoutComment);
};

export const scanWorkflowContent = (content) => {
  const findings = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isInstallLineViolation(line)) {
      findings.push({
        line: index + 1,
        content: line.trim(),
      });
    }
  }
  return findings;
};

export const scanPackageScripts = (pkg) => {
  const findings = [];
  const scripts =
    pkg &&
    typeof pkg === "object" &&
    pkg.scripts &&
    typeof pkg.scripts === "object"
      ? pkg.scripts
      : null;
  if (scripts === null) {
    return findings;
  }
  for (const [scriptName, scriptValue] of Object.entries(scripts)) {
    if (typeof scriptValue !== "string") {
      continue;
    }
    if (isInstallLineViolation(scriptValue)) {
      findings.push({
        scriptName,
        content: scriptValue.trim(),
      });
    }
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

const toRelativePosix = (filePath, packageRoot) => {
  return path.relative(packageRoot, filePath).split(path.sep).join("/");
};

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
    const fileFindings = scanWorkflowContent(content);
    for (const finding of fileFindings) {
      violations.push({
        file: toRelativePosix(filePath, packageRoot),
        line: finding.line,
        content: finding.content,
      });
    }
  }

  const packageJsonPath = path.join(packageRoot, "package.json");
  try {
    const packageContent = await readTextFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(packageContent);
    const scriptFindings = scanPackageScripts(parsed);
    for (const finding of scriptFindings) {
      violations.push({
        file: "package.json",
        scriptName: finding.scriptName,
        content: finding.content,
      });
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  if (violations.length > 0) {
    stderr(
      "[check-workflow-install-scripts] Missing --ignore-scripts on CI dependency installs:",
    );
    for (const violation of violations) {
      if ("scriptName" in violation) {
        stderr(
          ` - ${violation.file} [script: ${violation.scriptName}] ${violation.content}`,
        );
      } else {
        stderr(` - ${violation.file}:${violation.line} ${violation.content}`);
      }
    }
    stderr(
      "[check-workflow-install-scripts] Add --ignore-scripts to block lifecycle script execution during CI installs.",
    );
    return 1;
  }

  stdout(
    `[check-workflow-install-scripts] Passed. Scanned ${workflowFiles.length} workflow file(s) + package.json scripts.`,
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
