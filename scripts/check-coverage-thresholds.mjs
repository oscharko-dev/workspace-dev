#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const coverageDir = path.resolve(packageRoot, "coverage");
const summaryPath = path.resolve(coverageDir, "coverage-summary.json");
const lcovPath = path.resolve(coverageDir, "lcov.info");

const MINIMUM_THRESHOLD = 90;

const parseLcovFunctionCoverage = (lcovContent) => {
  const lines = lcovContent.split("\n");
  let totalFunctions = 0;
  let coveredFunctions = 0;
  let fnData = [];

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      fnData = [];
      continue;
    }

    if (line.startsWith("FNDA:")) {
      const [, countText, name] = line.match(/^FNDA:(\d+),(.*)$/) ?? [];
      if (name) {
        fnData.push({ name, count: Number.parseInt(countText, 10) });
      }
      continue;
    }

    if (line === "end_of_record") {
      const merged = new Map();
      for (const entry of fnData) {
        const existing = merged.get(entry.name) ?? 0;
        merged.set(entry.name, Math.max(existing, entry.count));
      }

      // tsx/esbuild emits synthetic __name helpers that should not count as business functions.
      merged.delete("__name");

      totalFunctions += merged.size;
      for (const count of merged.values()) {
        if (count > 0) {
          coveredFunctions += 1;
        }
      }
      fnData = [];
    }
  }

  const pct = totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 100;
  return { totalFunctions, coveredFunctions, pct };
};

const main = async () => {
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const lcovContent = await readFile(lcovPath, "utf8");

  const dedupedFunctions = parseLcovFunctionCoverage(lcovContent);
  const linesPct = summary.total.lines.pct;
  const statementsPct = summary.total.statements.pct;
  const branchesPct = summary.total.branches.pct;
  const functionsPct = dedupedFunctions.pct;

  const failures = [];
  if (linesPct < MINIMUM_THRESHOLD) failures.push(`lines=${linesPct.toFixed(2)}%`);
  if (statementsPct < MINIMUM_THRESHOLD) failures.push(`statements=${statementsPct.toFixed(2)}%`);
  if (branchesPct < MINIMUM_THRESHOLD) failures.push(`branches=${branchesPct.toFixed(2)}%`);
  if (functionsPct < MINIMUM_THRESHOLD) failures.push(`functions=${functionsPct.toFixed(2)}%`);

  if (failures.length > 0) {
    throw new Error(
      `Coverage thresholds failed (minimum ${MINIMUM_THRESHOLD}%): ${failures.join(", ")}`
    );
  }

  console.log(
    `[coverage] Thresholds passed: lines=${linesPct.toFixed(2)}% statements=${statementsPct.toFixed(2)}% branches=${branchesPct.toFixed(2)}% functions=${functionsPct.toFixed(2)}% (deduped)`
  );
};

main().catch((error) => {
  console.error("[coverage] Gate failed:", error);
  process.exit(1);
});
