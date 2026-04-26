import {
  SUGGESTED_CUSTOM_CONTEXT_ATTRIBUTES,
  type IntentRedaction,
  type PiiIndicator,
  type CustomContextStructuredEntry,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { detectPii, redactPii } from "./pii-detection.js";

export const MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT = 64;
export const MAX_CUSTOM_CONTEXT_ATTRIBUTE_VALUE_CHARS = 256;

export type CustomContextInputIssueCode =
  | "custom_context_body_invalid"
  | "custom_context_field_unsupported"
  | "custom_context_empty"
  | "custom_context_attribute_list_invalid"
  | "custom_context_attribute_count_invalid"
  | "custom_context_attribute_shape_invalid"
  | "custom_context_attribute_key_invalid"
  | "custom_context_attribute_value_invalid"
  | "custom_context_attribute_duplicate";

export interface CustomContextInputIssue {
  code: CustomContextInputIssueCode;
  path?: string;
  detail?: string;
}

export interface CustomContextAttribute {
  key: string;
  value: string;
}

interface RedactedCustomContextAttribute extends CustomContextAttribute {
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}

export interface ValidatedCustomContextInput {
  markdown?: string;
  attributes?: CustomContextAttribute[];
}

export type ValidateCustomContextInputResult =
  | { ok: true; value: ValidatedCustomContextInput }
  | { ok: false; issues: CustomContextInputIssue[] };

const ALLOWED_FIELDS = new Set(["markdown", "bodyMarkdown", "attributes"]);
const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const PRINTABLE_ATTRIBUTE_VALUE_RE = /^[\p{L}\p{N}\p{P}\p{S} ]+$/u;
const EMAIL_RE =
  /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/gu;
const PAN_RE = /(?:\d[\s-]?){12,18}\d/gu;
const TAX_ID_RE = /\b(?:\d{3}-\d{2}-\d{4}|\d{11})\b/gu;
const PHONE_RE =
  /(?<![\dA-Za-z])(?:\+\d{1,3}[\s-]\d{2,4}[\s-]\d{3,8}(?:[\s-]\d{3,4})?|\(\d{2,4}\)[\s-]?\d{3,4}[\s-]\d{3,8})(?!\d)/gu;
const INTERNAL_HOSTNAME_RE =
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:intranet|corp|internal|local|lan|atlassian\.net|jira\.com)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?![A-Za-z0-9])/giu;
const FULL_NAME_PLACEHOLDERS = [
  "Max Mustermann",
  "Erika Mustermann",
  "Max Musterman",
  "John Doe",
  "Jane Doe",
  "Jane Smith",
  "John Smith",
] as const;

const ATTRIBUTE_KEY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["regulatoryScope", "regulatory_scope"],
  ["testEnvironment", "test_environment"],
  ["dataClass", "data_class"],
  ["priorityHint", "priority_hint"],
  ["featureFlag", "feature_flag"],
  ["nonFunctionalProfile", "non_functional_profile"],
]);

export const RECOGNIZED_CUSTOM_CONTEXT_ATTRIBUTE_KEYS: ReadonlySet<string> =
  new Set(
    SUGGESTED_CUSTOM_CONTEXT_ATTRIBUTES.map((attribute) => attribute.key),
  );

export const validateCustomContextInput = (
  candidate: unknown,
): ValidateCustomContextInputResult => {
  const issues: CustomContextInputIssue[] = [];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, issues: [{ code: "custom_context_body_invalid" }] };
  }

  const body = candidate as Record<string, unknown>;
  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) {
      issues.push({
        code: "custom_context_field_unsupported",
        path: field,
      });
    }
  }

  const rawMarkdown = body.markdown ?? body.bodyMarkdown;
  let markdown: string | undefined;
  if (rawMarkdown !== undefined) {
    if (typeof rawMarkdown !== "string") {
      issues.push({
        code: "custom_context_body_invalid",
        path: body.markdown !== undefined ? "markdown" : "bodyMarkdown",
      });
    } else {
      markdown = rawMarkdown;
    }
  }

  let attributes: CustomContextAttribute[] | undefined;
  if (body.attributes !== undefined) {
    const attrResult = validateCustomContextAttributes(body.attributes);
    if (!attrResult.ok) {
      issues.push(...attrResult.issues);
    } else {
      attributes = attrResult.attributes;
    }
  }

  if (markdown === undefined && attributes === undefined) {
    issues.push({ code: "custom_context_empty" });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      ...(markdown !== undefined ? { markdown } : {}),
      ...(attributes !== undefined ? { attributes } : {}),
    },
  };
};

