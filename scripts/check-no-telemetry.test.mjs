import { test } from "node:test";
import assert from "node:assert";
import {
  findViolationsInLine,
  hasTestSuffix,
  hasIncludedExtension,
  isSafeDestination,
  resolveScanRoots,
} from "./check-no-telemetry.mjs";

// ── hasTestSuffix tests ──────────────────────────────────────────────────────
test("hasTestSuffix: identifies .test.ts files", () => {
  assert.strictEqual(hasTestSuffix("foo.test.ts"), true);
  assert.strictEqual(hasTestSuffix("bar.test.tsx"), true);
  assert.strictEqual(hasTestSuffix("baz.test.js"), true);
  assert.strictEqual(hasTestSuffix("qux.test.mjs"), true);
});

test("hasTestSuffix: identifies .spec.* files", () => {
  assert.strictEqual(hasTestSuffix("foo.spec.ts"), true);
  assert.strictEqual(hasTestSuffix("bar.spec.tsx"), true);
  assert.strictEqual(hasTestSuffix("baz.spec.js"), true);
  assert.strictEqual(hasTestSuffix("qux.spec.mjs"), true);
});

test("hasTestSuffix: rejects non-test files", () => {
  assert.strictEqual(hasTestSuffix("foo.ts"), false);
  assert.strictEqual(hasTestSuffix("bar.tsx"), false);
  assert.strictEqual(hasTestSuffix("baz.js"), false);
  assert.strictEqual(hasTestSuffix("qux.mjs"), false);
});

// ── hasIncludedExtension tests ──────────────────────────────────────────────
test("hasIncludedExtension: identifies included extensions", () => {
  assert.strictEqual(hasIncludedExtension("foo.ts"), true);
  assert.strictEqual(hasIncludedExtension("bar.tsx"), true);
  assert.strictEqual(hasIncludedExtension("baz.js"), true);
  assert.strictEqual(hasIncludedExtension("qux.mjs"), true);
});

test("hasIncludedExtension: rejects excluded extensions", () => {
  assert.strictEqual(hasIncludedExtension("foo.json"), false);
  assert.strictEqual(hasIncludedExtension("bar.css"), false);
  assert.strictEqual(hasIncludedExtension("baz.html"), false);
  assert.strictEqual(hasIncludedExtension("qux"), false);
});

test("resolveScanRoots: selects template roots for the requested profile", () => {
  const defaultRoots = resolveScanRoots(["default"]).map((root) =>
    root.split("/").slice(-2).join("/"),
  );
  const rocketRoots = resolveScanRoots(["rocket"]).map((root) =>
    root.split("/").slice(-2).join("/"),
  );

  assert.ok(defaultRoots.includes("template/react-tailwind-app"));
  assert.ok(!defaultRoots.includes("template/react-mui-app"));
  assert.ok(rocketRoots.includes("template/react-mui-app"));
  assert.ok(!rocketRoots.includes("template/react-tailwind-app"));
});

// ── isSafeDestination tests (AC-2.1, AC-2.2, AC-2.3, AC-2.4) ────────────────
test("isSafeDestination: allows exact api.figma.com", () => {
  assert.strictEqual(isSafeDestination("https://api.figma.com/v1/files"), true);
});

test("isSafeDestination: allows *.figma.com subdomains", () => {
  assert.strictEqual(isSafeDestination("https://mcp.figma.com/rpc"), true);
  assert.strictEqual(isSafeDestination("https://cdn.figma.com/asset"), true);
});

test("isSafeDestination: rejects figma.com subdomain-spoof via suffix", () => {
  // `evilfigma.com.attacker.net` used to slip past substring matching.
  assert.strictEqual(
    isSafeDestination("https://evilfigma.com.attacker.net/track"),
    false,
  );
  assert.strictEqual(
    isSafeDestination("https://a.figma.com.attacker.net/track"),
    false,
  );
});

test("isSafeDestination: rejects bare figma.com without api subdomain", () => {
  // Only `api.figma.com` (exact) or `*.figma.com` subdomains are allowed;
  // plain `figma.com` is not — it has no subdomain and does not equal the
  // API host. This is intentionally stricter than the old substring check.
  assert.strictEqual(isSafeDestination("https://figma.com/plugin"), false);
});

