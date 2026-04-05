// ---------------------------------------------------------------------------
// form-template.ts — Form state blocks and context file generation
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import path from "node:path";
import { ensureTsxName } from "../path-utils.js";
import {
  toFormContextProviderName,
  toFormContextHookName
} from "../generator-core.js";
import type {
  ValidationFieldType,
  ValidationRule,
  FormContextFileSpec,
  CrossFieldRule,
  RhfValidationMode
} from "../generator-core.js";
import { literal } from "./utility-functions.js";

export const buildInlineLegacyFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  initialVisualErrorsOverrideExpression,
  validationMessagesOverrideExpression,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues,
  validationRulesMap = {}
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  initialVisualErrorsOverrideExpression?: string;
  validationMessagesOverrideExpression?: string;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
  validationRulesMap?: Record<string, ValidationRule[]>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  const validationRulesDeclaration = Object.keys(validationRulesMap).length > 0
    ? `\nconst fieldValidationRules: Record<string, Array<{ type: string; value: number | string; message: string }>> = ${JSON.stringify(validationRulesMap, null, 2)};\n`
    : `\nconst fieldValidationRules: Record<string, Array<{ type: string; value: number | string; message: string }>> = {};\n`;
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const resolvedInitialVisualErrors: Record<string, string> = ${initialVisualErrorsOverrideExpression ? `{ ...initialVisualErrors, ...(${initialVisualErrorsOverrideExpression} ?? {}) }` : "initialVisualErrors"};
const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
const defaultValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
const fieldValidationMessages: Record<string, string> = ${
  validationMessagesOverrideExpression
    ? `{ ...defaultValidationMessages, ...(${validationMessagesOverrideExpression} ?? {}) }`
    : "defaultValidationMessages"
};${validationRulesDeclaration}

const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(resolvedInitialVisualErrors);
const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

const parseLocalizedNumber = (rawValue: string): number | undefined => {
  const compact = rawValue.replace(/\\s+/g, "");
  if (!compact) {
    return undefined;
  }
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);
  let normalized = compact;
  if (decimalIndex >= 0) {
    const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fractionPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const validateFieldValue = (fieldKey: string, value: string): string => {
  const trimmed = value.trim();
  if (requiredFields[fieldKey] && trimmed.length === 0) {
    return "This field is required.";
  }
  if (trimmed.length === 0) {
    return "";
  }

  const validationType = fieldValidationTypes[fieldKey];
  const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";
  if (validationType) {
    switch (validationType) {
      case "email":
        if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
          return validationMessage;
        }
        break;
      case "password":
        if (trimmed.length < 8) {
          return validationMessage;
        }
        break;
      case "tel": {
        const compactTel = trimmed.replace(/\\s+/g, "");
        const digitCount = (compactTel.match(/\\d/g) ?? []).length;
        if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
          return validationMessage;
        }
        break;
      }
      case "url": {
        try {
          const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
          const parsed = new URL(normalizedUrl);
          if (!(parsed.hostname && parsed.hostname.includes("."))) {
            return validationMessage;
          }
        } catch {
          return validationMessage;
        }
        break;
      }
      case "number":
        if (parseLocalizedNumber(trimmed) === undefined) {
          return validationMessage;
        }
        break;
      case "date": {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
          return validationMessage;
        }
        const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
        if (![year, month, day].every((segment) => Number.isFinite(segment))) {
          return validationMessage;
        }
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
          date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
        if (!isValidDate) {
          return validationMessage;
        }
        break;
      }
      case "iban": {
        const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
        if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
          return validationMessage;
        }
        const rearranged = compact.slice(4) + compact.slice(0, 4);
        const numericStr = Array.from(rearranged).map((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 65 && code <= 90 ? String(code - 55) : ch;
        }).join("");
        let remainder = "";
        for (const digit of numericStr) {
          remainder = String(Number(remainder + digit) % 97);
        }
        if (Number(remainder) !== 1) {
          return validationMessage;
        }
        break;
      }
      case "plz": {
        const compact = trimmed.replace(/\\s+/g, "");
        if (!/^\\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)) {
          return validationMessage;
        }
        break;
      }
      case "credit_card": {
        const digits = trimmed.replace(/[\\s-]+/g, "");
        if (!/^\\d{13,19}$/.test(digits)) {
          return validationMessage;
        }
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i--) {
          let digit = Number(digits[i]);
          if (shouldDouble) {
            digit *= 2;
            if (digit > 9) {
              digit -= 9;
            }
          }
          sum += digit;
          shouldDouble = !shouldDouble;
        }
        if (sum % 10 !== 0) {
          return validationMessage;
        }
        break;
      }
      default:
        break;
    }
  }

  // Advanced validation rules (min, max, minLength, maxLength, pattern)
  const rules = fieldValidationRules[fieldKey];
  if (rules && rules.length > 0) {
    for (const rule of rules) {
      switch (rule.type) {
        case "minLength":
          if (typeof rule.value === "number" && trimmed.length < rule.value) {
            return rule.message;
          }
          break;
        case "maxLength":
          if (typeof rule.value === "number" && trimmed.length > rule.value) {
            return rule.message;
          }
          break;
        case "min": {
          const parsed = parseLocalizedNumber(trimmed);
          if (typeof rule.value === "number" && parsed !== undefined && parsed < rule.value) {
            return rule.message;
          }
          break;
        }
        case "max": {
          const parsed = parseLocalizedNumber(trimmed);
          if (typeof rule.value === "number" && parsed !== undefined && parsed > rule.value) {
            return rule.message;
          }
          break;
        }
        case "pattern":
          if (typeof rule.value === "string") {
            try {
              const regex = new RegExp(rule.value);
              if (!regex.test(trimmed)) {
                return rule.message;
              }
            } catch {
              // Invalid regex — skip rule at runtime.
            }
          }
          break;
      }
    }
  }
  return "";
};

