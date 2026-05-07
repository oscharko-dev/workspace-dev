/**
 * Shared relevance filters for coverage targets.
 *
 * Figma REST trees contain many technical/decorative text nodes that are not
 * customer-visible test obligations: icons, units, placeholder labels, raw
 * values and node ids. Coverage planning and coverage reporting must agree on
 * which nodes are semantic targets, otherwise the policy gate demands cases for
 * artifacts a customer would never test explicitly.
 */

export interface CoverageElementLike {
  readonly label?: string;
  readonly kind?: string;
  readonly type?: string;
}

export interface CoverageActionLike {
  readonly label?: string;
  readonly kind?: string;
  readonly targetScreenId?: string;
  readonly labelConfidence?: number;
}

const DECORATIVE_LABELS = new Set([
  "",
  "(optional)",
  "<icon>",
  "<select>",
  "<svg>",
  "<text>",
  "<textfield>",
  "<vector>",
  "alt text",
  "alternate text",
  "alternativtext",
  "eur",
  "icon",
  "optional",
  "text",
  "typography",
  "€",
]);

const FIGMA_NODE_ID_PATTERN =
  /^\d+:\d+(?:::(?:field|action|validation|navigation)::\d+:\d+)?$/u;

const VALUE_ONLY_PATTERN =
  /^[+-]?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?(?:\s*(?:eur|€|%))?$/iu;
const DECORATIVE_KIND_PATTERN =
  /\b(icon|svg|vector|chevron|arrow|decorative|separator|divider)\b/iu;

/**
 * Matches angle-bracket placeholder tokens such as `<Radio>`, `<TextField>`,
 * `<Stack>`. Figma REST exports often surface the React component name as the
 * raw text node when no human-authored label exists; those nodes must never
 * become customer-facing test obligations.
 */
const STRUCTURAL_PLACEHOLDER_PATTERN = /<[^<>\s][^<>]*>/u;

export const normalizeCoverageText = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

const isDecorativeCoverageLabel = (label: string): boolean =>
  DECORATIVE_LABELS.has(label) ||
  FIGMA_NODE_ID_PATTERN.test(label) ||
  VALUE_ONLY_PATTERN.test(label) ||
  STRUCTURAL_PLACEHOLDER_PATTERN.test(label);

const isDecorativeCoverageKind = (kind: string): boolean =>
  DECORATIVE_KIND_PATTERN.test(kind) || kind === "decorative";

export const isCoverageRelevantElementLike = (
  element: CoverageElementLike,
): boolean => {
  const label = normalizeCoverageText(element.label);
  if (isDecorativeCoverageLabel(label)) {
    return false;
  }

  const kind = normalizeCoverageText(element.kind ?? element.type);
  if (isDecorativeCoverageKind(kind)) {
    return false;
  }

  return true;
};

export const isCoverageRelevantActionLike = (
  action: CoverageActionLike,
): boolean => {
  const label = normalizeCoverageText(action.label);
  if (isDecorativeCoverageLabel(label)) {
    return false;
  }
  if (label === "chevron" || label === "arrow" || label === "dropdown icon") {
    return false;
  }
  const kind = normalizeCoverageText(action.kind);
  if (isDecorativeCoverageKind(kind)) {
    return false;
  }
  if (
    typeof action.labelConfidence === "number" &&
    action.labelConfidence <= 0 &&
    action.targetScreenId === undefined
  ) {
    return false;
  }
  return true;
};