export const validateCustomContextAttributes = (
  candidate: unknown,
):
  | { ok: true; attributes: CustomContextAttribute[] }
  | { ok: false; issues: CustomContextInputIssue[] } => {
  const issues: CustomContextInputIssue[] = [];
  if (!Array.isArray(candidate)) {
    return {
      ok: false,
      issues: [
        {
          code: "custom_context_attribute_list_invalid",
          path: "attributes",
        },
      ],
    };
  }
  if (
    candidate.length < 1 ||
    candidate.length > MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT
  ) {
    issues.push({
      code: "custom_context_attribute_count_invalid",
      path: "attributes",
      detail: String(candidate.length),
    });
  }
  const seen = new Set<string>();
  const attributes: CustomContextAttribute[] = [];
  candidate.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push({
        code: "custom_context_attribute_shape_invalid",
        path: `attributes[${index}]`,
      });
      return;
    }
    const attr = entry as Record<string, unknown>;
    const rawKey = attr.key;
    const rawValue = attr.value;
    if (typeof rawKey !== "string") {
      issues.push({
        code: "custom_context_attribute_key_invalid",
        path: `attributes[${index}].key`,
      });
      return;
    }
    const key = normalizeAttributeKey(rawKey);
    if (!ATTRIBUTE_KEY_RE.test(key)) {
      issues.push({
        code: "custom_context_attribute_key_invalid",
        path: `attributes[${index}].key`,
        detail: rawKey,
      });
      return;
    }
    if (typeof rawValue !== "string") {
      issues.push({
        code: "custom_context_attribute_value_invalid",
        path: `attributes[${index}].value`,
      });
      return;
    }
    const value = redactCustomContextAttributeValue({
      key,
      value: rawValue.normalize("NFKC").trim(),
      index,
    }).value;
    if (
      value.length === 0 ||
      value.length > MAX_CUSTOM_CONTEXT_ATTRIBUTE_VALUE_CHARS ||
      value.includes("\n") ||
      value.includes("\r") ||
      !PRINTABLE_ATTRIBUTE_VALUE_RE.test(value)
    ) {
      issues.push({
        code: "custom_context_attribute_value_invalid",
        path: `attributes[${index}].value`,
      });
      return;
    }
    const fingerprint = `${key}\u0000${value}`;
    if (seen.has(fingerprint)) {
      issues.push({
        code: "custom_context_attribute_duplicate",
        path: `attributes[${index}]`,
        detail: key,
      });
      return;
    }
    seen.add(fingerprint);
    attributes.push({ key, value });
  });

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    attributes: [...attributes].sort((a, b) =>
      a.key === b.key
        ? a.value.localeCompare(b.value)
        : a.key.localeCompare(b.key),
    ),
  };
};

export const normalizeAttributeKey = (key: string): string => {
  const trimmed = key.trim();
  return ATTRIBUTE_KEY_ALIASES.get(trimmed) ?? trimmed;
};

export const buildStructuredEntry = (input: {
  entryId: string;
  authorHandle: string;
  capturedAt: string;
  attributes: readonly CustomContextAttribute[];
}): CustomContextStructuredEntry => {
  const redacted = normalizeAndRedactCustomContextAttributes(input.attributes);
  const attributes = redacted.map((attr) => ({
    key: attr.key,
    value: attr.value,
  }));
  const contentHash = sha256Hex({
    kind: "custom_context_structured",
    attributes,
  });
  const piiIndicators = redacted.flatMap((attr) => attr.piiIndicators);
  const redactions = redacted.flatMap((attr) => attr.redactions);
  return {
    entryId: input.entryId,
    authorHandle: input.authorHandle,
    capturedAt: input.capturedAt,
    attributes,
    contentHash,
    piiIndicators,
    redactions,
  };
};

export const normalizeAndRedactCustomContextAttributes = (
  attributes: readonly CustomContextAttribute[],
): RedactedCustomContextAttribute[] => {
  return attributes
    .map((attribute, index) =>
      redactCustomContextAttributeValue({
        key: normalizeAttributeKey(attribute.key),
        value: attribute.value.normalize("NFKC").trim(),
        index,
      }),
    )
    .sort((a, b) =>
      a.key === b.key
        ? a.value.localeCompare(b.value)
        : a.key.localeCompare(b.key),
    );
};

const redactCustomContextAttributeValue = (input: {
  key: string;
  value: string;
  index: number;
}): RedactedCustomContextAttribute => {
  let value = input.value;
  const piiIndicators: PiiIndicator[] = [];
  const redactions: IntentRedaction[] = [];
  const apply = (kind: PiiIndicator["kind"], re: RegExp) => {
    const redacted = redactPii(kind);
    const nextValue = value.replace(re, redacted);
    if (nextValue !== value) {
      value = nextValue;
      recordAttributeRedaction({
        key: input.key,
        index: input.index,
        kind,
        redacted,
        piiIndicators,
        redactions,
      });
    }
  };

  apply("pan", PAN_RE);
  apply("email", EMAIL_RE);
  apply("tax_id", TAX_ID_RE);
  apply("phone", PHONE_RE);
  apply("internal_hostname", INTERNAL_HOSTNAME_RE);
  for (const placeholder of FULL_NAME_PLACEHOLDERS) {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    apply("full_name", new RegExp(`\\b${escaped}\\b`, "giu"));
  }

  const fallbackMatch = detectPii(value);
  if (fallbackMatch !== null) {
    value = fallbackMatch.redacted;
    recordAttributeRedaction({
      key: input.key,
      index: input.index,
      kind: fallbackMatch.kind,
      redacted: fallbackMatch.redacted,
      piiIndicators,
      redactions,
    });
  }

  return { key: input.key, value, piiIndicators, redactions };
};

const recordAttributeRedaction = (input: {
  key: string;
  index: number;
  kind: PiiIndicator["kind"];
  redacted: string;
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}): void => {
  const indicatorId = `custom-context::attribute::${input.index}::${input.key}::pii::${input.kind}`;
  if (input.piiIndicators.some((indicator) => indicator.id === indicatorId)) {
    return;
  }
  input.piiIndicators.push({
    id: indicatorId,
    kind: input.kind,
    confidence: 0.9,
    matchLocation: "custom_context_attribute",
    redacted: input.redacted,
    traceRef: {},
  });
  input.redactions.push({
    id: `${indicatorId}::redaction`,
    indicatorId,
    kind: input.kind,
    reason: `Detected ${input.kind} in custom_context_attribute`,
    replacement: input.redacted,
  });
};
