import { resolveCustomerProfileBrandMapping, type ResolvedCustomerProfile } from "../customer-profile.js";
import type { StorybookPublicThemesArtifact, StorybookPublicTokensArtifact } from "./types.js";

type JsonRecord = Record<string, unknown>;
type ThemeComponentValue = boolean | number | string;

export interface ResolvedStorybookPaletteColor {
  main: string;
  contrastText?: string;
}

export interface ResolvedStorybookTextPalette {
  primary: string;
  secondary?: string;
  disabled?: string;
}

export interface ResolvedStorybookBackgroundPalette {
  default: string;
  paper: string;
}

export interface ResolvedStorybookActionPalette {
  active?: string;
  hover?: string;
  selected?: string;
  disabled?: string;
  disabledBackground?: string;
  focus?: string;
}

export interface ResolvedStorybookPalette {
  primary: ResolvedStorybookPaletteColor;
  secondary?: ResolvedStorybookPaletteColor;
  success?: ResolvedStorybookPaletteColor;
  warning?: ResolvedStorybookPaletteColor;
  error?: ResolvedStorybookPaletteColor;
  info?: ResolvedStorybookPaletteColor;
  text: ResolvedStorybookTextPalette;
  background: ResolvedStorybookBackgroundPalette;
  divider?: string;
  action?: ResolvedStorybookActionPalette;
}

export interface ResolvedStorybookTypographyStyle {
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textTransform?: string;
}

export interface ResolvedStorybookThemeComponent {
  defaultProps?: Record<string, ThemeComponentValue>;
  rootStyleOverrides?: Record<string, ThemeComponentValue>;
}

export interface ResolvedStorybookThemeScheme {
  themeId: string;
  palette: ResolvedStorybookPalette;
  spacingBase: number;
  borderRadius: number;
  typography: {
    fontFamily: string;
    base: ResolvedStorybookTypographyStyle;
    variants: Record<string, ResolvedStorybookTypographyStyle>;
  };
  components: Record<string, ResolvedStorybookThemeComponent>;
}

export interface ResolvedStorybookTheme {
  customerBrandId: string;
  brandMappingId: string;
  includeThemeModeToggle: boolean;
  light: ResolvedStorybookThemeScheme;
  dark?: ResolvedStorybookThemeScheme;
  tokensDocument: {
    customerBrandId: string;
    brandMappingId: string;
    includeThemeModeToggle: boolean;
    light: ResolvedStorybookThemeScheme;
    dark?: ResolvedStorybookThemeScheme;
  };
}

export interface StorybookThemeResolverError extends Error {
  code: string;
  details?: Record<string, unknown>;
}

interface CollectedTokenEntry {
  path: string[];
  tokenType: string;
  value: unknown;
}

const isPlainRecord = (value: unknown): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isTokenNode = (value: unknown): value is { $type: string; $value: unknown } => {
  return isPlainRecord(value) && typeof value.$type === "string" && "$value" in value;
};

const createResolverError = ({
  code,
  message,
  details
}: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): StorybookThemeResolverError => {
  const error = new Error(message) as StorybookThemeResolverError;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
};

const toPathString = (pathSegments: string[]): string => {
  return pathSegments.join(".");
};

const toComponentName = (segment: string): string => {
  const parts = segment
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return segment;
  }
  return parts
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
};

const toCamelCase = (segment: string): string => {
  const [first, ...rest] = segment.split("-").filter((part) => part.length > 0);
  if (!first) {
    return segment;
  }
  return `${first}${rest.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("")}`;
};

