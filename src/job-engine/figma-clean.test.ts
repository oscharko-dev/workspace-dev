import assert from "node:assert/strict";
import test from "node:test";
import { cleanFigmaForCodegen } from "./figma-clean.js";

const findNodeById = (node: unknown, id: string): Record<string, unknown> | undefined => {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (record.id === id) {
    return record;
  }
  if (!Array.isArray(record.children)) {
    return undefined;
  }
  for (const child of record.children) {
    const found = findNodeById(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
};

test("cleanFigmaForCodegen removes hidden/helper/placeholder nodes and strips non-essential properties", () => {
  const input = {
    name: "Demo",
    schemaVersion: 99,
    components: { "1:1": { key: "ignored" } },
    document: {
      id: "0:0",
      type: "DOCUMENT",
      extraDocumentField: "drop-me",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          randomCanvasField: true,
          children: [
            {
              id: "screen-1",
              type: "FRAME",
              name: "Main Screen",
              pluginData: { a: 1 },
              children: [
                {
                  id: "hidden-1",
                  type: "FRAME",
                  visible: false,
                  children: [
                    {
                      id: "hidden-1-1",
                      type: "TEXT",
                      characters: "Should disappear"
                    }
                  ]
                },
                {
                  id: "instance-1",
                  type: "INSTANCE",
                  children: [
                    {
                      id: "placeholder-1",
                      type: "TEXT",
                      characters: "Swap Component"
                    },
                    {
                      id: "keep-1",
                      type: "TEXT",
                      characters: "Customer Name",
                      style: {
                        fontSize: 16,
                        fontWeight: 700,
                        fontFamily: "Sparkasse Sans",
                        lineHeightPx: 22,
                        textAlignHorizontal: "LEFT",
                        ignoredStyleProp: "drop"
                      }
                    }
                  ]
                },
                {
                  id: "helper-1",
                  type: "FRAME",
                  name: "_Item",
                  absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 },
                  children: [
                    {
                      id: "helper-1-1",
                      type: "TEXT",
                      characters: "drop me"
                    }
                  ]
                },
                {
                  id: "regular-1",
                  type: "FRAME",
                  name: "Card",
                  pluginData: { x: 1 },
                  fills: [
                    {
                      type: "SOLID",
                      color: { r: 0.8, g: 0.2, b: 0.2, a: 1 },
                      opacity: 0.9,
                      hiddenPaintKey: "drop"
                    },
                    {
                      type: "GRADIENT_LINEAR",
                      opacity: 0.75,
                      gradientStops: [
                        {
                          position: 0,
                          color: { r: 0.85, g: 0.02, b: 0.1, a: 1 },
                          ignored: "drop"
                        },
                        {
                          position: 1,
                          color: { r: 0.98, g: 0.64, b: 0.08, a: 1 }
                        }
                      ],
                      gradientHandlePositions: [
                        { x: 0, y: 0, ignored: true },
                        { x: 1, y: 0 }
                      ],
                      hiddenGradientField: "drop"
                    }
                  ],
                  absoluteBoundingBox: { x: 1, y: 2, width: 280, height: 160, extraBoxKey: 123 },
                  children: []
                },
                {
                  id: "variant-set-1",
                  type: "COMPONENT_SET",
                  name: "Button Variants",
                  componentProperties: {
                    State: {
                      type: "VARIANT",
                      value: "Disabled",
                      boundVariables: {}
                    },
                    Size: {
                      type: "VARIANT",
                      value: "Large"
                    },
                    Swap: {
                      type: "INSTANCE_SWAP",
                      value: "1:1"
                    }
                  },
                  componentPropertyDefinitions: {
                    State: {
                      type: "VARIANT",
                      defaultValue: "Enabled",
                      variantOptions: ["Enabled", "Disabled", "", 2],
                      preferredValues: ["drop"]
                    },
                    Style: {
                      type: "TEXT",
                      defaultValue: "Ignored"
                    }
                  },
                  absoluteBoundingBox: { x: 20, y: 220, width: 280, height: 56 },
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const result = cleanFigmaForCodegen({ file: input });
  const serialized = JSON.stringify(result.cleanedFile);

  assert.equal(serialized.includes("hidden-1"), false);
  assert.equal(serialized.includes("placeholder-1"), false);
  assert.equal(serialized.includes("helper-1"), false);
  assert.equal(serialized.includes("keep-1"), true);
  assert.equal(serialized.includes("regular-1"), true);
  assert.equal(serialized.includes("pluginData"), false);
  assert.equal(serialized.includes("extraDocumentField"), false);
  assert.equal(serialized.includes("randomCanvasField"), false);

  const regularNode = findNodeById(result.cleanedFile.document, "regular-1");
  assert.ok(regularNode);
  assert.equal(Array.isArray(regularNode?.fills), true);
  assert.equal((regularNode?.fills as unknown[]).length, 2);
  assert.deepEqual(regularNode?.fills, [
    {
      type: "SOLID",
      color: { r: 0.8, g: 0.2, b: 0.2, a: 1 },
      opacity: 0.9
    },
    {
      type: "GRADIENT_LINEAR",
      opacity: 0.75,
      gradientStops: [
        {
          position: 0,
          color: { r: 0.85, g: 0.02, b: 0.1, a: 1 }
        },
        {
          position: 1,
          color: { r: 0.98, g: 0.64, b: 0.08, a: 1 }
        }
      ],
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ]
    }
  ]);

  const variantNode = findNodeById(result.cleanedFile.document, "variant-set-1");
  assert.ok(variantNode);
  assert.deepEqual(variantNode?.componentProperties, {
    State: {
      type: "VARIANT",
      value: "Disabled"
    },
    Size: {
      type: "VARIANT",
      value: "Large"
    }
  });
  assert.deepEqual(variantNode?.componentPropertyDefinitions, {
    State: {
      type: "VARIANT",
      defaultValue: "Enabled",
      variantOptions: ["Enabled", "Disabled"]
    }
  });

  assert.equal(result.report.screenCandidateCount, 1);
  assert.equal(result.report.removedHiddenNodes >= 2, true);
  assert.equal(result.report.removedPlaceholderNodes >= 1, true);
  assert.equal(result.report.removedHelperNodes >= 2, true);
  assert.equal(result.report.removedPropertyCount > 0, true);
  assert.equal(result.report.outputNodeCount < result.report.inputNodeCount, true);
});

test("cleanFigmaForCodegen reports zero screen candidates when nothing screen-like remains", () => {
  const input = {
    name: "No screens",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "hidden-screen",
              type: "FRAME",
              visible: false,
              children: []
            }
          ]
        }
      ]
    }
  };

  const result = cleanFigmaForCodegen({ file: input });
  assert.equal(result.report.screenCandidateCount, 0);
  assert.equal(result.report.removedHiddenNodes >= 1, true);
});
