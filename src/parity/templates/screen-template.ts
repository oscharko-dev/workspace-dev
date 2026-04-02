// ---------------------------------------------------------------------------
// screen-template.ts — Screen component scaffolding and element rendering
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import path from "node:path";
import {
  isTextElement
} from "../types.js";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignTokenTypographyVariantName,
  GeneratedFile,
  SimplificationMetrics,
  TextElementIR,
  ScreenElementIR,
  ScreenIR
} from "../types.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../../generation-locale.js";
import type { WorkspaceFormHandlingMode } from "../../contracts/index.js";
import { toComponentName, toDeterministicScreenPath } from "../generator-artifacts.js";
import {
  toPercentLiteralFromRatio,
  toSxValueMapFromEntries,
  toResponsiveLayoutMediaEntries,
  toScreenResponsiveRootMediaEntries
} from "../generator-responsive.js";
import {
  validateGeneratedJsxFragment,
  validateGeneratedSourceFile
} from "../generated-source-validation.js";
import {
  registerMuiImports,
  registerMappedImport,
  registerIconImport,
  registerInteractiveField,
  registerInteractiveAccordion,
  buildSemanticInputModel,
  resolvePrototypeNavigationBinding,
  toRouterLinkProps,
  toNavigateHandlerProps,
  resolveBackgroundHexForText,
  pushLowContrastWarning,
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  hasMeaningfulTextDescendants,
  inferLandmarkRole,
  resolveSemanticContainerDescriptor,
  isDecorativeElement,
  isDecorativeImageElement,
  inferHeadingComponentByNodeId,
  resolveTypographyVariantByNodeId,
  resolveImageSource,
  pickBestIconNode,
  normalizeIconImports,
  sortChildren,
  isLikelyInputContainer,
  isLikelyAccordionContainer,
  isIconLikeNode,
  isVectorGraphicNode,
  isSemanticIconWrapper,
  hasVisualStyle,
  detectTabInterfacePattern,
  detectDialogOverlayPattern,
  detectNavigationBarPattern,
  detectGridLikeContainerLayout,
  detectCssGridLayout,
  detectRepeatedListPattern,
  ensureTabsStateModel,
  ensureDialogStateModel,
  collectListRows,
  analyzeListRow,
  isRenderableTabAction,
  deriveSelectOptions,
  renderMappedElement,
  registerNamedMappedImport,
  toStateKey,
  hasSubtreeName,
  approximatelyEqualNumber,
  inferRequiredFromLabel,
  sanitizeRequiredLabel,
  inferVisualErrorFromOutline,
  toListSecondaryActionExpression,
  findFirstByName,
  extractSharedSxConstantsFromScreenContent,
  resolveIconColor,
  ICON_FALLBACK_BUILTIN_RESOLVER,
  buildPatternExtractionPlan,
  createEmptySimplificationStats,
  simplifyElements,
  collectThemeSxSampleFromEntries,
  collectThemeDefaultMatchedSxKeys,
  detectFormGroups,
  detectCrossFieldRules,
  inferValidationMode,
  buildTabA11yId,
  buildTabPanelA11yId,
  buildAccordionHeaderA11yId,
  buildAccordionPanelA11yId,
  isRtlLocale
} from "../generator-core.js";
import type {
  RenderContext,
  VirtualParent,
  AccessibilityWarning,
  ValidationFieldType,
  ResolvedFormHandlingMode,
  HeadingComponent,
  InteractiveFieldModel,
  IconFallbackResolver,
  PatternContextFileSpec,
  FormContextFileSpec,
  PatternExtractionPlan,
  RenderedButtonModel,
  ThemeComponentDefaults,
  DatePickerProviderConfig,
  PrimitiveJsxPropValue,
  SpecializedComponentMapping,
  ListRowAnalysis,
  FormGroupAssignment,
  IconRenderWarning
} from "../generator-core.js";
import type { ComponentMatchReportIconResolutionRecord } from "../../storybook/types.js";
import type { ResolvedStorybookTypographyStyle } from "../../storybook/theme-resolver.js";
import {
  literal,
  clamp,
  normalizeHexColor,
  normalizeFontFamily,
  toPxLiteral,
  normalizeSpacingBase,
  toSpacingUnitValue,
  toBoxSpacingSxEntries,
  toThemeBorderRadiusValue,
  toRemLiteral,
  toEmLiteral,
  toLetterSpacingEm,
  toRgbaColor,
  toContrastRatio,
  inferButtonVariant,
  inferButtonSize,
  inferButtonFullWidth,
  inferButtonDisabled,
  filterButtonVariantEntries,
  resolveFormHandlingMode,
  withOmittedSxKeys,
  toThemeColorLiteral,
  mapPrimaryAxisAlignToJustifyContent,
  mapCounterAxisAlignToAlignItems,
  sxString,
  normalizeElevationForSx,
  matchesRoundedInteger,
  appendVariantStateOverridesToSx,
  toChipVariant,
  toChipSize,
  indentBlock,
  baseLayoutEntries,
  toElementSx,
  firstText,
  firstTextColor,
  collectTextNodes,
  collectVectorPaths,
  firstVectorColor,
  toMuiContainerMaxWidth,
  toAlertSeverityFromName,
  sanitizeSelectOptionValue,
  WCAG_AA_NORMAL_TEXT_CONTRAST_MIN,
  toPascalCase
} from "./utility-functions.js";
export type { ResolvedThemePalette } from "./utility-functions.js";
import {
  renderFallbackIconExpression,
  renderInlineSvgIcon
} from "./icon-template.js";
import {
  buildInlineLegacyFormStateBlock,
  buildLegacyFormContextFile,
  buildInlineReactHookFormStateBlock,
  buildReactHookFormContextFile
} from "./form-template.js";

const ISSUE_693_BANKING_INPUT_TYPES = new Set(["InputCurrency", "InputIBAN", "InputTAN"]);

const toTypographyWeightNumber = (value: number | string | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  if (trimmed === "normal") {
    return 400;
  }
  if (trimmed === "medium") {
    return 500;
  }
  if (trimmed === "semibold" || trimmed === "semi bold") {
    return 600;
  }
  if (trimmed === "bold") {
    return 700;
  }
  if (trimmed === "extrabold" || trimmed === "extra bold") {
    return 800;
  }
  if (trimmed === "black") {
    return 900;
  }
  if (trimmed === "light") {
    return 300;
  }
  return undefined;
};

const toTypographyLineHeightPx = ({
  value,
  fontSizePx
}: {
  value: number | string | undefined;
  fontSizePx: number | undefined;
}): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 4 || fontSizePx === undefined) {
      return value;
    }
    return value * fontSizePx;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.endsWith("px")) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (trimmed.endsWith("%")) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) && fontSizePx !== undefined ? (parsed / 100) * fontSizePx : undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (parsed > 4 || fontSizePx === undefined) {
    return parsed;
  }
  return parsed * fontSizePx;
};

const toTypographyLetterSpacingEm = ({
  value,
  fontSizePx
}: {
  value: number | string | undefined;
  fontSizePx: number | undefined;
}): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return toLetterSpacingEm({
      letterSpacingPx: value,
      fontSizePx
    });
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.endsWith("em")) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (trimmed.endsWith("px")) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed)
      ? toLetterSpacingEm({
          letterSpacingPx: parsed,
          fontSizePx
        })
      : undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed)
    ? toLetterSpacingEm({
        letterSpacingPx: parsed,
        fontSizePx
      })
    : undefined;
};

const isHeadingLikeTextElement = (element: TextElementIR, context: RenderContext): boolean => {
  return (
    Boolean(context.headingComponentByNodeId.get(element.id)) ||
    (typeof element.fontSize === "number" && element.fontSize >= 24) ||
    (typeof element.fontWeight === "number" && element.fontWeight >= 600)
  );
};

const resolveSpecializedComponentMapping = ({
  context,
  semanticType
}: {
  context: RenderContext;
  semanticType: string | undefined;
}): SpecializedComponentMapping | undefined => {
  if (!semanticType) {
    return undefined;
  }
  if (semanticType === "DynamicTypography") {
    return context.specializedComponentMappings.DynamicTypography ?? context.specializedComponentMappings.Typography;
  }
  return context.specializedComponentMappings[semanticType];
};

const registerSpecializedComponentImport = ({
  context,
  mapping
}: {
  context: RenderContext;
  mapping: SpecializedComponentMapping;
}): string => {
  if (mapping.importedName) {
    return registerNamedMappedImport({
      context,
      importedName: mapping.importedName,
      modulePath: mapping.modulePath,
      localName: mapping.localName
    });
  }
  return registerMappedImport({
    context,
    componentName: mapping.localName,
    importPath: mapping.modulePath
  });
};

const appendMappedPropLine = ({
  lines,
  mapping,
  sourceName,
  expression,
  primitiveValue
}: {
  lines: string[];
  mapping: SpecializedComponentMapping;
  sourceName: string;
  expression: string;
  primitiveValue?: PrimitiveJsxPropValue;
}): void => {
  if (mapping.omittedProps.has(sourceName)) {
    return;
  }
  const targetName = mapping.propMappings[sourceName] ?? sourceName;
  if (primitiveValue !== undefined && mapping.defaultProps[targetName] === primitiveValue) {
    return;
  }
  lines.push(`${targetName}={${expression}}`);
};

const normalizeVariantLookupToken = (value: string): string => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const collectDynamicTypographyVariantCandidates = (element: ScreenElementIR): string[] => {
  const candidates = new Set<string>();
  const appendCandidate = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    candidates.add(trimmed);
  };

  if (element.variantMapping?.properties) {
    for (const [key, value] of Object.entries(element.variantMapping.properties)) {
      appendCandidate(key);
      appendCandidate(value);
      appendCandidate(value.split(/[=:]/).at(-1));
    }
  }

  const normalizedName = element.name.replace(/[<>]/g, " ").trim();
  appendCandidate(normalizedName);
  for (const chunk of normalizedName.split(/[,;|]/)) {
    appendCandidate(chunk);
    appendCandidate(chunk.split(/[=:]/).at(-1));
  }
  for (const token of normalizedName.split(/[\s,;:/\\|()[\]{}_.=-]+/)) {
    appendCandidate(token);
  }

  return [...candidates];
};

const resolveStorybookVariantNameByCandidates = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): string | undefined => {
  const variants = context.storybookTypographyVariants;
  if (!variants || Object.keys(variants).length === 0) {
    return undefined;
  }

  const variantByNormalizedToken = new Map<string, string>();
  for (const variantName of Object.keys(variants)) {
    const normalizedToken = normalizeVariantLookupToken(variantName);
    if (normalizedToken && !variantByNormalizedToken.has(normalizedToken)) {
      variantByNormalizedToken.set(normalizedToken, variantName);
    }
  }

  const candidates = collectDynamicTypographyVariantCandidates(element);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeVariantLookupToken(candidate);
    const variantName = variantByNormalizedToken.get(normalizedCandidate);
    if (variantName) {
      return variantName;
    }
  }

  return undefined;
};

const resolveStorybookTypographyVariantName = ({
  element,
  context
}: {
  element: TextElementIR;
  context: RenderContext;
}): string | undefined => {
  const variants = context.storybookTypographyVariants;
  if (!variants || Object.keys(variants).length === 0) {
    return undefined;
  }

  const elementLetterSpacingEm = toLetterSpacingEm({
    letterSpacingPx: element.letterSpacing,
    fontSizePx: element.fontSize
  });
  const elementFontFamily = normalizeFontFamily(element.fontFamily);
  const headingLike = isHeadingLikeTextElement(element, context);

  const ranked = Object.entries(variants)
    .map(([variantName, variant]) => {
      const variantWeight = toTypographyWeightNumber(variant.fontWeight);
      const variantLineHeightPx = toTypographyLineHeightPx({
        value: variant.lineHeight,
        fontSizePx: variant.fontSizePx
      });
      const variantLetterSpacingEm = toTypographyLetterSpacingEm({
        value: variant.letterSpacing,
        fontSizePx: variant.fontSizePx
      });
      const normalizedVariantFont = normalizeFontFamily(variant.fontFamily);
      const sizeDiff = Math.abs((element.fontSize ?? variant.fontSizePx ?? 0) - (variant.fontSizePx ?? element.fontSize ?? 0));
      const weightDiff = Math.abs(
        (element.fontWeight ?? variantWeight ?? 0) - (variantWeight ?? element.fontWeight ?? 0)
      );
      const lineDiff = Math.abs(
        (element.lineHeight ?? variantLineHeightPx ?? 0) - (variantLineHeightPx ?? element.lineHeight ?? 0)
      );
      const letterSpacingDiff = Math.abs((elementLetterSpacingEm ?? 0) - (variantLetterSpacingEm ?? 0));
      const familyMismatch =
        elementFontFamily && normalizedVariantFont && elementFontFamily !== normalizedVariantFont ? 1.25 : 0;
      const headingPenalty = headingLike === /^h[1-6]$/i.test(variantName) ? 0 : 0.75;

      return {
        variantName,
        score: sizeDiff * 3 + weightDiff / 200 + lineDiff / 4 + letterSpacingDiff * 8 + familyMismatch + headingPenalty,
        sizeDiff,
        weightDiff,
        lineDiff
      };
    })
    .sort((left, right) => left.score - right.score || left.sizeDiff - right.sizeDiff);

  const bestMatch = ranked[0];
  const secondBest = ranked[1];
  if (!bestMatch) {
    return undefined;
  }
  const hasConfidentLead =
    !secondBest || secondBest.score - bestMatch.score >= 0.35 || bestMatch.score <= 1.5;
  if (
    !hasConfidentLead ||
    bestMatch.sizeDiff > 2.5 ||
    bestMatch.weightDiff > 350 ||
    bestMatch.lineDiff > 6 ||
    bestMatch.score > 9.5
  ) {
    return undefined;
  }
  return bestMatch.variantName;
};

export const renderText = (element: TextElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  if (context.consumedFieldLabelNodeIds?.has(element.id)) {
    return "";
  }
  const indent = "  ".repeat(depth);
  const text = literal(element.text.trim() || element.name);
  const headingComponent = context.headingComponentByNodeId.get(element.id);
  const typographyVariantName = context.typographyVariantByNodeId.get(element.id);
  const typographyVariant = typographyVariantName && context.tokens ? context.tokens.typography[typographyVariantName] : undefined;
  const normalizedFont = normalizeFontFamily(element.fontFamily);
  const normalizedVariantFont = normalizeFontFamily(typographyVariant?.fontFamily ?? context.tokens?.fontFamily);
  const letterSpacingEm = toLetterSpacingEm({
    letterSpacingPx: element.letterSpacing,
    fontSizePx: element.fontSize
  });
  const baseTextLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const responsiveTextLayoutEntries = toResponsiveLayoutMediaEntries({
    baseLayoutMode: element.layoutMode ?? "NONE",
    overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
    spacingBase: context.spacingBase,
    baseValuesByKey: toSxValueMapFromEntries(baseTextLayoutEntries)
  });
  const textLayoutEntries = [
    ...baseTextLayoutEntries.filter(([key]) => {
      return key !== "width" && key !== "height" && key !== "minHeight";
    }),
    ...responsiveTextLayoutEntries
  ];

  const isLinkLikeColor = element.fillColor && /^#0[0-4][0-9a-f]{4}$/i.test(element.fillColor);
  const omitFontSize = typographyVariant
    ? approximatelyEqualNumber({
        left: element.fontSize,
        right: typographyVariant.fontSizePx,
        tolerance: 2
      })
    : false;
  const omitFontWeight = typographyVariant
    ? approximatelyEqualNumber({
        left: element.fontWeight,
        right: typographyVariant.fontWeight,
        tolerance: 75
      })
    : false;
  const omitLineHeight = typographyVariant
    ? approximatelyEqualNumber({
        left: element.lineHeight,
        right: typographyVariant.lineHeightPx,
        tolerance: 3
      })
    : false;
  const omitFontFamily = typographyVariant
    ? (!normalizedFont && !normalizedVariantFont) || normalizedFont === normalizedVariantFont
    : false;
  const omitLetterSpacing = typographyVariant
    ? approximatelyEqualNumber({
        left: letterSpacingEm,
        right: typographyVariant.letterSpacingEm,
        tolerance: 0.02
      })
    : false;
  const sx = sxString([
    ...textLayoutEntries,
    ["fontSize", omitFontSize ? undefined : element.fontSize ? toRemLiteral(element.fontSize) : undefined],
    ["fontWeight", omitFontWeight ? undefined : element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", omitLineHeight ? undefined : element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
    ["fontFamily", omitFontFamily ? undefined : normalizedFont ? literal(normalizedFont) : undefined],
    ["letterSpacing", omitLetterSpacing ? undefined : toEmLiteral(letterSpacingEm)],
    ["color", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })],
    [
      "textAlign",
      (() => {
        const rtl = isRtlLocale(context.generationLocale);
        if (element.textAlign === "LEFT") return literal(rtl ? "start" : "left");
        if (element.textAlign === "CENTER") return literal("center");
        if (element.textAlign === "RIGHT") return literal(rtl ? "end" : "right");
        return undefined;
      })()
    ],
    ["textDecoration", isLinkLikeColor ? literal("underline") : undefined],
    ["cursor", isLinkLikeColor ? literal("pointer") : undefined],
    ["whiteSpace", literal("pre-wrap")]
  ]);

  const foregroundHex = normalizeHexColor(element.fillColor);
  const backgroundHex = resolveBackgroundHexForText({ parent, context });
  if (foregroundHex && backgroundHex) {
    const foregroundRgba = toRgbaColor(foregroundHex);
    const backgroundRgba = toRgbaColor(backgroundHex);
    if (foregroundRgba && backgroundRgba) {
      const contrastRatio = toContrastRatio(foregroundRgba, backgroundRgba);
      if (contrastRatio < WCAG_AA_NORMAL_TEXT_CONTRAST_MIN) {
        pushLowContrastWarning({
          context,
          element,
          foreground: foregroundHex,
          background: backgroundHex,
          contrastRatio
        });
      }
    }
  }

  const dynamicTypographyVariant =
    element.semanticType === "DynamicTypography"
      ? resolveDynamicTypographyVariant(element, context)
      : undefined;

  // Specialized Typography component mapping (Storybook-driven).
  const hasSpecializedTypographySemantic = element.semanticType === "Typography" || element.semanticType === "DynamicTypography";
  const specializedTypographyMapping = hasSpecializedTypographySemantic
    ? resolveSpecializedComponentMapping({
        context,
        semanticType: element.semanticType
      })
    : undefined;
  if (specializedTypographyMapping) {
    const storybookVariantName =
      element.semanticType === "DynamicTypography"
        ? dynamicTypographyVariant
        : resolveStorybookTypographyVariantName({
            element,
            context
          });
    if (storybookVariantName) {
      const componentLocalName = registerSpecializedComponentImport({
        context,
        mapping: specializedTypographyMapping
      });
      const propLines: string[] = [];
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedTypographyMapping,
        sourceName: "variant",
        expression: literal(storybookVariantName),
        primitiveValue: storybookVariantName
      });
      if (headingComponent) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedTypographyMapping,
          sourceName: "component",
          expression: literal(headingComponent),
          primitiveValue: headingComponent
        });
      }
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedTypographyMapping,
        sourceName: "sx",
        expression: `{ ${sx} }`
      });
      const propsBlock =
        propLines.length > 0 ? `\n${propLines.map((line) => `${indent}  ${line}`).join("\n")}\n${indent}` : " ";
      return `${indent}<${componentLocalName}${propsBlock}>{${text}}</${componentLocalName}>`;
    }
  }

  const resolvedVariantName = dynamicTypographyVariant ?? typographyVariantName;

  registerMuiImports(context, "Typography");
  const variantProp = resolvedVariantName ? ` variant="${resolvedVariantName}"` : "";
  const headingProp = headingComponent ? ` component="${headingComponent}"` : "";
  return `${indent}<Typography${variantProp}${headingProp} sx={{ ${sx} }}>{${text}}</Typography>`;
};

// ---------------------------------------------------------------------------
// Banking-input semantic types that receive prioritised rendering over
// generic TextField when the board classification matches.
// ---------------------------------------------------------------------------
const BANKING_INPUT_SEMANTIC_TYPES = new Set(["InputCurrency", "InputIBAN", "InputTAN"]);

// ---------------------------------------------------------------------------
// DynamicTypography Storybook variant catalog.
// Maps Figma typography style tokens (from variant properties or node name
// suffixes) to customer-specific MUI Typography variants derived from the
// catalogued Storybook component library.
// ---------------------------------------------------------------------------
export const DYNAMIC_TYPOGRAPHY_VARIANT_CATALOG: ReadonlyMap<string, string> = new Map([
  ["display-large", "h1"],
  ["display-medium", "h2"],
  ["display-small", "h3"],
  ["headline-large", "h4"],
  ["headline-medium", "h5"],
  ["headline-small", "h6"],
  ["title-large", "subtitle1"],
  ["title-medium", "subtitle2"],
  ["body-large", "body1"],
  ["body-medium", "body2"],
  ["body-small", "caption"],
  ["label-large", "button"],
  ["label-medium", "overline"],
  ["label-small", "overline"]
]);

/**
 * Resolve a DynamicTypography variant from the element's variant mapping
 * or name. Returns the MUI Typography variant string, or `undefined` when
 * no catalogue match is found.
 */
export const resolveDynamicTypographyVariant = (
  element: ScreenElementIR,
  context?: RenderContext
): string | undefined => {
  const hasStorybookVariants = Boolean(context?.storybookTypographyVariants) &&
    Object.keys(context?.storybookTypographyVariants ?? {}).length > 0;
  if (context && hasStorybookVariants) {
    const directStorybookMatch = resolveStorybookVariantNameByCandidates({
      element,
      context
    });
    if (directStorybookMatch) {
      return directStorybookMatch;
    }

    // Fall back to style-based matching against Storybook typography variants.
    return resolveStorybookTypographyVariantName({
      element: element as TextElementIR,
      context
    });
  }

  const candidates = collectDynamicTypographyVariantCandidates(element).map((candidate) => candidate.toLowerCase());
  for (const candidate of candidates) {
    const variant = DYNAMIC_TYPOGRAPHY_VARIANT_CATALOG.get(candidate);
    if (variant) {
      return variant;
    }
  }
  return undefined;
};

/**
 * Render a DatePicker element using `@mui/x-date-pickers/DatePicker` and
 * mark the screen as requiring `LocalizationProvider` wiring.
 */
const renderDatePickerInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  context.usesDatePicker = true;
  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  const baseEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const fieldSx = sxString(baseEntries);
  const usesReactHookForm = context.formHandlingMode === "react_hook_form";

  if (usesReactHookForm) {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField }) => (
${indent}    <DatePicker
${indent}      label={${literal(field.label)}}
${indent}      value={controllerField.value}
${indent}      onChange={(newValue) => controllerField.onChange(newValue)}
${indent}      slotProps={{
${indent}        textField: {
${indent}          onBlur: controllerField.onBlur,
${indent}          "aria-label": ${literal(field.label)},
${indent}          sx: { ${fieldSx} }
${indent}        }
${indent}      }}
${indent}    />
${indent}  )}
${indent}/>`;
  }
  return `${indent}<DatePicker
