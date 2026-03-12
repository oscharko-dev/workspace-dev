#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(packageRoot, "src");

const TELEMETRY_IMPORT_PATTERNS = [
  /from\s+["']posthog-js["']/,
  /from\s+["']@sentry\//,
  /from\s+["']mixpanel/,
  /from\s+["']amplitude/,
  /from\s+["']segment/,
  /from\s+["']@datadog\/browser-rum/
];

const TELEMETRY_ENDPOINT_PATTERNS = [
  /https:\/\/api\.segment\.io/i,
  /https:\/\/app\.posthog\.com/i,
  /https:\/\/o\d+\.ingest\.sentry\.io/i,
  /https:\/\/api2?\.amplitude\.com/i
];

const collectFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }
    if (entry.name.endsWith(".test.ts")) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
};

const main = async () => {
  const files = await collectFiles(sourceRoot);
  const violations = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      for (const pattern of TELEMETRY_IMPORT_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: path.relative(packageRoot, filePath),
            line: index + 1,
            content: line.trim()
          });
        }
      }
      for (const pattern of TELEMETRY_ENDPOINT_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: path.relative(packageRoot, filePath),
            line: index + 1,
            content: line.trim()
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("Zero-telemetry guard failed. Potential telemetry traces detected:");
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.content}`);
    }
    process.exit(1);
  }

  console.log("Zero-telemetry guard passed.");
};

main().catch((error) => {
  console.error("Zero-telemetry guard failed:", error);
  process.exit(1);
});
