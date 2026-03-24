import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignIR,
  DesignTokenTypographyVariantName,
  GeneratedFile,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import {
  THEME_SX_EXTRACTION_THRESHOLD,
  THEME_SX_MIN_SAMPLES
} from "./constants.js";
import { DEFAULT_GENERATION_LOCALE } from "../generation-locale.js";
import {
  normalizeHexColor,
  normalizeSpacingBase,
  resolveDeterministicIntegerSample,
  resolveDeterministicColorSample,
  normalizeElevationForSx,
  toRoundedIntegerInRange,
  toChipSize,
  inferChipSizeFromHeight,
  dedupeSxEntries,
  renderNodesIntoParent,
  fallbackThemeFile
} from "./generator-templates.js";
import {
  sortChildren,
  detectNavigationBarPattern,
  NAVIGATION_BAR_TOP_LEVEL_DEPTH,
  findFirstByName,
  ICON_FALLBACK_BUILTIN_RESOLVER,
  flattenElements
} from "./generator-core.js";
import type {
  RenderContext,
  VirtualParent,
  HeadingComponent,
  PatternExtractionInvocation
} from "./generator-core.js";

export interface ThemeComponentDefaults {
  MuiCard?: {
    borderRadiusPx?: number;
    elevation?: number;
  };
  MuiTextField?: {
    outlinedInputBorderRadiusPx?: number;
  };
  MuiChip?: {
    borderRadiusPx?: number;
    size?: "small" | "medium";
  };
  MuiPaper?: {
    elevation?: number;
  };
  MuiAppBar?: {
    backgroundColor?: string;
  };
  MuiDivider?: {
    borderColor?: string;
  };
  MuiAvatar?: {
    widthPx?: number;
    heightPx?: number;
    borderRadiusPx?: number;
  };
  c1StyleOverrides?: ThemeSxComponentStyleOverrides;
}

export type ThemeSxStyleValue = string | number;

export type ThemeSxComponentStyleOverrides = Record<string, Record<string, ThemeSxStyleValue>>;

export interface ThemeSxSample {
  componentName: string;
  styleValuesByKey: Map<string, ThemeSxStyleValue>;
}

export type ThemeSxSampleCollector = (sample: ThemeSxSample) => void;

// Theme sx extraction constants imported from ./constants.js
const THEME_SX_VISUAL_KEYS = new Set(["borderRadius", "bgcolor", "background", "borderColor", "border", "boxShadow", "color", "textTransform"]);
const THEME_SX_CANONICAL_VISUAL_KEYS = new Set([
  "borderRadius",
  "backgroundColor",
  "borderColor",
  "border",
  "boxShadow",
  "color",
  "textTransform"
]);
const THEME_SX_COLOR_KEYS = new Set(["backgroundColor", "borderColor", "color"]);
const THEME_SX_CANONICAL_KEY_ALIAS: Record<string, string> = {
  bgcolor: "backgroundColor",
  background: "backgroundColor"
};
const THEME_SX_TEXT_TRANSFORM_VALUES = new Set(["none", "capitalize", "uppercase", "lowercase"]);
export const THEME_COMPONENT_ORDER: readonly string[] = ["MuiButton", "MuiCard", "MuiTextField", "MuiChip", "MuiPaper", "MuiAppBar", "MuiDivider", "MuiAvatar"];

const parseSxLiteralStringValue = (value: string): string | undefined => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return trimmedValue;
  }
};

export const roundStableSxNumericValue = (value: number): number => {
  return Math.round(value * 1000) / 1000;
};

const toThemeSxCanonicalKey = (value: string): string => {
  return THEME_SX_CANONICAL_KEY_ALIAS[value] ?? value;
};