const toCssColorString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!isPlainRecord(value)) {
    return undefined;
  }
  if (value.colorSpace !== "srgb" || !Array.isArray(value.components) || value.components.length < 3) {
    return undefined;
  }
  const channels = value.components
    .slice(0, 3)
    .map((component) => (typeof component === "number" && Number.isFinite(component) ? component : undefined));
  if (channels.some((component) => component === undefined)) {
    return undefined;
  }
  const alpha =
    typeof value.alpha === "number" && Number.isFinite(value.alpha)
      ? Math.max(0, Math.min(1, value.alpha))
      : undefined;
  const toHexChannel = (component: number): string =>
    Math.round(Math.max(0, Math.min(1, component)) * 255)
      .toString(16)
      .padStart(2, "0");
  const hex = `#${channels.map((component) => toHexChannel(component ?? 0)).join("")}`;
  if (alpha === undefined || alpha >= 1) {
    return hex;
  }
  return `${hex}${toHexChannel(alpha)}`;
};

const toPxNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (!isPlainRecord(value) || value.unit !== "px" || typeof value.value !== "number" || !Number.isFinite(value.value)) {
    return undefined;
  }
  return value.value;
};

const toThemeComponentValue = ({
  tokenClass,
  value
}: {
  tokenClass: string;
  value: unknown;
}): ThemeComponentValue | undefined => {
  if (tokenClass === "color") {
    return toCssColorString(value);
  }
  if (tokenClass === "spacing" || tokenClass === "dimension" || tokenClass === "radius") {
    const pxNumber = toPxNumber(value);
    return pxNumber === undefined ? undefined : `${pxNumber}px`;
  }
  if (tokenClass === "z-index" || typeof value === "number" || typeof value === "boolean") {
    return value as boolean | number;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

const toFontFamilyString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const families = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (families.length === 0) {
    return undefined;
  }
  return families.join(", ");
};

const toTypographyStyle = (value: unknown): ResolvedStorybookTypographyStyle | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const fontFamily = toFontFamilyString(value.fontFamily);
  const fontSizePx = toPxNumber(value.fontSize);
  const fontWeight =
    typeof value.fontWeight === "number" || typeof value.fontWeight === "string" ? value.fontWeight : undefined;
  const lineHeight =
    typeof value.lineHeight === "number" || typeof value.lineHeight === "string" ? value.lineHeight : undefined;
  const letterSpacing =
    typeof value.letterSpacing === "number" || typeof value.letterSpacing === "string" ? value.letterSpacing : undefined;
  const textTransform =
    typeof value.textTransform === "string" && value.textTransform.trim().length > 0 ? value.textTransform.trim() : undefined;
  const style: ResolvedStorybookTypographyStyle = {
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSizePx !== undefined ? { fontSizePx } : {}),
    ...(fontWeight !== undefined ? { fontWeight } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(letterSpacing !== undefined ? { letterSpacing } : {}),
    ...(textTransform ? { textTransform } : {})
  };
  return Object.keys(style).length > 0 ? style : undefined;
};

const getValueAtPath = ({
  root,
  pathSegments
}: {
  root: unknown;
  pathSegments: string[];
}): unknown => {
  let cursor = root;
  for (const segment of pathSegments) {
    if (!isPlainRecord(cursor) || !(segment in cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
};

const parseAliasPath = (value: string): string[] | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }
  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) {
    return undefined;
  }
  return body.split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
};

