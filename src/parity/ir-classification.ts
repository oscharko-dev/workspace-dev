// ---------------------------------------------------------------------------
// ir-classification.ts — Data-driven element classification engine
// Refactored from procedural if-chains to declarative rules (issue #300)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import {
  ROUNDED_CORNER_RADIUS_MIN,
  FIELD_MIN_WIDTH,
  FIELD_MIN_HEIGHT,
  FIELD_MAX_HEIGHT,
  DIVIDER_MIN_LENGTH,
  DIVIDER_MAX_THICKNESS,
  TABLE_ROW_CELL_MIN_CHILDREN,
  TABLE_MIN_CHILDREN,
  TABLE_MIN_WIDTH,
  POSITION_BUCKET_THRESHOLD,
  GRID_MIN_CHILDREN,
  GRID_MIN_ROW_BUCKETS,
  GRID_MIN_COLUMN_BUCKETS,
  LIST_MIN_CHILDREN,
  LIST_MIN_TEXT_CHILDREN,
  CARD_MIN_WIDTH,
  CARD_MIN_HEIGHT
} from "./constants.js";

type ElementTypeValue = ScreenElementIR["type"];

interface ElementClassificationNode {
  id: string;
  type: string;
  name?: string;
  characters?: string;
  children?: ElementClassificationNode[];
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cornerRadius?: number;
}

export interface ExplicitBoardComponentMatch {
  rawName: string;
  canonicalName: string;
  type?: ElementTypeValue;
}

interface SemanticHintContext {
  combined: string;
}

/**
 * Boolean flags computed from node context, used by declarative rules.
 */
type BooleanContextKey =
  | "hasChildren"
  | "hasVisualFill"
  | "hasVisualSurface"
  | "hasStroke"
  | "hasRoundedCorners"
  | "hasImageFill"
  | "hasListishChildNames"
  | "hasInputSemantic"
  | "hasSelectSemantic"
  | "isFieldSized"
  | "isLikelyDividerByGeometry"
  | "hasTableishChildNames"
  | "hasRowCellStructure"
  | "isLikelyTableByStructure"
  | "hasButtonLabelHint"
  | "hasButtonKeyword"
  | "hasStrongImageName"
  | "hasIconLikeName"
  | "isLikelyGridByStructure"
  | "isLikelyListByStructure"
  | "hasCssGridNamingHint"
  | "hasSpanningChildHint";

interface NodeClassificationContext<TNode extends ElementClassificationNode> {
  node: TNode;
  name: string;
  width: number;
  height: number;
  childCount: number;
  textChildCount: number;
  hasChildren: boolean;
  hasVisualFill: boolean;
  hasVisualSurface: boolean;
  hasStroke: boolean;
  hasRoundedCorners: boolean;
  hasImageFill: boolean;
  hasListishChildNames: boolean;
  hasInputSemantic: boolean;
  hasSelectSemantic: boolean;
  isFieldSized: boolean;
  isLikelyDividerByGeometry: boolean;
  hasTableishChildNames: boolean;
  hasRowCellStructure: boolean;
  isLikelyTableByStructure: boolean;
  hasButtonLabelHint: boolean;
  hasButtonKeyword: boolean;
  hasStrongImageName: boolean;
  hasIconLikeName: boolean;
  rowBuckets: number;
  columnBuckets: number;
  isLikelyGridByStructure: boolean;
  isLikelyListByStructure: boolean;
  hasCssGridNamingHint: boolean;
  hasSpanningChildHint: boolean;
}

interface NodeClassificationDependencies<TNode extends ElementClassificationNode> {
  hasSolidFill(node: TNode): boolean;
  hasGradientFill(node: TNode): boolean;
  hasImageFill(node: TNode): boolean;
  hasVisibleShadow(node: TNode): boolean;
  hasStroke(node: TNode): boolean;
}

// ---------------------------------------------------------------------------
// Declarative classification rule types
// ---------------------------------------------------------------------------

/**
 * A declarative classification rule. All specified conditions are ANDed.
 * Within `keywords` and `words`, matches are ORed (any match suffices).
 * If both `keywords` and `words` are specified, they are ORed together
 * (at least one match from either group is required).
 *
 * Rules are evaluated in priority order (lower priority number = checked first).
 * First matching rule wins.
 */
export interface ClassificationRule {
  /** The element type to assign when this rule matches. */
  type: ElementTypeValue;
  /** Explicit evaluation priority — lower values are checked first. */
  priority: number;
  /** Substring matches against the lowercased node name (OR within array). */
  keywords?: readonly string[];
  /** Word-boundary matches against the lowercased node name (OR within array). */
  words?: readonly string[];
  /** Exact match on node.type (OR within array). */
  nodeTypes?: readonly string[];
  /** Boolean context flags that must match (AND between entries). */
  requires?: Partial<Record<BooleanContextKey, boolean>>;
  /** Geometry constraints (AND between entries). */
  geometry?: {
    minWidth?: number;
    minHeight?: number;
  };
  /** Layout mode must be one of these (OR within array). */
  layoutModes?: readonly ("HORIZONTAL" | "VERTICAL" | "NONE")[];
  /** Word-boundary exclusions — rule fails if any word matches (AND). */
  excludeWords?: readonly string[];
}

