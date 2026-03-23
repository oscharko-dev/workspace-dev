// ---------------------------------------------------------------------------
// generator-forms.ts — Form detection, validation, and state management
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR, TextElementIR, GeneratedFile } from "./types.js";
import type { WorkspaceFormHandlingMode } from "../contracts/index.js";
import {
  firstVectorColor,
  toRgbaColor,
  isLikelyErrorRedColor,
  normalizeFontFamily,
  collectTextNodes,
  collectVectorPaths
} from "./generator-templates.js";
import {
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toStateKey,
  findFirstByName
} from "./generator-render.js";
import type {
  RenderContext,
  SemanticIconModel
} from "./generator-render.js";

export type ValidationFieldType =
  | "email"
  | "password"
  | "tel"
  | "number"
  | "date"
  | "url"
  | "search"
  | "iban"
  | "plz"
  | "credit_card";
export type ResolvedFormHandlingMode = WorkspaceFormHandlingMode;

export type CrossFieldRuleType = "match" | "date_after" | "numeric_gt";

export type RhfValidationMode = "onSubmit" | "onBlur" | "onTouched";

export interface CrossFieldRule {
  type: CrossFieldRuleType;
  sourceFieldKey: string;
  targetFieldKey: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Advanced validation rule DSL (issue #464)
// ---------------------------------------------------------------------------

export type ValidationRuleType = "min" | "max" | "minLength" | "maxLength" | "pattern";

export interface ValidationRule {
  type: ValidationRuleType;
  value: number | string;
  message: string;
}

export interface FormContextFileSpec {
  file: GeneratedFile;
  providerName: string;
  hookName: string;
  importPath: string;
}

type TextFieldInputType = "email" | "password" | "tel" | "number" | "date" | "url" | "search";

interface SemanticInputModel {
  labelNode?: ScreenElementIR | undefined;
  valueNode?: ScreenElementIR | undefined;
  placeholderNode?: ScreenElementIR | undefined;
  labelIcon?: SemanticIconModel | undefined;
  suffixText?: string | undefined;
  suffixIcon?: SemanticIconModel | undefined;
  isSelect: boolean;
}

export interface InteractiveFieldModel {
  key: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  isSelect: boolean;
  options: string[];
  inputType?: TextFieldInputType | undefined;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  validationType?: ValidationFieldType | undefined;
  validationMessage?: string | undefined;
  hasVisualErrorExample?: boolean | undefined;
  validationRules?: ValidationRule[] | undefined;
  suffixText?: string | undefined;
  labelFontFamily?: string | undefined;
  labelColor?: string | undefined;
  valueFontFamily?: string | undefined;
  valueColor?: string | undefined;
  formGroupId?: string | undefined;
}

const escapeRegExpToken = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface LocaleNumberFormatSpec {
  decimalSymbol: string;
  separatorSymbols: Set<string>;
  separatorPattern: RegExp;
}

const localeNumberFormatSpecCache = new Map<string, LocaleNumberFormatSpec>();

const isLikelyGroupingPattern = ({
  value,
  separator
}: {
  value: string;
  separator: string;
}): boolean => {
  if (separator.length !== 1) {
    return false;
  }
  const segments = value.split(separator);
  if (segments.length <= 1 || segments.some((segment) => segment.length === 0)) {
    return false;
  }
  const [first, ...rest] = segments;
  if (!first || first.length < 1 || first.length > 3) {
    return false;
  }
  return rest.every((segment) => segment.length === 3);
};

const getLocaleNumberFormatSpec = (locale: string): LocaleNumberFormatSpec => {
  const cached = localeNumberFormatSpecCache.get(locale);
  if (cached) {
    return cached;
  }

  const parts = new Intl.NumberFormat(locale).formatToParts(1_234_567.89);
  const decimalSymbol = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const separators = new Set<string>([".", ",", "'", "’", " ", "\u00A0", "\u202F", decimalSymbol]);
  for (const part of parts) {
    if (part.type === "group" && part.value.length > 0) {
      separators.add(part.value);
    }
  }
  const separatorPattern = new RegExp([...separators].map((symbol) => escapeRegExpToken(symbol)).join("|"), "g");
  const spec: LocaleNumberFormatSpec = {
    decimalSymbol,
    separatorSymbols: separators,
    separatorPattern
  };
  localeNumberFormatSpecCache.set(locale, spec);
  return spec;
};

const parseLocalizedNumber = (value: string, locale: string): number | undefined => {
  const { decimalSymbol, separatorPattern, separatorSymbols } = getLocaleNumberFormatSpec(locale);
  const compactRaw = value.replace(/[\s\u00A0\u202F]/g, "").replace(/[−﹣－]/g, "-");
  const compact = [...compactRaw]
    .filter((character) => /\d/.test(character) || character === "+" || character === "-" || separatorSymbols.has(character))
    .join("");
  if (!compact || !/\d/.test(compact)) {
    return undefined;
  }

  const sign = compact.startsWith("-") ? "-" : compact.startsWith("+") ? "+" : "";
  const unsigned = compact.slice(sign.length).replace(/[+-]/g, "");
  if (!/\d/.test(unsigned)) {
    return undefined;
  }

  let decimalIndex = -1;
  if (decimalSymbol.length === 1 && unsigned.includes(decimalSymbol)) {
    decimalIndex = unsigned.lastIndexOf(decimalSymbol);
  } else {
    const fallbackSeparators = [".", ","].filter((symbol) => symbol !== decimalSymbol && unsigned.includes(symbol));
    if (fallbackSeparators.length === 1) {
      const separator = fallbackSeparators[0];
      decimalIndex = separator
        ? isLikelyGroupingPattern({ value: unsigned, separator })
          ? -1
          : unsigned.lastIndexOf(separator)
        : -1;
    } else if (fallbackSeparators.length > 1) {
      decimalIndex = Math.max(...fallbackSeparators.map((symbol) => unsigned.lastIndexOf(symbol)));
    }
  }

  const normalized =
    decimalIndex >= 0
      ? (() => {
          const integerPart = unsigned.slice(0, decimalIndex).replace(separatorPattern, "");
          const fractionPart = unsigned.slice(decimalIndex + 1).replace(separatorPattern, "");
          if (integerPart.length === 0 && fractionPart.length === 0) {
            return "";
          }
          return `${sign}${integerPart.length > 0 ? integerPart : "0"}${fractionPart.length > 0 ? `.${fractionPart}` : ""}`;
        })()
      : (() => {
          const integerPart = unsigned.replace(separatorPattern, "");
          if (integerPart.length === 0) {
            return "";
          }
          return `${sign}${integerPart}`;
        })();

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatLocalizedNumber = (value: number, fractionDigits = 2, locale: string): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(safe);
};

export const deriveSelectOptions = (defaultValue: string, generationLocale: string): string[] => {
  const trimmed = defaultValue.trim();
  if (!trimmed) {
    return ["Option 1", "Option 2", "Option 3"];
  }

  if (/jahr/i.test(trimmed)) {
    const match = trimmed.match(/(\d+)/);
    const base = match ? Number(match[1]) : undefined;
    if (typeof base === "number" && Number.isFinite(base)) {
      return [...new Set([Math.max(1, base - 5), base, base + 5].map((value) => `${value} Jahre`))];
    }
  }

  if (trimmed.includes("%")) {
    const parsed = parseLocalizedNumber(trimmed, generationLocale);
    if (typeof parsed === "number") {
      const deltas = [-0.25, 0, 0.25];
      return [
        ...new Set(deltas.map((delta) => `${formatLocalizedNumber(Math.max(0, parsed + delta), 2, generationLocale)} %`))
      ];
    }
  }

  const parsed = parseLocalizedNumber(trimmed, generationLocale);
  if (typeof parsed === "number") {
    const deltas = [-0.1, 0, 0.1];
    return [
      ...new Set(
        deltas.map((delta) => {
          const value = parsed * (1 + delta);
          return formatLocalizedNumber(Math.max(0, value), 2, generationLocale);
        })
      )
    ];
  }

  return [trimmed, `${trimmed} A`, `${trimmed} B`];
};

const INPUT_NAME_HINTS = [
  "muiformcontrolroot",
  "muioutlinedinputroot",
  "muiinputbaseroot",
  "muiinputbaseinput",
  "muiinputroot",
  "muiselectselect",
  "textfield"
];
const TEXT_FIELD_TYPE_RULES: Array<{
  type: TextFieldInputType;
  patterns: RegExp[];
}> = [
  {
    type: "password",
    patterns: [/\bpassword\b/, /\bpasswort\b/, /\bkennwort\b/]
  },
  {
    type: "email",
    patterns: [/\be\s*mail\b/, /\bemail\b/, /\bmail\b/]
  },
  {
    type: "tel",
    patterns: [/\bphone\b/, /\btelefon\b/, /\btel\b/]
  },
  {
    type: "url",
    patterns: [/\burl\b/, /\bwebsite\b/, /\blink\b/]
  },
  {
    type: "number",
    patterns: [/\bnumber\b/, /\bamount\b/, /\bbetrag\b/, /\banzahl\b/]
  },
  {
    type: "date",
    patterns: [/\bdate\b/, /\bdatum\b/, /\bbirthday\b/, /\bgeburtstag\b/]
  },
  {
    type: "search",
    patterns: [/\bsearch\b/, /\bsuche\b/]
  }
];

const VALIDATION_ONLY_TYPE_RULES: Array<{
  type: ValidationFieldType;
  patterns: RegExp[];
  placeholderPatterns?: RegExp[];
}> = [
  {
    type: "iban",
    patterns: [/\biban\b/],
    placeholderPatterns: [/^[A-Z]{2}\d{2}\s/]
  },
  {
    type: "plz",
    patterns: [/\bplz\b/, /\bpostleitzahl\b/, /\bpostal\s*code\b/, /\bzip\s*code\b/, /\bzip\b/, /\bpostcode\b/]
  },
  {
    type: "credit_card",
    patterns: [
      /\bcredit\s*card\b/,
      /\bkreditkarte\b/,
      /\bcard\s*number\b/,
      /\bkartennummer\b/,
      /\bcc\s*number\b/
    ],
    placeholderPatterns: [/^\d{4}\s\d{4}\s\d{4}\s\d{4}$/]
  }
];

const INPUT_PLACEHOLDER_TECHNICAL_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);
const INPUT_PLACEHOLDER_GENERIC_PATTERNS = [
  /^(type|enter|your)(?:\s+text)?(?:\s+here)?$/i,
  /^(label|title|subtitle|heading)$/i,
  /^(xx(?:[./:-]xx)+)$/i,
  /^\$?\s*0(?:[.,]0{2})?$/i,
  /^\d{3}-\d{3}-\d{4}$/i,
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i,
  /^(john|jane)\s+doe$/i,
  /^[x•—–-]$/i
];


const hasAnySubtreeName = (element: ScreenElementIR, patterns: string[]): boolean => {
  return patterns.some((pattern) => hasSubtreeName(element, pattern));
};

const isValueLikeText = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /\d/.test(trimmed) || trimmed.includes("%") || trimmed.includes("€") || /jahr/i.test(trimmed);
};

