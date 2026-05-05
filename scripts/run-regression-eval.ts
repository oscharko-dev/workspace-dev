#!/usr/bin/env tsx

/**
 * Regression-Eval runner (Issue #1907).
 *
 * Compares fresh snapshots produced by the current pipeline against the
 * approved baseline snapshots committed under
 * `src/test-intelligence/fixtures/regression-baselines/`. On drift the
 * runner writes a human-readable Markdown report under
 * `storybook-static/eval-reports/regression-drift-<timestamp>.md` and
 * exits non-zero so the release-quality-gate orchestrator attributes
 * the breakage to this gate with a clear log link.
 *
 * Approve mode: setting `FIGMAPIPE_REGRESSION_APPROVE=true` rewrites
 * every approved snapshot with the current pipeline output and skips
 * the drift comparison. The env var is rejected when running in CI so
 * approved snapshots only enter the repo via PR review.
 *
 * Usage:
 *   tsx scripts/run-regression-eval.ts [--output-dir <path>]
 */

import {
  REGRESSION_DRIFT_REPORT_DIRNAME,
  buildAllRegressionSnapshots,
  diffRegressionSnapshot,
  isRegressionApproveModeEnabled,
  isRegressionCiRuntime,
  loadRegressionSnapshot,
  writeDriftReport,
  writeRegressionSnapshot,
  type RegressionDriftDiff,
} from "../src/test-intelligence/regression-eval.js";

const parseArgs = (argv: ReadonlyArray<string>): { outputDir: string } => {
  let outputDir = REGRESSION_DRIFT_REPORT_DIRNAME;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--output-dir requires a path argument");
      }
      outputDir = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    }
  }
  return { outputDir };
};

const main = async (): Promise<void> => {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const approveMode = isRegressionApproveModeEnabled();

  if (approveMode && isRegressionCiRuntime()) {
    process.stderr.write(
      "regression-eval: FIGMAPIPE_REGRESSION_APPROVE is rejected in CI. Approve snapshots locally and commit the diff.\n",
    );
    process.exit(2);
  }

  const candidates = await buildAllRegressionSnapshots();

  if (approveMode) {
    for (const snapshot of candidates) {
      const path = await writeRegressionSnapshot({ snapshot });
      process.stdout.write(`approved ${path}\n`);
    }
    process.stdout.write(
      `regression-eval: approved ${candidates.length} snapshot(s)\n`,
    );
    return;
  }

  const diffs: RegressionDriftDiff[] = [];
  for (const candidate of candidates) {
    const baseline = await loadRegressionSnapshot(candidate.archetypeId);
    diffs.push(diffRegressionSnapshot({ baseline, candidate }));
  }

  const drifted = diffs.filter((diff) => diff.hasDrift);
  if (drifted.length === 0) {
    process.stdout.write(
      `regression-eval: ${candidates.length} archetype(s) match approved baselines (no drift)\n`,
    );
    return;
  }

  const reportPath = await writeDriftReport({
    diffs,
    generatedAt: new Date().toISOString(),
    outputDir,
  });
  process.stderr.write(
    `regression-eval drift detected for ${drifted.length} archetype(s):\n`,
  );
  for (const diff of drifted) {
    process.stderr.write(
      `  - ${diff.archetypeId}: ${diff.findings.length} finding(s)\n`,
    );
  }
  process.stderr.write(`drift report written to ${reportPath}\n`);
  process.stderr.write(
    "If the drift is intentional, run 'FIGMAPIPE_REGRESSION_APPROVE=true pnpm run test:ti-regression' locally and commit the snapshot diff.\n",
  );
  process.exit(1);
};

main().catch((error) => {
  process.stderr.write(
    `regression-eval runner crashed: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`,
  );
  process.exit(1);
});
