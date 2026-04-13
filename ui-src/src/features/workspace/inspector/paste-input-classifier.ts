import { isFigmaClipboard } from "./figma-clipboard-parser";

export type PasteInputKind =
  | "direct_json"
  | "plugin_payload_json"
  | "plugin_envelope"
  | "unknown";

export type ImportIntent =
  | "FIGMA_JSON_NODE_BATCH"
  | "FIGMA_JSON_DOC"
  | "FIGMA_PLUGIN_ENVELOPE"
  | "RAW_CODE_OR_TEXT"
  | "UNKNOWN";

/** Known clipboard envelope kind values. */
const CLIPBOARD_ENVELOPE_KINDS = new Set(["workspace-dev/figma-selection@1"]);
const CLIPBOARD_ENVELOPE_KIND_PREFIX = "workspace-dev/figma-selection@";

function looksLikeClipboardEnvelopeKind(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(CLIPBOARD_ENVELOPE_KIND_PREFIX)
  );
}

export interface PasteClassification {
  kind: PasteInputKind;
  rawText: string;
  parsedJson?: unknown;
  reason?: "empty" | "not_json" | "malformed_json";
}

export interface PasteIntentClassification {
  intent: ImportIntent;
  confidence: number;
  suggestedJobSource: "figma_paste" | "figma_plugin" | "manual_text";
  rawText: string;
  parsedJson?: unknown;
  reason?: string;
}

export function classifyPasteInput(raw: string): PasteClassification {
  const rawText = raw.trim();

  if (rawText.length === 0) {
    return { kind: "unknown", rawText, reason: "empty" };
  }

  if (rawText[0] !== "{" && rawText[0] !== "[") {
    return { kind: "unknown", rawText, reason: "not_json" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { kind: "unknown", rawText, reason: "malformed_json" };
  }

  if (
    parsedJson !== null &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson)
  ) {
    const record = parsedJson as Record<string, unknown>;

    if (looksLikeClipboardEnvelopeKind(record["kind"])) {
      return { kind: "plugin_envelope", rawText, parsedJson };
    }

    if (record["document"] !== null && typeof record["document"] === "object") {
      return { kind: "direct_json", rawText, parsedJson };
    }

    if (
      "figmaSourceMode" in record ||
      record["type"] === "PLUGIN_EXPORT" ||
      "plugin" in record
    ) {
      return { kind: "plugin_payload_json", rawText, parsedJson };
    }
  }

  return { kind: "direct_json", rawText, parsedJson };
}

export function classifyPasteIntent(
  raw: string,
  clipboardHtml?: string,
): PasteIntentClassification {
  const rawText = raw.trim();

  if (rawText.length === 0) {
    return {
      intent: "UNKNOWN",
      confidence: 1.0,
      suggestedJobSource: "manual_text",
      rawText,
    };
  }

  if (clipboardHtml !== undefined && isFigmaClipboard(clipboardHtml)) {
    return {
      intent: "FIGMA_JSON_NODE_BATCH",
      confidence: 0.95,
      suggestedJobSource: "figma_paste",
      rawText,
    };
  }

  if (rawText[0] !== "{" && rawText[0] !== "[") {
    return {
      intent: "RAW_CODE_OR_TEXT",
      confidence: 1.0,
      suggestedJobSource: "manual_text",
      rawText,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return {
      intent: "RAW_CODE_OR_TEXT",
      confidence: 0.6,
      suggestedJobSource: "manual_text",
      rawText,
      reason: "malformed_json",
    };
  }

  if (
    parsedJson !== null &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson)
  ) {
    const record = parsedJson as Record<string, unknown>;

    if (looksLikeClipboardEnvelopeKind(record["kind"])) {
      return {
        intent: "FIGMA_PLUGIN_ENVELOPE",
        confidence: CLIPBOARD_ENVELOPE_KINDS.has(record["kind"]) ? 0.95 : 0.85,
        suggestedJobSource: "figma_plugin",
        rawText,
        parsedJson,
      };
    }

    if (
      "document" in record &&
      record["document"] !== null &&
      typeof record["document"] === "object"
    ) {
      return {
        intent: "FIGMA_JSON_DOC",
        confidence: 0.9,
        suggestedJobSource: "figma_paste",
        rawText,
        parsedJson,
      };
    }

    if (
      record["type"] === "PLUGIN_EXPORT" ||
      "figmaSourceMode" in record ||
      "plugin" in record
    ) {
      return {
        intent: "FIGMA_JSON_NODE_BATCH",
        confidence: 0.85,
        suggestedJobSource: "figma_plugin",
        rawText,
        parsedJson,
      };
    }

    if ("type" in record && "children" in record) {
      return {
        intent: "FIGMA_JSON_NODE_BATCH",
        confidence: 0.8,
        suggestedJobSource: "figma_paste",
        rawText,
        parsedJson,
      };
    }
  }

  if (Array.isArray(parsedJson)) {
    const isNodeArray =
      parsedJson.length > 0 &&
      parsedJson.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          "type" in (item as Record<string, unknown>) &&
          "name" in (item as Record<string, unknown>),
      );

    if (isNodeArray) {
      return {
        intent: "FIGMA_JSON_NODE_BATCH",
        confidence: 0.8,
        suggestedJobSource: "figma_paste",
        rawText,
        parsedJson,
      };
    }
  }

  return {
    intent: "RAW_CODE_OR_TEXT",
    confidence: 0.7,
    suggestedJobSource: "manual_text",
    rawText,
    parsedJson,
  };
}

export function isSecureContextAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const ctx: boolean | undefined =
    "isSecureContext" in window
      ? (window as { isSecureContext?: boolean }).isSecureContext
      : undefined;
  return ctx === true;
}
