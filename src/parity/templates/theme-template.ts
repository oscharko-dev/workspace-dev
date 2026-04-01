// ---------------------------------------------------------------------------
// theme-template.ts — MUI theme file generation
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type {
  DesignIR,
  GeneratedFile
} from "../types.js";
import type {
  ResolvedStorybookPalette,
  ResolvedStorybookPaletteColor,
  ResolvedStorybookTheme,
  ResolvedStorybookThemeComponent,
  ResolvedStorybookThemeScheme,
  ResolvedStorybookTypographyStyle
} from "../../storybook/theme-resolver.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "../typography-tokens.js";
import {
  toResponsiveBreakpointValuesLiteral
} from "../generator-responsive.js";
import {
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey,
  isRtlLocale
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

const toThemeConfigLiteral = (value: boolean | number | string): string => {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return literal(value);
};

const renderPaletteColorEntry = ({
  key,
  color
}: {
  key: string;
  color: ResolvedStorybookPaletteColor;
}): string => {
  return `${key}: { main: ${literal(color.main)}${color.contrastText ? `, contrastText: ${literal(color.contrastText)}` : ""} }`;
};

const renderStorybookPalette = ({
  mode,
  palette
}: {
  mode: "light" | "dark";
  palette: ResolvedStorybookPalette;
}): string => {
  const entries = [
    `mode: ${literal(mode)}`,
    renderPaletteColorEntry({ key: "primary", color: palette.primary })
  ];
  if (palette.secondary) {
    entries.push(renderPaletteColorEntry({ key: "secondary", color: palette.secondary }));
  }
  if (palette.success) {
    entries.push(renderPaletteColorEntry({ key: "success", color: palette.success }));
  }
  if (palette.warning) {
    entries.push(renderPaletteColorEntry({ key: "warning", color: palette.warning }));
  }
  if (palette.error) {
    entries.push(renderPaletteColorEntry({ key: "error", color: palette.error }));
  }
  if (palette.info) {
    entries.push(renderPaletteColorEntry({ key: "info", color: palette.info }));
  }
  entries.push(
    `background: { default: ${literal(palette.background.default)}, paper: ${literal(palette.background.paper)} }`,
    `text: { primary: ${literal(palette.text.primary)}${palette.text.secondary ? `, secondary: ${literal(palette.text.secondary)}` : ""}${palette.text.disabled ? `, disabled: ${literal(palette.text.disabled)}` : ""} }`
  );
  if (palette.divider) {
    entries.push(`divider: ${literal(palette.divider)}`);
  }
  if (palette.action) {
    const actionEntries = [
      palette.action.active ? `active: ${literal(palette.action.active)}` : undefined,
      palette.action.hover ? `hover: ${literal(palette.action.hover)}` : undefined,
      palette.action.selected ? `selected: ${literal(palette.action.selected)}` : undefined,
      palette.action.disabled ? `disabled: ${literal(palette.action.disabled)}` : undefined,
      palette.action.disabledBackground ? `disabledBackground: ${literal(palette.action.disabledBackground)}` : undefined,
      palette.action.focus ? `focus: ${literal(palette.action.focus)}` : undefined
    ].filter((entry): entry is string => Boolean(entry));
    if (actionEntries.length > 0) {
      entries.push(`action: { ${actionEntries.join(", ")} }`);
    }
  }
  return `{\n      ${entries.join(",\n      ")}\n    }`;
};

const renderStorybookTypographyStyle = ({
  style,
  includeFontFamily = true
}: {
  style: ResolvedStorybookTypographyStyle;
  includeFontFamily?: boolean;
}): string => {
  const entries = [
    includeFontFamily && style.fontFamily ? `fontFamily: ${literal(style.fontFamily)}` : undefined,
    style.fontSizePx !== undefined ? `fontSize: ${literal(`${style.fontSizePx}px`)}` : undefined,
    style.fontWeight !== undefined ? `fontWeight: ${toThemeConfigLiteral(style.fontWeight)}` : undefined,
    style.lineHeight !== undefined ? `lineHeight: ${toThemeConfigLiteral(style.lineHeight)}` : undefined,
    style.letterSpacing !== undefined ? `letterSpacing: ${toThemeConfigLiteral(style.letterSpacing)}` : undefined,
    style.textTransform ? `textTransform: ${literal(style.textTransform)}` : undefined
  ].filter((entry): entry is string => Boolean(entry));
  return `{ ${entries.join(", ")} }`;
};

const renderStorybookThemeComponent = ({
  componentName,
  component
}: {
  componentName: string;
  component: ResolvedStorybookThemeComponent;
}): string | undefined => {
  const componentEntries: string[] = [];
  const defaultPropsEntries = Object.entries(component.defaultProps ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (defaultPropsEntries.length > 0) {
    componentEntries.push(
      `      defaultProps: { ${defaultPropsEntries.map(([key, value]) => `${key}: ${toThemeConfigLiteral(value)}`).join(", ")} }`
    );
  }
  const rootStyleEntries = Object.entries(component.rootStyleOverrides ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (rootStyleEntries.length > 0) {
    componentEntries.push(
      `      styleOverrides: {\n        root: {\n${rootStyleEntries
        .map(([key, value]) => `          ${key}: ${toThemeConfigLiteral(value)}`)
        .join(",\n")}\n        }\n      }`
    );
  }
  if (componentEntries.length === 0) {
    return undefined;
  }
  return `    ${componentName}: {\n${componentEntries.join(",\n")}\n    }`;
};

const renderStorybookThemeComponents = ({
  scheme
}: {
  scheme: ResolvedStorybookThemeScheme;
}): string[] => {
  const customComponentNames = Object.keys(scheme.components)
    .filter((componentName) => !THEME_COMPONENT_ORDER.includes(componentName))
    .sort((left, right) => left.localeCompare(right));
  const componentOrder = [...THEME_COMPONENT_ORDER, ...customComponentNames]
    .filter((componentName, index, entries) => entries.indexOf(componentName) === index)
    .filter((componentName) => Boolean(scheme.components[componentName]));
  return componentOrder
    .map((componentName) =>
      renderStorybookThemeComponent({
        componentName,
        component: scheme.components[componentName] ?? {}
      })
    )
    .filter((block): block is string => Boolean(block));
};

export const storybookThemeFile = ({
  resolvedTheme,
  generationLocale
}: {
  resolvedTheme: ResolvedStorybookTheme;
  generationLocale?: string;
}): GeneratedFile => {
  const rtl = isRtlLocale(generationLocale);
  const lightScheme = resolvedTheme.light;
  const darkScheme = resolvedTheme.dark;
  const deterministicTypographyVariants = new Set<string>(DESIGN_TYPOGRAPHY_VARIANTS);
  const variantOrder = [
    ...DESIGN_TYPOGRAPHY_VARIANTS,
    ...Object.keys(lightScheme.typography.variants)
      .filter((variantName) => !deterministicTypographyVariants.has(variantName))
      .sort((left, right) => left.localeCompare(right))
  ];
  const typographyEntries = [
    lightScheme.typography.base.fontSizePx !== undefined ? `    fontSize: ${Math.max(0, Math.round(lightScheme.typography.base.fontSizePx))}` : undefined,
    lightScheme.typography.base.fontWeight !== undefined ? `    fontWeightRegular: ${toThemeConfigLiteral(lightScheme.typography.base.fontWeight)}` : undefined,
    ...variantOrder
      .map((variantName) => {
        const variant = lightScheme.typography.variants[variantName];
        if (!variant) {
          return undefined;
        }
        return `    ${variantName}: ${renderStorybookTypographyStyle({
          style: variant
        })}`;
      })
      .filter((entry): entry is string => Boolean(entry))
  ].filter((entry): entry is string => Boolean(entry));
  const componentBlocks = renderStorybookThemeComponents({
    scheme: lightScheme
  });
  const directionBlock = rtl ? `  direction: "rtl",\n` : "";
  const cssBaselineBlock = rtl
    ? `,\n    MuiCssBaseline: {\n      styleOverrides: {\n        body: {\n          direction: "rtl"\n        }\n      }\n    }`
    : "";

  return {
    path: "src/theme/theme.ts",
    content: `import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
${directionBlock}  colorSchemes: {
    light: {
      palette: ${renderStorybookPalette({
        mode: "light",
        palette: lightScheme.palette
      })}
    }
${darkScheme ? `,\n    dark: {\n      palette: ${renderStorybookPalette({ mode: "dark", palette: darkScheme.palette })}\n    }` : ""}
  },
  shape: {
    borderRadius: ${Math.max(0, Math.round(lightScheme.borderRadius))}
  },
  spacing: ${Math.max(1, Math.round(lightScheme.spacingBase))},
  typography: {
    fontFamily: ${literal(lightScheme.typography.fontFamily)},
${typographyEntries.join(",\n")}
  },
  components: {
${componentBlocks.join(",\n")}${cssBaselineBlock}
  }
});
`
  };
};

export const fallbackThemeFile = (ir: DesignIR, themeComponentDefaults?: ThemeComponentDefaults, generationLocale?: string): GeneratedFile => {
  const tokens = ir.tokens;
  const rtl = isRtlLocale(generationLocale);
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

  const directionBlock = rtl ? `  direction: "rtl",\n` : "";
  const cssBaselineBlock = rtl
    ? `,\n    MuiCssBaseline: {\n      styleOverrides: {\n        body: {\n          direction: "rtl"\n        }\n      }\n    }`
    : "";

  return {
    path: "src/theme/theme.ts",
    content: `import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
${directionBlock}  colorSchemes: {
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
${componentBlocks.join(",\n")}${cssBaselineBlock}
  }
});
`
  };
};