/**
 * A declarative semantic hint classification rule.
 * Evaluated against the combined semantic name + type string.
 */
export interface SemanticClassificationRule {
  type: ElementTypeValue;
  priority: number;
  keywords?: readonly string[];
  words?: readonly string[];
}

// ---------------------------------------------------------------------------
// String matching utilities (re-exported for use by other IR modules)
// ---------------------------------------------------------------------------

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const hasAnySubstring = (value: string, tokens: readonly string[]): boolean => {
  return tokens.some((token) => value.includes(token));
};

export const hasAnyWord = (value: string, words: readonly string[]): boolean => {
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(value));
};

export const isIconLikeNodeName = (value: string): boolean => {
  return (
    value.includes("muisvgiconroot") ||
    value.includes("iconcomponent") ||
    value.startsWith("ic_") ||
    value.startsWith("icon/") ||
    value.startsWith("icons/") ||
    value.startsWith("icon-") ||
    value.startsWith("icon_") ||
    hasAnyWord(value, ["icon"])
  );
};

const EXPLICIT_BOARD_NODE_TYPES = new Set(["INSTANCE", "COMPONENT", "COMPONENT_SET"]);

interface ExplicitBoardComponentDescriptor {
  canonicalName: string;
  type?: ElementTypeValue;
  exactPatterns: readonly RegExp[];
  wordPatterns?: readonly RegExp[];
}