${indent}  label={${literal(field.label)}}
${indent}  value={formValues[${literal(field.key)}] ?? null}
${indent}  onChange={(newValue) => updateFieldValue(${literal(field.key)}, newValue)}
${indent}  slotProps={{
${indent}    textField: {
${indent}      onBlur: () => handleFieldBlur(${literal(field.key)}),
${indent}      "aria-label": ${literal(field.label)},
${indent}      sx: { ${fieldSx} }
${indent}    }
${indent}  }}
${indent}/>`;
};

/**
 * Render a banking-specific input (InputCurrency, InputIBAN, InputTAN).
 * These use standard MUI TextField with specialised formatting props
 * (input masks, adornments, ARIA roles) that differentiate them from
 * generic text fields.
 */
const renderBankingInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  registerMuiImports(context, "TextField", "InputAdornment");
  const baseEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const fieldSx = sxString(baseEntries);
  const semanticType = element.semanticType as string;
  const usesReactHookForm = context.formHandlingMode === "react_hook_form";

  const bankingProps = (() => {
    switch (semanticType) {
      case "InputCurrency":
        return {
          startAdornment: `<InputAdornment position="start">{"\u20AC"}</InputAdornment>`,
          inputMode: "decimal" as const,
          placeholder: "0,00",
          ariaRoleDescription: "currency input"
        };
      case "InputIBAN":
        return {
          startAdornment: undefined,
          inputMode: "text" as const,
          placeholder: "DE00 0000 0000 0000 0000 00",
          ariaRoleDescription: "IBAN input"
        };
      case "InputTAN":
        return {
          startAdornment: undefined,
          inputMode: "numeric" as const,
          placeholder: "000000",
          ariaRoleDescription: "TAN input"
        };
      default:
        return {
          startAdornment: undefined,
          inputMode: "text" as const,
          placeholder: undefined,
          ariaRoleDescription: undefined
        };
    }
  })();

  const startAdornmentEntry = bankingProps.startAdornment
    ? `input: { startAdornment: ${bankingProps.startAdornment} }`
    : "";
  const slotPropsEntries = [
    startAdornmentEntry,
    `htmlInput: { inputMode: ${literal(bankingProps.inputMode)}${bankingProps.ariaRoleDescription ? `, "aria-roledescription": ${literal(bankingProps.ariaRoleDescription)}` : ""} }`
  ]
    .filter((e) => e.length > 0)
    .join(`,\n${indent}    `);

  if (usesReactHookForm) {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => (
${indent}    <TextField
${indent}      label={${literal(field.label)}}
${bankingProps.placeholder ? `${indent}      placeholder={${literal(bankingProps.placeholder)}}\n` : ""}${indent}      value={controllerField.value}
${indent}      onChange={controllerField.onChange}
${indent}      onBlur={controllerField.onBlur}
${indent}      error={Boolean(fieldState.error)}
${indent}      helperText={fieldState.error?.message ?? ""}
${indent}      aria-label={${literal(field.label)}}
${indent}      sx={{ ${fieldSx} }}
${indent}      slotProps={{
${indent}        ${slotPropsEntries}
${indent}      }}
${indent}    />
${indent}  )}
${indent}/>`;
  }
  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${bankingProps.placeholder ? `${indent}  placeholder={${literal(bankingProps.placeholder)}}\n` : ""}${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}  aria-label={${literal(field.label)}}
${indent}  sx={{ ${fieldSx} }}
${indent}  slotProps={{
${indent}    ${slotPropsEntries}
${indent}  }}
${indent}/>`;
};

export const renderSemanticInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  // --- Banking-input and DatePicker prioritisation (issue #693) ---
  // Specialized component mappings take priority; the built-in renderers
  // below serve as deterministic fallbacks when no mapping is configured.
  const hasSpecializedMapping = element.semanticType
    ? (() => {
        const mapping = resolveSpecializedComponentMapping({
          context,
          semanticType: element.semanticType
        });
        if (!mapping) {
          return false;
        }
        if (element.semanticType === "DatePicker" && !context.datePickerProvider) {
          return false;
        }
        return true;
      })()
    : false;
  if (!hasSpecializedMapping && element.semanticType === "DatePicker") {
    return renderDatePickerInput(element, depth, parent, context);
  }
  if (!hasSpecializedMapping && element.semanticType && BANKING_INPUT_SEMANTIC_TYPES.has(element.semanticType)) {
    return renderBankingInput(element, depth, parent, context);
  }

  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  const nestedOutlineContainer = findFirstByName(element, "muioutlinedinputroot");
  const hasDistinctFieldShell =
    Boolean(element.strokeColor || element.fillColor || element.fillGradient) ||
    (typeof element.cornerRadius === "number" && element.cornerRadius > 0) ||
    ((element.width ?? 0) - (nestedOutlineContainer?.width ?? 0) >= 24) ||
    ((element.height ?? 0) - (nestedOutlineContainer?.height ?? 0) >= 12);
  const outlineContainer = nestedOutlineContainer && !hasDistinctFieldShell ? nestedOutlineContainer : element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineStrokeColor = outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor ?? nestedOutlineContainer?.strokeColor;
  const textFieldDefaults = context.themeComponentDefaults?.MuiTextField;
  const outlinedInputRadiusSource = outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius;
  const omitOutlinedInputBorderRadius = matchesRoundedInteger({
    value: outlinedInputRadiusSource,
    target: textFieldDefaults?.outlinedInputBorderRadiusPx
  });
  const baseFieldLayoutEntries = baseLayoutEntries(outlineContainer, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const fieldSxEntries: Array<[string, string | number | undefined]> = [
    ...baseFieldLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: outlineContainer.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[outlineContainer.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseFieldLayoutEntries)
    }),
    ["bgcolor", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })] as [string, string | number | undefined]
  ];

  const inputRootStyle = sxString([
    [
      "borderRadius",
      !omitOutlinedInputBorderRadius
        ? toThemeBorderRadiusValue({
            radiusPx: outlinedInputRadiusSource,
            tokens: context.tokens
          })
        : undefined
    ],
    ["fontFamily", field.valueFontFamily ? literal(field.valueFontFamily) : undefined],
    ["color", toThemeColorLiteral({ color: field.valueColor, tokens: context.tokens })]
  ]);
  const inputLabelStyle = sxString([
    ["fontFamily", field.labelFontFamily ? literal(field.labelFontFamily) : undefined],
    ["color", toThemeColorLiteral({ color: field.labelColor, tokens: context.tokens })]
  ]);
  const outlineStyle = sxString([["borderColor", toThemeColorLiteral({ color: outlineStrokeColor, tokens: context.tokens })]]);
  const endAdornment =
    !field.isSelect && field.suffixText
      ? `endAdornment: <InputAdornment position="end">{${literal(field.suffixText)}}</InputAdornment>`
      : "";
  const fieldErrorExpression = `(Boolean((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? ""))`;
  const fieldHelperTextExpression = `((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? "")`;
  const helperTextId = `${field.key}-helper-text`;
  const requiredProp = field.required ? `${indent}    required\n` : "";
  const ariaRequiredProp = field.required ? `${indent}    aria-required="true"\n` : "";
  const usesReactHookForm = context.formHandlingMode === "react_hook_form";

  if (field.isSelect) {
    registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem", "FormHelperText");
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiFormControl",
      entries: fieldSxEntries
    });
    const fieldSx = sxString(
      withOmittedSxKeys({
        entries: fieldSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiFormControl",
          entries: fieldSxEntries
        })
      })
    );
    const selectLabelId = `${field.key}-label`;
    const selectSxEntries = [
      inputRootStyle,
      outlineStyle ? `"& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }` : undefined
    ].filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));
    const selectSxProp =
      selectSxEntries.length > 0
        ? `${indent}    sx={{
${selectSxEntries.map((entry) => `${indent}      ${entry}`).join(",\n")}
${indent}    }}\n`
        : "";
    if (usesReactHookForm) {
      return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      isSubmitted,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <FormControl
${field.required ? `${indent}        required\n` : ""}${indent}        error={Boolean(helperText)}
${indent}        sx={{ ${fieldSx} }}
${indent}      >
${indent}        <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}        <Select
${indent}          labelId={${literal(selectLabelId)}}
${indent}          label={${literal(field.label)}}
${indent}          value={controllerField.value}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
${indent}          onBlur={controllerField.onBlur}
${indent}          aria-describedby={${literal(helperTextId)}}
${field.required ? `${indent}          aria-required="true"\n` : ""}${indent}          aria-label={${literal(field.label)}}
${selectSxProp}
${indent}        >
${indent}          {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}            <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}          ))}
${indent}        </Select>
${indent}        <FormHelperText id={${literal(helperTextId)}}>{helperText}</FormHelperText>
${indent}      </FormControl>
${indent}    );
${indent}  }}
${indent}/>`;
    }
    return `${indent}<FormControl
${requiredProp}${indent}    error={${fieldErrorExpression}}
${indent}    sx={{ ${fieldSx} }}
${indent}  >
${indent}  <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(selectLabelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}    onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}    aria-describedby={${literal(helperTextId)}}
${ariaRequiredProp}${indent}    aria-label={${literal(field.label)}}
${selectSxProp}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
${indent}  <FormHelperText id={${literal(helperTextId)}}>{${fieldHelperTextExpression}}</FormHelperText>
${indent}</FormControl>`;
  }

  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiTextField",
    entries: fieldSxEntries
  });
  const fieldSx = sxString(
    withOmittedSxKeys({
      entries: fieldSxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiTextField",
        entries: fieldSxEntries
      })
    })
  );
  const placeholderProp = field.placeholder ? `${indent}  placeholder={${literal(field.placeholder)}}\n` : "";
  const typeProp = field.inputType ? `${indent}  type={${literal(field.inputType)}}\n` : "";
  const autoCompleteProp = field.autoComplete ? `${indent}  autoComplete={${literal(field.autoComplete)}}\n` : "";
  const textFieldRequiredProp = field.required ? `${indent}  required\n` : "";
  const slotPropsEntries = [
    endAdornment ? `input: { ${endAdornment} }` : "",
    `htmlInput: { "aria-describedby": ${literal(helperTextId)}${field.required ? ', "aria-required": "true"' : ""} }`,
    `formHelperText: { id: ${literal(helperTextId)} }`
  ]
    .filter((entry) => entry.length > 0)
    .join(`,\n${indent}    `);
  const textFieldSxEntries = [
    fieldSx,
    inputRootStyle ? `"& .MuiOutlinedInput-root": { ${inputRootStyle} }` : undefined,
    outlineStyle ? `"& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }` : undefined,
    inputLabelStyle ? `"& .MuiInputLabel-root": { ${inputLabelStyle} }` : undefined
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));
  const textFieldSxProp =
    textFieldSxEntries.length > 0
      ? `${indent}  sx={{
${textFieldSxEntries.map((entry) => `${indent}    ${entry}`).join(",\n")}
${indent}  }}\n`
      : "";

  const specializedInputMapping = (() => {
    if (element.semanticType === "DatePicker") {
      const mapping = resolveSpecializedComponentMapping({
        context,
        semanticType: element.semanticType
      });
      return mapping && context.datePickerProvider ? mapping : undefined;
    }
    if (ISSUE_693_BANKING_INPUT_TYPES.has(element.semanticType ?? "")) {
      return resolveSpecializedComponentMapping({
        context,
        semanticType: element.semanticType
      });
    }
    return undefined;
  })();

  if (specializedInputMapping) {
    const componentLocalName = registerSpecializedComponentImport({
      context,
      mapping: specializedInputMapping
    });
    const usesSlotProps = !specializedInputMapping.omittedProps.has("slotProps");
    if (field.suffixText && usesSlotProps) {
      registerMuiImports(context, "InputAdornment");
    }
    if (element.semanticType === "DatePicker" && context.datePickerProvider && !context.datePickerProviderResolvedImports) {
      const providerLocalName = registerNamedMappedImport({
        context,
        importedName: context.datePickerProvider.importedName,
        modulePath: context.datePickerProvider.modulePath,
        localName: context.datePickerProvider.localName
      });
      const adapterLocalName = context.datePickerProvider.adapter
        ? registerNamedMappedImport({
            context,
            importedName: context.datePickerProvider.adapter.importedName,
            modulePath: context.datePickerProvider.adapter.modulePath,
            localName: context.datePickerProvider.adapter.localName
          })
        : undefined;
      context.datePickerProviderResolvedImports = {
        providerLocalName,
        ...(adapterLocalName ? { adapterLocalName } : {})
      };
    }
    if (element.semanticType === "DatePicker") {
      context.usesDatePickerProvider = true;
    } else {
      context.requiresChangeEventTypeImport = true;
    }

    const slotPropsExpression = `{
${indent}    ${slotPropsEntries}
${indent}  }`;
    const renderMappedComponent = ({
      valueExpression,
      onChangeExpression,
      onBlurExpression,
      errorExpression,
      helperTextExpression
    }: {
      valueExpression: string;
      onChangeExpression: string;
      onBlurExpression: string;
      errorExpression: string;
      helperTextExpression: string;
    }): string => {
      const propLines: string[] = [];
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "label",
        expression: literal(field.label),
        primitiveValue: field.label
      });
      if (element.semanticType !== "DatePicker" && field.placeholder) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "placeholder",
          expression: literal(field.placeholder),
          primitiveValue: field.placeholder
        });
      }
      if (element.semanticType !== "DatePicker" && field.inputType) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "type",
          expression: literal(field.inputType),
          primitiveValue: field.inputType
        });
      }
      if (element.semanticType !== "DatePicker" && field.autoComplete) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "autoComplete",
          expression: literal(field.autoComplete),
          primitiveValue: field.autoComplete
        });
      }
      if (field.required) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "required",
          expression: "true",
          primitiveValue: true
        });
      }
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "value",
        expression: valueExpression
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "onChange",
        expression: onChangeExpression
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "onBlur",
        expression: onBlurExpression
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "error",
        expression: errorExpression
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "helperText",
        expression: helperTextExpression
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "aria-label",
        expression: literal(field.label)
      });
      appendMappedPropLine({
        lines: propLines,
        mapping: specializedInputMapping,
        sourceName: "aria-describedby",
        expression: literal(helperTextId)
      });
      if (textFieldSxEntries.length > 0) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "sx",
          expression: `{ ${textFieldSxEntries.join(", ")} }`
        });
      }
      if (usesSlotProps) {
        appendMappedPropLine({
          lines: propLines,
          mapping: specializedInputMapping,
          sourceName: "slotProps",
          expression: slotPropsExpression
        });
      }
      return `${indent}<${componentLocalName}
${propLines.map((line) => `${indent}  ${line}`).join("\n")}
${indent}/>`;
    };

    if (usesReactHookForm) {
      const onChangeExpression =
        element.semanticType === "DatePicker"
          ? `(value) => controllerField.onChange(typeof value === "string" ? value : value ? String(value) : "")`
          : `(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)`;
      return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      isSubmitted,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      ${renderMappedComponent({
  valueExpression: "controllerField.value",
  onChangeExpression,
  onBlurExpression: "controllerField.onBlur",
  errorExpression: "Boolean(helperText)",
  helperTextExpression: "helperText"
})}
${indent}    );
${indent}  }}
${indent}/>`;
    }

    const onChangeExpression =
      element.semanticType === "DatePicker"
        ? `(value) => updateFieldValue(${literal(field.key)}, typeof value === "string" ? value : value ? String(value) : "")`
        : `(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue(${literal(field.key)}, event.target.value)`;
    return renderMappedComponent({
      valueExpression: `formValues[${literal(field.key)}] ?? ""`,
      onChangeExpression,
      onBlurExpression: `() => handleFieldBlur(${literal(field.key)})`,
      errorExpression: fieldErrorExpression,
      helperTextExpression: fieldHelperTextExpression
    });
  }

  registerMuiImports(context, "TextField");
  if (field.suffixText) {
    registerMuiImports(context, "InputAdornment");
  }
  context.requiresChangeEventTypeImport = true;
  if (usesReactHookForm) {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      isSubmitted,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <TextField
${indent}        label={${literal(field.label)}}
${field.placeholder ? `${indent}        placeholder={${literal(field.placeholder)}}\n` : ""}${field.inputType ? `${indent}        type={${literal(field.inputType)}}\n` : ""}${field.autoComplete ? `${indent}        autoComplete={${literal(field.autoComplete)}}\n` : ""}${field.required ? `${indent}        required\n` : ""}${indent}        value={controllerField.value}
${indent}        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
${indent}        onBlur={controllerField.onBlur}
${indent}        error={Boolean(helperText)}
${indent}        helperText={helperText}
${indent}        aria-label={${literal(field.label)}}
${indent}        aria-describedby={${literal(helperTextId)}}
${textFieldSxProp}
${indent}        slotProps={{
${indent}          ${slotPropsEntries}
${indent}        }}
${indent}      />
${indent}    );
${indent}  }}
${indent}/>`;
  }
  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${placeholderProp}${typeProp}${autoCompleteProp}${textFieldRequiredProp}${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}  error={${fieldErrorExpression}}
${indent}  helperText={${fieldHelperTextExpression}}
${indent}  aria-label={${literal(field.label)}}
${indent}  aria-describedby={${literal(helperTextId)}}
${textFieldSxProp}
${indent}  slotProps={{
${indent}    ${slotPropsEntries}
${indent}  }}
${indent}/>`;
};

export const renderSemanticAccordion = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const accordionSignals = [
    element.name,
    element.semanticType,
    ...Object.entries(element.variantMapping?.properties ?? {}).flatMap(([key, value]) => [key, value])
  ]
    .join(" ")
    .toLowerCase();
  const indent = "  ".repeat(depth);
  const accordionModel = registerInteractiveAccordion({
    context,
    element,
    defaultExpanded: accordionSignals.includes("collapsed") ? false : true
  });
  const explicitSlots = partitionExplicitAccordionSlots({ element, context });
  const hasExplicitSlots = explicitSlots.hasExplicitSlots;
  const summaryRoot = hasExplicitSlots
    ? explicitSlots.summarySlotRoot ?? element
    : (findFirstByName(element, "muibuttonbaseroot") ?? element.children?.[0] ?? element);
  const summaryContent = hasExplicitSlots
    ? summaryRoot
    : (findFirstByName(summaryRoot, "accordionsummarycontent") ?? summaryRoot);
  const detailsRoot = hasExplicitSlots
    ? explicitSlots.detailsSlotRoot ?? element
    : (findFirstByName(element, "collapsewrapper") ?? element.children?.[1] ?? element);
  const detailsContainer = hasExplicitSlots
    ? detailsRoot
    : (detailsRoot.children?.length === 1 ? (detailsRoot.children[0] ?? detailsRoot) : detailsRoot);

  const renderedSummary = hasExplicitSlots
    ? renderNodesIntoParent({
        nodes: explicitSlots.summaryNodes,
        parent: summaryRoot,
        depth: depth + 3,
        context,
        layoutMode: summaryRoot.layoutMode ?? "NONE"
      })
    : renderChildrenIntoParent({
        element: summaryContent,
        depth: depth + 3,
        context
      });

  const renderedDetails = hasExplicitSlots
    ? renderNodesIntoParent({
        nodes: explicitSlots.detailsNodes,
        parent: detailsContainer,
        depth: depth + 2,
        context,
        layoutMode: detailsContainer.layoutMode ?? "NONE"
      })
    : renderChildrenIntoParent({
        element: detailsContainer,
        depth: depth + 2,
        context
      });

  const summaryFallbackLabel = firstText(summaryContent) ?? firstText(element) ?? "Accordion";
  const expandIconNode = findFirstByName(summaryRoot, "expandiconwrapper") ?? findFirstByName(element, "expandiconwrapper");
  const expandIconPaths = expandIconNode ? collectVectorPaths(expandIconNode) : [];

  let expandIconExpression: string;
  if (expandIconPaths.length > 0) {
    expandIconExpression = renderInlineSvgIcon({
      icon: {
        paths: expandIconPaths,
        color: expandIconNode ? firstVectorColor(expandIconNode) : undefined,
        width: expandIconNode?.width,
        height: expandIconNode?.height
      },
      context,
      extraEntries: [["fontSize", literal("inherit")]]
    });
  } else {
    const expandMoreIcon = registerIconImport(context, {
      localName: "ExpandMoreIcon",
      modulePath: "@mui/icons-material/ExpandMore"
    });
    expandIconExpression = `<${expandMoreIcon} fontSize="small" />`;
  }
  registerMuiImports(context, "Accordion", "AccordionSummary", "Box");

  const detailsWidthRatio =
    typeof detailsContainer.width === "number" &&
    Number.isFinite(detailsContainer.width) &&
    detailsContainer.width > 0 &&
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0
      ? detailsContainer.width / element.width
      : undefined;
  const detailsResponsiveWidth = toPercentLiteralFromRatio(detailsWidthRatio) ?? literal("100%");

  const detailsSx = sxString([
    ["position", literal("relative")],
    ["width", detailsResponsiveWidth],
    ["maxWidth", toPxLiteral(detailsContainer.width)],
    ["minHeight", toPxLiteral(detailsContainer.height)],
    ["display", detailsContainer.layoutMode === "NONE" ? literal("block") : literal("flex")],
    ["flexDirection", detailsContainer.layoutMode === "HORIZONTAL" ? literal("row") : literal("column")],
    [
      "gap",
      detailsContainer.gap && detailsContainer.gap > 0
        ? toSpacingUnitValue({ value: detailsContainer.gap, spacingBase: context.spacingBase })
        : undefined
    ],
    ...toBoxSpacingSxEntries({
      values: detailsContainer.padding,
      spacingBase: context.spacingBase,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: isRtlLocale(context.generationLocale) ? "paddingInlineEnd" : "pr",
      bottomKey: "pb",
      leftKey: isRtlLocale(context.generationLocale) ? "paddingInlineStart" : "pl"
    })
  ]);

  const summarySx = sxString([
    ["minHeight", toPxLiteral(summaryRoot.height)],
    ...toBoxSpacingSxEntries({
      values: summaryRoot.padding,
      spacingBase: context.spacingBase,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: isRtlLocale(context.generationLocale) ? "paddingInlineEnd" : "pr",
      bottomKey: "pb",
      leftKey: isRtlLocale(context.generationLocale) ? "paddingInlineStart" : "pl"
    })
  ]);

  const baseAccordionLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const accordionSx = sxString([
    ...baseAccordionLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAccordionLayoutEntries)
    }),
    ["boxShadow", literal("none")]
  ]);

  const accordionHeaderId = buildAccordionHeaderA11yId(accordionModel.key);
  const accordionPanelId = buildAccordionPanelA11yId(accordionModel.key);
  if (!renderedSummary) {
    registerMuiImports(context, "Typography");
  }
  const detailsBlock =
    !hasExplicitSlots || renderedDetails.trim()
      ? `${indent}  <AccordionDetails id={${literal(accordionPanelId)}} role="region" aria-labelledby={${literal(accordionHeaderId)}} sx={{ p: 0 }}>
