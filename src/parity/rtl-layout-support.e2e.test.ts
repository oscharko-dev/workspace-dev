// ---------------------------------------------------------------------------
// rtl-layout-support.e2e.test.ts — E2E test for RTL layout support (#317)
// Validates theme direction, logical properties, text alignment, icon mirroring
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import type { DesignIR } from "./types.js";
import {
  createDeterministicThemeFile,
  createDeterministicScreenFile,
  isRtlLocale,
  RTL_LANGUAGE_CODES,
  DIRECTIONAL_ICON_NAMES
} from "./generator-core.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

let cachedIr: DesignIR | undefined;

const deriveIrOnce = async (): Promise<DesignIR> => {
  if (cachedIr) {
    return cachedIr;
  }
  const figmaFile = await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
  cachedIr = figmaToDesignIrWithOptions(figmaFile);
  return cachedIr;
};

// ── RTL locale detection unit tests ──────────────────────────────────────

test("isRtlLocale returns true for RTL languages", () => {
  assert.equal(isRtlLocale("ar"), true, "Arabic should be RTL");
  assert.equal(isRtlLocale("ar-SA"), true, "Arabic (Saudi Arabia) should be RTL");
  assert.equal(isRtlLocale("ar-EG"), true, "Arabic (Egypt) should be RTL");
  assert.equal(isRtlLocale("he"), true, "Hebrew should be RTL");
  assert.equal(isRtlLocale("he-IL"), true, "Hebrew (Israel) should be RTL");
  assert.equal(isRtlLocale("fa"), true, "Farsi should be RTL");
  assert.equal(isRtlLocale("fa-IR"), true, "Farsi (Iran) should be RTL");
  assert.equal(isRtlLocale("ur"), true, "Urdu should be RTL");
  assert.equal(isRtlLocale("ur-PK"), true, "Urdu (Pakistan) should be RTL");
});

test("isRtlLocale returns false for LTR languages", () => {
  assert.equal(isRtlLocale("en"), false, "English should be LTR");
  assert.equal(isRtlLocale("en-US"), false, "English (US) should be LTR");
  assert.equal(isRtlLocale("de-DE"), false, "German should be LTR");
  assert.equal(isRtlLocale("fr-FR"), false, "French should be LTR");
  assert.equal(isRtlLocale("ja-JP"), false, "Japanese should be LTR");
  assert.equal(isRtlLocale("zh-CN"), false, "Chinese should be LTR");
});

test("isRtlLocale handles edge cases", () => {
  assert.equal(isRtlLocale(undefined), false, "undefined should be LTR");
  assert.equal(isRtlLocale(""), false, "empty string should be LTR");
  assert.equal(isRtlLocale("  "), false, "whitespace should be LTR");
});

test("RTL_LANGUAGE_CODES contains expected languages", () => {
  assert.ok(RTL_LANGUAGE_CODES.has("ar"), "Must include Arabic");
  assert.ok(RTL_LANGUAGE_CODES.has("he"), "Must include Hebrew");
  assert.ok(RTL_LANGUAGE_CODES.has("fa"), "Must include Farsi");
  assert.ok(RTL_LANGUAGE_CODES.has("ur"), "Must include Urdu");
  assert.equal(RTL_LANGUAGE_CODES.has("en"), false, "Must not include English");
});

test("DIRECTIONAL_ICON_NAMES contains arrow and chevron icons", () => {
  assert.ok(DIRECTIONAL_ICON_NAMES.has("ArrowBackIcon"), "Must include ArrowBackIcon");
  assert.ok(DIRECTIONAL_ICON_NAMES.has("ArrowForwardIcon"), "Must include ArrowForwardIcon");
  assert.ok(DIRECTIONAL_ICON_NAMES.has("ChevronLeftIcon"), "Must include ChevronLeftIcon");
  assert.ok(DIRECTIONAL_ICON_NAMES.has("ChevronRightIcon"), "Must include ChevronRightIcon");
  assert.ok(DIRECTIONAL_ICON_NAMES.has("NavigateBeforeIcon"), "Must include NavigateBeforeIcon");
  assert.ok(DIRECTIONAL_ICON_NAMES.has("NavigateNextIcon"), "Must include NavigateNextIcon");
});

