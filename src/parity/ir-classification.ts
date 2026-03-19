import type { ScreenElementIR } from "./types.js";

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

interface SemanticHintContext {
  combined: string;
}

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
}

interface NodeClassificationDependencies<TNode extends ElementClassificationNode> {
  hasSolidFill(node: TNode): boolean;
  hasGradientFill(node: TNode): boolean;
  hasImageFill(node: TNode): boolean;
  hasVisibleShadow(node: TNode): boolean;
  hasStroke(node: TNode): boolean;
}

interface TypeRule<TContext> {
  type: ScreenElementIR["type"];
  matches(context: TContext): boolean;
}

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const hasAnySubstring = (value: string, tokens: string[]): boolean => {
  return tokens.some((token) => value.includes(token));
};

export const hasAnyWord = (value: string, words: string[]): boolean => {
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
  const hasRoundedCorners = (node.cornerRadius ?? 0) >= 8;
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
  const isFieldSized = width >= 96 && height >= 28 && height <= 140;
  const isLikelyDividerByGeometry =
    !hasChildren && hasVisualFill && ((width >= 16 && height > 0 && height <= 2) || (height >= 16 && width > 0 && width <= 2));

  const hasTableishChildNames = children.some((child) => {
    const childName = (child.name ?? "").toLowerCase();
    return (
      childName.includes("tablerow") ||
      childName.includes("table row") ||
      childName.includes("tablecell") ||
      childName.includes("table cell")
    );
  });
  const hasRowCellStructure = children.some((child) => (child.children?.length ?? 0) >= 2);
  const isLikelyTableByStructure = hasChildren && childCount >= 2 && hasRowCellStructure && (width >= 180 || hasTableishChildNames);
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
    threshold: 18
  });
  const columnBuckets = countPositionBuckets({
    values: children
      .map((child) => child.absoluteBoundingBox?.x)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => left - right),
    threshold: 18
  });
  const isLikelyGridByStructure = childCount >= 4 && rowBuckets >= 2 && columnBuckets >= 2 && node.layoutMode !== "VERTICAL";
  const isLikelyListByStructure = !hasVisualSurface && childCount >= 3 && textChildCount >= 2 && (node.layoutMode === "VERTICAL" || node.layoutMode === "NONE");

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
    isLikelyListByStructure
  };
};