${indent}    <Box sx={{ ${detailsSx} }}>
${renderedDetails || `${indent}      <Box />`}
${indent}    </Box>
${indent}  </AccordionDetails>`
      : "";
  if (detailsBlock) {
    registerMuiImports(context, "AccordionDetails");
  }
  return `${indent}<Accordion
${indent}  expanded={accordionState[${literal(accordionModel.key)}] ?? ${accordionModel.defaultExpanded ? "true" : "false"}}
${indent}  onChange={(_, expanded) => updateAccordionState(${literal(accordionModel.key)}, expanded)}
${indent}  disableGutters
${indent}  elevation={0}
${indent}  square
${indent}  sx={{ ${accordionSx}, "&::before": { display: "none" } }}
${indent}>
${indent}  <AccordionSummary id={${literal(accordionHeaderId)}} aria-controls={${literal(accordionPanelId)}} expandIcon={${expandIconExpression}} sx={{ ${summarySx} }}>
${indent}    <Box sx={{ width: "100%", position: "relative", minHeight: ${literal(`${Math.max(20, Math.round(summaryContent.height ?? 24))}px`)} }}>
${renderedSummary || `${indent}      <Typography>{${literal(summaryFallbackLabel)}}</Typography>`}
${indent}    </Box>
${indent}  </AccordionSummary>
${detailsBlock ? `${detailsBlock}\n` : ""}${indent}</Accordion>`;
};

const normalizeCompoundSlotToken = (value: string | undefined): string => {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const CARD_HEADER_SLOT_TOKENS = new Set(["cardheader"]);
const CARD_MEDIA_SLOT_TOKENS = new Set(["cardmedia"]);
const CARD_CONTENT_SLOT_TOKENS = new Set(["cardcontent"]);
const CARD_ACTIONS_SLOT_TOKENS = new Set(["cardactions"]);
const ACCORDION_SUMMARY_SLOT_TOKENS = new Set(["accordionsummary", "accordionheader", "accordionsummarycontent"]);
const ACCORDION_DETAILS_SLOT_TOKENS = new Set(["accordiondetails", "accordioncontent", "collapsewrapper"]);
const RAW_EXPLICIT_SLOT_NAMES = new Set([
  "cardheader",
  "cardmedia",
  "cardcontent",
  "cardactions",
  "accordionsummary",
  "accordionheader",
  "accordionsummarycontent",
  "accordiondetails",
  "accordioncontent",
  "collapsewrapper"
]);

const matchesExplicitCompoundSlot = ({
  element,
  tokens
}: {
  element: ScreenElementIR;
  tokens: ReadonlySet<string>;
}): boolean => {
  const semanticToken = normalizeCompoundSlotToken(element.semanticType);
  if (semanticToken && tokens.has(semanticToken)) {
    return true;
  }
  const normalizedNameToken = normalizeCompoundSlotToken(element.name);
  if (!tokens.has(normalizedNameToken)) {
    return false;
  }
  const rawName = element.name.trim().toLowerCase();
  return rawName.startsWith("_") || rawName.includes("<") || RAW_EXPLICIT_SLOT_NAMES.has(rawName);
};

const toExplicitSlotChildren = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): ScreenElementIR[] => {
  return sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
};

interface PartitionedExplicitCardSlots {
  hasExplicitSlots: boolean;
  headerSlotRoot?: ScreenElementIR;
  mediaSlotRoot?: ScreenElementIR;
  contentSlotRoot?: ScreenElementIR;
  actionsSlotRoot?: ScreenElementIR;
  headerNodes: ScreenElementIR[];
  contentNodes: ScreenElementIR[];
  actionNodes: ScreenElementIR[];
}

const partitionExplicitCardSlots = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): PartitionedExplicitCardSlots => {
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  let hasExplicitSlots = false;
  let headerSlotRoot: ScreenElementIR | undefined;
  let mediaSlotRoot: ScreenElementIR | undefined;
  let contentSlotRoot: ScreenElementIR | undefined;
  let actionsSlotRoot: ScreenElementIR | undefined;
  const headerNodes: ScreenElementIR[] = [];
  const contentNodes: ScreenElementIR[] = [];
  const actionNodes: ScreenElementIR[] = [];

  for (const child of sortedChildren) {
    if (matchesExplicitCompoundSlot({ element: child, tokens: CARD_HEADER_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      headerSlotRoot ??= child;
      headerNodes.push(...toExplicitSlotChildren({ element: child, context }));
      continue;
    }
    if (matchesExplicitCompoundSlot({ element: child, tokens: CARD_MEDIA_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      mediaSlotRoot ??= child;
      continue;
    }
    if (matchesExplicitCompoundSlot({ element: child, tokens: CARD_CONTENT_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      contentSlotRoot ??= child;
      contentNodes.push(...toExplicitSlotChildren({ element: child, context }));
      continue;
    }
    if (matchesExplicitCompoundSlot({ element: child, tokens: CARD_ACTIONS_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      actionsSlotRoot ??= child;
      actionNodes.push(...toExplicitSlotChildren({ element: child, context }));
      continue;
    }
    contentNodes.push(child);
  }

  return {
    hasExplicitSlots,
    ...(headerSlotRoot ? { headerSlotRoot } : {}),
    ...(mediaSlotRoot ? { mediaSlotRoot } : {}),
    ...(contentSlotRoot ? { contentSlotRoot } : {}),
    ...(actionsSlotRoot ? { actionsSlotRoot } : {}),
    headerNodes,
    contentNodes,
    actionNodes
  };
};

interface PartitionedExplicitAccordionSlots {
  hasExplicitSlots: boolean;
  summarySlotRoot?: ScreenElementIR;
  detailsSlotRoot?: ScreenElementIR;
  summaryNodes: ScreenElementIR[];
  detailsNodes: ScreenElementIR[];
}

const partitionExplicitAccordionSlots = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): PartitionedExplicitAccordionSlots => {
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  let hasExplicitSlots = false;
  let summarySlotRoot: ScreenElementIR | undefined;
  let detailsSlotRoot: ScreenElementIR | undefined;
  const summaryNodes: ScreenElementIR[] = [];
  const detailsNodes: ScreenElementIR[] = [];

  for (const child of sortedChildren) {
    if (matchesExplicitCompoundSlot({ element: child, tokens: ACCORDION_SUMMARY_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      summarySlotRoot ??= child;
      summaryNodes.push(...toExplicitSlotChildren({ element: child, context }));
      continue;
    }
    if (matchesExplicitCompoundSlot({ element: child, tokens: ACCORDION_DETAILS_SLOT_TOKENS })) {
      hasExplicitSlots = true;
      detailsSlotRoot ??= child;
      detailsNodes.push(...toExplicitSlotChildren({ element: child, context }));
      continue;
    }
    detailsNodes.push(child);
  }

  return {
    hasExplicitSlots,
    ...(summarySlotRoot ? { summarySlotRoot } : {}),
    ...(detailsSlotRoot ? { detailsSlotRoot } : {}),
    summaryNodes,
    detailsNodes
  };
};

const isCardHeaderAvatarCandidate = (element: ScreenElementIR): boolean => {
  if (element.type === "avatar") {
    return true;
  }
  const nameToken = normalizeCompoundSlotToken(element.name);
  const semanticToken = normalizeCompoundSlotToken(element.semanticType);
  return nameToken.includes("avatar") || semanticToken.includes("avatar");
};

const isCardHeaderActionCandidate = (element: ScreenElementIR): boolean => {
  if (element.type === "button") {
    return true;
  }
  const nameToken = normalizeCompoundSlotToken(element.name);
  const semanticToken = normalizeCompoundSlotToken(element.semanticType);
  return nameToken.includes("action") || nameToken.includes("cta") ||
    semanticToken.includes("action") || semanticToken.includes("cta");
};

const resolveCardHeaderTextNodes = (nodes: ScreenElementIR[]): Array<{ text: string }> => {
  return nodes
    .flatMap((node) => collectTextNodes(node))
    .map((node) => ({ text: node.text.trim() }))
    .filter((node) => node.text.length > 0);
};

const toJsxFragmentPropValue = ({
  content,
  fragmentIndent,
  closingIndent
}: {
  content: string;
  fragmentIndent: string;
  closingIndent: string;
}): string => {
  return `(
${fragmentIndent}<>
${content}
${fragmentIndent}</>
${closingIndent})`;
};

const resolveExplicitCardMediaElement = (slotRoot: ScreenElementIR): ScreenElementIR => {
  const nestedImage = (slotRoot.children ?? []).find((child) => {
    return child.type === "image" || normalizeCompoundSlotToken(child.name).includes("media");
  });
  return nestedImage ?? slotRoot;
};

const subtreeContainsButtonSurfaceType = (
  element: ScreenElementIR,
  targetTypes: ReadonlySet<ScreenElementIR["type"]>
): boolean => {
  if (targetTypes.has(element.type)) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsButtonSurfaceType(child, targetTypes));
};

const isCompositeButtonSurfaceElement = (element: ScreenElementIR): boolean => {
  if (element.type !== "button") {
    return false;
  }
  const meaningfulTextNodes = collectTextNodes(element).filter((node) => /[a-z0-9]/i.test(node.text.trim()));
  if (meaningfulTextNodes.length <= 1) {
    return false;
  }
  const nonTextChildren = (element.children ?? []).filter((child) => child.type !== "text");
  const hasRichNestedNonText = nonTextChildren.some((child) => (child.children?.length ?? 0) > 0);
  const hasEmbeddedSurfaceSemantic = subtreeContainsButtonSurfaceType(
    element,
    new Set<ScreenElementIR["type"]>(["card", "paper", "chip", "avatar", "alert", "badge"])
  );
  return hasEmbeddedSurfaceSemantic || meaningfulTextNodes.length >= 3 || (meaningfulTextNodes.length >= 2 && hasRichNestedNonText);
};

export const renderButton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Button");
  const indent = "  ".repeat(depth);
  const buttonKey = toStateKey(element);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const textNodes = collectTextNodes(element)
    .filter((node) => Boolean(node.text.trim()))
    .sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0));
  const labelNode = textNodes[0];
  const label = labelNode?.text.trim();
  const buttonTextColor = firstTextColor(element);
  const endIconRoot = findFirstByName(element, "buttonendicon");
  const iconNode = pickBestIconNode(element) ?? endIconRoot;
  const isIconOnlyButton = !label && Boolean(iconNode);
  const inferredDisabled = inferButtonDisabled({
    element,
    mappedDisabled: mappedMuiProps?.disabled,
    buttonTextColor
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });

  if (isCompositeButtonSurfaceElement(element)) {
    const surfaceElement = {
      ...element,
      type:
        element.fillColor || element.fillGradient || (element.cornerRadius ?? 0) >= 8 || (element.width ?? 0) >= 160
          ? "card"
          : "paper"
    } as ScreenElementIR;
    if (surfaceElement.type === "card") {
      return renderCard(surfaceElement, depth, parent, context) ?? renderPaper(surfaceElement, depth, parent, context);
    }
    return renderPaper(surfaceElement, depth, parent, context);
  }

  if (iconNode && isIconOnlyButton) {
    registerMuiImports(context, "IconButton");
    const iconColor = resolveIconColor(iconNode) ?? buttonTextColor;
    const baseIconButtonLayoutEntries = baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens,
      generationLocale: context.generationLocale
    });
    const iconButtonSxEntries: Array<[string, string | number | undefined]> = [
      ...baseIconButtonLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseIconButtonLayoutEntries)
      }),
      ["color", toThemeColorLiteral({ color: iconColor, tokens: context.tokens })] as [string, string | number | undefined]
    ];
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiIconButton",
      entries: iconButtonSxEntries
    });
    const iconButtonSx = sxString(
      withOmittedSxKeys({
        entries: iconButtonSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiIconButton",
          entries: iconButtonSxEntries
        })
      })
    );
    const iconButtonSxWithState = appendVariantStateOverridesToSx({
      sx: iconButtonSx,
      element,
      tokens: context.tokens
    });
    const iconExpression = renderFallbackIconExpression({
      element: iconNode,
      parent: { name: endIconRoot?.name ?? element.name },
      context,
      ariaHidden: true,
      extraEntries: [["fontSize", literal("inherit")]]
    });
    const disabledProp = inferredDisabled ? " disabled" : "";
    const ariaLabel = resolveIconButtonAriaLabel({ element, iconNode });
    const linkProps = navigation && !inferredDisabled ? toRouterLinkProps({ navigation, context }) : "";
    return `${indent}<IconButton aria-label=${literal(ariaLabel)}${linkProps}${disabledProp} sx={{ ${iconButtonSxWithState} }}>${iconExpression}</IconButton>`;
  }

  const iconExpression = iconNode
    ? renderFallbackIconExpression({
        element: iconNode,
        parent: { name: endIconRoot?.name ?? element.name },
        context,
        ariaHidden: true,
        extraEntries: [["fontSize", literal("inherit")]]
      })
    : undefined;
  const iconBelongsAtEnd =
    Boolean(iconNode && endIconRoot) ||
    Boolean(
      iconNode &&
        labelNode &&
        typeof iconNode.x === "number" &&
        typeof labelNode.x === "number" &&
        iconNode.x > labelNode.x
    );

  const variant = inferButtonVariant({
    element,
    mappedVariant: mappedMuiProps?.variant
  });
  const buttonLabel = (label ?? element.name).trim() || "Button";
  context.buttons.push({
    key: buttonKey,
    label: buttonLabel,
    preferredSubmit: variant === "contained",
    eligibleForSubmit: !inferredDisabled,
    ...(context.currentFormGroupId ? { formGroupId: context.currentFormGroupId } : {})
  });
  const size = inferButtonSize({
    element,
    mappedSize: mappedMuiProps?.size
  });
  const fullWidth = inferButtonFullWidth({
    element,
    parent
  });

  const baseButtonLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const sxEntries = filterButtonVariantEntries({
    entries: [
      ...baseButtonLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseButtonLayoutEntries)
      }),
      ["fontSize", element.fontSize ? toRemLiteral(element.fontSize) : undefined],
      ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
      ["lineHeight", element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
      ["color", toThemeColorLiteral({ color: buttonTextColor, tokens: context.tokens })],
      ["textTransform", literal("none")],
      ["justifyContent", literal("center")]
    ],
    variant,
    element,
    fullWidth,
    tokens: context.tokens
  });
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiButton",
    entries: sxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: sxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiButton",
        entries: sxEntries
      })
    })
  );

  const sxWithVariantStates = appendVariantStateOverridesToSx({
    sx,
    element,
    tokens: context.tokens
  });
  const mappedColor = mappedMuiProps?.color;
  const colorProp = mappedColor && mappedColor !== "primary" ? ` color="${mappedColor}"` : "";
  const sizeProp = size ? ` size="${size}"` : "";
  const fullWidthProp = fullWidth ? " fullWidth" : "";
  const hasScreenFormFields = context.hasScreenFormFields === true;
  const primarySubmitButtonKey = context.primarySubmitButtonKey ?? "";
  const isPrimarySubmitButton =
    !navigation &&
    !inferredDisabled &&
    hasScreenFormFields &&
    primarySubmitButtonKey === buttonKey;
  const isRhfSubmitButton =
    !navigation &&
    !inferredDisabled &&
    hasScreenFormFields &&
    context.formHandlingMode === "react_hook_form" &&
    isPrimarySubmitButton;
  const disabledProp = inferredDisabled
    ? " disabled"
    : isRhfSubmitButton
      ? " disabled={isSubmitting}"
      : "";
  const startIconProp = iconExpression && !iconBelongsAtEnd ? ` startIcon={${iconExpression}}` : "";
  const endIconProp = iconExpression && iconBelongsAtEnd ? ` endIcon={${iconExpression}}` : "";
  const typeProp = navigation ? "" : isPrimarySubmitButton ? ' type="submit"' : ' type="button"';
  const linkProps = navigation && !inferredDisabled ? toRouterLinkProps({ navigation, context }) : "";

  return `${indent}<Button variant="${variant}"${colorProp}${linkProps}${sizeProp}${fullWidthProp}${disabledProp} disableElevation${typeProp}${startIconProp}${endIconProp} sx={{ ${sxWithVariantStates} }}>{${literal(label ?? element.name)}}</Button>`;
};

export const isPillShapedOutlinedButton = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  const hasStroke = Boolean(element.strokeColor);
  const isPill = (element.cornerRadius ?? 0) >= 32;
  const texts = collectTextNodes(element);
  const hasSingleText = texts.length >= 1 && Boolean(texts[0]?.text.trim());
  const noFill =
    (!element.fillColor || element.fillColor === "#ffffff" || element.fillColor === "#FFFFFF") && !element.fillGradient;
  return hasStroke && isPill && hasSingleText && noFill;
};

export const renderChildrenIntoParent = ({
  element,
  depth,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
}): string => {
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  return children
    .map((child) =>
      renderElement(
        child,
        depth,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
};

export const renderNodesIntoParent = ({
  nodes,
  parent,
  depth,
  context,
  layoutMode = "NONE"
}: {
  nodes: ScreenElementIR[];
  parent: ScreenElementIR;
  depth: number;
  context: RenderContext;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
}): string => {
  const sortedNodes = sortChildren(nodes, layoutMode, {
    generationLocale: context.generationLocale
  });
  return sortedNodes
    .map((node) =>
      renderElement(
        node,
        depth,
        {
          x: parent.x,
          y: parent.y,
          width: parent.width,
          height: parent.height,
          name: parent.name,
          fillColor: parent.fillColor,
          fillGradient: parent.fillGradient,
          layoutMode: parent.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
};

export const SIMPLE_STACK_GEOMETRY_SX_KEYS: Set<string> = new Set([
  "position",
  "left",
  "top",
  "width",
  "maxWidth",
  "height",
  "minHeight"
]);

export const hasResponsiveTopLevelLayoutOverrides = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  return Boolean(context.responsiveTopLevelLayoutOverrides?.[element.id]);
};

export const hasVisibleBorderSignal = (element: ScreenElementIR): boolean => {
  if (!element.strokeColor) {
    return false;
  }
  if (element.strokeWidth === undefined) {
    return true;
  }
  return Number.isFinite(element.strokeWidth) && element.strokeWidth > 0;
};

export const hasDistinctSurfaceFill = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  const normalizedFill = normalizeHexColor(element.fillColor);
  const normalizedPageBackground = context.pageBackgroundColorNormalized;
  if (!normalizedFill || !normalizedPageBackground) {
    return false;
  }
  return normalizedFill !== normalizedPageBackground;
};

export const isElevatedSurfaceContainerForPaper = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type !== "container") {
    return false;
  }
  if ((element.children?.length ?? 0) === 0) {
    return false;
  }
  if (!hasMeaningfulTextDescendants({ element, context })) {
    return false;
  }
  if (hasResponsiveTopLevelLayoutOverrides({ element, context })) {
    return false;
  }

  const hasRoundedSurface = typeof element.cornerRadius === "number" && Number.isFinite(element.cornerRadius) && element.cornerRadius > 0;
  if (!hasRoundedSurface) {
    return false;
  }

  const normalizedElevation = normalizeElevationForSx(element.elevation);
  const hasElevation = typeof normalizedElevation === "number" && normalizedElevation > 0;
  const hasInsetShadow = typeof element.insetShadow === "string" && element.insetShadow.trim().length > 0;
  const hasInsetShadowOnly = hasInsetShadow && !hasElevation;

  const elevatedSurfaceMatch = hasDistinctSurfaceFill({ element, context }) && hasElevation && !hasInsetShadowOnly;
  const outlinedSurfaceMatch = hasVisibleBorderSignal(element) && !hasElevation && !hasInsetShadow;
  return elevatedSurfaceMatch || outlinedSurfaceMatch;
};

const STACK_HANDLED_SX_KEYS: ReadonlySet<string> = new Set([
  "display",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gap"
]);

export const isSimpleFlexContainerForStack = ({
  element
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type !== "container") {
    return false;
  }
  const layoutMode = element.layoutMode ?? "NONE";
  if (layoutMode !== "VERTICAL" && layoutMode !== "HORIZONTAL") {
    return false;
  }
  if ((element.children?.length ?? 0) === 0) {
    return false;
  }
  return true;
};

export const toSimpleStackContainerSx = ({
  element,
  parent,
  context
}: {
  element: ScreenElementIR;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  const baseEntries = baseLayoutEntries(element, parent, {
    includePaints: true,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const responsiveEntries = toResponsiveLayoutMediaEntries({
    baseLayoutMode: element.layoutMode ?? "NONE",
    overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
    spacingBase: context.spacingBase,
    baseValuesByKey: toSxValueMapFromEntries(baseEntries)
  });
  return sxString([
    ...baseEntries.filter(([key]) => !STACK_HANDLED_SX_KEYS.has(key)),
    ...responsiveEntries
  ]);
};

export const hasInterChildDividerPattern = (children: ScreenElementIR[]): boolean => {
  if (children.length < 3) {
    return false;
  }
  let dividerCount = 0;
  let nonDividerCount = 0;
  for (const child of children) {
    if (child.type === "divider") {
      dividerCount += 1;
    } else {
      nonDividerCount += 1;
    }
  }
  return dividerCount >= 1 && nonDividerCount >= 2 && dividerCount >= nonDividerCount - 1;
};

export const renderSimpleFlexContainerAsStack = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  registerMuiImports(context, "Stack");
  const indent = "  ".repeat(depth);
  const layoutMode = element.layoutMode === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
  const direction = layoutMode === "HORIZONTAL" ? "row" : "column";
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 0
      : 0;
  const alignItems = mapCounterAxisAlignToAlignItems(element.counterAxisAlignItems, layoutMode);
  const justifyContent = mapPrimaryAxisAlignToJustifyContent(element.primaryAxisAlignItems);
  const sx = toSimpleStackContainerSx({
    element,
    parent,
    context
  });
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = landmarkRole ? `role="${landmarkRole}"` : undefined;
  const ariaHiddenProp = isDecorative ? 'aria-hidden="true"' : undefined;
  const useDividerProp = hasInterChildDividerPattern(element.children ?? []);
  if (useDividerProp) {
    registerMuiImports(context, "Divider");
  }
  const props = [
    `direction=${literal(direction)}`,
    `spacing={${spacing}}`,
    useDividerProp ? `divider={<Divider flexItem />}` : undefined,
    alignItems ? `alignItems=${literal(alignItems)}` : undefined,
    justifyContent ? `justifyContent=${literal(justifyContent)}` : undefined,
    roleProp,
    ariaHiddenProp,
    sx ? `sx={{ ${sx} }}` : undefined
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
  const filteredElement = useDividerProp
    ? { ...element, children: (element.children ?? []).filter((child) => child.type !== "divider") }
    : element;
  const renderedChildren = renderChildrenIntoParent({
    element: filteredElement,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack ${props} />`;
  }
  return `${indent}<Stack ${props}>
${renderedChildren}
${indent}</Stack>`;
};

export interface RenderedItem {
  id: string;
  label: string;
  node: ScreenElementIR;
}

export interface DetectedTabInterfacePattern {
  tabStripNode: ScreenElementIR;
  tabItems: RenderedItem[];
  panelNodes: ScreenElementIR[];
}