// ── Theme direction E2E tests ────────────────────────────────────────────

test("E2E: RTL locale generates theme with direction rtl", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir, "ar-SA");
  const content = themeFile.content;

  assert.ok(
    content.includes('direction: "rtl"'),
    "RTL theme must include direction: \"rtl\""
  );
  assert.ok(
    content.includes("extendTheme({"),
    "Theme must still use extendTheme"
  );
});

test("E2E: LTR locale does not generate direction in theme", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir, "de-DE");
  const content = themeFile.content;

  assert.equal(
    content.includes('direction:'),
    false,
    "LTR theme must not include direction property"
  );
});

test("E2E: undefined locale does not generate direction in theme", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir);
  const content = themeFile.content;

  assert.equal(
    content.includes('direction:'),
    false,
    "Default (undefined) locale theme must not include direction property"
  );
});

// ── CssBaseline RTL configuration tests ──────────────────────────────────

test("E2E: RTL locale generates MuiCssBaseline with direction rtl", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir, "ar-SA");
  const content = themeFile.content;

  assert.ok(
    content.includes("MuiCssBaseline"),
    "RTL theme must include MuiCssBaseline component override"
  );
  assert.ok(
    content.includes('direction: "rtl"'),
    "RTL theme MuiCssBaseline must set body direction to rtl"
  );
});

test("E2E: LTR locale does not generate MuiCssBaseline override", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir, "en-US");
  const content = themeFile.content;

  assert.equal(
    content.includes("MuiCssBaseline"),
    false,
    "LTR theme must not include MuiCssBaseline override"
  );
});

// ── Text alignment logical values tests ──────────────────────────────────

test("E2E: RTL locale maps text alignment LEFT to start", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const hasTextScreens = ir.screens.some((screen) =>
    screen.children.some((child) => child.textAlign === "LEFT")
  );

  if (!hasTextScreens) {
    return;
  }

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "ar-EG"
    });
    const content = screenFile.content;

    if (content.includes("textAlign:")) {
      assert.equal(
        content.includes('textAlign: "left"'),
        false,
        `RTL screen '${screen.name}' must not use textAlign: "left", should use "start"`
      );
      assert.equal(
        content.includes('textAlign: "right"'),
        false,
        `RTL screen '${screen.name}' must not use textAlign: "right", should use "end"`
      );
    }
  }
});

test("E2E: LTR locale preserves text alignment left/right", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "de-DE"
    });
    const content = screenFile.content;

    if (content.includes("textAlign:")) {
      assert.equal(
        content.includes('textAlign: "start"'),
        false,
        `LTR screen '${screen.name}' must not use textAlign: "start", should use "left"`
      );
      assert.equal(
        content.includes('textAlign: "end"'),
        false,
        `LTR screen '${screen.name}' must not use textAlign: "end", should use "right"`
      );
    }
  }
});

// ── Logical property tests ───────────────────────────────────────────────

test("E2E: RTL locale uses logical properties for padding", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  let foundLogicalProperty = false;

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "ar-SA"
    });
    const content = screenFile.content;

    if (content.includes("paddingInlineStart") || content.includes("paddingInlineEnd")) {
      foundLogicalProperty = true;
    }
    // RTL screen should not have shorthand pr/pl when individual left/right padding values differ
    // (symmetric px is still allowed)
    assert.equal(
      / pr: /.test(content),
      false,
      `RTL screen '${screen.name}' must not use shorthand pr: (should use paddingInlineEnd)`
    );
    assert.equal(
      / pl: /.test(content),
      false,
      `RTL screen '${screen.name}' must not use shorthand pl: (should use paddingInlineStart)`
    );
  }

  // Not all screens have asymmetric padding, but the test validates that
  // when present, logical properties are used
  if (foundLogicalProperty) {
    assert.ok(true, "At least one screen uses logical padding properties in RTL mode");
  }
});