const normalizeInputPlaceholderText = (value: string): string => {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
};

export const normalizeInputSemanticText = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_./:-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const collectInputSemanticHints = ({
  element,
  label,
  placeholder
}: {
  element: ScreenElementIR;
  label: string;
  placeholder: string | undefined;
}): string[] => {
  const uniqueHints = new Set<string>();
  const rawHints = [label, placeholder, ...collectSubtreeNames(element)];
  for (const value of rawHints) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeInputSemanticText(value);
    if (!normalized) {
      continue;
    }
    uniqueHints.add(normalized);
  }
  return Array.from(uniqueHints);
};

const inferTextFieldType = (hints: string[]): TextFieldInputType | undefined => {
  for (const rule of TEXT_FIELD_TYPE_RULES) {
    if (hints.some((hint) => rule.patterns.some((pattern) => pattern.test(hint)))) {
      return rule.type;
    }
  }
  return undefined;
};

const inferValidationOnlyType = ({
  hints,
  placeholder
}: {
  hints: string[];
  placeholder: string | undefined;
}): ValidationFieldType | undefined => {
  for (const rule of VALIDATION_ONLY_TYPE_RULES) {
    if (hints.some((hint) => rule.patterns.some((pattern) => pattern.test(hint)))) {
      return rule.type;
    }
    if (
      placeholder &&
      rule.placeholderPatterns &&
      rule.placeholderPatterns.some((pattern) => pattern.test(placeholder.trim()))
    ) {
      return rule.type;
    }
  }
  return undefined;
};