export interface DialogActionModel {
  id: string;
  label: string;
  isPrimary: boolean;
}

export interface DetectedDialogOverlayPattern {
  panelNode: ScreenElementIR;
  title: string | undefined;
  contentNodes: ScreenElementIR[];
  actionModels: DialogActionModel[];
}


export const renderListFromRows = ({
  element,
  rows,
  hasInterItemDivider,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  rows: ListRowAnalysis[];
  hasInterItemDivider: boolean;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  registerMuiImports(context, "List", "ListItem", "ListItemText");
  if (rows.some((row) => Boolean(row.leadingIconNode))) {
    registerMuiImports(context, "ListItemIcon");
  }
  if (rows.some((row) => Boolean(row.leadingAvatarNode))) {
    registerMuiImports(context, "ListItemAvatar", "Avatar");
  }
  if (hasInterItemDivider) {
    registerMuiImports(context, "Divider");
  }

  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedItems = rows
    .map((row, index) => {
      const listNavigation = resolvePrototypeNavigationBinding({ element: row.node, context });
      const secondaryActionExpression = toListSecondaryActionExpression({
        actionNode: row.trailingActionNode,
        context
      });
      const secondaryActionProp = secondaryActionExpression ? ` secondaryAction={${secondaryActionExpression}}` : "";
      const avatarBlock = row.leadingAvatarNode
        ? `<ListItemAvatar><Avatar>${(() => {
            const avatarText = firstText(row.leadingAvatarNode)?.trim();
            return avatarText ? `{${literal(avatarText)}}` : "";
          })()}</Avatar></ListItemAvatar>`
        : "";
      const iconBlock = row.leadingIconNode
        ? `<ListItemIcon>${renderFallbackIconExpression({
            element: row.leadingIconNode,
            parent: { name: row.node.name },
            context,
            ariaHidden: true
          })}</ListItemIcon>`
        : "";
      const textProps = row.secondaryText
        ? ` primary={${literal(row.primaryText)}} secondary={${literal(row.secondaryText)}}`
        : ` primary={${literal(row.primaryText)}}`;
      const textBlock = `<ListItemText${textProps} />`;
      const content = `${avatarBlock}${iconBlock}${textBlock}`;
      if (listNavigation) {
        registerMuiImports(context, "ListItemButton");
      }
      const linkProps = listNavigation ? toRouterLinkProps({ navigation: listNavigation, context }) : "";
      const itemBody = listNavigation ? `<ListItemButton${linkProps}>${content}</ListItemButton>` : content;
      const dividerBlock = hasInterItemDivider && index < rows.length - 1 ? `\n${indent}  <Divider component="li" />` : "";
      return `${indent}  <ListItem key={${literal(row.node.id)}} disablePadding${secondaryActionProp}>${itemBody}</ListItem>${dividerBlock}`;
    })
    .join("\n");
  return `${indent}<List sx={{ ${sx} }}>
${renderedItems}
${indent}</List>`;
};

export const collectRenderedItems = (element: ScreenElementIR, generationLocale?: string): RenderedItem[] => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  return sortChildren(element.children ?? [], element.layoutMode ?? "NONE", sortOptions)
    .map((child, index) => ({
      id: child.id || `${element.id}-item-${index + 1}`,
      label: firstText(child)?.trim() || child.name || `Item ${index + 1}`,
      node: child
    }))
    .filter((entry) => entry.label.trim().length > 0);
};

export const collectRenderedItemLabels = (element: ScreenElementIR, generationLocale?: string): Array<{ id: string; label: string }> => {
  return collectRenderedItems(element, generationLocale).map((item) => ({
    id: item.id,
    label: item.label
  }));
};

const TABLE_CONTROL_NAME_HINTS = [
  "styled(div)",
  "muiinput",
  "textfield",
  "muiselect",
  "muislider"
] as const;

const hasSliderSemanticDescendant = (element: ScreenElementIR): boolean => {
  return (
    subtreeContainsElementType(element, "slider") ||
    hasSubtreeName(element, "muislider") ||
    hasSubtreeName(element, "slider rail") ||
    hasSubtreeName(element, "slider track") ||
    hasSubtreeName(element, "slider thumb") ||
    hasSubtreeName(element, "slider section")
  );
};

const hasNamedControlDescendant = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  if (TABLE_CONTROL_NAME_HINTS.some((hint) => loweredName.includes(hint))) {
    return true;
  }
  return (element.children ?? []).some((child) => hasNamedControlDescendant(child));
};

const tableRowsContainInteractiveControls = (rows: ScreenElementIR[][]): boolean => {
  const controlLikeRowCount = rows.filter((row) =>
    row.some(
      (cell) =>
        subtreeContainsElementType(cell, "input") ||
        subtreeContainsElementType(cell, "select") ||
        subtreeContainsElementType(cell, "slider") ||
        hasNamedControlDescendant(cell)
    )
  ).length;
  return controlLikeRowCount >= Math.min(2, rows.length);
};

const shouldSuppressInputContainerRendering = (element: ScreenElementIR): boolean => {
  const directInteractiveChildCount = (element.children ?? []).filter((child) => {
    if (child.type === "input" || child.type === "select" || child.type === "slider" || child.type === "image") {
      return true;
    }
    return hasNamedControlDescendant(child);
  }).length;
  return (
    directInteractiveChildCount > 1 ||
    hasSliderSemanticDescendant(element) ||
    subtreeContainsElementType(element, "image")
  );
};

const isLikelySimpleButtonBaseSurface = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  const loweredName = element.name.toLowerCase();
  if (!loweredName.includes("buttonbase")) {
    return false;
  }
  if (!hasMeaningfulTextDescendants({ element, context })) {
    return false;
  }
  if (
    subtreeContainsElementType(element, "input") ||
    subtreeContainsElementType(element, "select") ||
    subtreeContainsElementType(element, "slider") ||
    subtreeContainsElementType(element, "image")
  ) {
    return false;
  }
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  if (width <= 0 || height <= 0 || width > 360 || height > 88) {
    return false;
  }
  const textNodes = collectTextNodes(element).filter((node) => node.text.trim().length > 0);
  return textNodes.length >= 1 && textNodes.length <= 2;
};

interface IconOnlyStepperPattern {
  readonly children: readonly ScreenElementIR[];
}

const isStepperConnectorNode = (element: ScreenElementIR): boolean => {
  if (element.type === "divider") {
    return true;
  }
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const longestSide = Math.max(width, height);
  const shortestSide = Math.min(width, height);
  if (longestSide <= 0 || shortestSide <= 0) {
    return false;
  }
  const aspectRatio = longestSide / shortestSide;
  return shortestSide <= 4 && aspectRatio >= 4 && !hasNamedControlDescendant(element);
};

const isStepperIconNode = (element: ScreenElementIR): boolean => {
  return (
    isIconLikeNode(element) ||
    isVectorGraphicNode(element) ||
    isSemanticIconWrapper(element) ||
    Boolean(pickBestIconNode(element))
  );
};

const detectIconOnlyStepperPattern = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): IconOnlyStepperPattern | undefined => {
  if (element.type !== "container" && element.type !== "stepper") {
    return undefined;
  }
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "HORIZONTAL", {
    generationLocale: context.generationLocale
  });
  if (children.length < 3 || hasMeaningfulTextDescendants({ element, context })) {
    return undefined;
  }
  let iconCount = 0;
  let connectorCount = 0;
  for (const child of children) {
    if (isStepperConnectorNode(child)) {
      connectorCount += 1;
      continue;
    }
    if (isStepperIconNode(child)) {
      iconCount += 1;
      continue;
    }
    return undefined;
  }
  if (iconCount < 2 || connectorCount === 0) {
    return undefined;
  }
  return { children };
};

const renderIconOnlyStepper = ({
  element,
  depth,
  parent,
  context,
  pattern
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  pattern: IconOnlyStepperPattern;
}): string => {
  registerMuiImports(context, "Box", "Stack");
  const indent = "  ".repeat(depth);
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 0.5
      : 0.5;
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const renderedChildren = pattern.children
    .map((child) => {
      if (isStepperConnectorNode(child)) {
        const connectorColor = child.fillColor ?? child.strokeColor ?? element.strokeColor ?? element.fillColor ?? "#d7d7d7";
        const connectorWidth = toPxLiteral(child.width ?? child.height ?? 24) ?? literal("24px");
        const connectorHeight = toPxLiteral(Math.max(1, Math.min(child.height ?? child.width ?? 2, 4))) ?? literal("2px");
        return `${indent}  <Box aria-hidden="true" sx={{ width: ${connectorWidth}, height: ${connectorHeight}, bgcolor: ${toThemeColorLiteral({ color: connectorColor, tokens: context.tokens })}, borderRadius: 999 }} />`;
      }
      const iconNode = isStepperIconNode(child) && !pickBestIconNode(child) ? child : (pickBestIconNode(child) ?? child);
      return `${indent}  ${renderFallbackIconExpression({
        element: iconNode,
        parent: { name: child.name },
        context,
        ariaHidden: true,
        extraEntries: [
          ["width", toPxLiteral(child.width ?? iconNode.width)],
          ["height", toPxLiteral(child.height ?? iconNode.height)],
          ["display", literal("block")]
        ]
      }).trim()}`;
    })
    .join("\n");
  return `${indent}<Stack direction="row" spacing={${spacing}} alignItems="center" sx={{ ${sx} }}>
${renderedChildren}
${indent}</Stack>`;
};


export const renderGridLayout = ({
  element,
  depth,
  parent,
  context,
  includePaints,
  equalColumns = false,
  columnCountHint
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  includePaints: boolean;
  equalColumns?: boolean;
  columnCountHint?: number;
}): string | null => {
  const items = collectRenderedItems(element, context.generationLocale);
  if (items.length < 2) {
    return null;
  }

  registerMuiImports(context, "Grid");
  const indent = "  ".repeat(depth);
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 2
      : 2;
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints
  });

  const normalizedChildWidths = items.map((item) => Math.max(1, item.node.width ?? 0));
  const totalChildWidth = normalizedChildWidths.reduce((total, width) => total + width, 0);
  const normalizedColumnHint =
    typeof columnCountHint === "number" && Number.isFinite(columnCountHint) && columnCountHint > 0
      ? Math.min(Math.max(1, Math.round(columnCountHint)), items.length)
      : items.length;
  const referenceRowWidth =
    normalizedColumnHint > 1 && items.length > normalizedColumnHint
      ? Math.max(1, totalChildWidth / Math.max(1, Math.ceil(items.length / normalizedColumnHint)))
      : Math.max(1, totalChildWidth);

  const renderedItems = items
    .map((item, index) => {
      const fallbackWidth = normalizedChildWidths[index] ?? 1;
      const mdSize = equalColumns
        ? clamp(Math.round(12 / normalizedColumnHint), 1, 12)
        : clamp(Math.round((fallbackWidth / referenceRowWidth) * 12), 1, 12);
      const smSize = normalizedColumnHint <= 2 ? mdSize : Math.max(6, mdSize);
      const childContent = renderElement(
        item.node,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      );
      const resolvedChildContent = childContent ?? (() => {
        registerMuiImports(context, "Box");
        return `${indent}    <Box />`;
      })();
      return `${indent}  <Grid key={${literal(item.id)}} size={{ xs: 12, sm: ${smSize}, md: ${mdSize} }}>
${resolvedChildContent}
${indent}  </Grid>`;
    })
    .join("\n");

  return `${indent}<Grid container spacing={${spacing}} sx={{ ${sx} }}>
${renderedItems}
${indent}</Grid>`;
};

export const renderCard = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const loweredName = element.name.toLowerCase();
  if (loweredName.includes("muicardcontentroot")) {
    return renderContainerFallback({
      element,
      depth,
      parent,
      context
    });
  }
  if (!shouldSuppressInputContainerRendering(element) && isLikelyInputContainer(element)) {
    return renderSemanticInput(element, depth, parent, context);
  }
  if ((element.children?.length ?? 0) === 0 && !hasVisualStyle(element)) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Card");
  const indent = "  ".repeat(depth);
  const cardElevation = normalizeElevationForSx(element.elevation);
  const cardDefaults = context.themeComponentDefaults?.MuiCard;
  const omitSxKeys = new Set<string>();
  if (
    matchesRoundedInteger({
      value: element.cornerRadius,
      target: cardDefaults?.borderRadiusPx
    })
  ) {
    omitSxKeys.add("borderRadius");
  }
  const omitDefaultElevation =
    typeof cardElevation === "number" &&
    cardElevation > 0 &&
    typeof cardDefaults?.elevation === "number" &&
    cardDefaults.elevation === cardElevation;
  if (omitDefaultElevation) {
    omitSxKeys.add("boxShadow");
  }
  const baseCardLayoutEntries = baseLayoutEntries(element, parent, {
    preferInsetShadow: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const cardSxEntries = [
    ...baseCardLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseCardLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiCard",
    entries: cardSxEntries
  });
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiCard",
    entries: cardSxEntries
  })) {
    omitSxKeys.add(key);
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: cardSxEntries,
      keys: omitSxKeys
    })
  );
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const elevationProp = typeof cardElevation === "number" && cardElevation > 0 && !omitDefaultElevation ? ` elevation={${cardElevation}}` : "";
  const explicitSlots = partitionExplicitCardSlots({ element, context });
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const mediaCandidate = explicitSlots.hasExplicitSlots
    ? (explicitSlots.mediaSlotRoot ? resolveExplicitCardMediaElement(explicitSlots.mediaSlotRoot) : undefined)
    : sortedChildren.find((child) => child.type === "image" || child.name.toLowerCase().includes("media"));
  const mediaLayoutElement = explicitSlots.mediaSlotRoot ?? mediaCandidate;
  const actionCandidates = explicitSlots.hasExplicitSlots
    ? explicitSlots.actionNodes
    : sortedChildren.filter((child) => {
        if (child.type === "button") {
          return true;
        }
        const childLoweredName = child.name.toLowerCase();
        return childLoweredName.includes("action") || childLoweredName.includes("cta");
      });
  const bodyChildren = explicitSlots.hasExplicitSlots
    ? explicitSlots.contentNodes
    : sortedChildren.filter((child) => {
        if (child.id === mediaCandidate?.id) {
          return false;
        }
        return !actionCandidates.some((candidate) => candidate.id === child.id);
      });

  let headerBlock = "";
  if (explicitSlots.hasExplicitSlots && explicitSlots.headerNodes.length > 0) {
    const headerRoot = explicitSlots.headerSlotRoot ?? element;
    const avatarCandidate = explicitSlots.headerNodes.find((child) => isCardHeaderAvatarCandidate(child));
    const headerActionCandidate = explicitSlots.headerNodes.find((child) => {
      return child.id !== avatarCandidate?.id && isCardHeaderActionCandidate(child);
    });
    const headerBodyNodes = explicitSlots.headerNodes.filter((child) => {
      return child.id !== avatarCandidate?.id && child.id !== headerActionCandidate?.id;
    });
    const renderedAvatar = avatarCandidate
      ? renderElement(avatarCandidate, depth + 4, headerRoot, context)?.trim() ?? ""
      : "";
    const renderedHeaderAction = headerActionCandidate
      ? renderElement(headerActionCandidate, depth + 4, headerRoot, context)?.trim() ?? ""
      : "";
    const renderedHeaderBody = headerBodyNodes.length > 0
      ? renderNodesIntoParent({
          nodes: headerBodyNodes,
          parent: headerRoot,
          depth: depth + 4,
          context,
          layoutMode: headerRoot.layoutMode ?? "NONE"
        }).trim()
      : "";
    const headerTextNodes = resolveCardHeaderTextNodes(headerBodyNodes);
    const hasComplexHeaderStructure = headerBodyNodes.some((child) => child.type !== "text") || headerTextNodes.length > 2;
    const headerProps: string[] = [];
    if (renderedHeaderBody) {
      if (!hasComplexHeaderStructure && headerTextNodes.length > 0) {
        headerProps.push(`${indent}    title={${literal(headerTextNodes[0]?.text ?? "")}}`);
        if (headerTextNodes[1]) {
          headerProps.push(`${indent}    subheader={${literal(headerTextNodes[1].text)}}`);
        }
      } else {
        headerProps.push(
          `${indent}    title={${toJsxFragmentPropValue({
            content: renderedHeaderBody,
            fragmentIndent: `${indent}      `,
            closingIndent: `${indent}    `
          })}}`
        );
      }
    }
    if (renderedAvatar) {
      headerProps.push(
        `${indent}    avatar={${toJsxFragmentPropValue({
          content: renderedAvatar,
          fragmentIndent: `${indent}      `,
          closingIndent: `${indent}    `
        })}}`
      );
    }
    if (renderedHeaderAction) {
      headerProps.push(
        `${indent}    action={${toJsxFragmentPropValue({
          content: renderedHeaderAction,
          fragmentIndent: `${indent}      `,
          closingIndent: `${indent}    `
        })}}`
      );
    }
    if (headerProps.length > 0) {
      registerMuiImports(context, "CardHeader");
      headerBlock = `${indent}  <CardHeader\n${headerProps.join("\n")}\n${indent}  />`;
    }
  }

  const contentParent = explicitSlots.contentSlotRoot ?? element;
  const actionsParent = explicitSlots.actionsSlotRoot ?? element;
  const renderedChildren = explicitSlots.hasExplicitSlots
    ? renderNodesIntoParent({
        nodes: bodyChildren,
        parent: contentParent,
        depth: depth + 2,
        context,
        layoutMode: contentParent.layoutMode ?? "NONE"
      })
    : renderChildrenIntoParent({
        element: {
          ...element,
          children: bodyChildren
        },
        depth: depth + 2,
        context
      });
  const renderedActions = explicitSlots.hasExplicitSlots
    ? renderNodesIntoParent({
        nodes: actionCandidates,
        parent: actionsParent,
        depth: depth + 2,
        context,
        layoutMode: actionsParent.layoutMode ?? "NONE"
      })
    : renderChildrenIntoParent({
        element: {
          ...element,
          children: actionCandidates
        },
        depth: depth + 2,
        context
      });
  const contentBlock = renderedChildren.trim()
    ? (() => {
        registerMuiImports(context, "CardContent");
        return `${indent}  <CardContent>\n${renderedChildren}\n${indent}  </CardContent>`;
      })()
    : explicitSlots.hasExplicitSlots
      ? ""
      : (() => {
          registerMuiImports(context, "CardContent");
          return `${indent}  <CardContent />`;
        })();
  const mediaSx = mediaLayoutElement
    ? sxString([
        ["height", toPxLiteral(mediaLayoutElement.height ?? mediaCandidate?.height ?? 140)],
        ["objectFit", literal("cover")],
        ["display", literal("block")]
      ])
    : undefined;
  const mediaBlock = mediaCandidate && mediaLayoutElement
    ? (() => {
        registerMuiImports(context, "CardMedia");
        const mediaLabel = resolveElementA11yLabel({ element: mediaCandidate, fallback: "Image" });
        const mediaSource = resolveImageSource({
          element: mediaCandidate,
          context,
          fallbackLabel: mediaLabel
        });
        const mediaPerfAttrs = toImagePerformanceAttrs(mediaCandidate);
        if (isDecorativeImageElement(mediaCandidate)) {
          return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt="" aria-hidden="true"${mediaPerfAttrs} sx={{ ${mediaSx} }} />`;
        }
        return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt={${literal(mediaLabel)}}${mediaPerfAttrs} sx={{ ${mediaSx} }} />`;
      })()
    : "";
  const actionsBlock = renderedActions.trim()
    ? (() => {
        registerMuiImports(context, "CardActions");
        return `${indent}  <CardActions>\n${renderedActions}\n${indent}  </CardActions>`;
      })()
    : "";
  const semanticContainerProps = resolveSemanticContainerProps({ element, context });
  const roleProp = navigationProps?.roleProp ?? semanticContainerProps.roleProp;
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const componentProp = semanticContainerProps.componentProp;
  const ariaLabelProp = navigationProps ? "" : semanticContainerProps.ariaLabelProp;
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  const cardChildren = [headerBlock, mediaBlock, contentBlock, actionsBlock].filter((block) => block.trim().length > 0).join("\n");
  return `${indent}<Card${componentProp}${elevationProp}${roleProp}${ariaLabelProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${sxProp}>
${cardChildren}
${indent}</Card>`;
};

export const renderChip = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Chip");
  const indent = "  ".repeat(depth);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const chipDefaults = context.themeComponentDefaults?.MuiChip;
  const baseChipLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const chipLayoutEntries = [
    ...baseChipLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseChipLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiChip",
    entries: chipLayoutEntries
  });
  const chipMatchedDefaultKeys = collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiChip",
    entries: chipLayoutEntries
  });
  const chipSxEntries = withOmittedSxKeys({
    entries: chipLayoutEntries,
    keys: new Set<string>([
      ...chipMatchedDefaultKeys,
      ...(matchesRoundedInteger({
        value: element.cornerRadius,
        target: chipDefaults?.borderRadiusPx
      })
        ? ["borderRadius"]
        : [])
    ])
  });
  const sx = appendVariantStateOverridesToSx({
    sx: sxString(chipSxEntries),
    element,
    tokens: context.tokens
  });
  const label = firstText(element)?.trim() || element.name;
  const chipVariant = toChipVariant(mappedMuiProps?.variant);
  const chipSize = toChipSize(mappedMuiProps?.size);
  const isThemeDefaultChipSize = chipSize && chipDefaults?.size ? chipSize === chipDefaults.size : false;
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const variantProp = chipVariant ? ` variant="${chipVariant}"` : "";
  const sizeProp = chipSize && !isThemeDefaultChipSize ? ` size="${chipSize}"` : "";
  const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
  const linkProps = navigation && !mappedMuiProps?.disabled ? toRouterLinkProps({ navigation, context }) : "";
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Chip label={${literal(label)}}${linkProps}${variantProp}${sizeProp}${disabledProp}${sxProp} />`;
};

export const renderSelectionControl = ({
  element,
  depth,
  parent,
  context,
  componentName
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  componentName: "Switch" | "Checkbox" | "Radio";
}): string | null => {
  const nonTextChildCount = (element.children ?? []).filter((child) => child.type !== "text").length;
  if (nonTextChildCount > 1) {
    return renderContainer(element, depth, parent, context);
  }
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  if (componentName === "Radio") {
    const options = collectRenderedItems(element, context.generationLocale);
    if (options.length > 1) {
      registerMuiImports(context, "RadioGroup", "FormControlLabel", "Radio");
      const renderedOptions = options
        .map(
          (option, index) =>
            `${indent}  <FormControlLabel value=${literal(option.id)} control={<Radio />} label={${literal(option.label)}} />${
              index === options.length - 1 ? "" : ""
            }`
        )
        .join("\n");
      return `${indent}<RadioGroup defaultValue=${literal(options[0]?.id ?? "")} sx={{ ${sx} }}>