const validateForm = (values: Record<string, string>): Record<string, string> => {
  const fieldKeys = new Set<string>([...Object.keys(values), ...Object.keys(requiredFields)]);
  return [...fieldKeys].reduce<Record<string, string>>((nextErrors, fieldKey) => {
    nextErrors[fieldKey] = validateFieldValue(fieldKey, values[fieldKey] ?? "");
    return nextErrors;
  }, {});
};

const updateFieldValue = (fieldKey: string, value: string): void => {
  setFormValues((previous) => ({ ...previous, [fieldKey]: value }));
  if (!touchedFields[fieldKey]) {
    return;
  }
  const nextError = validateFieldValue(fieldKey, value);
  setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
};

const handleFieldBlur = (fieldKey: string): void => {
  setTouchedFields((previous) => ({ ...previous, [fieldKey]: true }));
  const nextError = validateFieldValue(fieldKey, formValues[fieldKey] ?? "");
  setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
};

const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
  event.preventDefault();
  const nextErrors = validateForm(formValues);
  setFieldErrors(nextErrors);
  setTouchedFields((previous) =>
    Object.keys(formValues).reduce<Record<string, boolean>>((nextTouched, fieldKey) => {
      nextTouched[fieldKey] = true;
      return nextTouched;
    }, { ...previous })
  );

  const hasErrors = Object.values(nextErrors).some((message) => message.length > 0);
  if (hasErrors) {
    return;
  }
};`;
};

export const buildLegacyFormContextFile = ({
  screenComponentName,
  initialValues,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialVisualErrorsMap,
  selectOptionsMap
}: {
  screenComponentName: string;
  initialValues: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialVisualErrorsMap: Record<string, string>;
  selectOptionsMap: Record<string, string[]>;
}): FormContextFileSpec => {
  const providerName = toFormContextProviderName(screenComponentName);
  const hookName = toFormContextHookName(screenComponentName);
  const contextVarName = `${screenComponentName}FormContext`;
  const contextValueTypeName = `${screenComponentName}FormContextValue`;
  const providerPropsTypeName = `${providerName}Props`;
  const contextSource = `/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";

export interface ${contextValueTypeName} {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  formValues: Record<string, string>;
  fieldErrors: Record<string, string>;
  touchedFields: Record<string, boolean>;
  updateFieldValue: (fieldKey: string, value: string) => void;
  handleFieldBlur: (fieldKey: string) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const ${contextVarName} = createContext<${contextValueTypeName} | undefined>(undefined);

export interface ${providerPropsTypeName} {
  children: ReactNode;
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
}

export function ${providerName}({ children, initialVisualErrorsOverride, validationMessagesOverride }: ${providerPropsTypeName}) {
  const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
  const resolvedInitialVisualErrors: Record<string, string> = { ...initialVisualErrors, ...(initialVisualErrorsOverride ?? {}) };
  const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
  const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
  const defaultValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
  const fieldValidationMessages: Record<string, string> = { ...defaultValidationMessages, ...(validationMessagesOverride ?? {}) };
  const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};
  const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(resolvedInitialVisualErrors);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