const inferTextFieldAutoComplete = (inputType: TextFieldInputType | undefined): string | undefined => {
  switch (inputType) {
    case "email":
      return "email";
    case "password":
      return "current-password";
    case "tel":
      return "tel";
    case "url":
      return "url";
    default:
      return undefined;
  }
};

export const inferRequiredFromLabel = (label: string): boolean => {
  return /(?:^|\s)\*(?:\s|$)|\*\s*$/.test(label);
};

export const sanitizeRequiredLabel = (label: string): string => {
  return label.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ").trim();
};

const inferTextFieldValidationMessage = (validationType: ValidationFieldType | undefined): string | undefined => {
  switch (validationType) {
    case "email":
      return "Please enter a valid email address.";
    case "password":
      return "Password must be at least 8 characters.";
    case "tel":
      return "Please enter a valid phone number.";
    case "url":
      return "Please enter a valid URL.";
    case "number":
      return "Please enter a valid number.";
    case "date":
      return "Please enter a valid date (YYYY-MM-DD).";
    case "iban":
      return "Please enter a valid IBAN.";
    case "plz":
      return "Please enter a valid postal code.";
    case "credit_card":
      return "Please enter a valid card number.";
    default:
      return undefined;
  }
};

export const inferVisualErrorFromOutline = (element: ScreenElementIR): boolean => {
  const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineColor = toRgbaColor(outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor ?? element.strokeColor);
  return isLikelyErrorRedColor(outlineColor);
};

