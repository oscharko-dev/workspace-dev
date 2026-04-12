#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import { buildVisualBenchmarkPrComment, VISUAL_BENCHMARK_PR_COMMENT_MARKER } from "./visual-benchmark-pr-comment.mjs";

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

  let result;
  try {
    result = await buildVisualBenchmarkPrComment(reportPath, { baselinePath, artifactUrl });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const artifactLinkText = artifactUrl ? `\n\n[Download artifacts](${artifactUrl})` : "";
    result = {
      marker: VISUAL_BENCHMARK_PR_COMMENT_MARKER,
      body: [
        VISUAL_BENCHMARK_PR_COMMENT_MARKER,
        "## Visual Quality Benchmark",
        "",
        ":warning: Visual benchmark comment was skipped due to missing or malformed artifacts.",
        "",
        `Reason: ${reason}`,
        artifactLinkText,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const allowStepSummary =
    process.env.VISUAL_BENCHMARK_ALLOW_STEP_SUMMARY === "true";
  if (summaryPath && allowStepSummary) {
    await appendFile(summaryPath, `${result.body}\n`, "utf8");
  }
};
main().catch((error) => {
  console.error("[visual-benchmark-pr-comment] Unexpected failure:", error);
  process.exit(1);
});
