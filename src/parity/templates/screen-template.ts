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
  registerMuiImports,
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
  toStateKey,
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
  detectFormGroups
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
  ListRowAnalysis,
  FormGroupAssignment
} from "../generator-core.js";
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

export const renderText = (element: TextElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Typography");
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
    tokens: context.tokens
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
      element.textAlign === "LEFT"
        ? literal("left")
        : element.textAlign === "CENTER"
          ? literal("center")
          : element.textAlign === "RIGHT"
            ? literal("right")
            : undefined
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

  const variantProp = typographyVariantName ? ` variant="${typographyVariantName}"` : "";
  const headingProp = headingComponent ? ` component="${headingComponent}"` : "";
  return `${indent}<Typography${variantProp}${headingProp} sx={{ ${sx} }}>{${text}}</Typography>`;
};

export const renderSemanticInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineStrokeColor = outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor;
  const textFieldDefaults = context.themeComponentDefaults?.MuiTextField;
  const outlinedInputRadiusSource = outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius;
  const omitOutlinedInputBorderRadius = matchesRoundedInteger({
    value: outlinedInputRadiusSource,
    target: textFieldDefaults?.outlinedInputBorderRadiusPx
  });
  const baseFieldLayoutEntries = baseLayoutEntries(outlineContainer, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
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
${indent}          value={controllerField.value ?? ""}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(String(event.target.value))}
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
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
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

  registerMuiImports(context, "TextField");
  if (field.suffixText) {
    registerMuiImports(context, "InputAdornment");
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
  if (usesReactHookForm) {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <TextField
${indent}        label={${literal(field.label)}}
${field.placeholder ? `${indent}        placeholder={${literal(field.placeholder)}}\n` : ""}${field.inputType ? `${indent}        type={${literal(field.inputType)}}\n` : ""}${field.autoComplete ? `${indent}        autoComplete={${literal(field.autoComplete)}}\n` : ""}${field.required ? `${indent}        required\n` : ""}${indent}        value={controllerField.value ?? ""}
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
  const indent = "  ".repeat(depth);
  const accordionModel = registerInteractiveAccordion({
    context,
    element,
    defaultExpanded: true
  });
  const summaryRoot = findFirstByName(element, "muibuttonbaseroot") ?? element.children?.[0] ?? element;
  const summaryContent = findFirstByName(summaryRoot, "accordionsummarycontent") ?? summaryRoot;
  const detailsRoot = findFirstByName(element, "collapsewrapper") ?? element.children?.[1] ?? element;
  const detailsContainer = detailsRoot.children?.length === 1 ? (detailsRoot.children[0] ?? detailsRoot) : detailsRoot;

  const summaryChildren = sortChildren(summaryContent.children ?? [], summaryContent.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const renderedSummary = summaryChildren
    .map((child) =>
      renderElement(
        child,
        depth + 3,
        {
          x: summaryContent.x,
          y: summaryContent.y,
          width: summaryContent.width,
          height: summaryContent.height,
          name: summaryContent.name,
          layoutMode: summaryContent.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const detailChildren = sortChildren(detailsContainer.children ?? [], detailsContainer.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const renderedDetails = detailChildren
    .map((child) =>
      renderElement(
        child,
        depth + 2,
        {
          x: detailsContainer.x,
          y: detailsContainer.y,
          width: detailsContainer.width,
          height: detailsContainer.height,
          name: detailsContainer.name,
          layoutMode: detailsContainer.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

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
  registerMuiImports(context, "Accordion", "AccordionSummary", "AccordionDetails", "Box", "Typography");

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
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
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
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    })
  ]);

  const baseAccordionLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
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

  return `${indent}<Accordion
${indent}  expanded={accordionState[${literal(accordionModel.key)}] ?? ${accordionModel.defaultExpanded ? "true" : "false"}}
${indent}  onChange={(_, expanded) => updateAccordionState(${literal(accordionModel.key)}, expanded)}
${indent}  disableGutters
${indent}  elevation={0}
${indent}  square
${indent}  sx={{ ${accordionSx}, "&::before": { display: "none" } }}
${indent}>
${indent}  <AccordionSummary expandIcon={${expandIconExpression}} sx={{ ${summarySx} }}>
${indent}    <Box sx={{ width: "100%", position: "relative", minHeight: ${literal(`${Math.max(20, Math.round(summaryContent.height ?? 24))}px`)} }}>
${renderedSummary || `${indent}      <Typography>{${literal(summaryFallbackLabel)}}</Typography>`}
${indent}    </Box>
${indent}  </AccordionSummary>
${indent}  <AccordionDetails sx={{ p: 0 }}>
${indent}    <Box sx={{ ${detailsSx} }}>
${renderedDetails || `${indent}      <Box />`}
${indent}    </Box>
${indent}  </AccordionDetails>
${indent}</Accordion>`;
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

  if (iconNode && isIconOnlyButton) {
    registerMuiImports(context, "IconButton");
    const iconColor = resolveIconColor(iconNode) ?? buttonTextColor;
    const baseIconButtonLayoutEntries = baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens
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
    tokens: context.tokens
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
  const disabledProp = inferredDisabled ? " disabled" : "";
  const startIconProp = iconExpression && !iconBelongsAtEnd ? ` startIcon={${iconExpression}}` : "";
  const endIconProp = iconExpression && iconBelongsAtEnd ? ` endIcon={${iconExpression}}` : "";
  const typeProp = navigation ? "" : ` type={primarySubmitButtonKey === ${literal(buttonKey)} ? "submit" : "button"}`;
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
  element,
  context
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
  if (hasResponsiveTopLevelLayoutOverrides({ element, context })) {
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
    tokens: context.tokens
  }).filter(([key]) => !STACK_HANDLED_SX_KEYS.has(key));
  return sxString(baseEntries);
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
  if ((element.children?.length ?? 0) === 0 && !hasVisualStyle(element)) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Card", "CardContent");
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
    tokens: context.tokens
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
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const mediaCandidate = sortedChildren.find((child) => child.type === "image" || child.name.toLowerCase().includes("media"));
  const actionCandidates = sortedChildren.filter((child) => {
    if (child.type === "button") {
      return true;
    }
    const loweredName = child.name.toLowerCase();
    return loweredName.includes("action") || loweredName.includes("cta");
  });
  const bodyChildren = sortedChildren.filter((child) => {
    if (child.id === mediaCandidate?.id) {
      return false;
    }
    return !actionCandidates.some((candidate) => candidate.id === child.id);
  });

  const contentElement: ScreenElementIR = {
    ...element,
    children: bodyChildren
  };
  const actionsElement: ScreenElementIR = {
    ...element,
    children: actionCandidates
  };
  const mediaSx = mediaCandidate
    ? sxString([
        ["height", toPxLiteral(mediaCandidate.height ?? 140)],
        ["objectFit", literal("cover")],
        ["display", literal("block")]
      ])
    : undefined;
  if (mediaCandidate) {
    registerMuiImports(context, "CardMedia");
  }
  if (actionCandidates.length > 0) {
    registerMuiImports(context, "CardActions");
  }

  const renderedChildren = renderChildrenIntoParent({
    element: contentElement,
    depth: depth + 2,
    context
  });
  const renderedActions = renderChildrenIntoParent({
    element: actionsElement,
    depth: depth + 2,
    context
  });
  const contentBlock = renderedChildren.trim()
    ? `${indent}  <CardContent>\n${renderedChildren}\n${indent}  </CardContent>`
    : `${indent}  <CardContent />`;
  const mediaBlock = mediaCandidate
    ? (() => {
        const mediaLabel = resolveElementA11yLabel({ element: mediaCandidate, fallback: "Image" });
        const mediaSource = resolveImageSource({
          element: mediaCandidate,
          context,
          fallbackLabel: mediaLabel
        });
        const mediaPerfAttrs = toImagePerformanceAttrs(mediaCandidate);
        if (isDecorativeImageElement(mediaCandidate)) {
          return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt="" aria-hidden="true"${mediaPerfAttrs} sx={{ ${mediaSx} }} />\n`;
        }
        return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt={${literal(mediaLabel)}}${mediaPerfAttrs} sx={{ ${mediaSx} }} />\n`;
      })()
    : "";
  const actionsBlock = renderedActions.trim() ? `\n${indent}  <CardActions>\n${renderedActions}\n${indent}  </CardActions>` : "";
  const roleProp = navigationProps?.roleProp ?? "";
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Card${elevationProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${sxProp}>
${mediaBlock}${contentBlock}${actionsBlock}
${indent}</Card>`;
};

export const renderChip = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Chip");
  const indent = "  ".repeat(depth);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const chipDefaults = context.themeComponentDefaults?.MuiChip;
  const baseChipLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
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
  if (isIconLikeNode(node) || isSemanticIconWrapper(node) || Boolean(pickBestIconNode(node))) {
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

  const toolbarActions = children
    .filter((child) => child.id !== titleNode?.id)
    .map((child) => {
      if (!isLikelyAppBarToolbarActionNode({ node: child, context })) {
        return undefined;
      }
      const iconNode = isIconLikeNode(child) || isSemanticIconWrapper(child) ? child : pickBestIconNode(child);
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
    tokens: context.tokens
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
  return `${indent}<AppBar role="banner" position="static"${sxProp}>
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
  const renderedTabs = tabItems
    .map((tab, index) => {
      const navigation = resolvePrototypeNavigationBinding({ element: tab.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      return `${indent}  <Tab key={${literal(tab.id)}} value={${index}} label={${literal(tab.label)}}${linkProps} />`;
    })
    .join("\n");
  const renderedPanels =
    panelNodes.length === tabItems.length && panelNodes.length > 0
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
            return `${indent}  <Box key={${literal(panelNode.id)}} role="tabpanel" hidden={${tabValueVar} !== ${index}} sx={{ pt: 2 }}>
${panelContent}
${indent}  </Box>`;
          })
          .join("\n")
      : "";
  return `${indent}<Tabs value={${tabValueVar}} onChange={${tabChangeHandlerVar}} sx={{ ${sx} }}>
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
    return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}} sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${detectedPattern.title ? `${indent}  <DialogTitle>{${literal(detectedPattern.title)}}</DialogTitle>\n` : ""}${contentBlock}${actionsBlock}
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
  return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}} sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${title ? `${indent}  <DialogTitle>{${literal(title)}}</DialogTitle>\n` : ""}${contentBlock}
${indent}</Dialog>`;
};

export const renderStepper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const steps = collectRenderedItemLabels(element, context.generationLocale);
  if (steps.length === 0) {
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
    return `${indent}<LinearProgress variant="determinate" value={65} sx={{ ${sx} }} />`;
  }
  registerMuiImports(context, "CircularProgress");
  return `${indent}<CircularProgress variant="determinate" value={65} sx={{ ${sx} }} />`;
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
    tokens: context.tokens
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
    tokens: context.tokens
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
  return `${indent}<BottomNavigation role="navigation" showLabels value={0} sx={{ ${sx} }}>
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
  const roleProp = landmarkRole ? ` role="${landmarkRole}"` : "";
  const ariaHiddenProp = isDecorative ? ' aria-hidden="true"' : "";
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }
  return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Stack>`;
};

export const renderPaper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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
    tokens: context.tokens
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
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : "");
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  if (!renderedChildren.trim()) {
    return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp} />`;
  }
  return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp}>
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
  return `${indent}<Drawer open variant="persistent" slotProps={{ paper: { role: "navigation" } }} sx={{ "& .MuiDrawer-paper": { ${sx} } }}>
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
${indent}          value={controllerField.value ?? ""}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(String(event.target.value))}
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
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
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
  return `${indent}<Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
${indent}  <Alert severity="${severity}" sx={{ ${sx} }}>{${literal(message)}}</Alert>
${indent}</Snackbar>`;
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
    tokens: context.tokens
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
  if (!(isIconLikeNode(element) || isSemanticIconWrapper(element)) || hasMeaningfulTextDescendants({ element, context })) {
    return undefined;
  }
  const baseIconWrapperLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
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

export const tryRenderInputContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
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
  tryRenderInputContainer,
  tryRenderPillShapedButtonContainer,
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
      tokens: context.tokens
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
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : "");
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";

  if (!renderedChildren.trim()) {
    if (!hasVisualStyle(element) && !navigation) {
      return null;
    }
    registerMuiImports(context, "Box");
    return `${indent}<Box${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }

  registerMuiImports(context, "Box");
  return `${indent}<Box${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }}>
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
      return `${indent}<${extractionInvocation.componentName} ${props} />`;
    }

    const mappedElement = renderMappedElement(element, depth, parent, context);
    if (mappedElement) {
      return mappedElement;
    }

    if (element.nodeType === "VECTOR" && element.type !== "image") {
      return null;
    }

    const preDispatchRendered = runElementPreDispatchStrategies({
      element,
      depth,
      parent,
      context
    });
    if (preDispatchRendered !== undefined) {
      return preDispatchRendered;
    }
    return resolveElementRenderStrategy(element.type)({
      element,
      depth,
      parent,
      context
    });
  } finally {
    context.activeRenderElements.delete(element);
  }
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
  componentNameOverride?: string;
  filePathOverride?: string;
  enablePatternExtraction?: boolean;
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
  componentNameOverride,
  filePathOverride,
  enablePatternExtraction = true
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
    enablePatternExtraction
  };
};