const isLikelyInputPlaceholderText = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeInputPlaceholderText(value);
  if (!normalized) {
    return false;
  }
  if (INPUT_PLACEHOLDER_TECHNICAL_VALUES.has(normalized)) {
    return true;
  }
  return INPUT_PLACEHOLDER_GENERIC_PATTERNS.some((pattern) => pattern.test(normalized));
};

const splitTextRows = (texts: TextElementIR[]): { topRow: TextElementIR[]; bottomRow: TextElementIR[] } => {
  if (texts.length === 0) {
    return { topRow: [], bottomRow: [] };
  }
  if (texts.length === 1) {
    const single = texts[0];
    return single ? { topRow: [single], bottomRow: [] } : { topRow: [], bottomRow: [] };
  }
  const sortedByY = [...texts].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const first = sortedByY[0];
  const last = sortedByY[sortedByY.length - 1];
  if (!first || !last) {
    return { topRow: [], bottomRow: [] };
  }
  const minY = first.y ?? 0;
  const maxY = last.y ?? 0;
  const midpoint = (minY + maxY) / 2;
  const topRow = sortedByY.filter((node) => (node.y ?? 0) <= midpoint);
  const bottomRow = sortedByY.filter((node) => (node.y ?? 0) > midpoint);
  if (topRow.length > 0 && bottomRow.length > 0) {
    return { topRow, bottomRow };
  }
  return { topRow: sortedByY.slice(0, 1), bottomRow: sortedByY.slice(1) };
};

