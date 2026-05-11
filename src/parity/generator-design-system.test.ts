import assert from "node:assert/strict";
import test from "node:test";
import { deriveThemeComponentDefaultsFromIr } from "./generator-design-system.js";
import type { DesignIR, DesignTokenTypographyVariant, DesignTokens, ScreenElementIR, ScreenIR } from "./types.js";

const typographyVariant: DesignTokenTypographyVariant = {
  fontSizePx: 16,
  fontWeight: 400,
  lineHeightPx: 24,
  fontFamily: "Inter",
  letterSpacingEm: 0
};

const createTokens = (): DesignTokens => ({
  palette: {
    primary: "#112233",
    secondary: "#445566",
    background: "#ffffff",
    text: "#111111",
    success: "#2e7d32",
    warning: "#ed6c02",
    error: "#d32f2f",
    info: "#0288d1",
    divider: "#e0e0e0",
    action: {
      active: "#0000008a",
      hover: "#1122330a",
      selected: "#11223314",
      disabled: "#00000042",
      disabledBackground: "#0000001f",
      focus: "#1122331f"
    }
  },
  borderRadius: 8,
  spacingBase: 8,
  fontFamily: "Inter",
  headingSize: 32,
  bodySize: 16,
  typography: {
    h1: typographyVariant,
    h2: typographyVariant,
    h3: typographyVariant,
    h4: typographyVariant,
    h5: typographyVariant,
    h6: typographyVariant,
    subtitle1: typographyVariant,
    subtitle2: typographyVariant,
    body1: typographyVariant,
    body2: typographyVariant,
    button: typographyVariant,
    caption: typographyVariant,
    overline: typographyVariant
  }
});

const makeNode = ({
  id,
  type,
  name = id,
  nodeType = "FRAME",
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  nodeType?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "type" | "name" | "nodeType">): ScreenElementIR =>
  ({
    id,
    type,
    name,
    nodeType,
    ...overrides
  }) as ScreenElementIR;

test("deriveThemeComponentDefaultsFromIr derives defaults from a unified screen analysis pass", () => {
  const appBar = makeNode({
    id: "appbar",
    type: "appbar",
    fillColor: "#123456",
    height: 64
  });
  const card = makeNode({
    id: "card",
    type: "card",
    cornerRadius: 12,
    elevation: 3
  });
  const outlinedBorder = makeNode({
    id: "outlined-border",
    type: "container",
    name: "MuiNotchedOutlined",
    cornerRadius: 10
  });
  const input = makeNode({
    id: "input",
    type: "input",
    children: [outlinedBorder]
  });
  const chip = makeNode({
    id: "chip",
    type: "chip",
    cornerRadius: 16,
    height: 24
  });
  const paper = makeNode({
    id: "paper",
    type: "paper",
    elevation: 2
  });
  const divider = makeNode({
    id: "divider",
    type: "divider",
    fillColor: "#cccccc",
    height: 1
  });
  const avatar = makeNode({
    id: "avatar",
    type: "avatar",
    width: 40,
    height: 40,
    cornerRadius: 20
  });

  const screen: ScreenIR = {
    id: "screen-1",
    name: "Theme Defaults",
    width: 1440,
    height: 900,
    layoutMode: "VERTICAL",
    children: [appBar, card, input, chip, paper, divider, avatar]
  } as ScreenIR;

  const ir: DesignIR = {
    version: "1",
    screens: [screen],
    tokens: createTokens()
  } as DesignIR;

  const defaults = deriveThemeComponentDefaultsFromIr({
    ir
  });

  assert.deepEqual(defaults?.MuiCard, {
    borderRadiusPx: 12,
    elevation: 3
  });
  assert.deepEqual(defaults?.MuiTextField, {
    outlinedInputBorderRadiusPx: 10
  });
  assert.deepEqual(defaults?.MuiChip, {
    borderRadiusPx: 16,
    size: "small"
  });
  assert.deepEqual(defaults?.MuiPaper, {
    elevation: 2
  });
  assert.deepEqual(defaults?.MuiAppBar, {
    backgroundColor: "#123456"
  });
  assert.deepEqual(defaults?.MuiDivider, {
    borderColor: "#cccccc"
  });
  assert.deepEqual(defaults?.MuiAvatar, {
    widthPx: 40,
    heightPx: 40,
    borderRadiusPx: 20
  });
});
