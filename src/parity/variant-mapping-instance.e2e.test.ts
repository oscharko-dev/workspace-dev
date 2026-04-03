import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import type { ScreenElementIR, VariantMuiProps } from "./types.js";

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

const collectAllElements = (children: ScreenElementIR[]): ScreenElementIR[] => {
  const elements: ScreenElementIR[] = [];
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    elements.push(current);
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return elements;
};

test("E2E: variant mapping properties contain only valid MUI values", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const validVariants = new Set(["contained", "outlined", "text"]);
  const validSizes = new Set(["small", "medium", "large"]);
  const validColors = new Set(["primary", "secondary", "error", "info", "success", "warning", "inherit"]);

  for (const screen of ir.screens) {
    for (const element of collectAllElements(screen.children)) {
      const muiProps = element.variantMapping?.muiProps;
      if (!muiProps) continue;

      if (muiProps.variant) {
        assert.equal(
          validVariants.has(muiProps.variant),
          true,
          `Element ${element.id} has invalid variant: ${muiProps.variant}`
        );
      }
      if (muiProps.size) {
        assert.equal(
          validSizes.has(muiProps.size),
          true,
          `Element ${element.id} has invalid size: ${muiProps.size}`
        );
      }
      if (muiProps.color) {
        assert.equal(
          validColors.has(muiProps.color),
          true,
          `Element ${element.id} has invalid color: ${muiProps.color}`
        );
      }
    }
  }
});

test("E2E: state overrides contain valid style properties", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  for (const screen of ir.screens) {
    for (const element of collectAllElements(screen.children)) {
      const stateOverrides = element.variantMapping?.stateOverrides;
      if (!stateOverrides) continue;

      for (const [state, style] of Object.entries(stateOverrides)) {
        assert.equal(
          ["hover", "active", "disabled"].includes(state),
          true,
          `Element ${element.id} has invalid state override key: ${state}`
        );
        if (style.backgroundColor) {
          assert.equal(typeof style.backgroundColor, "string");
          assert.equal(style.backgroundColor.startsWith("#"), true, `Invalid backgroundColor format: ${style.backgroundColor}`);
        }
        if (style.color) {
          assert.equal(typeof style.color, "string");
          assert.equal(style.color.startsWith("#"), true, `Invalid color format: ${style.color}`);
        }
      }
    }
  }
});

test("E2E: variant mapping is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.screens.length, ir2.screens.length);

  for (let i = 0; i < ir1.screens.length; i++) {
    const elements1 = collectAllElements(ir1.screens[i]!.children);
    const elements2 = collectAllElements(ir2.screens[i]!.children);

    for (let j = 0; j < Math.min(elements1.length, elements2.length); j++) {
      const el1 = elements1[j]!;
      const el2 = elements2[j]!;
      if (el1.id === el2.id && el1.variantMapping) {
        assert.deepStrictEqual(
          el1.variantMapping.muiProps,
          el2.variantMapping?.muiProps,
          `Element ${el1.id} variant muiProps differ between runs`
        );
      }
    }
  }
});
