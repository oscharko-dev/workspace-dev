#!/usr/bin/env node

import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

const reportPath = process.argv[2];

if (!reportPath) {
  console.error("[visual-benchmark-summary] Usage: node scripts/print-visual-benchmark-summary.mjs <last-run-json-path>");
  process.exit(0);
}

const toDisplayName = (fixtureId) =>
  fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const scoreEmoji = (score) => {
  if (score >= 90) return "\u2705";
  if (score >= 70) return "\u26A0\uFE0F";
  return "\u274C";
};

const main = async () => {
  const absolutePath = path.resolve(reportPath);
  const raw = await readFile(absolutePath, "utf8");
  const lastRun = JSON.parse(raw);

  const scores = lastRun.scores ?? [];
  const lastRunDir = path.join(path.dirname(absolutePath), "last-run");

  const rows = [];

  for (const entry of scores) {
    const displayName = toDisplayName(entry.fixtureId);
    let viewport = "\u2014";

    try {
      const manifestPath = path.join(lastRunDir, entry.fixtureId, "manifest.json");
      const manifestRaw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw);
      if (manifest.viewport) {
        viewport = `${manifest.viewport.width}\u00d7${manifest.viewport.height}`;
      }
    } catch {
      console.warn(`[visual-benchmark-summary] Could not read manifest for fixture "${entry.fixtureId}", using fallback viewport`);
    }

    rows.push({ displayName, score: entry.score, viewport });
  }

  const average =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : 0;

  const lines = [
    "## Visual Quality Benchmark",
    "",
    "| Fixture | Score | Viewport |",
    "|---------|-------|----------|",
  ];

  for (const row of rows) {
    lines.push(`| ${row.displayName} | ${scoreEmoji(row.score)} ${row.score} | ${row.viewport} |`);
  }

  lines.push("");
  lines.push(`**Overall Average: ${average % 1 === 0 ? average : average.toFixed(1)}**`);
  lines.push("");
  lines.push(`_Ran at ${lastRun.ranAt}_`);
  lines.push("");

  const markdown = lines.join("\n");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
};

main().catch((error) => {
  console.error("[visual-benchmark-summary] Failed to summarize report:", error);
  process.exitCode = 0;
});
