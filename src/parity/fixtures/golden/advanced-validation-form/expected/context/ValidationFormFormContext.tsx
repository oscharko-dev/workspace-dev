import { createContext, useContext, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const initialVisualErrors: Record<string, string> = {};
const defaultValidationMessages: Record<string, string> = {
  "muitextfieldroot_email_field": "Use your @example.com email.",
  "muitextfieldroot_amount_field": "Amount must be between 100 and 5000.",
  "muitextfieldroot_code_field": "Promo code must be 6 uppercase characters."
};
const fieldSchemaSpecs = {
  "muitextfieldroot_amount_field": {
    "required": false,
    "validationType": "number",
    "validationMessage": "Amount must be between 100 and 5000.",
    "selectOptions": [],
    "selectValidationMessage": "Amount must be between 100 and 5000."
  },
  "muitextfieldroot_code_field": {
    "required": false,
    "validationMessage": "Promo code must be 6 uppercase characters.",
    "selectOptions": [],
    "selectValidationMessage": "Promo code must be 6 uppercase characters."
  },
  "muitextfieldroot_email_field": {
    "required": false,
    "validationType": "email",
    "validationMessage": "Use your @example.com email.",
    "selectOptions": [],
    "selectValidationMessage": "Use your @example.com email."
  }
} as const;
const selectOptions: Record<string, string[]> = {};

const parseLocalizedNumber = (rawValue: string): number | undefined => {
  const compact = rawValue.replace(/\s+/g, "");
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
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
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
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "password":
          if (trimmed.length < 8) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        case "tel": {
          const compactTel = trimmed.replace(/\s+/g, "");
          const digitCount = (compactTel.match(/\d/g) ?? []).length;
          if (!/^\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "url": {
          try {
            const normalizedUrl = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
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
          if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
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
          const compact = trimmed.replace(/\s+/g, "").toUpperCase();
          if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
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
          const compact = trimmed.replace(/\s+/g, "");
          if (!/^\d{4,10}$/.test(compact) && !/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(trimmed)) {
            issueContext.addIssue({ code: "custom", message: validationMessage });
          }
          break;
        }
        case "credit_card": {
          const digits = trimmed.replace(/[\s-]+/g, "");
          if (!/^\d{13,19}$/.test(digits)) {
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
        return trimmed.length === 0 ? trimmed : trimmed.replace(/\s+/g, "").toUpperCase();
      case "credit_card":
        return trimmed.length === 0 ? trimmed : trimmed.replace(/[\s-]+/g, "");
      default:
        return rawValue;
    }
  }) as unknown as z.ZodType<FieldSchemaOutput<TSpec>, string>;
};

const formSchema = z.object({
    "muitextfieldroot_amount_field": createFieldSchema({ spec: fieldSchemaSpecs["muitextfieldroot_amount_field"] }),
    "muitextfieldroot_code_field": createFieldSchema({ spec: fieldSchemaSpecs["muitextfieldroot_code_field"] }),
    "muitextfieldroot_email_field": createFieldSchema({ spec: fieldSchemaSpecs["muitextfieldroot_email_field"] })
});

export type ValidationFormFormInput = z.input<typeof formSchema>;
export type ValidationFormFormOutput = z.output<typeof formSchema>;

export interface ValidationFormFormContextValue {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  control: UseFormReturn<ValidationFormFormInput>["control"];
  handleSubmit: UseFormReturn<ValidationFormFormInput>["handleSubmit"];
  onSubmit: (values: ValidationFormFormOutput) => Promise<void>;
  resolveFieldErrorMessage: (input: {
    fieldKey: string;
    isTouched: boolean;
    isSubmitted: boolean;
    fieldError: string | undefined;
  }) => string;
  isSubmitting: boolean;
  isSubmitted: boolean;
  reset: UseFormReturn<ValidationFormFormInput>["reset"];
  setError: UseFormReturn<ValidationFormFormInput>["setError"];
}

const ValidationFormFormContext = createContext<ValidationFormFormContextValue | undefined>(undefined);

export interface ValidationFormFormContextProviderProps {
  children: ReactNode;
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
}

export function ValidationFormFormContextProvider({ children, initialVisualErrorsOverride, validationMessagesOverride }: ValidationFormFormContextProviderProps) {
  const defaultValues: ValidationFormFormInput = {
  "muitextfieldroot_email_field": "",
  "muitextfieldroot_amount_field": "250",
  "muitextfieldroot_code_field": "AB12CD"
};
  const resolvedInitialVisualErrors: Record<string, string> = initialVisualErrorsOverride ?? initialVisualErrors;
  const resolvedValidationMessages: Record<string, string> = { ...defaultValidationMessages, ...(validationMessagesOverride ?? {}) };

  const { control, handleSubmit, formState: { isSubmitting, isSubmitted }, reset, setError } = useForm<ValidationFormFormInput>({
    resolver: zodResolver(formSchema),
    defaultValues
  });

  const onSubmit = async (values: ValidationFormFormOutput): Promise<void> => {
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
    <ValidationFormFormContext.Provider
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
    </ValidationFormFormContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useValidationFormFormContext = (): ValidationFormFormContextValue => {
  const context = useContext(ValidationFormFormContext);
  if (!context) {
    throw new Error("useValidationFormFormContext must be used within ValidationFormFormContextProvider");
  }
  return context;
};
