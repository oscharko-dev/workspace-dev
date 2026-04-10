#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import { buildVisualBenchmarkPrComment } from "./visual-benchmark-pr-comment.mjs";

const [reportPath, ...restArgs] = process.argv.slice(2);

if (!reportPath) {
  console.error("[visual-benchmark-pr-comment] Usage: node scripts/print-visual-benchmark-pr-comment.mjs <last-run-json-path> --output <path> [--baseline-path <path>] [--artifact-url <url>]");
  process.exit(1);
}

const parseArgs = (args) => {
  let output;
  let baselinePath = "integration/fixtures/visual-benchmark/baseline.json";
  let artifactUrl;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--output") {
      output = args[index + 1];
    } else if (args[index] === "--baseline-path") {
      baselinePath = args[index + 1];
    } else if (args[index] === "--artifact-url") {
      artifactUrl = args[index + 1];
    }
  }
  return { output, baselinePath, artifactUrl };
};

const main = async () => {
  const { output, baselinePath, artifactUrl } = parseArgs(restArgs);

  if (!output) {
    console.error("[visual-benchmark-pr-comment] --output <path> is required.");
    process.exit(1);
  }

  const result = await buildVisualBenchmarkPrComment(reportPath, { baselinePath, artifactUrl });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, `${result.body}\n`, "utf8");
  }
};

main().catch((error) => {
  console.error("[visual-benchmark-pr-comment] Failed to build PR comment:", error);
  process.exit(1);
});
