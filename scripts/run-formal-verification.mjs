#!/usr/bin/env node
/**
 * Formal-verification driver (Issue #2181).
 *
 * Loads every `*.smv` spec under a directory tree (defaults to the
 * pilot tree at `src/test-intelligence/formal-verification/specs/`),
 * lifts each spec into a Kripke structure, model-checks the embedded
 * LTL / CTL formulae, and persists the consolidated artifact at
 * `<output-dir>/formal-verification-report.json`.
 *
 * Usage:
 *   node scripts/run-formal-verification.mjs \
 *     [--specs-dir <path>] \
 *     [--output-dir <path>] \
 *     [--include <glob-or-fixture-dir>] \
 *     [--quiet]
 *
 * The runner is **deterministic**: identical specs and a fixed
 * `--generated-at` produce byte-identical reports. CI pins
 * `--generated-at` to a stable run timestamp so the artifact joins
 * the seal-bundle Merkle tree without churn.
 *
 * Exit codes:
 *   0 — every formula verified
 *   1 — at least one formula failed model checking
 *   2 — parse / model construction error
 */

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FORMAL_VERIFICATION_REPORT_ARTIFACT_FILENAME,
  buildFormalVerificationReport,
  renderFormalVerificationReportJson,
  renderFormalVerificationReportText,
} from "../src/test-intelligence/formal-verification.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SPECS_DIR = path.resolve(
  REPO_ROOT,
  "src/test-intelligence/formal-verification/specs",
);

/**
 * Parse argv. Pure — no I/O. Returns the structured options or throws
 * a `TypeError` for unknown / malformed flags so the caller produces
 * a clear top-level error.
 */
const parseArgs = (argv) => {
  const result = {
    specsDirs: [],
    outputDir: REPO_ROOT,
    generatedAt: undefined,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--specs-dir") {
      const value = argv[++i];
      if (value === undefined) throw new TypeError("--specs-dir requires a path");
      result.specsDirs.push(path.resolve(REPO_ROOT, value));
    } else if (arg && arg.startsWith("--specs-dir=")) {
      result.specsDirs.push(
        path.resolve(REPO_ROOT, arg.slice("--specs-dir=".length)),
      );
    } else if (arg === "--include") {
      const value = argv[++i];
      if (value === undefined) throw new TypeError("--include requires a path");
      result.specsDirs.push(path.resolve(REPO_ROOT, value));
    } else if (arg && arg.startsWith("--include=")) {
      result.specsDirs.push(
        path.resolve(REPO_ROOT, arg.slice("--include=".length)),
      );
    } else if (arg === "--output-dir") {
      const value = argv[++i];
      if (value === undefined) throw new TypeError("--output-dir requires a path");
      result.outputDir = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--output-dir=")) {
      result.outputDir = path.resolve(
        REPO_ROOT,
        arg.slice("--output-dir=".length),
      );
    } else if (arg === "--generated-at") {
      const value = argv[++i];
      if (value === undefined)
        throw new TypeError("--generated-at requires an ISO-8601 timestamp");
      result.generatedAt = value;
    } else if (arg && arg.startsWith("--generated-at=")) {
      result.generatedAt = arg.slice("--generated-at=".length);
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: run-formal-verification.mjs [--specs-dir <path>]... [--output-dir <path>] [--generated-at <iso>] [--quiet]\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  if (result.specsDirs.length === 0) {
    result.specsDirs.push(DEFAULT_SPECS_DIR);
  }
  return result;
};

/**
 * Recursively collect every `*.smv` file under `root`. Output is
 * sorted by absolute path so the report ordering is deterministic.
 */
const collectSpecPaths = async (root) => {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".smv")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
};

const fileLastModified = async (filePath) => {
  const s = await stat(filePath);
  return s.mtime.toISOString();
};

const ensureDir = async (dir) => {
  await mkdir(dir, { recursive: true });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  // Collect spec paths from every supplied directory.
  const collected = [];
  for (const dir of args.specsDirs) {
    const paths = await collectSpecPaths(dir);
    collected.push(...paths);
  }
  if (collected.length === 0) {
    process.stderr.write(
      `formal-verification: no .smv specs found under ${args.specsDirs.join(", ")}\n`,
    );
    process.exit(2);
  }

  // Compute a deterministic generatedAt when the caller does not
  // supply one. We use the most recent spec mtime — identical specs
  // produce identical reports across runs.
  let generatedAt = args.generatedAt;
  if (generatedAt === undefined) {
    const stamps = await Promise.all(collected.map(fileLastModified));
    generatedAt = stamps.sort().pop() ?? new Date(0).toISOString();
  }

  // Load every spec relative to REPO_ROOT so the persisted `specPath`
  // is stable across machines and CI.
  const specs = [];
  for (const abs of collected) {
    const rel = path.relative(REPO_ROOT, abs);
    const specSource = await readFile(abs, "utf8");
    specs.push({ specPath: rel, specSource });
  }

  let report;
  try {
    report = buildFormalVerificationReport({ specs, generatedAt });
  } catch (err) {
    process.stderr.write(`formal-verification: ${String(err && err.message ? err.message : err)}\n`);
    process.exit(2);
  }

  await ensureDir(args.outputDir);
  const outputPath = path.join(
    args.outputDir,
    FORMAL_VERIFICATION_REPORT_ARTIFACT_FILENAME,
  );
  await writeFile(outputPath, renderFormalVerificationReportJson(report), "utf8");

  if (!args.quiet) {
    process.stdout.write(renderFormalVerificationReportText(report));
    process.stdout.write(`\nwrote ${outputPath}\n`);
  }

  if (report.summary.verdict === "fail") {
    process.exit(1);
  }
};

main().catch((err) => {
  process.stderr.write(`formal-verification: ${String(err && err.stack ? err.stack : err)}\n`);
  process.exit(2);
});
