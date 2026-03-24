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
                        letterSpacing: -0.5,
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
                  opacity: 0.42,
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
                  effects: [
                    {
                      type: "DROP_SHADOW",
                      visible: true,
                      color: { r: 0, g: 0, b: 0, a: 0.2 },
                      radius: 8,
                      offset: { x: 0, y: 4, hiddenOffset: true },
                      blendMode: "NORMAL"
                    },
                    {
                      type: "INNER_SHADOW",
                      color: { r: 0.1, g: 0.2, b: 0.3, a: 0.35 },
                      radius: 6,
                      offset: { x: 2, y: 3 },
                      showShadowBehindNode: true
                    },
                    {
                      type: "DROP_SHADOW",
                      visible: false,
                      color: { r: 0, g: 0, b: 0, a: 0.5 },
                      radius: 12,
                      offset: { x: 0, y: 8 }
                    },
                    {
                      type: "BACKGROUND_BLUR",
                      radius: 9
                    }
                  ],
                  absoluteBoundingBox: { x: 1, y: 2, width: 280, height: 160, extraBoxKey: 123 },
                  children: []
                },
                {
                  id: "variant-set-1",
                  type: "COMPONENT_SET",
                  name: "Button Variants",
                  opacity: 1,
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
  const keptTextNode = findNodeById(result.cleanedFile.document, "keep-1");
  assert.ok(keptTextNode);
  assert.deepEqual(keptTextNode?.style, {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "Sparkasse Sans",
    lineHeightPx: 22,
    letterSpacing: -0.5,
    textAlignHorizontal: "LEFT"
  });

  const regularNode = findNodeById(result.cleanedFile.document, "regular-1");
  assert.ok(regularNode);
  assert.equal(regularNode?.opacity, 0.42);
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
  assert.deepEqual(regularNode?.effects, [
    {
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      radius: 8,
      offset: { x: 0, y: 4 }
    },
    {
      type: "INNER_SHADOW",
      color: { r: 0.1, g: 0.2, b: 0.3, a: 0.35 },
      radius: 6,
      offset: { x: 2, y: 3 }
    }
  ]);

  const variantNode = findNodeById(result.cleanedFile.document, "variant-set-1");
  assert.ok(variantNode);
  assert.equal("opacity" in (variantNode ?? {}), false);
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

test("cleanFigmaForCodegen preserves style catalogs, node style ids, and bound variables", () => {
  const input = {
    name: "Styled Demo",
    styles: {
      "S:1": {
        name: "Heading/H1",
        styleType: "TEXT",
        description: "primary heading",
        ignored: true
      }
    },
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "frame-1",
              type: "FRAME",
              name: "Screen",
              children: [
                {
                  id: "text-1",
                  type: "TEXT",
                  name: "Headline",
                  characters: "Hello",
                  textStyleId: "S:1",
                  fillStyleId: "S:fill",
                  strokeStyleId: "S:stroke",
                  effectStyleId: "S:effect",
                  styles: {
                    text: "S:1",
                    fill: "S:fill"
                  },
                  boundVariables: {
                    fills: [{ id: "VariableID:1" }]
                  },
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
  assert.deepEqual(result.cleanedFile.styles, {
    "S:1": {
      name: "Heading/H1",
      styleType: "TEXT",
      description: "primary heading"
    }
  });
  const textNode = findNodeById(result.cleanedFile.document, "text-1");
  assert.deepEqual(textNode?.styles, {
    text: "S:1",
    fill: "S:fill"
  });
  assert.equal(textNode?.textStyleId, "S:1");
  assert.equal(textNode?.fillStyleId, "S:fill");
  assert.equal(textNode?.strokeStyleId, "S:stroke");
  assert.equal(textNode?.effectStyleId, "S:effect");
  assert.deepEqual(textNode?.boundVariables, {
    fills: [{ id: "VariableID:1" }]
  });
});

test("cleanFigmaForCodegen keeps finite letterSpacing style values and drops invalid ones", () => {
  const input = {
    name: "LetterSpacing style",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-ls",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: [
                {
                  id: "text-zero",
                  type: "TEXT",
                  characters: "Zero",
                  style: {
                    fontSize: 16,
                    letterSpacing: 0
                  }
                },
                {
                  id: "text-negative",
                  type: "TEXT",
                  characters: "Negative",
                  style: {
                    fontSize: 16,
                    letterSpacing: -1.25
                  }
                },
                {
                  id: "text-invalid-nan",
                  type: "TEXT",
                  characters: "NaN",
                  style: {
                    fontSize: 16,
                    letterSpacing: Number.NaN
                  }
                },
                {
                  id: "text-invalid-infinity",
                  type: "TEXT",
                  characters: "Infinity",
                  style: {
                    fontSize: 16,
                    letterSpacing: Number.POSITIVE_INFINITY
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const result = cleanFigmaForCodegen({ file: input });

  assert.deepEqual(findNodeById(result.cleanedFile.document, "text-zero")?.style, {
    fontSize: 16,
    letterSpacing: 0
  });
  assert.deepEqual(findNodeById(result.cleanedFile.document, "text-negative")?.style, {
    fontSize: 16,
    letterSpacing: -1.25
  });
  assert.deepEqual(findNodeById(result.cleanedFile.document, "text-invalid-nan")?.style, {
    fontSize: 16
  });
  assert.deepEqual(findNodeById(result.cleanedFile.document, "text-invalid-infinity")?.style, {
    fontSize: 16
  });
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

test("cleanFigmaForCodegen keeps exact removal counters for dropped branch categories", () => {
  const input = {
    name: "Removal counters",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-metrics",
              type: "FRAME",
              name: "Screen",
              children: [
                {
                  id: "hidden-root",
                  type: "FRAME",
                  visible: false,
                  children: [{ id: "hidden-child", type: "TEXT", characters: "hidden" }]
                },
                {
                  type: "FRAME",
                  children: [{ id: "invalid-child", type: "TEXT", characters: "invalid child" }]
                },
                {
                  id: "helper-empty",
                  type: "FRAME",
                  name: "_Item",
                  absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 24 },
                  children: [{ id: "helper-child", type: "TEXT", characters: "helper child" }]
                },
                {
                  id: "instance-1",
                  type: "INSTANCE",
                  children: [
                    {
                      id: "placeholder-1",
                      type: "TEXT",
                      characters: "Swap Component",
                      children: [{ id: "placeholder-child", type: "TEXT", characters: "placeholder child" }]
                    },
                    { id: "kept-1", type: "TEXT", characters: "Kept text" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const result = cleanFigmaForCodegen({ file: input });

  assert.equal(result.report.inputNodeCount, 13);
  assert.equal(result.report.outputNodeCount, 5);
  assert.equal(result.report.removedHiddenNodes, 2);
  assert.equal(result.report.removedInvalidNodes, 2);
  assert.equal(result.report.removedHelperNodes, 2);
  assert.equal(result.report.removedPlaceholderNodes, 1);
  assert.equal(result.report.outputNodeCount < result.report.inputNodeCount, true);
  assert.equal(findNodeById(result.cleanedFile.document, "kept-1")?.id, "kept-1");
  assert.equal(findNodeById(result.cleanedFile.document, "placeholder-child"), undefined);
});

test("cleanFigmaForCodegen handles deeply nested trees without stack overflow", () => {
  const depth = 5_000;
  const chainRoot: Record<string, unknown> = {
    id: "chain-0",
    type: "FRAME",
    children: []
  };
  let cursor = chainRoot;
  for (let index = 1; index <= depth; index += 1) {
    const next: Record<string, unknown> = {
      id: `chain-${index}`,
      type: "FRAME",
      children: []
    };
    cursor.children = [next];
    cursor = next;
  }

  const input = {
    name: "Deep tree",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [chainRoot]
        }
      ]
    }
  };

  const result = cleanFigmaForCodegen({ file: input });
  const expectedNodeCount = depth + 3;

  assert.equal(result.report.inputNodeCount, expectedNodeCount);
  assert.equal(result.report.outputNodeCount, expectedNodeCount);
  assert.equal(result.report.removedHiddenNodes, 0);
  assert.equal(result.report.removedInvalidNodes, 0);
  assert.equal(result.report.removedHelperNodes, 0);
  assert.equal(result.report.removedPlaceholderNodes, 0);
  let lastChainNode: Record<string, unknown> | undefined;
  let current: unknown = result.cleanedFile.document;
  while (current && typeof current === "object" && !Array.isArray(current)) {
    const record = current as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.startsWith("chain-")) {
      lastChainNode = record;
    }
    if (!Array.isArray(record.children) || record.children.length === 0) {
      break;
    }
    current = record.children[0];
  }
  assert.equal(lastChainNode?.id, `chain-${depth}`);
});

test("cleanFigmaForCodegen keeps only finite node opacity values in [0,1)", () => {
  const input = {
    name: "Opacity Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-opacity",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: [
                {
                  id: "opacity-valid-half",
                  type: "FRAME",
                  opacity: 0.5,
                  children: []
                },
                {
                  id: "opacity-valid-zero",
                  type: "FRAME",
                  opacity: 0,
                  children: []
                },
                {
                  id: "opacity-invalid-one",
                  type: "FRAME",
                  opacity: 1,
                  children: []
                },
                {
                  id: "opacity-invalid-negative",
                  type: "FRAME",
                  opacity: -0.1,
                  children: []
                },
                {
                  id: "opacity-invalid-over",
                  type: "FRAME",
                  opacity: 1.2,
                  children: []
                },
                {
                  id: "opacity-invalid-string",
                  type: "FRAME",
                  opacity: "0.3",
                  children: []
                },
                {
                  id: "opacity-invalid-nan",
                  type: "FRAME",
                  opacity: Number.NaN,
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

  assert.equal(findNodeById(result.cleanedFile.document, "opacity-valid-half")?.opacity, 0.5);
  assert.equal(findNodeById(result.cleanedFile.document, "opacity-valid-zero")?.opacity, 0);
  assert.equal("opacity" in (findNodeById(result.cleanedFile.document, "opacity-invalid-one") ?? {}), false);
  assert.equal("opacity" in (findNodeById(result.cleanedFile.document, "opacity-invalid-negative") ?? {}), false);
  assert.equal("opacity" in (findNodeById(result.cleanedFile.document, "opacity-invalid-over") ?? {}), false);
  assert.equal("opacity" in (findNodeById(result.cleanedFile.document, "opacity-invalid-string") ?? {}), false);
  assert.equal("opacity" in (findNodeById(result.cleanedFile.document, "opacity-invalid-nan") ?? {}), false);
});

test("cleanFigmaForCodegen preserves visible IMAGE paints for downstream image classification", () => {
  const input = {
    name: "Image Paint Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-image-paint",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "image-node",
                  type: "RECTANGLE",
                  name: "Hero",
                  fills: [
                    { type: "IMAGE", opacity: 0.8, scaleMode: "FILL" },
                    { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0, a: 1 } }
                  ],
                  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
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
  const imageNode = findNodeById(result.cleanedFile.document, "image-node");
  assert.ok(imageNode);
  assert.deepEqual(imageNode?.fills, [{ type: "IMAGE", opacity: 0.8 }]);
});

test("cleanFigmaForCodegen preserves deterministic interaction payload for prototype navigation mapping", () => {
  const input = {
    name: "Prototype Navigation Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-nav",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "nav-source",
                  type: "FRAME",
                  name: "CTA",
                  absoluteBoundingBox: { x: 24, y: 24, width: 160, height: 48 },
                  interactions: [
                    {
                      trigger: { type: "on_click", unexpected: true },
                      actions: [
                        {
                          type: "node",
                          destinationId: "screen-target",
                          navigation: "navigate",
                          extra: "drop-me"
                        }
                      ],
                      anotherField: "drop-me"
                    },
                    {
                      trigger: { type: "ON_CLICK" },
                      action: {
                        type: "NODE",
                        transitionNodeID: "legacy-target",
                        navigation: "replace",
                        hidden: "drop-me"
                      }
                    }
                  ],
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
  const navSourceNode = findNodeById(result.cleanedFile.document, "nav-source");
  assert.ok(navSourceNode);
  assert.deepEqual(navSourceNode?.interactions, [
    {
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "NODE", destinationId: "screen-target", navigation: "NAVIGATE" }]
    },
    {
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "NODE", navigation: "REPLACE", transitionNodeID: "legacy-target" }]
    }
  ]);
});
