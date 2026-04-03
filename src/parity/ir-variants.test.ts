import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPlaceholderNode,
  classifyPlaceholderText,
  extractFirstTextFillColor,
  extractVariantDataFromNode,
  extractVariantStyleFromNode,
  inferVariantSignalsFromNamePath,
  normalizeVariantKey,
  normalizeVariantValue,
  resolveMuiPropsFromVariantProperties,
  resolvePlaceholderMatcherConfig,
  toComponentSetVariantMapping,
  toMuiColor,
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

test("normalizeVariantKey maps Type and Style to variant", () => {
  assert.equal(normalizeVariantKey("Type"), "variant");
  assert.equal(normalizeVariantKey("Style"), "variant");
  assert.equal(normalizeVariantKey("button type"), "variant");
  assert.equal(normalizeVariantKey("button style"), "variant");
  assert.equal(normalizeVariantKey("Button-Variant"), "variant");
});

test("normalizeVariantKey maps theme to color", () => {
  assert.equal(normalizeVariantKey("theme"), "color");
  assert.equal(normalizeVariantKey("color"), "color");
  assert.equal(normalizeVariantKey("Color Tone"), "color");
});

test("toMuiColor maps Figma color property values to MUI color props", () => {
  assert.equal(toMuiColor("Primary"), "primary");
  assert.equal(toMuiColor("secondary"), "secondary");
  assert.equal(toMuiColor("Error"), "error");
  assert.equal(toMuiColor("danger"), "error");
  assert.equal(toMuiColor("destructive"), "error");
  assert.equal(toMuiColor("Info"), "info");
  assert.equal(toMuiColor("Success"), "success");
  assert.equal(toMuiColor("Warning"), "warning");
  assert.equal(toMuiColor("inherit"), "inherit");
  assert.equal(toMuiColor("default"), "primary");
  assert.equal(toMuiColor("unknown-color"), undefined);
  assert.equal(toMuiColor(undefined), undefined);
});

test("resolveMuiPropsFromVariantProperties resolves color property", () => {
  assert.deepEqual(
    resolveMuiPropsFromVariantProperties({
      properties: { variant: "Contained", color: "Secondary" },
      state: undefined
    }),
    { variant: "contained", color: "secondary" }
  );
  assert.deepEqual(
    resolveMuiPropsFromVariantProperties({
      properties: { variant: "Outlined", color: "Error", size: "Small" },
      state: undefined
    }),
    { variant: "outlined", color: "error", size: "small" }
  );
});

test("extractVariantDataFromNode maps Type property to variant", () => {
  const result = extractVariantDataFromNode({
    id: "btn-1",
    type: "COMPONENT",
    name: "Submit Button",
    componentProperties: {
      Type: { type: "VARIANT", value: "Outlined" },
      Size: { type: "VARIANT", value: "Large" },
      Color: { type: "VARIANT", value: "Secondary" }
    }
  });
  assert.ok(result);
  assert.equal(result.muiProps.variant, "outlined");
  assert.equal(result.muiProps.size, "large");
  assert.equal(result.muiProps.color, "secondary");
});

test("extractVariantDataFromNode maps Style property to variant", () => {
  const result = extractVariantDataFromNode({
    id: "btn-2",
    type: "COMPONENT",
    name: "Action Button",
    componentProperties: {
      Style: { type: "VARIANT", value: "Text" }
    }
  });
  assert.ok(result);
  assert.equal(result.muiProps.variant, "text");
});

test("extractVariantDataFromNode prefers canonical variant keys over data aliases regardless of object key order", () => {
  const first = extractVariantDataFromNode({
    id: "btn-order-a",
    type: "COMPONENT",
    name: "Variant=Contained, Data-variant=SpaceAround",
    componentProperties: {
      "Data-variant": { type: "VARIANT", value: "SpaceAround" },
      Variant: { type: "VARIANT", value: "Contained" }
    }
  });
  const second = extractVariantDataFromNode({
    id: "btn-order-b",
    type: "COMPONENT",
    name: "Variant=Contained, Data-variant=SpaceAround",
    componentProperties: {
      Variant: { type: "VARIANT", value: "Contained" },
      "Data-variant": { type: "VARIANT", value: "SpaceAround" }
    }
  });

  assert.equal(first?.properties.variant, "Contained");
  assert.equal(second?.properties.variant, "Contained");
  assert.deepEqual(first, second);
});

test("toComponentSetVariantMapping resolves color from component properties", () => {
  const mapping = toComponentSetVariantMapping({
    id: "btn-set",
    type: "COMPONENT_SET",
    componentPropertyDefinitions: {
      Variant: { type: "VARIANT", defaultValue: "Contained" },
      Color: { type: "VARIANT", defaultValue: "Primary" }
    },
    children: [
      {
        id: "btn-primary",
        type: "COMPONENT",
        name: "Variant=Contained, Color=Primary",
        componentProperties: {
          Variant: { type: "VARIANT", value: "Contained" },
          Color: { type: "VARIANT", value: "Primary" }
        },
        fills: [toSolidPaint("#1976d2")],
        children: []
      },
      {
        id: "btn-error",
        type: "COMPONENT",
        name: "Variant=Contained, Color=Error",
        componentProperties: {
          Variant: { type: "VARIANT", value: "Contained" },
          Color: { type: "VARIANT", value: "Error" }
        },
        fills: [toSolidPaint("#d32f2f")],
        children: []
      }
    ]
  });

  assert.ok(mapping);
  assert.equal(mapping.muiProps.variant, "contained");
  assert.equal(mapping.muiProps.color, "primary");
  assert.equal(mapping.states?.length, 2);
  assert.equal(mapping.states?.[1]?.muiProps.color, "error");
});

