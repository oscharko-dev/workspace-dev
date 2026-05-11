#!/usr/bin/env node
/**
 * Coverage-plan optimizer baseline generator (Issue #2131).
 *
 * Runs the NSGA-II Pareto-frontier search against the reference
 * benchmark corpus shipped in `src/test-intelligence/coverage-plan-optimizer.ts`
 * and writes:
 *
 *   - `fixtures/test-intelligence/coverage-plan-optimizer/baseline.json`
 *   - one `pareto-<fixtureId>.svg` per fixture in the same directory
 *
 * The artifacts are byte-stable: the same seed + same config + same
 * reference corpus produces the same bytes on every host. The CI gate
 * `G_COVERAGE_OPTIMIZER_BASELINE_PASS` regenerates these files on every
 * PR and asserts byte-equality against the committed copies.
 *
 * Usage:
 *   node scripts/generate-coverage-plan-optimizer-baseline.mjs [--output-dir <path>] [--quiet]
 *
 * Exit codes:
 *   0 — baseline + SVG plots regenerated successfully
 *   2 — unexpected error (filesystem, parser, etc.)
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
  buildCoveragePlanOptimizerBaselineReport,
  computeCoveragePlanOptimizerReportDigest,
  serializeCoveragePlanOptimizerReport,
} from "../src/test-intelligence/coverage-plan-optimizer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const result = {
    outputDir: path.resolve(REPO_ROOT, COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      const value = argv[++i];
      if (value === undefined) {
        throw new TypeError("--output-dir requires a path");
      }
      result.outputDir = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--output-dir=")) {
      result.outputDir = path.resolve(
        REPO_ROOT,
        arg.slice("--output-dir=".length),
      );
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: generate-coverage-plan-optimizer-baseline.mjs [--output-dir <path>] [--quiet]\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  return result;
};

const atomicWriteFile = async (filePath, bytes) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const report = buildCoveragePlanOptimizerBaselineReport();

  const baselinePath = path.join(args.outputDir, "baseline.json");
  await atomicWriteFile(
    baselinePath,
    Buffer.from(serializeCoveragePlanOptimizerReport(report), "utf8"),
  );

  const writtenPlots = [];
  for (const fixture of report.fixtures) {
    const svgPath = path.join(
      args.outputDir,
      `pareto-${fixture.fixtureId}.svg`,
    );
    await atomicWriteFile(svgPath, Buffer.from(fixture.paretoPlotSvg, "utf8"));
    writtenPlots.push(svgPath);
  }

  const digest = computeCoveragePlanOptimizerReportDigest(report);

  if (!args.quiet) {
    process.stdout.write(
      `wrote ${baselinePath} (sha256=${digest})\n` +
        writtenPlots.map((p) => `wrote ${p}\n`).join(""),
    );
  }
};

main().catch((err) => {
  process.stderr.write(
    `generate-coverage-plan-optimizer-baseline: ${String(err && err.stack ? err.stack : err)}\n`,
  );
  process.exit(2);
});