const EXPLICIT_BOARD_COMPONENT_DESCRIPTORS: readonly ExplicitBoardComponentDescriptor[] = [
  {
    canonicalName: "IconButton",
    type: "button",
    exactPatterns: [/^icon\s*button$/i, /^iconbutton$/i],
    wordPatterns: [/\bicon[-_\s]*button\b/i]
  },
  {
    canonicalName: "Button",
    type: "button",
    exactPatterns: [/^button$/i, /^cta$/i],
    wordPatterns: [/\bbutton\b/i, /\bcta\b/i]
  },
  {
    canonicalName: "Snackbar",
    type: "snackbar",
    exactPatterns: [/^snackbar$/i, /^toast$/i],
    wordPatterns: [/\bsnackbar\b/i, /\btoast\b/i]
  },
  {
    canonicalName: "Alert",
    type: "alert",
    exactPatterns: [/^alert$/i],
    wordPatterns: [/\balert\b/i]
  },
  {
    canonicalName: "Card",
    type: "card",
    exactPatterns: [/^card$/i],
    wordPatterns: [/\bcard\b/i]
  },
  {
    canonicalName: "Divider",
    type: "divider",
    exactPatterns: [/^divider$/i, /^separator$/i],
    wordPatterns: [/\bdivider\b/i, /\bseparator\b/i]
  },
  {
    canonicalName: "Stack",
    type: "stack",
    exactPatterns: [/^stack(?:\d+)?$/i],
    wordPatterns: [/\bstack(?:\d+)?\b/i]
  },
  {
    canonicalName: "Typography",
    type: "text",
    exactPatterns: [/^typography$/i, /^dynamic\s+typography$/i],
    wordPatterns: [/\btypography\b/i, /\bdynamic\s+typography\b/i]
  },
  {
    canonicalName: "AppBar",
    type: "appbar",
    exactPatterns: [/^app\s*bar$/i, /^appbar$/i],
    wordPatterns: [/\bapp[-_\s]*bar\b/i, /\bappbar\b/i]
  },
  {
    canonicalName: "Drawer",
    type: "drawer",
    exactPatterns: [/^drawer$/i, /^side\s*drawer$/i],
    wordPatterns: [/\bdrawer\b/i, /\bsidebar\b/i]
  },
  {
    canonicalName: "Breadcrumbs",
    type: "breadcrumbs",
    exactPatterns: [/^breadcrumbs?$/i],
    wordPatterns: [/\bbreadcrumbs?\b/i]
  },
  {
    canonicalName: "Dialog",
    type: "dialog",
    exactPatterns: [/^dialog$/i, /^modal$/i],
    wordPatterns: [/\bdialog\b/i, /\bmodal\b/i]
  },
  {
    canonicalName: "Tab",
    type: "tab",
    exactPatterns: [/^tabs?$/i],
    wordPatterns: [/\btabs?\b/i]
  },
  {
    canonicalName: "Chip",
    type: "chip",
    exactPatterns: [/^chip$/i],
    wordPatterns: [/\bchip\b/i]
  },
  {
    canonicalName: "Badge",
    type: "badge",
    exactPatterns: [/^badge$/i],
    wordPatterns: [/\bbadge\b/i]
  },
  {
    canonicalName: "Avatar",
    type: "avatar",
    exactPatterns: [/^avatar$/i],
    wordPatterns: [/\bavatar\b/i]
  },
  {
    canonicalName: "Paper",
    type: "paper",
    exactPatterns: [/^paper$/i, /^surface$/i],
    wordPatterns: [/\bpaper\b/i, /\bsurface\b/i]
  },
  {
    canonicalName: "Select",
    type: "select",
    exactPatterns: [/^select$/i, /^dropdown$/i],
    wordPatterns: [/\bselect\b/i, /\bdropdown\b/i]
  },
  {
    canonicalName: "Input",
    type: "input",
    exactPatterns: [/^input$/i, /^text\s*field$/i, /^textfield$/i],
    wordPatterns: [/\binput\b/i, /\btext[-_\s]*field\b/i, /\btextfield\b/i]
  },
  {
    canonicalName: "Switch",
    type: "switch",
    exactPatterns: [/^switch$/i, /^toggle$/i],
    wordPatterns: [/\bswitch\b/i, /\btoggle\b/i]
  },
  {
    canonicalName: "Checkbox",
    type: "checkbox",
    exactPatterns: [/^checkbox$/i],
    wordPatterns: [/\bcheckbox\b/i]
  },
  {
    canonicalName: "Radio",
    type: "radio",
    exactPatterns: [/^radio$/i],
    wordPatterns: [/\bradio\b/i]
  },
  {
    canonicalName: "Slider",
    type: "slider",
    exactPatterns: [/^slider$/i],
    wordPatterns: [/\bslider\b/i]
  },
  {
    canonicalName: "Rating",
    type: "rating",
    exactPatterns: [/^rating$/i],
    wordPatterns: [/\brating\b/i]
  },
  {
    canonicalName: "Tooltip",
    type: "tooltip",
    exactPatterns: [/^tooltip$/i],
    wordPatterns: [/\btooltip\b/i]
  },
  {
    canonicalName: "Stepper",
    type: "stepper",
    exactPatterns: [/^stepper$/i],
    wordPatterns: [/\bstepper\b/i]
  },
  {
    canonicalName: "Navigation",
    type: "navigation",
    exactPatterns: [/^navigation$/i, /^navigation\s*bar$/i, /^navbar$/i],
    wordPatterns: [/\bnavigation\b/i, /\bnavbar\b/i]
  },
  {
    canonicalName: "Table",
    type: "table",
    exactPatterns: [/^table$/i, /^data\s*table$/i],
    wordPatterns: [/\btable\b/i]
  },
  {
    canonicalName: "Grid",
    type: "grid",
    exactPatterns: [/^grid(?:\d+)?$/i],
    wordPatterns: [/\bgrid(?:\d+)?\b/i]
  }
];