export const isLikelyInputContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }

  const hasDirectVisualContainer = Boolean(
    element.strokeColor || element.fillColor || element.fillGradient || (element.cornerRadius ?? 0) > 0
  );
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const sizeLooksLikeField = width >= 120 && height >= 36 && height <= 120;
  const hasInputSemantics = hasAnySubtreeName(element, INPUT_NAME_HINTS);

  const texts = collectTextNodes(element).filter((node) => node.text.trim().length > 0);
  const { topRow, bottomRow } = splitTextRows(texts);
  const hasLabelValuePattern =
    topRow.some((node) => !isValueLikeText(node.text)) && bottomRow.some((node) => isValueLikeText(node.text));

  if (hasInputSemantics && sizeLooksLikeField) {
    return true;
  }

  return hasDirectVisualContainer && sizeLooksLikeField && hasLabelValuePattern;
};

export const toFormContextProviderName = (screenComponentName: string): string => {
  return `${screenComponentName}FormContextProvider`;
};

export const toFormContextHookName = (screenComponentName: string): string => {
  return `use${screenComponentName}FormContext`;
};

export const registerInteractiveField = ({
  context,
  element,
  model
}: {
  context: RenderContext;
  element: ScreenElementIR;
  model: SemanticInputModel;
}): InteractiveFieldModel => {
  const key = toStateKey(element);
  const existing = context.fields.find((field) => field.key === key);
  if (existing) {
    return existing;
  }

  const rawLabel = model.labelNode?.text?.trim() ?? element.name;
  const required = inferRequiredFromLabel(rawLabel);
  const sanitizedLabel = required ? sanitizeRequiredLabel(rawLabel) : rawLabel;
  const label = sanitizedLabel.length > 0 ? sanitizedLabel : rawLabel;
  const placeholder = model.placeholderNode?.text?.trim();
  const defaultValue = model.valueNode?.text?.trim() ?? "";
  const isSelect = model.isSelect;
  const options = isSelect ? deriveSelectOptions(defaultValue, context.generationLocale) : [];
  const semanticHints = isSelect ? [] : collectInputSemanticHints({ element, label, placeholder });
  const inputType = isSelect ? undefined : inferTextFieldType(semanticHints);
  const autoComplete = isSelect ? undefined : inferTextFieldAutoComplete(inputType);
  const validationOnlyType = isSelect ? undefined : inferValidationOnlyType({ hints: semanticHints, placeholder });
  const validationType = isSelect ? undefined : (validationOnlyType ?? inputType);
  const validationMessage = inferTextFieldValidationMessage(validationType);
  const hasVisualErrorExample = inferVisualErrorFromOutline(element);

  const created: InteractiveFieldModel = {
    key,
    label,
    defaultValue,
    ...(placeholder && !isSelect ? { placeholder } : {}),
    isSelect,
    options,
    ...(inputType ? { inputType } : {}),
    ...(autoComplete ? { autoComplete } : {}),
    ...(required ? { required } : {}),
    ...(validationType ? { validationType } : {}),
    ...(validationMessage ? { validationMessage } : {}),
    ...(hasVisualErrorExample ? { hasVisualErrorExample } : {}),
    suffixText: isSelect ? undefined : model.suffixText,
    labelFontFamily: normalizeFontFamily(model.labelNode?.fontFamily),
    labelColor: model.labelNode?.fillColor,
    valueFontFamily: normalizeFontFamily(model.valueNode?.fontFamily),
    valueColor: model.valueNode?.fillColor,
    ...(context.currentFormGroupId ? { formGroupId: context.currentFormGroupId } : {})
  };
  context.fields.push(created);
  return created;
};

