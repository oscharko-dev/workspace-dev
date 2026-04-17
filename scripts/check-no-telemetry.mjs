#!/usr/bin/env node

/**
 * Zero-telemetry guard (Wave 1, issue #1152).
 *
 * Broadens the telemetry scan beyond `src/` to also cover `ui-src/src`,
 * `plugin/`, and `template/`, and flags generic browser telemetry patterns
 * (`fetch(` to telemetry endpoints, `navigator.sendBeacon`, `XMLHttpRequest`,
 * `WebSocket`) in addition to the existing SDK import / endpoint denylist.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

// ── Directories to scan (AC-1.1) ────────────────────────────────────────────
const SCAN_ROOTS = [
  path.resolve(packageRoot, "src"),
  path.resolve(packageRoot, "ui-src/src"),
  path.resolve(packageRoot, "plugin"),
  path.resolve(packageRoot, "template"),
];

// ── File extensions to include / skip (AC-1.2) ──────────────────────────────
const INCLUDE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const TEST_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.mjs",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.mjs",
];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

// ── Legacy vendor denylist (preserved for AC-1.5 backward compatibility) ────
const TELEMETRY_IMPORT_PATTERNS = [
  /from\s+["']posthog-js["']/,
  /from\s+["']@sentry\//,
  /from\s+["']mixpanel/,
  /from\s+["']amplitude/,
  /from\s+["']segment/,
  /from\s+["']@datadog\/browser-rum/,
];

const TELEMETRY_ENDPOINT_PATTERNS = [
  /https:\/\/api\.segment\.io/i,
  /https:\/\/app\.posthog\.com/i,
  /https:\/\/o\d+\.ingest\.sentry\.io/i,
  /https:\/\/api2?\.amplitude\.com/i,
];

// ── Generic telemetry patterns (AC-1.3) ─────────────────────────────────────
// `fetch(` calls whose URL literal matches a telemetry-shaped endpoint.
const FETCH_CALL_PATTERN = /\bfetch\s*\(/;
const TELEMETRY_URL_IN_STRING_PATTERN =
  /["'`]https?:\/\/[^"'`\s]*(track|telemetry|analytics|event|metrics|collector|beacon)[^"'`\s]*["'`]/i;

// `navigator.sendBeacon` / `.sendBeacon(` — sensitive by design.
const SEND_BEACON_PATTERN = /\.sendBeacon\s*\(/;

// `new XMLHttpRequest` instantiation, or `.open(` calls that reference a
// telemetry-shaped URL literal on the same line.
const XHR_NEW_PATTERN = /\bnew\s+XMLHttpRequest\b/;
const XHR_OPEN_PATTERN = /\.open\s*\(/;

// `new WebSocket(` with a telemetry-shaped URL literal on the same line.
const WEBSOCKET_NEW_PATTERN = /\bnew\s+WebSocket\s*\(/;
const WEBSOCKET_TELEMETRY_URL_PATTERN =
  /["'`]wss?:\/\/[^"'`\s]*(track|telemetry|analytics|event|metrics|collector|beacon)[^"'`\s]*["'`]/i;

// ── Allowlist for known-safe destinations (AC-1.4) ──────────────────────────
// Lines that match one of these tokens are considered safe even if they
// otherwise trip a generic pattern:
//   - Figma API (`api.figma.com`, `figma.com` inc. `mcp.figma.com`, `cdn.figma.com`)
//   - MCP / local loopback (`localhost`, `127.0.0.1`, `0.0.0.0`)
//   - Internal workspace APIs served by this package (`/workspace/`, `/healthz`)
const SAFE_DESTINATION_TOKENS = [
  "api.figma.com",
  "figma.com",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "/workspace/",
  "/healthz",
];

// File-level allowlist for modules whose sensitive calls are intentional and
// audited. Paths are package-root-relative POSIX-style. Each entry MUST be
// accompanied by a comment explaining why the exemption is safe.
const ALLOWED_FILES = new Set([
  // Opt-in Web Vitals performance endpoint in the generated-app template.
  // The destination is supplied by the operator via `VITE_PERF_ENDPOINT`;
  // no vendor SDK is bundled and the stub no-ops when unset.
  "template/react-mui-app/src/performance/report-web-vitals.ts",
]);

const hasTestSuffix = (fileName) => {
  return TEST_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
};

const hasIncludedExtension = (fileName) => {
  const extension = path.extname(fileName);
  return INCLUDE_EXTENSIONS.has(extension);
};

const collectFiles = async (dir) => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (!entry.isFile() || !hasIncludedExtension(entry.name)) {
      continue;
    }
    if (hasTestSuffix(entry.name)) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
};

const toRelativePosix = (filePath) => {
  return path.relative(packageRoot, filePath).split(path.sep).join("/");
};

const lineHasSafeDestination = (line) => {
  return SAFE_DESTINATION_TOKENS.some((token) => line.includes(token));
};

const findViolationsInLine = (line) => {
  const findings = [];

  for (const pattern of TELEMETRY_IMPORT_PATTERNS) {
    if (pattern.test(line)) {
      findings.push("vendor-import");
      break;
    }
  }
  for (const pattern of TELEMETRY_ENDPOINT_PATTERNS) {
    if (pattern.test(line)) {
      findings.push("vendor-endpoint");
      break;
    }
  }

  if (
    FETCH_CALL_PATTERN.test(line) &&
    TELEMETRY_URL_IN_STRING_PATTERN.test(line) &&
    !lineHasSafeDestination(line)
  ) {
    findings.push("fetch-telemetry-url");
  }

  if (SEND_BEACON_PATTERN.test(line) && !lineHasSafeDestination(line)) {
    findings.push("send-beacon");
  }

  if (XHR_NEW_PATTERN.test(line)) {
    findings.push("xhr-new");
  } else if (
    XHR_OPEN_PATTERN.test(line) &&
    TELEMETRY_URL_IN_STRING_PATTERN.test(line) &&
    !lineHasSafeDestination(line)
  ) {
    findings.push("xhr-open-telemetry-url");
  }

  if (
    WEBSOCKET_NEW_PATTERN.test(line) &&
    (WEBSOCKET_TELEMETRY_URL_PATTERN.test(line) ||
      TELEMETRY_URL_IN_STRING_PATTERN.test(line)) &&
    !lineHasSafeDestination(line)
  ) {
    findings.push("websocket-telemetry-url");
  }

  return findings;
};

const main = async () => {
  const fileLists = await Promise.all(
    SCAN_ROOTS.map((root) => collectFiles(root)),
  );
  const files = fileLists.flat();
  const violations = [];

  for (const filePath of files) {
    const relativePath = toRelativePosix(filePath);
    if (ALLOWED_FILES.has(relativePath)) {
      continue;
    }
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const findings = findViolationsInLine(line);
      for (const reason of findings) {
        violations.push({
          file: relativePath,
          line: index + 1,
          reason,
          content: line.trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "Zero-telemetry guard failed. Potential telemetry traces detected:",
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line} [${violation.reason}] ${violation.content}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `Zero-telemetry guard passed. Scanned ${files.length} files across ${SCAN_ROOTS.length} roots.`,
  );
};

main().catch((error) => {
  console.error("Zero-telemetry guard failed:", error);
  process.exit(1);
});
