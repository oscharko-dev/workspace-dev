import type { WorkspaceBrandTheme } from "../contracts/index.js";
import type {
  CounterAxisAlignItems,
  DesignIR,
  DesignTokens,
  FigmaMcpEnrichment,
  GenerationMetrics,
  PrimaryAxisAlignItems,
  VariantElementState,
  VariantMappingIR,
  VariantMuiProps,
  VariantStateSnapshot,
  VariantStateStyle,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { applySparkasseThemeDefaults } from "./sparkasse-theme.js";

const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;
const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH = 14;
const PLACEHOLDER_TEXT_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);
const DECORATIVE_NAME_PATTERN = /(icon|decor|bg|background|shape|vector|spacer|divider)/i;

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaPaint {
  type?: string;
  color?: FigmaColor;
  opacity?: number;
}

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
  styles?: Record<string, string>;
  fillStyleId?: string;
  strokeStyleId?: string;
  effectStyleId?: string;
  textStyleId?: string;
  children?: FigmaNode[];
  fillGeometry?: Array<{
    path?: string;
    windingRule?: string;
  }>;
  strokeGeometry?: Array<{
    path?: string;
    windingRule?: string;
  }>;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  characters?: string;
  style?: {
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    lineHeightPx?: number;
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT";
  };
  cornerRadius?: number;
  componentProperties?: Record<string, FigmaComponentPropertyValue>;
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
}

interface FigmaFile {
  name?: string;
  document?: FigmaNode;
  styles?: Record<
    string,
    {
      name?: string;
      styleType?: string;
      style_type?: string;
      key?: string;
      description?: string;
    }
  >;
}

type ColorSampleContext = "button" | "heading" | "body" | "surface" | "decorative";
type StyleSignalKey = "primary" | "secondary" | "background" | "text" | "brand" | "accent";

interface ColorSample {
  color: string;
  weight: number;
  context: ColorSampleContext;
  styleSignals: Record<StyleSignalKey, number>;
}

interface ColorCluster {
  color: string;
  totalWeight: number;
  channels: {
    r: number;
    g: number;
    b: number;
  };
  contexts: Record<ColorSampleContext, number>;
  styleSignals: Record<StyleSignalKey, number>;
}

interface FontSample {
  family: string;
  role: "heading" | "body";
  size: number;
  weight: number;
}

interface MetricsAccumulator {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  screenElementCounts: GenerationMetrics["screenElementCounts"];
  truncatedScreens: GenerationMetrics["truncatedScreens"];
  depthTruncatedScreens: NonNullable<GenerationMetrics["depthTruncatedScreens"]>;
  degradedGeometryNodes: string[];
}

interface FigmaToIrOptions {
  mcpEnrichment?: FigmaMcpEnrichment;
  screenElementBudget?: number;
  screenElementMaxDepth?: number;
  brandTheme?: WorkspaceBrandTheme;
  sourceMetrics?: {
    fetchedNodes?: number;
    degradedGeometryNodes?: string[];
  };
}

const toHexColor = (color?: FigmaColor, opacity?: number): string | undefined => {
  if (!color) {
    return undefined;
  }

  const alpha = typeof opacity === "number" ? opacity : (color.a ?? 1);
  if (alpha <= 0) {
    return undefined;
  }

  const blendOnWhite = (channel: number): number => {
    if (alpha >= 1) {
      return channel;
    }
    return channel * alpha + (1 - alpha);
  };

  const toHex = (value: number): string => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(blendOnWhite(color.r))}${toHex(blendOnWhite(color.g))}${toHex(blendOnWhite(color.b))}`;
};

const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return { r, g, b };
};

const luminance = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const relativeLuminance = (hex: string): number => {
  const transform = (value: number): number => {
    if (value <= 0.03928) {
      return value / 12.92;
    }
    return ((value + 0.055) / 1.055) ** 2.4;
  };

  const { r, g, b } = parseHex(hex);
  const rl = transform(r);
  const gl = transform(g);
  const bl = transform(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
};

const contrastRatio = (first: string, second: string): number => {
  const left = relativeLuminance(first);
  const right = relativeLuminance(second);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
};

const saturation = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    return 0;
  }
  const lightness = (max + min) / 2;
  if (lightness <= 0.5) {
    return (max - min) / (max + min);
  }
  return (max - min) / (2 - max - min);
};

const colorDistance = (leftHex: string, rightHex: string): number => {
  const left = parseHex(leftHex);
  const right = parseHex(rightHex);
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const toHexFromChannel = (value: number): string => {
  const normalized = clamp(Math.round(value), 0, 255);
  return normalized.toString(16).padStart(2, "0");
};

const toHexFromRgb = (red: number, green: number, blue: number): string => {
  return `#${toHexFromChannel(red)}${toHexFromChannel(green)}${toHexFromChannel(blue)}`;
};

const quantizeColorKey = (hex: string, step: number): string => {
  const normalized = hex.replace("#", "");
  const parseChannel = (start: number): number => {
    const channel = Number.parseInt(normalized.slice(start, start + 2), 16);
    if (!Number.isFinite(channel)) {
      return 0;
    }
    const quantized = Math.round(channel / step) * step;
    return clamp(quantized, 0, 255);
  };
  return toHexFromRgb(parseChannel(0), parseChannel(2), parseChannel(4));
};

const median = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  const lower = sorted[midpoint - 1];
  const upper = sorted[midpoint];
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  return (lower + upper) / 2;
};

const weightedMedian = (samples: Array<{ value: number; weight: number }>): number | undefined => {
  const filtered = samples.filter((sample) => Number.isFinite(sample.value) && Number.isFinite(sample.weight) && sample.weight > 0);
  if (filtered.length === 0) {
    return undefined;
  }
  const sorted = [...filtered].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const threshold = totalWeight / 2;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= threshold) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1]?.value;
};

const normalizeFontStack = (families: string[]): string => {
  const tokens = families
    .flatMap((family) => family.split(","))
    .map((family) => family.trim())
    .filter((family) => family.length > 0);

  const unique: string[] = [];
  for (const token of tokens) {
    if (unique.some((entry) => entry.toLowerCase() === token.toLowerCase())) {
      continue;
    }
    unique.push(token);
  }

  if (!unique.some((entry) => /roboto/i.test(entry))) {
    unique.push("Roboto");
  }
  if (!unique.some((entry) => /arial/i.test(entry))) {
    unique.push("Arial");
  }
  if (!unique.some((entry) => /sans-serif/i.test(entry))) {
    unique.push("sans-serif");
  }

  return unique.join(", ");
};

const emptyStyleSignals = (): Record<StyleSignalKey, number> => ({
  primary: 0,
  secondary: 0,
  background: 0,
  text: 0,
  brand: 0,
  accent: 0
});

const addStyleSignals = (
  target: Record<StyleSignalKey, number>,
  signals: Record<StyleSignalKey, number>,
  multiplier = 1
): void => {
  for (const key of Object.keys(signals) as StyleSignalKey[]) {
    target[key] += signals[key] * multiplier;
  }
};

const countSubtreeNodes = (node: FigmaNode): number => {
  const children = node.children ?? [];
  if (children.length === 0) {
    return 1;
  }
  return 1 + children.reduce((count, child) => count + countSubtreeNodes(child), 0);
};

const collectNodes = (node: FigmaNode, predicate: (candidate: FigmaNode) => boolean): FigmaNode[] => {
  if (node.visible === false) {
    return [];
  }

  const collected: FigmaNode[] = [];
  if (predicate(node)) {
    collected.push(node);
  }
  if (!node.children) {
    return collected;
  }
  for (const child of node.children) {
    collected.push(...collectNodes(child, predicate));
  }
  return collected;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const hasAnySubstring = (value: string, tokens: string[]): boolean => {
  return tokens.some((token) => value.includes(token));
};

const hasAnyWord = (value: string, words: string[]): boolean => {
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(value));
};