const subtreeContainsType = (element: ScreenElementIR, targetType: string): boolean => {
  if (element.type === targetType) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsType(child, targetType));
};

export interface FormGroupAssignment {
  groupId: string;
  childIndices: number[];
}

export const detectFormGroups = (simplifiedChildren: ScreenElementIR[]): FormGroupAssignment[] => {
  if (simplifiedChildren.length === 0) {
    return [];
  }

  const childSignals = simplifiedChildren.map((child) => ({
    hasInput: subtreeContainsType(child, "input"),
    hasButton: subtreeContainsType(child, "button")
  }));

  const totalInputChildren = childSignals.filter((signal) => signal.hasInput).length;
  const totalButtonChildren = childSignals.filter((signal) => signal.hasButton).length;

  if (totalInputChildren <= 1 || totalButtonChildren <= 1) {
    return [];
  }

  const groups: FormGroupAssignment[] = [];
  let currentGroup: { indices: number[]; hasInput: boolean; hasButton: boolean } | undefined;

  for (let index = 0; index < simplifiedChildren.length; index += 1) {
    const signal = childSignals[index];
    if (!signal) {
      continue;
    }
    const isFormRelated = signal.hasInput || signal.hasButton;

    if (!isFormRelated) {
      if (currentGroup && currentGroup.hasInput && !currentGroup.hasButton) {
        currentGroup.indices.push(index);
      } else if (currentGroup && currentGroup.hasInput && currentGroup.hasButton) {
        groups.push({
          groupId: `formGroup${groups.length}`,
          childIndices: currentGroup.indices
        });
        currentGroup = undefined;
      }
      continue;
    }

    if (!currentGroup) {
      currentGroup = { indices: [index], hasInput: signal.hasInput, hasButton: signal.hasButton };
      continue;
    }

    if (currentGroup.hasInput && currentGroup.hasButton && signal.hasInput) {
      groups.push({
        groupId: `formGroup${groups.length}`,
        childIndices: currentGroup.indices
      });
      currentGroup = { indices: [index], hasInput: signal.hasInput, hasButton: signal.hasButton };
      continue;
    }

    currentGroup.indices.push(index);
    currentGroup.hasInput = currentGroup.hasInput || signal.hasInput;
    currentGroup.hasButton = currentGroup.hasButton || signal.hasButton;
  }

  if (currentGroup && currentGroup.hasInput && currentGroup.hasButton) {
    groups.push({
      groupId: `formGroup${groups.length}`,
      childIndices: currentGroup.indices
    });
  }

  if (groups.length <= 1) {
    return [];
  }

  return groups;
};

