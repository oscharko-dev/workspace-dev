#!/usr/bin/env tsx

/**
 * FinOps SLO runner (Issue #2121).
 *
 * Evaluates the rolling-window FinOps SLO report from a committed baseline
 * input envelope, writes `artifacts/finops/finops-slo-report.json`, mirrors
 * alerts through the existing `DriftAlertSink` file sink, and exits non-zero
 * when any token, latency, or routing-cost SLO is breached.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFinOpsSloFileAlertSink,
  evaluateFinOpsSlo,
  publishFinOpsSloAlerts,
  writeFinOpsSloReport,
} from "../src/test-intelligence/finops-slo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = path.resolve(
  repoRoot,
  "fixtures/finops-slo/baseline-input.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(repoRoot, "artifacts/finops");

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

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.inputPath, "utf8");
  const parsed = JSON.parse(raw) as {
    generatedAt: string;
    policy: Parameters<typeof evaluateFinOpsSlo>[0]["policy"];
    store: Parameters<typeof evaluateFinOpsSlo>[0]["store"];
    routingSavingsRatio?: number;
  };

  const report = evaluateFinOpsSlo({
    generatedAt: parsed.generatedAt,
    policy: parsed.policy,
    store: parsed.store,
    ...(typeof parsed.routingSavingsRatio === "number"
      ? { routingSavingsRatio: parsed.routingSavingsRatio }
      : {}),
  });
  const reportPath = await writeFinOpsSloReport({
    report,
    outputDir: options.outputDir,
  });
  const alertPath = await publishFinOpsSloAlerts({
    report,
    sink: createFinOpsSloFileAlertSink(options.outputDir),
  });

  console.log(`[finops-slo] Wrote report to ${reportPath}`);
  if (alertPath !== undefined) {
    console.log(`[finops-slo] Wrote alerts to ${alertPath}`);
  }
  for (const budget of report.roleBudgets) {
    console.log(
      `[finops-slo] role=${budget.role} p95_tokens=${budget.rollingP95Tokens} budget=${budget.budgetTokens} status=${budget.passed ? "PASS" : "FAIL"}`,
    );
  }
  for (const trend of report.latencyTrends) {
    console.log(
      `[finops-slo] fixture=${trend.fixtureId} p95_latency_ms=${trend.rollingP95LatencyMs} budget_ms=${trend.budgetMs} status=${trend.passed ? "PASS" : "FAIL"}`,
    );
  }
  if (report.costDashboard !== undefined) {
    console.log(
      `[finops-slo] routing_savings=${report.costDashboard.observedSavingsRatio.toFixed(4)} minimum=${report.costDashboard.minimumSavingsRatio.toFixed(4)} status=${report.costDashboard.passed ? "PASS" : "FAIL"}`,
    );
  }
  return report.passed ? 0 : 1;
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[finops-slo] Failed: ${message}`);
    process.exit(1);
  });