${renderedOptions}
${indent}</RadioGroup>`;
    }
  }
  const label = firstText(element)?.trim();
  registerMuiImports(context, componentName);
  if (label) {
    registerMuiImports(context, "FormControlLabel");
    return `${indent}<FormControlLabel sx={{ ${sx} }} control={<${componentName} />} label={${literal(label)}} />`;
  }
  return `${indent}<${componentName} sx={{ ${sx} }} />`;
};

export const renderList = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const collectedRows = collectListRows(element, context.generationLocale);
  if (collectedRows.rowNodes.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  const rows = collectedRows.rowNodes.map((row) =>
    analyzeListRow({
      row,
      generationLocale: context.generationLocale
    })
  );
  return renderListFromRows({
    element,
    rows,
    hasInterItemDivider: collectedRows.hasInterItemDivider,
    depth,
    parent,
    context
  });
};

export const isLikelyAppBarToolbarActionNode = ({
  node,
  context
}: {
  node: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (node.type === "button" || node.type === "navigation" || node.type === "tab") {
    return true;
  }
  if (node.prototypeNavigation) {
    return true;
  }
  if (isIconLikeNode(node) || isVectorGraphicNode(node) || isSemanticIconWrapper(node) || Boolean(pickBestIconNode(node))) {
    return true;
  }
  return hasInteractiveDescendants({ element: node, context });
};

export interface AppBarToolbarActionModel {
  node: ScreenElementIR;
  iconNode: ScreenElementIR;
  ariaLabel: string;
}

export const renderStructuredAppBarToolbarChildren = ({
  element,
  depth,
  context,
  fallbackTitle
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
  fallbackTitle: string;
}): string | undefined => {
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  if (children.length === 0) {
    return undefined;
  }

  const titleNode =
    children.find((child) => isTextElement(child) && Boolean(child.text.trim())) ??
    children.find((child) => {
      if (isLikelyAppBarToolbarActionNode({ node: child, context })) {
        return false;
      }
      return hasMeaningfulTextDescendants({ element: child, context });
    });
  const title = titleNode ? firstText(titleNode)?.trim() : fallbackTitle;
  if (!title) {
    return undefined;
  }
  const titleHasStructuredBranding =
    titleNode !== undefined &&
    !isTextElement(titleNode) &&
    (Boolean(pickBestIconNode(titleNode)) ||
      (titleNode.children ?? []).some((child) => child.type !== "text" && !isDecorativeElement({ element: child, context })));
  if (titleHasStructuredBranding) {
    return undefined;
  }

  const nonTitleChildren = children.filter((child) => child.id !== titleNode?.id);
  if (
    nonTitleChildren.some((child) =>
      hasMeaningfulTextDescendants({
        element: child,
        context
      })
    )
  ) {
    return undefined;
  }

  const toolbarActions = nonTitleChildren
    .map((child) => {
      if (!isLikelyAppBarToolbarActionNode({ node: child, context })) {
        return undefined;
      }
      const iconNode = isIconLikeNode(child) || isVectorGraphicNode(child) || isSemanticIconWrapper(child) ? child : pickBestIconNode(child);
      if (!iconNode) {
        return undefined;
      }
      return {
        node: child,
        iconNode,
        ariaLabel: resolveIconButtonAriaLabel({
          element: child,
          iconNode
        })
      } satisfies AppBarToolbarActionModel;
    })
    .filter((action): action is AppBarToolbarActionModel => Boolean(action));

  if (toolbarActions.length === 0) {
    return undefined;
  }

  const unstructuredChildren = children.filter(
    (child) => child.id !== titleNode?.id && !toolbarActions.some((action) => action.node.id === child.id)
  );
  if (unstructuredChildren.length > 0) {
    return undefined;
  }

  registerMuiImports(context, "IconButton");
  const indent = "  ".repeat(depth);
  const renderedActions = toolbarActions
    .map((action) => {
      const navigation = resolvePrototypeNavigationBinding({ element: action.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      const iconExpression = renderFallbackIconExpression({
        element: action.iconNode,
        parent: { name: action.node.name },
        context,
        ariaHidden: true,
        extraEntries: [["fontSize", literal("inherit")]]
      });
      return `${indent}    <IconButton edge="end" aria-label={${literal(action.ariaLabel)}}${linkProps}>${iconExpression}</IconButton>`;
    })
    .join("\n");
  return `${indent}    <Typography variant="h6" sx={{ flexGrow: 1 }}>{${literal(title)}}</Typography>\n${renderedActions}`;
};

export const renderAppBar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "AppBar", "Toolbar", "Typography");
  const indent = "  ".repeat(depth);
  const appBarDefaults = context.themeComponentDefaults?.MuiAppBar;
  const appBarBackgroundMatchesDefault =
    normalizeHexColor(element.fillColor) !== undefined &&
    normalizeHexColor(element.fillColor) === normalizeHexColor(appBarDefaults?.backgroundColor);
  const baseAppBarLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const appBarSxEntries = [
    ...baseAppBarLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAppBarLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiAppBar",
    entries: appBarSxEntries
  });
  const appBarMatchedDefaultKeys = collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiAppBar",
    entries: appBarSxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: appBarSxEntries,
      keys: new Set<string>([
        ...appBarMatchedDefaultKeys,
        ...(appBarBackgroundMatchesDefault ? ["bgcolor"] : [])
      ])
    })
  );
  const fallbackTitle = firstText(element)?.trim() || element.name || "App";
  const structuredToolbarChildren = renderStructuredAppBarToolbarChildren({
    element,
    depth,
    context,
    fallbackTitle
  });
  const renderedChildren =
    structuredToolbarChildren ??
    renderChildrenIntoParent({
      element,
      depth: depth + 2,
      context
    });
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<AppBar component="header" role="banner" position="static"${sxProp}>
${indent}  <Toolbar>
${renderedChildren || `${indent}    <Typography variant="h6">{${literal(fallbackTitle)}}</Typography>`}
${indent}  </Toolbar>
${indent}</AppBar>`;
};

export const renderTabs = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext,
  detectedPattern?: DetectedTabInterfacePattern
): string | null => {
  const resolvedPattern = detectedPattern;
  const tabItems =
    resolvedPattern?.tabItems ??
    collectRenderedItems(element, context.generationLocale).filter((action) =>
      isRenderableTabAction({
        action,
        context
      })
    );
  if (tabItems.length === 0) {
    return renderContainer(element, depth, parent, context);
  }

  const tabsStateModel = ensureTabsStateModel({
    element,
    context
  });
  const tabValueVar = `tabValue${tabsStateModel.stateId}`;
  const tabChangeHandlerVar = `handleTabChange${tabsStateModel.stateId}`;
  const tabStripNode = resolvedPattern?.tabStripNode ?? element;
  const panelNodes = resolvedPattern?.panelNodes ?? [];

  registerMuiImports(context, "Tabs", "Tab");
  if (panelNodes.length === tabItems.length && panelNodes.length > 0) {
    registerMuiImports(context, "Box");
  }
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element: tabStripNode,
    parent,
    context
  });
  const tabsLabel = resolveElementA11yLabel({ element, fallback: "Tabs" });
  const hasPanels = panelNodes.length === tabItems.length && panelNodes.length > 0;
  const renderedTabs = tabItems
    .map((tab, index) => {
      const navigation = resolvePrototypeNavigationBinding({ element: tab.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      const tabId = buildTabA11yId(tabsStateModel.stateId, index);
      const panelId = hasPanels ? buildTabPanelA11yId(tabsStateModel.stateId, index) : undefined;
      const ariaControlsProp = panelId ? ` aria-controls={${literal(panelId)}}` : "";
      return `${indent}  <Tab key={${literal(tab.id)}} id={${literal(tabId)}} value={${index}} label={${literal(tab.label)}}${ariaControlsProp}${linkProps} />`;
    })
    .join("\n");
  const renderedPanels =
    hasPanels
      ? panelNodes
          .map((panelNode, index) => {
            const panelContent =
              renderElement(
                panelNode,
                depth + 2,
                {
                  x: element.x,
                  y: element.y,
                  width: element.width,
                  height: element.height,
                  name: element.name,
                  fillColor: element.fillColor,
                  fillGradient: element.fillGradient,
                  layoutMode: element.layoutMode ?? "NONE"
                },
                context
              ) ?? `${indent}    <Box />`;
            const panelId = buildTabPanelA11yId(tabsStateModel.stateId, index);
            const tabId = buildTabA11yId(tabsStateModel.stateId, index);
            return `${indent}  <Box key={${literal(panelNode.id)}} id={${literal(panelId)}} role="tabpanel" aria-labelledby={${literal(tabId)}} hidden={${tabValueVar} !== ${index}} sx={{ pt: 2 }}>
${panelContent}
${indent}  </Box>`;
          })
          .join("\n")
      : "";
  return `${indent}<Tabs value={${tabValueVar}} onChange={${tabChangeHandlerVar}} aria-label={${literal(tabsLabel)}} sx={{ ${sx} }}>
${renderedTabs}
${indent}</Tabs>${renderedPanels ? `\n${renderedPanels}` : ""}`;
};

export const renderDialog = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext,
  detectedPattern?: DetectedDialogOverlayPattern
): string | null => {
  const dialogStateModel = ensureDialogStateModel({
    element,
    context
  });
  const dialogOpenVar = `isDialogOpen${dialogStateModel.stateId}`;
  const dialogCloseHandlerVar = `handleDialogClose${dialogStateModel.stateId}`;
  const indent = "  ".repeat(depth);

  if (detectedPattern) {
    registerMuiImports(context, "Dialog", "DialogTitle", "DialogContent");
    if (detectedPattern.actionModels.length > 0) {
      registerMuiImports(context, "DialogActions", "Button");
    }
    const sx = toElementSx({
      element: detectedPattern.panelNode,
      parent: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        name: element.name,
        fillColor: element.fillColor,
        fillGradient: element.fillGradient,
        layoutMode: element.layoutMode ?? "NONE"
      },
      context
    });
    const renderedContent = renderNodesIntoParent({
      nodes: detectedPattern.contentNodes,
      parent: detectedPattern.panelNode,
      depth: depth + 2,
      context,
      layoutMode: detectedPattern.panelNode.layoutMode ?? "NONE"
    });
    const contentBlock = renderedContent.trim()
      ? `${indent}  <DialogContent>\n${renderedContent}\n${indent}  </DialogContent>`
      : `${indent}  <DialogContent />`;
    const renderedActions =
      detectedPattern.actionModels.length > 0
        ? detectedPattern.actionModels
            .map((actionModel) => {
              const variantProp = actionModel.isPrimary ? ' variant="contained"' : "";
              return `${indent}    <Button key={${literal(actionModel.id)}} onClick={${dialogCloseHandlerVar}}${variantProp}>{${literal(actionModel.label)}}</Button>`;
            })
            .join("\n")
        : "";
    const actionsBlock = renderedActions ? `\n${indent}  <DialogActions>\n${renderedActions}\n${indent}  </DialogActions>` : "";
    const dialogTitleId = detectedPattern.title ? `dialog-title-${dialogStateModel.stateId}` : undefined;
    const ariaLabelledByProp = dialogTitleId ? ` aria-labelledby={${literal(dialogTitleId)}}` : "";
    return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}}${ariaLabelledByProp} aria-modal="true" sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${detectedPattern.title ? `${indent}  <DialogTitle id={${literal(dialogTitleId!)}}>{${literal(detectedPattern.title)}}</DialogTitle>\n` : ""}${contentBlock}${actionsBlock}
${indent}</Dialog>`;
  }

  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 2,
    context
  });
  const title = firstText(element)?.trim();
  if (!renderedChildren.trim() && !title) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Dialog", "DialogTitle", "DialogContent");
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const contentBlock = renderedChildren.trim()
    ? `${indent}  <DialogContent>\n${renderedChildren}\n${indent}  </DialogContent>`
    : `${indent}  <DialogContent />`;
  const fallbackDialogTitleId = title ? `dialog-title-${dialogStateModel.stateId}` : undefined;
  const fallbackAriaLabelledByProp = fallbackDialogTitleId ? ` aria-labelledby={${literal(fallbackDialogTitleId)}}` : "";
  return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}}${fallbackAriaLabelledByProp} aria-modal="true" sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${title ? `${indent}  <DialogTitle id={${literal(fallbackDialogTitleId!)}}>{${literal(title)}}</DialogTitle>\n` : ""}${contentBlock}
${indent}</Dialog>`;
};

export const renderStepper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const steps = collectRenderedItemLabels(element, context.generationLocale);
  if (steps.length === 0) {
    const iconOnlyStepperPattern = detectIconOnlyStepperPattern({ element, context });
    if (iconOnlyStepperPattern) {
      return renderIconOnlyStepper({
        element,
        depth,
        parent,
        context,
        pattern: iconOnlyStepperPattern
      });
    }
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Stepper", "Step", "StepLabel");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedSteps = steps
    .map((step, index) => `${indent}  <Step key={${literal(step.id)}} completed={${index < 1 ? "true" : "false"}}><StepLabel>{${literal(step.label)}}</StepLabel></Step>`)
    .join("\n");
  return `${indent}<Stepper activeStep={0} sx={{ ${sx} }}>
${renderedSteps}
${indent}</Stepper>`;
};

export const renderProgress = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const isLinear = width >= Math.max(48, height * 2);
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  if (isLinear) {
    registerMuiImports(context, "LinearProgress");
    return `${indent}<LinearProgress variant="determinate" value={65} aria-live="polite" aria-label="Loading" sx={{ ${sx} }} />`;
  }
  registerMuiImports(context, "CircularProgress");
  return `${indent}<CircularProgress variant="determinate" value={65} aria-live="polite" aria-label="Loading" sx={{ ${sx} }} />`;
};

export const renderAvatar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const content = firstText(element)?.trim();
  if (!content && !hasVisualStyle(element) && (element.children?.length ?? 0) === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Avatar");
  const indent = "  ".repeat(depth);
  const avatarDefaults = context.themeComponentDefaults?.MuiAvatar;
  const baseAvatarLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const avatarSxEntries = [
    ...baseAvatarLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAvatarLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiAvatar",
    entries: avatarSxEntries
  });
  const hasRelativeWidthLogic = avatarSxEntries.some(([key, value]) => key === "maxWidth" && value !== undefined);
  const omitSxKeys = new Set<string>();
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiAvatar",
    entries: avatarSxEntries
  })) {
    omitSxKeys.add(key);
  }
  if (
    matchesRoundedInteger({
      value: element.cornerRadius,
      target: avatarDefaults?.borderRadiusPx
    })
  ) {
    omitSxKeys.add("borderRadius");
  }
  if (
    !hasRelativeWidthLogic &&
    matchesRoundedInteger({
      value: element.width,
      target: avatarDefaults?.widthPx
    })
  ) {
    omitSxKeys.add("width");
  }
  if (
    !hasRelativeWidthLogic &&
    matchesRoundedInteger({
      value: element.height,
      target: avatarDefaults?.heightPx
    })
  ) {
    omitSxKeys.add("height");
    omitSxKeys.add("minHeight");
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: avatarSxEntries,
      keys: omitSxKeys
    })
  );
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Avatar${sxProp}>${content ? `{${literal(content)}}` : ""}</Avatar>`;
};

export const renderBadge = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Badge", "Box");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const badgeContent = firstText(element)?.trim() || " ";
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  return `${indent}<Badge badgeContent={${literal(badgeContent)}} color="primary" sx={{ ${sx} }}>
${renderedChildren || `${indent}  <Box sx={{ width: "20px", height: "20px" }} />`}
${indent}</Badge>`;
};

export const renderDividerElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Divider");
  const indent = "  ".repeat(depth);
  const dividerDefaultColor = context.themeComponentDefaults?.MuiDivider?.borderColor;
  const matchesDefaultBorderColor =
    normalizeHexColor(element.fillColor) !== undefined &&
    normalizeHexColor(element.fillColor) === normalizeHexColor(dividerDefaultColor);
  const baseDividerLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const dividerSxEntries: Array<[string, string | number | undefined]> = [
    ...baseDividerLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseDividerLayoutEntries)
    }),
    [
      "borderColor",
      !matchesDefaultBorderColor ? toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens }) : undefined
    ] as [string, string | number | undefined]
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiDivider",
    entries: dividerSxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: dividerSxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiDivider",
        entries: dividerSxEntries
      })
    })
  );
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Divider aria-hidden="true"${sxProp} />`;
};

export const renderNavigation = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const actions = collectRenderedItems(element, context.generationLocale);
  if (actions.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "BottomNavigation", "BottomNavigationAction");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedActions = actions
    .map((action, index) => {
      const navigation = resolvePrototypeNavigationBinding({ element: action.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      return `${indent}  <BottomNavigationAction key={${literal(action.id)}} value={${index}} label={${literal(action.label)}}${linkProps} />`;
    })
    .join("\n");
  const navLabel = resolveElementA11yLabel({ element, fallback: "Navigation" });
  return `${indent}<BottomNavigation component="nav" role="navigation" aria-label={${literal(navLabel)}} showLabels value={0} sx={{ ${sx} }}>
${renderedActions}
${indent}</BottomNavigation>`;
};

/**
 * Renders a CSS Grid layout using Box with display: "grid" sx props.
 * Used when the detection identifies spanning cells, asymmetric columns,
 * or named grid areas — patterns that require true CSS Grid rather than
 * MUI's flex-based Grid component.
 */
export const renderCssGridLayout = ({
  element,
  depth,
  parent,
  context,
  cssGridDetection
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  cssGridDetection: {
    gridTemplateColumns?: string[];
    gridTemplateRows?: string[];
    childSpans?: Map<number, { columnStart: number; columnEnd: number; rowStart: number; rowEnd: number }>;
  };
}): string | null => {
  const children = element.children ?? [];
  if (children.length < 2) {
    return null;
  }

  registerMuiImports(context, "Box");
  const indent = "  ".repeat(depth);
  const gap =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 2
      : 2;

  const baseSx = toElementSx({
    element,
    parent,
    context,
    includePaints: true
  });

  // Build CSS Grid sx properties
  const gridSxParts: string[] = [`display: "grid"`];
  if (cssGridDetection.gridTemplateColumns && cssGridDetection.gridTemplateColumns.length > 0) {
    gridSxParts.push(`gridTemplateColumns: "${cssGridDetection.gridTemplateColumns.join(" ")}"`);
  }
  if (cssGridDetection.gridTemplateRows && cssGridDetection.gridTemplateRows.length > 0) {
    gridSxParts.push(`gridTemplateRows: "${cssGridDetection.gridTemplateRows.join(" ")}"`);
  }
  gridSxParts.push(`gap: ${gap}`);

  const combinedSx = baseSx
    ? `${gridSxParts.join(", ")}, ${baseSx}`
    : gridSxParts.join(", ");

  const renderedChildren = children
    .map((child, index) => {
      const span = cssGridDetection.childSpans?.get(index);
      const gridArea = child.cssGridHints?.gridArea;
      const childContent = renderElement(
        child,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      );
      const resolvedChildContent = childContent ?? (() => {
        registerMuiImports(context, "Box");
        return `${indent}    <Box />`;
      })();

      // Build child placement sx
      const childSxParts: string[] = [];
      if (gridArea) {
        childSxParts.push(`gridArea: "${gridArea}"`);
      } else if (span && (span.columnEnd - span.columnStart > 1 || span.rowEnd - span.rowStart > 1)) {
        if (span.columnEnd - span.columnStart > 1) {
          childSxParts.push(`gridColumn: "${span.columnStart} / ${span.columnEnd}"`);
        }
        if (span.rowEnd - span.rowStart > 1) {
          childSxParts.push(`gridRow: "${span.rowStart} / ${span.rowEnd}"`);
        }
      }

      if (childSxParts.length > 0) {
        return `${indent}  <Box sx={{ ${childSxParts.join(", ")} }}>
${resolvedChildContent}
${indent}  </Box>`;
      }
      return resolvedChildContent;
    })
    .join("\n");

  return `${indent}<Box sx={{ ${combinedSx} }}>
${renderedChildren}
${indent}</Box>`;
};

export const renderGrid = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  // Try CSS Grid first for complex layouts (spanning, asymmetric, named areas)
  const cssGridDetection = detectCssGridLayout(element);
  if (cssGridDetection) {
    const cssGridRendered = renderCssGridLayout({
      element,
      depth,
      parent,
      context,
      cssGridDetection
    });
    if (cssGridRendered) {
      return cssGridRendered;
    }
  }

  // Fall back to MUI Grid for simple layouts
  const rendered = renderGridLayout({
    element,
    depth,
    parent,
    context,
    includePaints: false
  });
  if (rendered) {
    return rendered;
  }
  return renderContainer(element, depth, parent, context);
};

const resolveSemanticContainerProps = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): {
  componentProp: string;
  roleProp: string;
  ariaLabelProp: string;
} => {
  const descriptor = resolveSemanticContainerDescriptor({ element, context });
  if (!descriptor) {
    return {
      componentProp: "",
      roleProp: "",
      ariaLabelProp: ""
    };
  }
  const ariaLabelProp =
    descriptor.component === "nav"
      ? ` aria-label={${literal(resolveElementA11yLabel({ element, fallback: "Navigation" }))}}`
      : "";
  return {
    componentProp: descriptor.component ? ` component="${descriptor.component}"` : "",
    roleProp: descriptor.role ? ` role="${descriptor.role}"` : "",
    ariaLabelProp
  };
};

export const renderStack = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  if ((element.children?.length ?? 0) === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Stack");
  const indent = "  ".repeat(depth);
  const direction = element.layoutMode === "HORIZONTAL" ? "row" : "column";
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 0
      : 0;
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const semanticContainerProps = resolveSemanticContainerProps({ element, context });
  const roleProp = landmarkRole ? ` role="${landmarkRole}"` : semanticContainerProps.roleProp;
  const ariaHiddenProp = isDecorative ? ' aria-hidden="true"' : "";
  const componentProp = semanticContainerProps.componentProp;
  const ariaLabelProp = semanticContainerProps.ariaLabelProp;
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack${componentProp} direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaLabelProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }
  return `${indent}<Stack${componentProp} direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaLabelProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Stack>`;
};

export const renderPaper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  if (!shouldSuppressInputContainerRendering(element) && isLikelyInputContainer(element)) {
    return renderSemanticInput(element, depth, parent, context);
  }
  if (isLikelySimpleButtonBaseSurface({ element, context })) {
    return renderButton(element, depth, parent, context);
  }
  registerMuiImports(context, "Paper");
  const indent = "  ".repeat(depth);
  const elevation = normalizeElevationForSx(element.elevation);
  const paperDefaults = context.themeComponentDefaults?.MuiPaper;
  const omitDefaultElevation =
    typeof elevation === "number" &&
    elevation > 0 &&
    typeof paperDefaults?.elevation === "number" &&
    paperDefaults.elevation === elevation;
  const variant = elevation && elevation > 0 ? undefined : element.strokeColor ? "outlined" : undefined;
  const basePaperLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const paperSxEntries = [
    ...basePaperLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(basePaperLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiPaper",
    entries: paperSxEntries
  });
  const omitPaperKeys = new Set<string>();
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiPaper",
    entries: paperSxEntries
  })) {
    omitPaperKeys.add(key);
  }
  if (omitDefaultElevation) {
    omitPaperKeys.add("boxShadow");
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: paperSxEntries,
      keys: omitPaperKeys
    })
  );
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  const elevationProp = typeof elevation === "number" && elevation > 0 && !omitDefaultElevation ? ` elevation={${elevation}}` : "";
  const variantProp = variant ? ` variant="${variant}"` : "";
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const semanticContainerProps = resolveSemanticContainerProps({ element, context });
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : semanticContainerProps.roleProp);
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";
  const componentProp = semanticContainerProps.componentProp;
  const ariaLabelProp = navigationProps ? "" : semanticContainerProps.ariaLabelProp;
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  if (!renderedChildren.trim()) {
    return `${indent}<Paper${componentProp}${elevationProp}${variantProp}${roleProp}${ariaLabelProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp} />`;
  }
  return `${indent}<Paper${componentProp}${elevationProp}${variantProp}${roleProp}${ariaLabelProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp}>
${renderedChildren}
${indent}</Paper>`;
};