export const buildSemanticInputModel = (element: ScreenElementIR): SemanticInputModel => {
  const texts = collectTextNodes(element).sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const iconNodes = collectIconNodes(element)
    .map((node) => ({
      node,
      paths: collectVectorPaths(node)
    }));
  const iconVectors = iconNodes.filter((candidate) => candidate.paths.length > 0);

  const isSuffixText = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed === "€" || trimmed === "%" || trimmed === "$";
  };
  const isPlaceholderNode = (node: ScreenElementIR): boolean => {
    if (node.textRole === "placeholder") {
      return true;
    }
    return isLikelyInputPlaceholderText(node.text);
  };

  const { topRow, bottomRow } = splitTextRows(texts);
  const placeholderNode =
    bottomRow.find((node) => isPlaceholderNode(node)) ?? texts.find((node) => isPlaceholderNode(node));
  const labelNode =
    topRow.find((node) => {
      const text = node.text.trim();
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    }) ??
    texts.find((node) => {
      const text = node.text.trim();
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    });

  const valueNode =
    bottomRow.find((node) => {
      const text = node.text.trim();
      return text.length > 0 && !isSuffixText(text) && !isPlaceholderNode(node);
    }) ??
    texts.find((node) => {
      const text = node.text.trim();
      return text.length > 0 && isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    });

  const labelIconNode =
    iconVectors.find((candidate) => {
      if (!labelNode) {
        return false;
      }
      const yDelta = Math.abs((candidate.node.y ?? 0) - (labelNode.y ?? 0));
      const isSmall = (candidate.node.width ?? 0) <= 16 && (candidate.node.height ?? 0) <= 16;
      const isOnLabelRow = yDelta <= 12;
      return isSmall && isOnLabelRow;
    }) ?? undefined;

  const rightBoundary = (element.x ?? 0) + (element.width ?? 0) * 0.62;
  const suffixTextNode = texts.find((node) => {
    const text = node.text.trim();
    return text.length > 0 && isSuffixText(text) && (node.x ?? 0) >= rightBoundary;
  });

  const suffixIconCandidate =
    iconNodes.find((candidate) => {
      const isRightSide = (candidate.node.x ?? 0) >= rightBoundary;
      const isNotLabelIcon = candidate.node.id !== labelIconNode?.node.id;
      return isRightSide && isNotLabelIcon;
    }) ?? undefined;

  const hasAdornment = hasSubtreeName(element, "inputadornmentroot");
  const isSelect = hasSubtreeName(element, "muiselectselect") || Boolean(suffixIconCandidate && !suffixTextNode);
  const suffixText = suffixTextNode ? suffixTextNode.text.trim() : hasAdornment && !suffixIconCandidate ? "€" : undefined;
  const suffixIconNode = suffixIconCandidate && suffixIconCandidate.paths.length > 0 ? suffixIconCandidate : undefined;

  return {
    labelNode,
    valueNode,
    placeholderNode,
    labelIcon: labelIconNode
      ? {
          paths: labelIconNode.paths,
          color: firstVectorColor(labelIconNode.node),
          width: labelIconNode.node.width,
          height: labelIconNode.node.height
        }
      : undefined,
    suffixText,
    suffixIcon: suffixIconNode
      ? {
          paths: suffixIconNode.paths,
          color: firstVectorColor(suffixIconNode.node),
          width: suffixIconNode.node.width,
          height: suffixIconNode.node.height
        }
      : undefined,
    isSelect
  };
};

// ---------------------------------------------------------------------------
// Cross-field validation rule detection
// ---------------------------------------------------------------------------

const MATCH_CONFIRM_PATTERNS = [
  /\bconfirm\b/,
  /\bbestätigen\b/,
  /\bbestaetigen\b/,
  /\brepeat\b/,
  /\bwiederholen\b/,
  /\bretype\b/,
  /\bre-enter\b/,
  /\bverify\b/
];

const DATE_START_PATTERNS = [/\bstart\b/, /\bvon\b/, /\bfrom\b/, /\bbegin\b/, /\bab\b/];
const DATE_END_PATTERNS = [/\bend\b/, /\bbis\b/, /\bto\b/, /\buntil\b/];

const NUMERIC_MIN_PATTERNS = [/\bmin\b/, /\bminimum\b/, /\bmindest\b/];
const NUMERIC_MAX_PATTERNS = [/\bmax\b/, /\bmaximum\b/, /\bhöchst\b/, /\bhoechst\b/];

const matchesAny = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

const stripConfirmPrefix = (value: string): string =>
  value
    .replace(/\b(confirm|bestätigen|bestaetigen|repeat|wiederholen|retype|re-enter|verify)\b/gi, "")
    .replace(/[_\s-]+/g, " ")
    .trim()
    .toLowerCase();

