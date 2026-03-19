import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import type { ScreenElementIR, ScreenIR } from "./types.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
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

const collectButtonElements = (children: ScreenElementIR[]): ScreenElementIR[] => {
  const buttons: ScreenElementIR[] = [];
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.type === "button") {
      buttons.push(current);
    }
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return buttons;
};

test("E2E: IR derivation from real Figma file produces valid button elements", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(typeof ir, "object");
  assert.equal(Array.isArray(ir.screens), true);

  const allButtons: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allButtons.push(...collectButtonElements(screen.children));
  }

  for (const button of allButtons) {
    assert.equal(button.type, "button");
    assert.equal(typeof button.id, "string");

    if (button.variantMapping?.muiProps.variant) {
      const validVariants = ["contained", "outlined", "text"];
      assert.equal(
        validVariants.includes(button.variantMapping.muiProps.variant),
        true,
        `Button ${button.id} has invalid variant: ${button.variantMapping.muiProps.variant}`
      );
    }

    if (button.variantMapping?.muiProps.size) {
      const validSizes = ["small", "medium", "large"];
      assert.equal(
        validSizes.includes(button.variantMapping.muiProps.size),
        true,
        `Button ${button.id} has invalid size: ${button.variantMapping.muiProps.size}`
      );
    }

    if (button.variantMapping?.muiProps.color) {
      const validColors = ["primary", "secondary", "error", "info", "success", "warning", "inherit"];
      assert.equal(
        validColors.includes(button.variantMapping.muiProps.color),
        true,
        `Button ${button.id} has invalid color: ${button.variantMapping.muiProps.color}`
      );
    }
  }
});

test("E2E: button variant recognition is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.screens.length, ir2.screens.length);

  for (let screenIndex = 0; screenIndex < ir1.screens.length; screenIndex++) {
    const buttons1 = collectButtonElements(ir1.screens[screenIndex]!.children);
    const buttons2 = collectButtonElements(ir2.screens[screenIndex]!.children);

    assert.equal(buttons1.length, buttons2.length, `Screen ${screenIndex} has different button counts between runs`);

    for (let btnIndex = 0; btnIndex < buttons1.length; btnIndex++) {
      const btn1 = buttons1[btnIndex]!;
      const btn2 = buttons2[btnIndex]!;
      assert.equal(btn1.id, btn2.id);
      assert.deepStrictEqual(
        btn1.variantMapping?.muiProps,
        btn2.variantMapping?.muiProps,
        `Button ${btn1.id} variant mapping differs between two runs`
      );
    }
  }
});

test("E2E: all screens in real Figma file have valid structure for button analysis", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir.screens.length > 0, true, "Expected at least one screen");

  for (const screen of ir.screens) {
    assert.equal(typeof screen.id, "string");
    assert.equal(typeof screen.name, "string");
    assert.equal(Array.isArray(screen.children), true);
  }
});