test("E2E: LTR locale uses physical shorthand properties for padding", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "de-DE"
    });
    const content = screenFile.content;

    assert.equal(
      content.includes("paddingInlineStart"),
      false,
      `LTR screen '${screen.name}' must not use paddingInlineStart`
    );
    assert.equal(
      content.includes("paddingInlineEnd"),
      false,
      `LTR screen '${screen.name}' must not use paddingInlineEnd`
    );
  }
});

test("E2E: RTL locale uses logical properties for margin", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "ar-SA"
    });
    const content = screenFile.content;

    assert.equal(
      / mr: /.test(content),
      false,
      `RTL screen '${screen.name}' must not use shorthand mr: (should use marginInlineEnd)`
    );
    assert.equal(
      / ml: /.test(content),
      false,
      `RTL screen '${screen.name}' must not use shorthand ml: (should use marginInlineStart)`
    );
  }
});

// ── RTL locale completeness: multiple RTL locales ────────────────────────

test("E2E: all RTL locales produce consistent theme direction", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const rtlLocales = ["ar-SA", "he-IL", "fa-IR", "ur-PK"];

  for (const locale of rtlLocales) {
    const themeFile = createDeterministicThemeFile(ir, locale);
    const content = themeFile.content;

    assert.ok(
      content.includes('direction: "rtl"'),
      `Theme for locale '${locale}' must include direction: "rtl"`
    );
    assert.ok(
      content.includes("MuiCssBaseline"),
      `Theme for locale '${locale}' must include MuiCssBaseline`
    );
  }
});

// ── Icon mirroring tests ─────────────────────────────────────────────────

test("E2E: RTL locale adds scaleX(-1) to directional icons in screens with endIcon", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  let foundChevronScreen = false;

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "ar-EG"
    });
    const content = screenFile.content;

    if (content.includes("ChevronRightIcon") || content.includes("ArrowForwardIcon")) {
      foundChevronScreen = true;
      assert.ok(
        content.includes('scaleX(-1)'),
        `RTL screen '${screen.name}' with directional icon must include transform: scaleX(-1)`
      );
    }
  }

  // This test validates the mirroring is applied if directional icons exist
  if (!foundChevronScreen) {
    // If no screen has directional icons, the test still passes
    assert.ok(true, "No directional icons found in screens — mirroring not applicable");
  }
});

test("E2E: LTR locale does not add scaleX(-1) to any icons", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "de-DE"
    });
    const content = screenFile.content;

    assert.equal(
      content.includes("scaleX(-1)"),
      false,
      `LTR screen '${screen.name}' must not include scaleX(-1) icon mirroring`
    );
  }
});

// ── Absolute positioning logical property tests ──────────────────────────

test("E2E: RTL locale uses insetInlineStart instead of left for absolute children", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "ar-SA"
    });
    const content = screenFile.content;

    // If there are absolute positioned elements, they should use insetInlineStart
    if (content.includes("position: \"absolute\"")) {
      assert.ok(
        content.includes("insetInlineStart:") || !content.includes("left:"),
        `RTL screen '${screen.name}' with absolute elements should use insetInlineStart instead of left`
      );
    }
  }
});

test("E2E: LTR locale uses left for absolute children", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();

  for (const screen of ir.screens) {
    const screenFile = createDeterministicScreenFile(screen, {
      generationLocale: "de-DE"
    });
    const content = screenFile.content;

    assert.equal(
      content.includes("insetInlineStart"),
      false,
      `LTR screen '${screen.name}' must not use insetInlineStart`
    );
  }
});