export const detectCrossFieldRules = (fields: InteractiveFieldModel[]): CrossFieldRule[] => {
  const rules: CrossFieldRule[] = [];
  const nonSelectFields = fields.filter((field) => !field.isSelect);

  // --- match rules (e.g. password / confirm password) ---
  for (const field of nonSelectFields) {
    const normalizedLabel = normalizeInputSemanticText(field.label);
    const normalizedKey = normalizeInputSemanticText(field.key);
    const hints = [normalizedLabel, normalizedKey];

    if (!matchesAny(hints.join(" "), MATCH_CONFIRM_PATTERNS)) {
      continue;
    }

    const baseLabel = stripConfirmPrefix(normalizedLabel);
    const baseKey = stripConfirmPrefix(normalizedKey);

    const sourceField = nonSelectFields.find((candidate) => {
      if (candidate.key === field.key) {
        return false;
      }
      const candidateLabel = normalizeInputSemanticText(candidate.label).toLowerCase();
      const candidateKey = normalizeInputSemanticText(candidate.key).toLowerCase();
      return (
        (baseLabel.length > 0 && candidateLabel === baseLabel) ||
        (baseKey.length > 0 && candidateKey === baseKey) ||
        (candidate.validationType !== undefined &&
          candidate.validationType === field.validationType &&
          candidate.validationType === "password")
      );
    });

    if (sourceField) {
      const sourceLabel = sourceField.label || sourceField.key;
      rules.push({
        type: "match",
        sourceFieldKey: sourceField.key,
        targetFieldKey: field.key,
        message: `Must match ${sourceLabel}.`
      });
    }
  }

  // --- date_after rules (e.g. start date / end date) ---
  const dateFields = nonSelectFields.filter((field) => field.validationType === "date");
  if (dateFields.length >= 2) {
    const startFields = dateFields.filter((field) => {
      const hints = normalizeInputSemanticText(`${field.label} ${field.key}`);
      return matchesAny(hints, DATE_START_PATTERNS);
    });
    const endFields = dateFields.filter((field) => {
      const hints = normalizeInputSemanticText(`${field.label} ${field.key}`);
      return matchesAny(hints, DATE_END_PATTERNS);
    });

    for (const startField of startFields) {
      for (const endField of endFields) {
        if (startField.key === endField.key) {
          continue;
        }
        rules.push({
          type: "date_after",
          sourceFieldKey: startField.key,
          targetFieldKey: endField.key,
          message: `Must be after ${startField.label || startField.key}.`
        });
      }
    }
  }

  // --- numeric_gt rules (e.g. min amount / max amount) ---
  const numberFields = nonSelectFields.filter((field) => field.validationType === "number");
  if (numberFields.length >= 2) {
    const minFields = numberFields.filter((field) => {
      const hints = normalizeInputSemanticText(`${field.label} ${field.key}`);
      return matchesAny(hints, NUMERIC_MIN_PATTERNS);
    });
    const maxFields = numberFields.filter((field) => {
      const hints = normalizeInputSemanticText(`${field.label} ${field.key}`);
      return matchesAny(hints, NUMERIC_MAX_PATTERNS);
    });

    for (const minField of minFields) {
      for (const maxField of maxFields) {
        if (minField.key === maxField.key) {
          continue;
        }
        rules.push({
          type: "numeric_gt",
          sourceFieldKey: minField.key,
          targetFieldKey: maxField.key,
          message: `Must be greater than ${minField.label || minField.key}.`
        });
      }
    }
  }

  return rules;
};

// ---------------------------------------------------------------------------
// Validation mode inference
// ---------------------------------------------------------------------------

const LONG_FORM_FIELD_THRESHOLD = 5;

export const inferValidationMode = ({
  fields,
  hasVisualErrors
}: {
  fields: readonly InteractiveFieldModel[];
  hasVisualErrors: boolean;
}): RhfValidationMode => {
  if (hasVisualErrors) {
    return "onTouched";
  }
  const nonSelectFieldCount = fields.filter((field) => !field.isSelect).length;
  if (nonSelectFieldCount >= LONG_FORM_FIELD_THRESHOLD) {
    return "onBlur";
  }
  return "onSubmit";
};
