import type {
  DesignTokenTypographyScale,
  DesignTokenTypographyVariant,
  DesignTokenTypographyVariantName
} from "./types.js";

export const DESIGN_TYPOGRAPHY_VARIANTS: readonly DesignTokenTypographyVariantName[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "subtitle1",
  "subtitle2",
  "body1",
  "body2",
  "button",
  "caption",
  "overline"
] as const satisfies readonly DesignTokenTypographyVariantName[];

export const HEADING_TYPOGRAPHY_VARIANTS: readonly DesignTokenTypographyVariantName[] = ["h1", "h2", "h3", "h4", "h5", "h6"];
export const BODY_TYPOGRAPHY_VARIANTS: readonly DesignTokenTypographyVariantName[] = [
  "subtitle1",
  "subtitle2",
  "body1",
  "body2",
  "button",
  "caption",
  "overline"
] as const;

/**
 * Mapping patterns from Figma text style names to MUI typography variant names.
 * Each entry is [regex, variantName]. First match wins.
 * Patterns are matched against the full lowercase style name.
 */
const FIGMA_STYLE_TO_VARIANT_PATTERNS: ReadonlyArray<readonly [RegExp, DesignTokenTypographyVariantName]> = [
  [/\bh1\b|heading[\s/._-]*1/i, "h1"],
  [/\bh2\b|heading[\s/._-]*2/i, "h2"],
  [/\bh3\b|heading[\s/._-]*3/i, "h3"],
  [/\bh4\b|heading[\s/._-]*4/i, "h4"],
  [/\bh5\b|heading[\s/._-]*5/i, "h5"],
  [/\bh6\b|heading[\s/._-]*6/i, "h6"],
  [/\bsubtitle[\s/._-]*1\b/i, "subtitle1"],
  [/\bsubtitle[\s/._-]*2\b/i, "subtitle2"],
  [/\bbody[\s/._-]*1\b|body[\s/._-]*(?:regular|default|normal|medium)\b/i, "body1"],
  [/\bbody[\s/._-]*2\b|body[\s/._-]*(?:small|secondary)\b/i, "body2"],
  [/\bbutton\b|btn\b/i, "button"],
  [/\bcaption\b/i, "caption"],
  [/\boverline\b/i, "overline"]
] as const;

export interface FigmaTextStyleEntry {
  readonly styleName: string;
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly lineHeightPx: number;
  readonly fontFamily?: string;
  readonly letterSpacingPx?: number;
}

export const matchFigmaStyleToVariant = (
  styleName: string
): DesignTokenTypographyVariantName | undefined => {
  const normalized = styleName.toLowerCase();
  for (const [pattern, variantName] of FIGMA_STYLE_TO_VARIANT_PATTERNS) {
    if (pattern.test(normalized)) {
      return variantName;
    }
  }
  return undefined;
};

