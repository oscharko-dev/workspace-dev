#!/usr/bin/env tsx

/**
 * Judge-Calibration-Eval runner (Issue #1906).
 *
 * Loads the 20 hand-curated calibration fixtures under
 * `src/test-intelligence/fixtures/judge-calibration/`, evaluates the
 * Logic-Judge and Faithfulness-Judge predictions against the human
 * gold verdicts, and writes:
 *
 *   - `storybook-static/eval-reports/judge-calibration-logic.json`
 *   - `storybook-static/eval-reports/judge-calibration-faithfulness.json`
 *   - one row per judge appended to
 *     `storybook-static/eval-reports/judge-calibration-history.json`
 *
 * Two prediction sources:
 *
 *   - **mock (default)** — replays the `mockJudgeResponse` baseline
 *     recorded in `<id>.gold.json`. Deterministic and free; suitable
 *     for CI runs and smoke tests.
 *   - **live** — would invoke the real LLM gateway against each
 *     fixture's input. Off by default; gated by
 *     `WORKSPACE_TEST_SPACE_JUDGE_CALIBRATION_LIVE=1`. Live mode is a
 *     placeholder until the gateway role/model selection is wired up
 *     downstream — when the env var is set without that wiring, the
 *     script exits with a clear failure rather than silently falling
 *     back to mock.
 *
 * Exit code: non-zero on any threshold violation so the
 * release-quality-gate orchestrator attributes the breakage cleanly.
 *
 * Usage:
 *   tsx scripts/run-judge-calibration-eval.ts [--output-dir <path>]
 *                                              [--recorded-at <iso>]
 *                                              [--mode mock|live]
 */

import { fileURLToPath } from "node:url";

import {
  JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME,
  JUDGE_CALIBRATION_EVAL_FIXTURE_GENERATED_AT,
  JUDGE_CALIBRATION_JUDGE_IDS,
  appendJudgeCalibrationHistoryEntry,
  buildJudgeCalibrationEvalArtifact,
  buildSampleFromFixture,
  loadAllJudgeCalibrationFixtures,
  partitionSamplesByJudge,
  writeJudgeCalibrationEvalArtifact,
  type JudgeCalibrationJudgeId,
} from "../src/test-intelligence/judge-calibration-eval.js";

interface CliOptions {
  outputDir: string;
  recordedAt: string;
  mode: "mock" | "live";
}

const parseArgs = (argv: ReadonlyArray<string>): CliOptions => {
  let outputDir = JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME;
  let recordedAt = JUDGE_CALIBRATION_EVAL_FIXTURE_GENERATED_AT;
  let mode: CliOptions["mode"] =
    process.env["WORKSPACE_TEST_SPACE_JUDGE_CALIBRATION_LIVE"] === "1"
      ? "live"
      : "mock";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--output-dir requires a path");
      outputDir = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    } else if (arg === "--recorded-at") {
      const value = argv[i + 1];
      if (value === undefined)
        throw new Error("--recorded-at requires an ISO-8601 timestamp");
      recordedAt = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--recorded-at=")) {
      recordedAt = arg.slice("--recorded-at=".length);
    } else if (arg === "--mode") {
      const value = argv[i + 1];
      if (value !== "mock" && value !== "live") {
        throw new Error("--mode must be one of: mock, live");
      }
      mode = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "mock" && value !== "live") {
        throw new Error("--mode must be one of: mock, live");
      }
      mode = value;
    }
  }
  return { outputDir, recordedAt, mode };
};

const formatVerdictReasons = (
  failures: ReadonlyArray<{ reason: string; threshold: number; observed: number }>,
): string =>
  failures
    .map(
      (failure) =>
        `${failure.reason}(threshold=${failure.threshold},observed=${failure.observed})`,
    )
    .join(", ");

const main = async (): Promise<void> => {
  const { outputDir, recordedAt, mode } = parseArgs(process.argv.slice(2));
  if (mode === "live") {
    process.stderr.write(
      "judge-calibration-eval: live mode is gated behind a downstream gateway wiring that is not present in this build. Set --mode=mock or omit WORKSPACE_TEST_SPACE_JUDGE_CALIBRATION_LIVE=1 to use the recorded baseline.\n",
    );
    process.exit(2);
  }

  const fixtures = await loadAllJudgeCalibrationFixtures();
  const samples = fixtures.map((fixture) => buildSampleFromFixture(fixture));
  const split = partitionSamplesByJudge(samples);

  const failures: string[] = [];
  for (const judge of JUDGE_CALIBRATION_JUDGE_IDS) {
    const judgeSamples = split[judge];
    const artifact = buildJudgeCalibrationEvalArtifact({
      judge,
      samples: judgeSamples,
      generatedAt: recordedAt,
    });
    const reportPath = await writeJudgeCalibrationEvalArtifact({
      artifact,
      outputDir,
    });
    process.stdout.write(`wrote ${reportPath}\n`);
    const historyPath = await appendJudgeCalibrationHistoryEntry({
      artifact,
      recordedAt,
      outputDir,
    });
    process.stdout.write(`appended ${historyPath} (judge=${judge})\n`);

    if (!artifact.verdict.passed) {
      failures.push(
        `${judge}: ${formatVerdictReasons(artifact.verdict.failures)}`,
      );
    } else {
      process.stdout.write(
        `judge-calibration-eval gate passed for ${judge} ` +
          `(samples=${artifact.metrics.sampleCount}, accuracy=${artifact.metrics.accuracy}, ` +
          `fpr=${artifact.metrics.falsePositiveRate}, fnr=${artifact.metrics.falseNegativeRate})\n`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `judge-calibration-eval gate failed for ${failures.length} judge(s):\n`,
    );
    for (const failure of failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.exit(1);
  }
};

const isDirectExec = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1];
    return argv1 !== undefined && (argv1 === here || argv1.endsWith("/run-judge-calibration-eval.ts"));
  } catch {
    return true;
  }
})();

if (isDirectExec) {
  main().catch((error) => {
    process.stderr.write(
      `judge-calibration-eval runner crashed: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }\n`,
    );
    process.exit(1);
  });
}

export { main as runJudgeCalibrationEvalCli };
