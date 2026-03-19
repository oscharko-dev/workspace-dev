import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPlaceholderNode,
  classifyPlaceholderText,
  extractFirstTextFillColor,
  extractVariantStyleFromNode,
  normalizeVariantKey,
  normalizeVariantValue,
  resolveMuiPropsFromVariantProperties,
  resolvePlaceholderMatcherConfig,
  toComponentSetVariantMapping,
  toMuiSize,
  toMuiVariant,
  toSortedVariantProperties,
  toVariantState
} from "./ir-variants.js";

const toSolidPaint = (hex: string) => {
  const normalized = hex.replace("#", "");
  const toChannel = (index: number): number => Number.parseInt(normalized.slice(index, index + 2), 16) / 255;
  return {
    type: "SOLID",
    color: {
      r: toChannel(0),
      g: toChannel(2),
      b: toChannel(4)
    },
    opacity: 1
  };
};

test("toVariantState parses variant values consistently", () => {
  assert.equal(toVariantState("Hover"), "hover");
  assert.equal(toVariantState("pressed"), "active");
  assert.equal(toVariantState("enabled"), "default");
  assert.equal(toVariantState("REST"), "default");
  assert.equal(toVariantState("Disabled"), "disabled");
  assert.equal(toVariantState("  "), undefined);
});

test("toMuiVariant and toMuiSize map variant-size shorthands consistently", () => {
  assert.equal(toMuiVariant("Outlined"), "outlined");
  assert.equal(toMuiVariant("contained"), "contained");
  assert.equal(toMuiVariant("Text"), "text");
  assert.equal(toMuiSize("Large"), "large");
  assert.equal(toMuiSize("sm"), "small");
  assert.equal(toMuiSize("extra small"), "small");
  assert.equal(toMuiSize("Default"), "medium");
});

test("resolveMuiPropsFromVariantProperties applies disabled state and disabled flag correctly", () => {
  assert.deepEqual(
    resolveMuiPropsFromVariantProperties({
      properties: { variant: "Outlined", size: "Medium", disabled: "false" },
      state: "disabled"
    }),
    { variant: "outlined", size: "medium", disabled: true }
  );
  assert.deepEqual(
    resolveMuiPropsFromVariantProperties({
      properties: { variant: "Text", size: "Sm", disabled: "true" },
      state: undefined
    }),
    { variant: "text", size: "small", disabled: true }
  );
  assert.deepEqual(
    resolveMuiPropsFromVariantProperties({
      properties: { variant: "Unknown" },
      state: undefined
    }),
    {}
  );
});

test("variant key/value normalization and sorting preserve ordering semantics", () => {
  assert.equal(normalizeVariantKey(" Size* "), "size");
  assert.equal(normalizeVariantKey("button-variant"), "variant");
  assert.equal(normalizeVariantKey("color tone"), "color");
  assert.equal(normalizeVariantKey("  "), undefined);
  assert.equal(normalizeVariantValue("  Outlined## "), "Outlined");
  assert.deepEqual(
    toSortedVariantProperties({
      size: "Medium",
      variant: "Contained",
      state: "Enabled"
    }),
    {
      size: "Medium",
      state: "Enabled",
      variant: "Contained"
    }
  );
});

test("placeholder classification uses allowlist/technical/blocklist/regex precedence", () => {
  const matcher = resolvePlaceholderMatcherConfig({
    allowlist: ["Type Here"],
    blocklist: ["Visible Value"]
  });
  assert.equal(
    classifyPlaceholderText({
      text: "  TYPE HERE ",
      matcher
    }),
    "none"
  );
  assert.equal(
    classifyPlaceholderText({
      text: "Swap Component",
      matcher
    }),
    "technical"
  );
  assert.equal(
    classifyPlaceholderText({
      text: "Visible Value",
      matcher
    }),
    "generic"
  );
  assert.equal(
    classifyPlaceholderText({
      text: "Name@example.com",
      matcher
    }),
    "generic"
  );
  assert.equal(
    classifyPlaceholderNode({
      node: { id: "text", type: "TEXT", characters: "Name@example.com" },
      matcher
    }),
    "generic"
  );
  assert.equal(
    classifyPlaceholderNode({
      node: { id: "frame", type: "FRAME" },
      matcher
    }),
    "none"
  );
});