  const parseLocalizedNumber = (rawValue: string): number | undefined => {
    const compact = rawValue.replace(/\\s+/g, "");
    if (!compact) {
      return undefined;
    }
    const lastDot = compact.lastIndexOf(".");
    const lastComma = compact.lastIndexOf(",");
    const decimalIndex = Math.max(lastDot, lastComma);
    let normalized = compact;
    if (decimalIndex >= 0) {
      const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
      const fractionPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
      normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
    } else {
      normalized = compact.replace(/[.,]/g, "");
    }
    if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const validateFieldValue = (fieldKey: string, value: string): string => {
    const trimmed = value.trim();
    if (requiredFields[fieldKey] && trimmed.length === 0) {
      return "This field is required.";
    }
    if (trimmed.length === 0) {
      return "";
    }

    const validationType = fieldValidationTypes[fieldKey];
    if (!validationType) {
      return "";
    }
    const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

    switch (validationType) {
      case "email":
        return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed) ? "" : validationMessage;
      case "password":
        return trimmed.length >= 8 ? "" : validationMessage;
      case "tel": {
        const compactTel = trimmed.replace(/\\s+/g, "");
        const digitCount = (compactTel.match(/\\d/g) ?? []).length;
        return /^\\+?[0-9().-]{6,24}$/.test(compactTel) && digitCount >= 6 ? "" : validationMessage;
      }
      case "url": {
        try {
          const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
          const parsed = new URL(normalizedUrl);
          return parsed.hostname && parsed.hostname.includes(".") ? "" : validationMessage;
        } catch {
          return validationMessage;
        }
      }
      case "number":
        return parseLocalizedNumber(trimmed) !== undefined ? "" : validationMessage;
      case "date": {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
          return validationMessage;
        }
        const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
        if (![year, month, day].every((segment) => Number.isFinite(segment))) {
          return validationMessage;
        }
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
          date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
        return isValidDate ? "" : validationMessage;
      }
      case "iban": {
        const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
        if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
          return validationMessage;
        }
        const rearranged = compact.slice(4) + compact.slice(0, 4);
        const numericStr = Array.from(rearranged).map((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 65 && code <= 90 ? String(code - 55) : ch;
        }).join("");
        let remainder = "";
        for (const digit of numericStr) {
          remainder = String(Number(remainder + digit) % 97);
        }
        return Number(remainder) === 1 ? "" : validationMessage;
      }
      case "plz": {
        const compact = trimmed.replace(/\\s+/g, "");
        return /^\\d{4,10}$/.test(compact) || /^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)
          ? ""
          : validationMessage;
      }
      case "credit_card": {
        const digits = trimmed.replace(/[\\s-]+/g, "");
        if (!/^\\d{13,19}$/.test(digits)) {
          return validationMessage;
        }
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i--) {
          let digit = Number(digits[i]);
          if (shouldDouble) {
            digit *= 2;
            if (digit > 9) {
              digit -= 9;
            }
          }
          sum += digit;
          shouldDouble = !shouldDouble;
        }
        return sum % 10 === 0 ? "" : validationMessage;
      }
      default:
        return "";
    }
  };

  const validateForm = (values: Record<string, string>): Record<string, string> => {
    const fieldKeys = new Set<string>([...Object.keys(values), ...Object.keys(requiredFields)]);
    return [...fieldKeys].reduce<Record<string, string>>((nextErrors, fieldKey) => {
      nextErrors[fieldKey] = validateFieldValue(fieldKey, values[fieldKey] ?? "");
      return nextErrors;
    }, {});
  };

  const updateFieldValue = (fieldKey: string, value: string): void => {
    setFormValues((previous) => ({ ...previous, [fieldKey]: value }));
    if (!touchedFields[fieldKey]) {
      return;
    }
    const nextError = validateFieldValue(fieldKey, value);
    setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
  };

  const handleFieldBlur = (fieldKey: string): void => {
    setTouchedFields((previous) => ({ ...previous, [fieldKey]: true }));
    const nextError = validateFieldValue(fieldKey, formValues[fieldKey] ?? "");
    setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = validateForm(formValues);
    setFieldErrors(nextErrors);
    setTouchedFields((previous) =>
      Object.keys(formValues).reduce<Record<string, boolean>>((nextTouched, fieldKey) => {
        nextTouched[fieldKey] = true;
        return nextTouched;
      }, { ...previous })
    );

    const hasErrors = Object.values(nextErrors).some((message) => message.length > 0);
    if (hasErrors) {
      return;
    }
  };

  return (
    <${contextVarName}.Provider
      value={{
        initialVisualErrors: resolvedInitialVisualErrors,
        selectOptions,
        formValues,
        fieldErrors,
        touchedFields,
        updateFieldValue,
        handleFieldBlur,
        handleSubmit
      }}
    >
      {children}
    </${contextVarName}.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${contextValueTypeName} => {
  const context = useContext(${contextVarName});
  if (!context) {
    throw new Error("${hookName} must be used within ${providerName}");
  }
  return context;
};
`;
  return {
    file: {
      path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}FormContext`)),
      content: contextSource
    },
    providerName,
    hookName,
    importPath: `../context/${screenComponentName}FormContext`
  };
};

