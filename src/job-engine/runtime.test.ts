import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeSettings } from "./runtime.js";

test("resolveRuntimeSettings applies defaults for staged fetch and IR budget", () => {
  const runtime = resolveRuntimeSettings({});

  assert.equal(runtime.figmaTimeoutMs, 30_000);
  assert.equal(runtime.figmaMaxRetries, 3);
  assert.equal(runtime.figmaBootstrapDepth, 5);
  assert.equal(runtime.figmaNodeBatchSize, 6);
  assert.equal(runtime.figmaMaxScreenCandidates, 40);
  assert.equal(runtime.figmaScreenElementBudget, 1_200);
  assert.equal(runtime.previewEnabled, true);
});

test("resolveRuntimeSettings clamps staged fetch and budget parameters", () => {
  const runtime = resolveRuntimeSettings({
    figmaBootstrapDepth: 999,
    figmaNodeBatchSize: 0,
    figmaMaxScreenCandidates: -5,
    figmaScreenElementBudget: 999_999
  });

  assert.equal(runtime.figmaBootstrapDepth, 10);
  assert.equal(runtime.figmaNodeBatchSize, 1);
  assert.equal(runtime.figmaMaxScreenCandidates, 1);
  assert.equal(runtime.figmaScreenElementBudget, 10_000);
});
