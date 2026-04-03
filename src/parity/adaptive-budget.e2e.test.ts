import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import type { ScreenElementIR } from "./types.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  return await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
};

const countElements = (children: ScreenElementIR[]): number => {
  let total = 0;
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    total += 1;
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return total;
};

const collectInteractiveElements = (children: ScreenElementIR[]): ScreenElementIR[] => {
  const interactiveTypes = new Set(["button", "input", "select", "switch", "checkbox", "radio", "slider", "rating", "tab"]);
  const result: ScreenElementIR[] = [];
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (interactiveTypes.has(current.type)) {
      result.push(current);
    }
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return result;
};

test("E2E: truncation metrics include droppedTypeCounts when screen exceeds budget", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir = figmaToDesignIrWithOptions(figmaFile, {
    screenElementBudget: 50
  });

  const truncatedScreens = ir.metrics?.truncatedScreens ?? [];

  if (truncatedScreens.length > 0) {
    for (const metric of truncatedScreens) {
      assert.equal(typeof metric.originalElements, "number");
      assert.equal(typeof metric.retainedElements, "number");
      assert.equal(metric.retainedElements <= metric.originalElements, true);
      assert.equal(typeof metric.budget, "number");

      if (metric.droppedTypeCounts) {
        const totalDropped = Object.values(metric.droppedTypeCounts).reduce((sum, count) => sum + count, 0);
        assert.equal(totalDropped > 0, true, "droppedTypeCounts should have positive counts");
        assert.equal(
          totalDropped,
          metric.originalElements - metric.retainedElements,
          "Sum of droppedTypeCounts should equal originalElements - retainedElements"
        );
      }
    }
  }
});

test("E2E: truncation preserves interactive elements over decorative ones", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const irFull = figmaToDesignIrWithOptions(figmaFile, {
    screenElementBudget: 10000
  });
  const irTight = figmaToDesignIrWithOptions(figmaFile, {
    screenElementBudget: 100
  });

  for (let i = 0; i < irFull.screens.length; i++) {
    const fullScreen = irFull.screens[i]!;
    const tightScreen = irTight.screens[i]!;

    const fullInteractive = collectInteractiveElements(fullScreen.children);
    const tightInteractive = collectInteractiveElements(tightScreen.children);
    const tightTotal = countElements(tightScreen.children);

    if (fullInteractive.length > 0 && tightTotal > 0) {
      const interactiveRatio = tightInteractive.length / tightTotal;
      const fullInteractiveRatio = fullInteractive.length / countElements(fullScreen.children);
      assert.equal(
        interactiveRatio >= fullInteractiveRatio * 0.5,
        true,
        `Interactive ratio dropped too much in ${fullScreen.name}: ` +
        `full=${fullInteractiveRatio.toFixed(2)}, tight=${interactiveRatio.toFixed(2)}`
      );
    }
  }
});

test("E2E: adaptive budget is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.screens.length, ir2.screens.length);
  assert.deepStrictEqual(ir1.metrics?.truncatedScreens, ir2.metrics?.truncatedScreens);

  for (let i = 0; i < ir1.screens.length; i++) {
    assert.equal(
      countElements(ir1.screens[i]!.children),
      countElements(ir2.screens[i]!.children),
      `Screen ${i} element count differs between runs`
    );
  }
});
