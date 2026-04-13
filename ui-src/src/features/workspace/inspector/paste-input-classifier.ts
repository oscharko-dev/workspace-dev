export type PasteInputKind = "direct_json" | "plugin_payload_json" | "unknown";

export interface PasteClassification {
  kind: PasteInputKind;
  rawText: string;
  parsedJson?: unknown;
  reason?: "empty" | "not_json" | "malformed_json";
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