export const toReactHookFormSchemaEntries = ({
  initialValues,
  indent
}: {
  initialValues: Record<string, string>;
  indent: string;
}): string => {
  const fieldKeys = Object.keys(initialValues).sort((left, right) => left.localeCompare(right));
  return fieldKeys
    .map(
      (fieldKey) =>
        `${indent}${literal(fieldKey)}: createFieldSchema({ spec: fieldSchemaSpecs[${literal(fieldKey)}] })`
    )
    .join(",\n");
};

const toReactHookFormFieldSchemaSpecsLiteral = ({
  initialValues,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  selectOptionsMap,
  validationRulesMap = {}
}: {
  initialValues: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  selectOptionsMap: Record<string, string[]>;
  validationRulesMap?: Record<string, ValidationRule[]>;
}): string => {
  const fieldKeys = Object.keys(initialValues).sort((left, right) => left.localeCompare(right));
  const specs: Record<
    string,
    {
      required: boolean;
      validationType?: ValidationFieldType;
      validationMessage: string;
      selectOptions: string[];
      selectValidationMessage: string;
      validationRules?: ValidationRule[];
    }
  > = {};
  for (const fieldKey of fieldKeys) {
    const validationType = validationTypeMap[fieldKey];
    const rules = validationRulesMap[fieldKey];
    specs[fieldKey] = {
      required: requiredFieldMap[fieldKey] ?? false,
      ...(validationType ? { validationType } : {}),
      validationMessage: validationMessageMap[fieldKey] ?? "Invalid value.",
      selectOptions: selectOptionsMap[fieldKey] ?? [],
      selectValidationMessage: validationMessageMap[fieldKey] ?? "Please select a valid option.",
      ...(rules && rules.length > 0 ? { validationRules: rules } : {})
    };
  }
  return JSON.stringify(specs, null, 2);
};

export const toCrossFieldRefineChain = ({
  rules,
  indent
}: {
  rules: readonly CrossFieldRule[];
  indent: string;
}): string => {
  if (rules.length === 0) {
    return "";
  }
  return rules
    .map((rule) => {
      switch (rule.type) {
        case "match":
          return `\n${indent}.refine(\n${indent}  (data) => data[${literal(rule.sourceFieldKey)}].trim().length === 0 || data[${literal(rule.targetFieldKey)}].trim().length === 0 || data[${literal(rule.sourceFieldKey)}] === data[${literal(rule.targetFieldKey)}],\n${indent}  { message: ${literal(rule.message)}, path: [${literal(rule.targetFieldKey)}] }\n${indent})`;
        case "date_after":
          return `\n${indent}.refine(\n${indent}  (data) => {\n${indent}    const toComparableDateString = (value: unknown): string | undefined => {\n${indent}      if (typeof value === "string") {\n${indent}        const trimmed = value.trim();\n${indent}        if (trimmed.length === 0) return undefined;\n${indent}        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return undefined;\n${indent}        return trimmed;\n${indent}      }\n${indent}      if (value instanceof Date) {\n${indent}        if (!Number.isFinite(value.getTime())) return undefined;\n${indent}        const year = value.getUTCFullYear();\n${indent}        const month = String(value.getUTCMonth() + 1).padStart(2, "0");\n${indent}        const day = String(value.getUTCDate()).padStart(2, "0");\n${indent}        return year + "-" + month + "-" + day;\n${indent}      }\n${indent}      return undefined;\n${indent}    };\n${indent}    const startDate = toComparableDateString(data[${literal(rule.sourceFieldKey)}]);\n${indent}    const endDate = toComparableDateString(data[${literal(rule.targetFieldKey)}]);\n${indent}    if (startDate === undefined || endDate === undefined) return true;\n${indent}    return endDate > startDate;\n${indent}  },\n${indent}  { message: ${literal(rule.message)}, path: [${literal(rule.targetFieldKey)}] }\n${indent})`;
        case "numeric_gt":
          return `\n${indent}.refine(\n${indent}  (data) => {\n${indent}    const toComparableNumber = (value: unknown): number | undefined => {\n${indent}      if (typeof value === "number") {\n${indent}        return Number.isFinite(value) ? value : undefined;\n${indent}      }\n${indent}      if (typeof value === "string") {\n${indent}        return parseLocalizedNumber(value.trim());\n${indent}      }\n${indent}      return undefined;\n${indent}    };\n${indent}    const minVal = toComparableNumber(data[${literal(rule.sourceFieldKey)}]);\n${indent}    const maxVal = toComparableNumber(data[${literal(rule.targetFieldKey)}]);\n${indent}    if (minVal === undefined || maxVal === undefined) return true;\n${indent}    return maxVal > minVal;\n${indent}  },\n${indent}  { message: ${literal(rule.message)}, path: [${literal(rule.targetFieldKey)}] }\n${indent})`;
        default:
          return "";
      }
    })
    .join("");
};

