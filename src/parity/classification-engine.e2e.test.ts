// ---------------------------------------------------------------------------
// classification-engine.e2e.test.ts — E2E test for data-driven classification
// Validates the declarative rule engine against a real Figma board (#300)
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchFigmaFile } from "../job-engine/figma-source.js";
import type { ScreenElementIR } from "./types.js";
import {
  NODE_CLASSIFICATION_RULES,
  SEMANTIC_CLASSIFICATION_RULES
} from "./ir-classification.js";

const REFERENCE_BOARD_KEY = "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? REFERENCE_BOARD_KEY;
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

const skipBoardFamiliesReason =
  skipReason ?? (FIGMA_FILE_KEY !== REFERENCE_BOARD_KEY
    ? `Board-specific family assertions only apply to reference board ${REFERENCE_BOARD_KEY}`
    : undefined);

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const result = await fetchFigmaFile({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN,
    timeoutMs: 45_000,
    maxRetries: 5,
    fetchImpl: fetch,
    onLog: () => {},
    bootstrapDepth: 5,
    nodeBatchSize: 1,
    nodeFetchConcurrency: 1,
    adaptiveBatchingEnabled: false,
    maxScreenCandidates: 1,
    cacheEnabled: true,
    cacheTtlMs: 15 * 60_000,
    cacheDir: os.tmpdir()
  });
  cachedFigmaFile = result.file;
  return cachedFigmaFile;
};

const collectAllElements = (children: ScreenElementIR[]): ScreenElementIR[] => {
  const elements: ScreenElementIR[] = [];
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    elements.push(current);
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return elements;
};

const VALID_ELEMENT_TYPES = new Set<string>([
  "text", "container", "button", "alert", "input", "image", "grid", "stack",
  "accordion",
  "paper", "card", "chip", "switch", "checkbox", "radio", "select",
  "slider", "rating", "list", "table", "tooltip", "appbar", "drawer",
  "breadcrumbs", "tab", "dialog", "snackbar", "stepper", "progress",
  "skeleton", "avatar", "badge", "divider", "navigation"
]);

test("E2E: classification rules are structurally valid", { skip: skipReason }, () => {
  // Verify priorities are unique and sorted
  const nodePriorities = NODE_CLASSIFICATION_RULES.map((r) => r.priority);
  assert.equal(new Set(nodePriorities).size, nodePriorities.length, "Node rule priorities must be unique");

  const semanticPriorities = SEMANTIC_CLASSIFICATION_RULES.map((r) => r.priority);
  assert.equal(new Set(semanticPriorities).size, semanticPriorities.length, "Semantic rule priorities must be unique");

  // Verify all rule types are valid element types
  for (const rule of NODE_CLASSIFICATION_RULES) {
    assert.ok(VALID_ELEMENT_TYPES.has(rule.type), `Invalid node rule type: ${rule.type}`);
  }
  for (const rule of SEMANTIC_CLASSIFICATION_RULES) {
    assert.ok(VALID_ELEMENT_TYPES.has(rule.type), `Invalid semantic rule type: ${rule.type}`);
  }
});

test("E2E: IR derivation from real Figma board classifies all elements to valid types", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(typeof ir, "object");
  assert.equal(Array.isArray(ir.screens), true);
  assert.ok(ir.screens.length > 0, "Must derive at least one screen");

  const allElements: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allElements.push(...collectAllElements(screen.children));
  }

  assert.ok(allElements.length > 0, "Must classify at least one element");

  // Every element must have a valid type
  for (const element of allElements) {
    assert.ok(
      VALID_ELEMENT_TYPES.has(element.type),
      `Element "${element.name}" (${element.id}) has invalid type: ${element.type}`
    );
  }
});

test("E2E: real Figma board produces diverse element classifications", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const allElements: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allElements.push(...collectAllElements(screen.children));
  }

  const typeCounts = new Map<string, number>();
  for (const element of allElements) {
    typeCounts.set(element.type, (typeCounts.get(element.type) ?? 0) + 1);
  }

  // The real Figma board should produce at least these common types
  const expectedMinimumTypes = ["text", "container"];
  for (const expectedType of expectedMinimumTypes) {
    assert.ok(
      typeCounts.has(expectedType),
      `Expected at least one element of type "${expectedType}" but found none. ` +
        `Types found: ${[...typeCounts.keys()].join(", ")}`
    );
  }

  // Should have reasonable diversity (at least 5 different types for a real board)
  assert.ok(
    typeCounts.size >= 5,
    `Expected at least 5 distinct element types but found ${typeCounts.size}: ${[...typeCounts.keys()].join(", ")}`
  );
});

test("E2E: real Figma board exposes verified board families through IR classification and semantics", { skip: skipBoardFamiliesReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const allElements: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allElements.push(...collectAllElements(screen.children));
  }

  assert.equal(
    allElements.some((element) => element.type === "accordion" && element.semanticType === "Accordion"),
    true,
    "Expected at least one accordion element with board semantic metadata."
  );
  assert.equal(
    allElements.some((element) => element.type === "input" && element.semanticType === "DatePicker"),
    true,
    "Expected at least one DatePicker element classified as input with board semantic metadata."
  );
  assert.equal(
    allElements.some((element) => element.type === "text" && element.semanticType === "Typography"),
    true,
    "Expected at least one Typography family element classified as text."
  );
  assert.equal(
    allElements.some((element) => element.type === "container" && element.semanticType === "Icon"),
    true,
    "Expected at least one Icon family element to remain a container with board semantic metadata."
  );
});

test("E2E: any real Figma board propagates board semantic metadata for recognized families", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const allElements: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allElements.push(...collectAllElements(screen.children));
  }

  const elementsWithSemanticSource = allElements.filter((el) => el.semanticSource === "board");
  assert.ok(
    elementsWithSemanticSource.length > 0,
    "Expected at least one element with board semantic source metadata."
  );

  for (const el of elementsWithSemanticSource) {
    assert.ok(
      typeof el.semanticType === "string" && el.semanticType.length > 0,
      `Element "${el.name}" (${el.id}) has board semantic source but empty/missing semanticType.`
    );
  }
});

test("E2E: classification produces stable results on repeated derivation", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.screens.length, ir2.screens.length, "Screen count must be stable");

  for (let i = 0; i < ir1.screens.length; i++) {
    const screen1 = ir1.screens[i];
    const screen2 = ir2.screens[i];
    if (!screen1 || !screen2) continue;

    const elements1 = collectAllElements(screen1.children);
    const elements2 = collectAllElements(screen2.children);
    assert.equal(
      elements1.length,
      elements2.length,
      `Element count mismatch in screen "${screen1.name}"`
    );

    for (let j = 0; j < elements1.length; j++) {
      const el1 = elements1[j];
      const el2 = elements2[j];
      if (!el1 || !el2) continue;
      assert.equal(
        el1.type,
        el2.type,
        `Classification mismatch for element "${el1.name}" (${el1.id}): ${el1.type} vs ${el2.type}`
      );
    }
  }
});
