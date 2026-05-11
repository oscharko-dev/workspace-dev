import assert from "node:assert/strict";
import test from "node:test";
import type { DesignIR } from "../parity/types-ir.js";
import { pruneDesignIrToSelectedNodeIds } from "./scoped-design-ir.js";

const createIr = (): DesignIR =>
  ({
    sourceName: "test",
    screens: [
      {
        id: "screen-1",
        name: "Screen 1",
        route: "/screen-1",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        appShell: {
          type: "stack",
          contentNodeIds: ["section-1", "card-1", "card-2"],
        },
        children: [
          {
            id: "section-1",
            name: "Section",
            type: "container",
            children: [
              {
                id: "card-1",
                name: "Primary Card",
                type: "container",
                children: [],
              },
              {
                id: "card-2",
                name: "Secondary Card",
                type: "container",
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: "screen-2",
        name: "Screen 2",
        route: "/screen-2",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [],
      },
    ],
    appShells: [
      {
        id: "shell-1",
        type: "stack",
        screenIds: ["screen-1"],
      },
      {
        id: "shell-2",
        type: "stack",
        screenIds: ["screen-2"],
      },
    ],
    screenVariantFamilies: [
      {
        familyId: "family-1",
        canonicalScreenId: "screen-1",
        memberScreenIds: ["screen-1", "screen-2"],
        axes: [],
        scenarios: [],
      },
    ],
    tokens: {
      palette: {
        primary: "#1976d2",
        secondary: "#9c27b0",
        background: "#ffffff",
        text: "#111111",
        success: "#2e7d32",
        warning: "#ed6c02",
        error: "#d32f2f",
        info: "#0288d1",
        divider: "#e0e0e0",
        action: {
          active: "#1976d2",
          hover: "#1976d21a",
          selected: "#1976d214",
          disabled: "#00000042",
          disabledBackground: "#0000001f",
          focus: "#1976d21f",
        },
      },
      borderRadius: 4,
      spacingBase: 8,
      fontFamily: "Roboto",
      headingSize: 24,
      bodySize: 14,
      typography: {},
    },
  }) as DesignIR;

test("pruneDesignIrToSelectedNodeIds keeps ancestors and removes unrelated branches", () => {
  const pruned = pruneDesignIrToSelectedNodeIds({
    ir: createIr(),
    selectedNodeIds: ["card-2"],
  });

  assert.deepEqual(
    pruned.screens.map((screen) => screen.id),
    ["screen-1"],
  );
  assert.deepEqual(
    pruned.screens[0]?.children.map((node) => node.id),
    ["section-1"],
  );
  assert.deepEqual(
    pruned.screens[0]?.children[0]?.children.map((node) => node.id),
    ["card-2"],
  );
  assert.deepEqual(pruned.screens[0]?.appShell?.contentNodeIds, [
    "section-1",
    "card-2",
  ]);
  assert.deepEqual(pruned.appShells?.map((shell) => shell.id), ["shell-1"]);
  assert.deepEqual(
    pruned.screenVariantFamilies?.map((family) => family.familyId),
    ["family-1"],
  );
});

test("pruneDesignIrToSelectedNodeIds returns the original IR when selection is empty", () => {
  const ir = createIr();
  const pruned = pruneDesignIrToSelectedNodeIds({
    ir,
    selectedNodeIds: [],
  });

  assert.equal(pruned, ir);
});