test("inferVariantSignalsFromNamePath extracts state from component path segments", () => {
  assert.equal(inferVariantSignalsFromNamePath("Button/Hover").state, "hover");
  assert.equal(inferVariantSignalsFromNamePath("Button/Active").state, "active");
  assert.equal(inferVariantSignalsFromNamePath("Button/Pressed").state, "active");
  assert.equal(inferVariantSignalsFromNamePath("Button/Disabled").state, "disabled");
  assert.equal(inferVariantSignalsFromNamePath("Button/Default").state, "default");
  assert.equal(inferVariantSignalsFromNamePath("Button/Enabled").state, "default");
  assert.equal(inferVariantSignalsFromNamePath("Primary Button").state, undefined);
});

test("inferVariantSignalsFromNamePath extracts variant from component path segments", () => {
  assert.equal(inferVariantSignalsFromNamePath("Button/Outlined").variant, "outlined");
  assert.equal(inferVariantSignalsFromNamePath("Button/Contained/Default").variant, "contained");
  assert.equal(inferVariantSignalsFromNamePath("Filled Button").variant, "contained");
  assert.equal(inferVariantSignalsFromNamePath("Text/Small").variant, "text");
});

test("inferVariantSignalsFromNamePath extracts size from component path segments", () => {
  assert.equal(inferVariantSignalsFromNamePath("Button/Small").size, "small");
  assert.equal(inferVariantSignalsFromNamePath("Button/Large").size, "large");
  assert.equal(inferVariantSignalsFromNamePath("Button/Medium").size, "medium");
});

test("inferVariantSignalsFromNamePath extracts color from component path segments", () => {
  assert.equal(inferVariantSignalsFromNamePath("Button/Secondary").color, "secondary");
  assert.equal(inferVariantSignalsFromNamePath("Button/Error").color, "error");
  assert.equal(inferVariantSignalsFromNamePath("Button/Success/Large").color, "success");
});

test("inferVariantSignalsFromNamePath returns empty for unknown segments", () => {
  const result = inferVariantSignalsFromNamePath("Frame/Container");
  assert.equal(result.state, undefined);
  assert.equal(result.variant, undefined);
  assert.equal(result.size, undefined);
  assert.equal(result.color, undefined);
});

test("extractVariantDataFromNode infers state from INSTANCE name path", () => {
  const result = extractVariantDataFromNode({
    id: "btn-hover",
    type: "INSTANCE",
    name: "Button/Hover",
    fills: [toSolidPaint("#2f6fed")]
  });
  assert.ok(result);
  assert.equal(result.state, "hover");
  assert.equal(result.stateOverrides?.hover?.backgroundColor, "#2f6fed");
});

test("extractVariantDataFromNode infers variant from INSTANCE name when no componentProperties", () => {
  const result = extractVariantDataFromNode({
    id: "btn-outlined",
    type: "INSTANCE",
    name: "Button/Outlined/Small"
  });
  assert.ok(result);
  assert.equal(result.muiProps.variant, "outlined");
  assert.equal(result.muiProps.size, "small");
});

test("extractVariantDataFromNode prefers explicit componentProperties over name path signals", () => {
  const result = extractVariantDataFromNode({
    id: "btn-explicit",
    type: "INSTANCE",
    name: "Button/Outlined",
    componentProperties: {
      Variant: { type: "VARIANT", value: "Contained" },
      Size: { type: "VARIANT", value: "Large" }
    }
  });
  assert.ok(result);
  assert.equal(result.muiProps.variant, "contained");
  assert.equal(result.muiProps.size, "large");
});

test("extractVariantDataFromNode generates stateOverrides for disabled INSTANCE", () => {
  const result = extractVariantDataFromNode({
    id: "btn-disabled",
    type: "INSTANCE",
    name: "Submit Button",
    componentProperties: {
      State: { type: "VARIANT", value: "Disabled" }
    },
    fills: [toSolidPaint("#d1d5db")],
    children: [
      {
        id: "btn-disabled-label",
        type: "TEXT",
        fills: [toSolidPaint("#9ca3af")],
        characters: "Submit"
      }
    ]
  });
  assert.ok(result);
  assert.equal(result.state, "disabled");
  assert.equal(result.muiProps.disabled, true);
  assert.equal(result.stateOverrides?.disabled?.backgroundColor, "#d1d5db");
  assert.equal(result.stateOverrides?.disabled?.color, "#9ca3af");
});

test("extractVariantDataFromNode does not generate stateOverrides for default state", () => {
  const result = extractVariantDataFromNode({
    id: "btn-default",
    type: "INSTANCE",
    name: "Button/Default",
    fills: [toSolidPaint("#1976d2")]
  });
  assert.ok(result);
  assert.equal(result.state, "default");
  assert.equal(result.stateOverrides, undefined);
});
