#!/usr/bin/env node

/**
 * Prompt-template-version CI guard (Issue #1943, ti-prod Wave 3).
 *
 * Enforces the contract documented in
 * `docs/test-intelligence-prompt-template-changelog.md`:
 *
 * - `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` is declared in
 *   `src/contracts/index.ts`.
 * - The SHA-256 of `src/test-intelligence/prompt-compiler.ts` is pinned
 *   in `docs/test-intelligence-prompt-template-version.lock.json`
 *   alongside the version it was captured under.
 * - Whenever the file content changes, the version must be bumped and
 *   the lock file refreshed. Skipping either step fails this guard.
 *
 * The guard intentionally does not parse the prompt-compiler AST: a
 * whole-file hash captures literal-string changes, helper refactors
 * that affect the compiled prompt, and import surface drift in a single
 * cheap check. Refactors that do not affect the compiled prompt body
 * still warrant a PATCH bump so operators have a single monotonically
 * increasing version to reason about replay-cache invalidation.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");

export const VERSION_CONST_REGEX =
  /export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s+as\s+const\s*;/;

const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const HEX_64_REGEX = /^[0-9a-f]{64}$/;

export function pathsForRoot(packageRoot) {
  return {
    promptCompiler: path.join(
      packageRoot,
      "src/test-intelligence/prompt-compiler.ts",
    ),
    contracts: path.join(packageRoot, "src/contracts/index.ts"),
    lock: path.join(
      packageRoot,
      "docs/test-intelligence-prompt-template-version.lock.json",
    ),
    changelog: path.join(
      packageRoot,
      "docs/test-intelligence-prompt-template-changelog.md",
    ),
  };
}

/**
 * Hash a UTF-8 source file with line-ending normalization so the guard
 * does not flap between platforms with different `core.autocrlf` settings.
 */
export async function hashFile(filePath) {
  const buf = await readFile(filePath);
  return hashSource(buf.toString("utf8"));
}

export function hashSource(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function extractVersionFromContractsSource(source) {
  const match = source.match(VERSION_CONST_REGEX);
  return match ? match[1] : null;
}

export function parseLockJson(raw, { lockPathLabel }) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Lock file ${lockPathLabel} is not valid JSON: ${cause.message}`,
    );
  }
  if (typeof parsed.version !== "string" || !SEMVER_REGEX.test(parsed.version)) {
    throw new Error(
      `Lock file ${lockPathLabel} is missing a semver \`version\` field.`,
    );
  }
  if (
    typeof parsed.promptCompilerSha256 !== "string" ||
    !HEX_64_REGEX.test(parsed.promptCompilerSha256)
  ) {
    throw new Error(
      `Lock file ${lockPathLabel} is missing a 64-hex \`promptCompilerSha256\` field.`,
    );
  }
  return { version: parsed.version, promptCompilerSha256: parsed.promptCompilerSha256 };
}

export function changelogMentionsVersion(source, version) {
  return source.includes(`## ${version}`);
}

/**
 * Pure rule evaluator — given the loaded inputs, produce the issue list.
 *
 * Hard checks (CI-enforced):
 *
 * - **Version mismatch** — `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION`
 *   must equal the `version` field in the lock file.
 * - **Content drift** — the SHA-256 of `prompt-compiler.ts` must equal
 *   the `promptCompilerSha256` field in the lock file.
 *
 * The rule is intentionally narrow: any change that moves prompt-compiler.ts
 * from the pinned hash *or* moves the version constant from the pinned
 * version forces the developer to update the lock file in the same PR.
 * Reviewer judgement (guided by
 * `docs/test-intelligence-prompt-template-changelog.md`) decides whether
 * the bump warranted a MINOR/MAJOR changelog entry — encoding that here
 * would require git-history awareness that a single-shot CI script does
 * not have.
 */
export function evaluatePromptTemplateVersionContract({
  currentVersion,
  currentHash,
  lockVersion,
  lockHash,
}) {
  const issues = [];

  if (currentVersion !== lockVersion) {
    issues.push(
      `Version mismatch: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "${currentVersion}" but lock file pins "${lockVersion}".`,
    );
  }

  if (currentHash !== lockHash) {
    issues.push(
      `Content drift: SHA-256 of src/test-intelligence/prompt-compiler.ts is ${currentHash} but lock file pins ${lockHash}.`,
    );
  }

  return issues;
}

export function formatRemediation({ currentVersion, lockVersion, currentHash }) {
  return [
    "Remediation:",
    `  1. Bump TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION in src/contracts/index.ts (current=${currentVersion}, lock=${lockVersion}).`,
    `  2. Update docs/test-intelligence-prompt-template-version.lock.json:`,
    `       version              = <new semver>`,
    `       promptCompilerSha256 = ${currentHash}`,
    `  3. Add a MINOR/MAJOR entry to docs/test-intelligence-prompt-template-changelog.md (PATCH bumps may skip this step).`,
    `  4. Update the explicit version snapshot in the *.golden.test.ts files so the bump is visible in the PR diff.`,
  ].join("\n");
}

export async function runCheck({ packageRoot = DEFAULT_PACKAGE_ROOT } = {}) {
  const paths = pathsForRoot(packageRoot);
  const [promptCompilerSource, contractsSource, lockRaw, changelogSource] =
    await Promise.all([
      readFile(paths.promptCompiler, "utf8"),
      readFile(paths.contracts, "utf8"),
      readFile(paths.lock, "utf8"),
      readFile(paths.changelog, "utf8"),
    ]);

  const currentHash = hashSource(promptCompilerSource);
  const currentVersion = extractVersionFromContractsSource(contractsSource);
  if (!currentVersion) {
    throw new Error(
      `Could not locate \`export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "<semver>" as const;\` in ${path.relative(packageRoot, paths.contracts)}. ` +
        "The CI guard's regex must stay in sync with the constant declaration.",
    );
  }
  const lock = parseLockJson(lockRaw, {
    lockPathLabel: path.relative(packageRoot, paths.lock),
  });

  // `changelogSource` is loaded for future use — for now we surface a
  // pointer to the changelog file in the failure message rather than
  // parsing it. Reading it here ensures the CI guard fails fast if the
  // file is accidentally deleted.
  void changelogSource;

  const issues = evaluatePromptTemplateVersionContract({
    currentVersion,
    currentHash,
    lockVersion: lock.version,
    lockHash: lock.promptCompilerSha256,
  });

  return {
    ok: issues.length === 0,
    currentVersion,
    currentHash,
    lockVersion: lock.version,
    lockHash: lock.promptCompilerSha256,
    issues,
  };
}

async function main() {
  const result = await runCheck();
  if (!result.ok) {
    const header =
      "[check-prompt-template-version] Prompt-template version contract violated.";
    const body = result.issues.map((line) => `  - ${line}`).join("\n");
    const remediation = formatRemediation({
      currentVersion: result.currentVersion,
      lockVersion: result.lockVersion,
      currentHash: result.currentHash,
    });
    process.stderr.write(`${header}\n${body}\n\n${remediation}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `[check-prompt-template-version] OK — version=${result.currentVersion}, hash=${result.currentHash}\n`,
  );
}

const isDirectInvocation = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(
      `[check-prompt-template-version] ${error.stack ?? error.message}\n`,
    );
    process.exit(1);
  });
}
