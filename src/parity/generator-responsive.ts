import type {
  ResponsiveBreakpoint,
  ScreenResponsiveLayoutOverride,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  ScreenIR
} from "./types.js";
import {
  literal,
  clamp,
  dedupeSxEntries,
  toSpacingUnitValue,
  toPxLiteral,
  mapPrimaryAxisAlignToJustifyContent,
  mapCounterAxisAlignToAlignItems
} from "./generator-templates.js";

export const RESPONSIVE_WIDTH_RATIO_MIN = 0.001;
export const RESPONSIVE_WIDTH_RATIO_MAX = 1.2;
export const RESPONSIVE_FULL_WIDTH_EPSILON = 0.02;

export const normalizeResponsiveWidthRatio = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = clamp(value, RESPONSIVE_WIDTH_RATIO_MIN, RESPONSIVE_WIDTH_RATIO_MAX);
  return Math.round(normalized * 1000) / 1000;
};

export const toPercentLiteralFromRatio = (ratio: number | undefined): string | undefined => {
  const normalized = normalizeResponsiveWidthRatio(ratio);
  if (normalized === undefined) {
    return undefined;
  }
  if (Math.abs(1 - normalized) <= RESPONSIVE_FULL_WIDTH_EPSILON) {
    return literal("100%");
  }
  const percent = Math.round(normalized * 100000) / 1000;
  const percentString = Number.isInteger(percent) ? String(percent) : percent.toString();
  return literal(`${percentString}%`);
};

export const RESPONSIVE_BREAKPOINT_ORDER: ResponsiveBreakpoint[] = ["xs", "sm", "md", "lg", "xl"];
export const MUI_DEFAULT_BREAKPOINT_VALUES: Record<ResponsiveBreakpoint, number> = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536
};

export const RESPONSIVE_FALLBACK_RESET_VALUE_BY_PROPERTY: Record<string, string> = {
  maxWidth: JSON.stringify("none"),
  width: JSON.stringify("auto"),
  minHeight: JSON.stringify("auto"),
  display: JSON.stringify("initial"),
  flexDirection: JSON.stringify("initial"),
  justifyContent: JSON.stringify("initial"),
  alignItems: JSON.stringify("initial"),
  gap: JSON.stringify("initial")
};

export type ResponsiveSxValue = string | number | undefined;
export type ResponsiveSxEntry = [string, ResponsiveSxValue];

export const toResponsiveSxValueLiteral = (value: string | number): string => {
  return typeof value === "number" ? `${value}` : value;
};

export const hasSameResponsiveSxValue = (left: ResponsiveSxValue, right: ResponsiveSxValue): boolean => {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  return left === right;
};

export const toSxValueMapFromEntries = (entries: ResponsiveSxEntry[]): Map<string, string | number> => {
  const valueByKey = new Map<string, string | number>();
  for (const [key, value] of dedupeSxEntries(entries)) {
    valueByKey.set(key, value);
  }
  return valueByKey;
};

export const pushResponsiveStyleEntry = ({
  byBreakpoint,
  breakpoint,
  entry
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
  breakpoint: ResponsiveBreakpoint;
  entry: ResponsiveSxEntry;
}): void => {
  const current = byBreakpoint.get(breakpoint) ?? [];
  current.push(entry);
  byBreakpoint.set(breakpoint, current);
};