const resolveTokenValue = ({
  tokensArtifact,
  value,
  aliasStack
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  value: unknown;
  aliasStack: string[];
}): unknown => {
  if (typeof value === "string") {
    const aliasPath = parseAliasPath(value);
    if (!aliasPath) {
      return value;
    }
    const aliasPathString = aliasPath.join(".");
    if (aliasStack.includes(aliasPathString)) {
      throw createResolverError({
        code: "E_STORYBOOK_THEME_ALIAS_CYCLE",
        message: `Storybook theme resolution detected a cyclic alias '${aliasPathString}'.`,
        details: {
          aliasPath: aliasPathString,
          aliasStack
        }
      });
    }
    const referencedNode = getValueAtPath({
      root: tokensArtifact,
      pathSegments: aliasPath
    });
    if (referencedNode === undefined) {
      throw createResolverError({
        code: "E_STORYBOOK_THEME_ALIAS_UNRESOLVED",
        message: `Storybook theme alias '${aliasPathString}' could not be resolved from storybook.tokens.`,
        details: {
          aliasPath: aliasPathString
        }
      });
    }
    return resolveTokenValue({
      tokensArtifact,
      value: referencedNode,
      aliasStack: [...aliasStack, aliasPathString]
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveTokenValue({
        tokensArtifact,
        value: entry,
        aliasStack
      })
    );
  }
  if (isTokenNode(value)) {
    return resolveTokenValue({
      tokensArtifact,
      value: value.$value,
      aliasStack
    });
  }
  if (isPlainRecord(value)) {
    const resolvedEntries: JsonRecord = {};
    for (const [key, entryValue] of Object.entries(value)) {
      resolvedEntries[key] = resolveTokenValue({
        tokensArtifact,
        value: entryValue,
        aliasStack
      });
    }
    return resolvedEntries;
  }
  return value;
};

const getResolvedTokenValue = ({
  tokensArtifact,
  pathSegments
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  pathSegments: string[];
}): unknown => {
  const node = getValueAtPath({
    root: tokensArtifact,
    pathSegments
  });
  if (node === undefined) {
    return undefined;
  }
  return resolveTokenValue({
    tokensArtifact,
    value: node,
    aliasStack: [pathSegments.join(".")]
  });
};

const requireResolvedTokenValue = ({
  tokensArtifact,
  pathSegments,
  description
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  pathSegments: string[];
  description: string;
}): unknown => {
  const resolved = getResolvedTokenValue({
    tokensArtifact,
    pathSegments
  });
  if (resolved === undefined) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_REQUIRED_TOKEN_MISSING",
      message: `Storybook theme resolution requires ${description} at '${toPathString(pathSegments)}'.`,
      details: {
        description,
        tokenPath: pathSegments
      }
    });
  }
  return resolved;
};

const collectThemeTokenEntries = ({
  tokensArtifact,
  themeId
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  themeId: string;
}): CollectedTokenEntry[] => {
  const themeRoot = getValueAtPath({
    root: tokensArtifact,
    pathSegments: ["theme", themeId]
  });
  if (!isPlainRecord(themeRoot)) {
    return [];
  }
  const collected: CollectedTokenEntry[] = [];
  const visit = ({
    node,
    pathPrefix
  }: {
    node: unknown;
    pathPrefix: string[];
  }): void => {
    if (isTokenNode(node)) {
      collected.push({
        path: pathPrefix,
        tokenType: node.$type,
        value: resolveTokenValue({
          tokensArtifact,
          value: node,
          aliasStack: [toPathString(["theme", themeId, ...pathPrefix])]
        })
      });
      return;
    }
    if (!isPlainRecord(node)) {
      return;
    }
    for (const [key, entryValue] of Object.entries(node)) {
      if (key.startsWith("$")) {
        continue;
      }
      visit({
        node: entryValue,
        pathPrefix: [...pathPrefix, key]
      });
    }
  };
  visit({
    node: themeRoot,
    pathPrefix: []
  });
  return collected.sort((left, right) => left.path.join(".").localeCompare(right.path.join(".")));
};

const resolvePaletteColor = ({
  tokensArtifact,
  themeId,
  paletteKey
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  themeId: string;
  paletteKey: string;
}): ResolvedStorybookPaletteColor | undefined => {
  const main = getResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "color", paletteKey, "main"]
  });
  const mainColor = toCssColorString(main);
  if (!mainColor) {
    return undefined;
  }
  const contrastText = toCssColorString(
    getResolvedTokenValue({
      tokensArtifact,
      pathSegments: ["theme", themeId, "color", paletteKey, "contrast-text"]
    })
  );
  return {
    main: mainColor,
    ...(contrastText ? { contrastText } : {})
  };
};

