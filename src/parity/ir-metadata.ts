// ---------------------------------------------------------------------------
// ir-metadata.ts — Deterministic semantic hint derivation from Figma metadata
// Extracted from ir-tokens.ts (issue #509)
// ---------------------------------------------------------------------------
import type { FigmaMcpMetadataHint } from "./types-job.js";

/**
 * Semantic type pattern map: layer name patterns → semantic landmark type.
 * Order matters — first match wins.
 */
const SEMANTIC_TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(nav|navigation|navbar|sidebar|menu|drawer|tabbar)\b/i, "navigation"],
  [/\b(app\s*bar|top\s*bar|header|banner|hero)\b/i, "header"],
  [/\b(main|content|body)\b/i, "main"],
  [/\bfooter|bottom\s*bar|contentinfo\b/i, "footer"],
  [/\b(article|card)\b/i, "article"],
  [/\bsection|group\b/i, "section"],
  [/\bform\b/i, "form"]
];

const normalizeSemanticValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Infers a semantic container type from metadata hint fields using deterministic
 * name-pattern matching. Combines `semanticType`, `semanticName`, `layerType`,
 * and `layerName` into a single lookup string and matches against known landmark
 * patterns (navigation, header, main, footer, article, section, form).
 *
 * No LLM dependency — all rules are deterministic regex patterns.
 */
export const inferSemanticTypeFromMetadataHint = (hint: FigmaMcpMetadataHint): string | undefined => {
  const combined = [
    hint.semanticType,
    hint.semanticName,
    hint.layerType,
    hint.layerName
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (!combined) {
    return undefined;
  }
  for (const [pattern, semanticType] of SEMANTIC_TYPE_PATTERNS) {
    if (pattern.test(combined)) {
      return semanticType;
    }
  }
  return normalizeSemanticValue(hint.semanticType);
};

/**
 * Normalizes a raw metadata hint by deriving a canonical `semanticName` and
 * `semanticType` from the hint's layer name and type fields.
 */
export const normalizeMetadataHint = (hint: FigmaMcpMetadataHint): FigmaMcpMetadataHint => {
  const semanticName = normalizeSemanticValue(hint.semanticName) ?? normalizeSemanticValue(hint.layerName);
  const semanticType = inferSemanticTypeFromMetadataHint(hint);
  return {
    ...hint,
    ...(semanticName ? { semanticName } : {}),
    ...(semanticType ? { semanticType } : {})
  };
};

/**
 * Derives deterministic semantic hints from raw Figma metadata nodes.
 * Applies name-pattern matching to produce `FigmaMcpMetadataHint[]` that
 * can be consumed by `applyMcpEnrichmentToIr()`.
 *
 * This is the primary entry point for metadata-to-hint derivation and can
 * be called with the output of the MCP `get_metadata` tool.
 */
export const deriveSemanticHintsFromMetadata = (
  hints: FigmaMcpMetadataHint[]
): FigmaMcpMetadataHint[] => {
  return hints.map(normalizeMetadataHint);
};

export { SEMANTIC_TYPE_PATTERNS };