export const appendLayoutOverrideEntriesForBreakpoint = ({
  byBreakpoint,
  breakpoint,
  baseLayoutMode,
  override,
  spacingBase
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
  breakpoint: ResponsiveBreakpoint;
  baseLayoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  override: ScreenResponsiveLayoutOverride;
  spacingBase: number;
}): void => {
  const effectiveLayoutMode = override.layoutMode ?? baseLayoutMode;
  if (override.layoutMode) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["display", literal(effectiveLayoutMode === "NONE" ? "block" : "flex")]
    });
    if (effectiveLayoutMode !== "NONE") {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["flexDirection", literal(effectiveLayoutMode === "HORIZONTAL" ? "row" : "column")]
      });
    }
  }

  if (override.primaryAxisAlignItems) {
    const justifyContent = mapPrimaryAxisAlignToJustifyContent(override.primaryAxisAlignItems);
    if (justifyContent) {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["justifyContent", literal(justifyContent)]
      });
    }
  } else if (override.layoutMode === "NONE") {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["justifyContent", literal("initial")]
    });
  }

  if (override.counterAxisAlignItems) {
    const alignItems = mapCounterAxisAlignToAlignItems(override.counterAxisAlignItems, effectiveLayoutMode);
    if (alignItems) {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["alignItems", literal(alignItems)]
      });
    }
  } else if (override.layoutMode === "NONE") {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["alignItems", literal("initial")]
    });
  }

  if (typeof override.gap === "number" && Number.isFinite(override.gap)) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["gap", toSpacingUnitValue({ value: override.gap, spacingBase })]
    });
  }

  if (typeof override.widthRatio === "number" && Number.isFinite(override.widthRatio) && override.widthRatio > 0) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["width", toPercentLiteralFromRatio(override.widthRatio)]
    });
  }

  if (typeof override.minHeight === "number" && Number.isFinite(override.minHeight) && override.minHeight > 0) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["minHeight", toPxLiteral(override.minHeight)]
    });
  }
};

export const toResponsivePropertyValueByBreakpoint = (
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>
): Map<string, Map<ResponsiveBreakpoint, string | number>> => {
  const valuesByProperty = new Map<string, Map<ResponsiveBreakpoint, string | number>>();
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const styleEntries = byBreakpoint.get(breakpoint);
    if (!styleEntries || styleEntries.length === 0) {
      continue;
    }
    for (const [property, value] of dedupeSxEntries(styleEntries)) {
      const byBreakpointValues = valuesByProperty.get(property) ?? new Map<ResponsiveBreakpoint, string | number>();
      byBreakpointValues.set(breakpoint, value);
      valuesByProperty.set(property, byBreakpointValues);
    }
  }
  return valuesByProperty;
};

export const toResponsiveObjectLiteralForProperty = ({
  property,
  overrideValuesByBreakpoint,
  baseValue
}: {
  property: string;
  overrideValuesByBreakpoint: Map<ResponsiveBreakpoint, string | number>;
  baseValue: string | number | undefined;
}): string | undefined => {
  const stepEntries: string[] = [];
  const resetValue = baseValue === undefined ? RESPONSIVE_FALLBACK_RESET_VALUE_BY_PROPERTY[property] : undefined;
  let previousEffective: ResponsiveSxValue = baseValue;

  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const overrideValue = overrideValuesByBreakpoint.get(breakpoint);
    const effectiveValue = overrideValue !== undefined ? overrideValue : baseValue;
    if (hasSameResponsiveSxValue(effectiveValue, previousEffective)) {
      continue;
    }
    if (effectiveValue !== undefined) {
      stepEntries.push(`${breakpoint}: ${toResponsiveSxValueLiteral(effectiveValue)}`);
      previousEffective = effectiveValue;
      continue;
    }
    if (resetValue !== undefined) {
      stepEntries.push(`${breakpoint}: ${resetValue}`);
    }
    previousEffective = effectiveValue;
  }

  if (stepEntries.length === 0) {
    return undefined;
  }
  return `{ ${stepEntries.join(", ")} }`;
};

export const toResponsiveObjectEntries = ({
  byBreakpoint,
  baseValuesByKey
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
  baseValuesByKey: Map<string, string | number>;
}): ResponsiveSxEntry[] => {
  const entries: ResponsiveSxEntry[] = [];
  for (const [property, overrideValuesByBreakpoint] of toResponsivePropertyValueByBreakpoint(byBreakpoint).entries()) {
    const responsiveObjectLiteral = toResponsiveObjectLiteralForProperty({
      property,
      overrideValuesByBreakpoint,
      baseValue: baseValuesByKey.get(property)
    });
    if (!responsiveObjectLiteral) {
      continue;
    }
    entries.push([property, responsiveObjectLiteral]);
  }
  return entries;
};

