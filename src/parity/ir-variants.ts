/**
 * Variant and placeholder parsing/domain helpers extracted from ir.ts.
 */
import {
  isTechnicalPlaceholderText,
  normalizePlaceholderText
} from "../figma-node-heuristics.js";
import { resolveFirstVisibleSolidPaint, toHexColor } from "./ir-colors.js";
import type { FigmaPaint } from "./ir-colors.js";
import type {
  VariantElementState,
  VariantMappingIR,
  VariantMuiProps,
  VariantStateSnapshot,
  VariantStateStyle
} from "./types.js";

interface FigmaComponentPropertyValue {
  type?: string;
  value?: unknown;
}

interface FigmaComponentPropertyDefinition {
  type?: string;
  defaultValue?: unknown;
  variantOptions?: unknown;
}

interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  componentProperties?: Record<string, FigmaComponentPropertyValue>;
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  characters?: string;
}

export const GENERIC_PLACEHOLDER_TEXT_PATTERNS: RegExp[] = [
  /^(type|enter|your)(?:\s+text)?(?:\s+here)?$/i,
  /^(label|title|subtitle|heading)$/i,
  /^(xx(?:[./:-]xx)+)$/i,
  /^\$?\s*0(?:[.,]0{2})?$/i,
  /^\d{3}-\d{3}-\d{4}$/i,
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i,
  /^(john|jane)\s+doe$/i,
  /^[x•—–-]$/i
];

export interface PlaceholderMatcherConfig {
  allowlist: Set<string>;
  blocklist: Set<string>;
}

export interface NormalizedVariantData {
  properties: Record<string, string>;
  muiProps: VariantMuiProps;
  state?: VariantElementState;
  stateOverrides?: {
    hover?: VariantStateStyle;
    active?: VariantStateStyle;
    disabled?: VariantStateStyle;
  };
}

export interface ComponentSetVariantCandidate extends NormalizedVariantData {
  node: FigmaNode;
  style: VariantStateStyle;
}

export const isTruthyVariantFlag = (value: string): boolean => {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, "");
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
};

export const normalizeVariantKey = (key: string): string | undefined => {
  const normalized = key
    .trim()
    .replace(/[#*]+$/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "state" || normalized.includes(" state")) {
    return "state";
  }
  if (normalized === "size" || normalized.includes(" size")) {
    return "size";
  }
  if (
    normalized === "variant" ||
    normalized.includes(" variant") ||
    normalized === "type" ||
    normalized === "style" ||
    normalized === "button type" ||
    normalized === "button style"
  ) {
    return "variant";
  }
  if (normalized === "disabled") {
    return "disabled";
  }
  if (normalized.includes("color") || normalized === "theme") {
    return "color";
  }
  return normalized;
};

export const normalizeVariantValue = (value: string): string => {
  return value.trim().replace(/[#*]+$/g, "").trim();
};

export const toSortedVariantProperties = (input: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
};

export const extractVariantNameProperties = (name: string | undefined): Record<string, string> => {
  if (typeof name !== "string") {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const chunk of name.split(",")) {
    const equalsIndex = chunk.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const rawKey = chunk.slice(0, equalsIndex).trim();
    const rawValue = chunk.slice(equalsIndex + 1).trim();
    const key = normalizeVariantKey(rawKey);
    const value = normalizeVariantValue(rawValue);
    if (!key || value.length === 0) {
      continue;
    }
    parsed[key] = value;
  }
  return parsed;
};

export const extractVariantPropertiesFromComponentProperties = (
  componentProperties: FigmaNode["componentProperties"]
): Record<string, string> => {
  if (!componentProperties) {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const [rawKey, propertyValue] of Object.entries(componentProperties)) {
    const propertyType = typeof propertyValue.type === "string" ? propertyValue.type.trim().toUpperCase() : "";
    if (propertyType !== "VARIANT") {
      continue;
    }
    if (typeof propertyValue.value !== "string") {
      continue;
    }
    const key = normalizeVariantKey(rawKey);
    const value = normalizeVariantValue(propertyValue.value);
    if (!key || value.length === 0) {
      continue;
    }
    parsed[key] = value;
  }
  return parsed;
};

export const toVariantState = (value: string | undefined): VariantElementState | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "");
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("disabled")) {
    return "disabled";
  }
  if (normalized.includes("hover")) {
    return "hover";
  }
  if (normalized.includes("active") || normalized.includes("pressed")) {
    return "active";
  }
  if (normalized.includes("default") || normalized.includes("enabled") || normalized.includes("rest")) {
    return "default";
  }
  return undefined;
};