test("toComponentSetVariantMapping chooses deterministic default variant from component property defaults", () => {
  const mapping = toComponentSetVariantMapping({
    id: "component-set",
    type: "COMPONENT_SET",
    componentPropertyDefinitions: {
      State: {
        type: "VARIANT",
        defaultValue: "Enabled"
      },
      Variant: {
        type: "VARIANT",
        defaultValue: "Contained"
      }
    },
    children: [
      {
        id: "variant-hover",
        type: "COMPONENT",
        name: "State=Hover, Size=Medium, Variant=Contained",
        componentProperties: {
          State: { type: "VARIANT", value: "Hover" },
          Size: { type: "VARIANT", value: "Medium" },
          Variant: { type: "VARIANT", value: "Contained" }
        },
        fills: [toSolidPaint("#2f6fed")],
        children: []
      },
      {
        id: "variant-enabled",
        type: "COMPONENT",
        name: "State=Enabled, Size=Medium, Variant=Contained",
        componentProperties: {
          State: { type: "VARIANT", value: "Enabled" },
          Size: { type: "VARIANT", value: "Medium" },
          Variant: { type: "VARIANT", value: "Contained" }
        },
        fills: [toSolidPaint("#0d47a1")],
        children: []
      },
      {
        id: "variant-active",
        type: "COMPONENT",
        name: "State=Pressed, Size=Medium, Variant=Contained",
        componentProperties: {
          State: { type: "VARIANT", value: "Pressed" },
          Size: { type: "VARIANT", value: "Medium" },
          Variant: { type: "VARIANT", value: "Contained" }
        },
        fills: [toSolidPaint("#001f4d")],
        children: []
      }
    ]
  });

  assert.ok(mapping);
  assert.equal(mapping.defaultVariantNodeId, "variant-enabled");
  assert.equal(mapping.state, "default");
  assert.deepEqual(mapping?.properties, {
    size: "Medium",
    variant: "Contained",
    state: "Enabled"
  });
  assert.deepEqual(mapping?.muiProps, {
    variant: "contained",
    size: "medium"
  });
  assert.equal(mapping?.states?.length, 3);
  assert.equal(mapping?.states?.[0]?.nodeId, "variant-hover");
  assert.equal(mapping?.states?.[0]?.isDefault, false);
  assert.equal(mapping?.states?.[1]?.nodeId, "variant-enabled");
  assert.equal(mapping?.states?.[1]?.isDefault, true);
  assert.equal(mapping?.stateOverrides?.hover?.backgroundColor, "#2f6fed");
  assert.equal(mapping?.stateOverrides?.active?.backgroundColor, "#001f4d");
});

test("toComponentSetVariantMapping returns undefined when node has no variant signals", () => {
  assert.equal(
    toComponentSetVariantMapping({
      id: "plain-set",
      type: "COMPONENT_SET",
      children: [
        {
          id: "plain-child",
          type: "FRAME",
          name: "Plain",
          fills: [toSolidPaint("#ffffff")],
          children: []
        }
      ]
    }),
    undefined
  );
});

test("extractVariantStyleFromNode and extractFirstTextFillColor recurse into children for text color", () => {
  const variantStyle = extractVariantStyleFromNode({
    id: "parent",
    type: "FRAME",
    fills: [toSolidPaint("#ececec")],
    strokes: [toSolidPaint("#111111")],
    children: [
      {
        id: "label",
        type: "TEXT",
        fills: [toSolidPaint("#222222")],
        children: []
      }
    ]
  });

  assert.equal(variantStyle.backgroundColor, "#ececec");
  assert.equal(variantStyle.borderColor, "#111111");
  assert.equal(extractFirstTextFillColor({ id: "label", type: "TEXT", fills: [toSolidPaint("#333333")] }), "#333333");
  assert.equal(variantStyle.color, "#222222");
});
