// ---------------------------------------------------------------------------
// theme-template.ts — MUI theme file generation
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type {
  DesignIR,
  GeneratedFile
} from "../types.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "../typography-tokens.js";
import {
  toResponsiveBreakpointValuesLiteral
} from "../generator-responsive.js";
import {
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey
} from "../generator-core.js";
import type {
  ThemeComponentDefaults,
  ThemeSxStyleValue
} from "../generator-core.js";
import {
  literal,
  toRemLiteral,
  toEmLiteral,
  toLightThemePalette,
  toDarkThemePalette,
  toThemePaletteBlock,
  deriveResponsiveThemeBreakpointValues
} from "./utility-functions.js";

export interface ThemeComponentBlockDraft {
  defaultPropsEntries: Array<[string, string | number]>;
  rootStyleEntries: Array<[string, ThemeSxStyleValue]>;
  nestedRootStyleEntries: Array<{
    selector: string;
    entries: Array<[string, ThemeSxStyleValue]>;
  }>;
}

export const toThemeSxStyleValueLiteral = (value: ThemeSxStyleValue): string => {
  if (typeof value === "number") {
    return String(roundStableSxNumericValue(value));
  }
  return literal(value);
};

export const createThemeComponentBlockDraft = ({
  componentName,
  themeComponentDefaults
}: {
  componentName: string;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}): ThemeComponentBlockDraft => {
  const draft: ThemeComponentBlockDraft = {
    defaultPropsEntries: [],
    rootStyleEntries: [],
    nestedRootStyleEntries: []
  };

  if (componentName === "MuiButton") {
    draft.rootStyleEntries.push(["textTransform", "none"]);
    return draft;
  }
  if (componentName === "MuiCard") {
    if (themeComponentDefaults?.MuiCard?.elevation !== undefined) {
      draft.defaultPropsEntries.push(["elevation", themeComponentDefaults.MuiCard.elevation]);
    }
    if (themeComponentDefaults?.MuiCard?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiCard.borderRadiusPx}px`]);
    }
    return draft;
  }
  if (componentName === "MuiTextField") {
    if (themeComponentDefaults?.MuiTextField?.outlinedInputBorderRadiusPx !== undefined) {
      draft.nestedRootStyleEntries.push({
        selector: "& .MuiOutlinedInput-root",
        entries: [["borderRadius", `${themeComponentDefaults.MuiTextField.outlinedInputBorderRadiusPx}px`]]
      });
    }
    return draft;
  }
  if (componentName === "MuiChip") {
    if (themeComponentDefaults?.MuiChip?.size) {
      draft.defaultPropsEntries.push(["size", themeComponentDefaults.MuiChip.size]);
    }
    if (themeComponentDefaults?.MuiChip?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiChip.borderRadiusPx}px`]);
    }
    return draft;
  }
  if (componentName === "MuiPaper") {
    if (themeComponentDefaults?.MuiPaper?.elevation !== undefined) {
      draft.defaultPropsEntries.push(["elevation", themeComponentDefaults.MuiPaper.elevation]);
    }
    return draft;
  }
  if (componentName === "MuiAppBar") {
    if (themeComponentDefaults?.MuiAppBar?.backgroundColor) {
      draft.rootStyleEntries.push(["backgroundColor", themeComponentDefaults.MuiAppBar.backgroundColor]);
    }
    return draft;
  }
  if (componentName === "MuiDivider") {
    if (themeComponentDefaults?.MuiDivider?.borderColor) {
      draft.rootStyleEntries.push(["borderColor", themeComponentDefaults.MuiDivider.borderColor]);
    }
    return draft;
  }
  if (componentName === "MuiAvatar") {
    if (themeComponentDefaults?.MuiAvatar?.widthPx !== undefined) {
      draft.rootStyleEntries.push(["width", `${themeComponentDefaults.MuiAvatar.widthPx}px`]);
    }
    if (themeComponentDefaults?.MuiAvatar?.heightPx !== undefined) {
      draft.rootStyleEntries.push(["height", `${themeComponentDefaults.MuiAvatar.heightPx}px`]);
    }
    if (themeComponentDefaults?.MuiAvatar?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiAvatar.borderRadiusPx}px`]);
    }
    return draft;
  }
  return draft;
};

export const appendC1ThemeStyleEntriesToDraft = ({
  componentName,
  draft,
  themeComponentDefaults
}: {
  componentName: string;
  draft: ThemeComponentBlockDraft;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}): void => {
  const c1Entries = themeComponentDefaults?.c1StyleOverrides?.[componentName];
  if (!c1Entries) {
    return;
  }
  const existingRootKeys = new Set(draft.rootStyleEntries.map(([key]) => key));
  const orderedC1Keys = Object.keys(c1Entries).sort((left, right) => left.localeCompare(right));
  for (const key of orderedC1Keys) {
    if (existingRootKeys.has(key)) {
      continue;
    }
    const value = c1Entries[key];
    const normalizedValue = normalizeThemeSxValueForKey({
      key,
      value
    });
    if (normalizedValue === undefined) {
      continue;
    }
    draft.rootStyleEntries.push([key, normalizedValue]);
    existingRootKeys.add(key);
  }
};

export const renderThemeComponentBlock = ({
  componentName,
  draft
}: {
  componentName: string;
  draft: ThemeComponentBlockDraft;
}): string | undefined => {
  const componentEntries: string[] = [];
  if (draft.defaultPropsEntries.length > 0) {
    componentEntries.push(
      `      defaultProps: { ${draft.defaultPropsEntries
        .map(([key, value]) => `${key}: ${typeof value === "number" ? value : literal(value)}`)
        .join(", ")} }`
    );
  }
  if (draft.rootStyleEntries.length > 0 || draft.nestedRootStyleEntries.length > 0) {
    const rootEntries = draft.rootStyleEntries.map(
      ([key, value]) => `          ${key}: ${toThemeSxStyleValueLiteral(value)}`
    );
    for (const nestedEntry of draft.nestedRootStyleEntries) {
      const nestedLines = nestedEntry.entries.map(
        ([key, value]) => `            ${key}: ${toThemeSxStyleValueLiteral(value)}`
      );
      rootEntries.push(`          ${literal(nestedEntry.selector)}: {\n${nestedLines.join(",\n")}\n          }`);
    }
    componentEntries.push(`      styleOverrides: {\n        root: {\n${rootEntries.join(",\n")}\n        }\n      }`);
  }
  if (componentEntries.length === 0) {
    return undefined;
  }
  return `    ${componentName}: {\n${componentEntries.join(",\n")}\n    }`;
};

export const fallbackThemeFile = (ir: DesignIR, themeComponentDefaults?: ThemeComponentDefaults): GeneratedFile => {
  const tokens = ir.tokens;
  const lightPalette = toLightThemePalette(tokens);
  const includeDarkColorScheme = ir.themeAnalysis?.darkModeDetected ?? true;
  const darkPalette = includeDarkColorScheme ? toDarkThemePalette(tokens, ir.themeAnalysis?.darkPaletteHints) : undefined;
  const responsiveThemeBreakpoints = deriveResponsiveThemeBreakpointValues(ir);
  const typographyEntries = DESIGN_TYPOGRAPHY_VARIANTS.map((variantName) => {
    const variant = tokens.typography[variantName];
    const entries = [
      ["fontSize", toRemLiteral(variant.fontSizePx)],
      ["fontWeight", Math.round(variant.fontWeight)],
      ["lineHeight", toRemLiteral(variant.lineHeightPx)],
      ["fontFamily", variant.fontFamily ? literal(variant.fontFamily) : undefined],
      ["letterSpacing", typeof variant.letterSpacingEm === "number" ? toEmLiteral(variant.letterSpacingEm) : undefined],
      ["textTransform", variant.textTransform ? literal(variant.textTransform) : undefined]
    ]
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return `    ${variantName}: { ${entries} }`;
  }).join(",\n");
  const c1ComponentNames = Object.keys(themeComponentDefaults?.c1StyleOverrides ?? {})
    .filter((componentName) => !THEME_COMPONENT_ORDER.includes(componentName))
    .sort((left, right) => left.localeCompare(right));
  const componentOrder = [...THEME_COMPONENT_ORDER, ...c1ComponentNames];
  const componentBlocks = componentOrder
    .map((componentName) => {
      const draft = createThemeComponentBlockDraft({
        componentName,
        themeComponentDefaults
      });
      appendC1ThemeStyleEntriesToDraft({
        componentName,
        draft,
        themeComponentDefaults
      });
      return renderThemeComponentBlock({
        componentName,
        draft
      });
    })
    .filter((block): block is string => Boolean(block));

  return {
    path: "src/theme/theme.ts",
    content: `import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: ${toThemePaletteBlock({ mode: "light", palette: lightPalette })}
    }
${darkPalette ? `,\n    dark: {\n      palette: ${toThemePaletteBlock({ mode: "dark", palette: darkPalette })}\n    }` : ""}
  },
  shape: {
    borderRadius: ${Math.max(0, Math.round(tokens.borderRadius))}
  },
  spacing: ${Math.max(1, Math.round(tokens.spacingBase))},
${responsiveThemeBreakpoints ? `  breakpoints: {\n    values: ${toResponsiveBreakpointValuesLiteral(responsiveThemeBreakpoints)}\n  },\n` : ""}  typography: {
    fontFamily: "${tokens.fontFamily}",
${typographyEntries}
  },
  components: {
${componentBlocks.join(",\n")}
  }
});
`
  };
};