export const toMuiVariant = (value: string | undefined): VariantMuiProps["variant"] => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "");
  if (normalized.includes("outlined")) {
    return "outlined";
  }
  if (normalized.includes("contained") || normalized.includes("filled")) {
    return "contained";
  }
  if (normalized.includes("text")) {
    return "text";
  }
  return undefined;
};

export const toMuiSize = (value: string | undefined): VariantMuiProps["size"] => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("large") || normalized === "lg" || normalized === "l") {
    return "large";
  }
  if (
    normalized.includes("small") ||
    normalized.includes("extra small") ||
    normalized === "sm" ||
    normalized === "s" ||
    normalized === "xs"
  ) {
    return "small";
  }
  if (normalized.includes("medium") || normalized === "md" || normalized === "m" || normalized === "default") {
    return "medium";
  }
  return undefined;
};

export const toMuiColor = (value: string | undefined): VariantMuiProps["color"] => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, "")
    .replace(/\s+/g, "");
  if (normalized === "primary" || normalized === "default") {
    return "primary";
  }
  if (normalized === "secondary") {
    return "secondary";
  }
  if (normalized === "error" || normalized === "danger" || normalized === "destructive") {
    return "error";
  }
  if (normalized === "info") {
    return "info";
  }
  if (normalized === "success") {
    return "success";
  }
  if (normalized === "warning") {
    return "warning";
  }
  if (normalized === "inherit") {
    return "inherit";
  }
  return undefined;
};

export const resolveMuiPropsFromVariantProperties = ({
  properties,
  state
}: {
  properties: Record<string, string>;
  state: VariantElementState | undefined;
}): VariantMuiProps => {
  const muiProps: VariantMuiProps = {};
  const variant = toMuiVariant(properties.variant);
  if (variant) {
    muiProps.variant = variant;
  }
  const size = toMuiSize(properties.size);
  if (size) {
    muiProps.size = size;
  }
  const color = toMuiColor(properties.color);
  if (color) {
    muiProps.color = color;
  }
  if (state === "disabled") {
    muiProps.disabled = true;
    return muiProps;
  }
  const disabledProperty = properties.disabled;
  if (typeof disabledProperty === "string" && isTruthyVariantFlag(disabledProperty)) {
    muiProps.disabled = true;
  }
  return muiProps;
};

export const inferVariantSignalsFromNamePath = (
  name: string | undefined
): { state?: VariantElementState; variant?: string; size?: string; color?: string } => {
  if (typeof name !== "string") {
    return {};
  }
  const segments = name
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);

  const result: { state?: VariantElementState; variant?: string; size?: string; color?: string } = {};

  for (const segment of segments) {
    if (!result.state) {
      const state = toVariantState(segment);
      if (state) {
        result.state = state;
      }
    }
    if (!result.variant) {
      const variant = toMuiVariant(segment);
      if (variant) {
        result.variant = variant;
      }
    }
    if (!result.size) {
      const size = toMuiSize(segment);
      if (size) {
        result.size = segment;
      }
    }
    if (!result.color) {
      const color = toMuiColor(segment);
      if (color) {
        result.color = segment;
      }
    }
  }

  return result;
};

export const extractVariantDataFromNode = (node: FigmaNode): NormalizedVariantData | undefined => {
  const properties = {
    ...extractVariantNameProperties(node.name),
    ...extractVariantPropertiesFromComponentProperties(node.componentProperties)
  };

  const namePathSignals = inferVariantSignalsFromNamePath(node.name);

  if (!properties.state && namePathSignals.state) {
    properties.state = namePathSignals.state;
  }
  if (!properties.variant && namePathSignals.variant) {
    properties.variant = namePathSignals.variant;
  }
  if (!properties.size && namePathSignals.size) {
    properties.size = namePathSignals.size;
  }
  if (!properties.color && namePathSignals.color) {
    properties.color = namePathSignals.color;
  }

  const stateFromProperties = toVariantState(properties.state);
  const state = stateFromProperties ?? (typeof properties.disabled === "string" && isTruthyVariantFlag(properties.disabled) ? "disabled" : undefined);
  const sortedProperties = toSortedVariantProperties(properties);
  const muiProps = resolveMuiPropsFromVariantProperties({
    properties: sortedProperties,
    state
  });
  if (Object.keys(sortedProperties).length === 0 && Object.keys(muiProps).length === 0 && !state) {
    return undefined;
  }

  const result: NormalizedVariantData = {
    properties: sortedProperties,
    muiProps,
    ...(state ? { state } : {})
  };

  if (state && state !== "default") {
    const nodeStyle = extractVariantStyleFromNode(node);
    if (Object.keys(nodeStyle).length > 0) {
      result.stateOverrides = { [state]: nodeStyle };
    }
  }

  return result;
};