test("isSafeDestination: allows loopback hostnames exactly (any port)", () => {
  assert.strictEqual(isSafeDestination("http://localhost:4000/api"), true);
  assert.strictEqual(isSafeDestination("http://127.0.0.1:8080/data"), true);
  assert.strictEqual(isSafeDestination("http://0.0.0.0:3000/status"), true);
});

test("isSafeDestination: rejects localhost subdomain-spoof", () => {
  assert.strictEqual(
    isSafeDestination("https://localhost.attacker.net/track"),
    false,
  );
});

test("isSafeDestination: allows internal workspace routes on loopback only", () => {
  assert.strictEqual(
    isSafeDestination("http://localhost/workspace/jobs"),
    true,
  );
  assert.strictEqual(isSafeDestination("http://localhost/healthz"), true);
});

test("isSafeDestination: rejects /workspace path on external host", () => {
  // Path-scoping: `/workspace/` is only safe on loopback hostnames.
  assert.strictEqual(
    isSafeDestination("https://example.com/workspace/jobs"),
    false,
  );
});

test("isSafeDestination: rejects telemetry destinations", () => {
  assert.strictEqual(isSafeDestination("https://example.com/track"), false);
  assert.strictEqual(
    isSafeDestination("https://analytics.example.com/event"),
    false,
  );
});

test("isSafeDestination: rejects malformed URL strings", () => {
  assert.strictEqual(isSafeDestination("not a url"), false);
  assert.strictEqual(isSafeDestination(""), false);
});

// ── findViolationsInLine: vendor imports ──────────────────────────────────────
test("findViolationsInLine: detects posthog-js imports", () => {
  const result = findViolationsInLine('import posthog from "posthog-js"');
  assert.strictEqual(result.includes("vendor-import"), true);
});

test("findViolationsInLine: detects @sentry/ imports", () => {
  const result = findViolationsInLine(
    'import { captureException } from "@sentry/react"',
  );
  assert.strictEqual(result.includes("vendor-import"), true);
});

test("findViolationsInLine: detects mixpanel imports", () => {
  const result = findViolationsInLine('import mixpanel from "mixpanel"');
  assert.strictEqual(result.includes("vendor-import"), true);
});

test("findViolationsInLine: detects amplitude imports", () => {
  const result = findViolationsInLine('import * as amplitude from "amplitude"');
  assert.strictEqual(result.includes("vendor-import"), true);
});

test("findViolationsInLine: detects segment imports", () => {
  const result = findViolationsInLine('import segment from "segment"');
  assert.strictEqual(result.includes("vendor-import"), true);
});

test("findViolationsInLine: detects @datadog/browser-rum imports", () => {
  const result = findViolationsInLine(
    'import { init } from "@datadog/browser-rum"',
  );
  assert.strictEqual(result.includes("vendor-import"), true);
});

// ── findViolationsInLine: vendor endpoints ───────────────────────────────────
test("findViolationsInLine: detects segment.io endpoints", () => {
  const result = findViolationsInLine(
    'const url = "https://api.segment.io/v1/track"',
  );
  assert.strictEqual(result.includes("vendor-endpoint"), true);
});

test("findViolationsInLine: detects posthog.com endpoints", () => {
  const result = findViolationsInLine(
    'fetch("https://app.posthog.com/decide")',
  );
  assert.strictEqual(result.includes("vendor-endpoint"), true);
});

test("findViolationsInLine: detects sentry.io endpoints", () => {
  const result = findViolationsInLine(
    'const sentry = "https://o123.ingest.sentry.io/1234"',
  );
  assert.strictEqual(result.includes("vendor-endpoint"), true);
});

test("findViolationsInLine: detects amplitude.com endpoints", () => {
  const result = findViolationsInLine(
    'fetch("https://api.amplitude.com/2/httpapi")',
  );
  assert.strictEqual(result.includes("vendor-endpoint"), true);
});

test("findViolationsInLine: detects amplitude2.com endpoints", () => {
  const result = findViolationsInLine(
    'const url = "https://api2.amplitude.com/batch"',
  );
  assert.strictEqual(result.includes("vendor-endpoint"), true);
});

// ── findViolationsInLine: fetch() telemetry patterns ─────────────────────────
test("findViolationsInLine: detects fetch() with telemetry URL", () => {
  const result = findViolationsInLine(
    'fetch("https://analytics.example.com/track")',
  );
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: detects fetch() with /analytics endpoint", () => {
  const result = findViolationsInLine(
    'fetch("https://example.com/analytics/events")',
  );
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: detects fetch() with /telemetry endpoint", () => {
  const result = findViolationsInLine('fetch("https://example.com/telemetry")');
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: detects fetch() with /event endpoint", () => {
  const result = findViolationsInLine('fetch("https://example.com/event")');
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: allows fetch() to Figma API", () => {
  const result = findViolationsInLine(
    'fetch("https://api.figma.com/v1/track")',
  );
  assert.strictEqual(result.includes("fetch-telemetry-url"), false);
});