const normalizeExplicitBoardComponentSource = (value: string): string => {
  return value
    .replace(/🔥/g, " ")
    .replace(/^_+/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const resolveExplicitBoardDescriptor = ({
  candidate,
  allowWordPatterns
}: {
  candidate: string;
  allowWordPatterns: boolean;
}): ExplicitBoardComponentDescriptor | undefined => {
  const normalizedCandidate = normalizeExplicitBoardComponentSource(candidate);
  if (!normalizedCandidate) {
    return undefined;
  }
  return EXPLICIT_BOARD_COMPONENT_DESCRIPTORS.find((descriptor) => {
    if (descriptor.exactPatterns.some((pattern) => pattern.test(normalizedCandidate))) {
      return true;
    }
    return allowWordPatterns && descriptor.wordPatterns?.some((pattern) => pattern.test(normalizedCandidate)) === true;
  });
};

export const resolveExplicitBoardComponentFromNode = (
  node: Pick<ElementClassificationNode, "name" | "type">
): ExplicitBoardComponentMatch | undefined => {
  const rawName = typeof node.name === "string" ? node.name.trim() : "";
  if (!rawName) {
    return undefined;
  }

  const angleMatch = rawName.match(/<\s*([^>]+?)\s*>/);
  if (angleMatch?.[1]) {
    const candidate = angleMatch[1].trim();
    const descriptor = resolveExplicitBoardDescriptor({
      candidate,
      allowWordPatterns: true
    });
    return {
      rawName: candidate,
      canonicalName: descriptor?.canonicalName ?? candidate,
      ...(descriptor?.type ? { type: descriptor.type } : {})
    };
  }

  if (!EXPLICIT_BOARD_NODE_TYPES.has(node.type)) {
    return undefined;
  }

  const descriptor = resolveExplicitBoardDescriptor({
    candidate: rawName,
    allowWordPatterns: true
  });
  if (!descriptor) {
    return undefined;
  }
  return {
    rawName,
    canonicalName: descriptor.canonicalName,
    ...(descriptor.type ? { type: descriptor.type } : {})
  };
};

// ---------------------------------------------------------------------------
// Context construction helpers
// ---------------------------------------------------------------------------

const countPositionBuckets = ({
  values,
  threshold
}: {
  values: number[];
  threshold: number;
}): number => {
  if (values.length === 0) {
    return 0;
  }
  let buckets = 1;
  let previous = values[0] ?? 0;
  for (const value of values.slice(1)) {
    if (Math.abs(value - previous) >= threshold) {
      buckets += 1;
      previous = value;
    }
  }
  return buckets;
};

const createNodeClassificationContext = <TNode extends ElementClassificationNode>({
  node,
  dependencies
}: {
  node: TNode;
  dependencies: NodeClassificationDependencies<TNode>;
}): NodeClassificationContext<TNode> => {
  const name = (node.name ?? "").toLowerCase();
  const children = node.children ?? [];
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  const childCount = children.length;
  const textChildCount = children.filter((child) => child.type === "TEXT" && (child.characters ?? "").trim().length > 0).length;
  const hasChildren = childCount > 0;
  const hasSolidFill = dependencies.hasSolidFill(node);
  const hasGradientFill = dependencies.hasGradientFill(node);
  const hasImageFill = dependencies.hasImageFill(node);
  const hasShadow = dependencies.hasVisibleShadow(node);
  const hasVisualFill = hasSolidFill || hasGradientFill;
  const hasVisualSurface = hasVisualFill || hasShadow;
  const hasStroke = dependencies.hasStroke(node);
  const hasRoundedCorners = (node.cornerRadius ?? 0) >= ROUNDED_CORNER_RADIUS_MIN;
  const hasListishChildNames = children.some((child) => {
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
    "muiinputbaseroot",
    "muiinputbaseinput",
    "muiinputroot",
    "formcontrol"
  ]);
  const hasSelectSemantic = hasAnySubstring(name, ["muiselect", "selectroot", "selectfield", "dropdown"]);
  const isFieldSized = width >= FIELD_MIN_WIDTH && height >= FIELD_MIN_HEIGHT && height <= FIELD_MAX_HEIGHT;
  const isLikelyDividerByGeometry =
    !hasChildren && hasVisualFill && ((width >= DIVIDER_MIN_LENGTH && height > 0 && height <= DIVIDER_MAX_THICKNESS) || (height >= DIVIDER_MIN_LENGTH && width > 0 && width <= DIVIDER_MAX_THICKNESS));

  const hasTableishChildNames = children.some((child) => {
    const childName = (child.name ?? "").toLowerCase();
    return (
      childName.includes("tablerow") ||
      childName.includes("table row") ||
      childName.includes("tablecell") ||
      childName.includes("table cell")
    );
  });
  const hasRowCellStructure = children.some((child) => (child.children?.length ?? 0) >= TABLE_ROW_CELL_MIN_CHILDREN);
  const isLikelyTableByStructure = hasChildren && childCount >= TABLE_MIN_CHILDREN && hasRowCellStructure && (width >= TABLE_MIN_WIDTH || hasTableishChildNames);
  const hasButtonLabelHint =
    name.includes("zur übersicht") || name.includes("termin vereinbaren") || name.includes("zum finanzierungsplaner");
  const hasButtonKeyword = hasAnySubstring(name, ["muibutton", "buttonbase", "button", "cta"]);
  const hasStrongImageName = hasAnyWord(name, ["image", "photo", "illustration", "hero", "banner"]);
  const hasIconLikeName = isIconLikeNodeName(name);

  const rowBuckets = countPositionBuckets({
    values: children
      .map((child) => child.absoluteBoundingBox?.y)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => left - right),
    threshold: POSITION_BUCKET_THRESHOLD
  });
  const columnBuckets = countPositionBuckets({
    values: children
      .map((child) => child.absoluteBoundingBox?.x)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => left - right),
    threshold: POSITION_BUCKET_THRESHOLD
  });
  const isLikelyGridByStructure = childCount >= GRID_MIN_CHILDREN && rowBuckets >= GRID_MIN_ROW_BUCKETS && columnBuckets >= GRID_MIN_COLUMN_BUCKETS && node.layoutMode !== "VERTICAL";
  const isLikelyListByStructure = !hasVisualSurface && childCount >= LIST_MIN_CHILDREN && textChildCount >= LIST_MIN_TEXT_CHILDREN && (node.layoutMode === "VERTICAL" || node.layoutMode === "NONE");

  // CSS Grid naming hints — detect Figma naming conventions for grid areas/spanning
  const hasCssGridNamingHint = hasAnySubstring(name, [
    "grid-area", "gridarea", "grid-template", "gridtemplate",
    "cssgrid", "css-grid", "grid-column", "grid-row"
  ]) || children.some((child) => {
    const childName = (child.name ?? "").toLowerCase();
    return hasAnySubstring(childName, ["grid-area", "gridarea", "span-", "col-span", "row-span", "colspan", "rowspan"]);
  });

  // Spanning child detection — children whose width significantly exceeds the average
  const hasSpanningChildHint = (() => {
    if (childCount < 3) {
      return false;
    }
    const childWidths = children
      .map((child) => child.absoluteBoundingBox?.width)
      .filter((w): w is number => typeof w === "number" && Number.isFinite(w) && w > 0);
    if (childWidths.length < 3) {
      return false;
    }
    const averageWidth = childWidths.reduce((sum, w) => sum + w, 0) / childWidths.length;
    return childWidths.some((w) => w > averageWidth * 1.6);
  })();

  return {
    node,
    name,
    width,
    height,
    childCount,
    textChildCount,
    hasChildren,
    hasVisualFill,
    hasVisualSurface,
    hasStroke,
    hasRoundedCorners,
    hasImageFill,
    hasListishChildNames,
    hasInputSemantic,
    hasSelectSemantic,
    isFieldSized,
    isLikelyDividerByGeometry,
    hasTableishChildNames,
    hasRowCellStructure,
    isLikelyTableByStructure,
    hasButtonLabelHint,
    hasButtonKeyword,
    hasStrongImageName,
    hasIconLikeName,
    rowBuckets,
    columnBuckets,
    isLikelyGridByStructure,
    isLikelyListByStructure,
    hasCssGridNamingHint,
    hasSpanningChildHint
  };
};

