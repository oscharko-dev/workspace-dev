#!/usr/bin/env node
/**
 * G CI guard — `G_COVERAGE_OPTIMIZER_BASELINE_PASS` (Issue #2131).
 *
 * Regenerates the coverage-plan optimizer baseline and per-fixture SVG
 * Pareto plots from the current source and asserts byte-equality
 * against the committed artifacts in
 * `fixtures/test-intelligence/coverage-plan-optimizer/`.
 *
 * Any change to the surrogate model, NSGA-II implementation, default
 * config, or reference corpus that affects the baseline bytes will
 * fail this gate until the operator regenerates the artifacts via
 * `pnpm run generate:coverage-plan-optimizer-baseline` **and** lands
 * an ADR review for the regenerated baseline.
 *
 * AC #4 is also checked: the recommended plan for every fixture must
 * achieve at least 95 % of the per-fixture best-known kill rate while
 * spending at most 80 % of the per-fixture current static token cost.
 *
 * Usage:
 *   node scripts/check-coverage-plan-optimizer-baseline.mjs [--committed-dir <path>] [--quiet]
 *
 * Exit codes:
 *   0  baseline matches the committed bytes and AC #4 holds
 *   1  G violation (drift or AC #4 fail; details on stderr)
 *   2  unexpected error (filesystem, parser, etc.)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
  G_COVERAGE_OPTIMIZER_BASELINE_PASS,
  buildCoveragePlanOptimizerBaselineReport,
  computeCoveragePlanOptimizerReportDigest,
  serializeCoveragePlanOptimizerReport,
} from "../src/test-intelligence/coverage-plan-optimizer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const result = {
    committedDir: path.resolve(
      REPO_ROOT,
      COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
    ),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--committed-dir") {
      const value = argv[++i];
      if (value === undefined) {
        throw new TypeError("--committed-dir requires a path");
      }
      result.committedDir = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--committed-dir=")) {
      result.committedDir = path.resolve(
        REPO_ROOT,
        arg.slice("--committed-dir=".length),
      );
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: check-coverage-plan-optimizer-baseline.mjs [--committed-dir <path>] [--quiet]\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  return result;
};

const failWith = (message) => {
  process.stderr.write(`${G_COVERAGE_OPTIMIZER_BASELINE_PASS} FAILED: ${message}\n`);
  process.exit(1);
};

const readCommitted = async (filePath) => {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      failWith(
        `committed artifact not found at ${filePath}\n` +
          `run: pnpm run generate:coverage-plan-optimizer-baseline`,
      );
    }
    throw err;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const report = buildCoveragePlanOptimizerBaselineReport();
  const regeneratedBytes = serializeCoveragePlanOptimizerReport(report);

  const baselinePath = path.join(args.committedDir, "baseline.json");
  const committedBaseline = await readCommitted(baselinePath);
  if (regeneratedBytes !== committedBaseline) {
    failWith(
      `regenerated baseline bytes differ from committed artifact.\n` +
        `committed: ${baselinePath}\n` +
        `expected sha256: ${computeCoveragePlanOptimizerReportDigest(report)}\n` +
        `run: pnpm run generate:coverage-plan-optimizer-baseline\n` +
        `then commit the regenerated baseline.json + pareto-*.svg files and update the ADR if the surrogate model, NSGA-II, default config, or reference corpus changed.`,
    );
  }

  for (const fixture of report.fixtures) {
    const svgPath = path.join(
      args.committedDir,
      `pareto-${fixture.fixtureId}.svg`,
    );
    const committedSvg = await readCommitted(svgPath);
    if (committedSvg !== fixture.paretoPlotSvg) {
      failWith(
        `regenerated SVG plot bytes differ for fixture ${fixture.fixtureId}.\n` +
          `committed: ${svgPath}\n` +
          `run: pnpm run generate:coverage-plan-optimizer-baseline`,
      );
    }
  }

  if (!report.satisfiesAcceptanceCriteria) {
    const violators = report.fixtures
      .filter((f) => !f.satisfiesAcceptanceCriteria)
      .map((f) => `${f.fixtureId} (${f.selectionReason})`)
      .join(", ");
    failWith(
      `AC #4 not satisfied for: ${violators}\n` +
        `the recommended plan must achieve >= 95 % of bestKnownKillRate at <= 80 % of currentTokenCost.\n` +
        `re-tune the surrogate-model coefficients or update the reference corpus.`,
    );
  }

  if (!args.quiet) {
    process.stdout.write(
      `${G_COVERAGE_OPTIMIZER_BASELINE_PASS} ok (sha256=${computeCoveragePlanOptimizerReportDigest(report)}, fixtures=${report.fixtureCount})\n`,
    );
  }
};

main().catch((err) => {
  process.stderr.write(
    `check-coverage-plan-optimizer-baseline: ${String(err && err.stack ? err.stack : err)}\n`,
  );
  process.exit(2);
});
