#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import {
  buildUnavailableVisualBenchmarkSummary,
  buildVisualBenchmarkSummary,
} from "./visual-benchmark-summary.mjs";

const [reportPath, ...restArgs] = process.argv.slice(2);

if (!reportPath) {
  console.error("[visual-benchmark-summary] Usage: node scripts/print-visual-benchmark-summary.mjs <last-run-json-path> [--check-output <path>]");
  process.exit(1);
}

const resolveCheckOutputPath = (args) => {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check-output") {
      return args[index + 1];
    }
  }
  return undefined;
};

const main = async () => {
  let summary;
  try {
    summary = await buildVisualBenchmarkSummary(reportPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[visual-benchmark-summary] Using unavailable summary fallback:", reason);
    summary = buildUnavailableVisualBenchmarkSummary(reportPath, reason);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const allowStepSummary =
    process.env.VISUAL_BENCHMARK_ALLOW_STEP_SUMMARY === "true";
  if (summaryPath && allowStepSummary) {
    await appendFile(summaryPath, `${summary.markdown}\n`, "utf8");
  } else {
    process.stdout.write(`${summary.markdown}\n`);
  }

  const checkOutputPath = resolveCheckOutputPath(restArgs);
  if (checkOutputPath) {
    await writeFile(checkOutputPath, `${JSON.stringify(summary.check, null, 2)}\n`, "utf8");
  }
};

main().catch((error) => {
  console.error("[visual-benchmark-summary] Unexpected failure while writing summary output:", error);
  process.exit(1);
});