// ---------------------------------------------------------------------------
// Declarative node classification rules
// ---------------------------------------------------------------------------

/**
 * Data-driven classification rules for Figma node → MUI component type mapping.
 *
 * Rules are evaluated in priority order (ascending). First matching rule wins.
 * Each rule's conditions are ANDed; within `keywords`/`words` arrays, matches
 * are ORed. If both `keywords` and `words` are present, at least one match
 * from either group suffices (OR between groups).
 *
 * Priority bands:
 *   10–19   Primitive types (text)
 *   20–29   Form controls with semantic detection (select, input)
 *   30–59   Simple keyword-matched form controls
 *   60–99   Simple keyword-matched components
 *   100–199 Layout & structural components
 *   200–299 Structural inference rules (table, grid, card, paper, stack)
 *   300–399 Button & image rules
 */
export const NODE_CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // --- Priority 10: text (primitive node type) ---
  { type: "text", priority: 10, nodeTypes: ["TEXT"] },

  // --- Priority 20–29: select (semantic + keyword, requires field sizing or children) ---
  { type: "select", priority: 20, requires: { hasSelectSemantic: true, isFieldSized: true } },
  { type: "select", priority: 21, requires: { hasSelectSemantic: true, hasChildren: true } },
  { type: "select", priority: 22, words: ["select", "dropdown"], requires: { isFieldSized: true } },
  { type: "select", priority: 23, words: ["select", "dropdown"], requires: { hasChildren: true } },

  // --- Priority 30–39: slider, rating, skeleton ---
  { type: "slider", priority: 30, keywords: ["muislider", "slider"] },
  { type: "slider", priority: 31, words: ["slider", "range"] },
  { type: "rating", priority: 32, keywords: ["muirating"] },
  { type: "rating", priority: 33, words: ["rating", "stars", "star rating"] },
  { type: "skeleton", priority: 34, keywords: ["muiskeleton", "loadingplaceholder"] },
  { type: "skeleton", priority: 35, words: ["skeleton", "placeholder shimmer", "loading skeleton"] },

  // --- Priority 40–49: input (semantic + keyword, requires field sizing or children) ---
  { type: "input", priority: 40, requires: { hasInputSemantic: true, isFieldSized: true } },
  { type: "input", priority: 41, requires: { hasInputSemantic: true, hasChildren: true } },
  { type: "input", priority: 42, words: ["input", "textfield", "field"], requires: { isFieldSized: true } },
  { type: "input", priority: 43, words: ["input", "textfield", "field"], requires: { hasChildren: true } },

  // --- Priority 50–59: switch, checkbox, radio ---
  { type: "switch", priority: 50, keywords: ["muiswitch", "switchbase"] },
  { type: "switch", priority: 51, words: ["switch", "toggle"] },
  { type: "checkbox", priority: 52, keywords: ["muicheckbox"] },
  { type: "checkbox", priority: 53, words: ["checkbox"] },
  { type: "radio", priority: 54, keywords: ["muiradio"] },
  { type: "radio", priority: 55, words: ["radio"] },

  // --- Priority 60–79: chip, tab, progress, avatar, badge ---
  { type: "chip", priority: 60, keywords: ["muichip"] },
  { type: "chip", priority: 61, words: ["chip"] },
  { type: "tab", priority: 62, keywords: ["muitabs", "muitab"] },
  { type: "tab", priority: 63, words: ["tab", "tabs"] },
  { type: "progress", priority: 64, keywords: ["muicircularprogress", "muilinearprogress", "circularprogress", "linearprogress", "progressbar"] },
  { type: "progress", priority: 65, words: ["progress", "loader", "loading", "spinner"] },
  { type: "avatar", priority: 66, keywords: ["muiavatar"] },
  { type: "avatar", priority: 67, words: ["avatar"] },
  { type: "badge", priority: 68, keywords: ["muibadge"] },
  { type: "badge", priority: 69, words: ["badge"] },

  // --- Priority 80–99: divider, appbar, drawer, breadcrumbs, tooltip ---
  { type: "divider", priority: 80, keywords: ["muidivider", "separator"] },
  { type: "divider", priority: 81, words: ["divider"] },
  { type: "divider", priority: 82, requires: { isLikelyDividerByGeometry: true } },
  { type: "appbar", priority: 84, keywords: ["muiappbar", "topbar"] },
  { type: "appbar", priority: 85, words: ["appbar", "app bar", "toolbar"] },
  { type: "drawer", priority: 86, keywords: ["muidrawer", "sidedrawer", "navigationdrawer"] },
  { type: "drawer", priority: 87, words: ["drawer", "sidebar"] },
  { type: "breadcrumbs", priority: 88, keywords: ["muibreadcrumbs"] },
  { type: "breadcrumbs", priority: 89, words: ["breadcrumbs", "breadcrumb"] },
  { type: "tooltip", priority: 90, keywords: ["muitooltip"] },
  { type: "tooltip", priority: 91, words: ["tooltip", "hover info"] },

  // --- Priority 100–119: table (keyword + structural) ---
  { type: "table", priority: 100, keywords: ["muitable"] },
  { type: "table", priority: 101, words: ["table"] },
  { type: "table", priority: 102, requires: { isLikelyTableByStructure: true } },

  // --- Priority 120–139: navigation, snackbar, dialog, stepper ---
  { type: "navigation", priority: 120, keywords: ["bottomnavigation", "navigationbar", "muitabbar"] },
  { type: "navigation", priority: 121, words: ["navigation", "navbar"] },
  { type: "snackbar", priority: 122, keywords: ["muisnackbar", "muialert"] },
  { type: "snackbar", priority: 123, words: ["snackbar", "toast", "alert"] },
  { type: "dialog", priority: 124, keywords: ["muidialog", "modal"] },
  { type: "dialog", priority: 125, words: ["dialog", "modal"] },
  { type: "stepper", priority: 126, keywords: ["muistepper"] },
  { type: "stepper", priority: 127, words: ["stepper"] },

  // --- Priority 140–149: list (keyword + structural) ---
  { type: "list", priority: 140, keywords: ["muilist", "listitem", "muilistitem"] },
  { type: "list", priority: 141, words: ["list"] },
  { type: "list", priority: 142, requires: { hasListishChildNames: true } },
  { type: "list", priority: 143, requires: { isLikelyListByStructure: true } },

  // --- Priority 148–149: grid (CSS Grid naming / spanning hints) ---
  { type: "grid", priority: 148, requires: { hasCssGridNamingHint: true, hasChildren: true } },
  { type: "grid", priority: 149, requires: { isLikelyGridByStructure: true, hasSpanningChildHint: true } },

  // --- Priority 150–159: grid (keyword + structural) ---
  { type: "grid", priority: 150, keywords: ["muigrid", "grid2"] },
  { type: "grid", priority: 151, words: ["grid", "tile"] },
  { type: "grid", priority: 152, requires: { isLikelyGridByStructure: true } },

  // --- Priority 160–179: card (keyword + geometry) ---
  { type: "card", priority: 160, keywords: ["muicard"] },
  { type: "card", priority: 161, words: ["card"] },
  {
    type: "card",
    priority: 162,
    requires: { hasChildren: true, hasVisualSurface: true, hasRoundedCorners: true },
    geometry: { minWidth: CARD_MIN_WIDTH, minHeight: CARD_MIN_HEIGHT }
  },

  // --- Priority 180–189: paper (keyword + visual surface) ---
  { type: "paper", priority: 180, keywords: ["muipaper"] },
  { type: "paper", priority: 181, words: ["paper", "surface"] },
  {
    type: "paper",
    priority: 182,
    requires: { hasChildren: true, hasVisualSurface: true },
    excludeWords: ["card"]
  },

  // --- Priority 190–199: stack (keyword + layout) ---
  { type: "stack", priority: 190, keywords: ["muistack"] },
  { type: "stack", priority: 191, words: ["stack"] },
  {
    type: "stack",
    priority: 192,
    requires: { hasChildren: true, hasVisualSurface: false },
    layoutModes: ["HORIZONTAL", "VERTICAL"]
  },

  // --- Priority 300–319: button ---
  { type: "button", priority: 300, keywords: ["cta"] },
  { type: "button", priority: 301, requires: { hasButtonKeyword: true, hasVisualSurface: true } },
  { type: "button", priority: 302, requires: { hasButtonKeyword: true, hasStroke: true } },
  { type: "button", priority: 303, requires: { hasButtonKeyword: true, hasRoundedCorners: true } },
  { type: "button", priority: 304, requires: { hasButtonKeyword: true, hasButtonLabelHint: true } },

  // --- Priority 320–339: image ---
  {
    type: "image",
    priority: 320,
    nodeTypes: ["RECTANGLE", "FRAME", "VECTOR"],
    requires: { hasImageFill: true, hasChildren: false, hasIconLikeName: false }
  },
  {
    type: "image",
    priority: 321,
    nodeTypes: ["RECTANGLE", "FRAME"],
    requires: { hasStrongImageName: true, hasChildren: false }
  },
  {
    type: "image",
    priority: 322,
    nodeTypes: ["VECTOR"],
    requires: { hasStrongImageName: true, hasChildren: false, hasIconLikeName: false }
  }
];