export const buildInlineReactHookFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  initialVisualErrorsOverrideExpression,
  validationMessagesOverrideExpression,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues,
  crossFieldRules = [],
  validationMode = "onSubmit",
  validationRulesMap = {}
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  initialVisualErrorsOverrideExpression?: string;
  validationMessagesOverrideExpression?: string;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
  crossFieldRules?: readonly CrossFieldRule[];
  validationMode?: RhfValidationMode;
  validationRulesMap?: Record<string, ValidationRule[]>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  const refineChain = toCrossFieldRefineChain({ rules: crossFieldRules, indent: "" });
  const useFormModeLine = validationMode !== "onSubmit" ? `\n  mode: ${literal(validationMode)},` : "";
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "  "
  });
  const fieldSchemaSpecsLiteral = toReactHookFormFieldSchemaSpecsLiteral({
    initialValues,
    requiredFieldMap,
    validationTypeMap,
    validationMessageMap,
    selectOptionsMap,
    validationRulesMap
  });
  const selectMembershipValidationBlock = hasSelectField
    ? `    const selectFieldOptions = spec.selectOptions;
    if (selectFieldOptions.length > 0 && !selectFieldOptions.includes(rawValue)) {
      const selectValidationMessage = spec.selectValidationMessage;
      issueContext.addIssue({ code: "custom", message: selectValidationMessage });
      return;
    }

`
    : "";
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const resolvedInitialVisualErrors: Record<string, string> = ${initialVisualErrorsOverrideExpression ? `{ ...initialVisualErrors, ...(${initialVisualErrorsOverrideExpression} ?? {}) }` : "initialVisualErrors"};
const defaultValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
const resolvedValidationMessages: Record<string, string> = ${
  validationMessagesOverrideExpression
    ? `{ ...defaultValidationMessages, ...(${validationMessagesOverrideExpression} ?? {}) }`
    : "defaultValidationMessages"
};
const fieldSchemaSpecs = ${fieldSchemaSpecsLiteral} as const;