export const subtreeContainsElementType = (element: ScreenElementIR, targetType: ScreenElementIR["type"]): boolean => {
  if (element.type === targetType) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsElementType(child, targetType));
};

export const renderTable = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const rows = sortChildren(element.children ?? [], element.layoutMode ?? "VERTICAL", {
    generationLocale: context.generationLocale
  })
    .map((row) => {
      const rowChildren = sortChildren(row.children ?? [], row.layoutMode ?? "HORIZONTAL", {
        generationLocale: context.generationLocale
      });
      if (rowChildren.length === 0) {
        return [row];
      }
      return rowChildren;
    })
    .filter((row) => row.length > 0);
  if (rows.length < 2 || rows.some((row) => row.length < 2)) {
    return renderContainer(element, depth, parent, context);
  }
  if (tableRowsContainInteractiveControls(rows) || hasNamedControlDescendant(element)) {
    return renderContainerFallback({
      element,
      depth,
      parent,
      context
    });
  }
  const containsImageCell = rows.some((row) => row.some((cell) => subtreeContainsElementType(cell, "image")));
  if (containsImageCell) {
    // Keep rich cell content (for example exported image assets) instead of flattening cells to plain strings.
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Table", "TableHead", "TableBody", "TableRow", "TableCell");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const headerCells = rows[0] ?? [];
  const bodyRows = rows.slice(1);
  const renderedHead = headerCells
    .map((cell) => `${indent}      <TableCell>{${literal(firstText(cell)?.trim() || cell.name)}}</TableCell>`)
    .join("\n");
  const renderedBody = bodyRows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => `${indent}      <TableCell>{${literal(firstText(cell)?.trim() || cell.name || `Row ${rowIndex + 1}`)}}</TableCell>`)
        .join("\n");
      return `${indent}    <TableRow>\n${cells}\n${indent}    </TableRow>`;
    })
    .join("\n");
  return `${indent}<Table size="small" sx={{ ${sx} }}>
${indent}  <TableHead>
${indent}    <TableRow>
${renderedHead}
${indent}    </TableRow>
${indent}  </TableHead>
${indent}  <TableBody>
${renderedBody}
${indent}  </TableBody>
${indent}</Table>`;
};

export const renderTooltipElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Tooltip", "Box");
  const indent = "  ".repeat(depth);
  const title = firstText(element)?.trim() || element.name || "Info";
  const anchorNode = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  })[0];
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const anchorContent = anchorNode
    ? renderElement(
        anchorNode,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    : `${indent}    <Box sx={{ width: "24px", height: "24px" }} />`;
  return `${indent}<Tooltip title={${literal(title)}}>
${indent}  <Box sx={{ ${sx} }}>
${anchorContent}
${indent}  </Box>
${indent}</Tooltip>`;
};

export const renderDrawer = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Drawer", "Box");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 2,
    context
  });
  const drawerLabel = resolveElementA11yLabel({ element, fallback: "Navigation drawer" });
  return `${indent}<Drawer open variant="persistent" aria-label={${literal(drawerLabel)}} slotProps={{ paper: { role: "navigation" } }} sx={{ "& .MuiDrawer-paper": { ${sx} } }}>
${indent}  <Box sx={{ width: "100%" }}>
${renderedChildren || `${indent}    <Box />`}
${indent}  </Box>
${indent}</Drawer>`;
};

export const renderBreadcrumbs = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const crumbs = collectRenderedItemLabels(element, context.generationLocale);
  if (crumbs.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Breadcrumbs", "Typography");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const renderedCrumbs = crumbs
    .map((crumb, index) => {
      const color = index === crumbs.length - 1 ? "text.primary" : "text.secondary";
      return `${indent}  <Typography key={${literal(crumb.id)}} color=${literal(color)}>{${literal(crumb.label)}}</Typography>`;
    })
    .join("\n");
  return `${indent}<Breadcrumbs sx={{ ${sx} }}>
${renderedCrumbs}
${indent}</Breadcrumbs>`;
};

export const renderSlider = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Slider");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Slider defaultValue={65} valueLabelDisplay="auto" sx={{ ${sx} }} />`;
};

export const renderSelectElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  const key = toStateKey(element);
  const existing = context.fields.find((field) => field.key === key);
  const optionsFromChildren = collectRenderedItems(element, context.generationLocale)
    .map((item) => sanitizeSelectOptionValue(item.label))
    .filter((value) => value.length > 0);
  const ownText = isTextElement(element) ? element.text.trim() : element.text?.trim();
  const fallbackDefault = sanitizeSelectOptionValue(ownText || firstText(element)?.trim() || "Option 1");
  const options =
    optionsFromChildren.length > 0
      ? [...new Set(optionsFromChildren)]
      : deriveSelectOptions(fallbackDefault, context.generationLocale);
  const rawLabel = firstText(element)?.trim() || element.name;
  const required = inferRequiredFromLabel(rawLabel);
  const sanitizedLabel = required ? sanitizeRequiredLabel(rawLabel) : rawLabel;
  const label = sanitizedLabel.length > 0 ? sanitizedLabel : rawLabel;
  const hasVisualErrorExample = inferVisualErrorFromOutline(element);
  const field: InteractiveFieldModel =
    existing ??
    (() => {
      const created: InteractiveFieldModel = {
        key,
        label,
        defaultValue: options[0] ?? fallbackDefault,
        isSelect: true,
        options,
        ...(required ? { required } : {}),
        ...(hasVisualErrorExample ? { hasVisualErrorExample } : {})
      };
      context.fields.push(created);
      return created;
    })();
  registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem", "FormHelperText");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const labelId = `${field.key}-label`;
  const helperTextId = `${field.key}-helper-text`;
  const fieldErrorExpression = `(Boolean((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? ""))`;
  const fieldHelperTextExpression = `((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? "")`;
  const requiredProp = field.required ? `${indent}  required\n` : "";
  const ariaRequiredProp = field.required ? `${indent}    aria-required="true"\n` : "";
  if (context.formHandlingMode === "react_hook_form") {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      isSubmitted,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <FormControl
${field.required ? `${indent}        required\n` : ""}${indent}        error={Boolean(helperText)}
${indent}        sx={{ ${sx} }}
${indent}      >
${indent}        <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}        <Select
${indent}          labelId={${literal(labelId)}}
${indent}          label={${literal(field.label)}}
${indent}          value={controllerField.value}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
${indent}          onBlur={controllerField.onBlur}
${indent}          aria-describedby={${literal(helperTextId)}}
${field.required ? `${indent}          aria-required="true"\n` : ""}${indent}          aria-label={${literal(field.label)}}
${indent}        >
${indent}          {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}            <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}          ))}
${indent}        </Select>
${indent}        <FormHelperText id={${literal(helperTextId)}}>{helperText}</FormHelperText>
${indent}      </FormControl>
${indent}    );
${indent}  }}
${indent}/>`;
  }
  return `${indent}<FormControl
${requiredProp}${indent}  error={${fieldErrorExpression}}
${indent}  sx={{ ${sx} }}
${indent}>
${indent}  <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(labelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}    onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}    aria-describedby={${literal(helperTextId)}}
${ariaRequiredProp}${indent}    aria-label={${literal(field.label)}}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
${indent}  <FormHelperText id={${literal(helperTextId)}}>{${fieldHelperTextExpression}}</FormHelperText>
${indent}</FormControl>`;
};

export const renderRatingElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Rating");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Rating defaultValue={4} precision={0.5} sx={{ ${sx} }} />`;
};

export const renderSnackbar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Snackbar", "Alert");
  const indent = "  ".repeat(depth);
  const message = firstText(element)?.trim() || element.name || "Hinweis";
  const severity = toAlertSeverityFromName(element.name);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "center" }} role="status" aria-live="polite">
${indent}  <Alert severity="${severity}" sx={{ ${sx} }}>{${literal(message)}}</Alert>
${indent}</Snackbar>`;
};

export const renderAlertElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  registerMuiImports(context, "Alert");
  const indent = "  ".repeat(depth);
  const message = firstText(element)?.trim() || element.name || "Hinweis";
  const severity = toAlertSeverityFromName(element.name);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Alert severity="${severity}" sx={{ ${sx} }}>{${literal(message)}}</Alert>`;
};

export const renderSkeleton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Skeleton");
  const indent = "  ".repeat(depth);
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const variant = height <= 24 ? "text" : width >= Math.max(24, height * 1.8) ? "rectangular" : "circular";
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Skeleton aria-hidden="true" variant="${variant}" sx={{ ${sx} }} />`;
};

const ABOVE_THE_FOLD_Y_THRESHOLD = 600;

export const isAboveTheFoldImage = (element: ScreenElementIR): boolean => {
  if (typeof element.y !== "number") {
    return true;
  }
  return element.y < ABOVE_THE_FOLD_Y_THRESHOLD;
};

const toImagePerformanceAttrs = (element: ScreenElementIR): string => {
  const aboveFold = isAboveTheFoldImage(element);
  const dimensionAttrs =
    typeof element.width === "number" && typeof element.height === "number"
      ? ` width={${Math.round(element.width)}} height={${Math.round(element.height)}}`
      : "";
  if (aboveFold) {
    return ` decoding="async" fetchPriority="high"${dimensionAttrs}`;
  }
  return ` loading="lazy" decoding="async"${dimensionAttrs}`;
};

export const renderImageElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Box");
  const indent = "  ".repeat(depth);
  const baseImageLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const sx = sxString([
    ...baseImageLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseImageLayoutEntries)
    }),
    ["objectFit", literal("cover")],
    ["display", literal("block")]
  ]);
  const ariaLabel = resolveElementA11yLabel({ element, fallback: "Image" });
  const src = resolveImageSource({
    element,
    context,
    fallbackLabel: ariaLabel
  });
  const perfAttrs = toImagePerformanceAttrs(element);
  if (isDecorativeImageElement(element)) {
    return `${indent}<Box component="img" src={${literal(src)}} alt="" aria-hidden="true"${perfAttrs} sx={{ ${sx} }} />`;
  }
  return `${indent}<Box component="img" src={${literal(src)}} alt={${literal(ariaLabel)}}${perfAttrs} sx={{ ${sx} }} />`;
};

export interface ElementRenderStrategyInput {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}

export interface ContainerRenderStrategyMatch {
  matched: true;
  rendered: string | null;
}

export type ContainerRenderStrategy = (input: ElementRenderStrategyInput) => ContainerRenderStrategyMatch | undefined;
export type ElementRenderStrategy = (input: ElementRenderStrategyInput) => string | null;
export type PreDispatchRenderStrategy = (input: ElementRenderStrategyInput) => string | null | undefined;

export const asContainerStrategyMatch = (rendered: string | null): ContainerRenderStrategyMatch => {
  return {
    matched: true,
    rendered
  };
};

export const renderContainerIconWrapper = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | undefined => {
  if (
    !(isIconLikeNode(element) || isVectorGraphicNode(element) || isSemanticIconWrapper(element)) ||
    hasMeaningfulTextDescendants({ element, context })
  ) {
    return undefined;
  }
  const baseIconWrapperLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const iconExpression = renderFallbackIconExpression({
    element,
    parent,
    context,
    ariaHidden: true,
    extraEntries: [
      ...baseIconWrapperLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseIconWrapperLayoutEntries)
      }),
      ["display", literal("flex")],
      ["alignItems", literal("center")],
      ["justifyContent", literal("center")]
    ]
  });
  const indent = "  ".repeat(depth);
  return `${indent}${iconExpression}`;
};

export const tryRenderAccordionContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isLikelyAccordionContainer(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderSemanticAccordion(element, depth, parent, context));
};

export const tryRenderSliderSectionContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (element.type !== "container" || !hasSliderSemanticDescendant(element)) {
    return undefined;
  }
  if (element.layoutMode === "VERTICAL" || element.layoutMode === "HORIZONTAL") {
    return asContainerStrategyMatch(renderSimpleFlexContainerAsStack({ element, depth, parent, context }));
  }
  return asContainerStrategyMatch(renderContainerFallback({ element, depth, parent, context }));
};

export const tryRenderInputContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (shouldSuppressInputContainerRendering(element)) {
    return undefined;
  }
  if (!isLikelyInputContainer(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderSemanticInput(element, depth, parent, context));
};

export const tryRenderPillShapedButtonContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isPillShapedOutlinedButton(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderButton(element, depth, parent, context));
};

export const tryRenderButtonBaseContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isLikelySimpleButtonBaseSurface({ element, context })) {
    return undefined;
  }
  return asContainerStrategyMatch(renderButton(element, depth, parent, context));
};

export const tryRenderIconOnlyStepperContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  const detectedPattern = detectIconOnlyStepperPattern({ element, context });
  if (!detectedPattern) {
    return undefined;
  }
  return asContainerStrategyMatch(
    renderIconOnlyStepper({
      element,
      depth,
      parent,
      context,
      pattern: detectedPattern
    })
  );
};

export const tryRenderIconLikeContainer: ContainerRenderStrategy = (input) => {
  const renderedIconWrapper = renderContainerIconWrapper(input);
  if (renderedIconWrapper === undefined) {
    return undefined;
  }
  return asContainerStrategyMatch(renderedIconWrapper);
};

export const tryRenderGridLikeContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  // Try CSS Grid first for containers with spanning/asymmetric patterns
  const cssGridDetection = detectCssGridLayout(element);
  if (cssGridDetection) {
    const cssGridRendered = renderCssGridLayout({
      element,
      depth,
      parent,
      context,
      cssGridDetection
    });
    if (cssGridRendered) {
      return asContainerStrategyMatch(cssGridRendered);
    }
  }

  // Fall back to MUI Grid for simpler grid patterns
  const detectedGridLayout = detectGridLikeContainerLayout(element);
  if (!detectedGridLayout) {
    return undefined;
  }
  const renderedGrid = renderGridLayout({
    element,
    depth,
    parent,
    context,
    includePaints: true,
    equalColumns: detectedGridLayout.mode === "equal-row",
    columnCountHint: detectedGridLayout.columnCount
  });
  if (!renderedGrid) {
    return undefined;
  }
  return asContainerStrategyMatch(renderedGrid);
};

export const tryRenderPaperSurfaceContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isElevatedSurfaceContainerForPaper({ element, context })) {
    return undefined;
  }
  return asContainerStrategyMatch(renderPaper(element, depth, parent, context));
};

export const tryRenderRepeatedListContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  const detectedListPattern = detectRepeatedListPattern({
    element,
    generationLocale: context.generationLocale
  });
  if (!detectedListPattern) {
    return undefined;
  }
  return asContainerStrategyMatch(
    renderListFromRows({
      element,
      rows: detectedListPattern.rows,
      hasInterItemDivider: detectedListPattern.hasInterItemDivider,
      depth,
      parent,
      context
    })
  );
};

export const tryRenderSimpleFlexContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isSimpleFlexContainerForStack({ element, context })) {
    return undefined;
  }
  return asContainerStrategyMatch(
    renderSimpleFlexContainerAsStack({
      element,
      depth,
      parent,
      context
    })
  );
};

export const CONTAINER_RENDER_STRATEGIES: readonly ContainerRenderStrategy[] = [
  tryRenderAccordionContainer,
  tryRenderSliderSectionContainer,
  tryRenderInputContainer,
  tryRenderPillShapedButtonContainer,
  tryRenderButtonBaseContainer,
  tryRenderIconOnlyStepperContainer,
  tryRenderIconLikeContainer,
  tryRenderGridLikeContainer,
  tryRenderPaperSurfaceContainer,
  tryRenderRepeatedListContainer,
  tryRenderSimpleFlexContainer
];

export const renderContainerFallback = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | null => {
  const indent = "  ".repeat(depth);
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });

  const renderedChildren = children
    .map((child) =>
      renderElement(
        child,
        depth + 1,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const isDivider = (element.height ?? 0) <= 2 && Boolean(element.fillColor) && !children.length;
  if (isDivider) {
    const dividerDefaultColor = context.themeComponentDefaults?.MuiDivider?.borderColor;
    const matchesDefaultBorderColor =
      normalizeHexColor(element.fillColor) !== undefined &&
      normalizeHexColor(element.fillColor) === normalizeHexColor(dividerDefaultColor);
    const baseDividerLayoutEntries = baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens,
      generationLocale: context.generationLocale
    });
    const dividerSxEntries: Array<[string, string | number | undefined]> = [
      ...baseDividerLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseDividerLayoutEntries)
      }),
      [
        "borderColor",
        !matchesDefaultBorderColor ? toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens }) : undefined
      ] as [string, string | number | undefined]
    ];
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiDivider",
      entries: dividerSxEntries
    });
    const sx = sxString(
      withOmittedSxKeys({
        entries: dividerSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiDivider",
          entries: dividerSxEntries
        })
      })
    );
    registerMuiImports(context, "Divider");
    const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
    return `${indent}<Divider aria-hidden="true"${sxProp} />`;
  }

  const sx = toElementSx({
    element,
    parent,
    context
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const semanticContainerProps = resolveSemanticContainerProps({ element, context });
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : semanticContainerProps.roleProp);
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";
  const componentProp = semanticContainerProps.componentProp;
  const ariaLabelProp = navigationProps ? "" : semanticContainerProps.ariaLabelProp;

  if (!renderedChildren.trim()) {
    if (!hasVisualStyle(element) && !navigation) {
      return null;
    }
    registerMuiImports(context, "Box");
    return `${indent}<Box${componentProp}${roleProp}${ariaLabelProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }

  registerMuiImports(context, "Box");
  return `${indent}<Box${componentProp}${roleProp}${ariaLabelProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Box>`;
};

export const renderContainer = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const strategyInput: ElementRenderStrategyInput = {
    element,
    depth,
    parent,
    context
  };
  for (const strategy of CONTAINER_RENDER_STRATEGIES) {
    const result = strategy(strategyInput);
    if (result?.matched) {
      return result.rendered;
    }
  }
  return renderContainerFallback(strategyInput);
};

export const runElementPreDispatchStrategies = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | null | undefined => {
  const preDispatchStrategies: readonly PreDispatchRenderStrategy[] = [
    ({ element, depth, parent, context }) => {
      const navigationBarPattern = detectNavigationBarPattern({
        element,
        depth,
        parent,
        context
      });
      if (navigationBarPattern === "appbar") {
        return renderAppBar(element, depth, parent, context);
      }
      if (navigationBarPattern === "navigation") {
        return renderNavigation(element, depth, parent, context);
      }
      return undefined;
    },
    ({ element, depth, parent, context }) => {
      const tabInterfacePattern = detectTabInterfacePattern({
        element,
        depth,
        context
      });
      if (!tabInterfacePattern) {
        return undefined;
      }
      return renderTabs(element, depth, parent, context, tabInterfacePattern);
    },
    ({ element, depth, parent, context }) => {
      const dialogOverlayPattern = detectDialogOverlayPattern({
        element,
        depth,
        parent,
        context
      });
      if (!dialogOverlayPattern) {
        return undefined;
      }
      return renderDialog(element, depth, parent, context, dialogOverlayPattern);
    }
  ];
  for (const strategy of preDispatchStrategies) {
    const rendered = strategy({
      element,
      depth,
      parent,
      context
    });
    if (rendered !== undefined) {
      return rendered;
    }
  }
  return undefined;
};

export const elementRenderStrategies: Partial<Record<ScreenElementIR["type"], ElementRenderStrategy>> = {
  text: ({ element, depth, parent, context }) =>
    isTextElement(element) ? renderText(element, depth, parent, context) : renderContainer(element, depth, parent, context),
  accordion: ({ element, depth, parent, context }) => renderSemanticAccordion(element, depth, parent, context),
  input: ({ element, depth, parent, context }) => renderSemanticInput(element, depth, parent, context),
  select: ({ element, depth, parent, context }) => renderSelectElement(element, depth, parent, context),
  button: ({ element, depth, parent, context }) => renderButton(element, depth, parent, context),
  grid: ({ element, depth, parent, context }) => renderGrid(element, depth, parent, context),
  stack: ({ element, depth, parent, context }) => renderStack(element, depth, parent, context),
  paper: ({ element, depth, parent, context }) => renderPaper(element, depth, parent, context),
  card: ({ element, depth, parent, context }) => renderCard(element, depth, parent, context),
  chip: ({ element, depth, parent, context }) => renderChip(element, depth, parent, context),
  switch: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Switch"
    }),
  checkbox: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Checkbox"
    }),
  radio: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Radio"
    }),
  slider: ({ element, depth, parent, context }) => renderSlider(element, depth, parent, context),
  rating: ({ element, depth, parent, context }) => renderRatingElement(element, depth, parent, context),
  list: ({ element, depth, parent, context }) => renderList(element, depth, parent, context),
  table: ({ element, depth, parent, context }) => renderTable(element, depth, parent, context),
  tooltip: ({ element, depth, parent, context }) => renderTooltipElement(element, depth, parent, context),
  appbar: ({ element, depth, parent, context }) => renderAppBar(element, depth, parent, context),
  drawer: ({ element, depth, parent, context }) => renderDrawer(element, depth, parent, context),
  breadcrumbs: ({ element, depth, parent, context }) => renderBreadcrumbs(element, depth, parent, context),
  tab: ({ element, depth, parent, context }) => renderTabs(element, depth, parent, context),
  dialog: ({ element, depth, parent, context }) => renderDialog(element, depth, parent, context),
  alert: ({ element, depth, parent, context }) => renderAlertElement(element, depth, parent, context),
  snackbar: ({ element, depth, parent, context }) => renderSnackbar(element, depth, parent, context),
  stepper: ({ element, depth, parent, context }) => renderStepper(element, depth, parent, context),
  progress: ({ element, depth, parent, context }) => renderProgress(element, depth, parent, context),
  skeleton: ({ element, depth, parent, context }) => renderSkeleton(element, depth, parent, context),
  avatar: ({ element, depth, parent, context }) => renderAvatar(element, depth, parent, context),
  badge: ({ element, depth, parent, context }) => renderBadge(element, depth, parent, context),
  divider: ({ element, depth, parent, context }) => renderDividerElement(element, depth, parent, context),
  navigation: ({ element, depth, parent, context }) => renderNavigation(element, depth, parent, context),
  image: ({ element, depth, parent, context }) => renderImageElement(element, depth, parent, context),
  container: ({ element, depth, parent, context }) => renderContainer(element, depth, parent, context)
};