// ---------------------------------------------------------------------------
// Declarative semantic hint classification rules
// ---------------------------------------------------------------------------

export const SEMANTIC_CLASSIFICATION_RULES: readonly SemanticClassificationRule[] = [
  { type: "text", priority: 10, words: ["text", "typography", "headline", "title", "label"] },
  { type: "input", priority: 20, keywords: ["formcontrol", "textfield", "text field"] },
  { type: "input", priority: 21, words: ["input", "field"] },
  { type: "select", priority: 30, words: ["select", "dropdown"] },
  { type: "switch", priority: 40, words: ["switch", "toggle"] },
  { type: "checkbox", priority: 50, words: ["checkbox"] },
  { type: "radio", priority: 60, words: ["radio"] },
  { type: "slider", priority: 70, words: ["slider", "range"] },
  { type: "rating", priority: 80, words: ["rating", "stars"] },
  { type: "chip", priority: 90, words: ["chip"] },
  { type: "tab", priority: 100, words: ["tab", "tabs"] },
  { type: "grid", priority: 110, words: ["grid", "grid2", "tile"] },
  { type: "stack", priority: 120, words: ["stack"] },
  { type: "paper", priority: 130, words: ["paper", "surface"] },
  { type: "progress", priority: 140, words: ["progress", "loader", "spinner"] },
  { type: "skeleton", priority: 150, words: ["skeleton", "placeholder"] },
  { type: "avatar", priority: 160, words: ["avatar"] },
  { type: "badge", priority: 170, words: ["badge"] },
  { type: "divider", priority: 180, words: ["divider", "separator"] },
  { type: "appbar", priority: 190, keywords: ["appbar", "app bar"] },
  { type: "appbar", priority: 191, words: ["toolbar"] },
  { type: "drawer", priority: 200, words: ["drawer", "sidebar"] },
  { type: "breadcrumbs", priority: 210, words: ["breadcrumbs", "breadcrumb"] },
  { type: "tooltip", priority: 220, words: ["tooltip"] },
  { type: "table", priority: 230, words: ["table", "datatable", "data table"] },
  { type: "navigation", priority: 240, words: ["navigation", "navbar"] },
  { type: "dialog", priority: 250, words: ["dialog", "modal"] },
  { type: "snackbar", priority: 260, words: ["snackbar", "toast", "alert"] },
  { type: "stepper", priority: 270, words: ["stepper", "step"] },
  { type: "list", priority: 280, words: ["list", "listitem"] },
  { type: "card", priority: 290, words: ["card"] },
  { type: "button", priority: 300, words: ["button", "cta"] },
  { type: "image", priority: 310, words: ["image", "photo", "illustration", "icon"] }
];

