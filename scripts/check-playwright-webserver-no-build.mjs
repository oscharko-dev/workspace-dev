#!/usr/bin/env node
/**
 * Issue #1665 (audit-2026-05): structural lint that prevents the
 * Playwright `webServer.command` regression we just fixed from coming
 * back. Background: chaining `pnpm run build &&` (or any other build
 * invocation) inside `webServer.command` re-runs the full Vite
 * production build on every Playwright invocation, which is the root
 * cause of the 30-minute CI wall-clock that drove four sequential
 * timeout bumps on 2026-05-01.
 *
 * The orchestrator already produces `dist/` upstream; the Playwright
 * webServer should only launch the preview server.
 *
 * Cheap, deterministic, no runtime deps. Same shape as
 * `check-schema-names.mjs`.
 *
 * Usage:
 *   node scripts/check-playwright-webserver-no-build.mjs
 *
 * Exit codes:
 *   0  every webServer.command in template/** is build-free
 *   1  one or more violations found (printed to stderr)
 *   2  unexpected runtime error
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["template", "ui-src"];

// Match any string literal handed to `webServer.command` (template,
// single-quote, or double-quote). We err on the side of false positives:
// any embedded `pnpm run build`, `vite build`, `tsc -b`, or `tsc --build`
// inside a webServer command is flagged.
const WEBSERVER_COMMAND_RE =
  /webServer\s*:\s*\{[^}]*?command\s*:\s*[`'"]([^`'"]+)[`'"]/gs;
const FORBIDDEN_FRAGMENTS = [
  "pnpm run build",
  "pnpm exec vite build",
  "vite build",
  "tsc -b",
  "tsc --build",
];

const walk = async (dir) => {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (
      e.name.endsWith("playwright.config.ts") ||
      e.name.endsWith("playwright.config.mjs") ||
      e.name.endsWith("playwright.config.js")
    ) {
      out.push(p);
    }
  }
  return out;
};

/**
 * Pure analyser exported for the script's own test. Returns an array of
 * violation records; an empty array means the input is clean.
 */
export const analyzeSourceText = ({ filePath, text }) => {
  const findings = [];
  for (const m of text.matchAll(WEBSERVER_COMMAND_RE)) {
    const command = m[1];
    if (typeof command !== "string") continue;
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      if (command.includes(fragment)) {
        findings.push({ filePath, command, fragment });
      }
    }
  }
  return findings;
};

const run = async () => {
  const files = [];
  for (const root of ROOTS) {
    files.push(...(await walk(root)));
  }
  const errors = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    errors.push(...analyzeSourceText({ filePath: file, text }));
  }
  if (errors.length > 0) {
    for (const e of errors) {
      process.stderr.write(
        `[check-playwright-webserver-no-build] ${e.filePath}: webServer.command contains forbidden build fragment "${e.fragment}".\n` +
          `  full command: "${e.command}"\n` +
          `  Issue #1665: the Vite production build runs upstream; the webServer should only launch the preview server.\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write(
    `[check-playwright-webserver-no-build] All Playwright webServer.command values are build-free (scanned ${files.length} files).\n`,
  );
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run().catch((err) => {
    process.stderr.write(
      `[check-playwright-webserver-no-build] failed: ${err && err.message}\n`,
    );
    process.exit(2);
  });
}
