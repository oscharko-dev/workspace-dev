import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TypeScript from "typescript";
import {
  collectCustomerProfileImportIssuesFromSource,
  isCustomerProfileMuiFallbackAllowed,
  type CustomerProfileImportIssue,
  type ResolvedCustomerProfile
} from "./customer-profile.js";
import type {
  ComponentMatchIconResolutionReason,
  ComponentMatchIconResolutionStatus,
  ComponentMatchLibraryResolutionReason,
  ComponentMatchLibraryResolutionStatus,
  ComponentMatchReportArtifact,
  ComponentMatchResolvedDiagnosticCode,
  StorybookEvidenceArtifact,
  StorybookEvidenceType,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact
} from "./storybook/types.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "./storybook/types.js";

export interface CustomerProfileValidationIssue {
  code:
    | "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"
    | "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY"
    | "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"
    | CustomerProfileImportIssue["code"];
  message: string;
  filePath?: string;
  modulePath?: string;
}

export interface CustomerProfileValidationSummary {
  status: "ok" | "warn" | "failed";
  import: {
    policy: ResolvedCustomerProfile["strictness"]["import"];
    issueCount: number;
    issues: CustomerProfileValidationIssue[];
  };
  match: {
    policy: ResolvedCustomerProfile["strictness"]["match"];
  };
  token: {
    policy: ResolvedCustomerProfile["strictness"]["token"];
  };
}

export interface CustomerProfileMatchValidationIssue {
  kind: "component" | "icon";
  status: ComponentMatchLibraryResolutionStatus | ComponentMatchIconResolutionStatus;
  reason: ComponentMatchLibraryResolutionReason | ComponentMatchIconResolutionReason;
  figmaFamilyKey: string;
  figmaFamilyName: string;
  componentKey?: string;
  iconKey?: string;
  storybookTier?: string;
  profileFamily?: string;
  message: string;
}

export interface CustomerProfileMatchValidationSummary {
  status: "ok" | "warn" | "failed";
  policy: ResolvedCustomerProfile["strictness"]["match"];
  issueCount: number;
  issues: CustomerProfileMatchValidationIssue[];
  counts: {
    byStatus: Record<ComponentMatchLibraryResolutionStatus, number>;
    byReason: Record<ComponentMatchLibraryResolutionReason, number>;
    iconByStatus: Record<ComponentMatchIconResolutionStatus, number>;
    iconByReason: Record<ComponentMatchIconResolutionReason, number>;
  };
}

export type CustomerProfileComponentApiValidationReason =
  | ComponentMatchResolvedDiagnosticCode
  | "component_api_missing"
  | "component_api_signature_conflict";

export interface CustomerProfileComponentApiValidationIssue {
  severity: "warning" | "error";
  code: CustomerProfileComponentApiValidationReason;
  figmaFamilyKey: string;
  figmaFamilyName: string;
  componentKey?: string;
  sourceProp?: string;
  targetProp?: string;
  message: string;
}

export interface CustomerProfileComponentApiValidationSummary {
  status: "ok" | "warn" | "failed";
  issueCount: number;
  counts: {
    byReason: Record<CustomerProfileComponentApiValidationReason, number>;
  };
  issues: CustomerProfileComponentApiValidationIssue[];
}

export type CustomerProfileStyleValidationIssueCategory =
  | "missing_authoritative_styling_evidence"
  | "reference_only_styling_evidence"
  | "missing_component_match_report"
  | "storybook_token_diagnostic"
  | "storybook_theme_diagnostic"
  | "forbidden_generated_stylesheet"
  | "forbidden_inline_style"
  | "hard_coded_color_literal"
  | "raw_spacing_literal"
  | "raw_typography_declaration"
  | "disallowed_customer_component_prop";

export interface CustomerProfileStyleValidationIssue {
  category: CustomerProfileStyleValidationIssueCategory;
  severity: "warning" | "error";
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  componentName?: string;
  propName?: string;
  artifact?: "storybook.evidence" | "storybook.tokens" | "storybook.themes" | "component.match_report";
  diagnosticCode?: string;
  themeId?: string;
  tokenPath?: string[];
  evidenceTypes?: StorybookEvidenceType[];
}

export interface CustomerProfileStyleArtifactDiagnostics {
  evidence: {
    authoritativeStylingEvidenceCount: number;
    referenceOnlyStylingEvidenceCount: number;
    referenceOnlyEvidenceTypes: StorybookEvidenceType[];
  };
  tokens: {
    diagnosticCount: number;
    errorCount: number;
    diagnostics: Array<{
      severity: "warning" | "error";
      code: string;
      message: string;
      themeId?: string;
      tokenPath?: string[];
    }>;
  };
  themes: {
    diagnosticCount: number;
    errorCount: number;
    diagnostics: Array<{
      severity: "warning" | "error";
      code: string;
      message: string;
      themeId?: string;
      tokenPath?: string[];
    }>;
  };
  componentMatchReport: {
    resolvedCustomerComponentCount: number;
    validatedComponentNames: string[];
  };
}

export interface CustomerProfileStyleValidationSummary {
  status: "ok" | "warn" | "failed" | "not_available";
  policy: ResolvedCustomerProfile["strictness"]["token"];
  issueCount: number;
  issues: CustomerProfileStyleValidationIssue[];
  diagnostics: CustomerProfileStyleArtifactDiagnostics;
}

const COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES = [
  "resolved_import",
  "mui_fallback_allowed",
  "mui_fallback_denied",
  "not_applicable"
] as const satisfies readonly ComponentMatchLibraryResolutionStatus[];
const COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS = [
  "profile_import_resolved",
  "profile_import_missing",
  "profile_import_family_mismatch",
  "profile_family_unresolved",
  "match_ambiguous",
  "match_unmatched"
] as const satisfies readonly ComponentMatchLibraryResolutionReason[];
const COMPONENT_MATCH_ICON_RESOLUTION_STATUSES = [
  "resolved_import",
  "wrapper_fallback_allowed",
  "wrapper_fallback_denied",
  "unresolved",
  "ambiguous",
  "not_applicable"
] as const satisfies readonly ComponentMatchIconResolutionStatus[];
const COMPONENT_MATCH_ICON_RESOLUTION_REASONS = [
  "profile_icon_import_resolved",
  "profile_icon_import_missing",
  "profile_icon_wrapper_allowed",
  "profile_icon_wrapper_denied",
  "profile_icon_wrapper_missing",
  "profile_family_unresolved",
  "match_ambiguous",
  "match_unmatched",
  "not_icon_family"
] as const satisfies readonly ComponentMatchIconResolutionReason[];
const ISSUE_LIBRARY_RESOLUTION_REASONS = new Set<ComponentMatchLibraryResolutionReason>([
  "match_ambiguous",
  "match_unmatched",
  "profile_family_unresolved",
  "profile_import_missing",
  "profile_import_family_mismatch"
]);
const ISSUE_ICON_RESOLUTION_REASONS = new Set<ComponentMatchIconResolutionReason>([
  "match_ambiguous",
  "match_unmatched",
  "profile_icon_import_missing",
  "profile_icon_wrapper_denied",
  "profile_icon_wrapper_missing",
  "profile_family_unresolved"
]);
const COMPONENT_API_REASON_CODES = [
  "component_api_children_unsupported",
  "component_api_missing",
  "component_api_prop_unsupported",
  "component_api_signature_conflict",
  "component_api_slot_unsupported"
] as const satisfies readonly CustomerProfileComponentApiValidationReason[];
const SOURCE_FILE_EXTENSIONS = new Set<string>([".ts", ".tsx", ".js", ".jsx"]);
const GENERATED_STYLESHEET_EXTENSIONS = new Set<string>([".css", ".scss"]);
const SCAN_EXCLUDED_DIRECTORIES = new Set<string>(["node_modules", "dist", ".git", ".figmapipe"]);
const AUTHORIZED_STORYBOOK_STYLE_OUTPUTS = new Set<string>(["src/theme/theme.ts", "src/theme/tokens.json"]);
const REFERENCE_ONLY_STYLE_EVIDENCE_TYPES = new Set<StorybookEvidenceType>([
  "docs_image",
  "docs_text",
  "mdx_link",
  "story_design_link"
]);
const COLOR_STYLE_PROPERTY_NAMES = new Set<string>([
  "background",
  "backgroundColor",
  "bgcolor",
  "borderColor",
  "caretColor",
  "color",
  "fill",
  "outlineColor",
  "stroke"
]);
const SPACING_STYLE_PROPERTY_NAMES = new Set<string>([
  "columnGap",
  "gap",
  "m",
  "margin",
  "marginBlock",
  "marginBlockEnd",
  "marginBlockStart",
  "marginBottom",
  "marginInline",
  "marginInlineEnd",
  "marginInlineStart",
  "marginLeft",
  "marginRight",
  "marginTop",
  "mb",
  "ml",
  "mr",
  "mt",
  "mx",
  "my",
  "p",
  "padding",
  "paddingBlock",
  "paddingBlockEnd",
  "paddingBlockStart",
  "paddingBottom",
  "paddingInline",
  "paddingInlineEnd",
  "paddingInlineStart",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "pb",
  "pl",
  "pr",
  "pt",
  "px",
  "py",
  "rowGap"
]);
const TYPOGRAPHY_STYLE_PROPERTY_NAMES = new Set<string>([
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textTransform"
]);
const IMPLICIT_ALLOWED_COMPONENT_PROP_NAMES = new Set<string>(["key", "ref"]);
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;
const COLOR_FUNCTION_PATTERN = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/iu;
// CSS Color Level 4 named colors (148) + currentcolor + transparent.
const NAMED_COLOR_PATTERN =
  /^(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen|currentcolor|transparent)$/iu;
const SPACING_UNIT_PATTERN =
  /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|ex|ch|pt|pc|in|cm|mm|vh|vw|vmin|vmax|fr|%|cqw|cqh|cqi|cqb|cqmin|cqmax)$/iu;
