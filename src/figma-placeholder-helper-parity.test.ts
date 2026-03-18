import assert from "node:assert/strict";
import test from "node:test";
import { cleanFigmaForCodegen } from "./job-engine/figma-clean.js";
import { figmaToDesignIrWithOptions } from "./parity/ir.js";

const collectRecordIds = (value: unknown): Set<string> => {
  const ids = new Set<string>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      continue;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.id === "string") {
      ids.add(record.id);
    }
    if (Array.isArray(record.children)) {
      stack.push(...record.children);
    }
  }
  return ids;
};

const collectIrIds = (screens: Array<{ id: string; children?: unknown[] }>): Set<string> => {
  const ids = new Set<string>();
  const stack = [...screens];
  while (stack.length > 0) {
    const current = stack.pop() as { id: string; children?: unknown[] } | undefined;
    if (!current) {
      continue;
    }
    ids.add(current.id);
    if (Array.isArray(current.children)) {
      stack.push(...(current.children as Array<{ id: string; children?: unknown[] }>));
    }
  }
  return ids;
};

test("cleaner and IR remove technical placeholders only in instance context", () => {
  const file = {
    name: "Placeholder parity",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-1",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
              children: [
                {
                  id: "instance-1",
                  type: "INSTANCE",
                  name: "Instance Root",
                  absoluteBoundingBox: { x: 20, y: 20, width: 300, height: 120 },
                  children: [
                    {
                      id: "tech-placeholder",
                      type: "TEXT",
                      characters: "  Swap   Component  ",
                      absoluteBoundingBox: { x: 24, y: 30, width: 120, height: 20 }
                    },
                    {
                      id: "instance-keep",
                      type: "TEXT",
                      characters: "Visible Label",
                      absoluteBoundingBox: { x: 24, y: 60, width: 120, height: 20 }
                    }
                  ]
                },
                {
                  id: "plain-1",
                  type: "FRAME",
                  name: "Plain",
                  absoluteBoundingBox: { x: 20, y: 200, width: 300, height: 120 },
                  children: [
                    {
                      id: "plain-placeholder",
                      type: "TEXT",
                      characters: "Swap Component",
                      absoluteBoundingBox: { x: 24, y: 210, width: 120, height: 20 }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const cleaned = cleanFigmaForCodegen({ file });
  const ir = figmaToDesignIrWithOptions(file);

  const cleanedIds = collectRecordIds(cleaned.cleanedFile.document);
  const irIds = collectIrIds(ir.screens[0]?.children as Array<{ id: string; children?: unknown[] }>);

  assert.equal(cleanedIds.has("tech-placeholder"), false);
  assert.equal(irIds.has("tech-placeholder"), false);
  assert.equal(cleanedIds.has("instance-keep"), true);
  assert.equal(irIds.has("instance-keep"), true);
  assert.equal(cleanedIds.has("plain-placeholder"), true);
  assert.equal(irIds.has("plain-placeholder"), true);
});

test("cleaner and IR remove empty helper item nodes but keep non-empty helper variants", () => {
  const file = {
    name: "Helper parity",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-helper",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
              children: [
                {
                  id: "helper-empty",
                  type: "FRAME",
                  name: "_Item",
                  absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 40 },
                  children: [
                    {
                      id: "helper-empty-child",
                      type: "TEXT",
                      characters: "Drop",
                      absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 10 }
                    }
                  ]
                },
                {
                  id: "helper-non-empty",
                  type: "FRAME",
                  name: "item_row",
                  absoluteBoundingBox: { x: 0, y: 80, width: 120, height: 40 },
                  children: []
                },
                {
                  id: "helper-no-bounds",
                  type: "FRAME",
                  name: "_item row",
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const cleaned = cleanFigmaForCodegen({ file });
  const ir = figmaToDesignIrWithOptions(file);

  const cleanedIds = collectRecordIds(cleaned.cleanedFile.document);
  const irIds = collectIrIds(ir.screens[0]?.children as Array<{ id: string; children?: unknown[] }>);

  assert.equal(cleanedIds.has("helper-empty"), false);
  assert.equal(irIds.has("helper-empty"), false);
  assert.equal(cleanedIds.has("helper-empty-child"), false);
  assert.equal(irIds.has("helper-empty-child"), false);

  assert.equal(cleanedIds.has("helper-non-empty"), true);
  assert.equal(irIds.has("helper-non-empty"), true);
  assert.equal(cleanedIds.has("helper-no-bounds"), true);
  assert.equal(irIds.has("helper-no-bounds"), true);
});