test("findViolationsInLine: allows fetch() to localhost", () => {
  const result = findViolationsInLine('fetch("http://localhost:4000/track")');
  assert.strictEqual(result.includes("fetch-telemetry-url"), false);
});

test("findViolationsInLine: flags fetch() to figma.com subdomain-spoof (AC-2.5)", () => {
  // Regression guard: the old substring allowlist let this URL through
  // because the line contained the substring "figma.com".
  const result = findViolationsInLine(
    'fetch("https://evilfigma.com.attacker.net/track")',
  );
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: flags fetch() when a comment mentions localhost", () => {
  // Regression guard: previously, any mention of "localhost" on a line
  // disabled the generic checks for that line.
  const result = findViolationsInLine(
    '// see localhost notes; fetch("https://example.com/track")',
  );
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: allows fetch() to *.figma.com subdomain", () => {
  const result = findViolationsInLine('fetch("https://mcp.figma.com/rpc")');
  assert.strictEqual(result.includes("fetch-telemetry-url"), false);
});

// ── findViolationsInLine: navigator.sendBeacon ──────────────────────────────
test("findViolationsInLine: detects navigator.sendBeacon()", () => {
  const result = findViolationsInLine(
    'navigator.sendBeacon("https://example.com/event", data)',
  );
  assert.strictEqual(result.includes("send-beacon"), true);
});

test("findViolationsInLine: allows sendBeacon to localhost", () => {
  const result = findViolationsInLine(
    'navigator.sendBeacon("http://localhost:4000", data)',
  );
  assert.strictEqual(result.includes("send-beacon"), false);
});

// ── findViolationsInLine: XMLHttpRequest ─────────────────────────────────────
test("findViolationsInLine: detects new XMLHttpRequest() unconditionally", () => {
  const result = findViolationsInLine("const xhr = new XMLHttpRequest()");
  assert.strictEqual(result.includes("xhr-new"), true);
});

test("findViolationsInLine: detects xhr.open() with telemetry URL", () => {
  const result = findViolationsInLine(
    'xhr.open("POST", "https://example.com/track")',
  );
  assert.strictEqual(result.includes("xhr-open-telemetry-url"), true);
});

test("findViolationsInLine: allows xhr.open() to localhost", () => {
  const result = findViolationsInLine(
    'xhr.open("POST", "http://localhost:4000/debug")',
  );
  assert.strictEqual(result.includes("xhr-open-telemetry-url"), false);
});

// ── findViolationsInLine: WebSocket ──────────────────────────────────────────
test("findViolationsInLine: detects new WebSocket() with telemetry URL", () => {
  const result = findViolationsInLine(
    'new WebSocket("wss://example.com/track")',
  );
  assert.strictEqual(result.includes("websocket-telemetry-url"), true);
});

test("findViolationsInLine: detects new WebSocket() with analytics keyword", () => {
  const result = findViolationsInLine(
    'new WebSocket("wss://example.com/analytics")',
  );
  assert.strictEqual(result.includes("websocket-telemetry-url"), true);
});

test("findViolationsInLine: allows WebSocket to localhost", () => {
  const result = findViolationsInLine(
    'new WebSocket("ws://localhost:8000/debug")',
  );
  assert.strictEqual(result.includes("websocket-telemetry-url"), false);
});

// ── findViolationsInLine: multiple findings per line ─────────────────────────
test("findViolationsInLine: can emit multiple findings on one line", () => {
  const result = findViolationsInLine(
    'import posthog from "posthog-js"; fetch("https://example.com/track")',
  );
  assert.strictEqual(result.includes("vendor-import"), true);
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});

test("findViolationsInLine: returns empty array for clean lines", () => {
  const result = findViolationsInLine("const x = 42;");
  assert.strictEqual(result.length, 0);
});

test("findViolationsInLine: flags telemetry patterns even in comments", () => {
  const result = findViolationsInLine("// fetch('https://example.com/track')");
  assert.strictEqual(result.includes("fetch-telemetry-url"), true);
});