const TYPOGRAPHY_KEYWORD_PATTERN = /^(?:inherit|initial|normal|revert|unset)$/iu;
const TYPOGRAPHY_TOKEN_REFERENCE_PATTERN = /^(?:theme\.|tokens?\.|var\(--)/iu;

let cachedTypescriptModule: typeof TypeScript | null | undefined;
let resolveTypescriptModuleOverride:
  | (() => typeof TypeScript | null)
  | undefined;

export const __setTypescriptModuleResolverForCustomerProfileValidationTests = (
  resolver?: () => typeof TypeScript | null
): void => {
  resolveTypescriptModuleOverride = resolver;
  cachedTypescriptModule = undefined;
};

export const __resetTypescriptModuleResolverForCustomerProfileValidationTests = (): void => {
  __setTypescriptModuleResolverForCustomerProfileValidationTests(undefined);
};

const resolveTypescriptModule = (): typeof TypeScript | null => {
  if (resolveTypescriptModuleOverride) {
    return resolveTypescriptModuleOverride();
  }
  if (cachedTypescriptModule !== undefined) {
    return cachedTypescriptModule;
  }

  try {
    const requireFromModule = createRequire(import.meta.url);
    cachedTypescriptModule = requireFromModule("typescript") as typeof TypeScript;
  } catch {
    cachedTypescriptModule = null;
  }

  return cachedTypescriptModule;
};

const getTypescriptModuleForStyleValidation = (): typeof TypeScript => {
  const typescriptModule = resolveTypescriptModule();
  if (typescriptModule) {
    return typescriptModule;
  }
  throw new Error(
    "Storybook-first style validation requires the optional 'typescript' peer dependency to be installed."
  );
};

const readJsonRecord = async ({ filePath }: { filePath: string }): Promise<Record<string, unknown>> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object at '${filePath}'.`);
  }
  return parsed as Record<string, unknown>;
};

const collectFiles = async ({
  directoryPath,
  extensions
}: {
  directoryPath: string;
  extensions: ReadonlySet<string>;
}): Promise<string[]> => {
  const results: string[] = [];
  const walk = async (currentPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (SCAN_EXCLUDED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (extensions.has(extension)) {
        results.push(absolutePath);
      }
    }
  };

  await walk(directoryPath);
  return results.sort((left, right) => left.localeCompare(right));
};

const collectSourceFiles = async ({
  directoryPath
}: {
  directoryPath: string;
}): Promise<string[]> => {
  return collectFiles({
    directoryPath,
    extensions: SOURCE_FILE_EXTENSIONS
  });
};

const toRelativeGeneratedProjectPath = ({
  generatedProjectDir,
  filePath
}: {
  generatedProjectDir: string;
  filePath: string;
}): string => {
  return path.relative(generatedProjectDir, filePath).split(path.sep).join("/");
};

const isAuthorizedStorybookStyleOutput = ({ relativeFilePath }: { relativeFilePath: string }): boolean => {
  return AUTHORIZED_STORYBOOK_STYLE_OUTPUTS.has(relativeFilePath);
};

const createEmptyStyleDiagnostics = (): CustomerProfileStyleArtifactDiagnostics => ({
  evidence: {
    authoritativeStylingEvidenceCount: 0,
    referenceOnlyStylingEvidenceCount: 0,
    referenceOnlyEvidenceTypes: []
  },
  tokens: {
    diagnosticCount: 0,
    errorCount: 0,
    diagnostics: []
  },
  themes: {
    diagnosticCount: 0,
    errorCount: 0,
    diagnostics: []
  },
  componentMatchReport: {
    resolvedCustomerComponentCount: 0,
    validatedComponentNames: []
  }
});

const toStyleValidationStatus = ({
  issueCount,
  policy
}: {
  issueCount: number;
  policy: ResolvedCustomerProfile["strictness"]["token"];
}): CustomerProfileStyleValidationSummary["status"] => {
  if (issueCount === 0) {
    return "ok";
  }
  if (policy === "error") {
    return "failed";
  }
  if (policy === "warn") {
    return "warn";
  }
  return "ok";
};

const normalizeStyleDiagnosticEntry = ({
  diagnostic
}: {
  diagnostic: {
    severity: "warning" | "error";
    code: string;
    message: string;
    themeId?: string;
    tokenPath?: string[];
  };
}) => {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.themeId ? { themeId: diagnostic.themeId } : {}),
    ...(diagnostic.tokenPath ? { tokenPath: [...diagnostic.tokenPath] } : {})
  };
};

interface StyleValidationCustomerComponentContract {
  componentKey: string;
  allowedProps: ReadonlySet<string>;
}

const collectCustomerComponentContracts = ({
  artifact
}: {
  artifact: ComponentMatchReportArtifact;
}): Map<string, StyleValidationCustomerComponentContract> => {
  const byComponentName = new Map<string, StyleValidationCustomerComponentContract>();

  for (const entry of artifact.entries) {
    if (entry.libraryResolution.status !== "resolved_import" || entry.resolvedApi?.status !== "resolved") {
      continue;
    }
    const localName = entry.libraryResolution.import?.localName.trim();
    const componentKey = entry.libraryResolution.componentKey?.trim() ?? entry.resolvedApi.componentKey?.trim();
    if (!localName || !componentKey) {
      continue;
    }

    const existing = byComponentName.get(localName);
    const allowedPropNames = new Set<string>([
      ...(existing ? existing.allowedProps : []),
      ...entry.resolvedApi.allowedProps.map((prop) => prop.name)
    ]);
    byComponentName.set(localName, {
      componentKey,
      allowedProps: allowedPropNames
    });
  }

  return byComponentName;
};

const resolveObjectPropertyName = (
  typescriptModule: typeof TypeScript,
  name: TypeScript.PropertyName
): string | undefined => {
  if (typescriptModule.isIdentifier(name) || typescriptModule.isStringLiteralLike(name) || typescriptModule.isNumericLiteral(name)) {
    return name.text;
  }
  if (typescriptModule.isComputedPropertyName(name)) {
    const expression = name.expression;
    if (typescriptModule.isStringLiteralLike(expression) || typescriptModule.isNumericLiteral(expression)) {
      return expression.text;
    }
  }
  return undefined;
};

const resolveJsxAttributeName = (
  typescriptModule: typeof TypeScript,
  attribute: TypeScript.JsxAttribute
): string | undefined => {
  return typescriptModule.isIdentifier(attribute.name) ? attribute.name.text : undefined;
};

const resolveLiteralText = (
  typescriptModule: typeof TypeScript,
  expression: TypeScript.Expression
): string | undefined => {
  if (typescriptModule.isStringLiteralLike(expression) || typescriptModule.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.trim();
  }
  return undefined;
};

const isRawColorLiteral = ({
  typescriptModule,
  expression
}: {
  typescriptModule: typeof TypeScript;
  expression: TypeScript.Expression;
}): boolean => {
  if (typescriptModule.isTemplateExpression(expression)) {
    return true;
  }
  const literalText = resolveLiteralText(typescriptModule, expression);
  if (!literalText) {
    return false;
  }
  return HEX_COLOR_PATTERN.test(literalText) || COLOR_FUNCTION_PATTERN.test(literalText) || NAMED_COLOR_PATTERN.test(literalText);
};

const isRawSpacingLiteral = ({
  typescriptModule,
  expression,
  attributeName
}: {
  typescriptModule: typeof TypeScript;
  expression: TypeScript.Expression;
  attributeName: string;
}): boolean => {
  if (typescriptModule.isNumericLiteral(expression) || (
    typescriptModule.isPrefixUnaryExpression(expression) &&
    expression.operator === typescriptModule.SyntaxKind.MinusToken &&
    typescriptModule.isNumericLiteral(expression.operand)
  )) {
    return attributeName === "style";
  }
  if (typescriptModule.isTemplateExpression(expression)) {
    return true;
  }
  const literalText = resolveLiteralText(typescriptModule, expression);
  if (literalText === undefined) {
    return false;
  }
  if (literalText === "0") {
    return true;
  }
  return SPACING_UNIT_PATTERN.test(literalText);
};

const isRawTypographyLiteral = ({
  typescriptModule,
  expression
}: {
  typescriptModule: typeof TypeScript;
  expression: TypeScript.Expression;
}): boolean => {
  if (typescriptModule.isNumericLiteral(expression) || (
    typescriptModule.isPrefixUnaryExpression(expression) &&
    expression.operator === typescriptModule.SyntaxKind.MinusToken &&
    typescriptModule.isNumericLiteral(expression.operand)
  )) {
    return true;
  }

  if (typescriptModule.isTemplateExpression(expression)) {
    return true;
  }

  const literalText = resolveLiteralText(typescriptModule, expression);
  if (!literalText || TYPOGRAPHY_KEYWORD_PATTERN.test(literalText)) {
    return false;
  }

  if (TYPOGRAPHY_TOKEN_REFERENCE_PATTERN.test(literalText)) {
    return false;
  }

  return true;
};

const unwrapStyleExpression = ({
  typescriptModule,
  expression
}: {
  typescriptModule: typeof TypeScript;
  expression: TypeScript.Expression;
}): TypeScript.Expression => {
  let currentExpression = expression;
  let continueUnwrapping = true;
  while (continueUnwrapping) {
    continueUnwrapping = false;
    if (typescriptModule.isParenthesizedExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continueUnwrapping = true;
      continue;
    }
    if (typescriptModule.isAsExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continueUnwrapping = true;
      continue;
    }
    if (typescriptModule.isSatisfiesExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continueUnwrapping = true;
      continue;
    }
    if (typescriptModule.isTypeAssertionExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continueUnwrapping = true;
      continue;
    }
    if (typescriptModule.isNonNullExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continueUnwrapping = true;
      continue;
    }
  }
  return currentExpression;
};

interface StyleExpressionBinding {
  expression: TypeScript.Expression;
  position: number;
}

const collectStyleExpressionBindings = ({
  typescriptModule,
  sourceFile
}: {
  typescriptModule: typeof TypeScript;
  sourceFile: TypeScript.SourceFile;
}): Map<string, StyleExpressionBinding[]> => {
  const bindingsByIdentifier = new Map<string, StyleExpressionBinding[]>();

  const visit = (node: TypeScript.Node): void => {
    if (typescriptModule.isVariableDeclaration(node) && typescriptModule.isIdentifier(node.name) && node.initializer) {
      const existingBindings = bindingsByIdentifier.get(node.name.text) ?? [];
      existingBindings.push({
        expression: node.initializer,
        position: node.getStart(sourceFile)
      });
      bindingsByIdentifier.set(node.name.text, existingBindings);
    }
    typescriptModule.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const bindings of bindingsByIdentifier.values()) {
    bindings.sort((left, right) => left.position - right.position);
  }

  return bindingsByIdentifier;
};

const resolveStyleExpressionBinding = ({
  bindingsByIdentifier,
  identifierName,
  referencePosition
}: {
  bindingsByIdentifier: Map<string, StyleExpressionBinding[]>;
  identifierName: string;
  referencePosition: number;
}): StyleExpressionBinding | undefined => {
  const bindings = bindingsByIdentifier.get(identifierName);
  if (!bindings || bindings.length === 0) {
    return undefined;
  }

  let resolvedBinding: StyleExpressionBinding | undefined;
  for (const binding of bindings) {
    if (binding.position > referencePosition) {
      break;
    }
    resolvedBinding = binding;
  }
  return resolvedBinding;
};

const resolveObjectLiteralFromExpression = ({
  typescriptModule,
  expression,
  styleExpressionBindings,
  referencePosition,
  seenBindingKeys = new Set<string>()
}: {
  typescriptModule: typeof TypeScript;
  expression: TypeScript.Expression;
  styleExpressionBindings: Map<string, StyleExpressionBinding[]>;
  referencePosition: number;
  seenBindingKeys?: Set<string>;
}): TypeScript.ObjectLiteralExpression | undefined => {
  const unwrappedExpression = unwrapStyleExpression({
    typescriptModule,
    expression
  });
  if (typescriptModule.isObjectLiteralExpression(unwrappedExpression)) {
    return unwrappedExpression;
  }
  if (!typescriptModule.isIdentifier(unwrappedExpression)) {
    return undefined;
  }

  const styleExpressionBinding = resolveStyleExpressionBinding({
    bindingsByIdentifier: styleExpressionBindings,
    identifierName: unwrappedExpression.text,
    referencePosition
  });
  if (!styleExpressionBinding) {
    return undefined;
  }

  const bindingKey = `${unwrappedExpression.text}:${styleExpressionBinding.position}`;
  if (seenBindingKeys.has(bindingKey)) {
    return undefined;
  }

  seenBindingKeys.add(bindingKey);
  const resolvedObjectLiteral = resolveObjectLiteralFromExpression({
    typescriptModule,
    expression: styleExpressionBinding.expression,
    styleExpressionBindings,
    referencePosition: styleExpressionBinding.position,
    seenBindingKeys
  });
  seenBindingKeys.delete(bindingKey);
  return resolvedObjectLiteral;
};

const resolveObjectLiteralInitializer = ({
  typescriptModule,
  attribute,
  sourceFile,
  styleExpressionBindings
}: {
  typescriptModule: typeof TypeScript;
  attribute: TypeScript.JsxAttribute;
  sourceFile: TypeScript.SourceFile;
  styleExpressionBindings: Map<string, StyleExpressionBinding[]>;
}): TypeScript.ObjectLiteralExpression | undefined => {
  if (!attribute.initializer || !typescriptModule.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return undefined;
  }
  return resolveObjectLiteralFromExpression({
    typescriptModule,
    expression: attribute.initializer.expression,
    styleExpressionBindings,
    referencePosition: attribute.getStart(sourceFile)
  });
};

const isImplicitlyAllowedComponentProp = (propName: string): boolean => {
  return IMPLICIT_ALLOWED_COMPONENT_PROP_NAMES.has(propName) || propName.startsWith("aria-") || propName.startsWith("data-");
};

const pushStyleIssue = ({
  issues,
  seenIssueKeys,
  issue
}: {
  issues: CustomerProfileStyleValidationIssue[];
  seenIssueKeys: Set<string>;
  issue: CustomerProfileStyleValidationIssue;
}): void => {
  const dedupeKey = JSON.stringify({
    category: issue.category,
    filePath: issue.filePath,
    line: issue.line,
    column: issue.column,
    componentName: issue.componentName,
    propName: issue.propName,
    diagnosticCode: issue.diagnosticCode,
    themeId: issue.themeId,
    tokenPath: issue.tokenPath,
    evidenceTypes: issue.evidenceTypes,
    message: issue.message
  });
  if (seenIssueKeys.has(dedupeKey)) {
    return;
  }
  seenIssueKeys.add(dedupeKey);
  issues.push(issue);
};

const toSourceLocation = ({
  sourceFile,
  node
}: {
  sourceFile: TypeScript.SourceFile;
  node: TypeScript.Node;
}): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: line + 1,
    column: character + 1
  };
};

const scanStyleObjectLiteral = ({
  typescriptModule,
  sourceFile,
  relativeFilePath,
  attributeName,
  componentName,
  objectLiteral,
  issues,
  seenIssueKeys,
  styleExpressionBindings,
  activeStylePropertyName
}: {
  typescriptModule: typeof TypeScript;
  sourceFile: TypeScript.SourceFile;
  relativeFilePath: string;
  attributeName: string;
  componentName?: string;
  objectLiteral: TypeScript.ObjectLiteralExpression;
  issues: CustomerProfileStyleValidationIssue[];
  seenIssueKeys: Set<string>;
  styleExpressionBindings: Map<string, StyleExpressionBinding[]>;
  activeStylePropertyName?: string;
}): void => {
  for (const property of objectLiteral.properties) {
    if (typescriptModule.isSpreadAssignment(property)) {
      const spreadObjectLiteral = resolveObjectLiteralFromExpression({
        typescriptModule,
        expression: property.expression,
        styleExpressionBindings,
        referencePosition: property.expression.getStart(sourceFile)
      });
      if (spreadObjectLiteral) {
        scanStyleObjectLiteral({
          typescriptModule,
          sourceFile,
          relativeFilePath,
          attributeName,
          ...(componentName ? { componentName } : {}),
          objectLiteral: spreadObjectLiteral,
          issues,
          seenIssueKeys,
          styleExpressionBindings,
          ...(activeStylePropertyName ? { activeStylePropertyName } : {})
        });
      }
      continue;
    }
    if (!typescriptModule.isPropertyAssignment(property) && !typescriptModule.isShorthandPropertyAssignment(property)) {
      continue;
    }

    const propertyName = typescriptModule.isShorthandPropertyAssignment(property)
      ? property.name.text
      : resolveObjectPropertyName(typescriptModule, property.name);
    if (!propertyName) {
      continue;
    }

    const stylePropertyName =
      COLOR_STYLE_PROPERTY_NAMES.has(propertyName) ||
      SPACING_STYLE_PROPERTY_NAMES.has(propertyName) ||
      TYPOGRAPHY_STYLE_PROPERTY_NAMES.has(propertyName)
        ? propertyName
        : activeStylePropertyName;

    const propertyValue = typescriptModule.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    const nestedObjectLiteral = resolveObjectLiteralFromExpression({
      typescriptModule,
      expression: propertyValue,
      styleExpressionBindings,
      referencePosition: propertyValue.getStart(sourceFile)
    });
    if (nestedObjectLiteral) {
      scanStyleObjectLiteral({
        typescriptModule,
        sourceFile,
        relativeFilePath,
        attributeName,
        ...(componentName ? { componentName } : {}),
        objectLiteral: nestedObjectLiteral,
        issues,
        seenIssueKeys,
        styleExpressionBindings,
        ...(stylePropertyName ? { activeStylePropertyName: stylePropertyName } : {})
      });
      continue;
    }

    const location = toSourceLocation({
      sourceFile,
      node: property
    });
    if (stylePropertyName && COLOR_STYLE_PROPERTY_NAMES.has(stylePropertyName) && isRawColorLiteral({ typescriptModule, expression: propertyValue })) {
      pushStyleIssue({
        issues,
        seenIssueKeys,
        issue: {
          category: "hard_coded_color_literal",
          severity: "error",
          message:
            `Generated source must reference Storybook theme tokens instead of hard-coded color literals ` +
            `for '${stylePropertyName}'.`,
          filePath: relativeFilePath,
          ...location,
          ...(componentName ? { componentName } : {}),
          propName: stylePropertyName
        }
      });
    }

    if (
      stylePropertyName &&
      SPACING_STYLE_PROPERTY_NAMES.has(stylePropertyName) &&
      isRawSpacingLiteral({ typescriptModule, expression: propertyValue, attributeName })
    ) {
      pushStyleIssue({
        issues,
        seenIssueKeys,
        issue: {
          category: "raw_spacing_literal",
          severity: "error",
          message:
            `Generated source must avoid raw spacing literals for '${stylePropertyName}' ` +
            `outside Storybook-derived theme tokens.`,
          filePath: relativeFilePath,
          ...location,
          ...(componentName ? { componentName } : {}),
          propName: stylePropertyName
        }
      });
    }

    if (
      stylePropertyName &&
      TYPOGRAPHY_STYLE_PROPERTY_NAMES.has(stylePropertyName) &&
      isRawTypographyLiteral({ typescriptModule, expression: propertyValue })
    ) {
      pushStyleIssue({
        issues,
        seenIssueKeys,
        issue: {
          category: "raw_typography_declaration",
          severity: "error",
          message:
            `Generated source must keep typography declarations in Storybook-derived theme outputs; ` +
            `found raw '${stylePropertyName}' styling.`,
          filePath: relativeFilePath,
          ...location,
          ...(componentName ? { componentName } : {}),
          propName: stylePropertyName
        }
      });
    }
  }
};

const scanGeneratedSourceFileForStyleIssues = ({
  generatedProjectDir,
  sourceFilePath,
  customerComponents
}: {
  generatedProjectDir: string;
  sourceFilePath: string;
  customerComponents: Map<string, StyleValidationCustomerComponentContract>;
}): Promise<CustomerProfileStyleValidationIssue[]> => {
  return readFile(sourceFilePath, "utf8").then((content) => {
    const typescriptModule = getTypescriptModuleForStyleValidation();
    const relativeFilePath = toRelativeGeneratedProjectPath({
      generatedProjectDir,
      filePath: sourceFilePath
    });
    const sourceFile = typescriptModule.createSourceFile(
      relativeFilePath,
      content,
      typescriptModule.ScriptTarget.Latest,
      true,
      relativeFilePath.endsWith(".tsx") || relativeFilePath.endsWith(".jsx")
        ? typescriptModule.ScriptKind.TSX
        : typescriptModule.ScriptKind.TS
    );
    const issues: CustomerProfileStyleValidationIssue[] = [];
    const seenIssueKeys = new Set<string>();
    const styleExpressionBindings = collectStyleExpressionBindings({
      typescriptModule,
      sourceFile
    });

    const visit = (node: TypeScript.Node): void => {
      if (typescriptModule.isJsxOpeningElement(node) || typescriptModule.isJsxSelfClosingElement(node)) {
        const componentName = typescriptModule.isIdentifier(node.tagName) ? node.tagName.text : undefined;
        const customerComponent = componentName ? customerComponents.get(componentName) : undefined;

        for (const attribute of node.attributes.properties) {
          if (!typescriptModule.isJsxAttribute(attribute)) {
            continue;
          }
          const attributeName = resolveJsxAttributeName(typescriptModule, attribute);
          if (!attributeName) {
            continue;
          }

          const location = toSourceLocation({
            sourceFile,
            node: attribute
          });
          if (customerComponent && !customerComponent.allowedProps.has(attributeName) && !isImplicitlyAllowedComponentProp(attributeName)) {
            pushStyleIssue({
              issues,
              seenIssueKeys,
              issue: {
                category: "disallowed_customer_component_prop",
                severity: "error",
                message:
                  `Generated source forwarded disallowed prop '${attributeName}' to customer component ` +
                  `'${componentName}'.`,
                filePath: relativeFilePath,
                ...location,
                ...(componentName ? { componentName } : {}),
                propName: attributeName,
                artifact: "component.match_report"
              }
            });
          }

          if (attributeName === "style") {
            pushStyleIssue({
              issues,
              seenIssueKeys,
              issue: {
                category: "forbidden_inline_style",
                severity: "error",
                message: "Generated source must not use inline style={{...}} objects.",
                filePath: relativeFilePath,
                ...location,
                ...(componentName ? { componentName } : {}),
                propName: "style"
              }
            });
          }

          if (attributeName !== "style" && attributeName !== "sx") {
            continue;
          }

          const objectLiteral = resolveObjectLiteralInitializer({
            typescriptModule,
            attribute,
            sourceFile,
            styleExpressionBindings
          });
          if (!objectLiteral) {
            continue;
          }

          scanStyleObjectLiteral({
            typescriptModule,
            sourceFile,
            relativeFilePath,
            attributeName,
            ...(componentName ? { componentName } : {}),
            objectLiteral,
            issues,
            seenIssueKeys,
            styleExpressionBindings
          });
        }
      }

      typescriptModule.forEachChild(node, visit);
    };

    visit(sourceFile);
    return issues.sort((left, right) => {
      const byFilePath = (left.filePath ?? "").localeCompare(right.filePath ?? "");
      if (byFilePath !== 0) {
        return byFilePath;
      }
      const byLine = (left.line ?? 0) - (right.line ?? 0);
      if (byLine !== 0) {
        return byLine;
      }
      const byColumn = (left.column ?? 0) - (right.column ?? 0);
      if (byColumn !== 0) {
        return byColumn;
      }
      return left.message.localeCompare(right.message);
    });
  });
};

const validateTemplateDependencies = ({
  packageJson,
  customerProfile
}: {
  packageJson: Record<string, unknown>;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileValidationIssue[] => {
  const issues: CustomerProfileValidationIssue[] = [];
  const dependencies =
    typeof packageJson.dependencies === "object" && packageJson.dependencies !== null && !Array.isArray(packageJson.dependencies)
      ? (packageJson.dependencies as Record<string, string>)
      : {};
  const devDependencies =
    typeof packageJson.devDependencies === "object" &&
    packageJson.devDependencies !== null &&
    !Array.isArray(packageJson.devDependencies)
      ? (packageJson.devDependencies as Record<string, string>)
      : {};

  for (const [packageName, version] of Object.entries(customerProfile.template.dependencies)) {
    if (dependencies[packageName] === version) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY",
      filePath: "package.json",
      modulePath: packageName,
      message: `package.json must declare dependency '${packageName}' with version '${version}'.`
    });
  }

  for (const [packageName, version] of Object.entries(customerProfile.template.devDependencies)) {
    if (devDependencies[packageName] === version) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY",
      filePath: "package.json",
      modulePath: packageName,
      message: `package.json must declare devDependency '${packageName}' with version '${version}'.`
    });
  }

  return issues;
};

const validateTemplateAliases = async ({
  generatedProjectDir,
  customerProfile
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
}): Promise<CustomerProfileValidationIssue[]> => {
  const issues: CustomerProfileValidationIssue[] = [];
  if (Object.keys(customerProfile.template.importAliases).length === 0) {
    return issues;
  }

  const tsconfigPath = path.join(generatedProjectDir, "tsconfig.json");
  const tsconfig = await readJsonRecord({ filePath: tsconfigPath });
  const compilerOptions =
    typeof tsconfig.compilerOptions === "object" && tsconfig.compilerOptions !== null && !Array.isArray(tsconfig.compilerOptions)
      ? (tsconfig.compilerOptions as Record<string, unknown>)
      : {};
  const paths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null && !Array.isArray(compilerOptions.paths)
      ? (compilerOptions.paths as Record<string, unknown>)
      : {};

  for (const [aliasKey, target] of Object.entries(customerProfile.template.importAliases)) {
    const tsconfigValue = paths[aliasKey];
    const normalizedTsconfigValue =
      Array.isArray(tsconfigValue) && typeof tsconfigValue[0] === "string" ? tsconfigValue[0] : undefined;
    if (compilerOptions.baseUrl !== "." || normalizedTsconfigValue !== target) {
      issues.push({
        code: "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS",
        filePath: "tsconfig.json",
        modulePath: aliasKey,
        message: `tsconfig.json must map alias '${aliasKey}' to '${target}'.`
      });
    }
  }

  const viteConfigPath = path.join(generatedProjectDir, "vite.config.ts");
  const viteConfig = await readFile(viteConfigPath, "utf8");
  for (const [aliasKey, target] of Object.entries(customerProfile.template.importAliases)) {
    const aliasSnippet = `${JSON.stringify(aliasKey)}: ${JSON.stringify(target)}`;
    if (viteConfig.includes(aliasSnippet)) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS",
      filePath: "vite.config.ts",
      modulePath: aliasKey,
      message: `vite.config.ts must map alias '${aliasKey}' to '${target}'.`
    });
  }

  return issues;
};

const createMatchStatusCounts = (): Record<ComponentMatchLibraryResolutionStatus, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES.map((status) => [status, 0])
  ) as Record<ComponentMatchLibraryResolutionStatus, number>;
};

const createMatchReasonCounts = (): Record<ComponentMatchLibraryResolutionReason, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS.map((reason) => [reason, 0])
  ) as Record<ComponentMatchLibraryResolutionReason, number>;
};

const createIconStatusCounts = (): Record<ComponentMatchIconResolutionStatus, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_ICON_RESOLUTION_STATUSES.map((status) => [status, 0])
  ) as Record<ComponentMatchIconResolutionStatus, number>;
};

const createIconReasonCounts = (): Record<ComponentMatchIconResolutionReason, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_ICON_RESOLUTION_REASONS.map((reason) => [reason, 0])
  ) as Record<ComponentMatchIconResolutionReason, number>;
};

const createComponentApiReasonCounts = (): Record<CustomerProfileComponentApiValidationReason, number> => {
  return Object.fromEntries(
    COMPONENT_API_REASON_CODES.map((reason) => [reason, 0])
  ) as Record<CustomerProfileComponentApiValidationReason, number>;
};

const toCustomerProfileMatchIssueMessage = ({
  iconKey,
  componentKey,
  figmaFamilyName,
  profileFamily,
  reason,
  storybookTier
}: {
  iconKey?: string;
  componentKey?: string;
  figmaFamilyName: string;
  profileFamily?: string;
  reason: ComponentMatchLibraryResolutionReason | ComponentMatchIconResolutionReason;
  storybookTier?: string;
}): string => {
  const componentLabel = iconKey
    ? `icon '${iconKey}' in Figma family '${figmaFamilyName}'`
    : componentKey
      ? `component '${componentKey}'`
      : `Figma family '${figmaFamilyName}'`;
  if (reason === "match_ambiguous") {
    return `${componentLabel} remains ambiguous in component.match_report.`;
  }
  if (reason === "match_unmatched") {
    return `${componentLabel} is unmatched in component.match_report.`;
  }
  if (reason === "profile_icon_import_missing") {
    return `${componentLabel} has no exact customer profile icon import.`;
  }
  if (reason === "profile_icon_wrapper_denied") {
    return `${componentLabel} is denied generic customer icon wrapper fallback.`;
  }
  if (reason === "profile_icon_wrapper_missing") {
    return `${componentLabel} allows generic customer icon wrapper fallback but no wrapper binding is configured.`;
  }
  if (reason === "profile_family_unresolved") {
    return `${componentLabel} could not resolve Storybook tier '${storybookTier ?? "unknown"}' to a customer profile family.`;
  }
  if (reason === "profile_import_family_mismatch") {
    return `${componentLabel} resolves to customer profile family '${profileFamily ?? "unknown"}' but its configured import belongs to a different family.`;
  }
  if (reason === "profile_import_missing") {
    return `${componentLabel} has no customer profile import for family '${profileFamily ?? "unknown"}'.`;
  }
  return `${componentLabel} has unrecognized resolution reason '${reason}'.`;
};

export const validateCustomerProfileComponentMatchReport = ({
  artifact,
  customerProfile
}: {
  artifact: ComponentMatchReportArtifact;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileMatchValidationSummary => {
  const counts = {
    byStatus: createMatchStatusCounts(),
    byReason: createMatchReasonCounts(),
    iconByStatus: createIconStatusCounts(),
    iconByReason: createIconReasonCounts()
  };
  const issues: CustomerProfileMatchValidationIssue[] = [];

  for (const entry of artifact.entries) {
    counts.byStatus[entry.libraryResolution.status] += 1;
    counts.byReason[entry.libraryResolution.reason] += 1;
    if (!entry.iconResolution) {
      counts.iconByStatus.not_applicable += 1;
      counts.iconByReason.not_icon_family += 1;
    } else {
      for (const resolution of Object.values(entry.iconResolution.byKey)) {
        counts.iconByStatus[resolution.status] += 1;
        counts.iconByReason[resolution.reason] += 1;
        const hasIconIssueStatus = resolution.status === "wrapper_fallback_denied" || resolution.status === "unresolved";
        const hasIconIssueReason = ISSUE_ICON_RESOLUTION_REASONS.has(resolution.reason);
        if (
          resolution.status === "resolved_import" ||
          resolution.status === "wrapper_fallback_allowed" ||
          resolution.status === "not_applicable" ||
          (!hasIconIssueStatus && !hasIconIssueReason)
        ) {
          continue;
        }
        issues.push({
          kind: "icon",
          status: resolution.status,
          reason: resolution.reason,
          figmaFamilyKey: entry.figma.familyKey,
          figmaFamilyName: entry.figma.familyName,
          iconKey: resolution.iconKey,
          ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {}),
          ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
          message: toCustomerProfileMatchIssueMessage({
            figmaFamilyName: entry.figma.familyName,
            iconKey: resolution.iconKey,
            reason: resolution.reason,
            ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
            ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {})
          })
        });
      }
    }

    const hasNonIssueStatus =
      entry.libraryResolution.status === "resolved_import" || entry.libraryResolution.status === "mui_fallback_allowed";
    const hasIssueReason = ISSUE_LIBRARY_RESOLUTION_REASONS.has(entry.libraryResolution.reason);
    const hasIssueStatus = entry.libraryResolution.status === "mui_fallback_denied";
    if (hasNonIssueStatus || (!hasIssueReason && !hasIssueStatus)) {
      continue;
    }

    issues.push({
      kind: "component",
      status: entry.libraryResolution.status,
      reason: entry.libraryResolution.reason,
      figmaFamilyKey: entry.figma.familyKey,
      figmaFamilyName: entry.figma.familyName,
      ...(entry.libraryResolution.componentKey ? { componentKey: entry.libraryResolution.componentKey } : {}),
      ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {}),
      ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
      message: toCustomerProfileMatchIssueMessage({
        figmaFamilyName: entry.figma.familyName,
        reason: entry.libraryResolution.reason,
        ...(entry.libraryResolution.componentKey ? { componentKey: entry.libraryResolution.componentKey } : {}),
        ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
        ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {})
      })
    });
  }

  issues.sort((left, right) => {
    const byFamilyName = left.figmaFamilyName.localeCompare(right.figmaFamilyName);
    if (byFamilyName !== 0) {
      return byFamilyName;
    }
    return left.figmaFamilyKey.localeCompare(right.figmaFamilyKey);
  });

  const status =
    issues.length === 0
      ? "ok"
      : customerProfile.strictness.match === "error"
        ? "failed"
        : customerProfile.strictness.match === "warn"
          ? "warn"
          : "ok";

  return {
    status,
    policy: customerProfile.strictness.match,
    issueCount: issues.length,
    issues,
    counts
  };
};

export const validateCustomerProfileComponentApiComponentMatchReport = ({
  artifact,
  customerProfile
}: {
  artifact: ComponentMatchReportArtifact;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileComponentApiValidationSummary => {
  const issues: CustomerProfileComponentApiValidationIssue[] = [];
  const counts = {
    byReason: createComponentApiReasonCounts()
  };
  const resolvedEntriesByComponentKey = new Map<
    string,
    Array<{
      figmaFamilyKey: string;
      figmaFamilyName: string;
      apiSignature: string | undefined;
      issueSeverity: "warning" | "error";
    }>
  >();

  for (const entry of artifact.entries) {
    if (entry.libraryResolution.status !== "resolved_import") {
      continue;
    }
    const componentKey = entry.libraryResolution.componentKey?.trim();
    const issueSeverity =
      componentKey &&
      isCustomerProfileMuiFallbackAllowed({
        profile: customerProfile,
        componentKey
      })
        ? "warning"
        : "error";

    if (!componentKey || !entry.resolvedApi || !entry.resolvedProps) {
      issues.push({
        severity: issueSeverity,
        code: "component_api_missing",
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        ...(componentKey ? { componentKey } : {}),
        message:
          `component.match_report entry '${entry.figma.familyKey}' is missing resolved component-api data ` +
          `for component '${componentKey ?? "unknown"}'.`
      });
      continue;
    }

    const groupEntries = resolvedEntriesByComponentKey.get(componentKey) ?? [];
    groupEntries.push({
      figmaFamilyKey: entry.figma.familyKey,
      figmaFamilyName: entry.figma.familyName,
      apiSignature:
        entry.resolvedApi.status === "resolved"
          ? JSON.stringify({
              allowedProps: entry.resolvedApi.allowedProps,
              children: entry.resolvedApi.children,
              slots: entry.resolvedApi.slots,
              defaultProps: entry.resolvedApi.defaultProps
            })
          : undefined,
      issueSeverity
    });
    resolvedEntriesByComponentKey.set(componentKey, groupEntries);

    if (entry.resolvedProps.status === "resolved" && entry.resolvedProps.codegenCompatible) {
      continue;
    }

    if (entry.resolvedProps.diagnostics.length === 0) {
      issues.push({
        severity: issueSeverity,
        code: "component_api_missing",
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        componentKey,
        message: `Resolved component '${componentKey}' is not codegen-compatible.`
      });
      continue;
    }

    for (const diagnostic of entry.resolvedProps.diagnostics) {
      issues.push({
        severity: diagnostic.severity,
        code: diagnostic.code,
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        componentKey,
        ...(diagnostic.sourceProp ? { sourceProp: diagnostic.sourceProp } : {}),
        ...(diagnostic.targetProp ? { targetProp: diagnostic.targetProp } : {}),
        message: diagnostic.message
      });
    }
  }

  for (const [componentKey, entries] of resolvedEntriesByComponentKey.entries()) {
    const signatures = new Set(entries.map((entry) => entry.apiSignature).filter((entry): entry is string => Boolean(entry)));
    if (signatures.size <= 1) {
      continue;
    }
    const representative = [...entries].sort((left, right) => left.figmaFamilyName.localeCompare(right.figmaFamilyName))[0];
    issues.push({
      severity: representative?.issueSeverity ?? "error",
      code: "component_api_signature_conflict",
      figmaFamilyKey: representative?.figmaFamilyKey ?? componentKey,
      figmaFamilyName: representative?.figmaFamilyName ?? componentKey,
      componentKey,
      message:
        `Resolved component '${componentKey}' produced multiple component-api contracts across matched Figma families; ` +
        "storybook-first mapping was excluded."
    });
  }

  issues.sort((left, right) => {
    const byFamilyName = left.figmaFamilyName.localeCompare(right.figmaFamilyName);
    if (byFamilyName !== 0) {
      return byFamilyName;
    }
    const byFamilyKey = left.figmaFamilyKey.localeCompare(right.figmaFamilyKey);
    if (byFamilyKey !== 0) {
      return byFamilyKey;
    }
    return left.code.localeCompare(right.code);
  });

  for (const issue of issues) {
    counts.byReason[issue.code] = counts.byReason[issue.code] + 1;
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  return {
    status: hasError ? "failed" : hasWarning ? "warn" : "ok",
    issueCount: issues.length,
    counts,
    issues
  };
};

export const validateGeneratedProjectStorybookStyles = async ({
  generatedProjectDir,
  customerProfile,
  isStorybookFirstRequested,
  storybookEvidenceArtifact,
  storybookTokensArtifact,
  storybookThemesArtifact,
  componentMatchReportArtifact
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
  isStorybookFirstRequested?: boolean;
  storybookEvidenceArtifact?: StorybookEvidenceArtifact;
  storybookTokensArtifact?: StorybookPublicTokensArtifact;
  storybookThemesArtifact?: StorybookPublicThemesArtifact;
  componentMatchReportArtifact?: ComponentMatchReportArtifact;
}): Promise<CustomerProfileStyleValidationSummary> => {
  const diagnostics = createEmptyStyleDiagnostics();
  if (!storybookEvidenceArtifact || !storybookTokensArtifact || !storybookThemesArtifact) {
    if (isStorybookFirstRequested) {
      if (!storybookEvidenceArtifact) {
        diagnostics.tokens.diagnostics.push({
          severity: "warning",
          code: "STORYBOOK_STYLE_ARTIFACT_MISSING",
          message: "Storybook evidence artifact is missing; style validation cannot run."
        });
        diagnostics.tokens.diagnosticCount += 1;
      }
      if (!storybookTokensArtifact) {
        diagnostics.tokens.diagnostics.push({
          severity: "warning",
          code: "STORYBOOK_STYLE_ARTIFACT_MISSING",
          message: "Storybook tokens artifact is missing; style validation cannot run."
        });
        diagnostics.tokens.diagnosticCount += 1;
      }
      if (!storybookThemesArtifact) {
        diagnostics.tokens.diagnostics.push({
          severity: "warning",
          code: "STORYBOOK_STYLE_ARTIFACT_MISSING",
          message: "Storybook themes artifact is missing; style validation cannot run."
        });
        diagnostics.tokens.diagnosticCount += 1;
      }
    }
    return {
      status: "not_available",
      policy: customerProfile.strictness.token,
      issueCount: 0,
      issues: [],
      diagnostics
    };
  }

  const issues: CustomerProfileStyleValidationIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const authoritativeStylingEvidence = storybookEvidenceArtifact.evidence.filter(
    (item) => item.reliability === "authoritative" && item.usage.canDriveStyling
  );
  const referenceOnlyEvidence = storybookEvidenceArtifact.evidence.filter(
    (item) => item.reliability === "reference_only" && REFERENCE_ONLY_STYLE_EVIDENCE_TYPES.has(item.type)
  );
  diagnostics.evidence = {
    authoritativeStylingEvidenceCount: authoritativeStylingEvidence.length,
    referenceOnlyStylingEvidenceCount: referenceOnlyEvidence.length,
    referenceOnlyEvidenceTypes: [...new Set(referenceOnlyEvidence.map((item) => item.type))].sort((left, right) =>
      left.localeCompare(right)
    )
  };
  if (!componentMatchReportArtifact) {
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: {
        category: "missing_component_match_report",
        severity: "error",
        message:
          "Storybook-first style validation requires component.match_report to enforce allowed customer component props.",
        artifact: "component.match_report"
      }
    });
  }

  if (authoritativeStylingEvidence.length === 0) {
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: {
        category: "missing_authoritative_styling_evidence",
        severity: "error",
        message:
          "Storybook-first style validation requires authoritative styling evidence from story args, argTypes, theme bundles, or CSS.",
        artifact: "storybook.evidence"
      }
    });
    if (referenceOnlyEvidence.length > 0) {
      pushStyleIssue({
        issues,
        seenIssueKeys,
        issue: {
          category: "reference_only_styling_evidence",
          severity: "error",
          message:
            "Reference-only Storybook evidence such as docs images or docs text cannot satisfy style authority requirements.",
          artifact: "storybook.evidence",
          evidenceTypes: diagnostics.evidence.referenceOnlyEvidenceTypes
        }
      });
    }
  }

  const tokenExtension = storybookTokensArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY];
  const themeExtension = storybookThemesArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY];
  diagnostics.tokens = {
    diagnosticCount: tokenExtension.diagnostics.length,
    errorCount: tokenExtension.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    diagnostics: tokenExtension.diagnostics.map((diagnostic) =>
      normalizeStyleDiagnosticEntry({
        diagnostic
      })
    )
  };
  diagnostics.themes = {
    diagnosticCount: themeExtension.diagnostics.length,
    errorCount: themeExtension.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    diagnostics: themeExtension.diagnostics.map((diagnostic) =>
      normalizeStyleDiagnosticEntry({
        diagnostic
      })
    )
  };

  for (const diagnostic of diagnostics.tokens.diagnostics) {
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: {
        category: "storybook_token_diagnostic",
        severity: diagnostic.severity,
        message: diagnostic.message,
        artifact: "storybook.tokens",
        diagnosticCode: diagnostic.code,
        ...(diagnostic.themeId ? { themeId: diagnostic.themeId } : {}),
        ...(diagnostic.tokenPath ? { tokenPath: diagnostic.tokenPath } : {})
      }
    });
  }
  for (const diagnostic of diagnostics.themes.diagnostics) {
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: {
        category: "storybook_theme_diagnostic",
        severity: diagnostic.severity,
        message: diagnostic.message,
        artifact: "storybook.themes",
        diagnosticCode: diagnostic.code,
        ...(diagnostic.themeId ? { themeId: diagnostic.themeId } : {}),
        ...(diagnostic.tokenPath ? { tokenPath: diagnostic.tokenPath } : {})
      }
    });
  }

  const sourceRoot = path.join(generatedProjectDir, "src");
  const sourceFiles = await collectSourceFiles({
    directoryPath: sourceRoot
  });
  const stylesheetFiles = await collectFiles({
    directoryPath: sourceRoot,
    extensions: GENERATED_STYLESHEET_EXTENSIONS
  });
  for (const stylesheetPath of stylesheetFiles) {
    const relativeFilePath = toRelativeGeneratedProjectPath({
      generatedProjectDir,
      filePath: stylesheetPath
    });
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: {
        category: "forbidden_generated_stylesheet",
        severity: "error",
        message: "Generated Storybook-first source must not emit .css or .scss stylesheets.",
        filePath: relativeFilePath
      }
    });
  }

  const customerComponents = componentMatchReportArtifact
    ? collectCustomerComponentContracts({
        artifact: componentMatchReportArtifact
      })
    : new Map<string, StyleValidationCustomerComponentContract>();
  if (componentMatchReportArtifact) {
    diagnostics.componentMatchReport = {
      resolvedCustomerComponentCount: customerComponents.size,
      validatedComponentNames: [...customerComponents.keys()].sort((left, right) => left.localeCompare(right))
    };
  }

  const sourceIssues = await Promise.all(
    sourceFiles
      .map((sourceFilePath) => ({
        sourceFilePath,
        relativeFilePath: toRelativeGeneratedProjectPath({
          generatedProjectDir,
          filePath: sourceFilePath
        })
      }))
      .filter(({ relativeFilePath }) => !isAuthorizedStorybookStyleOutput({ relativeFilePath }))
      .map(({ sourceFilePath }) =>
        scanGeneratedSourceFileForStyleIssues({
          generatedProjectDir,
          sourceFilePath,
          customerComponents
        })
      )
  );
  for (const sourceIssue of sourceIssues.flat()) {
    pushStyleIssue({
      issues,
      seenIssueKeys,
      issue: sourceIssue
    });
  }

  const sortedIssues = [...issues].sort((left, right) => {
    const byCategory = left.category.localeCompare(right.category);
    if (byCategory !== 0) {
      return byCategory;
    }
    const byFilePath = (left.filePath ?? "").localeCompare(right.filePath ?? "");
    if (byFilePath !== 0) {
      return byFilePath;
    }
    const byLine = (left.line ?? 0) - (right.line ?? 0);
    if (byLine !== 0) {
      return byLine;
    }
    return left.message.localeCompare(right.message);
  });

  return {
    status: toStyleValidationStatus({
      issueCount: sortedIssues.length,
      policy: customerProfile.strictness.token
    }),
    policy: customerProfile.strictness.token,
    issueCount: sortedIssues.length,
    issues: sortedIssues,
    diagnostics
  };
};

export const validateGeneratedProjectCustomerProfile = async ({
  generatedProjectDir,
  customerProfile
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
}): Promise<CustomerProfileValidationSummary> => {
  const issues: CustomerProfileValidationIssue[] = [];
  const packageJsonPath = path.join(generatedProjectDir, "package.json");
  const packageJson = await readJsonRecord({ filePath: packageJsonPath });

  issues.push(
    ...validateTemplateDependencies({
      packageJson,
      customerProfile
    })
  );

  issues.push(
    ...(await validateTemplateAliases({
      generatedProjectDir,
      customerProfile
    }))
  );

  const sourceRoot = path.join(generatedProjectDir, "src");
  const sourceFiles = await collectSourceFiles({
    directoryPath: sourceRoot
  });
  for (const sourceFile of sourceFiles) {
    const content = await readFile(sourceFile, "utf8");
    issues.push(
      ...collectCustomerProfileImportIssuesFromSource({
        content,
        filePath: path.relative(generatedProjectDir, sourceFile).split(path.sep).join("/"),
        profile: customerProfile
      })
    );
  }

  const status =
    issues.length === 0
      ? "ok"
      : customerProfile.strictness.import === "error"
        ? "failed"
        : customerProfile.strictness.import === "warn"
          ? "warn"
          : "ok";

  return {
    status,
    import: {
      policy: customerProfile.strictness.import,
      issueCount: issues.length,
      issues
    },
    match: {
      policy: customerProfile.strictness.match
    },
    token: {
      policy: customerProfile.strictness.token
    }
  };
};
