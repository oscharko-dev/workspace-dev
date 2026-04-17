import { test } from "node:test";
import assert from "node:assert";
import {
  findViolationsInLine,
  hasTestSuffix,
  hasIncludedExtension,
  lineHasSafeDestination,
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

// ── lineHasSafeDestination tests ────────────────────────────────────────────
test("lineHasSafeDestination: identifies Figma API calls", () => {
  assert.strictEqual(
    lineHasSafeDestination('fetch("https://api.figma.com/v1/files")'),
    true,
  );
  assert.strictEqual(
    lineHasSafeDestination('fetch("https://figma.com/plugin")'),
    true,
  );
});

test("lineHasSafeDestination: identifies MCP loopback calls", () => {
  assert.strictEqual(
    lineHasSafeDestination('fetch("http://localhost:4000/api")'),
    true,
  );
  assert.strictEqual(
    lineHasSafeDestination('fetch("http://127.0.0.1:8080/data")'),
    true,
  );
  assert.strictEqual(
    lineHasSafeDestination('fetch("http://0.0.0.0:3000/status")'),
    true,
  );
});

test("lineHasSafeDestination: identifies internal workspace routes", () => {
  assert.strictEqual(
    lineHasSafeDestination('fetch("http://localhost/workspace/jobs")'),
    true,
  );
  assert.strictEqual(
    lineHasSafeDestination('fetch("http://localhost/healthz")'),
    true,
  );
});

test("lineHasSafeDestination: rejects telemetry destinations", () => {
  assert.strictEqual(
    lineHasSafeDestination('fetch("https://example.com/track")'),
    false,
  );
  assert.strictEqual(
    lineHasSafeDestination('fetch("https://analytics.example.com/event")'),
    false,
  );
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