export const resolveElementRenderStrategy = (type: ScreenElementIR["type"]): ElementRenderStrategy => {
  return (
    elementRenderStrategies[type] ??
    (({ element, depth, parent, context }) => {
      return renderContainer(element, depth, parent, context);
    })
  );
};

const validateRenderedElementFragment = ({
  raw,
  element,
  context,
  renderSource
}: {
  raw: string;
  element: ScreenElementIR;
  context: RenderContext;
  renderSource: string;
}): string => {
  validateGeneratedJsxFragment({
    raw,
    context: {
      screenName: context.screenName,
      nodeId: element.id,
      nodeName: element.name,
      nodeType: element.type,
      renderSource
    }
  });
  return raw;
};

export const renderElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  context.renderNodeVisitCount += 1;
  if (context.renderNodeVisitCount > 200_000) {
    throw new Error(`Render traversal exceeded safety limit for screen '${context.screenName}'`);
  }
  if (context.activeRenderElements.has(element)) {
    return null;
  }
  context.activeRenderElements.add(element);
  try {
    const extractionInvocation = context.extractionInvocationByNodeId.get(element.id);
    if (extractionInvocation) {
      const indent = "  ".repeat(depth);
      const sx = toElementSx({
        element,
        parent,
        context
      });
      const propEntries = extractionInvocation.usesPatternContext
        ? [`instanceId={${literal(extractionInvocation.instanceId)}}`]
        : Object.entries(extractionInvocation.propValues)
            .filter(([, value]) => value !== undefined)
            .map(([propName, value]) => `${propName}={${literal(value as string)}}`);
      const props = [`sx={{ ${sx} }}`, ...propEntries].join(" ");
      const raw = validateRenderedElementFragment({
        raw: `${indent}<${extractionInvocation.componentName} ${props} />`,
        element,
        context,
        renderSource: "pattern extraction"
      });
      return wrapWithIrMarkers({ element, depth, raw, extracted: true });
    }

    const mappedElement = renderMappedElement(element, depth, parent, context);
    if (mappedElement) {
      return wrapWithIrMarkers({
        element,
        depth,
        raw: validateRenderedElementFragment({
          raw: mappedElement,
          element,
          context,
          renderSource: "component mapping"
        })
      });
    }

    if (
      element.nodeType === "VECTOR" &&
      element.type !== "image" &&
      !isVectorGraphicNode(element) &&
      !isIconLikeNode(element) &&
      !isSemanticIconWrapper(element)
    ) {
      return null;
    }

    const preDispatchRendered = runElementPreDispatchStrategies({
      element,
      depth,
      parent,
      context
    });
    if (preDispatchRendered !== undefined) {
      if (preDispatchRendered === null) {
        return null;
      }
      return wrapWithIrMarkers({
        element,
        depth,
        raw: validateRenderedElementFragment({
          raw: preDispatchRendered,
          element,
          context,
          renderSource: "pre-dispatch strategy"
        })
      });
    }
    const strategyRendered = resolveElementRenderStrategy(element.type)({
      element,
      depth,
      parent,
      context
    });
    if (strategyRendered === null) {
      return null;
    }
    return wrapWithIrMarkers({
      element,
      depth,
      raw: validateRenderedElementFragment({
        raw: strategyRendered,
        element,
        context,
        renderSource: `render strategy '${element.type}'`
      })
    });
  } finally {
    context.activeRenderElements.delete(element);
  }
};

/**
 * Inject `data-ir-id` and `data-ir-name` attributes into the first JSX opening
 * tag of a rendered element string. This enables the click-to-inspect overlay
 * to map DOM elements back to their IR node identifiers without affecting
 * styling or functionality.
 */
const injectDataIrId = (raw: string, irNodeId: string, irNodeName: string): string => {
  // Match the first JSX opening tag: <ComponentName or <component-name
  // Insert data-ir-id right after the tag name, before any props or self-close.
  const pattern = /^(\s*<[A-Za-z][A-Za-z0-9.]*)/;
  const match = pattern.exec(raw);
  if (!match) {
    return raw;
  }
  const insertPos = match[0].length;
  const safeName = irNodeName.replace(/"/g, "&quot;");
  return `${raw.slice(0, insertPos)} data-ir-id="${irNodeId}" data-ir-name="${safeName}"${raw.slice(insertPos)}`;
};

const wrapWithIrMarkers = ({
  element,
  depth,
  raw,
  extracted
}: {
  element: ScreenElementIR;
  depth: number;
  raw: string;
  extracted?: boolean;
}): string => {
  const indent = "  ".repeat(depth);
  const safeName = element.name.replace(/[*/]/g, "_");
  const startTag = `${indent}{/* @ir:start ${element.id} ${safeName} ${element.type}${extracted ? " extracted" : ""} */}`;
  const endTag = `${indent}{/* @ir:end ${element.id} */}`;
  const taggedRaw = injectDataIrId(raw, element.id, element.name);
  return `${startTag}\n${taggedRaw}\n${endTag}`;
};


export interface FallbackScreenFileResult {
  file: GeneratedFile;
  componentFiles: GeneratedFile[];
  contextFiles: GeneratedFile[];
  testFiles: GeneratedFile[];
  prototypeNavigationRenderedCount: number;
  simplificationStats: SimplificationMetrics;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  iconWarnings: IconRenderWarning[];
  accessibilityWarnings: AccessibilityWarning[];
}

export interface ScreenTestButtonTarget {
  label: string;
  clickable: boolean;
}

export interface ScreenTestTargetPlan {
  textTargets: string[];
  buttonTargets: ScreenTestButtonTarget[];
  textInputTargets: string[];
  selectTargets: string[];
}

export const toTruncationComment = (
  truncationMetric:
    | {
        originalElements: number;
        retainedElements: number;
        budget: number;
      }
    | undefined
): string => {
  if (!truncationMetric) {
    return "";
  }
  return `/* workspace-dev: Screen IR exceeded budget (${truncationMetric.originalElements} elements), truncated to ${truncationMetric.retainedElements} (budget ${truncationMetric.budget}). */\n`;
};

export const MAX_SCREEN_TEST_TEXT_TARGETS = 8;
export const MAX_SCREEN_TEST_BUTTON_TARGETS = 6;
export const MAX_SCREEN_TEST_INPUT_TARGETS = 6;
export const MAX_SCREEN_TEST_SELECT_TARGETS = 6;
export const MAX_SCREEN_TEST_TARGET_TEXT_LENGTH = 120;
export const MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH = 3;

export const normalizeScreenTestTargetText = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_SCREEN_TEST_TARGET_TEXT_LENGTH) {
    return undefined;
  }
  if (/^[-–—•*]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
};

export const collectRepresentativeScreenTextTargets = ({
  roots,
  maxCount = MAX_SCREEN_TEST_TEXT_TARGETS
}: {
  roots: ScreenElementIR[];
  maxCount?: number;
}): string[] => {
  const seen = new Set<string>();
  const targets: string[] = [];
  const stack: ScreenElementIR[] = [...roots].reverse();

  while (stack.length > 0 && targets.length < maxCount) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === "text") {
      const normalizedText = normalizeScreenTestTargetText(current.text);
      if (normalizedText) {
        if (normalizedText.length < MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH) {
          continue;
        }
        const normalizedKey = normalizedText.toLowerCase();
        if (!seen.has(normalizedKey)) {
          seen.add(normalizedKey);
          targets.push(normalizedText);
          if (targets.length >= maxCount) {
            break;
          }
        }
      }
    }

    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        stack.push(child);
      }
    }
  }

  return targets;
};

export const normalizeRenderedScreenTextForSearch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const filterTextTargetsByRenderedScreenOutput = ({
  textTargets,
  renderedOutput,
  maxCount = MAX_SCREEN_TEST_TEXT_TARGETS
}: {
  textTargets: string[];
  renderedOutput: string;
  maxCount?: number;
}): string[] => {
  const normalizedRenderedOutput = normalizeRenderedScreenTextForSearch(renderedOutput);
  if (!normalizedRenderedOutput) {
    return textTargets.slice(0, maxCount);
  }

  const filteredTargets: string[] = [];
  for (const target of textTargets) {
    const normalizedTarget = normalizeRenderedScreenTextForSearch(target);
    if (!normalizedTarget) {
      continue;
    }
    if (normalizedTarget.length < MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH) {
      continue;
    }
    if (!normalizedRenderedOutput.includes(normalizedTarget)) {
      continue;
    }
    filteredTargets.push(target);
    if (filteredTargets.length >= maxCount) {
      break;
    }
  }

  return filteredTargets;
};

export const collectRepresentativeScreenButtonTargets = ({
  buttons,
  maxCount = MAX_SCREEN_TEST_BUTTON_TARGETS
}: {
  buttons: RenderedButtonModel[];
  maxCount?: number;
}): ScreenTestButtonTarget[] => {
  const byLabel = new Map<string, ScreenTestButtonTarget>();
  for (const button of buttons) {
    const normalizedLabel = normalizeScreenTestTargetText(button.label);
    if (!normalizedLabel) {
      continue;
    }
    const key = normalizedLabel.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, {
        label: normalizedLabel,
        clickable: button.eligibleForSubmit
      });
      if (byLabel.size >= maxCount) {
        break;
      }
      continue;
    }
    if (button.eligibleForSubmit) {
      existing.clickable = true;
    }
  }
  return Array.from(byLabel.values());
};

export const collectRepresentativeFieldTargets = ({
  fields,
  isSelect,
  maxCount
}: {
  fields: InteractiveFieldModel[];
  isSelect: boolean;
  maxCount: number;
}): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const field of fields) {
    if (field.isSelect !== isSelect) {
      continue;
    }
    const normalizedLabel = normalizeScreenTestTargetText(field.label);
    if (!normalizedLabel) {
      continue;
    }
    const key = normalizedLabel.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(normalizedLabel);
    if (labels.length >= maxCount) {
      break;
    }
  }
  return labels;
};

export const buildScreenTestTargetPlan = ({
  roots,
  renderedOutput,
  buttons,
  fields
}: {
  roots: ScreenElementIR[];
  renderedOutput: string;
  buttons: RenderedButtonModel[];
  fields: InteractiveFieldModel[];
}): ScreenTestTargetPlan => {
  const collectedTextTargets = collectRepresentativeScreenTextTargets({
    roots,
    maxCount: MAX_SCREEN_TEST_TEXT_TARGETS
  });

  return {
    textTargets: filterTextTargetsByRenderedScreenOutput({
      textTargets: collectedTextTargets,
      renderedOutput,
      maxCount: MAX_SCREEN_TEST_TEXT_TARGETS
    }),
    buttonTargets: collectRepresentativeScreenButtonTargets({
      buttons,
      maxCount: MAX_SCREEN_TEST_BUTTON_TARGETS
    }),
    textInputTargets: collectRepresentativeFieldTargets({
      fields,
      isSelect: false,
      maxCount: MAX_SCREEN_TEST_INPUT_TARGETS
    }),
    selectTargets: collectRepresentativeFieldTargets({
      fields,
      isSelect: true,
      maxCount: MAX_SCREEN_TEST_SELECT_TARGETS
    })
  };
};

export const buildScreenUnitTestFile = ({
  componentName,
  screenFilePath,
  plan
}: {
  componentName: string;
  screenFilePath: string;
  plan: ScreenTestTargetPlan;
}): GeneratedFile => {
  const screenFileName = path.posix.basename(screenFilePath, ".tsx");
  const testFilePath = path.posix.join("src", "screens", "__tests__", `${componentName}.test.tsx`);
  const expectedButtonLabels = plan.buttonTargets.map((target) => target.label);
  const clickableButtonLabels = plan.buttonTargets.filter((target) => target.clickable).map((target) => target.label);

  const content = `import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { appTheme } from "../../theme/theme";
import ${componentName}Screen from "../${screenFileName}";

const expectedTexts: string[] = ${JSON.stringify(plan.textTargets, null, 2)};
const expectedButtonLabels: string[] = ${JSON.stringify(expectedButtonLabels, null, 2)};
const clickableButtonLabels: string[] = ${JSON.stringify(clickableButtonLabels, null, 2)};
const expectedTextInputLabels: string[] = ${JSON.stringify(plan.textInputTargets, null, 2)};
const expectedSelectLabels: string[] = ${JSON.stringify(plan.selectTargets, null, 2)};

const normalizeTextForAssertion = (value: string): string => {
  return value.replace(/\\s+/g, " ").trim();
};

const expectTextToBePresent = ({ container, expectedText }: { container: HTMLElement; expectedText: string }): void => {
  const normalizedExpectedText = normalizeTextForAssertion(expectedText);
  if (normalizedExpectedText.length === 0) {
    return;
  }
  const normalizedContainerText = normalizeTextForAssertion(container.textContent ?? "");
  expect(normalizedContainerText).toContain(normalizedExpectedText);
};

const axeConfig = {
  rules: {
    "heading-order": { enabled: false },
    "landmark-banner-is-top-level": { enabled: false }
  }
} as const;

const renderScreen = () => {
  return render(
    <ThemeProvider theme={appTheme} defaultMode="system" noSsr>
      <MemoryRouter>
        <${componentName}Screen />
      </MemoryRouter>
    </ThemeProvider>
  );
};

describe("${componentName}Screen", () => {
  it("renders without crashing", () => {
    const { container } = renderScreen();
    expect(container.firstChild).not.toBeNull();
  });

  it("renders representative text content", () => {
    const { container } = renderScreen();
    for (const expectedText of expectedTexts) {
      expectTextToBePresent({ container, expectedText });
    }
  });

  it("keeps representative controls interactive", async () => {
    renderScreen();
    const user = userEvent.setup();

    for (const buttonLabel of expectedButtonLabels) {
      expect(screen.getAllByRole("button", { name: buttonLabel }).length).toBeGreaterThan(0);
    }

    for (const buttonLabel of clickableButtonLabels) {
      const buttons = screen.getAllByRole("button", { name: buttonLabel });
      expect(buttons.length).toBeGreaterThan(0);
      await user.click(buttons[0]!);
    }

    for (const inputLabel of expectedTextInputLabels) {
      const controls = screen.getAllByLabelText(inputLabel);
      expect(controls.length).toBeGreaterThan(0);
      const control = controls[0];
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        await user.clear(control);
        await user.type(control, "x");
      }
    }

    for (const selectLabel of expectedSelectLabels) {
      const selects = screen.getAllByRole("combobox", { name: selectLabel });
      expect(selects.length).toBeGreaterThan(0);
    }
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderScreen();
    const results = await axe(container, axeConfig);
    expect(results).toHaveNoViolations();
  });
});
`;

  return {
    path: testFilePath,
    content
  };
};

export interface FallbackScreenFileInput {
  screen: ScreenIR;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  spacingBase?: number;
  tokens?: DesignTokens | undefined;
  iconResolver?: IconFallbackResolver;
  imageAssetMap?: Record<string, string>;
  routePathByScreenId?: Map<string, string>;
  generationLocale?: string;
  formHandlingMode?: WorkspaceFormHandlingMode;
  truncationMetric?: {
    originalElements: number;
    retainedElements: number;
    budget: number;
  };
  themeComponentDefaults?: ThemeComponentDefaults;
  datePickerProvider?: DatePickerProviderConfig;
  specializedComponentMappings?: Partial<Record<string, SpecializedComponentMapping>>;
  storybookFirstIconLookup?: ReadonlyMap<string, ComponentMatchReportIconResolutionRecord>;
  storybookTypographyVariants?: Readonly<Record<string, ResolvedStorybookTypographyStyle>>;
  componentNameOverride?: string;
  filePathOverride?: string;
  enablePatternExtraction?: boolean;
  disallowedStyledRootMuiComponents?: ReadonlySet<string>;
}

export interface PreparedFallbackScreenModel {
  screen: ScreenIR;
  componentName: string;
  filePath: string;
  truncationComment: string;
  resolvedSpacingBase: number;
  resolvedGenerationLocale: string;
  resolvedFormHandlingMode: ResolvedFormHandlingMode;
  resolvedThemeComponentDefaults: ThemeComponentDefaults | undefined;
  datePickerProvider?: DatePickerProviderConfig;
  specializedComponentMappings: Partial<Record<string, SpecializedComponentMapping>>;
  storybookFirstIconLookup?: ReadonlyMap<string, ComponentMatchReportIconResolutionRecord>;
  storybookTypographyVariants?: Readonly<Record<string, ResolvedStorybookTypographyStyle>>;
  simplificationStats: SimplificationMetrics;
  simplifiedChildren: ScreenElementIR[];
  headingComponentByNodeId: Map<string, HeadingComponent>;
  typographyVariantByNodeId: Map<string, DesignTokenTypographyVariantName>;
  minX: number;
  minY: number;
  rootParent: VirtualParent;
  extractionPlan: PatternExtractionPlan;
  tokens?: DesignTokens;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  enablePatternExtraction: boolean;
  disallowedStyledRootMuiComponents: ReadonlySet<string>;
}

export interface FallbackRenderState {
  renderContext: RenderContext;
  rendered: string;
  hasInteractiveFields: boolean;
  hasInteractiveAccordions: boolean;
  hasSelectField: boolean;
  hasTextInputField: boolean;
  containerMaxWidth: string;
  screenContainerSx: string;
  formGroups: FormGroupAssignment[];
}

export interface FallbackDependencyAssembly {
  formContextFileSpec?: FormContextFileSpec;
  formContextFileSpecs?: FormContextFileSpec[];
  patternContextFileSpec?: PatternContextFileSpec;
  patternContextInitialStateDeclaration: string;
  navigationHookBlock: string;
  stateBlock: string;
  containerFormProps: string;
  reactImportBlock: string;
  reactHookFormImport: string;
  zodImportBlock: string;
  reactRouterImport: string;
  selectChangeEventTypeImport: string;
  uniqueMuiImports: string[];
  iconImports: string;
  mappedImports: string;
  extractedComponentImports: string;
  patternContextImport: string;
  formContextImport: string;
}

export const prepareFallbackScreenModel = ({
  screen,
  mappingByNodeId,
  spacingBase,
  tokens,
  iconResolver = ICON_FALLBACK_BUILTIN_RESOLVER,
  imageAssetMap = {},
  routePathByScreenId = new Map<string, string>(),
  generationLocale,
  formHandlingMode,
  truncationMetric,
  themeComponentDefaults,
  datePickerProvider,
  specializedComponentMappings = {},
  storybookFirstIconLookup,
  storybookTypographyVariants,
  componentNameOverride,
  filePathOverride,
  enablePatternExtraction = true,
  disallowedStyledRootMuiComponents = new Set<string>()
}: FallbackScreenFileInput): PreparedFallbackScreenModel => {
  const componentName = componentNameOverride ?? toComponentName(screen.name);
  const filePath = filePathOverride ?? toDeterministicScreenPath(screen.name);
  const truncationComment = toTruncationComment(truncationMetric);
  const resolvedSpacingBase = normalizeSpacingBase(spacingBase);
  const resolvedGenerationLocale = resolveGenerationLocale({
    requestedLocale: generationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  }).locale;
  const resolvedFormHandlingMode = resolveFormHandlingMode({
    requestedMode: formHandlingMode
  });
  const resolvedThemeComponentDefaults = themeComponentDefaults;
  const pageBackgroundColorNormalized = normalizeHexColor(screen.fillColor ?? tokens?.palette.background);

  const simplificationStats = createEmptySimplificationStats();
  const simplifiedChildren = simplifyElements({
    elements: screen.children,
    depth: 1,
    stats: simplificationStats
  });
  const headingComponentByNodeId = inferHeadingComponentByNodeId(simplifiedChildren);
  const typographyVariantByNodeId = resolveTypographyVariantByNodeId({
    elements: simplifiedChildren,
    tokens
  });
  const minX = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.x ?? 0)) : 0;
  const minY = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.y ?? 0)) : 0;
  const rootParent: VirtualParent = {
    x: minX,
    y: minY,
    width: screen.width,
    height: screen.height,
    name: screen.name,
    fillColor: screen.fillColor,
    fillGradient: screen.fillGradient,
    layoutMode: screen.layoutMode
  };
  const extractionPlan = buildPatternExtractionPlan({
    enablePatternExtraction,
    screen,
    screenComponentName: componentName,
    roots: simplifiedChildren,
    rootParent,
    generationLocale: resolvedGenerationLocale,
    spacingBase: resolvedSpacingBase,
    tokens,
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    disallowedStyledRootMuiComponents,
    ...(resolvedThemeComponentDefaults ? { themeComponentDefaults: resolvedThemeComponentDefaults } : {}),
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  });

  return {
    screen,
    componentName,
    filePath,
    truncationComment,
    resolvedSpacingBase,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    resolvedThemeComponentDefaults,
    ...(datePickerProvider ? { datePickerProvider } : {}),
    specializedComponentMappings,
    ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
    ...(storybookTypographyVariants ? { storybookTypographyVariants } : {}),
    simplificationStats,
    simplifiedChildren,
    headingComponentByNodeId,
    typographyVariantByNodeId,
    minX,
    minY,
    rootParent,
    extractionPlan,
    ...(tokens ? { tokens } : {}),
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    enablePatternExtraction,
    disallowedStyledRootMuiComponents
  };
};

const resolveSubmitButtonKey = (buttons: RenderedButtonModel[]): string => {
  const preferred = buttons.find((button) => button.eligibleForSubmit && button.preferredSubmit);
  const fallback = buttons.find((button) => button.eligibleForSubmit);
  return preferred?.key ?? fallback?.key ?? "";
};