export const normalizeThemeSxValueForKey = ({
  key,
  value
}: {
  key: string;
  value: string | number | undefined;
}): ThemeSxStyleValue | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const canonicalKey = toThemeSxCanonicalKey(key);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return roundStableSxNumericValue(value);
  }

  const literalValue = parseSxLiteralStringValue(value);
  if (literalValue === undefined) {
    return undefined;
  }
  const trimmedLiteralValue = literalValue.trim();
  if (!trimmedLiteralValue) {
    return undefined;
  }

  if (THEME_SX_COLOR_KEYS.has(canonicalKey)) {
    return normalizeHexColor(trimmedLiteralValue);
  }
  if (canonicalKey === "textTransform") {
    return THEME_SX_TEXT_TRANSFORM_VALUES.has(trimmedLiteralValue) ? trimmedLiteralValue : undefined;
  }
  if (canonicalKey === "borderRadius") {
    if (/^-?\d+(\.\d+)?(px|rem|em|%)$/i.test(trimmedLiteralValue)) {
      return trimmedLiteralValue;
    }
    return undefined;
  }
  if (canonicalKey === "border") {
    return /(solid|dashed|dotted|double)/i.test(trimmedLiteralValue) ? trimmedLiteralValue : undefined;
  }
  if (canonicalKey === "boxShadow") {
    return trimmedLiteralValue;
  }
  return undefined;
};

const toThemeSxValueKey = (value: ThemeSxStyleValue): string => {
  return typeof value === "number" ? `n:${value}` : `s:${value}`;
};

export const collectThemeSxSampleFromEntries = ({
  context,
  componentName,
  entries
}: {
  context: RenderContext;
  componentName: string;
  entries: Array<[string, string | number | undefined]>;
}): void => {
  if (!context.themeSxSampleCollector) {
    return;
  }
  const styleValuesByKey = new Map<string, ThemeSxStyleValue>();
  for (const [key, value] of dedupeSxEntries(entries)) {
    if (!THEME_SX_VISUAL_KEYS.has(key)) {
      continue;
    }
    const canonicalKey = toThemeSxCanonicalKey(key);
    const normalizedValue = normalizeThemeSxValueForKey({
      key: canonicalKey,
      value
    });
    if (normalizedValue === undefined) {
      continue;
    }
    styleValuesByKey.set(canonicalKey, normalizedValue);
  }
  if (styleValuesByKey.size === 0) {
    return;
  }
  context.themeSxSampleCollector({
    componentName,
    styleValuesByKey
  });
};

const resolveThemeDefaultStyleValue = ({
  themeComponentDefaults,
  componentName,
  key
}: {
  themeComponentDefaults: ThemeComponentDefaults | undefined;
  componentName: string;
  key: string;
}): ThemeSxStyleValue | undefined => {
  if (key === "textTransform" && componentName === "MuiButton") {
    return "none";
  }
  switch (componentName) {
    case "MuiCard":
      if (key === "borderRadius" && themeComponentDefaults?.MuiCard?.borderRadiusPx !== undefined) {
        return `${themeComponentDefaults.MuiCard.borderRadiusPx}px`;
      }
      break;
    case "MuiChip":
      if (key === "borderRadius" && themeComponentDefaults?.MuiChip?.borderRadiusPx !== undefined) {
        return `${themeComponentDefaults.MuiChip.borderRadiusPx}px`;
      }
      break;
    case "MuiAppBar":
      if (key === "backgroundColor" && themeComponentDefaults?.MuiAppBar?.backgroundColor) {
        return themeComponentDefaults.MuiAppBar.backgroundColor;
      }
      break;
    case "MuiDivider":
      if (key === "borderColor" && themeComponentDefaults?.MuiDivider?.borderColor) {
        return themeComponentDefaults.MuiDivider.borderColor;
      }
      break;
    case "MuiAvatar":
      if (key === "width" && themeComponentDefaults?.MuiAvatar?.widthPx !== undefined) {
        return `${themeComponentDefaults.MuiAvatar.widthPx}px`;
      }
      if (key === "height" && themeComponentDefaults?.MuiAvatar?.heightPx !== undefined) {
        return `${themeComponentDefaults.MuiAvatar.heightPx}px`;
      }
      if (key === "borderRadius" && themeComponentDefaults?.MuiAvatar?.borderRadiusPx !== undefined) {
        return `${themeComponentDefaults.MuiAvatar.borderRadiusPx}px`;
      }
      break;
    default:
      break;
  }
  return themeComponentDefaults?.c1StyleOverrides?.[componentName]?.[key];
};