// ---------------------------------------------------------------------------
// Rule evaluation engine
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a declarative classification rule matches the given context.
 * All specified condition groups are ANDed. Within `keywords`/`words`, matches
 * are ORed. If both `keywords` and `words` are specified, at least one match
 * from either group suffices.
 */
const matchesNodeRule = <TNode extends ElementClassificationNode>(
  rule: ClassificationRule,
  context: NodeClassificationContext<TNode>
): boolean => {
  // Node type check
  if (rule.nodeTypes !== undefined && !rule.nodeTypes.includes(context.node.type)) {
    return false;
  }

  // Name matching: keywords OR words (at least one must match if either is specified)
  const hasNameCondition = rule.keywords !== undefined || rule.words !== undefined;
  if (hasNameCondition) {
    const keywordMatch = rule.keywords !== undefined && hasAnySubstring(context.name, rule.keywords);
    const wordMatch = rule.words !== undefined && hasAnyWord(context.name, rule.words);
    if (!keywordMatch && !wordMatch) {
      return false;
    }
  }

  // Context boolean requirements (AND)
  if (rule.requires !== undefined) {
    const entries = Object.entries(rule.requires) as [BooleanContextKey, boolean][];
    for (const [key, expectedValue] of entries) {
      if (context[key] !== expectedValue) {
        return false;
      }
    }
  }

  // Geometry constraints (AND)
  if (rule.geometry !== undefined) {
    if (rule.geometry.minWidth !== undefined && context.width < rule.geometry.minWidth) {
      return false;
    }
    if (rule.geometry.minHeight !== undefined && context.height < rule.geometry.minHeight) {
      return false;
    }
  }

  // Layout mode check (OR within array)
  if (rule.layoutModes !== undefined) {
    const nodeLayout = context.node.layoutMode ?? "NONE";
    if (!rule.layoutModes.includes(nodeLayout)) {
      return false;
    }
  }

  // Name exclusions (none must match)
  if (rule.excludeWords !== undefined && hasAnyWord(context.name, rule.excludeWords)) {
    return false;
  }

  return true;
};