export const buildTypographyScaleFromFigmaStyles = (
  styleEntries: readonly FigmaTextStyleEntry[]
): Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>> => {
  const partialScale: Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>> = {};

  for (const entry of styleEntries) {
    const variantName = matchFigmaStyleToVariant(entry.styleName);
    if (!variantName) {
      continue;
    }
    if (partialScale[variantName] !== undefined) {
      continue;
    }
    const letterSpacingEm =
      typeof entry.letterSpacingPx === "number" && Number.isFinite(entry.letterSpacingPx) && entry.fontSizePx > 0
        ? entry.letterSpacingPx / entry.fontSizePx
        : undefined;

    partialScale[variantName] = {
      fontSizePx: entry.fontSizePx,
      fontWeight: entry.fontWeight,
      lineHeightPx: entry.lineHeightPx,
      ...(entry.fontFamily?.trim() ? { fontFamily: entry.fontFamily.trim() } : {}),
      ...(typeof letterSpacingEm === "number" ? { letterSpacingEm } : {})
    };
  }

  return partialScale;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const roundNumber = (value: number, precision = 3): number => {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
};

const toTypographyVariant = ({
  fontSizePx,
  fontWeight,
  lineHeightPx,
  fontFamily,
  letterSpacingEm,
  textTransform
}: DesignTokenTypographyVariant): DesignTokenTypographyVariant => {
  const resolvedFontSizePx = Math.max(10, Math.round(fontSizePx));
  const resolvedLineHeightPx = Math.max(resolvedFontSizePx, Math.round(lineHeightPx));
  const resolvedFontWeight = clamp(Math.round(fontWeight / 100) * 100, 100, 900);

  return {
    fontSizePx: resolvedFontSizePx,
    fontWeight: resolvedFontWeight,
    lineHeightPx: resolvedLineHeightPx,
    ...(fontFamily?.trim() ? { fontFamily: fontFamily.trim() } : {}),
    ...(typeof letterSpacingEm === "number" && Number.isFinite(letterSpacingEm)
      ? { letterSpacingEm: roundNumber(letterSpacingEm, 4) }
      : {}),
    ...(textTransform ? { textTransform } : {})
  };
};

export const buildTypographyScaleFromAliases = ({
  fontFamily,
  headingSize,
  bodySize
}: {
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}): DesignTokenTypographyScale => {
  const resolvedHeadingSize = Math.max(Math.round(headingSize), Math.round(bodySize) + 2, 18);
  const resolvedBodySize = Math.max(10, Math.round(bodySize));
  const h2Size = Math.max(resolvedBodySize + 8, resolvedHeadingSize - 4);
  const h3Size = Math.max(resolvedBodySize + 6, h2Size - 2);
  const h4Size = Math.max(resolvedBodySize + 4, h3Size - 2);
  const h5Size = Math.max(resolvedBodySize + 2, h4Size - 2);
  const h6Size = Math.max(resolvedBodySize + 1, h5Size - 1);
  const subtitle1Size = Math.max(resolvedBodySize + 1, h6Size - 1);
  const subtitle2Size = Math.max(resolvedBodySize, subtitle1Size - 1);
  const body2Size = Math.max(10, Math.min(resolvedBodySize, resolvedBodySize - 1));
  const captionSize = Math.max(10, Math.min(body2Size, resolvedBodySize - 2));

  return {
    h1: toTypographyVariant({
      fontSizePx: resolvedHeadingSize,
      fontWeight: 700,
      lineHeightPx: Math.round(resolvedHeadingSize * 1.333),
      fontFamily
    }),
    h2: toTypographyVariant({
      fontSizePx: h2Size,
      fontWeight: 700,
      lineHeightPx: Math.round(h2Size * 1.333),
      fontFamily
    }),
    h3: toTypographyVariant({
      fontSizePx: h3Size,
      fontWeight: 700,
      lineHeightPx: Math.round(h3Size * 1.333),
      fontFamily
    }),
    h4: toTypographyVariant({
      fontSizePx: h4Size,
      fontWeight: 600,
      lineHeightPx: Math.round(h4Size * 1.3),
      fontFamily
    }),
    h5: toTypographyVariant({
      fontSizePx: h5Size,
      fontWeight: 600,
      lineHeightPx: Math.round(h5Size * 1.3),
      fontFamily
    }),
    h6: toTypographyVariant({
      fontSizePx: h6Size,
      fontWeight: 600,
      lineHeightPx: Math.round(h6Size * 1.3),
      fontFamily
    }),
    subtitle1: toTypographyVariant({
      fontSizePx: subtitle1Size,
      fontWeight: 600,
      lineHeightPx: Math.round(subtitle1Size * 1.4),
      fontFamily
    }),
    subtitle2: toTypographyVariant({
      fontSizePx: subtitle2Size,
      fontWeight: 500,
      lineHeightPx: Math.round(subtitle2Size * 1.4),
      fontFamily
    }),
    body1: toTypographyVariant({
      fontSizePx: resolvedBodySize,
      fontWeight: 400,
      lineHeightPx: Math.round(resolvedBodySize * 1.5),
      fontFamily
    }),
    body2: toTypographyVariant({
      fontSizePx: body2Size,
      fontWeight: 400,
      lineHeightPx: Math.round(body2Size * 1.5),
      fontFamily
    }),
    button: toTypographyVariant({
      fontSizePx: Math.max(body2Size, subtitle2Size),
      fontWeight: 600,
      lineHeightPx: Math.round(Math.max(body2Size, subtitle2Size) * 1.4),
      fontFamily,
      textTransform: "none"
    }),
    caption: toTypographyVariant({
      fontSizePx: captionSize,
      fontWeight: 400,
      lineHeightPx: Math.round(captionSize * 1.4),
      fontFamily
    }),
    overline: toTypographyVariant({
      fontSizePx: captionSize,
      fontWeight: 500,
      lineHeightPx: Math.round(captionSize * 1.4),
      fontFamily,
      letterSpacingEm: 0.08
    })
  };
};

export const completeTypographyScale = ({
  partialScale,
  fontFamily,
  headingSize,
  bodySize
}: {
  partialScale?: Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>>;
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}): DesignTokenTypographyScale => {
  const fallbackScale = buildTypographyScaleFromAliases({
    fontFamily,
    headingSize,
    bodySize
  });

  const resolvedScale = {} as DesignTokenTypographyScale;
  let previousFontSizePx = Number.POSITIVE_INFINITY;

  for (const variantName of DESIGN_TYPOGRAPHY_VARIANTS) {
    const mergedVariant = toTypographyVariant({
      ...fallbackScale[variantName],
      ...partialScale?.[variantName],
      fontFamily: partialScale?.[variantName]?.fontFamily ?? fallbackScale[variantName].fontFamily ?? fontFamily
    });

    const nextFontSizePx = Math.min(previousFontSizePx, mergedVariant.fontSizePx);
    resolvedScale[variantName] = {
      ...mergedVariant,
      fontSizePx: nextFontSizePx,
      lineHeightPx: Math.max(nextFontSizePx, mergedVariant.lineHeightPx),
      fontFamily: mergedVariant.fontFamily ?? fontFamily
    };
    previousFontSizePx = nextFontSizePx;
  }

  resolvedScale.button = {
    ...resolvedScale.button,
    textTransform: resolvedScale.button.textTransform ?? "none"
  };
  const overlineLetterSpacingEm = resolvedScale.overline.letterSpacingEm ?? fallbackScale.overline.letterSpacingEm;
  resolvedScale.overline = {
    ...resolvedScale.overline,
    ...(typeof overlineLetterSpacingEm === "number" ? { letterSpacingEm: overlineLetterSpacingEm } : {})
  };

  return resolvedScale;
};