export const toResponsiveLayoutMediaEntries = ({
  baseLayoutMode,
  overrides,
  spacingBase,
  baseValuesByKey = new Map<string, string | number>()
}: {
  baseLayoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  overrides: ScreenResponsiveLayoutOverridesByBreakpoint | undefined;
  spacingBase: number;
  baseValuesByKey?: Map<string, string | number>;
}): ResponsiveSxEntry[] => {
  if (!overrides) {
    return [];
  }
  const byBreakpoint = new Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>();
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const override = overrides[breakpoint];
    if (!override) {
      continue;
    }
    appendLayoutOverrideEntriesForBreakpoint({
      byBreakpoint,
      breakpoint,
      baseLayoutMode,
      override,
      spacingBase
    });
  }
  return toResponsiveObjectEntries({
    byBreakpoint,
    baseValuesByKey
  });
};

export const toResponsiveBaseLayoutValues = ({
  layoutMode,
  gap,
  primaryAxisAlignItems,
  counterAxisAlignItems,
  spacingBase
}: {
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap: number;
  primaryAxisAlignItems?: ScreenResponsiveLayoutOverride["primaryAxisAlignItems"];
  counterAxisAlignItems?: ScreenResponsiveLayoutOverride["counterAxisAlignItems"];
  spacingBase: number;
}): Map<string, string | number> => {
  const entries: ResponsiveSxEntry[] = [];
  if (layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL") {
    entries.push(["display", literal("flex")]);
    entries.push(["flexDirection", literal(layoutMode === "HORIZONTAL" ? "row" : "column")]);
    const justifyContent = mapPrimaryAxisAlignToJustifyContent(primaryAxisAlignItems);
    if (justifyContent) {
      entries.push(["justifyContent", literal(justifyContent)]);
    }
    const alignItems = mapCounterAxisAlignToAlignItems(counterAxisAlignItems, layoutMode);
    if (alignItems) {
      entries.push(["alignItems", literal(alignItems)]);
    }
  }
  if (typeof gap === "number" && Number.isFinite(gap) && gap > 0) {
    entries.push(["gap", toSpacingUnitValue({ value: gap, spacingBase })]);
  }
  return toSxValueMapFromEntries(entries);
};

export const toScreenResponsiveRootMediaEntries = ({
  screen,
  spacingBase
}: {
  screen: ScreenIR;
  spacingBase: number;
}): Array<[string, string | number | undefined]> => {
  if (!screen.responsive) {
    return [];
  }

  const byBreakpoint = new Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>();

  for (const variant of screen.responsive.variants) {
    if (typeof variant.width !== "number" || !Number.isFinite(variant.width) || variant.width <= 0) {
      continue;
    }
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint: variant.breakpoint,
      entry: ["maxWidth", literal(`${Math.round(variant.width)}px`)]
    });
  }

  const rootOverrides = screen.responsive.rootLayoutOverrides;
  if (rootOverrides) {
    for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
      const override = rootOverrides[breakpoint];
      if (!override) {
        continue;
      }
      appendLayoutOverrideEntriesForBreakpoint({
        byBreakpoint,
        breakpoint,
        baseLayoutMode: screen.layoutMode,
        override,
        spacingBase
      });
    }
  }

  const baseValuesByKey = toResponsiveBaseLayoutValues({
    layoutMode: screen.layoutMode,
    gap: screen.gap,
    primaryAxisAlignItems: screen.primaryAxisAlignItems,
    counterAxisAlignItems: screen.counterAxisAlignItems,
    spacingBase
  });
  baseValuesByKey.set("maxWidth", literal("none"));

  return toResponsiveObjectEntries({
    byBreakpoint,
    baseValuesByKey
  });
};

export const toResponsiveBreakpointValuesLiteral = (values: Record<ResponsiveBreakpoint, number>): string => {
  return `{ ${RESPONSIVE_BREAKPOINT_ORDER.map((breakpoint) => `${breakpoint}: ${values[breakpoint]}`).join(", ")} }`;
};