const NODE_TYPE_RULES: ReadonlyArray<TypeRule<NodeClassificationContext<ElementClassificationNode>>> = [
  {
    type: "text",
    matches: ({ node }) => node.type === "TEXT"
  },
  {
    type: "select",
    matches: ({ hasSelectSemantic, name, isFieldSized, hasChildren }) =>
      (hasSelectSemantic || hasAnyWord(name, ["select", "dropdown"])) && (isFieldSized || hasChildren)
  },
  {
    type: "slider",
    matches: ({ name }) => hasAnySubstring(name, ["muislider", "slider"]) || hasAnyWord(name, ["slider", "range"])
  },
  {
    type: "rating",
    matches: ({ name }) => hasAnySubstring(name, ["muirating"]) || hasAnyWord(name, ["rating", "stars", "star rating"])
  },
  {
    type: "skeleton",
    matches: ({ name }) =>
      hasAnySubstring(name, ["muiskeleton", "loadingplaceholder"]) ||
      hasAnyWord(name, ["skeleton", "placeholder shimmer", "loading skeleton"])
  },
  {
    type: "input",
    matches: ({ hasInputSemantic, name, isFieldSized, hasChildren }) =>
      (hasInputSemantic || hasAnyWord(name, ["input", "textfield", "field"])) && (isFieldSized || hasChildren)
  },
  {
    type: "switch",
    matches: ({ name }) => hasAnySubstring(name, ["muiswitch", "switchbase"]) || hasAnyWord(name, ["switch", "toggle"])
  },
  {
    type: "checkbox",
    matches: ({ name }) => hasAnySubstring(name, ["muicheckbox"]) || hasAnyWord(name, ["checkbox"])
  },
  {
    type: "radio",
    matches: ({ name }) => hasAnySubstring(name, ["muiradio"]) || hasAnyWord(name, ["radio"])
  },
  {
    type: "chip",
    matches: ({ name }) => hasAnySubstring(name, ["muichip"]) || hasAnyWord(name, ["chip"])
  },
  {
    type: "tab",
    matches: ({ name }) => hasAnySubstring(name, ["muitabs", "muitab"]) || hasAnyWord(name, ["tab", "tabs"])
  },
  {
    type: "progress",
    matches: ({ name }) =>
      hasAnySubstring(name, ["muicircularprogress", "muilinearprogress", "circularprogress", "linearprogress", "progressbar"]) ||
      hasAnyWord(name, ["progress", "loader", "loading", "spinner"])
  },
  {
    type: "avatar",
    matches: ({ name }) => hasAnySubstring(name, ["muiavatar"]) || hasAnyWord(name, ["avatar"])
  },
  {
    type: "badge",
    matches: ({ name }) => hasAnySubstring(name, ["muibadge"]) || hasAnyWord(name, ["badge"])
  },
  {
    type: "divider",
    matches: ({ name, isLikelyDividerByGeometry }) =>
      hasAnySubstring(name, ["muidivider", "separator"]) || hasAnyWord(name, ["divider"]) || isLikelyDividerByGeometry
  },
  {
    type: "appbar",
    matches: ({ name }) => hasAnySubstring(name, ["muiappbar", "topbar"]) || hasAnyWord(name, ["appbar", "app bar", "toolbar"])
  },
  {
    type: "drawer",
    matches: ({ name }) => hasAnySubstring(name, ["muidrawer", "sidedrawer", "navigationdrawer"]) || hasAnyWord(name, ["drawer", "sidebar"])
  },
  {
    type: "breadcrumbs",
    matches: ({ name }) => hasAnySubstring(name, ["muibreadcrumbs"]) || hasAnyWord(name, ["breadcrumbs", "breadcrumb"])
  },
  {
    type: "tooltip",
    matches: ({ name }) => hasAnySubstring(name, ["muitooltip"]) || hasAnyWord(name, ["tooltip", "hover info"])
  },
  {
    type: "table",
    matches: ({ name }) => hasAnySubstring(name, ["muitable"]) || hasAnyWord(name, ["table"])
  },
  {
    type: "table",
    matches: ({ isLikelyTableByStructure }) => isLikelyTableByStructure
  },
  {
    type: "navigation",
    matches: ({ name }) =>
      hasAnySubstring(name, ["bottomnavigation", "navigationbar", "muitabbar"]) || hasAnyWord(name, ["navigation", "navbar"])
  },
  {
    type: "snackbar",
    matches: ({ name }) => hasAnySubstring(name, ["muisnackbar", "muialert"]) || hasAnyWord(name, ["snackbar", "toast", "alert"])
  },
  {
    type: "dialog",
    matches: ({ name }) => hasAnySubstring(name, ["muidialog", "modal"]) || hasAnyWord(name, ["dialog", "modal"])
  },
  {
    type: "stepper",
    matches: ({ name }) => hasAnySubstring(name, ["muistepper"]) || hasAnyWord(name, ["stepper"])
  },
  {
    type: "list",
    matches: ({ name, hasListishChildNames, isLikelyListByStructure }) =>
      hasAnySubstring(name, ["muilist", "listitem", "muilistitem"]) ||
      hasAnyWord(name, ["list"]) ||
      hasListishChildNames ||
      isLikelyListByStructure
  },
  {
    type: "grid",
    matches: ({ name }) => hasAnySubstring(name, ["muigrid", "grid2"]) || hasAnyWord(name, ["grid", "tile"])
  },
  {
    type: "grid",
    matches: ({ isLikelyGridByStructure }) => isLikelyGridByStructure
  },
  {
    type: "card",
    matches: ({ name }) => hasAnySubstring(name, ["muicard"]) || hasAnyWord(name, ["card"])
  },
  {
    type: "card",
    matches: ({ hasChildren, hasVisualSurface, hasRoundedCorners, width, height }) =>
      hasChildren && hasVisualSurface && hasRoundedCorners && width >= 120 && height >= 80
  },
  {
    type: "paper",
    matches: ({ name }) => hasAnySubstring(name, ["muipaper"]) || hasAnyWord(name, ["paper", "surface"])
  },
  {
    type: "paper",
    matches: ({ hasChildren, hasVisualSurface, name }) => hasChildren && hasVisualSurface && !hasAnyWord(name, ["card"])
  },
  {
    type: "stack",
    matches: ({ name }) => hasAnySubstring(name, ["muistack"]) || hasAnyWord(name, ["stack"])
  },
  {
    type: "stack",
    matches: ({ hasChildren, node, hasVisualSurface }) =>
      hasChildren && (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") && !hasVisualSurface
  },
  {
    type: "button",
    matches: ({ name, hasButtonKeyword, hasVisualSurface, hasStroke, hasRoundedCorners, hasButtonLabelHint }) =>
      name.includes("cta") || (hasButtonKeyword && (hasVisualSurface || hasStroke || hasRoundedCorners || hasButtonLabelHint))
  },
  {
    type: "image",
    matches: ({ node, hasImageFill, hasChildren, hasIconLikeName }) =>
      (node.type === "RECTANGLE" || node.type === "FRAME" || node.type === "VECTOR") && hasImageFill && !hasChildren && !hasIconLikeName
  },
  {
    type: "image",
    matches: ({ node, hasStrongImageName, hasChildren }) =>
      (node.type === "RECTANGLE" || node.type === "FRAME") && hasStrongImageName && !hasChildren
  },
  {
    type: "image",
    matches: ({ node, hasStrongImageName, hasChildren, hasIconLikeName }) =>
      node.type === "VECTOR" && hasStrongImageName && !hasChildren && !hasIconLikeName
  }
];

const SEMANTIC_HINT_RULES: ReadonlyArray<TypeRule<SemanticHintContext>> = [
  {
    type: "text",
    matches: ({ combined }) => hasAnyWord(combined, ["text", "typography", "headline", "title", "label"])
  },
  {
    type: "input",
    matches: ({ combined }) => hasAnySubstring(combined, ["formcontrol", "textfield", "text field"]) || hasAnyWord(combined, ["input", "field"])
  },
  {
    type: "select",
    matches: ({ combined }) => hasAnyWord(combined, ["select", "dropdown"])
  },
  {
    type: "switch",
    matches: ({ combined }) => hasAnyWord(combined, ["switch", "toggle"])
  },
  {
    type: "checkbox",
    matches: ({ combined }) => hasAnyWord(combined, ["checkbox"])
  },
  {
    type: "radio",
    matches: ({ combined }) => hasAnyWord(combined, ["radio"])
  },
  {
    type: "slider",
    matches: ({ combined }) => hasAnyWord(combined, ["slider", "range"])
  },
  {
    type: "rating",
    matches: ({ combined }) => hasAnyWord(combined, ["rating", "stars"])
  },
  {
    type: "chip",
    matches: ({ combined }) => hasAnyWord(combined, ["chip"])
  },
  {
    type: "tab",
    matches: ({ combined }) => hasAnyWord(combined, ["tab", "tabs"])
  },
  {
    type: "grid",
    matches: ({ combined }) => hasAnyWord(combined, ["grid", "grid2", "tile"])
  },
  {
    type: "stack",
    matches: ({ combined }) => hasAnyWord(combined, ["stack"])
  },
  {
    type: "paper",
    matches: ({ combined }) => hasAnyWord(combined, ["paper", "surface"])
  },
  {
    type: "progress",
    matches: ({ combined }) => hasAnyWord(combined, ["progress", "loader", "spinner"])
  },
  {
    type: "skeleton",
    matches: ({ combined }) => hasAnyWord(combined, ["skeleton", "placeholder"])
  },
  {
    type: "avatar",
    matches: ({ combined }) => hasAnyWord(combined, ["avatar"])
  },
  {
    type: "badge",
    matches: ({ combined }) => hasAnyWord(combined, ["badge"])
  },
  {
    type: "divider",
    matches: ({ combined }) => hasAnyWord(combined, ["divider", "separator"])
  },
  {
    type: "appbar",
    matches: ({ combined }) => hasAnySubstring(combined, ["appbar", "app bar"]) || hasAnyWord(combined, ["toolbar"])
  },
  {
    type: "drawer",
    matches: ({ combined }) => hasAnyWord(combined, ["drawer", "sidebar"])
  },
  {
    type: "breadcrumbs",
    matches: ({ combined }) => hasAnyWord(combined, ["breadcrumbs", "breadcrumb"])
  },
  {
    type: "tooltip",
    matches: ({ combined }) => hasAnyWord(combined, ["tooltip"])
  },
  {
    type: "table",
    matches: ({ combined }) => hasAnyWord(combined, ["table", "datatable", "data table"])
  },
  {
    type: "navigation",
    matches: ({ combined }) => hasAnyWord(combined, ["navigation", "navbar"])
  },
  {
    type: "dialog",
    matches: ({ combined }) => hasAnyWord(combined, ["dialog", "modal"])
  },
  {
    type: "snackbar",
    matches: ({ combined }) => hasAnyWord(combined, ["snackbar", "toast", "alert"])
  },
  {
    type: "stepper",
    matches: ({ combined }) => hasAnyWord(combined, ["stepper", "step"])
  },
  {
    type: "list",
    matches: ({ combined }) => hasAnyWord(combined, ["list", "listitem"])
  },
  {
    type: "card",
    matches: ({ combined }) => hasAnyWord(combined, ["card"])
  },
  {
    type: "button",
    matches: ({ combined }) => hasAnyWord(combined, ["button", "cta"])
  },
  {
    type: "image",
    matches: ({ combined }) => hasAnyWord(combined, ["image", "photo", "illustration", "icon"])
  }
];

export const classifyElementTypeFromNode = <TNode extends ElementClassificationNode>({
  node,
  dependencies
}: {
  node: TNode;
  dependencies: NodeClassificationDependencies<TNode>;
}): ScreenElementIR["type"] => {
  const context = createNodeClassificationContext({
    node,
    dependencies
  });

  for (const rule of NODE_TYPE_RULES as ReadonlyArray<TypeRule<NodeClassificationContext<TNode>>>) {
    if (rule.matches(context)) {
      return rule.type;
    }
  }

  return "container";
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
  for (const rule of SEMANTIC_HINT_RULES) {
    if (rule.matches(context)) {
      return rule.type;
    }
  }
  return undefined;
};
