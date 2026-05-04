#!/usr/bin/env node
/**
 * Multi-agent harness boundary lint (Issue #1791, Story MA-3 #1758).
 *
 * Catches structural drift in the multi-agent harness layer:
 *
 *   1. LLM-role modules (semantic-judge-panel.ts, adversarial-gap-finder.ts,
 *      ir-mutation-oracle.ts, repair-planner.ts, finding-consolidator.ts)
 *      must not import the LLM gateway, raw `fs` / `node:fs`, the review
 *      store, or any evidence module directly. They must not call `fetch`
 *      directly either — gateway access goes through the typed
 *      `LlmGatewayClient` argument the harness hands them.
 *
 *   2. Prompt payloads must not embed finding text by string concatenation.
 *      Findings and repair instructions move as typed JSON arrays so the
 *      gateway can validate, redact, and dedupe them. Mirrors the existing
 *      check in `scripts/check-boundary.mjs` for defence-in-depth.
 *
 *   3. Architecture-fit self-test: any harness-related module must live
 *      under one of the allowed roots (`src/test-intelligence/`,
 *      `ui-src/src/features/workspace/inspector/test-intelligence/`,
 *      `docs/test-intelligence-*`). A new top-level path silently gaining
 *      harness code would defeat the boundary, so we surface it as AT-029.
 *
 * Pure Node, zero deps. Runs as part of `release:quality-gates` via
 * `pnpm run lint:agent-boundaries`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");

// ── LLM-role modules (file paths relative to repo root, POSIX) ──────────────
const LLM_ROLE_MODULE_PATHS = new Set([
  "src/test-intelligence/adversarial-gap-finder.ts",
  "src/test-intelligence/finding-consolidator.ts",
  "src/test-intelligence/ir-mutation-oracle.ts",
  "src/test-intelligence/repair-planner.ts",
  "src/test-intelligence/semantic-judge-panel.ts",
]);

// ── Forbidden imports/calls inside LLM-role modules ─────────────────────────
const ROLE_FORBIDDEN_IMPORT_PATTERNS = [
  {
    name: "llm-gateway",
    pattern:
      /(?:from|import\s*\(|require\s*\()\s*["'](?:\.\.?\/)*(?:llm-gateway|llm-mock-gateway|llm-gateway-bundle|llm-gateway-client)(?:\.js)?["']/,
  },
  {
    name: "raw fs",
    pattern:
      /(?:from|import\s*\(|require\s*\()\s*["'](?:node:)?fs["']/,
  },
  {
    name: "review-store",
    pattern:
      /(?:from|import\s*\(|require\s*\()\s*["'](?:\.\.?\/)*(?:[\w-]+\/)*review-store(?:\.js)?["']/,
  },
  {
    name: "evidence module",
    pattern:
      /(?:from|import\s*\(|require\s*\()\s*["'](?:\.\.?\/)*(?:[\w-]+\/)*evidence-(?:attestation|manifest|verify|verify-route)(?:\.js)?["']/,
  },
];

// Direct `fetch(` calls (excluding obvious comment / JSDoc mentions).
// The lint runs line-by-line, so we accept this as a heuristic and rely on
// the role-module allowlist to keep the false-positive rate at zero.
const ROLE_FORBIDDEN_FETCH_PATTERN = /(?<![A-Za-z0-9_$.])fetch\s*\(/;

// ── Prompt payload boundary: typed JSON arrays only ─────────────────────────
const FORBIDDEN_FINDINGS_PROMPT_BODY_PATTERN =
  /kind\s*:\s*["'`](?:findings|repair_instructions)["'`][\s\S]{0,240}?body\s*:/i;

// ── Architecture-fit: harness-related code must live under allowed roots ────
const HARNESS_FILE_BASENAME_PATTERNS = [
  /^agent-harness(?:[-.]|$)/,
  /^harness-hooks(?:[-.]|$)/,
  /^semantic-judge-panel(?:[-.]|$)/,
  /^adversarial-gap-finder(?:[-.]|$)/,
  /^ir-mutation-oracle(?:[-.]|$)/,
  /^repair-planner(?:[-.]|$)/,
  /^finding-consolidator(?:[-.]|$)/,
  /^poc-harness(?:[-.]|$)/,
  /^agent-lessons-memdir(?:[-.]|$)/,
  /^lessons-consolidation-lock(?:[-.]|$)/,
];

const HARNESS_ALLOWED_PATH_PREFIXES = [
  "src/test-intelligence/",
  "ui-src/src/features/workspace/inspector/test-intelligence/",
  "docs/test-intelligence-",
];

// Files under these prefixes are skipped wholesale (they own the lint
// itself or are test fixtures simulating violations).
const SCAN_SKIP_PREFIXES = [
  "node_modules/",
  "dist/",
  ".git/",
  "scripts/check-agent-boundaries.mjs",
  "scripts/check-agent-boundaries.test.mjs",
  ".claude/",
  "coverage/",
  "stryker-",
  "tmp/",
  "build/",
];

const SCAN_ROOTS = ["src", "ui-src/src", "plugin", "scripts", "docs"];

// ── Helpers ─────────────────────────────────────────────────────────────────
const toPosix = (p) => p.split(path.sep).join("/");

const computeLineNumber = (content, index) =>
  content.slice(0, index).split("\n").length;

const isUnderSkipPrefix = (relPosix) =>
  SCAN_SKIP_PREFIXES.some((prefix) => relPosix.startsWith(prefix));

const collectFiles = async (rootAbs, repoRootAbs) => {
  const files = [];
  let stats;
  try {
    stats = await stat(rootAbs);
  } catch {
    return files;
  }
  if (!stats.isDirectory()) return files;

  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relPosix = toPosix(path.relative(repoRootAbs, full));
      if (isUnderSkipPrefix(relPosix)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (ext === ".ts" || ext === ".tsx" || ext === ".mjs" || ext === ".js") {
          files.push(full);
        }
      }
    }
  };
  await walk(rootAbs);
  return files;
};

const isHarnessRelatedBasename = (basename) =>
  HARNESS_FILE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));

const isAllowedHarnessLocation = (relPosix) =>
  HARNESS_ALLOWED_PATH_PREFIXES.some((prefix) => relPosix.startsWith(prefix));

// ── Core analyzer ───────────────────────────────────────────────────────────
export const analyzeAgentBoundaries = async ({
  repoRoot = DEFAULT_REPO_ROOT,
  scanRoots = SCAN_ROOTS,
  llmRoleModulePaths = LLM_ROLE_MODULE_PATHS,
} = {}) => {
  const violations = [];
  const seenFiles = new Set();
  const allFiles = [];

  for (const root of scanRoots) {
    const rootAbs = path.resolve(repoRoot, root);
    const found = await collectFiles(rootAbs, repoRoot);
    for (const file of found) {
      if (!seenFiles.has(file)) {
        seenFiles.add(file);
        allFiles.push(file);
      }
    }
  }

  for (const filePath of allFiles) {
    const relPosix = toPosix(path.relative(repoRoot, filePath));
    const basename = path.basename(filePath);
    const isTestFile =
      basename.endsWith(".test.ts") ||
      basename.endsWith(".test.tsx") ||
      basename.endsWith(".test.mjs") ||
      basename.endsWith(".test.js");

    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");

    // 1. LLM-role module forbidden imports + raw fetch.
    if (llmRoleModulePaths.has(relPosix)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of ROLE_FORBIDDEN_IMPORT_PATTERNS) {
          if (rule.pattern.test(line)) {
            violations.push({
              file: relPosix,
              line: i + 1,
              type: "role-module-import",
              message:
                `LLM-role module must not import ${rule.name} directly. ` +
                "Pass the typed LlmGatewayClient through the harness step input " +
                "and persist via injected writers.",
              snippet: line.trim(),
            });
          }
        }
        if (ROLE_FORBIDDEN_FETCH_PATTERN.test(line)) {
          violations.push({
            file: relPosix,
            line: i + 1,
            type: "role-module-fetch",
            message:
              "LLM-role module must not call fetch() directly. All network " +
              "calls go through the typed LlmGatewayClient argument.",
            snippet: line.trim(),
          });
        }
      }
    }

    // 2. Prompt payload boundary: typed JSON arrays only (production code).
    if (!isTestFile) {
      const m = content.match(FORBIDDEN_FINDINGS_PROMPT_BODY_PATTERN);
      if (m?.index !== undefined) {
        violations.push({
          file: relPosix,
          line: computeLineNumber(content, m.index),
          type: "prompt-finding-concat",
          message:
            "Findings and repair_instructions sections must be typed JSON arrays, " +
            "not body strings. Concatenated finding text is forbidden in prompts.",
          snippet: content.slice(m.index, m.index + 80).replace(/\s+/g, " "),
        });
      }
    }

    // 3. Architecture-fit: harness-related files must live under allowed roots.
    if (isHarnessRelatedBasename(basename) && !isAllowedHarnessLocation(relPosix)) {
      violations.push({
        file: relPosix,
        line: 0,
        type: "harness-path-out-of-bounds",
        message:
          "Harness-related module is outside the allowed roots " +
          `(${HARNESS_ALLOWED_PATH_PREFIXES.join(", ")}). Move it under ` +
          "src/test-intelligence/ to keep the boundary intact (AT-029).",
        snippet: basename,
      });
    }
  }

  return { files: allFiles, violations };
};

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const main = async () => {
  const { files, violations } = await analyzeAgentBoundaries();

  if (violations.length === 0) {
    console.log(
      "✅ Agent boundary check passed: no forbidden imports, prompts, or paths.",
    );
    console.log(
      `   Checked: ${files.length} source files across ${SCAN_ROOTS.length} roots`,
    );
    console.log(
      `   Role modules: ${LLM_ROLE_MODULE_PATHS.size}, harness file patterns: ${HARNESS_FILE_BASENAME_PATTERNS.length}`,
    );
    return 0;
  }

  console.error(
    `❌ Agent boundary check failed: ${violations.length} violation(s) found.\n`,
  );
  for (const v of violations) {
    const where = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    console.error(`  [${v.type}] ${where}`);
    console.error(`    ${v.message}`);
    if (v.snippet) console.error(`    > ${v.snippet}`);
    console.error("");
  }
  return 1;
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("Agent boundary check crashed:", err);
      process.exit(2);
    });
}

export {
  HARNESS_ALLOWED_PATH_PREFIXES,
  HARNESS_FILE_BASENAME_PATTERNS,
  LLM_ROLE_MODULE_PATHS,
  ROLE_FORBIDDEN_FETCH_PATTERN,
  ROLE_FORBIDDEN_IMPORT_PATTERNS,
  FORBIDDEN_FINDINGS_PROMPT_BODY_PATTERN,
};