export const buildFallbackRenderState = ({ prepared }: { prepared: PreparedFallbackScreenModel }): FallbackRenderState => {
  const {
    screen,
    headingComponentByNodeId,
    typographyVariantByNodeId,
    resolvedThemeComponentDefaults,
    simplifiedChildren,
    rootParent,
    minX,
    minY,
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    tokens,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    extractionPlan
  } = prepared;
  const renderContext: RenderContext = {
    screenId: screen.id,
    screenName: screen.name,
    generationLocale: prepared.resolvedGenerationLocale,
    formHandlingMode: prepared.resolvedFormHandlingMode,
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
    spacingBase: prepared.resolvedSpacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized,
    ...(resolvedThemeComponentDefaults ? { themeComponentDefaults: resolvedThemeComponentDefaults } : {}),
    extractionInvocationByNodeId: extractionPlan.invocationByRootNodeId,
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  };

  const formGroups = detectFormGroups(simplifiedChildren);
  const formGroupByChildIndex = new Map<number, string>();
  for (const group of formGroups) {
    for (const childIndex of group.childIndices) {
      formGroupByChildIndex.set(childIndex, group.groupId);
    }
  }

  const rendered = simplifiedChildren
    .map((element, childIndex) => {
      renderContext.currentFormGroupId = formGroupByChildIndex.get(childIndex);
      return renderElement(
        element,
        3,
        rootParent,
        renderContext
      );
    })
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
  renderContext.currentFormGroupId = undefined;
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
    hasTextInputField,
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
    )
  });

  const allFieldMaps = buildFieldMaps(renderContext.fields);
  const { initialValues, requiredFieldMap, validationTypeMap, validationMessageMap, initialVisualErrorsMap, selectOptionsMap } = allFieldMaps;

  const initialAccordionState = Object.fromEntries(
    renderContext.accordions.map((accordion) => [accordion.key, accordion.defaultExpanded])
  );

  const resolveSubmitButtonKey = (buttons: RenderedButtonModel[]): string => {
    const preferred = buttons.find((button) => button.eligibleForSubmit && button.preferredSubmit);
    const fallback = buttons.find((button) => button.eligibleForSubmit);
    return preferred?.key ?? fallback?.key ?? "";
  };

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

  const submitButtonDeclaration =
    renderContext.buttons.length > 0 ? `const primarySubmitButtonKey = ${literal(primarySubmitButtonKey)};` : "";
  const shouldGenerateFormContext = enablePatternExtraction && hasInteractiveFields && !hasMultipleFormGroups;
  const usesReactHookForm = hasInteractiveFields && resolvedFormHandlingMode === "react_hook_form";
  const formContextFileSpec = shouldGenerateFormContext
    ? usesReactHookForm
      ? buildReactHookFormContextFile({
          screenComponentName: componentName,
          initialValues,
          requiredFieldMap,
          validationTypeMap,
          validationMessageMap,
          initialVisualErrorsMap,
          selectOptionsMap
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
        "resolveFieldErrorMessage"
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
            initialValues
          })
        : buildInlineLegacyFormStateBlock({
            hasSelectField,
            selectOptionsMap,
            initialVisualErrorsMap,
            requiredFieldMap,
            validationTypeMap,
            validationMessageMap,
            initialValues
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
    submitButtonDeclaration,
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
    hasInteractiveFields && usesReactHookForm ? "handleSubmit(onSubmit)" : "handleSubmit";
  const containerFormProps = hasInteractiveFields ? ` component="form" onSubmit={${formSubmitExpression}} noValidate` : "";

  const reactValueImports = hasLocalStatefulElements ? ["useState"] : [];
  const reactTypeImports: string[] = [];
  if (usesInlineLegacyFormState) {
    reactTypeImports.push("FormEvent");
  }
  if (hasTextInputField) {
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
    .map((mappedImport) => `import ${mappedImport.localName} from "${mappedImport.modulePath}";`)
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
    <Container maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  const hasContextProviders = Boolean(patternContextFileSpec) || Boolean(formContextFileSpec);
  let wrappedScreenContent = `      <${contentFunctionName} />`;
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
    <Container maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  const screenContent = `${truncationComment}${reactImportBlock}${reactHookFormImport}${zodImportBlock}${reactRouterImport}${selectChangeEventTypeImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}${extractedComponentImports ? `${extractedComponentImports}\n` : ""}${patternContextImport ? `${patternContextImport}\n` : ""}${formContextImport ? `${formContextImport}\n` : ""}
${patternContextInitialStateDeclaration}${screenExportSource}
`;
  const sharedSxOptimizedScreenContent = extractSharedSxConstantsFromScreenContent(screenContent);
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
  return composeFallbackScreenModule({
    prepared,
    renderState,
    dependencies
  });
};
