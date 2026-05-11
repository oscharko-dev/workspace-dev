#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const reportPath = process.argv[2];

if (!reportPath) {
  console.error("[perf-summary] Usage: node scripts/print-perf-report-summary.mjs <report-path>");
  process.exit(1);
}

const formatCheck = (check) => {
  const status = check.pass ? "PASS" : "FAIL";
  const pieces = [`${status}`, check.metric];
  if (typeof check.actual === "number") {
    pieces.push(`actual=${check.actual}`);
  }
  if (typeof check.baseline === "number") {
    pieces.push(`baseline=${check.baseline}`);
  }
  if (typeof check.budget === "number") {
    pieces.push(`budget=${check.budget}`);
  }
  if (typeof check.tolerancePct === "number") {
    pieces.push(`tolerancePct=${check.tolerancePct}`);
  }
  if (typeof check.reason === "string" && check.reason.length > 0) {
    pieces.push(`reason=${check.reason}`);
  }
  return pieces.join(" ");
};

const main = async () => {
  const absolutePath = path.resolve(reportPath);
  const payload = JSON.parse(await readFile(absolutePath, "utf8"));

  console.log(`[perf-summary] report=${absolutePath}`);
  console.log(
    `[perf-summary] baselineStatus=${String(payload.baselineStatus)} failedBudgets=${String(
      payload.counts?.failedBudgets ?? 0
    )} failedRegression=${String(payload.counts?.failedRegression ?? 0)} strict=${String(payload.config?.strict ?? false)}`
  );

  for (const check of payload.checks?.budgets ?? []) {
    console.log(`[perf-summary][budget] ${formatCheck(check)}`);
  }

  for (const check of payload.checks?.regression ?? []) {
    console.log(`[perf-summary][regression] ${formatCheck(check)}`);
  }
};

main().catch((error) => {
  console.error("[perf-summary] Failed to summarize report:", error);
  process.exit(1);
});
