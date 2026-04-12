import { readFile } from "node:fs/promises";
import path from "node:path";

const extractSkippedCount = (content) => {
  let skipped = 0;
  let summaryHits = 0;

  for (const match of content.matchAll(/ℹ skipped (\d+)/gu)) {
    summaryHits += 1;
    skipped += Number.parseInt(match[1], 10);
  }

  for (const match of content.matchAll(/Test Files[^\n]*\|\s+(\d+)\s+skipped\b/gu)) {
    summaryHits += 1;
    skipped += Number.parseInt(match[1], 10);
  }

  for (const match of content.matchAll(/Tests[^\n]*\|\s+(\d+)\s+skipped\b/gu)) {
    summaryHits += 1;
    skipped += Number.parseInt(match[1], 10);
  }

  // TAP summary line from Node's test runner:
  // "# skipped 9"
  for (const match of content.matchAll(/#\s*skipped\s+(\d+)/gu)) {
    summaryHits += 1;
    skipped += Number.parseInt(match[1], 10);
  }

  return { skipped, summaryHits };
};

const run = async () => {
  const inputPaths = process.argv.slice(2).map((value) => value.trim()).filter((value) => value.length > 0);
  if (inputPaths.length === 0) {
    throw new Error("Usage: node scripts/assert-no-skipped-tests.mjs <log-file> [<log-file> ...]");
  }

  let totalSkipped = 0;
  let totalSummaryHits = 0;

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(process.cwd(), inputPath);
    const content = await readFile(absolutePath, "utf8");
    const result = extractSkippedCount(content);
    totalSkipped += result.skipped;
    totalSummaryHits += result.summaryHits;
  }

  if (totalSummaryHits === 0) {
    throw new Error(
      "No recognized test summary lines were found in the provided logs; refusing to pass no-skip gate.",
    );
  }

  if (totalSkipped > 0) {
    throw new Error(`No-skip gate failed: detected ${String(totalSkipped)} skipped tests.`);
  }

  process.stdout.write("No-skip gate passed: detected 0 skipped tests.\n");
};

await run();