export const buildFallbackRenderState = ({ prepared }: { prepared: PreparedFallbackScreenModel }): FallbackRenderState => {
  const {
    screen,
    headingComponentByNodeId,
    typographyVariantByNodeId,
    resolvedThemeComponentDefaults,
    datePickerProvider,
    specializedComponentMappings,
    storybookTypographyVariants,
    simplifiedChildren,
    rootParent,
    minX,
    minY,
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    tokens,
    mappingByNodeId,
    storybookFirstIconLookup,
    pageBackgroundColorNormalized,
    extractionPlan
  } = prepared;
  const formGroups = detectFormGroups(simplifiedChildren);
  const formGroupByChildIndex = new Map<number, string>();
  for (const group of formGroups) {
    for (const childIndex of group.childIndices) {
      formGroupByChildIndex.set(childIndex, group.groupId);
    }
  }

  const createRenderContext = (
    hasScreenFormFields: boolean,
    consumedFieldLabelNodeIds: ReadonlySet<string> = new Set<string>(),
    primarySubmitButtonKey = ""
  ): RenderContext => ({
    screenId: screen.id,
    screenName: screen.name,
    screenElements: simplifiedChildren,
    currentFilePath: prepared.filePath,
    generationLocale: prepared.resolvedGenerationLocale,
    formHandlingMode: prepared.resolvedFormHandlingMode,
    hasScreenFormFields,
    primarySubmitButtonKey,
    fields: [],
    accordions: [],
    tabs: [],
    dialogs: [],
    buttons: [],
    activeRenderElements: new Set<ScreenElementIR>(),
    renderNodeVisitCount: 0,
    interactiveDescendantCache: new Map<string, boolean>(),
    meaningfulTextDescendantCache: new Map<string, boolean>(),
    headingComponentByNodeId,
    typographyVariantByNodeId,
    accessibilityWarnings: [],
    muiImports: new Set<string>(["Container"]),
    iconImports: [],
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    specializedComponentMappings,
    ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
    ...(storybookTypographyVariants ? { storybookTypographyVariants } : {}),
    ...(datePickerProvider ? { datePickerProvider } : {}),
    usesDatePickerProvider: false,
    spacingBase: prepared.resolvedSpacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    iconWarnings: [],
    consumedFieldLabelNodeIds: new Set(consumedFieldLabelNodeIds),
    emittedWarningKeys: new Set<string>(),
    emittedIconWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized,
    ...(resolvedThemeComponentDefaults ? { themeComponentDefaults: resolvedThemeComponentDefaults } : {}),
    extractionInvocationByNodeId: extractionPlan.invocationByRootNodeId,
    requiresChangeEventTypeImport: false,
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  });
  const renderWithContext = (context: RenderContext): string => {
    const renderedOutput = simplifiedChildren
      .map((element, childIndex) => {
        context.currentFormGroupId = formGroupByChildIndex.get(childIndex);
        return renderElement(
          element,
          3,
          rootParent,
          context
        );
      })
      .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
      .join("\n");
    context.currentFormGroupId = undefined;
    return renderedOutput;
  };
  const previewRenderContext = createRenderContext(false);
  renderWithContext(previewRenderContext);
  const previewPrimarySubmitButtonKey =
    previewRenderContext.fields.length > 0 ? resolveSubmitButtonKey(previewRenderContext.buttons) : "";
  const renderContext = createRenderContext(
    previewRenderContext.fields.length > 0,
    previewRenderContext.consumedFieldLabelNodeIds,
    previewPrimarySubmitButtonKey
  );
  const rendered = renderWithContext(renderContext);
  const hasInteractiveFields = renderContext.fields.length > 0;
  const hasInteractiveAccordions = renderContext.accordions.length > 0;
  const hasSelectField = renderContext.fields.some((field) => field.isSelect);
  const hasTextInputField = renderContext.fields.some((field) => !field.isSelect);

  const contentWidth = clamp(
    Math.round(
      simplifiedChildren.reduce((maxWidth, element) => {
        if (typeof element.x === "number" && typeof element.width === "number") {
          return Math.max(maxWidth, element.x - minX + element.width);
        }
        if (typeof element.width !== "number") {
          return maxWidth;
        }
        return Math.max(maxWidth, element.width);
      }, 0)
    ),
    320,
    1680
  );

  const contentHeight = Math.max(
    320,
    Math.round(
      simplifiedChildren.reduce((maxHeight, element) => {
        if (typeof element.y !== "number" || typeof element.height !== "number") {
          return maxHeight;
        }
        return Math.max(maxHeight, element.y - minY + element.height);
      }, 0)
    )
  );
  const containerMaxWidth = toMuiContainerMaxWidth(contentWidth);
  const containerPadding = toSpacingUnitValue({ value: 16, spacingBase: renderContext.spacingBase }) ?? 2;
  const screenContainerSx = sxString([
    ["position", literal("relative")],
    ["width", literal("100%")],
    ["minHeight", literal(`max(100vh, ${contentHeight}px)`)],
    ["background", screen.fillGradient ? literal(screen.fillGradient) : undefined],
    [
      "bgcolor",
      !screen.fillGradient
        ? toThemeColorLiteral({ color: screen.fillColor ?? "background.default", tokens: renderContext.tokens })
        : undefined
    ],
    ["px", containerPadding],
    ["py", containerPadding],
    ...toScreenResponsiveRootMediaEntries({
      screen,
      spacingBase: renderContext.spacingBase
    })
  ]);

  return {
    renderContext,
    rendered,
    hasInteractiveFields,
    hasInteractiveAccordions,
    hasSelectField,
    hasTextInputField,
    containerMaxWidth,
    screenContainerSx,
    formGroups
  };
};

export const assembleFallbackDependencies = ({
  prepared,
  renderState
}: {
  prepared: PreparedFallbackScreenModel;
  renderState: FallbackRenderState;
}): FallbackDependencyAssembly => {
  const { componentName, extractionPlan, resolvedFormHandlingMode, enablePatternExtraction } = prepared;
  const {
    renderContext,
    rendered,
    hasInteractiveFields,
    hasInteractiveAccordions,
    hasSelectField,
    formGroups
  } = renderState;

  const buildFieldMaps = (fields: InteractiveFieldModel[]) => ({
    initialValues: Object.fromEntries(fields.map((field) => [field.key, field.defaultValue])),
    requiredFieldMap: Object.fromEntries(
      fields.filter((field) => field.required).map((field) => [field.key, true])
    ),
    validationTypeMap: Object.fromEntries(
      fields
        .filter((field) => field.validationType)
        .map((field) => [field.key, field.validationType as ValidationFieldType])
    ),
    validationMessageMap: Object.fromEntries(
      fields
        .filter((field) => field.validationMessage)
        .map((field) => [field.key, field.validationMessage as string])
    ),
    initialVisualErrorsMap: Object.fromEntries(
      fields
        .filter((field) => field.hasVisualErrorExample)
        .map((field) => [field.key, field.validationMessage ?? (field.required ? "This field is required." : "Invalid value.")])
    ),
    selectOptionsMap: Object.fromEntries(
      fields.filter((field) => field.isSelect).map((field) => [field.key, field.options])
    ),
    crossFieldRules: detectCrossFieldRules(fields),
    validationMode: inferValidationMode({
      fields,
      hasVisualErrors: fields.some((field) => field.hasVisualErrorExample === true)
    }),
    validationRulesMap: Object.fromEntries(
      fields
        .filter((field) => field.validationRules && field.validationRules.length > 0)
        .map((field) => [field.key, field.validationRules!])
    )
  });

  const allFieldMaps = buildFieldMaps(renderContext.fields);
  const { initialValues, requiredFieldMap, validationTypeMap, validationMessageMap, initialVisualErrorsMap, selectOptionsMap, crossFieldRules, validationMode, validationRulesMap } = allFieldMaps;

  const initialAccordionState = Object.fromEntries(
    renderContext.accordions.map((accordion) => [accordion.key, accordion.defaultExpanded])
  );

  const primarySubmitButtonKey = hasInteractiveFields ? resolveSubmitButtonKey(renderContext.buttons) : "";

  const hasMultipleFormGroups = formGroups.length > 1;
  const formGroupContextSpecs: FormContextFileSpec[] = [];
  if (hasMultipleFormGroups && enablePatternExtraction && hasInteractiveFields) {
    for (const group of formGroups) {
      const groupFields = renderContext.fields.filter((field) => field.formGroupId === group.groupId);
      if (groupFields.length === 0) {
        continue;
      }
      const groupMaps = buildFieldMaps(groupFields);
      const groupComponentName = `${componentName}${toPascalCase(group.groupId)}`;
      const usesRhf = resolvedFormHandlingMode === "react_hook_form";
      const spec = usesRhf
        ? buildReactHookFormContextFile({
            screenComponentName: groupComponentName,
            ...groupMaps
          })
        : buildLegacyFormContextFile({
            screenComponentName: groupComponentName,
            ...groupMaps
          });
      formGroupContextSpecs.push(spec);
    }
  }

  const shouldGenerateFormContext = enablePatternExtraction && hasInteractiveFields && !hasMultipleFormGroups;
  const usesReactHookForm = hasInteractiveFields && resolvedFormHandlingMode === "react_hook_form";
  const hasRhfSubmitButtonState = usesReactHookForm && primarySubmitButtonKey.length > 0;
  const formContextFileSpec = shouldGenerateFormContext
    ? usesReactHookForm
      ? buildReactHookFormContextFile({
          screenComponentName: componentName,
          initialValues,
          requiredFieldMap,
          validationTypeMap,
          validationMessageMap,
          initialVisualErrorsMap,
          selectOptionsMap,
          crossFieldRules,
          validationMode,
          validationRulesMap
        })
      : buildLegacyFormContextFile({
          screenComponentName: componentName,
          initialValues,
          requiredFieldMap,
          validationTypeMap,
          validationMessageMap,
          initialVisualErrorsMap,
          selectOptionsMap
        })
    : undefined;
  const formContextHookFields = usesReactHookForm
    ? [
        ...(hasSelectField ? ["selectOptions"] : []),
        "control",
        "handleSubmit",
        "onSubmit",
        "resolveFieldErrorMessage",
        ...(hasRhfSubmitButtonState ? ["isSubmitting"] : []),
        "isSubmitted"
      ]
    : [
        "initialVisualErrors",
        ...(hasSelectField ? ["selectOptions"] : []),
        "formValues",
        "fieldErrors",
        "touchedFields",
        "updateFieldValue",
        "handleFieldBlur",
        "handleSubmit"
      ];
  const formContextHookBlock = formContextFileSpec
    ? `const { ${formContextHookFields.join(", ")} } = ${formContextFileSpec.hookName}();`
    : "";
  const inlineFieldStateBlock =
    !formContextFileSpec && hasInteractiveFields
      ? usesReactHookForm
        ? buildInlineReactHookFormStateBlock({
            hasSelectField,
            selectOptionsMap,
            initialVisualErrorsMap,
            requiredFieldMap,
            validationTypeMap,
            validationMessageMap,
            initialValues,
            crossFieldRules,
            validationMode,
            validationRulesMap
          })
        : buildInlineLegacyFormStateBlock({
            hasSelectField,
            selectOptionsMap,
            initialVisualErrorsMap,
            requiredFieldMap,
            validationTypeMap,
            validationMessageMap,
            initialValues,
            validationRulesMap
          })
      : "";
  const accordionStateBlock = hasInteractiveAccordions
    ? `const [accordionState, setAccordionState] = useState<Record<string, boolean>>(${JSON.stringify(initialAccordionState, null, 2)});

const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
  setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
};`
    : "";
  const tabsStateBlock =
    renderContext.tabs.length > 0
      ? renderContext.tabs
          .map((tabModel) => {
            const tabValueVar = `tabValue${tabModel.stateId}`;
            const tabSetterVar = `setTabValue${tabModel.stateId}`;
            const tabChangeHandlerVar = `handleTabChange${tabModel.stateId}`;
            return `const [${tabValueVar}, ${tabSetterVar}] = useState<number>(0);

const ${tabChangeHandlerVar} = (_event: SyntheticEvent, newValue: number): void => {
  ${tabSetterVar}(newValue);
};`;
          })
          .join("\n\n")
      : "";
  const dialogsStateBlock =
    renderContext.dialogs.length > 0
      ? renderContext.dialogs
          .map((dialogModel) => {
            const dialogOpenVar = `isDialogOpen${dialogModel.stateId}`;
            const dialogSetterVar = `setIsDialogOpen${dialogModel.stateId}`;
            const dialogCloseHandlerVar = `handleDialogClose${dialogModel.stateId}`;
            return `const [${dialogOpenVar}, ${dialogSetterVar}] = useState<boolean>(true);

const ${dialogCloseHandlerVar} = (): void => {
  ${dialogSetterVar}(false);
};`;
          })
          .join("\n\n")
      : "";
  const stateBlock = [
    formContextHookBlock,
    inlineFieldStateBlock,
    accordionStateBlock,
    tabsStateBlock,
    dialogsStateBlock
  ]
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
  const usesInlineLegacyFormState = !formContextFileSpec && hasInteractiveFields && !usesReactHookForm;
  const usesInlineReactHookForm = !formContextFileSpec && hasInteractiveFields && usesReactHookForm;
  const hasLocalStatefulElements =
    usesInlineLegacyFormState ||
    hasInteractiveAccordions ||
    renderContext.tabs.length > 0 ||
    renderContext.dialogs.length > 0;
  const formSubmitExpression =
    hasInteractiveFields && usesReactHookForm ? "((event) => { void handleSubmit(onSubmit)(event); })" : "handleSubmit";
  const containerFormProps = hasInteractiveFields ? ` component="form" onSubmit={${formSubmitExpression}} noValidate` : "";

  const reactValueImports = hasLocalStatefulElements ? ["useState"] : [];
  const reactTypeImports: string[] = [];
  if (usesInlineLegacyFormState) {
    reactTypeImports.push("FormEvent");
  }
  if (renderContext.requiresChangeEventTypeImport) {
    reactTypeImports.push("ChangeEvent");
  }
  if (renderContext.usesNavigateHandler) {
    reactTypeImports.push("KeyboardEvent as ReactKeyboardEvent");
  }
  if (renderContext.tabs.length > 0) {
    reactTypeImports.push("SyntheticEvent");
  }
  const reactImportLines = [
    ...(reactValueImports.length > 0 ? [`import { ${reactValueImports.join(", ")} } from "react";`] : []),
    ...(reactTypeImports.length > 0 ? [`import type { ${reactTypeImports.join(", ")} } from "react";`] : [])
  ];
  const reactImportBlock = reactImportLines.length > 0 ? `${reactImportLines.join("\n")}\n` : "";
  const reactHookFormImport = usesReactHookForm
    ? `import { ${usesInlineReactHookForm ? "Controller, useForm" : "Controller"} } from "react-hook-form";\n`
    : "";
  const zodImportBlock = usesInlineReactHookForm
    ? 'import { zodResolver } from "@hookform/resolvers/zod";\nimport { z } from "zod";\n'
    : "";
  const selectChangeEventTypeImport = hasSelectField ? 'import type { SelectChangeEvent } from "@mui/material/Select";\n' : "";
  const routerImports: string[] = [];
  if (renderContext.usesRouterLink) {
    routerImports.push("Link as RouterLink");
  }
  if (renderContext.usesNavigateHandler) {
    routerImports.push("useNavigate");
  }
  const reactRouterImport =
    routerImports.length > 0 ? `import { ${routerImports.join(", ")} } from "react-router-dom";\n` : "";
  const navigationHookBlock = renderContext.usesNavigateHandler ? "const navigate = useNavigate();" : "";
  if (rendered.length === 0) {
    registerMuiImports(renderContext, "Typography");
  }
  const uniqueMuiImports = [...renderContext.muiImports].sort((left, right) => left.localeCompare(right));
  const iconImports = normalizeIconImports(renderContext.iconImports)
    .map((iconImport) => `import ${iconImport.localName} from "${iconImport.modulePath}";`)
    .join("\n");
  const mappedImports = renderContext.mappedImports
    .map((mappedImport) =>
      mappedImport.importMode === "named"
        ? `import { ${mappedImport.importedName}${mappedImport.importedName !== mappedImport.localName ? ` as ${mappedImport.localName}` : ""} } from "${mappedImport.modulePath}";`
        : `import ${mappedImport.localName} from "${mappedImport.modulePath}";`
    )
    .join("\n");
  const extractedComponentImports = extractionPlan.componentImports
    .map((componentImport) => `import { ${componentImport.componentName} } from "${componentImport.importPath}";`)
    .join("\n");
  const patternContextFileSpec = extractionPlan.patternStatePlan.contextFileSpec;
  const patternContextImport = patternContextFileSpec
    ? `import { ${patternContextFileSpec.providerName}, type ${patternContextFileSpec.stateTypeName} } from "${patternContextFileSpec.importPath}";`
    : "";
  const formContextImport = formContextFileSpec
    ? `import { ${formContextFileSpec.providerName}, ${formContextFileSpec.hookName} } from "${formContextFileSpec.importPath}";`
    : "";
  const patternContextInitialStateDeclaration = patternContextFileSpec
    ? `const patternContextInitialState: ${patternContextFileSpec.stateTypeName} = ${patternContextFileSpec.initialStateLiteral};\n\n`
    : "";

  return {
    ...(formContextFileSpec ? { formContextFileSpec } : {}),
    ...(formGroupContextSpecs.length > 0 ? { formContextFileSpecs: formGroupContextSpecs } : {}),
    ...(patternContextFileSpec ? { patternContextFileSpec } : {}),
    patternContextInitialStateDeclaration,
    navigationHookBlock,
    stateBlock,
    containerFormProps,
    reactImportBlock,
    reactHookFormImport,
    zodImportBlock,
    reactRouterImport,
    selectChangeEventTypeImport,
    uniqueMuiImports,
    iconImports,
    mappedImports,
    extractedComponentImports,
    patternContextImport,
    formContextImport
  };
};

export const composeFallbackScreenModule = ({
  prepared,
  renderState,
  dependencies
}: {
  prepared: PreparedFallbackScreenModel;
  renderState: FallbackRenderState;
  dependencies: FallbackDependencyAssembly;
}): FallbackScreenFileResult => {
  const { componentName, filePath, truncationComment, extractionPlan, simplifiedChildren, simplificationStats } = prepared;
  const { renderContext, rendered, containerMaxWidth, screenContainerSx } = renderState;
  const {
    formContextFileSpec,
    formContextFileSpecs,
    patternContextFileSpec,
    patternContextInitialStateDeclaration,
    navigationHookBlock,
    stateBlock,
    containerFormProps,
    reactImportBlock,
    reactHookFormImport,
    zodImportBlock,
    reactRouterImport,
    selectChangeEventTypeImport,
    uniqueMuiImports,
    iconImports,
    mappedImports,
    extractedComponentImports,
    patternContextImport,
    formContextImport
  } = dependencies;

  const contentFunctionName = `${componentName}ScreenContent`;
  const contentFunctionSource = `function ${contentFunctionName}() {
${[navigationHookBlock, stateBlock]
  .filter((chunk) => chunk.length > 0)
  .map((chunk) => `${indentBlock(chunk, 2)}\n`)
  .join("")}  return (
    <Container id="main-content" maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  // --- DatePicker provider wiring (issue #693) ---
  const hasDatePickerProvider = Boolean(renderContext.usesDatePickerProvider && renderContext.datePickerProvider);
  const needsDatePickerFallbackProvider = Boolean(renderContext.usesDatePicker) && !hasDatePickerProvider;
  const hasContextProviders = Boolean(patternContextFileSpec) || Boolean(formContextFileSpec) || hasDatePickerProvider || needsDatePickerFallbackProvider;
  let wrappedScreenContent = `      <${contentFunctionName} />`;
  if (hasDatePickerProvider && renderContext.datePickerProvider && renderContext.datePickerProviderResolvedImports) {
    const providerProps = [
      ...Object.entries(renderContext.datePickerProvider.props).map(([propName, value]) =>
        `${propName}={${typeof value === "string" ? literal(value) : JSON.stringify(value)}}`
      ),
      ...(renderContext.datePickerProvider.adapter
        ? [
            `${renderContext.datePickerProvider.adapter.propName}={${renderContext.datePickerProviderResolvedImports.adapterLocalName ?? renderContext.datePickerProvider.adapter.localName}}`
          ]
        : [])
    ].join(" ");
    wrappedScreenContent = `      <${renderContext.datePickerProviderResolvedImports.providerLocalName}${providerProps ? ` ${providerProps}` : ""}>
${wrappedScreenContent}
      </${renderContext.datePickerProviderResolvedImports.providerLocalName}>`;
  }
  if (formContextFileSpec) {
    wrappedScreenContent = `      <${formContextFileSpec.providerName}>
${wrappedScreenContent}
      </${formContextFileSpec.providerName}>`;
  }
  if (patternContextFileSpec) {
    wrappedScreenContent = `      <${patternContextFileSpec.providerName} initialState={patternContextInitialState}>
${wrappedScreenContent}
      </${patternContextFileSpec.providerName}>`;
  }
  if (needsDatePickerFallbackProvider) {
    wrappedScreenContent = `      <LocalizationProvider dateAdapter={AdapterDateFns}>
${wrappedScreenContent}
      </LocalizationProvider>`;
  }
  const screenExportSource = hasContextProviders
    ? `${contentFunctionSource}

export default function ${componentName}Screen() {
  return (
${wrappedScreenContent}
  );
}`
    : `export default function ${componentName}Screen() {
${[navigationHookBlock, stateBlock]
  .filter((chunk) => chunk.length > 0)
  .map((chunk) => `${indentBlock(chunk, 2)}\n`)
  .join("")}  return (
    <Container id="main-content" maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  const datePickerImportBlock = needsDatePickerFallbackProvider
    ? `import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
`
    : "";
  const screenContent = `${truncationComment}${reactImportBlock}${reactHookFormImport}${zodImportBlock}${reactRouterImport}${selectChangeEventTypeImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${datePickerImportBlock}${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}${extractedComponentImports ? `${extractedComponentImports}\n` : ""}${patternContextImport ? `${patternContextImport}\n` : ""}${formContextImport ? `${formContextImport}\n` : ""}
${patternContextInitialStateDeclaration}${screenExportSource}
`;
  const sharedSxOptimizedScreenContent = extractSharedSxConstantsFromScreenContent(screenContent);
  validateGeneratedSourceFile({
    filePath,
    content: sharedSxOptimizedScreenContent,
    context: {
      screenName: prepared.screen.name
    }
  });
  const screenTestPlan = buildScreenTestTargetPlan({
    roots: simplifiedChildren,
    renderedOutput: rendered,
    buttons: renderContext.buttons,
    fields: renderContext.fields
  });
  const testFiles: GeneratedFile[] = [
    buildScreenUnitTestFile({
      componentName,
      screenFilePath: filePath,
      plan: screenTestPlan
    })
  ];
  const contextFiles: GeneratedFile[] = [
    ...extractionPlan.contextFiles,
    ...(formContextFileSpec ? [formContextFileSpec.file] : []),
    ...(formContextFileSpecs ? formContextFileSpecs.map((spec) => spec.file) : [])
  ];

  return {
    file: {
      path: filePath,
      content: sharedSxOptimizedScreenContent
    },
    prototypeNavigationRenderedCount: renderContext.prototypeNavigationRenderedCount,
    simplificationStats,
    usedMappingNodeIds: renderContext.usedMappingNodeIds,
    mappingWarnings: renderContext.mappingWarnings,
    iconWarnings: renderContext.iconWarnings ?? [],
    accessibilityWarnings: renderContext.accessibilityWarnings,
    componentFiles: extractionPlan.componentFiles,
    contextFiles,
    testFiles
  };
};

export const fallbackScreenFile = (input: FallbackScreenFileInput): FallbackScreenFileResult => {
  const prepared = prepareFallbackScreenModel(input);
  const renderState = buildFallbackRenderState({ prepared });
  const dependencies = assembleFallbackDependencies({
    prepared,
    renderState
  });
  const result = composeFallbackScreenModule({
    prepared,
    renderState,
    dependencies
  });
  for (const generatedFile of [...result.componentFiles, ...result.contextFiles]) {
    if (!generatedFile.path.endsWith(".ts") && !generatedFile.path.endsWith(".tsx")) {
      continue;
    }
    validateGeneratedSourceFile({
      filePath: generatedFile.path,
      content: generatedFile.content,
      context: {
        screenName: prepared.screen.name
      }
    });
  }
  return result;
};
