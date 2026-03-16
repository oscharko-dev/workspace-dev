import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeSettings } from "./runtime.js";

test("resolveRuntimeSettings applies defaults for staged fetch and IR budget", () => {
  const runtime = resolveRuntimeSettings({});

  assert.equal(runtime.figmaTimeoutMs, 30_000);
  assert.equal(runtime.figmaMaxRetries, 3);
  assert.equal(runtime.figmaBootstrapDepth, 5);
  assert.equal(runtime.figmaNodeBatchSize, 6);
  assert.equal(runtime.figmaNodeFetchConcurrency, 3);
  assert.equal(runtime.figmaAdaptiveBatchingEnabled, true);
  assert.equal(runtime.figmaMaxScreenCandidates, 40);
  assert.equal(runtime.figmaCacheEnabled, true);
  assert.equal(runtime.figmaCacheTtlMs, 15 * 60_000);
  assert.equal(runtime.figmaScreenElementBudget, 1_200);
  assert.equal(runtime.commandTimeoutMs, 15 * 60_000);
  assert.equal(runtime.enableUiValidation, false);
  assert.equal(runtime.installPreferOffline, true);
  assert.equal(runtime.previewEnabled, true);
});

test("resolveRuntimeSettings clamps staged fetch and budget parameters", () => {
  const runtime = resolveRuntimeSettings({
    figmaBootstrapDepth: 999,
    figmaNodeBatchSize: 0,
    figmaNodeFetchConcurrency: 99,
    figmaAdaptiveBatchingEnabled: false,
    figmaMaxScreenCandidates: -5,
    figmaCacheEnabled: false,
    figmaCacheTtlMs: 999_999_999,
    figmaScreenElementBudget: 999_999,
    commandTimeoutMs: 10,
    enableUiValidation: false,
    installPreferOffline: false
  });

  assert.equal(runtime.figmaBootstrapDepth, 10);
  assert.equal(runtime.figmaNodeBatchSize, 1);
  assert.equal(runtime.figmaNodeFetchConcurrency, 10);
  assert.equal(runtime.figmaAdaptiveBatchingEnabled, false);
  assert.equal(runtime.figmaMaxScreenCandidates, 1);
  assert.equal(runtime.figmaCacheEnabled, false);
  assert.equal(runtime.figmaCacheTtlMs, 24 * 60 * 60_000);
  assert.equal(runtime.figmaScreenElementBudget, 10_000);
  assert.equal(runtime.commandTimeoutMs, 5_000);
  assert.equal(runtime.enableUiValidation, false);
  assert.equal(runtime.installPreferOffline, false);
});