const matchesThemeDefaultSxValue = ({
  componentName,
  key,
  value,
  themeComponentDefaults
}: {
  componentName: string;
  key: string;
  value: string | number | undefined;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}): boolean => {
  const canonicalKey = toThemeSxCanonicalKey(key);
  const normalizedValue = normalizeThemeSxValueForKey({
    key: canonicalKey,
    value
  });
  if (normalizedValue === undefined) {
    return false;
  }
  const defaultValue = resolveThemeDefaultStyleValue({
    themeComponentDefaults,
    componentName,
    key: canonicalKey
  });
  if (defaultValue === undefined) {
    return false;
  }
  const normalizedDefaultValue = normalizeThemeSxValueForKey({
    key: canonicalKey,
    value: defaultValue
  });
  if (normalizedDefaultValue === undefined) {
    return false;
  }
  return normalizedDefaultValue === normalizedValue;
};

export const collectThemeDefaultMatchedSxKeys = ({
  context,
  componentName,
  entries
}: {
  context: RenderContext;
  componentName: string;
  entries: Array<[string, string | number | undefined]>;
}): Set<string> => {
  const matchedKeys = new Set<string>();
  for (const [key, value] of dedupeSxEntries(entries)) {
    if (!THEME_SX_VISUAL_KEYS.has(key)) {
      continue;
    }
    if (
      matchesThemeDefaultSxValue({
        componentName,
        key,
        value,
        themeComponentDefaults: context.themeComponentDefaults
      })
    ) {
      matchedKeys.add(key);
    }
  }
  return matchedKeys;
};

const createThemeDerivationRenderContext = ({
  screen,
  generationLocale,
  spacingBase,
  tokens,
  themeComponentDefaults,
  themeSxSampleCollector
}: {
  screen: ScreenIR;
  generationLocale: string;
  spacingBase: number;
  tokens?: DesignTokens;
  themeComponentDefaults?: ThemeComponentDefaults;
  themeSxSampleCollector?: ThemeSxSampleCollector;
}): RenderContext => {
  const baseContext: RenderContext = {
    screenId: `${screen.id}:theme-defaults`,
    screenName: `${screen.name}:theme-defaults`,
    currentFilePath: path.posix.join("src", "theme", "theme.ts"),
    generationLocale,
    formHandlingMode: "legacy_use_state",
    fields: [],
    accordions: [],
    tabs: [],
    dialogs: [],
    buttons: [],
    activeRenderElements: new Set<ScreenElementIR>(),
    renderNodeVisitCount: 0,
    interactiveDescendantCache: new Map<string, boolean>(),
    meaningfulTextDescendantCache: new Map<string, boolean>(),
    headingComponentByNodeId: new Map<string, HeadingComponent>(),
    typographyVariantByNodeId: new Map<string, DesignTokenTypographyVariantName>(),
    accessibilityWarnings: [],
    muiImports: new Set<string>(),
    iconImports: [],
    iconResolver: ICON_FALLBACK_BUILTIN_RESOLVER,
    imageAssetMap: {},
    routePathByScreenId: new Map<string, string>(),
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    spacingBase,
    mappingByNodeId: new Map<string, ComponentMappingRule>(),
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized: normalizeHexColor(screen.fillColor ?? tokens?.palette.background),
    ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
    ...(themeSxSampleCollector ? { themeSxSampleCollector } : {}),
    extractionInvocationByNodeId: new Map<string, PatternExtractionInvocation>()
  };
  if (tokens) {
    baseContext.tokens = tokens;
  }
  return baseContext;
};