const resolveThemeScheme = ({
  tokensArtifact,
  themeId
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  themeId: string;
}): ResolvedStorybookThemeScheme => {
  const primaryToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "color", "primary", "main"],
    description: "palette.primary.main"
  });
  const textPrimaryToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "color", "text", "primary"],
    description: "palette.text.primary"
  });
  const backgroundDefaultToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "color", "background", "default"],
    description: "palette.background.default"
  });
  const backgroundPaperToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "color", "background", "paper"],
    description: "palette.background.paper"
  });
  const spacingBaseToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "spacing", "base"],
    description: "spacing.base"
  });
  const borderRadiusToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "radius", "shape", "border-radius"],
    description: "shape.borderRadius"
  });
  const baseTypographyToken = requireResolvedTokenValue({
    tokensArtifact,
    pathSegments: ["theme", themeId, "typography", "base"],
    description: "typography.base"
  });

  const primary = toCssColorString(primaryToken);
  const textPrimary = toCssColorString(textPrimaryToken);
  const backgroundDefault = toCssColorString(backgroundDefaultToken);
  const backgroundPaper = toCssColorString(backgroundPaperToken);
  const spacingBase = toPxNumber(spacingBaseToken);
  const borderRadius = toPxNumber(borderRadiusToken);
  const baseTypography = toTypographyStyle(baseTypographyToken);

  if (!primary || !textPrimary || !backgroundDefault || !backgroundPaper || spacingBase === undefined || borderRadius === undefined || !baseTypography?.fontFamily) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_REQUIRED_TOKEN_INVALID",
      message: `Storybook theme '${themeId}' is missing one or more required resolved theme surfaces.`,
      details: {
        themeId,
        hasPrimary: Boolean(primary),
        hasTextPrimary: Boolean(textPrimary),
        hasBackgroundDefault: Boolean(backgroundDefault),
        hasBackgroundPaper: Boolean(backgroundPaper),
        hasSpacingBase: spacingBase !== undefined,
        hasBorderRadius: borderRadius !== undefined,
        hasTypographyBaseFontFamily: Boolean(baseTypography?.fontFamily)
      }
    });
  }

  const variants: Record<string, ResolvedStorybookTypographyStyle> = {};
  const componentAccumulator = new Map<string, ResolvedStorybookThemeComponent>();
  const tokenEntries = collectThemeTokenEntries({
    tokensArtifact,
    themeId
  });

  for (const entry of tokenEntries) {
    const tokenClass = entry.path[0];
    if (!tokenClass) {
      continue;
    }
    if (tokenClass === "typography" && entry.path[1] && entry.path[1] !== "base" && entry.path[1] !== "components") {
      const style = toTypographyStyle(entry.value);
      if (style) {
        variants[entry.path[1]] = style;
      }
      continue;
    }
    if (entry.path[1] !== "components" || !entry.path[2]) {
      continue;
    }
    const componentName = toComponentName(entry.path[2]);
    const current = componentAccumulator.get(componentName) ?? {};
    const componentPath = entry.path.slice(3);
    if (componentPath[0] === "default-props" && componentPath[1] && componentPath.length === 2) {
      const propName = toCamelCase(componentPath[1]);
      const propValue = toThemeComponentValue({
        tokenClass,
        value: entry.value
      });
      if (propValue !== undefined) {
        current.defaultProps = {
          ...(current.defaultProps ?? {}),
          [propName]: propValue
        };
      }
      componentAccumulator.set(componentName, current);
      continue;
    }
    if (componentPath[0] !== "style-overrides" || componentPath[1] !== "root") {
      continue;
    }
    if (tokenClass === "typography" && componentPath.length === 2) {
      const typographyStyle = toTypographyStyle(entry.value);
      if (typographyStyle) {
        current.rootStyleOverrides = {
          ...(current.rootStyleOverrides ?? {}),
          ...(typographyStyle.fontFamily ? { fontFamily: typographyStyle.fontFamily } : {}),
          ...(typographyStyle.fontSizePx !== undefined ? { fontSize: `${typographyStyle.fontSizePx}px` } : {}),
          ...(typographyStyle.fontWeight !== undefined ? { fontWeight: typographyStyle.fontWeight } : {}),
          ...(typographyStyle.lineHeight !== undefined ? { lineHeight: typographyStyle.lineHeight } : {}),
          ...(typographyStyle.letterSpacing !== undefined ? { letterSpacing: typographyStyle.letterSpacing } : {}),
          ...(typographyStyle.textTransform ? { textTransform: typographyStyle.textTransform } : {})
        };
      }
      componentAccumulator.set(componentName, current);
      continue;
    }
    if (componentPath.length === 3 && componentPath[2]) {
      const cssPropertyName = toCamelCase(componentPath[2]);
      const styleValue = toThemeComponentValue({
        tokenClass,
        value: entry.value
      });
      if (styleValue !== undefined) {
        current.rootStyleOverrides = {
          ...(current.rootStyleOverrides ?? {}),
          [cssPropertyName]: styleValue
        };
      }
      componentAccumulator.set(componentName, current);
    }
  }

  const primaryPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "primary" });
  const secondaryPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "secondary" });
  const successPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "success" });
  const warningPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "warning" });
  const errorPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "error" });
  const infoPalette = resolvePaletteColor({ tokensArtifact, themeId, paletteKey: "info" });
  const textSecondary = toCssColorString(
    getResolvedTokenValue({
      tokensArtifact,
      pathSegments: ["theme", themeId, "color", "text", "secondary"]
    })
  );
  const textDisabled = toCssColorString(
    getResolvedTokenValue({
      tokensArtifact,
      pathSegments: ["theme", themeId, "color", "text", "disabled"]
    })
  );
  const divider = toCssColorString(
    getResolvedTokenValue({
      tokensArtifact,
      pathSegments: ["theme", themeId, "color", "divider"]
    })
  );
  const palette: ResolvedStorybookPalette = {
    primary: {
      main: primary,
      ...(primaryPalette?.contrastText ? { contrastText: primaryPalette.contrastText } : {})
    },
    text: {
      primary: textPrimary,
      ...(textSecondary ? { secondary: textSecondary } : {}),
      ...(textDisabled ? { disabled: textDisabled } : {})
    },
    background: {
      default: backgroundDefault,
      paper: backgroundPaper
    },
    ...(secondaryPalette ? { secondary: secondaryPalette } : {}),
    ...(successPalette ? { success: successPalette } : {}),
    ...(warningPalette ? { warning: warningPalette } : {}),
    ...(errorPalette ? { error: errorPalette } : {}),
    ...(infoPalette ? { info: infoPalette } : {}),
    ...(divider ? { divider } : {}),
    ...(() => {
      const active = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "active"]
        })
      );
      const hover = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "hover"]
        })
      );
      const selected = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "selected"]
        })
      );
      const disabled = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "disabled"]
        })
      );
      const disabledBackground = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "disabled-background"]
        })
      );
      const focus = toCssColorString(
        getResolvedTokenValue({
          tokensArtifact,
          pathSegments: ["theme", themeId, "color", "action", "focus"]
        })
      );
      const action: ResolvedStorybookActionPalette = {
        ...(active ? { active } : {}),
        ...(hover ? { hover } : {}),
        ...(selected ? { selected } : {}),
        ...(disabled ? { disabled } : {}),
        ...(disabledBackground ? { disabledBackground } : {}),
        ...(focus ? { focus } : {})
      };
      return Object.keys(action).length > 0 ? { action } : {};
    })()
  };

  const components = Object.fromEntries(
    [...componentAccumulator.entries()]
      .filter(([, component]) => Boolean(component.defaultProps) || Boolean(component.rootStyleOverrides))
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    themeId,
    palette,
    spacingBase,
    borderRadius,
    typography: {
      fontFamily: baseTypography.fontFamily,
      base: baseTypography,
      variants
    },
    components
  };
};