export const extractDefaultVariantProperties = (
  componentPropertyDefinitions: FigmaNode["componentPropertyDefinitions"]
): Record<string, string> => {
  if (!componentPropertyDefinitions) {
    return {};
  }
  const properties: Record<string, string> = {};
  for (const [rawKey, definition] of Object.entries(componentPropertyDefinitions)) {
    const definitionType = typeof definition.type === "string" ? definition.type.trim().toUpperCase() : "";
    if (definitionType !== "VARIANT") {
      continue;
    }
    if (typeof definition.defaultValue !== "string") {
      continue;
    }
    const key = normalizeVariantKey(rawKey);
    const value = normalizeVariantValue(definition.defaultValue);
    if (!key || value.length === 0) {
      continue;
    }
    properties[key] = value;
  }
  return properties;
};

export const extractFirstTextFillColor = (node: FigmaNode): string | undefined => {
  if (node.type === "TEXT") {
    const textFill = resolveFirstVisibleSolidPaint(node.fills);
    const textColor = toHexColor(textFill?.color, textFill?.opacity);
    if (textColor) {
      return textColor;
    }
  }
  for (const child of node.children ?? []) {
    const childColor = extractFirstTextFillColor(child);
    if (childColor) {
      return childColor;
    }
  }
  return undefined;
};

export const extractVariantStyleFromNode = (node: FigmaNode): VariantStateStyle => {
  const fill = resolveFirstVisibleSolidPaint(node.fills);
  const stroke = resolveFirstVisibleSolidPaint(node.strokes);
  const style: VariantStateStyle = {};
  const backgroundColor = toHexColor(fill?.color, fill?.opacity);
  if (backgroundColor) {
    style.backgroundColor = backgroundColor;
  }
  const borderColor = toHexColor(stroke?.color, stroke?.opacity);
  if (borderColor) {
    style.borderColor = borderColor;
  }
  const textColor = extractFirstTextFillColor(node);
  if (textColor) {
    style.color = textColor;
  }
  return style;
};

export const buildComponentSetVariantCandidate = (node: FigmaNode): ComponentSetVariantCandidate => {
  const variantData = extractVariantDataFromNode(node);
  return {
    node,
    properties: variantData?.properties ?? {},
    muiProps: variantData?.muiProps ?? {},
    ...(variantData?.state ? { state: variantData.state } : {}),
    style: extractVariantStyleFromNode(node)
  };
};

