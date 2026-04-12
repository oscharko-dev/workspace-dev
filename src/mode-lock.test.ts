import assert from "node:assert/strict";
import test from "node:test";
import {
  validateModeLock,
  enforceModeLock,
  getWorkspaceDefaults,
} from "./mode-lock.js";

test("mode-lock allows rest + deterministic", () => {
  const result = validateModeLock({
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("mode-lock allows local_json + deterministic", () => {
  const result = validateModeLock({
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("mode-lock allows hybrid + deterministic", () => {
  const result = validateModeLock({
    figmaSourceMode: "hybrid",
    llmCodegenMode: "deterministic",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("mode-lock allows empty/undefined modes (defaults apply)", () => {
  const result = validateModeLock({});
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("mode-lock blocks mcp mode", () => {
  const result = validateModeLock({ figmaSourceMode: "mcp" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!, /mcp.*not available/i);
});

test("mode-lock blocks hybrid codegen mode", () => {
  const result = validateModeLock({ llmCodegenMode: "hybrid" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0]!, /hybrid.*not available/i);
});

test("mode-lock blocks llm_strict codegen mode", () => {
  const result = validateModeLock({ llmCodegenMode: "llm_strict" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0]!, /llm_strict.*not available/i);
});

test("mode-lock reports both violations simultaneously", () => {
  const result = validateModeLock({
    figmaSourceMode: "mcp",
    llmCodegenMode: "llm_strict",
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test("mode-lock blocks unknown figma source mode", () => {
  const result = validateModeLock({ figmaSourceMode: "custom_mode" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0]!, /unknown.*custom_mode/i);
});

test("mode-lock blocks unknown codegen mode", () => {
  const result = validateModeLock({ llmCodegenMode: "gpt4_turbo" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0]!, /unknown.*gpt4_turbo/i);
});

test("enforceModeLock throws for blocked modes", () => {
  assert.throws(
    () => enforceModeLock({ figmaSourceMode: "mcp" }),
    /mode-lock violation/i,
  );
});

test("enforceModeLock includes full support guidance and bullet formatting", () => {
  assert.throws(
    () => enforceModeLock({ figmaSourceMode: "mcp", llmCodegenMode: "hybrid" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Mode-lock violation in workspace-dev:/);
      assert.match(
        error.message,
        /Only 'rest', 'hybrid', 'local_json', and 'figma_paste' are supported/,
      );
      assert.match(error.message, /Only 'deterministic' is supported/);
      assert.match(error.message, /\n  • /);
      return true;
    },
  );
});

test("enforceModeLock does not throw for valid modes", () => {
  assert.doesNotThrow(() =>
    enforceModeLock({
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
    }),
  );
  assert.doesNotThrow(() =>
    enforceModeLock({
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
    }),
  );
  assert.doesNotThrow(() =>
    enforceModeLock({
      figmaSourceMode: "hybrid",
      llmCodegenMode: "deterministic",
    }),
  );
});

test("getWorkspaceDefaults returns enforced values", () => {
  const defaults = getWorkspaceDefaults();
  assert.equal(defaults.figmaSourceMode, "rest");
  assert.equal(defaults.llmCodegenMode, "deterministic");
});

test("mode-lock is case-insensitive", () => {
  const result = validateModeLock({
    figmaSourceMode: "REST",
    llmCodegenMode: "DETERMINISTIC",
  });
  assert.equal(result.valid, true);
});
