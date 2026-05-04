#!/usr/bin/env tsx

/**
 * Release-quality-gates runner (Issue #1801).
 *
 * Loads the canonical-JSON input envelope produced by the harness
 * (or a curated baseline fixture committed to evidence), evaluates the
 * four hard gates, atomically writes the canonical-JSON report, and
 * exits non-zero on threshold breach so `release:quality-gates` fails
 * the release.
 *
 * Usage:
 *   tsx scripts/check-release-quality-gates.ts \
 *     [--input <path>] \
 *     [--output-dir <path>]
 *
 * Defaults:
 *   --input       fixtures/release-quality-gates/baseline-input.json
 *   --output-dir  artifacts/release-quality-gates
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME,
  type ReleaseQualityGatesInput,
} from "../src/contracts/index.js";
import {
  evaluateReleaseQualityGates,
  isReleaseQualityGatesInput,
  writeReleaseQualityGatesReport,
} from "../src/test-intelligence/release-quality-gates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = path.resolve(
  repoRoot,
  "fixtures/release-quality-gates/baseline-input.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  repoRoot,
  "artifacts/release-quality-gates",
);

interface CliOptions {
  readonly inputPath: string;
  readonly outputDir: string;
}

const resolveWithinRepo = (flag: string, value: string): string => {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `${flag}: path must resolve inside the repo root (${repoRoot}); got ${resolved}`,
    );
  }
  return resolved;
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let inputPath = DEFAULT_INPUT_PATH;
  let outputDir = DEFAULT_OUTPUT_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--input") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--input requires a path argument");
      }
      inputPath = resolveWithinRepo("--input", value);
      index += 1;
      continue;
    }
    if (flag === "--output-dir") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--output-dir requires a path argument");
      }
      outputDir = resolveWithinRepo("--output-dir", value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(flag)}`);
  }
  return { inputPath, outputDir };
};

const formatVerdict = (
  observed: number,
  threshold: number,
  comparator: "gte" | "lte" | "eq",
): string => {
  switch (comparator) {
    case "gte":
      return `${observed.toFixed(6)} >= ${threshold.toFixed(6)}`;
    case "lte":
      return `${observed.toFixed(6)} <= ${threshold.toFixed(6)}`;
    case "eq":
      return `${observed.toFixed(6)} === ${threshold.toFixed(6)}`;
  }
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.inputPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `[release-quality-gates] Could not parse JSON at ${options.inputPath}: ${(cause as Error).message}`,
    );
  }
  if (!isReleaseQualityGatesInput(parsed)) {
    throw new Error(
      `[release-quality-gates] Input at ${options.inputPath} failed structural validation`,
    );
  }
  const input: ReleaseQualityGatesInput = parsed;
  const report = evaluateReleaseQualityGates(input);
  const { artifactPath } = await writeReleaseQualityGatesReport({
    report,
    runDir: options.outputDir,
  });

  console.log(`[release-quality-gates] Wrote report to ${artifactPath}`);
  console.log(
    `[release-quality-gates] Filename: ${RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME}`,
  );
  for (const verdict of report.verdicts) {
    const status = verdict.passed ? "PASS" : "FAIL";
    const detail = formatVerdict(
      verdict.observed,
      verdict.threshold,
      verdict.comparator,
    );
    const attribution =
      verdict.attribution.length === 0
        ? ""
        : ` attribution=[${verdict.attribution.join(", ")}]`;
    console.log(
      `[release-quality-gates] ${status} ${verdict.gateId} ${detail}${attribution}`,
    );
  }
  return report.passed ? 0 : 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[release-quality-gates] Failed: ${message}`);
      process.exit(1);
    });
}