const valuesEqualIgnoreCase = (left: string | undefined, right: string | undefined): boolean => {
  if (!left || !right) {
    return false;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
};

export const resolveDefaultVariantCandidate = ({
  candidates,
  defaultProperties
}: {
  candidates: ComponentSetVariantCandidate[];
  defaultProperties: Record<string, string>;
}): ComponentSetVariantCandidate | undefined => {
  if (candidates.length === 0) {
    return undefined;
  }

  const stateDefaultCandidate = candidates.find((candidate) => candidate.state === "default");
  if (stateDefaultCandidate) {
    return stateDefaultCandidate;
  }

  if (Object.keys(defaultProperties).length > 0) {
    const propertyDefaultCandidate = candidates.find((candidate) => {
      return Object.entries(defaultProperties).every(([key, value]) => valuesEqualIgnoreCase(candidate.properties[key], value));
    });
    if (propertyDefaultCandidate) {
      return propertyDefaultCandidate;
    }
  }

  return candidates[0];
};

export const scoreVariantSimilarity = ({
  candidate,
  base
}: {
  candidate: ComponentSetVariantCandidate;
  base: ComponentSetVariantCandidate;
}): number => {
  const keys = new Set<string>([...Object.keys(candidate.properties), ...Object.keys(base.properties)]);
  let score = 0;
  for (const key of keys) {
    if (key === "state") {
      continue;
    }
    const candidateValue = candidate.properties[key];
    const baseValue = base.properties[key];
    if (candidateValue && baseValue && valuesEqualIgnoreCase(candidateValue, baseValue)) {
      score += 2;
      continue;
    }
    if (candidateValue && baseValue && !valuesEqualIgnoreCase(candidateValue, baseValue)) {
      score -= 1;
    }
  }
  return score;
};

export const diffVariantStyle = ({
  candidateStyle,
  baseStyle
}: {
  candidateStyle: VariantStateStyle;
  baseStyle: VariantStateStyle;
}): VariantStateStyle => {
  const style: VariantStateStyle = {};
  if (candidateStyle.backgroundColor && !valuesEqualIgnoreCase(candidateStyle.backgroundColor, baseStyle.backgroundColor)) {
    style.backgroundColor = candidateStyle.backgroundColor;
  }
  if (candidateStyle.borderColor && !valuesEqualIgnoreCase(candidateStyle.borderColor, baseStyle.borderColor)) {
    style.borderColor = candidateStyle.borderColor;
  }
  if (candidateStyle.color && !valuesEqualIgnoreCase(candidateStyle.color, baseStyle.color)) {
    style.color = candidateStyle.color;
  }
  return style;
};

export const toComponentSetVariantMapping = (node: FigmaNode): VariantMappingIR | undefined => {
  const visibleChildren = (node.children ?? []).filter((child) => child.visible !== false);
  if (visibleChildren.length === 0) {
    return extractVariantDataFromNode(node);
  }

  const candidates = visibleChildren.map((child) => buildComponentSetVariantCandidate(child));
  const hasVariantSignals = candidates.some((candidate) => {
    return Object.keys(candidate.properties).length > 0 || Object.keys(candidate.muiProps).length > 0 || candidate.state !== undefined;
  });
  if (!hasVariantSignals) {
    return undefined;
  }

  const defaultProperties = extractDefaultVariantProperties(node.componentPropertyDefinitions);
  const defaultCandidate =
    resolveDefaultVariantCandidate({
      candidates,
      defaultProperties
    }) ?? candidates[0];
  if (!defaultCandidate) {
    return undefined;
  }

  const stateSnapshots: VariantStateSnapshot[] = candidates.map((candidate) => ({
    nodeId: candidate.node.id,
    properties: toSortedVariantProperties(candidate.properties),
    muiProps: candidate.muiProps,
    style: candidate.style,
    isDefault: candidate.node.id === defaultCandidate.node.id,
    ...(candidate.state ? { state: candidate.state } : {})
  }));

  const stateOverrides: NonNullable<VariantMappingIR["stateOverrides"]> = {};
  for (const state of ["hover", "active", "disabled"] as Array<"hover" | "active" | "disabled">) {
    const stateCandidates = candidates
      .map((candidate, index) => ({
        candidate,
        index,
        score: scoreVariantSimilarity({
          candidate,
          base: defaultCandidate
        })
      }))
      .filter((entry) => entry.candidate.state === state)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = stateCandidates[0]?.candidate;
    if (!best) {
      continue;
    }
    const styleDiff = diffVariantStyle({
      candidateStyle: best.style,
      baseStyle: defaultCandidate.style
    });
    if (Object.keys(styleDiff).length > 0) {
      stateOverrides[state] = styleDiff;
    }
  }

  return {
    properties: toSortedVariantProperties(defaultCandidate.properties),
    muiProps: defaultCandidate.muiProps,
    ...(defaultCandidate.state ? { state: defaultCandidate.state } : {}),
    defaultVariantNodeId: defaultCandidate.node.id,
    states: stateSnapshots,
    ...(Object.keys(stateOverrides).length > 0 ? { stateOverrides } : {})
  };
};

const toPlaceholderRuleSet = (values: string[] | undefined): Set<string> => {
  const normalizedValues = (values ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizePlaceholderText({ value }))
    .filter((value) => value.length > 0);
  return new Set(normalizedValues);
};

export const resolvePlaceholderMatcherConfig = (
  rules: { allowlist?: string[]; blocklist?: string[] } | undefined
): PlaceholderMatcherConfig => {
  return {
    allowlist: toPlaceholderRuleSet(rules?.allowlist),
    blocklist: toPlaceholderRuleSet(rules?.blocklist)
  };
};

export const classifyPlaceholderText = ({
  text,
  matcher
}: {
  text: string | undefined;
  matcher: PlaceholderMatcherConfig;
}): "none" | "technical" | "generic" => {
  if (typeof text !== "string") {
    return "none";
  }
  const normalized = normalizePlaceholderText({ value: text });
  if (!normalized) {
    return "none";
  }
  if (matcher.allowlist.has(normalized)) {
    return "none";
  }
  if (isTechnicalPlaceholderText({ text })) {
    return "technical";
  }
  if (matcher.blocklist.has(normalized)) {
    return "generic";
  }
  if (GENERIC_PLACEHOLDER_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "generic";
  }
  return "none";
};

export const classifyPlaceholderNode = ({
  node,
  matcher
}: {
  node: FigmaNode;
  matcher: PlaceholderMatcherConfig;
}): "none" | "technical" | "generic" => {
  if (node.type !== "TEXT") {
    return "none";
  }
  return classifyPlaceholderText({
    text: node.characters,
    matcher
  });
};