const collectAppBarDefaultsCandidates = ({
  screen,
  generationLocale,
  spacingBase,
  tokens
}: {
  screen: ScreenIR;
  generationLocale: string;
  spacingBase: number;
  tokens?: DesignTokens;
}): ScreenElementIR[] => {
  const flattened = flattenElements(screen.children);
  const explicitAppBarCandidates = flattened.filter((element) => element.type === "appbar");
  const context = createThemeDerivationRenderContext({
    screen,
    generationLocale,
    spacingBase,
    ...(tokens ? { tokens } : {})
  });
  const rootParent: VirtualParent = {
    x: 0,
    y: 0,
    width: screen.width,
    height: screen.height,
    name: screen.name,
    fillColor: screen.fillColor,
    fillGradient: screen.fillGradient,
    layoutMode: screen.layoutMode
  };
  const topLevel = sortChildren(screen.children, screen.layoutMode, {
    generationLocale
  });
  const patternCandidates = topLevel.filter((element) => {
    return (
      detectNavigationBarPattern({
        element,
        depth: NAVIGATION_BAR_TOP_LEVEL_DEPTH,
        parent: rootParent,
        context
      }) === "appbar"
    );
  });
  const byId = new Map<string, ScreenElementIR>();
  for (const candidate of [...explicitAppBarCandidates, ...patternCandidates]) {
    byId.set(candidate.id, candidate);
  }
  return Array.from(byId.values());
};

const collectThemeSxSamplesFromScreens = ({
  screens,
  generationLocale,
  spacingBase,
  tokens,
  themeComponentDefaults
}: {
  screens: ScreenIR[];
  generationLocale: string;
  spacingBase: number;
  tokens?: DesignTokens;
  themeComponentDefaults?: ThemeComponentDefaults;
}): ThemeSxSample[] => {
  const samples: ThemeSxSample[] = [];
  for (const screen of screens) {
    const context = createThemeDerivationRenderContext({
      screen,
      generationLocale,
      spacingBase,
      ...(tokens ? { tokens } : {}),
      ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
      themeSxSampleCollector: (sample) => {
        samples.push(sample);
      }
    });
    const rootParent: ScreenElementIR = {
      id: `${screen.id}:theme-c1-root`,
      nodeType: "FRAME",
      type: "container",
      x: 0,
      y: 0,
      name: screen.name,
      layoutMode: screen.layoutMode,
      ...(typeof screen.width === "number" ? { width: screen.width } : {}),
      ...(typeof screen.height === "number" ? { height: screen.height } : {}),
      ...(screen.fillColor ? { fillColor: screen.fillColor } : {}),
      ...(screen.fillGradient ? { fillGradient: screen.fillGradient } : {}),
      children: screen.children
    };
    renderNodesIntoParent({
      nodes: screen.children,
      parent: rootParent,
      depth: 3,
      context,
      layoutMode: screen.layoutMode
    });
  }
  return samples;
};