/**
 * Evaluates whether a semantic classification rule matches the given context.
 */
const matchesSemanticRule = (
  rule: SemanticClassificationRule,
  context: SemanticHintContext
): boolean => {
  const hasNameCondition = rule.keywords !== undefined || rule.words !== undefined;
  if (hasNameCondition) {
    const keywordMatch = rule.keywords !== undefined && hasAnySubstring(context.combined, rule.keywords);
    const wordMatch = rule.words !== undefined && hasAnyWord(context.combined, rule.words);
    if (!keywordMatch && !wordMatch) {
      return false;
    }
  }
  return true;
};

// Pre-sort rules by priority at module load time for consistent evaluation order
const sortedNodeRules: readonly ClassificationRule[] = [...NODE_CLASSIFICATION_RULES].sort(
  (a, b) => a.priority - b.priority
);
const sortedSemanticRules: readonly SemanticClassificationRule[] = [...SEMANTIC_CLASSIFICATION_RULES].sort(
  (a, b) => a.priority - b.priority
);

// ---------------------------------------------------------------------------
// Public API (backward-compatible exports)
// ---------------------------------------------------------------------------

export const classifyElementTypeFromNode = <TNode extends ElementClassificationNode>({
  node,
  dependencies
}: {
  node: TNode;
  dependencies: NodeClassificationDependencies<TNode>;
}): ScreenElementIR["type"] => {
  return classifyElementTypeDecisionFromNode({
    node,
    dependencies
  }).type;
};

export interface NodeClassificationDecision {
  type: ScreenElementIR["type"];
  matchedRulePriority?: number;
  fallback: boolean;
}

export const classifyElementTypeDecisionFromNode = <TNode extends ElementClassificationNode>({
  node,
  dependencies
}: {
  node: TNode;
  dependencies: NodeClassificationDependencies<TNode>;
}): NodeClassificationDecision => {
  if (node.type === "TEXT") {
    return {
      type: "text",
      matchedRulePriority: 10,
      fallback: false
    };
  }

  const explicitBoardComponent = resolveExplicitBoardComponentFromNode(node);
  if (explicitBoardComponent?.type) {
    return {
      type: explicitBoardComponent.type,
      matchedRulePriority: 0,
      fallback: false
    };
  }

  const context = createNodeClassificationContext({
    node,
    dependencies
  });

  for (const rule of sortedNodeRules) {
    if (matchesNodeRule(rule, context)) {
      return {
        type: rule.type,
        matchedRulePriority: rule.priority,
        fallback: false
      };
    }
  }

  return {
    type: "container",
    fallback: true
  };
};

export const classifyElementTypeFromSemanticHint = ({
  semanticName,
  semanticType
}: {
  semanticName: string | undefined;
  semanticType: string | undefined;
}): ScreenElementIR["type"] | undefined => {
  const combined = `${semanticName ?? ""} ${semanticType ?? ""}`.toLowerCase();
  if (!combined.trim()) {
    return undefined;
  }
  const context: SemanticHintContext = { combined };
  for (const rule of sortedSemanticRules) {
    if (matchesSemanticRule(rule, context)) {
      return rule.type;
    }
  }
  return undefined;
};