const ensureThemeSelectionExists = ({
  themesArtifact,
  themeId
}: {
  themesArtifact: StorybookPublicThemesArtifact;
  themeId: string;
}): void => {
  if (themesArtifact.sets[themeId]) {
    return;
  }
  throw createResolverError({
    code: "E_STORYBOOK_THEME_SET_MISSING",
    message: `Storybook theme '${themeId}' is not present in storybook.themes.`,
    details: {
      themeId,
      availableThemeIds: Object.keys(themesArtifact.sets).sort((left, right) => left.localeCompare(right))
    }
  });
};

export const resolveStorybookTheme = ({
  customerBrandId,
  customerProfile,
  tokensArtifact,
  themesArtifact
}: {
  customerBrandId?: string;
  customerProfile?: ResolvedCustomerProfile;
  tokensArtifact: StorybookPublicTokensArtifact;
  themesArtifact: StorybookPublicThemesArtifact;
}): ResolvedStorybookTheme => {
  const normalizedCustomerBrandId = customerBrandId?.trim();
  if (!normalizedCustomerBrandId) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_CUSTOMER_BRAND_REQUIRED",
      message: "Storybook-first theme resolution requires customerBrandId."
    });
  }
  if (!customerProfile) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_CUSTOMER_PROFILE_REQUIRED",
      message: "Storybook-first theme resolution requires a resolved customer profile."
    });
  }

  const brandMapping =
    customerProfile.brandMappings.find((candidate) => candidate.id === normalizedCustomerBrandId) ??
    resolveCustomerProfileBrandMapping({
      profile: customerProfile,
      candidate: normalizedCustomerBrandId
    });
  if (!brandMapping) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_BRAND_MAPPING_MISSING",
      message: `Customer profile does not define a brand mapping for customerBrandId '${normalizedCustomerBrandId}'.`,
      details: {
        customerBrandId: normalizedCustomerBrandId,
        availableBrandMappings: customerProfile.brandMappings.map((mapping) => mapping.id)
      }
    });
  }

  const lightThemeId = brandMapping.storybookThemes.light.trim();
  const darkThemeId = brandMapping.storybookThemes.dark?.trim();
  if (!lightThemeId) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_LIGHT_ID_MISSING",
      message: `Customer profile brand mapping '${brandMapping.id}' is missing storybookThemes.light.`
    });
  }

  ensureThemeSelectionExists({
    themesArtifact,
    themeId: lightThemeId
  });
  if (darkThemeId) {
    ensureThemeSelectionExists({
      themesArtifact,
      themeId: darkThemeId
    });
  }

  if (!isPlainRecord(tokensArtifact.theme) || !isPlainRecord(tokensArtifact.theme[lightThemeId])) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_TOKEN_SET_MISSING",
      message: `Storybook tokens do not expose the selected light theme '${lightThemeId}'.`,
      details: {
        themeId: lightThemeId
      }
    });
  }
  if (darkThemeId && !isPlainRecord(tokensArtifact.theme[darkThemeId])) {
    throw createResolverError({
      code: "E_STORYBOOK_THEME_TOKEN_SET_MISSING",
      message: `Storybook tokens do not expose the selected dark theme '${darkThemeId}'.`,
      details: {
        themeId: darkThemeId
      }
    });
  }

  const light = resolveThemeScheme({
    tokensArtifact,
    themeId: lightThemeId
  });
  const dark = darkThemeId
    ? resolveThemeScheme({
        tokensArtifact,
        themeId: darkThemeId
      })
    : undefined;

  const resolved: ResolvedStorybookTheme = {
    customerBrandId: normalizedCustomerBrandId,
    brandMappingId: brandMapping.id,
    includeThemeModeToggle: Boolean(dark),
    light,
    ...(dark ? { dark } : {}),
    tokensDocument: {
      customerBrandId: normalizedCustomerBrandId,
      brandMappingId: brandMapping.id,
      includeThemeModeToggle: Boolean(dark),
      light,
      ...(dark ? { dark } : {})
    }
  };

  return resolved;
};