const deriveThemeSxComponentStyleOverridesFromSamples = ({
  samples
}: {
  samples: ThemeSxSample[];
}): ThemeSxComponentStyleOverrides | undefined => {
  const componentStats = new Map<
    string,
    {
      sampleCount: number;
      valuesByKey: Map<
        string,
        Map<
          string,
          {
            value: ThemeSxStyleValue;
            count: number;
          }
        >
      >;
    }
  >();

  for (const sample of samples) {
    const componentName = sample.componentName.trim();
    if (!componentName) {
      continue;
    }
    let stats = componentStats.get(componentName);
    if (!stats) {
      stats = {
        sampleCount: 0,
        valuesByKey: new Map()
      };
      componentStats.set(componentName, stats);
    }
    stats.sampleCount += 1;

    for (const [key, value] of sample.styleValuesByKey.entries()) {
      if (!THEME_SX_CANONICAL_VISUAL_KEYS.has(key)) {
        continue;
      }
      let valuesByNormalizedValueKey = stats.valuesByKey.get(key);
      if (!valuesByNormalizedValueKey) {
        valuesByNormalizedValueKey = new Map();
        stats.valuesByKey.set(key, valuesByNormalizedValueKey);
      }
      const normalizedValueKey = toThemeSxValueKey(value);
      const existing = valuesByNormalizedValueKey.get(normalizedValueKey);
      if (!existing) {
        valuesByNormalizedValueKey.set(normalizedValueKey, {
          value,
          count: 1
        });
        continue;
      }
      existing.count += 1;
    }
  }

  const overrides: ThemeSxComponentStyleOverrides = {};
  const orderedComponentNames = Array.from(componentStats.keys()).sort((left, right) => left.localeCompare(right));
  for (const componentName of orderedComponentNames) {
    const stats = componentStats.get(componentName);
    if (!stats || stats.sampleCount < THEME_SX_MIN_SAMPLES) {
      continue;
    }

    const resolvedEntries: Array<[string, ThemeSxStyleValue]> = [];
    const orderedKeys = Array.from(stats.valuesByKey.keys()).sort((left, right) => left.localeCompare(right));
    for (const key of orderedKeys) {
      const valueCandidates = Array.from(stats.valuesByKey.get(key)?.values() ?? []).sort((left, right) => {
        return right.count - left.count || toThemeSxValueKey(left.value).localeCompare(toThemeSxValueKey(right.value));
      });
      const winner = valueCandidates[0];
      if (!winner) {
        continue;
      }
      if (winner.count / stats.sampleCount < THEME_SX_EXTRACTION_THRESHOLD) {
        continue;
      }
      resolvedEntries.push([key, winner.value]);
    }

    if (resolvedEntries.length > 0) {
      overrides[componentName] = Object.fromEntries(resolvedEntries);
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const deriveThemeComponentDefaultsFromScreens = ({
  screens,
  generationLocale,
  spacingBase,
  tokens
}: {
  screens: ScreenIR[];
  generationLocale: string;
  spacingBase: number;
  tokens?: DesignTokens;
}): ThemeComponentDefaults | undefined => {
  if (screens.length === 0) {
    return undefined;
  }
  const allElements = screens.flatMap((screen) => flattenElements(screen.children));

  const cardNodes = allElements.filter((element) => element.type === "card");
  const cardBorderRadius = resolveDeterministicIntegerSample({
    values: cardNodes.map((node) => node.cornerRadius),
    min: 1,
    max: 128
  });
  const cardElevation = resolveDeterministicIntegerSample({
    values: cardNodes.map((node) => {
      const elevation = normalizeElevationForSx(node.elevation);
      return typeof elevation === "number" && elevation > 0 ? elevation : undefined;
    }),
    min: 1,
    max: 24
  });

  const textFieldBorderRadius = resolveDeterministicIntegerSample({
    values: allElements
      .filter((element) => element.type === "input")
      .map((element) => {
        const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
        const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
        return outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius;
      }),
    min: 1,
    max: 128
  });

  const chipNodes = allElements.filter((element) => element.type === "chip");
  const chipBorderRadius = resolveDeterministicIntegerSample({
    values: chipNodes.map((node) => node.cornerRadius),
    min: 1,
    max: 128
  });
  const chipSizeCounts = new Map<"small" | "medium", number>();
  for (const chipNode of chipNodes) {
    const mappedSize = toChipSize(chipNode.variantMapping?.muiProps.size);
    const inferredSize = mappedSize ?? inferChipSizeFromHeight(chipNode.height);
    if (!inferredSize) {
      continue;
    }
    chipSizeCounts.set(inferredSize, (chipSizeCounts.get(inferredSize) ?? 0) + 1);
  }
  const chipSize = Array.from(chipSizeCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value)[0];

  const paperNodes = allElements.filter((element) => element.type === "paper");
  const paperElevation = resolveDeterministicIntegerSample({
    values: paperNodes.map((node) => {
      const elevation = normalizeElevationForSx(node.elevation);
      return typeof elevation === "number" && elevation > 0 ? elevation : undefined;
    }),
    min: 1,
    max: 24
  });

  const appBarBackgroundColor = resolveDeterministicColorSample(
    screens
      .flatMap((screen) =>
        collectAppBarDefaultsCandidates({
          screen,
          generationLocale,
          spacingBase,
          ...(tokens ? { tokens } : {})
        })
      )
      .map((node) => node.fillColor)
  );

  const dividerColor = resolveDeterministicColorSample(
    allElements
      .filter((element) => {
        if (element.type === "divider") {
          return true;
        }
        if ((element.children?.length ?? 0) > 0) {
          return false;
        }
        const roundedHeight = toRoundedIntegerInRange({
          value: element.height,
          min: 1,
          max: 2
        });
        return roundedHeight !== undefined && Boolean(element.fillColor);
      })
      .map((node) => node.fillColor ?? node.strokeColor)
  );

  const avatarNodes = allElements.filter((element) => element.type === "avatar");
  const avatarWidth = resolveDeterministicIntegerSample({
    values: avatarNodes.map((node) => node.width),
    min: 12,
    max: 256
  });
  const avatarHeight = resolveDeterministicIntegerSample({
    values: avatarNodes.map((node) => node.height),
    min: 12,
    max: 256
  });
  const avatarBorderRadius = resolveDeterministicIntegerSample({
    values: avatarNodes.map((node) => node.cornerRadius),
    min: 1,
    max: 256
  });

  const defaults: ThemeComponentDefaults = {};
  if (cardBorderRadius !== undefined || cardElevation !== undefined) {
    defaults.MuiCard = {
      ...(cardBorderRadius !== undefined ? { borderRadiusPx: cardBorderRadius } : {}),
      ...(cardElevation !== undefined ? { elevation: cardElevation } : {})
    };
  }
  if (textFieldBorderRadius !== undefined) {
    defaults.MuiTextField = {
      outlinedInputBorderRadiusPx: textFieldBorderRadius
    };
  }
  if (chipBorderRadius !== undefined || chipSize !== undefined) {
    defaults.MuiChip = {
      ...(chipBorderRadius !== undefined ? { borderRadiusPx: chipBorderRadius } : {}),
      ...(chipSize !== undefined ? { size: chipSize } : {})
    };
  }
  if (paperElevation !== undefined) {
    defaults.MuiPaper = {
      elevation: paperElevation
    };
  }
  if (appBarBackgroundColor) {
    defaults.MuiAppBar = {
      backgroundColor: appBarBackgroundColor
    };
  }
  if (dividerColor) {
    defaults.MuiDivider = {
      borderColor: dividerColor
    };
  }
  if (avatarWidth !== undefined || avatarHeight !== undefined || avatarBorderRadius !== undefined) {
    defaults.MuiAvatar = {
      ...(avatarWidth !== undefined ? { widthPx: avatarWidth } : {}),
      ...(avatarHeight !== undefined ? { heightPx: avatarHeight } : {}),
      ...(avatarBorderRadius !== undefined ? { borderRadiusPx: avatarBorderRadius } : {})
    };
  }

  const c1StyleOverrides = deriveThemeSxComponentStyleOverridesFromSamples({
    samples: collectThemeSxSamplesFromScreens({
      screens,
      generationLocale,
      spacingBase,
      ...(tokens ? { tokens } : {}),
      ...(Object.keys(defaults).length > 0 ? { themeComponentDefaults: defaults } : {})
    })
  });
  if (c1StyleOverrides) {
    defaults.c1StyleOverrides = c1StyleOverrides;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
};

export const deriveThemeComponentDefaultsFromIr = ({
  ir,
  generationLocale = DEFAULT_GENERATION_LOCALE
}: {
  ir: DesignIR;
  generationLocale?: string;
}): ThemeComponentDefaults | undefined => {
  return deriveThemeComponentDefaultsFromScreens({
    screens: ir.screens,
    generationLocale,
    spacingBase: normalizeSpacingBase(ir.tokens.spacingBase),
    tokens: ir.tokens
  });
};

export const createDeterministicThemeFile = (ir: DesignIR, generationLocale?: string): GeneratedFile => {
  return fallbackThemeFile(
    ir,
    deriveThemeComponentDefaultsFromIr({
      ir,
      ...(generationLocale ? { generationLocale } : {})
    }),
    generationLocale
  );
};