const parseLocalizedNumber = (rawValue: string): number | undefined => {
  const compact = rawValue.replace(/\\s+/g, "");
  if (!compact) {
    return undefined;
  }
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);
  let normalized = compact;
  if (decimalIndex >= 0) {
    const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fractionPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type FieldValidationType =
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

type ValidationRuleSpec =
  | { type: "min" | "max" | "minLength" | "maxLength"; value: number; message: string }
  | { type: "pattern"; value: string; message: string };

type FieldSchemaSpec = {
  required: boolean;
  validationType?: FieldValidationType;
  validationMessage: string;
  selectOptions: readonly string[];
  selectValidationMessage: string;
  validationRules?: readonly ValidationRuleSpec[];
};

type FieldSchemaOutput<TSpec extends FieldSchemaSpec> = TSpec["validationType"] extends "number" ? number | undefined : string;

const createFieldSchema = <TSpec extends FieldSchemaSpec>({ spec }: { spec: TSpec }) => {
  return z.string().superRefine((rawValue, issueContext) => {
    const trimmed = rawValue.trim();
    if (spec.required && trimmed.length === 0) {
      issueContext.addIssue({ code: "custom", message: "This field is required." });
      return;
    }
    if (trimmed.length === 0) {
      return;
    }

${selectMembershipValidationBlock}    const validationType = spec.validationType;
    const validationMessage = spec.validationMessage;
    if (validationType) {
      switch (validationType) {
        case "email":
          if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "password":
          if (trimmed.length < 8) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "tel": {
          const compactTel = trimmed.replace(/\\s+/g, "");
          const digitCount = (compactTel.match(/\\d/g) ?? []).length;
          if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "url": {
          try {
            const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
            const parsed = new URL(normalizedUrl);
            if (!(parsed.hostname && parsed.hostname.includes("."))) {
              issueContext.addIssue({ code: "custom", message: validationMessage });
            }
          } catch {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "number":
          if (parseLocalizedNumber(trimmed) === undefined) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "date": {
          if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
          if (![year, month, day].every((segment) => Number.isFinite(segment))) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const date = new Date(Date.UTC(year, month - 1, day));
          const isValidDate =
            date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
          if (!isValidDate) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "iban": {
          const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
          if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const rearranged = compact.slice(4) + compact.slice(0, 4);
          const numericStr = Array.from(rearranged).map((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 65 && code <= 90 ? String(code - 55) : ch;
          }).join("");
          let remainder = "";
          for (const digit of numericStr) {
            remainder = String(Number(remainder + digit) % 97);
          }
          if (Number(remainder) !== 1) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "plz": {
          const compact = trimmed.replace(/\\s+/g, "");
          if (!/^\\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "credit_card": {
          const digits = trimmed.replace(/[\\s-]+/g, "");
          if (!/^\\d{13,19}$/.test(digits)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          let sum = 0;
          let shouldDouble = false;
          for (let i = digits.length - 1; i >= 0; i--) {
            let digit = Number(digits[i]);
            if (shouldDouble) {
              digit *= 2;
              if (digit > 9) {
                digit -= 9;
              }
            }
            sum += digit;
            shouldDouble = !shouldDouble;
          }
          if (sum % 10 !== 0) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        default:
          break;
      }
    }

    // Advanced validation rules (min, max, minLength, maxLength, pattern)
    const rules = spec.validationRules ?? [];
    if (rules.length > 0) {
      for (const rule of rules) {
        switch (rule.type) {
          case "minLength": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const minLength: number = rawRuleValue;
            if (trimmed.length < minLength) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "maxLength": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const maxLength: number = rawRuleValue;
            if (trimmed.length > maxLength) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "min": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const parsed = parseLocalizedNumber(trimmed);
            if (parsed === undefined) {
              break;
            }
            const minValue: number = rawRuleValue;
            if (parsed < minValue) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "max": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const parsed = parseLocalizedNumber(trimmed);
            if (parsed === undefined) {
              break;
            }
            const maxValue: number = rawRuleValue;
            if (parsed > maxValue) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "pattern": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "string") {
              break;
            }
            const pattern: string = rawRuleValue;
            try {
              const regex = new RegExp(pattern);
              if (!regex.test(trimmed)) {
                issueContext.addIssue({ code: "custom", message: rule.message });
              }
            } catch {
              // Invalid regex — skip rule at runtime.
            }
            break;
          }
        }
      }
    }
  }).transform((rawValue) => {
    const trimmed = rawValue.trim();
    const validationType = spec.validationType;
    switch (validationType) {
      case "number":
        return trimmed.length === 0 ? undefined : parseLocalizedNumber(trimmed);
      case "date":
        return trimmed;
      case "iban":
        return trimmed.length === 0 ? trimmed : trimmed.replace(/\\s+/g, "").toUpperCase();
      case "credit_card":
        return trimmed.length === 0 ? trimmed : trimmed.replace(/[\\s-]+/g, "");
      default:
        return rawValue;
    }
  }) as unknown as z.ZodType<FieldSchemaOutput<TSpec>, string>;
};

const formSchema = z.object({
${schemaEntries}
})${refineChain};

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const defaultValues: FormInput = ${JSON.stringify(initialValues, null, 2)};

const { control, handleSubmit, formState: { isSubmitting, isSubmitted }, reset, setError } = useForm<FormInput>({${useFormModeLine}
  resolver: zodResolver(formSchema),
  defaultValues
});

const onSubmit = async (values: FormOutput): Promise<void> => {
  void values;
  // TODO: Replace with actual API call.
  // Example server-side error: setError("fieldKey", { message: "Server error message." });
};

const resolveFieldErrorMessage = ({
  fieldKey,
  isTouched,
  isSubmitted,
  fieldError
}: {
  fieldKey: string;
  isTouched: boolean;
  isSubmitted: boolean;
  fieldError: string | undefined;
  }): string => {
  if (!isTouched && !isSubmitted) {
    return resolvedInitialVisualErrors[fieldKey] ?? "";
  }
  if (!fieldError) {
    return "";
  }
  const overrideMessage = resolvedValidationMessages[fieldKey];
  const defaultMessage = defaultValidationMessages[fieldKey];
  if (overrideMessage && defaultMessage && fieldError === defaultMessage) {
    return overrideMessage;
  }
  return fieldError;
};`;
};

export const buildReactHookFormContextFile = ({
  screenComponentName,
  initialValues,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialVisualErrorsMap,
  selectOptionsMap,
  crossFieldRules = [],
  validationMode = "onSubmit",
  validationRulesMap = {}
}: {
  screenComponentName: string;
  initialValues: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialVisualErrorsMap: Record<string, string>;
  selectOptionsMap: Record<string, string[]>;
  crossFieldRules?: readonly CrossFieldRule[];
  validationMode?: RhfValidationMode;
  validationRulesMap?: Record<string, ValidationRule[]>;
}): FormContextFileSpec => {
  const providerName = toFormContextProviderName(screenComponentName);
  const hookName = toFormContextHookName(screenComponentName);
  const contextVarName = `${screenComponentName}FormContext`;
  const contextValueTypeName = `${screenComponentName}FormContextValue`;
  const formInputTypeName = `${screenComponentName}FormInput`;
  const formOutputTypeName = `${screenComponentName}FormOutput`;
  const providerPropsTypeName = `${providerName}Props`;
  const refineChain = toCrossFieldRefineChain({ rules: crossFieldRules, indent: "  " });
  const useFormModeLine = validationMode !== "onSubmit" ? `\n    mode: ${literal(validationMode)},` : "";
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "    "
  });
  const fieldSchemaSpecsLiteral = toReactHookFormFieldSchemaSpecsLiteral({
    initialValues,
    requiredFieldMap,
    validationTypeMap,
    validationMessageMap,
    selectOptionsMap,
    validationRulesMap
  });
  const contextSource = `import { createContext, useContext, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const defaultValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
const fieldSchemaSpecs = ${fieldSchemaSpecsLiteral} as const;
const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};

const parseLocalizedNumber = (rawValue: string): number | undefined => {
  const compact = rawValue.replace(/\\s+/g, "");
  if (!compact) {
    return undefined;
  }
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);
  let normalized = compact;
  if (decimalIndex >= 0) {
    const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fractionPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type FieldValidationType =
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

type ValidationRuleSpec =
  | { type: "min" | "max" | "minLength" | "maxLength"; value: number; message: string }
  | { type: "pattern"; value: string; message: string };

type FieldSchemaSpec = {
  required: boolean;
  validationType?: FieldValidationType;
  validationMessage: string;
  selectOptions: readonly string[];
  selectValidationMessage: string;
  validationRules?: readonly ValidationRuleSpec[];
};

type FieldSchemaOutput<TSpec extends FieldSchemaSpec> = TSpec["validationType"] extends "number" ? number | undefined : string;

const createFieldSchema = <TSpec extends FieldSchemaSpec>({ spec }: { spec: TSpec }) => {
  return z.string().superRefine((rawValue, issueContext) => {
    const trimmed = rawValue.trim();
    if (spec.required && trimmed.length === 0) {
      issueContext.addIssue({ code: "custom", message: "This field is required." });
      return;
    }
    if (trimmed.length === 0) {
      return;
    }

    const selectFieldOptions = spec.selectOptions;
    if (selectFieldOptions.length > 0 && !selectFieldOptions.includes(rawValue)) {
      const selectValidationMessage = spec.selectValidationMessage;
      issueContext.addIssue({ code: "custom", message: selectValidationMessage });
      return;
    }

    const validationType = spec.validationType;
    const validationMessage = spec.validationMessage;
    if (validationType) {
      switch (validationType) {
        case "email":
          if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "password":
          if (trimmed.length < 8) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "tel": {
          const compactTel = trimmed.replace(/\\s+/g, "");
          const digitCount = (compactTel.match(/\\d/g) ?? []).length;
          if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "url": {
          try {
            const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
            const parsed = new URL(normalizedUrl);
            if (!(parsed.hostname && parsed.hostname.includes("."))) {
              issueContext.addIssue({ code: "custom", message: validationMessage });
            }
          } catch {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "number":
          if (parseLocalizedNumber(trimmed) === undefined) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "date": {
          if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
          if (![year, month, day].every((segment) => Number.isFinite(segment))) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const date = new Date(Date.UTC(year, month - 1, day));
          const isValidDate =
            date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
          if (!isValidDate) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "iban": {
          const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
          if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          const rearranged = compact.slice(4) + compact.slice(0, 4);
          const numericStr = Array.from(rearranged).map((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 65 && code <= 90 ? String(code - 55) : ch;
          }).join("");
          let remainder = "";
          for (const digit of numericStr) {
            remainder = String(Number(remainder + digit) % 97);
          }
          if (Number(remainder) !== 1) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "plz": {
          const compact = trimmed.replace(/\\s+/g, "");
          if (!/^\\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "credit_card": {
          const digits = trimmed.replace(/[\\s-]+/g, "");
          if (!/^\\d{13,19}$/.test(digits)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
            break;
          }
          let sum = 0;
          let shouldDouble = false;
          for (let i = digits.length - 1; i >= 0; i--) {
            let digit = Number(digits[i]);
            if (shouldDouble) {
              digit *= 2;
              if (digit > 9) {
                digit -= 9;
              }
            }
            sum += digit;
            shouldDouble = !shouldDouble;
          }
          if (sum % 10 !== 0) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        default:
          break;
      }
    }

    // Advanced validation rules (min, max, minLength, maxLength, pattern)
    const rules = spec.validationRules ?? [];
    if (rules.length > 0) {
      for (const rule of rules) {
        switch (rule.type) {
          case "minLength": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const minLength: number = rawRuleValue;
            if (trimmed.length < minLength) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "maxLength": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const maxLength: number = rawRuleValue;
            if (trimmed.length > maxLength) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "min": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const parsed = parseLocalizedNumber(trimmed);
            if (parsed === undefined) {
              break;
            }
            const minValue: number = rawRuleValue;
            if (parsed < minValue) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "max": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "number") {
              break;
            }
            const parsed = parseLocalizedNumber(trimmed);
            if (parsed === undefined) {
              break;
            }
            const maxValue: number = rawRuleValue;
            if (parsed > maxValue) {
              issueContext.addIssue({ code: "custom", message: rule.message });
            }
            break;
          }
          case "pattern": {
            const rawRuleValue = rule.value;
            if (typeof rawRuleValue !== "string") {
              break;
            }
            const pattern: string = rawRuleValue;
            try {
              const regex = new RegExp(pattern);
              if (!regex.test(trimmed)) {
                issueContext.addIssue({ code: "custom", message: rule.message });
              }
            } catch {
              // Invalid regex — skip rule at runtime.
            }
            break;
          }
        }
      }
    }
  }).transform((rawValue) => {
    const trimmed = rawValue.trim();
    const validationType = spec.validationType;
    switch (validationType) {
      case "number":
        return trimmed.length === 0 ? undefined : parseLocalizedNumber(trimmed);
      case "date":
        return trimmed;
      case "iban":
        return trimmed.length === 0 ? trimmed : trimmed.replace(/\\s+/g, "").toUpperCase();
      case "credit_card":
        return trimmed.length === 0 ? trimmed : trimmed.replace(/[\\s-]+/g, "");
      default:
        return rawValue;
    }
  }) as unknown as z.ZodType<FieldSchemaOutput<TSpec>, string>;
};

const formSchema = z.object({
${schemaEntries}
})${refineChain};

export type ${formInputTypeName} = z.input<typeof formSchema>;
export type ${formOutputTypeName} = z.output<typeof formSchema>;

export interface ${contextValueTypeName} {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  control: UseFormReturn<${formInputTypeName}>["control"];
  handleSubmit: UseFormReturn<${formInputTypeName}>["handleSubmit"];
  onSubmit: (values: ${formOutputTypeName}) => Promise<void>;
  resolveFieldErrorMessage: (input: {
    fieldKey: string;
    isTouched: boolean;
    isSubmitted: boolean;
    fieldError: string | undefined;
  }) => string;
  isSubmitting: boolean;
  isSubmitted: boolean;
  reset: UseFormReturn<${formInputTypeName}>["reset"];
  setError: UseFormReturn<${formInputTypeName}>["setError"];
}

const ${contextVarName} = createContext<${contextValueTypeName} | undefined>(undefined);

export interface ${providerPropsTypeName} {
  children: ReactNode;
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
}

export function ${providerName}({ children, initialVisualErrorsOverride, validationMessagesOverride }: ${providerPropsTypeName}) {
  const defaultValues: ${formInputTypeName} = ${JSON.stringify(initialValues, null, 2)};
  const resolvedInitialVisualErrors: Record<string, string> = { ...initialVisualErrors, ...(initialVisualErrorsOverride ?? {}) };
  const resolvedValidationMessages: Record<string, string> = { ...defaultValidationMessages, ...(validationMessagesOverride ?? {}) };

  const { control, handleSubmit, formState: { isSubmitting, isSubmitted }, reset, setError } = useForm<${formInputTypeName}>({${useFormModeLine}
    resolver: zodResolver(formSchema),
    defaultValues
  });

  const onSubmit = async (values: ${formOutputTypeName}): Promise<void> => {
    void values;
    // TODO: Replace with actual API call.
    // Example server-side error: setError("fieldKey", { message: "Server error message." });
  };

  const resolveFieldErrorMessage = ({
    fieldKey,
    isTouched,
    isSubmitted,
    fieldError
  }: {
    fieldKey: string;
    isTouched: boolean;
    isSubmitted: boolean;
    fieldError: string | undefined;
  }): string => {
    if (!isTouched && !isSubmitted) {
      return resolvedInitialVisualErrors[fieldKey] ?? "";
    }
    if (!fieldError) {
      return "";
    }
    const overrideMessage = resolvedValidationMessages[fieldKey];
    const defaultMessage = defaultValidationMessages[fieldKey];
    if (overrideMessage && defaultMessage && fieldError === defaultMessage) {
      return overrideMessage;
    }
    return fieldError;
  };

  return (
    <${contextVarName}.Provider
      value={{
        initialVisualErrors: resolvedInitialVisualErrors,
        selectOptions,
        control,
        handleSubmit,
        onSubmit,
        resolveFieldErrorMessage,
        isSubmitting,
        isSubmitted,
        reset,
        setError
      }}
    >
      {children}
    </${contextVarName}.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${contextValueTypeName} => {
  const context = useContext(${contextVarName});
  if (!context) {
    throw new Error("${hookName} must be used within ${providerName}");
  }
  return context;
};
`;
  return {
    file: {
      path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}FormContext`)),
      content: contextSource
    },
    providerName,
    hookName,
    importPath: `../context/${screenComponentName}FormContext`
  };
};
