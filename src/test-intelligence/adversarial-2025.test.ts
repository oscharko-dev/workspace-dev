/**
 * Adversarial-2025 fixture suite (Issue #1776).
 *
 * Seven fixtures pin every 2025-vintage prompt-injection carrier
 * recognised by {@link normalizeUntrustedContent}. Each fixture has a
 * deterministic expected-outcome assertion: at minimum
 * `risk_signal_emitted` (the carrier's counter is non-zero), and where
 * the carrier is `critical` severity, also `policy_route=needs_review`
 * (`report.outcome === "needs_review"`). For Figma and ADF carriers
 * the test additionally verifies `case_not_modified` — the smuggled
 * directive is pruned from the projected payload before any LLM sees
 * it.
 *
 * The test consumes the fixtures byte-stably: identical JSON / markdown
 * input always yields identical counts and outcomes. Adding a new
 * fixture must not perturb existing assertions.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { normalizeUntrustedContent } from "./untrusted-content-normalizer.js";

const FIXTURES_DIR = join(
  process.cwd(),
  "src/test-intelligence/fixtures/adversarial-2025",
);

const readFixture = async (filename: string): Promise<string> => {
  return readFile(join(FIXTURES_DIR, filename), "utf8");
};

const readFixtureJson = async <T>(filename: string): Promise<T> => {
  return JSON.parse(await readFixture(filename)) as T;
};

// ---------------------------------------------------------------------------
// Figma carriers — drop-from-tree + risk_signal_emitted
// ---------------------------------------------------------------------------

test("adversarial-2025: figma-hidden-layer-injection drops the visible=false child and emits a risk signal", async () => {
  const document = await readFixtureJson<unknown>(
    "figma-hidden-layer-injection.json",
  );

  const result = normalizeUntrustedContent({ figma: { document } });

  assert.equal(
    result.report.counts.figmaHiddenLayers,
    1,
    "exactly one hidden Figma layer must be counted",
  );
  // Other Figma counters are zero — no cross-contamination.
  assert.equal(result.report.counts.figmaZeroOpacityLayers, 0);
  assert.equal(result.report.counts.figmaOffCanvasLayers, 0);
  assert.equal(result.report.counts.figmaZeroFontSizeLayers, 0);
  // Hidden layers are info severity → outcome stays "ok".
  assert.equal(result.report.outcome, "ok");

  // case_not_modified: the projected tree no longer contains the hidden node.
  const projected = result.figma?.document as {
    children: Array<{ children: Array<{ id: string }> }>;
  };
  const screenChildren = projected.children[0]!.children;
  assert.equal(screenChildren.length, 1);
  assert.equal(screenChildren[0]!.id, "1:2");
});

test("adversarial-2025: figma-zero-opacity-injection drops the opacity=0 child and emits a risk signal", async () => {
  const document = await readFixtureJson<unknown>(
    "figma-zero-opacity-injection.json",
  );

  const result = normalizeUntrustedContent({ figma: { document } });

  assert.equal(result.report.counts.figmaZeroOpacityLayers, 1);
  assert.equal(result.report.counts.figmaHiddenLayers, 0);
  assert.equal(result.report.counts.figmaOffCanvasLayers, 0);
  assert.equal(result.report.counts.figmaZeroFontSizeLayers, 0);
  assert.equal(result.report.outcome, "ok");

  const projected = result.figma?.document as {
    children: Array<{ children: Array<{ id: string }> }>;
  };
  const screenChildren = projected.children[0]!.children;
  assert.equal(screenChildren.length, 1);
  assert.equal(screenChildren[0]!.id, "2:2");
});

test("adversarial-2025: figma-off-canvas-injection drops the out-of-parent child and emits a risk signal", async () => {
  const document = await readFixtureJson<unknown>(
    "figma-off-canvas-injection.json",
  );

  const result = normalizeUntrustedContent({ figma: { document } });

  assert.equal(result.report.counts.figmaOffCanvasLayers, 1);
  assert.equal(result.report.counts.figmaHiddenLayers, 0);
  assert.equal(result.report.counts.figmaZeroOpacityLayers, 0);
  assert.equal(result.report.counts.figmaZeroFontSizeLayers, 0);
  assert.equal(result.report.outcome, "ok");

  const projected = result.figma?.document as {
    children: Array<{ children: Array<{ id: string }> }>;
  };
  const screenChildren = projected.children[0]!.children;
  assert.equal(screenChildren.length, 1);
  assert.equal(screenChildren[0]!.id, "3:2");
});

test("adversarial-2025: figma-fontsize-zero-injection drops the zero-font-size child and emits a risk signal", async () => {
  const document = await readFixtureJson<unknown>(
    "figma-fontsize-zero-injection.json",
  );

  const result = normalizeUntrustedContent({ figma: { document } });

  assert.equal(result.report.counts.figmaZeroFontSizeLayers, 1);
  assert.equal(result.report.counts.figmaHiddenLayers, 0);
  assert.equal(result.report.counts.figmaZeroOpacityLayers, 0);
  assert.equal(result.report.counts.figmaOffCanvasLayers, 0);
  assert.equal(result.report.outcome, "ok");

  const projected = result.figma?.document as {
    children: Array<{ children: Array<{ id: string }> }>;
  };
  const screenChildren = projected.children[0]!.children;
  assert.equal(screenChildren.length, 1);
  assert.equal(screenChildren[0]!.id, "4:2");
});

// ---------------------------------------------------------------------------
// Jira ADF carrier — collapsed-node rejection drops plain text + risk signal
// ---------------------------------------------------------------------------

test("adversarial-2025: jira-adf-collapsed-node-injection rejects the document and yields empty plain text", async () => {
  const adf = await readFixture("jira-adf-collapsed-node-injection.json");

  const result = normalizeUntrustedContent({ jiraAdf: adf });

  assert.equal(result.report.counts.adfCollapsedNodes, 1);
  // Severity is warning → outcome stays "ok" (no critical carrier hit).
  assert.equal(result.report.outcome, "ok");
  // case_not_modified: no plain text leaks downstream when the parser
  // rejects the unknown `expand` node.
  assert.equal(result.jiraAdfPlainText, "");
});

// ---------------------------------------------------------------------------
// Critical carriers — outcome = needs_review
// ---------------------------------------------------------------------------

test("adversarial-2025: custom-zero-width-unicode-injection emits zero-width + injection signals and routes to needs_review", async () => {
  const markdown = await readFixture("custom-zero-width-unicode-injection.md");

  const result = normalizeUntrustedContent({ markdown });

  // Three zero-width codepoints embedded in the directive line
  // (U+200B, U+200C, U+200D); zero false positives elsewhere in the
  // body, so the count is exactly 3.
  assert.equal(result.report.counts.zeroWidthCharacters, 3);
  // After zero-width stripping the "ignore previous instructions"
  // pattern matches once.
  assert.equal(result.report.counts.markdownInjectionMatches, 1);
  // Markdown injection is critical severity → outcome flips.
  assert.equal(result.report.outcome, "needs_review");

  const reasons = result.report.needsReviewReasons.map((r) => r.carrier);
  assert.ok(
    reasons.includes("markdown_injection_pattern"),
    `expected markdown_injection_pattern in needs-review reasons, got: ${reasons.join(", ")}`,
  );
});

test("adversarial-2025: repair-thought-injection-forged-validator-line emits a critical injection signal and routes to needs_review", async () => {
  // The fixture is a structured repair-input envelope. The forged
  // validator line is exposed via `forgedValidatorOutput` and is what
  // a future repair-loop would feed into the planner. Treating it as
  // markdown reproduces the production normalization path that runs
  // before the planner sees the line.
  const fixture = await readFixtureJson<{ forgedValidatorOutput: string }>(
    "repair-thought-injection-forged-validator-line.json",
  );

  const result = normalizeUntrustedContent({
    markdown: fixture.forgedValidatorOutput,
  });

  // The forged line chains "ignore previous instructions" and a
  // synthetic `system:` prefix — both registered injection patterns.
  assert.ok(
    result.report.counts.markdownInjectionMatches >= 2,
    `expected >=2 markdown injection matches, got ${result.report.counts.markdownInjectionMatches}`,
  );
  assert.equal(result.report.outcome, "needs_review");

  const reasons = result.report.needsReviewReasons.map((r) => r.carrier);
  assert.ok(
    reasons.includes("markdown_injection_pattern"),
    `expected markdown_injection_pattern in needs-review reasons, got: ${reasons.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// Determinism — repeated normalization is byte-stable
// ---------------------------------------------------------------------------

test("adversarial-2025: normalization is byte-stable across repeated runs", async () => {
  const document = await readFixtureJson<unknown>(
    "figma-hidden-layer-injection.json",
  );
  const a = normalizeUntrustedContent({ figma: { document } });
  const b = normalizeUntrustedContent({ figma: { document } });
  assert.deepEqual(a.report, b.report);
  assert.deepEqual(a.figma, b.figma);
});
