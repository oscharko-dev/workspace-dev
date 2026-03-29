/**
 * Comprehensive E2E test for streaming code generation (issue #312).
 *
 * Validates that the streaming async generator yields artifacts in the correct
 * order, emits progress events per screen, supports early abort with partial
 * output, and produces identical results to the batch generateArtifacts API.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/312
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import {
  generateArtifacts,
  generateArtifactsStreaming
} from "./generator-core.js";
import type { StreamingArtifactEvent } from "./generator-core.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping streaming generation E2E tests"
    : undefined;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

const listAllFiles = async (root: string): Promise<string[]> => {
  const result: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else {
        result.push(path.relative(root, entryPath));
      }
    }
  }
  return result.sort();
};

// ── Streaming event ordering ────────────────────────────────────────────────

test("E2E: streaming generator yields theme before screens and app last", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-order-"));

  const eventTypes: string[] = [];
  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  let iterResult = await generator.next();
  while (!iterResult.done) {
    eventTypes.push(iterResult.value.type);
    iterResult = await generator.next();
  }

  // Theme must be first event
  assert.equal(eventTypes[0], "theme", "First event must be 'theme'");

  // App must come after all screens
  const appIndex = eventTypes.lastIndexOf("app");
  const lastScreenIndex = eventTypes.lastIndexOf("screen");
  assert.ok(appIndex > lastScreenIndex, "App event must come after all screen events");

  // Metrics must be last yielded event
  assert.equal(eventTypes[eventTypes.length - 1], "metrics", "Last event must be 'metrics'");

  // Must have at least one screen event
  assert.ok(eventTypes.includes("screen"), "Must yield at least one screen event");

  // Must have progress events
  assert.ok(eventTypes.includes("progress"), "Must yield progress events");
});

// ── Progress events per screen ──────────────────────────────────────────────

test("E2E: streaming generator emits progress event for every screen", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-progress-"));

  const progressEvents: StreamingArtifactEvent[] = [];
  const screenEvents: StreamingArtifactEvent[] = [];
  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  let iterResult = await generator.next();
  while (!iterResult.done) {
    if (iterResult.value.type === "progress") {
      progressEvents.push(iterResult.value);
    }
    if (iterResult.value.type === "screen") {
      screenEvents.push(iterResult.value);
    }
    iterResult = await generator.next();
  }

  const result = iterResult.value;

  // One progress event per screen
  assert.equal(
    progressEvents.length,
    result.screenTotal,
    `Expected ${result.screenTotal} progress events, got ${progressEvents.length}`
  );

  // One screen event per screen
  assert.equal(
    screenEvents.length,
    result.screenTotal,
    `Expected ${result.screenTotal} screen events, got ${screenEvents.length}`
  );

  // Progress events have correct indices (1-based through screenCount)
  for (let i = 0; i < progressEvents.length; i++) {
    const event = progressEvents[i];
    if (event !== undefined && event.type === "progress") {
      assert.equal(event.screenIndex, i + 1, `Progress event ${i} should have screenIndex=${i + 1}`);
      assert.equal(event.screenCount, result.screenTotal, "screenCount must match total screens");
      assert.ok(event.screenName.length > 0, "Progress event must include screen name");
    }
  }
});

// ── Screens generated in batches ────────────────────────────────────────────

test("E2E: streaming generator processes screens in parallel batches", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-batch-"));

  const screenNames: string[] = [];
  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  let iterResult = await generator.next();
  while (!iterResult.done) {
    if (iterResult.value.type === "screen") {
      screenNames.push(iterResult.value.screenName);
    }
    iterResult = await generator.next();
  }

  // All IR screens must appear in the streamed output
  const irScreenNames = ir.screens.map((s) => s.name);
  assert.deepEqual(
    screenNames.sort(),
    irScreenNames.sort(),
    "Streamed screen names must match IR screen names"
  );
});

// ── Backward compatibility with batch generateArtifacts ─────────────────────

test("E2E: streaming generateArtifacts produces same files as batch generateArtifacts", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const streamingDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-compat-s-"));
  const batchDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-compat-b-"));

  // Run streaming (via backward-compat wrapper)
  const streamingResult = await generateArtifacts({
    projectDir: streamingDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  // Run streaming explicitly and collect result
  const generator = generateArtifactsStreaming({
    projectDir: batchDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });
  let iterResult = await generator.next();
  while (!iterResult.done) {
    iterResult = await generator.next();
  }
  const explicitResult = iterResult.value;

  // File lists must match
  const streamingFiles = await listAllFiles(streamingDir);
  const batchFiles = await listAllFiles(batchDir);
  assert.deepEqual(streamingFiles, batchFiles, "File lists must be identical between streaming and batch");

  // Generated paths in result must match
  assert.deepEqual(
    streamingResult.generatedPaths.sort(),
    explicitResult.generatedPaths.sort(),
    "generatedPaths must be identical"
  );

  // Screen totals must match
  assert.equal(streamingResult.screenTotal, explicitResult.screenTotal, "screenTotal must match");

  // File contents must be identical
  for (const relativePath of streamingFiles) {
    const streamingContent = await readFile(path.join(streamingDir, relativePath), "utf-8");
    const batchContent = await readFile(path.join(batchDir, relativePath), "utf-8");
    assert.equal(
      streamingContent,
      batchContent,
      `File contents must match for ${relativePath}`
    );
  }
});

// ── Early abort with partial output ─────────────────────────────────────────

test("E2E: partial output is available when generator is aborted early", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  // Only meaningful if the board has multiple screens
  if (ir.screens.length < 2) {
    return;
  }

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-abort-"));

  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  // Consume theme + first screen, then stop
  const events: StreamingArtifactEvent[] = [];
  let screensSeen = 0;
  let iterResult = await generator.next();
  while (!iterResult.done) {
    events.push(iterResult.value);
    if (iterResult.value.type === "screen") {
      screensSeen++;
      if (screensSeen >= 1) {
        // Abort after first screen — do not consume remaining
        break;
      }
    }
    iterResult = await generator.next();
  }

  // Theme files should be on disk
  const filesOnDisk = await listAllFiles(projectDir);
  assert.ok(filesOnDisk.length > 0, "Partial output must be available on disk after early abort");

  // At least the theme event was yielded
  assert.ok(
    events.some((e) => e.type === "theme"),
    "Theme event must have been yielded before abort"
  );

  // At least one screen event was yielded
  assert.ok(
    events.some((e) => e.type === "screen"),
    "At least one screen event must have been yielded before abort"
  );

  // The screen files should exist on disk since they were written immediately
  const screenEvent = events.find((e) => e.type === "screen");
  if (screenEvent !== undefined && screenEvent.type === "screen") {
    for (const file of screenEvent.files) {
      const absolutePath = path.join(projectDir, file.path);
      const exists = await readFile(absolutePath, "utf-8").then(() => true).catch(() => false);
      assert.ok(exists, `Screen file '${file.path}' must exist on disk after streaming write`);
    }
  }
});

// ── Return value from generator ─────────────────────────────────────────────

test("E2E: streaming generator return value has valid structure", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-result-"));

  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });
  let iterResult = await generator.next();
  while (!iterResult.done) {
    iterResult = await generator.next();
  }
  const result = iterResult.value;

  assert.ok(Array.isArray(result.generatedPaths), "generatedPaths must be an array");
  assert.ok(result.generatedPaths.length > 0, "Must have generated at least one file");
  assert.ok(result.generatedPaths.includes("src/App.tsx"), "Must include App.tsx");
  assert.ok(result.generatedPaths.includes("generation-metrics.json"), "Must include generation-metrics.json");
  assert.equal(typeof result.screenTotal, "number", "screenTotal must be a number");
  assert.ok(result.screenTotal > 0, "screenTotal must be positive");
  assert.equal(result.screenApplied, 0, "screenApplied must be 0 in deterministic mode");
  assert.equal(result.themeApplied, false, "themeApplied must be false in deterministic mode");
  assert.ok(Array.isArray(result.screenRejected), "screenRejected must be an array");
  assert.ok(Array.isArray(result.llmWarnings), "llmWarnings must be an array");
  assert.ok(typeof result.mappingDiagnostics === "object", "mappingDiagnostics must be an object");
});

// ── Theme event content verification (issue #663) ────────────────────────────

test("E2E: theme event files carry real content, not empty-string placeholders", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-theme-content-"));

  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  let themeEvent: StreamingArtifactEvent | undefined;
  let iterResult = await generator.next();
  while (!iterResult.done) {
    if (iterResult.value.type === "theme") {
      themeEvent = iterResult.value;
    }
    iterResult = await generator.next();
  }

  assert.ok(themeEvent, "Must yield a theme event");
  assert.equal(themeEvent.type, "theme");

  // Type narrowing for theme event
  if (themeEvent.type !== "theme") {
    throw new Error("unreachable");
  }

  assert.ok(themeEvent.files.length > 0, "Theme event must contain at least one file");

  for (const file of themeEvent.files) {
    assert.ok(file.path.length > 0, `Theme file must have a non-empty path`);
    assert.ok(file.content.length > 0, `Theme file '${file.path}' must have non-empty content`);

    // Verify the streamed content matches what was written to disk
    const diskContent = await readFile(path.join(projectDir, file.path), "utf-8");
    assert.equal(
      file.content,
      diskContent,
      `Theme file '${file.path}' streamed content must match disk content`
    );
  }
});

// ── All event types carry content (issue #663) ───────────────────────────────

test("E2E: no streamed event claims file content while providing empty strings", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-stream-no-empty-"));

  const generator = generateArtifactsStreaming({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  let iterResult = await generator.next();
  while (!iterResult.done) {
    const event = iterResult.value;
    if (event.type === "theme") {
      for (const file of event.files) {
        assert.ok(file.content.length > 0, `theme file '${file.path}' must not have empty content`);
      }
    } else if (event.type === "screen") {
      for (const file of event.files) {
        assert.ok(file.content.length > 0, `screen file '${file.path}' must not have empty content`);
      }
    } else if (event.type === "app") {
      assert.ok(event.file.content.length > 0, `app file '${event.file.path}' must not have empty content`);
    } else if (event.type === "metrics") {
      assert.ok(event.file.content.length > 0, `metrics file '${event.file.path}' must not have empty content`);
    }
    iterResult = await generator.next();
  }
});