interface NormalizedVariantData {
  properties: Record<string, string>;
  muiProps: VariantMuiProps;
  state?: VariantElementState;
}

interface ComponentSetVariantCandidate extends NormalizedVariantData {
  node: FigmaNode;
  style: VariantStateStyle;
}

const isTruthyVariantFlag = (value: string): boolean => {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, "");
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
};

const normalizeVariantKey = (key: string): string | undefined => {
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
  if (normalized === "variant" || normalized.includes(" variant")) {
    return "variant";
  }
  if (normalized === "disabled") {
    return "disabled";
  }
  if (normalized.includes("color")) {
    return "color";
  }
  return normalized;
};

const normalizeVariantValue = (value: string): string => {
  return value.trim().replace(/[#*]+$/g, "").trim();
};

const toSortedVariantProperties = (input: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
};

const extractVariantNameProperties = (name: string | undefined): Record<string, string> => {
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

const extractVariantPropertiesFromComponentProperties = (
  componentProperties: FigmaNode["componentProperties"]
): Record<string, string> => {
  if (!componentProperties) {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const [rawKey, propertyValue] of Object.entries(componentProperties)) {
    const propertyType = typeof propertyValue?.type === "string" ? propertyValue.type.trim().toUpperCase() : "";
    if (propertyType !== "VARIANT") {
      continue;
    }
    if (typeof propertyValue?.value !== "string") {
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

const toVariantState = (value: string | undefined): VariantElementState | undefined => {
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

const toMuiVariant = (value: string | undefined): VariantMuiProps["variant"] => {
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

const toMuiSize = (value: string | undefined): VariantMuiProps["size"] => {
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

const resolveMuiPropsFromVariantProperties = ({
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

const extractVariantDataFromNode = (node: FigmaNode): NormalizedVariantData | undefined => {
  const properties = {
    ...extractVariantNameProperties(node.name),
    ...extractVariantPropertiesFromComponentProperties(node.componentProperties)
  };
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
  return {
    properties: sortedProperties,
    muiProps,
    ...(state ? { state } : {})
  };
};

const extractDefaultVariantProperties = (
  componentPropertyDefinitions: FigmaNode["componentPropertyDefinitions"]
): Record<string, string> => {
  if (!componentPropertyDefinitions) {
    return {};
  }
  const properties: Record<string, string> = {};
  for (const [rawKey, definition] of Object.entries(componentPropertyDefinitions)) {
    const definitionType = typeof definition?.type === "string" ? definition.type.trim().toUpperCase() : "";
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

const extractFirstTextFillColor = (node: FigmaNode): string | undefined => {
  if (node.type === "TEXT") {
    const textFill = node.fills?.find((item) => item.type === "SOLID" && item.color);
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

const extractVariantStyleFromNode = (node: FigmaNode): VariantStateStyle => {
  const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
  const stroke = node.strokes?.find((item) => item.type === "SOLID" && item.color);
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

const buildComponentSetVariantCandidate = (node: FigmaNode): ComponentSetVariantCandidate => {
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

const resolveDefaultVariantCandidate = ({
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

const scoreVariantSimilarity = ({
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

const diffVariantStyle = ({
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

const toComponentSetVariantMapping = (node: FigmaNode): VariantMappingIR | undefined => {
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

  const states: VariantStateSnapshot[] = candidates.map((candidate) => ({
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
    ...(Object.keys(stateOverrides).length > 0 ? { stateOverrides } : {}),
    states
  };
};

const determineElementType = (node: FigmaNode): ScreenElementIR["type"] => {
  const name = (node.name ?? "").toLowerCase();
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  const childCount = node.children?.length ?? 0;
  const textChildCount = (node.children ?? []).filter((child) => child.type === "TEXT" && (child.characters ?? "").trim().length > 0).length;
  const hasChildren = childCount > 0;
  const hasSolidFill = Boolean(node.fills?.find((item) => item.type === "SOLID" && item.color));
  const hasStroke = Boolean(node.strokes?.find((item) => item.type === "SOLID" && item.color));
  const hasRoundedCorners = (node.cornerRadius ?? 0) >= 8;
  const hasListishChildNames = (node.children ?? []).some((child) => {
    const childName = (child.name ?? "").toLowerCase();
    return (
      childName.includes("listitem") ||
      childName.includes("list item") ||
      childName.includes("muilistitem") ||
      childName.includes("navigationaction")
    );
  });
  const hasInputSemantic = hasAnySubstring(name, [
    "muiformcontrolroot",
    "textfield",
    "input field",
    "muioutlinedinputroot",
    "muioutlinedinputinput",
    "muiinputadornmentroot",
    "muiselectselect",
    "muiinputbaseroot",
    "muiinputbaseinput",
    "muiinputroot",
    "formcontrol"
  ]);
  const isFieldSized = width >= 96 && height >= 28 && height <= 140;
  const isLikelyDividerByGeometry =
    !hasChildren && hasSolidFill && ((width >= 16 && height > 0 && height <= 2) || (height >= 16 && width > 0 && width <= 2));
  const hasButtonLabelHint =
    name.includes("zur übersicht") || name.includes("termin vereinbaren") || name.includes("zum finanzierungsplaner");
  const hasButtonKeyword = hasAnySubstring(name, ["muibutton", "buttonbase", "button", "cta"]);
  const hasStrongImageName = hasAnyWord(name, ["image", "photo", "illustration", "hero", "banner"]);

  if (node.type === "TEXT") {
    return "text";
  }

  if ((hasInputSemantic || hasAnyWord(name, ["input", "textfield", "select"])) && (isFieldSized || hasChildren)) {
    return "input";
  }

  if (hasAnySubstring(name, ["muiswitch", "switchbase"]) || hasAnyWord(name, ["switch", "toggle"])) {
    return "switch";
  }

  if (hasAnySubstring(name, ["muicheckbox"]) || hasAnyWord(name, ["checkbox"])) {
    return "checkbox";
  }

  if (hasAnySubstring(name, ["muiradio"]) || hasAnyWord(name, ["radio"])) {
    return "radio";
  }

  if (hasAnySubstring(name, ["muichip"]) || hasAnyWord(name, ["chip"])) {
    return "chip";
  }

  if (hasAnySubstring(name, ["muitabs", "muitab"]) || hasAnyWord(name, ["tab", "tabs"])) {
    return "tab";
  }

  if (
    hasAnySubstring(name, ["muicircularprogress", "muilinearprogress", "circularprogress", "linearprogress", "progressbar"]) ||
    hasAnyWord(name, ["progress", "loader", "loading", "spinner"])
  ) {
    return "progress";
  }

  if (hasAnySubstring(name, ["muiavatar"]) || hasAnyWord(name, ["avatar"])) {
    return "avatar";
  }

  if (hasAnySubstring(name, ["muibadge"]) || hasAnyWord(name, ["badge"])) {
    return "badge";
  }

  if (hasAnySubstring(name, ["muidivider", "separator"]) || hasAnyWord(name, ["divider"]) || isLikelyDividerByGeometry) {
    return "divider";
  }

  if (hasAnySubstring(name, ["muiappbar", "topbar"]) || hasAnyWord(name, ["appbar", "app bar", "toolbar"])) {
    return "appbar";
  }

  if (
    hasAnySubstring(name, ["bottomnavigation", "navigationbar", "muitabbar"]) ||
    hasAnyWord(name, ["navigation", "navbar"])
  ) {
    return "navigation";
  }

  if (hasAnySubstring(name, ["muidialog", "modal"]) || hasAnyWord(name, ["dialog", "modal"])) {
    return "dialog";
  }

  if (hasAnySubstring(name, ["muistepper"]) || hasAnyWord(name, ["stepper"])) {
    return "stepper";
  }

  const isLikelyListByStructure =
    !hasSolidFill && childCount >= 3 && textChildCount >= 2 && (node.layoutMode === "VERTICAL" || node.layoutMode === "NONE");
  if (
    hasAnySubstring(name, ["muilist", "listitem", "muilistitem"]) ||
    hasAnyWord(name, ["list"]) ||
    hasListishChildNames ||
    isLikelyListByStructure
  ) {
    return "list";
  }

  if (hasAnySubstring(name, ["muicard"]) || hasAnyWord(name, ["card"])) {
    return "card";
  }

  if (hasChildren && hasSolidFill && hasRoundedCorners && width >= 120 && height >= 80) {
    return "card";
  }

  if (name.includes("cta") || (hasButtonKeyword && (hasSolidFill || hasStroke || hasRoundedCorners || hasButtonLabelHint))) {
    return "button";
  }

  if ((node.type === "RECTANGLE" || node.type === "FRAME") && hasStrongImageName && !hasChildren) {
    return "image";
  }

  return "container";
};

const mapPadding = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } => {
  return {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0
  };
};

const hasPlaceholderText = (node: FigmaNode): boolean => {
  if (node.type !== "TEXT") {
    return false;
  }
  const normalized = (node.characters ?? "").trim().toLowerCase();
  return PLACEHOLDER_TEXT_VALUES.has(normalized);
};

const isGeometryEmpty = (node: FigmaNode): boolean => {
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  return width <= 0 || height <= 0;
};

const isHelperItemNode = (node: FigmaNode): boolean => {
  const normalized = (node.name ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "_item" ||
    normalized.startsWith("_item ") ||
    normalized.startsWith("item_") ||
    normalized.endsWith("_item")
  );
};

const DEPTH_SEMANTIC_TYPES = new Set<ScreenElementIR["type"]>([
  "text",
  "button",
  "input",
  "switch",
  "checkbox",
  "radio",
  "tab",
  "navigation",
  "stepper"
]);
const DEPTH_SEMANTIC_NAME_HINTS = [
  "button",
  "cta",
  "input",
  "textfield",
  "form",
  "switch",
  "checkbox",
  "radio",
  "tab",
  "navigation",
  "stepper",
  "accordion",
  "table"
];

interface DepthAnalysis {
  nodeCountByDepth: Map<number, number>;
  semanticCountByDepth: Map<number, number>;
  subtreeHasSemanticById: Map<string, boolean>;
}

interface ScreenDepthBudgetContext {
  screenElementBudget: number;
  configuredMaxDepth: number;
  mappedElementCount: number;
  nodeCountByDepth: Map<number, number>;
  semanticCountByDepth: Map<number, number>;
  subtreeHasSemanticById: Map<string, boolean>;
  truncatedBranchCount: number;
  firstTruncatedDepth?: number;
}

const hasMeaningfulNodeText = (node: FigmaNode): boolean => {
  const normalized = (node.characters ?? "").trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_TEXT_VALUES.has(normalized);
};

const isDepthSemanticNode = (node: FigmaNode): boolean => {
  if (node.visible === false) {
    return false;
  }
  if (node.type === "TEXT") {
    return hasMeaningfulNodeText(node);
  }
  const semanticType = determineElementType(node);
  if (DEPTH_SEMANTIC_TYPES.has(semanticType)) {
    return true;
  }
  const loweredName = (node.name ?? "").toLowerCase();
  return hasAnySubstring(loweredName, DEPTH_SEMANTIC_NAME_HINTS);
};

const analyzeDepthPressure = (nodes: FigmaNode[]): DepthAnalysis => {
  const nodeCountByDepth = new Map<number, number>();
  const semanticCountByDepth = new Map<number, number>();
  const subtreeHasSemanticById = new Map<string, boolean>();

  const visit = (node: FigmaNode, depth: number): boolean => {
    if (node.visible === false) {
      return false;
    }

    nodeCountByDepth.set(depth, (nodeCountByDepth.get(depth) ?? 0) + 1);

    const selfSemantic = isDepthSemanticNode(node);
    if (selfSemantic) {
      semanticCountByDepth.set(depth, (semanticCountByDepth.get(depth) ?? 0) + 1);
    }

    let childSemantic = false;
    for (const child of node.children ?? []) {
      childSemantic = visit(child, depth + 1) || childSemantic;
    }

    const hasSemanticSubtree = selfSemantic || childSemantic;
    subtreeHasSemanticById.set(node.id, hasSemanticSubtree);
    return hasSemanticSubtree;
  };

  for (const node of nodes) {
    visit(node, 0);
  }

  return {
    nodeCountByDepth,
    semanticCountByDepth,
    subtreeHasSemanticById
  };
};

const shouldTruncateChildrenByDepth = ({
  node,
  depth,
  elementType,
  context
}: {
  node: FigmaNode;
  depth: number;
  elementType: ScreenElementIR["type"];
  context: ScreenDepthBudgetContext;
}): boolean => {
  if (!node.children?.length) {
    return false;
  }

  const nextDepth = depth + 1;
  const remainingBudget = Math.max(0, context.screenElementBudget - context.mappedElementCount);
  const nodeCountAtDepth = context.nodeCountByDepth.get(nextDepth) ?? 0;
  const semanticCountAtDepth = context.semanticCountByDepth.get(nextDepth) ?? 0;
  const subtreeHasSemantic = context.subtreeHasSemanticById.get(node.id) ?? false;
  const semanticRelevant = DEPTH_SEMANTIC_TYPES.has(elementType) || subtreeHasSemantic;
  const semanticDensityAtDepth = nodeCountAtDepth > 0 ? semanticCountAtDepth / nodeCountAtDepth : 0;

  if (nextDepth <= context.configuredMaxDepth) {
    const pressureMultiplier = semanticDensityAtDepth > 0.25 ? 6 : 4;
    const highPressureCutoff = remainingBudget > 0 && nodeCountAtDepth > Math.max(remainingBudget * pressureMultiplier, 32);
    return highPressureCutoff && !semanticRelevant;
  }

  if (remainingBudget <= 0) {
    return true;
  }
  if (!semanticRelevant) {
    return true;
  }

  const allowedSemanticDepthWidth = Math.max(remainingBudget * (semanticDensityAtDepth > 0.15 ? 3 : 2), 12);
  return nodeCountAtDepth > allowedSemanticDepthWidth;
};

const mapElement = ({
  node,
  depth,
  inInstanceContext,
  metrics,
  depthContext
}: {
  node: FigmaNode;
  depth: number;
  inInstanceContext: boolean;
  metrics: MetricsAccumulator;
  depthContext: ScreenDepthBudgetContext;
}): ScreenElementIR | null => {
  if (node.visible === false) {
    metrics.skippedHidden += countSubtreeNodes(node);
    return null;
  }

  if (inInstanceContext && hasPlaceholderText(node)) {
    metrics.skippedPlaceholders += 1;
    return null;
  }

  if (isHelperItemNode(node) && isGeometryEmpty(node)) {
    metrics.skippedPlaceholders += countSubtreeNodes(node);
    return null;
  }

  const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
  const stroke = node.strokes?.find((item) => item.type === "SOLID" && item.color);
  const vectorPaths = [...(node.fillGeometry ?? []), ...(node.strokeGeometry ?? [])]
    .map((item) => item.path)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const elementType = determineElementType(node);
  const variantMapping = node.type === "COMPONENT_SET" ? toComponentSetVariantMapping(node) : extractVariantDataFromNode(node);
  const element: ScreenElementIR = {
    id: node.id,
    name: node.name ?? node.type,
    nodeType: node.type,
    type: elementType,
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    padding: mapPadding(node),
    ...(variantMapping ? { variantMapping } : {}),
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };

  if (node.characters !== undefined) {
    element.text = node.characters;
  }
  if (node.absoluteBoundingBox?.x !== undefined) {
    element.x = node.absoluteBoundingBox.x;
  }
  if (node.absoluteBoundingBox?.y !== undefined) {
    element.y = node.absoluteBoundingBox.y;
  }
  if (node.absoluteBoundingBox?.width !== undefined) {
    element.width = node.absoluteBoundingBox.width;
  }
  if (node.absoluteBoundingBox?.height !== undefined) {
    element.height = node.absoluteBoundingBox.height;
  }

  const fillColor = toHexColor(fill?.color, fill?.opacity);
  if (fillColor) {
    element.fillColor = fillColor;
  }
  const strokeColor = toHexColor(stroke?.color, stroke?.opacity);
  if (strokeColor) {
    element.strokeColor = strokeColor;
  }
  if (node.strokeWeight !== undefined) {
    element.strokeWidth = node.strokeWeight;
  }
  if (node.style?.fontSize !== undefined) {
    element.fontSize = node.style.fontSize;
  }
  if (node.style?.fontWeight !== undefined) {
    element.fontWeight = node.style.fontWeight;
  }
  if (node.style?.fontFamily !== undefined) {
    element.fontFamily = node.style.fontFamily;
  }
  if (node.style?.lineHeightPx !== undefined) {
    element.lineHeight = node.style.lineHeightPx;
  }
  if (node.style?.textAlignHorizontal !== undefined) {
    element.textAlign = node.style.textAlignHorizontal;
  }
  if (vectorPaths.length > 0) {
    element.vectorPaths = vectorPaths;
  }
  if (node.cornerRadius !== undefined) {
    element.cornerRadius = node.cornerRadius;
  }
  depthContext.mappedElementCount += 1;

  const isNextInstanceContext = inInstanceContext || node.type === "INSTANCE" || node.type === "COMPONENT_SET";

  if (node.type === "COMPONENT_SET") {
    const visibleChildren = (node.children ?? []).filter((child) => child.visible !== false);
    const defaultVariantNodeId = element.variantMapping?.defaultVariantNodeId;
    const defaultVariantNode =
      (defaultVariantNodeId ? visibleChildren.find((child) => child.id === defaultVariantNodeId) : undefined) ??
      visibleChildren[0];
    if (!defaultVariantNode) {
      return element;
    }

    if (shouldTruncateChildrenByDepth({ node, depth, elementType, context: depthContext })) {
      element.children = [];
      const nextDepth = depth + 1;
      depthContext.truncatedBranchCount += 1;
      depthContext.firstTruncatedDepth =
        depthContext.firstTruncatedDepth === undefined
          ? nextDepth
          : Math.min(depthContext.firstTruncatedDepth, nextDepth);
      return element;
    }

    const mappedDefault = mapElement({
      node: defaultVariantNode,
      depth: depth + 1,
      inInstanceContext: isNextInstanceContext,
      metrics,
      depthContext
    });
    if (mappedDefault) {
      element.children = [mappedDefault];
    }
    return element;
  }

  if (shouldTruncateChildrenByDepth({ node, depth, elementType, context: depthContext })) {
    element.children = [];
    const nextDepth = depth + 1;
    depthContext.truncatedBranchCount += 1;
    depthContext.firstTruncatedDepth =
      depthContext.firstTruncatedDepth === undefined
        ? nextDepth
        : Math.min(depthContext.firstTruncatedDepth, nextDepth);
  } else if (node.children?.length) {
    const children: ScreenElementIR[] = [];
    for (const child of node.children) {
      const mappedChild = mapElement({
        node: child,
        depth: depth + 1,
        inInstanceContext: isNextInstanceContext,
        metrics,
        depthContext
      });
      if (mappedChild) {
        children.push(mappedChild);
      }
    }
    if (children.length > 0) {
      element.children = children;
    }
  }

  return element;
};

const isScreenLikeNode = (node: FigmaNode | undefined): node is FigmaNode => {
  if (!node || node.visible === false) {
    return false;
  }
  return node.type === "FRAME" || node.type === "COMPONENT";
};

const isGenericFrameName = (name: string | undefined): boolean => {
  if (!name) {
    return true;
  }
  const normalized = name.trim();
  if (!normalized) {
    return true;
  }
  return /^t\d+$/i.test(normalized) || /^frame\s*\d*$/i.test(normalized) || /^group\s*\d*$/i.test(normalized);
};

const unwrapScreenRoot = (candidate: FigmaNode): { node: FigmaNode; name: string } => {
  let current = candidate;
  const preferredName = candidate.name ?? `Screen_${candidate.id}`;

  for (let depth = 0; depth < 4; depth += 1) {
    if (!current.children || current.children.length !== 1) {
      break;
    }

    const child = current.children[0];
    if (!isScreenLikeNode(child)) {
      break;
    }

    const parentWidth = current.absoluteBoundingBox?.width ?? 0;
    const childWidth = child.absoluteBoundingBox?.width ?? 0;
    const parentHeight = current.absoluteBoundingBox?.height ?? 0;
    const childHeight = child.absoluteBoundingBox?.height ?? 0;

    const hasCenteringPadding =
      (current.paddingLeft ?? 0) > 0 ||
      (current.paddingRight ?? 0) > 0 ||
      (current.paddingTop ?? 0) > 0 ||
      (current.paddingBottom ?? 0) > 0;
    const isVisiblySmallerChild =
      parentWidth > 0 &&
      childWidth > 0 &&
      parentHeight > 0 &&
      childHeight > 0 &&
      (childWidth / parentWidth < 0.95 || childHeight / parentHeight < 0.95);
    const childLooksGeneric = isGenericFrameName(child.name);

    if (!hasCenteringPadding && !isVisiblySmallerChild && !childLooksGeneric) {
      break;
    }

    current = child;
  }

  const resolvedName = isGenericFrameName(current.name) ? preferredName : (current.name ?? preferredName);
  return { node: current, name: resolvedName };
};

const collectSectionScreens = ({
  section,
  metrics
}: {
  section: FigmaNode;
  metrics: MetricsAccumulator;
}): FigmaNode[] => {
  const screens: FigmaNode[] = [];

  for (const child of section.children ?? []) {
    if (child.visible === false) {
      metrics.skippedHidden += countSubtreeNodes(child);
      continue;
    }

    if (child.type === "SECTION") {
      screens.push(...collectSectionScreens({ section: child, metrics }));
      continue;
    }

    if (child.type === "FRAME" || child.type === "COMPONENT") {
      screens.push(child);
    }
  }

  return screens;
};

const countElements = (elements: ScreenElementIR[]): number => {
  let total = 0;
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    total += 1;
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return total;
};

interface TruncationCandidate {
  id: string;
  ancestorIds: string[];
  depth: number;
  traversalIndex: number;
  area: number;
  score: number;
  mustKeep: boolean;
}

const hasMeaningfulTextContent = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_TEXT_VALUES.has(normalized);
};

const hasVisualSubstance = (element: ScreenElementIR): boolean => {
  const hasPadding = element.padding
    ? element.padding.top + element.padding.right + element.padding.bottom + element.padding.left > 0
    : false;

  return (
    typeof element.fillColor === "string" ||
    typeof element.strokeColor === "string" ||
    (typeof element.strokeWidth === "number" && element.strokeWidth > 0) ||
    (typeof element.cornerRadius === "number" && element.cornerRadius > 0) ||
    (typeof element.gap === "number" && element.gap > 0) ||
    hasPadding ||
    (element.vectorPaths?.length ?? 0) > 0
  );
};

const resolveElementBasePriority = (type: ScreenElementIR["type"]): number => {
  switch (type) {
    case "button":
    case "input":
    case "switch":
    case "checkbox":
    case "radio":
    case "tab":
    case "navigation":
    case "stepper":
      return 100;
    case "text":
    case "list":
    case "dialog":
    case "appbar":
    case "card":
      return 70;
    case "chip":
    case "avatar":
    case "badge":
    case "progress":
    case "image":
      return 55;
    case "container":
      return 35;
    case "divider":
      return 20;
    default:
      return 35;
  }
};

const resolveElementArea = (element: ScreenElementIR): number => {
  if (
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0 &&
    typeof element.height === "number" &&
    Number.isFinite(element.height) &&
    element.height > 0
  ) {
    return Math.max(1, element.width * element.height);
  }
  return 1;
};

const resolveTruncationPriority = (
  element: ScreenElementIR
): {
  score: number;
  mustKeep: boolean;
} => {
  const basePriority = resolveElementBasePriority(element.type);
  const meaningfulText = hasMeaningfulTextContent(element.text);
  const visualSubstance = hasVisualSubstance(element);
  const childCount = element.children?.length ?? 0;
  const isDecorativeName = DECORATIVE_NAME_PATTERN.test(element.name);
  const emptyDecorative = childCount === 0 && !meaningfulText && !visualSubstance;
  let score = basePriority;

  if (meaningfulText) {
    score += 20;
  }
  if (visualSubstance) {
    score += 10;
  }
  score += Math.min(childCount, 5) * 2;
  if (emptyDecorative) {
    score -= 20;
  }
  if (isDecorativeName) {
    score -= 15;
  }

  return {
    score,
    mustKeep: basePriority >= 100 || (element.type === "text" && meaningfulText)
  };
};

const collectTruncationCandidates = (elements: ScreenElementIR[]): TruncationCandidate[] => {
  const candidates: TruncationCandidate[] = [];
  const ancestorIds: string[] = [];
  let traversalIndex = 0;

  const visit = (element: ScreenElementIR, depth: number): void => {
    const { score, mustKeep } = resolveTruncationPriority(element);
    candidates.push({
      id: element.id,
      ancestorIds: [...ancestorIds],
      depth,
      traversalIndex,
      area: resolveElementArea(element),
      score,
      mustKeep
    });
    traversalIndex += 1;
    ancestorIds.push(element.id);
    for (const child of element.children ?? []) {
      visit(child, depth + 1);
    }
    ancestorIds.pop();
  };

  for (const element of elements) {
    visit(element, 0);
  }
  return candidates;
};

const sortCandidatesByPriority = (candidates: TruncationCandidate[]): TruncationCandidate[] => {
  return [...candidates].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.area !== right.area) {
      return right.area - left.area;
    }
    return left.traversalIndex - right.traversalIndex;
  });
};

const pruneElementToSelection = ({
  element,
  selectedIds
}: {
  element: ScreenElementIR;
  selectedIds: Set<string>;
}): ScreenElementIR | null => {
  if (!selectedIds.has(element.id)) {
    return null;
  }

  const nextChildren: ScreenElementIR[] = [];
  for (const child of element.children ?? []) {
    const pruned = pruneElementToSelection({ element: child, selectedIds });
    if (pruned) {
      nextChildren.push(pruned);
    }
  }

  const withoutChildren = { ...element };
  delete withoutChildren.children;
  if (nextChildren.length === 0) {
    return withoutChildren;
  }
  return {
    ...withoutChildren,
    children: nextChildren
  };
};

const truncateElementsToBudget = ({
  elements,
  budget
}: {
  elements: ScreenElementIR[];
  budget: number;
}): { elements: ScreenElementIR[]; retainedCount: number } => {
  if (budget <= 0 || elements.length === 0) {
    return {
      elements: [],
      retainedCount: 0
    };
  }

  const candidates = collectTruncationCandidates(elements);
  if (candidates.length <= budget) {
    return {
      elements,
      retainedCount: candidates.length
    };
  }

  const selectedIds = new Set<string>();
  let remaining = budget;
  const sortedCandidates = sortCandidatesByPriority(candidates);

  const selectCandidate = (candidate: TruncationCandidate): void => {
    if (remaining <= 0 || selectedIds.has(candidate.id)) {
      return;
    }
    const chain = [...candidate.ancestorIds, candidate.id];
    const missingChain = chain.filter((id) => !selectedIds.has(id));
    if (missingChain.length === 0 || missingChain.length > remaining) {
      return;
    }
    for (const id of missingChain) {
      selectedIds.add(id);
      remaining -= 1;
    }
  };

  for (const candidate of sortedCandidates.filter((entry) => entry.mustKeep)) {
    selectCandidate(candidate);
    if (remaining <= 0) {
      break;
    }
  }

  if (remaining > 0) {
    for (const candidate of sortedCandidates) {
      selectCandidate(candidate);
      if (remaining <= 0) {
        break;
      }
    }
  }

  if (remaining > 0 && selectedIds.size === 0) {
    const fallbackCandidate = candidates.find((candidate) => candidate.depth === 0) ?? candidates[0];
    if (fallbackCandidate) {
      selectCandidate(fallbackCandidate);
    }
  }

  const truncated: ScreenElementIR[] = [];
  for (const element of elements) {
    const pruned = pruneElementToSelection({ element, selectedIds });
    if (pruned) {
      truncated.push(pruned);
    }
  }

  return {
    elements: truncated,
    retainedCount: countElements(truncated)
  };
};

const extractScreens = ({
  file,
  metrics,
  screenElementBudget,
  screenElementMaxDepth
}: {
  file: FigmaFile;
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
}): ScreenIR[] => {
  const root = file.document;
  if (!root?.children?.length) {
    return [];
  }

  const screenCandidates: FigmaNode[] = [];

  for (const page of root.children) {
    if (page.visible === false) {
      metrics.skippedHidden += countSubtreeNodes(page);
      continue;
    }

    for (const child of page.children ?? []) {
      if (child.visible === false) {
        metrics.skippedHidden += countSubtreeNodes(child);
        continue;
      }

      if (child.type === "SECTION") {
        screenCandidates.push(...collectSectionScreens({ section: child, metrics }));
        continue;
      }

      if (child.type === "FRAME" || child.type === "COMPONENT") {
        screenCandidates.push(child);
      }
    }
  }

  const screens: ScreenIR[] = [];

  for (const candidate of screenCandidates) {
    const normalized = unwrapScreenRoot(candidate);
    const sourceNode = normalized.node;
    const fill = sourceNode.fills?.find((item) => item.type === "SOLID" && item.color);
    const depthAnalysis = analyzeDepthPressure(sourceNode.children ?? []);
    const depthContext: ScreenDepthBudgetContext = {
      screenElementBudget,
      configuredMaxDepth: screenElementMaxDepth,
      mappedElementCount: 0,
      nodeCountByDepth: depthAnalysis.nodeCountByDepth,
      semanticCountByDepth: depthAnalysis.semanticCountByDepth,
      subtreeHasSemanticById: depthAnalysis.subtreeHasSemanticById,
      truncatedBranchCount: 0
    };

    const mappedChildren: ScreenElementIR[] = [];
    for (const child of sourceNode.children ?? []) {
      const mapped = mapElement({
        node: child,
        depth: 0,
        inInstanceContext: sourceNode.type === "INSTANCE" || sourceNode.type === "COMPONENT_SET",
        metrics,
        depthContext
      });
      if (mapped) {
        mappedChildren.push(mapped);
      }
    }

    const originalElements = countElements(mappedChildren);
    metrics.screenElementCounts.push({
      screenId: sourceNode.id,
      screenName: normalized.name,
      elements: originalElements
    });

    const { elements: budgetedChildren, retainedCount } =
      originalElements > screenElementBudget
        ? truncateElementsToBudget({ elements: mappedChildren, budget: screenElementBudget })
        : { elements: mappedChildren, retainedCount: originalElements };

    if (originalElements > screenElementBudget) {
      metrics.truncatedScreens.push({
        screenId: sourceNode.id,
        screenName: normalized.name,
        originalElements,
        retainedElements: retainedCount,
        budget: screenElementBudget
      });
    }
    if (depthContext.truncatedBranchCount > 0) {
      metrics.depthTruncatedScreens.push({
        screenId: sourceNode.id,
        screenName: normalized.name,
        maxDepth: screenElementMaxDepth,
        firstTruncatedDepth: depthContext.firstTruncatedDepth ?? screenElementMaxDepth + 1,
        truncatedBranchCount: depthContext.truncatedBranchCount
      });
    }

    const screen: ScreenIR = {
      id: sourceNode.id,
      name: normalized.name,
      layoutMode: sourceNode.layoutMode ?? "NONE",
      gap: sourceNode.itemSpacing ?? 0,
      padding: mapPadding(sourceNode),
      children: budgetedChildren,
      ...(sourceNode.primaryAxisAlignItems ? { primaryAxisAlignItems: sourceNode.primaryAxisAlignItems } : {}),
      ...(sourceNode.counterAxisAlignItems ? { counterAxisAlignItems: sourceNode.counterAxisAlignItems } : {})
    };
    if (sourceNode.absoluteBoundingBox?.width !== undefined) {
      screen.width = sourceNode.absoluteBoundingBox.width;
    }
    if (sourceNode.absoluteBoundingBox?.height !== undefined) {
      screen.height = sourceNode.absoluteBoundingBox.height;
    }
    const fillColor = toHexColor(fill?.color, fill?.opacity);
    if (fillColor) {
      screen.fillColor = fillColor;
    }
    screens.push(screen);
  }

  return screens;
};

const TOKEN_DERIVATION_DEFAULTS: DesignTokens = {
  palette: {
    primary: "#d4001a",
    secondary: "#5f8f2f",
    background: "#f7f8fb",
    text: "#1f2937"
  },
  borderRadius: 8,
  spacingBase: 8,
  fontFamily: "Roboto, Arial, sans-serif",
  headingSize: 24,
  bodySize: 14
};

const COLOR_CLUSTER_STEP = 16;
const COLOR_CLUSTER_MERGE_THRESHOLD = 0.12;

const emptyContextWeights = (): Record<ColorSampleContext, number> => ({
  button: 0,
  heading: 0,
  body: 0,
  surface: 0,
  decorative: 0
});

const parseHexChannel = (hex: string, start: number): number => {
  const normalized = hex.replace("#", "");
  const parsed = Number.parseInt(normalized.slice(start, start + 2), 16);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(parsed, 0, 255);
};

const resolveNodeArea = (node: FigmaNode): number => {
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  return Math.max(1, width * height);
};

const resolveTextRole = (node: FigmaNode): "heading" | "body" => {
  const fontSize = node.style?.fontSize ?? 0;
  const fontWeight = node.style?.fontWeight ?? 0;
  const loweredName = (node.name ?? "").toLowerCase();
  if (
    fontSize >= 20 ||
    fontWeight >= 650 ||
    hasAnySubstring(loweredName, ["heading", "headline", "title", "h1", "h2", "h3"])
  ) {
    return "heading";
  }
  return "body";
};

const resolveNodeStyleCatalog = (file: FigmaFile): Map<string, string> => {
  const catalog = new Map<string, string>();
  for (const [styleId, styleEntry] of Object.entries(file.styles ?? {})) {
    const normalized = [styleEntry.name, styleEntry.styleType, styleEntry.style_type]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .toLowerCase();
    if (normalized.length > 0) {
      catalog.set(styleId, normalized);
    }
  }
  return catalog;
};

const resolveNodeStyleNames = (node: FigmaNode, styleCatalog: Map<string, string>): string[] => {
  const styleIds = [
    ...Object.values(node.styles ?? {}).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    node.fillStyleId,
    node.strokeStyleId,
    node.effectStyleId,
    node.textStyleId
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const names = styleIds
    .map((styleId) => styleCatalog.get(styleId))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return [...new Set(names)];
};

const deriveStyleSignals = (styleNames: string[]): Record<StyleSignalKey, number> => {
  const signals = emptyStyleSignals();
  for (const styleName of styleNames) {
    if (hasAnySubstring(styleName, ["primary"])) {
      signals.primary += 1;
    }
    if (hasAnySubstring(styleName, ["secondary"])) {
      signals.secondary += 1;
    }
    if (hasAnySubstring(styleName, ["background", "surface", "canvas", "paper"])) {
      signals.background += 1;
    }
    if (hasAnySubstring(styleName, ["text", "foreground", "content"])) {
      signals.text += 1;
    }
    if (hasAnySubstring(styleName, ["brand"])) {
      signals.brand += 1;
    }
    if (hasAnySubstring(styleName, ["accent", "highlight"])) {
      signals.accent += 1;
    }
  }
  return signals;
};

const resolveSampleWeight = ({
  node,
  context
}: {
  node: FigmaNode;
  context: ColorSampleContext;
}): number => {
  const area = resolveNodeArea(node);
  const textWidth = node.absoluteBoundingBox?.width ?? 120;
  const base = (() => {
    switch (context) {
      case "button":
        return 16;
      case "heading":
        return 12;
      case "body":
        return 9;
      case "surface":
        return 6;
      case "decorative":
      default:
        return 2;
    }
  })();

  if (context === "heading" || context === "body") {
    const emphasis = (node.style?.fontWeight ?? 0) >= 650 ? 1.15 : 1;
    return base * clamp(textWidth / 160, 1, 6) * emphasis;
  }

  return base * clamp(Math.sqrt(area) / 120, 1, 8);
};

const resolveFillColor = (node: FigmaNode): string | undefined => {
  const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
  return toHexColor(fill?.color, fill?.opacity);
};

const resolveStrokeColor = (node: FigmaNode): string | undefined => {
  const stroke = node.strokes?.find((item) => item.type === "SOLID" && item.color);
  return toHexColor(stroke?.color, stroke?.opacity);
};

const resolveShapeContext = (node: FigmaNode): ColorSampleContext => {
  const loweredName = (node.name ?? "").toLowerCase();
  const hasButtonHint = hasAnySubstring(loweredName, [
    "button",
    "cta",
    "chip",
    "tab",
    "navigationaction",
    "appbar"
  ]);
  if (hasButtonHint) {
    return "button";
  }

  const area = resolveNodeArea(node);
  if ((node.type === "FRAME" || node.type === "RECTANGLE") && area >= 3_000) {
    return "surface";
  }

  return "decorative";
};

const collectColorSamples = ({
  nodes,
  styleCatalog
}: {
  nodes: FigmaNode[];
  styleCatalog: Map<string, string>;
}): ColorSample[] => {
  const samples: ColorSample[] = [];

  for (const node of nodes) {
    const styleNames = resolveNodeStyleNames(node, styleCatalog);
    const styleSignals = deriveStyleSignals(styleNames);

    const fillColor = resolveFillColor(node);
    if (fillColor) {
      const context = node.type === "TEXT" ? resolveTextRole(node) : resolveShapeContext(node);
      samples.push({
        color: fillColor,
        context,
        styleSignals,
        weight: resolveSampleWeight({ node, context })
      });
    }

    const strokeColor = resolveStrokeColor(node);
    if (strokeColor && node.type !== "TEXT") {
      samples.push({
        color: strokeColor,
        context: "decorative",
        styleSignals,
        weight: Math.max(1, resolveSampleWeight({ node, context: "decorative" }) * 0.2)
      });
    }
  }

  return samples;
};

const finalizeClusterColor = (cluster: ColorCluster): string => {
  if (cluster.totalWeight <= 0) {
    return cluster.color;
  }
  return toHexFromRgb(
    cluster.channels.r / cluster.totalWeight,
    cluster.channels.g / cluster.totalWeight,
    cluster.channels.b / cluster.totalWeight
  );
};

const mergeClusters = (target: ColorCluster, source: ColorCluster): void => {
  target.totalWeight += source.totalWeight;
  target.channels.r += source.channels.r;
  target.channels.g += source.channels.g;
  target.channels.b += source.channels.b;
  for (const key of Object.keys(target.contexts) as ColorSampleContext[]) {
    target.contexts[key] += source.contexts[key];
  }
  addStyleSignals(target.styleSignals, source.styleSignals);
  target.color = finalizeClusterColor(target);
};

const clusterSamples = (samples: ColorSample[]): ColorCluster[] => {
  const buckets = new Map<string, ColorCluster>();

  for (const sample of samples) {
    const key = quantizeColorKey(sample.color, COLOR_CLUSTER_STEP);
    const existing = buckets.get(key);
    if (!existing) {
      const created: ColorCluster = {
        color: key,
        totalWeight: 0,
        channels: {
          r: 0,
          g: 0,
          b: 0
        },
        contexts: emptyContextWeights(),
        styleSignals: emptyStyleSignals()
      };
      buckets.set(key, created);
    }

    const cluster = buckets.get(key);
    if (!cluster) {
      continue;
    }
    cluster.totalWeight += sample.weight;
    cluster.channels.r += parseHexChannel(sample.color, 0) * sample.weight;
    cluster.channels.g += parseHexChannel(sample.color, 2) * sample.weight;
    cluster.channels.b += parseHexChannel(sample.color, 4) * sample.weight;
    cluster.contexts[sample.context] += sample.weight;
    addStyleSignals(cluster.styleSignals, sample.styleSignals, sample.weight);
    cluster.color = finalizeClusterColor(cluster);
  }

  const merged: ColorCluster[] = [];
  const sorted = [...buckets.values()].sort((left, right) => right.totalWeight - left.totalWeight);
  for (const cluster of sorted) {
    const match = merged.find((candidate) => colorDistance(candidate.color, cluster.color) <= COLOR_CLUSTER_MERGE_THRESHOLD);
    if (match) {
      mergeClusters(match, cluster);
    } else {
      merged.push({
        color: cluster.color,
        totalWeight: cluster.totalWeight,
        channels: { ...cluster.channels },
        contexts: { ...cluster.contexts },
        styleSignals: { ...cluster.styleSignals }
      });
    }
  }

  return merged.sort((left, right) => right.totalWeight - left.totalWeight);
};

const chooseBackgroundColor = (clusters: ColorCluster[]): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.background;
  }

  const rank = (cluster: ColorCluster): number => {
    return (
      cluster.contexts.surface * 1.6 +
      cluster.styleSignals.background * 3.2 +
      cluster.totalWeight * 0.08 +
      luminance(cluster.color) * 4.2 -
      saturation(cluster.color) * 1.4
    );
  };

  const brightCandidates = clusters.filter((cluster) => luminance(cluster.color) >= 0.65);
  const pool = brightCandidates.length > 0 ? brightCandidates : clusters;
  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = rank(right) - rank(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return luminance(right.color) - luminance(left.color);
  });
  return sorted[0]?.color ?? TOKEN_DERIVATION_DEFAULTS.palette.background;
};

const chooseTextColor = ({
  clusters,
  backgroundColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
}): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.text;
  }

  const rolePool = clusters.filter((cluster) => cluster.contexts.body + cluster.contexts.heading > 0);
  const pool = rolePool.length > 0 ? rolePool : clusters;

  const score = (cluster: ColorCluster): number => {
    const ratio = contrastRatio(cluster.color, backgroundColor);
    let value =
      cluster.contexts.body * 1.2 +
      cluster.contexts.heading +
      cluster.styleSignals.text * 3.5 +
      (1 - luminance(cluster.color)) * 2.4 +
      cluster.totalWeight * 0.04;
    if (ratio >= 4.5) {
      value += 6;
    } else {
      value -= (4.5 - ratio) * 4;
    }
    if (colorDistance(cluster.color, backgroundColor) < 0.08) {
      value -= 10;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return contrastRatio(right.color, backgroundColor) - contrastRatio(left.color, backgroundColor);
  });

  const candidate = sorted[0]?.color;
  if (!candidate) {
    return TOKEN_DERIVATION_DEFAULTS.palette.text;
  }

  const candidateRatio = contrastRatio(candidate, backgroundColor);
  if (candidateRatio >= 4.5) {
    return candidate;
  }

  const black = "#111111";
  const white = "#ffffff";
  return contrastRatio(black, backgroundColor) >= contrastRatio(white, backgroundColor) ? black : white;
};

const choosePrimaryColor = ({
  clusters,
  backgroundColor,
  textColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
  textColor: string;
}): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.primary;
  }

  const candidates = clusters.filter((cluster) => colorDistance(cluster.color, backgroundColor) >= 0.08);
  const pool = candidates.length > 0 ? candidates : clusters;

  const score = (cluster: ColorCluster): number => {
    let value =
      cluster.contexts.button * 2.5 +
      cluster.contexts.heading * 1.3 +
      cluster.styleSignals.primary * 4.2 +
      cluster.styleSignals.brand * 2.4 +
      cluster.styleSignals.accent * 1.4 +
      saturation(cluster.color) * 2.6 +
      cluster.totalWeight * 0.04;
    if (contrastRatio(cluster.color, backgroundColor) >= 3) {
      value += 3;
    } else {
      value -= 2;
    }
    if (colorDistance(cluster.color, textColor) < 0.08) {
      value -= 8;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return saturation(right.color) - saturation(left.color);
  });
  return sorted[0]?.color ?? TOKEN_DERIVATION_DEFAULTS.palette.primary;
};

const chooseSecondaryColor = ({
  clusters,
  backgroundColor,
  primaryColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
  primaryColor: string;
}): string => {
  const pool = clusters.filter((cluster) => colorDistance(cluster.color, primaryColor) >= 0.14);
  if (pool.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.secondary;
  }

  const score = (cluster: ColorCluster): number => {
    let value =
      cluster.styleSignals.secondary * 4.4 +
      cluster.styleSignals.accent * 2.2 +
      cluster.contexts.heading +
      cluster.contexts.button * 0.8 +
      saturation(cluster.color) * 2 +
      colorDistance(cluster.color, primaryColor) * 2 +
      cluster.totalWeight * 0.03;
    if (contrastRatio(cluster.color, backgroundColor) >= 3) {
      value += 1.2;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return colorDistance(right.color, primaryColor) - colorDistance(left.color, primaryColor);
  });

  const selected = sorted[0]?.color;
  if (!selected || selected === primaryColor) {
    return TOKEN_DERIVATION_DEFAULTS.palette.secondary;
  }
  return selected;
};

const collectFontSamples = (textNodes: FigmaNode[]): FontSample[] => {
  const samples: FontSample[] = [];
  for (const node of textNodes) {
    const family = node.style?.fontFamily?.trim();
    if (!family) {
      continue;
    }
    const role = resolveTextRole(node);
    const size = node.style?.fontSize ?? (role === "heading" ? 24 : 14);
    const width = node.absoluteBoundingBox?.width ?? 120;
    const baseWeight = clamp(width / 160, 1, 6);
    const roleWeight = role === "heading" ? 2 : 1;
    samples.push({
      family,
      role,
      size,
      weight: baseWeight * roleWeight
    });
  }
  return samples;
};

const resolveDominantFont = (samples: FontSample[], role: "heading" | "body"): string | undefined => {
  const roleSamples = samples.filter((sample) => sample.role === role);
  const pool = roleSamples.length > 0 ? roleSamples : samples;
  const weights = new Map<string, number>();
  for (const sample of pool) {
    weights.set(sample.family, (weights.get(sample.family) ?? 0) + sample.weight);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

const deriveTokens = (file: FigmaFile): DesignTokens => {
  const nodes = file.document ? collectNodes(file.document, () => true) : [];
  const textNodes = nodes.filter((node) => node.type === "TEXT");
  const styleCatalog = resolveNodeStyleCatalog(file);
  const colorSamples = collectColorSamples({ nodes, styleCatalog });
  const clusters = clusterSamples(colorSamples);

  const background = chooseBackgroundColor(clusters);
  const text = chooseTextColor({
    clusters,
    backgroundColor: background
  });
  const primary = choosePrimaryColor({
    clusters,
    backgroundColor: background,
    textColor: text
  });
  const secondary = chooseSecondaryColor({
    clusters,
    backgroundColor: background,
    primaryColor: primary
  });

  const spacings = nodes
    .map((node) => node.itemSpacing)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const radii = nodes
    .map((node) => node.cornerRadius)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const fontSamples = collectFontSamples(textNodes);
  const headingSize = Math.round(
    weightedMedian(
      fontSamples
        .filter((sample) => sample.role === "heading")
        .map((sample) => ({
          value: sample.size,
          weight: sample.weight
        }))
    ) ?? TOKEN_DERIVATION_DEFAULTS.headingSize
  );
  const bodySize = Math.round(
    weightedMedian(
      fontSamples
        .filter((sample) => sample.role === "body")
        .map((sample) => ({
          value: sample.size,
          weight: sample.weight
        }))
    ) ?? TOKEN_DERIVATION_DEFAULTS.bodySize
  );

  const dominantBodyFont = resolveDominantFont(fontSamples, "body");
  const dominantHeadingFont = resolveDominantFont(fontSamples, "heading");

  const resolvedHeadingSize = Math.max(bodySize + 2, headingSize);
  const resolvedBodySize = Math.max(10, bodySize);

  return {
    palette: {
      primary,
      secondary,
      background,
      text
    },
    borderRadius: Math.max(1, Math.round(median(radii) ?? TOKEN_DERIVATION_DEFAULTS.borderRadius)),
    spacingBase: Math.max(1, Math.round(median(spacings) ?? TOKEN_DERIVATION_DEFAULTS.spacingBase)),
    fontFamily: normalizeFontStack(
      [dominantBodyFont, dominantHeadingFont].filter((value): value is string => typeof value === "string")
    ),
    headingSize: resolvedHeadingSize,
    bodySize: resolvedBodySize
  };
};

const isGenericElementName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "container" ||
    normalized === "styled(div)" ||
    normalized === "vector" ||
    normalized === "frame" ||
    normalized.startsWith("frame ")
  );
};

const inferTypeFromSemanticHint = (
  semanticName: string | undefined,
  semanticType: string | undefined
): ScreenElementIR["type"] | undefined => {
  const combined = `${semanticName ?? ""} ${semanticType ?? ""}`.toLowerCase();
  if (!combined.trim()) {
    return undefined;
  }

  if (hasAnyWord(combined, ["text", "typography", "headline", "title", "label"])) {
    return "text";
  }

  if (hasAnySubstring(combined, ["formcontrol", "textfield", "text field"]) || hasAnyWord(combined, ["input", "select", "field"])) {
    return "input";
  }

  if (hasAnyWord(combined, ["switch", "toggle"])) {
    return "switch";
  }

  if (hasAnyWord(combined, ["checkbox"])) {
    return "checkbox";
  }

  if (hasAnyWord(combined, ["radio"])) {
    return "radio";
  }

  if (hasAnyWord(combined, ["chip"])) {
    return "chip";
  }

  if (hasAnyWord(combined, ["tab", "tabs"])) {
    return "tab";
  }

  if (hasAnyWord(combined, ["progress", "loader", "spinner"])) {
    return "progress";
  }

  if (hasAnyWord(combined, ["avatar"])) {
    return "avatar";
  }

  if (hasAnyWord(combined, ["badge"])) {
    return "badge";
  }

  if (hasAnyWord(combined, ["divider", "separator"])) {
    return "divider";
  }

  if (hasAnySubstring(combined, ["appbar", "app bar"]) || hasAnyWord(combined, ["toolbar"])) {
    return "appbar";
  }

  if (hasAnyWord(combined, ["navigation", "navbar"])) {
    return "navigation";
  }

  if (hasAnyWord(combined, ["dialog", "modal"])) {
    return "dialog";
  }

  if (hasAnyWord(combined, ["stepper", "step"])) {
    return "stepper";
  }

  if (hasAnyWord(combined, ["list", "listitem"])) {
    return "list";
  }

  if (hasAnyWord(combined, ["card"])) {
    return "card";
  }

  if (hasAnyWord(combined, ["button", "cta"])) {
    return "button";
  }

  if (hasAnyWord(combined, ["image", "photo", "illustration", "icon"])) {
    return "image";
  }
  return undefined;
};

const applyMcpHintToElement = (
  element: ScreenElementIR,
  hintsById: Map<string, FigmaMcpEnrichment["nodeHints"][number]>
): ScreenElementIR => {
  const hint = hintsById.get(element.id);
  const inferredType = hint ? inferTypeFromSemanticHint(hint.semanticName, hint.semanticType) : undefined;

  const nextName =
    hint?.semanticName && (isGenericElementName(element.name) || hint.semanticName.length > element.name.length + 2)
      ? hint.semanticName
      : element.name;

  return {
    ...element,
    name: nextName,
    type: inferredType ?? element.type,
    children: (element.children ?? []).map((child) => applyMcpHintToElement(child, hintsById))
  };
};

const applyMcpEnrichmentToIr = (ir: DesignIR, enrichment: FigmaMcpEnrichment): DesignIR => {
  if (enrichment.nodeHints.length === 0) {
    return ir;
  }

  const hintsById = new Map(enrichment.nodeHints.map((hint) => [hint.nodeId, hint]));
  return {
    ...ir,
    screens: ir.screens.map((screen) => ({
      ...screen,
      children: screen.children.map((child) => applyMcpHintToElement(child, hintsById))
    }))
  };
};

export const deriveTokensForTesting = (figmaJson: unknown): DesignTokens => {
  return deriveTokens(figmaJson as FigmaFile);
};

export const figmaToDesignIr = (figmaJson: unknown): DesignIR => {
  return figmaToDesignIrWithOptions(figmaJson);
};

export const figmaToDesignIrWithOptions = (figmaJson: unknown, options?: FigmaToIrOptions): DesignIR => {
  const parsed = figmaJson as FigmaFile;
  const resolvedBrandTheme: WorkspaceBrandTheme = options?.brandTheme === "sparkasse" ? "sparkasse" : "derived";
  const screenElementBudget =
    typeof options?.screenElementBudget === "number" && Number.isFinite(options.screenElementBudget)
      ? Math.max(1, Math.trunc(options.screenElementBudget))
      : DEFAULT_SCREEN_ELEMENT_BUDGET;
  const screenElementMaxDepth =
    typeof options?.screenElementMaxDepth === "number" && Number.isFinite(options.screenElementMaxDepth)
      ? Math.max(1, Math.min(64, Math.trunc(options.screenElementMaxDepth)))
      : DEFAULT_SCREEN_ELEMENT_MAX_DEPTH;

  const metrics: MetricsAccumulator = {
    fetchedNodes:
      typeof options?.sourceMetrics?.fetchedNodes === "number" && Number.isFinite(options.sourceMetrics.fetchedNodes)
        ? Math.max(0, Math.trunc(options.sourceMetrics.fetchedNodes))
        : 0,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    screenElementCounts: [],
    truncatedScreens: [],
    depthTruncatedScreens: [],
    degradedGeometryNodes: [...(options?.sourceMetrics?.degradedGeometryNodes ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort((left, right) => left.localeCompare(right))
  };

  const screens = extractScreens({
    file: parsed,
    metrics,
    screenElementBudget,
    screenElementMaxDepth
  });

  if (screens.length === 0) {
    throw new Error("No top-level frames/components found in Figma file");
  }

  const derivedTokens = deriveTokens(parsed);
  const baseIr: DesignIR = {
    sourceName: parsed.name ?? "Figma File",
    screens,
    tokens: resolvedBrandTheme === "sparkasse" ? applySparkasseThemeDefaults(derivedTokens) : derivedTokens,
    metrics
  };

  if (!options?.mcpEnrichment) {
    return baseIr;
  }
  return applyMcpEnrichmentToIr(baseIr, options.mcpEnrichment);
};
