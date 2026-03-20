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
  FormContextFileSpec
} from "../generator-core.js";
import { literal } from "./utility-functions.js";

export const buildInlineLegacyFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};

const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);
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
  return Object.keys(values).reduce<Record<string, string>>((nextErrors, fieldKey) => {
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
}

export function ${providerName}({ children }: ${providerPropsTypeName}) {
  const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
  const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
  const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
  const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
  const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};
  const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);
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
    return Object.keys(values).reduce<Record<string, string>>((nextErrors, fieldKey) => {
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
        initialVisualErrors,
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
  return fieldKeys.map((fieldKey) => `${indent}${literal(fieldKey)}: createFieldSchema({ fieldKey: ${literal(fieldKey)} })`).join(",\n");
};

export const buildInlineReactHookFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "  "
  });
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};

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

const createFieldSchema = ({ fieldKey }: { fieldKey: string }) => {
  return z.string().superRefine((rawValue, issueContext) => {
    const trimmed = rawValue.trim();
    if (requiredFields[fieldKey] && trimmed.length === 0) {
      issueContext.addIssue({ code: z.ZodIssueCode.custom, message: "This field is required." });
      return;
    }
    if (trimmed.length === 0) {
      return;
    }

    const validationType = fieldValidationTypes[fieldKey];
    if (!validationType) {
      return;
    }
    const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

    switch (validationType) {
      case "email":
        if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      case "tel": {
        const compactTel = trimmed.replace(/\\s+/g, "");
        const digitCount = (compactTel.match(/\\d/g) ?? []).length;
        if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "url": {
        try {
          const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
          const parsed = new URL(normalizedUrl);
          if (!(parsed.hostname && parsed.hostname.includes("."))) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
        } catch {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "number":
        if (parseLocalizedNumber(trimmed) === undefined) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      case "date": {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
        }
        const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
        if (![year, month, day].every((segment) => Number.isFinite(segment))) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
        }
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
          date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
        if (!isValidDate) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "iban": {
        const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
        if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
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
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "plz": {
        const compact = trimmed.replace(/\\s+/g, "");
        if (!/^\\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "credit_card": {
        const digits = trimmed.replace(/[\\s-]+/g, "");
        if (!/^\\d{13,19}$/.test(digits)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
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
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      default:
        return;
    }
  });
};

const formSchema = z.object({
${schemaEntries}
});

const { control, handleSubmit } = useForm({
  resolver: zodResolver(formSchema),
  defaultValues: ${JSON.stringify(initialValues, null, 2)}
});

const onSubmit = (values: Record<string, string>): void => {
  void values;
  // Intentionally no-op in deterministic fallback output.
};

const resolveFieldErrorMessage = ({
  fieldKey,
  isTouched,
  fieldError
}: {
  fieldKey: string;
  isTouched: boolean;
  fieldError: string | undefined;
}): string => {
  if (!isTouched) {
    return initialVisualErrors[fieldKey] ?? "";
  }
  return fieldError ?? "";
};`;
};

export const buildReactHookFormContextFile = ({
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
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "    "
  });
  const contextSource = `import { createContext, useContext, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export interface ${contextValueTypeName} {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  control: UseFormReturn<Record<string, string>>["control"];
  handleSubmit: UseFormReturn<Record<string, string>>["handleSubmit"];
  onSubmit: (values: Record<string, string>) => void;
  resolveFieldErrorMessage: (input: { fieldKey: string; isTouched: boolean; fieldError: string | undefined }) => string;
}

const ${contextVarName} = createContext<${contextValueTypeName} | undefined>(undefined);

export interface ${providerPropsTypeName} {
  children: ReactNode;
}

export function ${providerName}({ children }: ${providerPropsTypeName}) {
  const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
  const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
  const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
  const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
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

  const createFieldSchema = ({ fieldKey }: { fieldKey: string }) => {
    return z.string().superRefine((rawValue, issueContext) => {
      const trimmed = rawValue.trim();
      if (requiredFields[fieldKey] && trimmed.length === 0) {
        issueContext.addIssue({ code: z.ZodIssueCode.custom, message: "This field is required." });
        return;
      }
      if (trimmed.length === 0) {
        return;
      }

      const validationType = fieldValidationTypes[fieldKey];
      if (!validationType) {
        return;
      }
      const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

      switch (validationType) {
        case "email":
          if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        case "tel": {
          const compactTel = trimmed.replace(/\\s+/g, "");
          const digitCount = (compactTel.match(/\\d/g) ?? []).length;
          if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "url": {
          try {
            const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
            const parsed = new URL(normalizedUrl);
            if (!(parsed.hostname && parsed.hostname.includes("."))) {
              issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            }
          } catch {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "number":
          if (parseLocalizedNumber(trimmed) === undefined) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        case "date": {
          if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
          }
          const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
          if (![year, month, day].every((segment) => Number.isFinite(segment))) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
          }
          const date = new Date(Date.UTC(year, month - 1, day));
          const isValidDate =
            date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
          if (!isValidDate) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "iban": {
          const compact = trimmed.replace(/\\s+/g, "").toUpperCase();
          if (!/^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
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
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "plz": {
          const compact = trimmed.replace(/\\s+/g, "");
          if (!/^\\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$/i.test(trimmed)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "credit_card": {
          const digits = trimmed.replace(/[\\s-]+/g, "");
          if (!/^\\d{13,19}$/.test(digits)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
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
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        default:
          return;
      }
    });
  };

  const formSchema = z.object({
${schemaEntries}
  });

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: ${JSON.stringify(initialValues, null, 2)}
  });

  const onSubmit = (values: Record<string, string>): void => {
    void values;
    // Intentionally no-op in deterministic fallback output.
  };

  const resolveFieldErrorMessage = ({
    fieldKey,
    isTouched,
    fieldError
  }: {
    fieldKey: string;
    isTouched: boolean;
    fieldError: string | undefined;
  }): string => {
    if (!isTouched) {
      return initialVisualErrors[fieldKey] ?? "";
    }
    return fieldError ?? "";
  };

  return (
    <${contextVarName}.Provider
      value={{
        initialVisualErrors,
        selectOptions,
        control: control as unknown as UseFormReturn<Record<string, string>>["control"],
        handleSubmit: handleSubmit as unknown as UseFormReturn<Record<string, string>>["handleSubmit"],
        onSubmit,
        resolveFieldErrorMessage
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

