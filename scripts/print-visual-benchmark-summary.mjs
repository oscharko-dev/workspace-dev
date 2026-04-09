#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import { buildVisualBenchmarkSummary } from "./visual-benchmark-summary.mjs";

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
  const summary = await buildVisualBenchmarkSummary(reportPath);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
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
  console.error("[visual-benchmark-summary] Failed to summarize report:", error);
  process.exit(1);
});
