import type {
  CounterAxisAlignItems,
  PrimaryAxisAlignItems,
  ScreenElementIR,
  ScreenIR,
} from "./types.js";

export type DefaultLayoutKind = "flex" | "grid" | "absolute" | "block";

export type DefaultLayoutWarningCode =
  | "W_ABSOLUTE_LAYOUT_FALLBACK"
  | "W_GRID_PATTERN_AMBIGUOUS";

export interface DefaultLayoutWarning {
  code: DefaultLayoutWarningCode;
  nodeId: string;
  nodeName: string;
  message: string;
}

export interface DefaultLayoutNode {
  id: string;
  name: string;
  kind: DefaultLayoutKind;
  className: string;
  warnings: DefaultLayoutWarning[];
  children: DefaultLayoutNode[];
}

interface GridDetection {
  columnCount: number;
  gap?: number;
}

interface VirtualLayoutParent {
  id: string;
  name: string;
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const POSITION_CLUSTER_TOLERANCE_PX = 8;
const GRID_GAP_EPSILON_PX = 6;

const isFinitePositive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const px = (value: number | undefined): string | undefined => {
  if (!isFinitePositive(value)) {
    return undefined;
  }
  return `${String(Math.round(value * 1000) / 1000)}px`;
};

const arbitrary = (prefix: string, value: string | undefined): string | undefined =>
  value ? `${prefix}-[${value.replace(/\s+/g, "_")}]` : undefined;

const push = (classes: string[], value: string | undefined): void => {
  if (value && !classes.includes(value)) {
    classes.push(value);
  }
};

const toSortedClasses = (classes: readonly string[]): string =>
  classes.filter(Boolean).join(" ");

const mapPrimaryAxisToJustify = (
  value: PrimaryAxisAlignItems | undefined,
): string | undefined => {
  switch (value) {
    case "MIN":
      return "justify-start";
    case "CENTER":
      return "justify-center";
    case "MAX":
      return "justify-end";
    case "SPACE_BETWEEN":
      return "justify-between";
    default:
      return undefined;
  }
};

const mapCounterAxisToItems = (
  value: CounterAxisAlignItems | undefined,
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE",
): string | undefined => {
  switch (value) {
    case "MIN":
      return "items-start";
    case "CENTER":
      return "items-center";
    case "MAX":
      return "items-end";
    case "BASELINE":
      return "items-baseline";
    default:
      return layoutMode === "HORIZONTAL" ? "items-center" : undefined;
  }
};

const toPaddingClasses = (padding: ScreenElementIR["padding"] | ScreenIR["padding"]): string[] => {
  if (!padding) {
    return [];
  }
  const classes: string[] = [];
  const top = px(padding.top);
  const right = px(padding.right);
  const bottom = px(padding.bottom);
  const left = px(padding.left);
  if (top && top === right && top === bottom && top === left) {
    push(classes, arbitrary("p", top));
    return classes;
  }
  if (left && left === right) {
    push(classes, arbitrary("px", left));
  } else {
    push(classes, arbitrary("pl", left));
    push(classes, arbitrary("pr", right));
  }
  if (top && top === bottom) {
    push(classes, arbitrary("py", top));
  } else {
    push(classes, arbitrary("pt", top));
    push(classes, arbitrary("pb", bottom));
  }
  return classes;
};

const toPaintClasses = (element: Pick<ScreenElementIR, "type" | "fillColor" | "strokeColor" | "cornerRadius">): string[] => {
  const classes: string[] = [];
  if (element.type !== "text" && element.fillColor?.startsWith("#")) {
    push(classes, arbitrary("bg", element.fillColor));
  }
  if (element.strokeColor?.startsWith("#")) {
    push(classes, "border");
    push(classes, arbitrary("border", element.strokeColor));
  }
  push(classes, arbitrary("rounded", px(element.cornerRadius)));
  return classes;
};

const toTextClasses = (element: ScreenElementIR): string[] => {
  const classes: string[] = [];
  push(classes, arbitrary("text", px(element.fontSize)));
  if (element.fillColor?.startsWith("#")) {
    push(classes, arbitrary("text", element.fillColor));
  }
  if (isFinitePositive(element.lineHeight)) {
    push(classes, arbitrary("leading", px(element.lineHeight)));
  }
  if (typeof element.fontWeight === "number" && Number.isFinite(element.fontWeight)) {
    push(classes, arbitrary("font", String(Math.round(element.fontWeight))));
  }
  if (element.textAlign === "CENTER") {
    push(classes, "text-center");
  } else if (element.textAlign === "RIGHT") {
    push(classes, "text-right");
  }
  push(classes, "whitespace-pre-wrap");
  return classes;
};

const clusterAxisValues = (values: readonly number[]): number[] => {
  const clusters: number[] = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const previous = clusters[clusters.length - 1];
    if (previous === undefined || Math.abs(value - previous) > POSITION_CLUSTER_TOLERANCE_PX) {
      clusters.push(value);
    }
  }
  return clusters;
};

const detectRepeatedGrid = (element: ScreenElementIR): GridDetection | undefined => {
  const children = element.children ?? [];
  if (children.length < 4 || element.layoutMode === "VERTICAL" || element.layoutMode === "HORIZONTAL") {
    return undefined;
  }
  if (
    !children.every(
      (child) =>
        typeof child.x === "number" &&
        Number.isFinite(child.x) &&
        typeof child.y === "number" &&
        Number.isFinite(child.y) &&
        isFinitePositive(child.width) &&
        isFinitePositive(child.height),
    )
  ) {
    return undefined;
  }

  const columns = clusterAxisValues(children.map((child) => child.x!));
  const rows = clusterAxisValues(children.map((child) => child.y!));
  if (columns.length < 2 || rows.length < 2) {
    return undefined;
  }
  const occupiedCells = new Set<string>();
  for (const child of children) {
    const columnIndex = columns.findIndex((column) => Math.abs(column - child.x!) <= POSITION_CLUSTER_TOLERANCE_PX);
    const rowIndex = rows.findIndex((row) => Math.abs(row - child.y!) <= POSITION_CLUSTER_TOLERANCE_PX);
    occupiedCells.add(`${rowIndex}:${columnIndex}`);
  }
  if (occupiedCells.size !== children.length) {
    return undefined;
  }

  const firstColumnWidth = children.find((child) => Math.abs(child.x! - columns[0]!) <= POSITION_CLUSTER_TOLERANCE_PX)?.width;
  const firstGap =
    columns.length > 1 && isFinitePositive(firstColumnWidth)
      ? columns[1]! - columns[0]! - firstColumnWidth
      : undefined;
  const normalizedGap =
    typeof firstGap === "number" && Number.isFinite(firstGap) && firstGap >= 0
      ? firstGap
      : element.gap;
  const hasStableColumnGaps =
    columns.length < 3 ||
    columns.slice(1).every((column, index) => {
      const previousColumn = columns[index]!;
      const siblingWidth = children.find(
        (child) => Math.abs(child.x! - previousColumn) <= POSITION_CLUSTER_TOLERANCE_PX,
      )?.width;
      if (!isFinitePositive(siblingWidth) || normalizedGap === undefined) {
        return true;
      }
      return Math.abs(column - previousColumn - siblingWidth - normalizedGap) <= GRID_GAP_EPSILON_PX;
    });
  if (!hasStableColumnGaps) {
    return undefined;
  }
  return {
    columnCount: columns.length,
    ...(normalizedGap !== undefined ? { gap: normalizedGap } : {}),
  };
};

const sortByVisualOrder = (children: readonly ScreenElementIR[], layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE"): ScreenElementIR[] =>
  children
    .map((child, index) => ({ child, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.child;
      const right = rightEntry.child;
      const leftHasGeometry = typeof left.x === "number" || typeof left.y === "number";
      const rightHasGeometry = typeof right.x === "number" || typeof right.y === "number";
      if (!leftHasGeometry && !rightHasGeometry) {
        return leftEntry.index - rightEntry.index;
      }
      if (layoutMode === "HORIZONTAL") {
        return (left.x ?? 0) - (right.x ?? 0) || (left.y ?? 0) - (right.y ?? 0) || left.id.localeCompare(right.id);
      }
      return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || left.id.localeCompare(right.id);
    })
    .map((entry) => entry.child);

const hasAbsoluteGeometry = (element: ScreenElementIR): boolean =>
  typeof element.x === "number" &&
  Number.isFinite(element.x) &&
  typeof element.y === "number" &&
  Number.isFinite(element.y);

const toChildSizingClasses = ({
  element,
  parent,
  flowChild,
}: {
  element: ScreenElementIR;
  parent: VirtualLayoutParent;
  flowChild: boolean;
}): string[] => {
  const classes: string[] = [];
  if (flowChild && typeof element.layoutGrow === "number" && element.layoutGrow > 0) {
    push(classes, "flex-1");
  }
  if (flowChild && element.layoutAlign === "STRETCH") {
    push(classes, "self-stretch");
  }
  if (
    flowChild &&
    (element.constraints?.horizontal === "LEFT_RIGHT" ||
      element.constraints?.horizontal === "SCALE")
  ) {
    push(classes, "w-full");
    push(classes, arbitrary("max-w", px(element.width)));
    return classes;
  }
  if (flowChild && isFinitePositive(parent.width) && isFinitePositive(element.width)) {
    const ratio = element.width / parent.width;
    if (ratio >= 0.9) {
      push(classes, "w-full");
      push(classes, arbitrary("max-w", px(element.width)));
      return classes;
    }
  }
  push(classes, arbitrary("w", px(element.width)));
  return classes;
};

const createAbsoluteFallbackWarning = (element: ScreenElementIR): DefaultLayoutWarning => ({
  code: "W_ABSOLUTE_LAYOUT_FALLBACK",
  nodeId: element.id,
  nodeName: element.name,
  message: `Absolute layout fallback used for '${element.name}' because no deterministic flex or grid structure could be inferred.`,
});

const solveElement = ({
  element,
  parent,
}: {
  element: ScreenElementIR;
  parent: VirtualLayoutParent;
}): DefaultLayoutNode => {
  const children = element.children ?? [];
  const grid = detectRepeatedGrid(element);
  const layoutMode = element.layoutMode ?? "NONE";
  const isFlex = layoutMode === "VERTICAL" || layoutMode === "HORIZONTAL";
  const isAbsoluteFallback = !grid && !isFlex && parent.layoutMode === "NONE" && hasAbsoluteGeometry(element);
  const kind: DefaultLayoutKind = grid ? "grid" : isFlex ? "flex" : isAbsoluteFallback ? "absolute" : "block";
  const classes: string[] = [];

  if (kind === "absolute") {
    push(classes, "absolute");
    push(classes, arbitrary("left", px((element.x ?? 0) - (parent.x ?? 0))));
    push(classes, arbitrary("top", px((element.y ?? 0) - (parent.y ?? 0))));
  } else if (kind === "flex") {
    push(classes, "flex");
    push(classes, layoutMode === "HORIZONTAL" ? "flex-row" : "flex-col");
    push(classes, mapPrimaryAxisToJustify(element.primaryAxisAlignItems));
    push(classes, mapCounterAxisToItems(element.counterAxisAlignItems, layoutMode));
  } else if (grid) {
    push(classes, "grid");
    push(classes, `grid-cols-${String(grid.columnCount)}`);
  } else if (children.length > 0 && layoutMode === "NONE") {
    push(classes, "relative");
  }

  push(classes, arbitrary("gap", px(kind === "grid" ? grid?.gap ?? element.gap : element.gap)));
  push(classes, arbitrary("min-h", children.length > 0 ? px(element.height) : undefined));
  classes.push(...toChildSizingClasses({ element, parent, flowChild: kind !== "absolute" }));
  push(classes, arbitrary("h", children.length === 0 ? px(element.height) : undefined));
  classes.push(...toPaddingClasses(element.padding));
  classes.push(...toPaintClasses(element));
  if (element.type === "text") {
    classes.push(...toTextClasses(element));
  }

  const warnings = isAbsoluteFallback ? [createAbsoluteFallbackWarning(element)] : [];
  const childParent: VirtualLayoutParent = {
    id: element.id,
    name: element.name,
    layoutMode: kind === "grid" ? "HORIZONTAL" : layoutMode,
    ...(element.x !== undefined ? { x: element.x } : {}),
    ...(element.y !== undefined ? { y: element.y } : {}),
    ...(element.width !== undefined ? { width: element.width } : {}),
    ...(element.height !== undefined ? { height: element.height } : {}),
  };
  const solvedChildren = sortByVisualOrder(children, grid ? "HORIZONTAL" : layoutMode).map((child) =>
    solveElement({ element: child, parent: childParent }),
  );
  return {
    id: element.id,
    name: element.name,
    kind,
    className: toSortedClasses(classes),
    warnings: [...warnings, ...solvedChildren.flatMap((child) => child.warnings)],
    children: solvedChildren,
  };
};

export const solveDefaultScreenLayout = (screen: ScreenIR): DefaultLayoutNode => {
  const screenElement: ScreenElementIR = {
    id: screen.id,
    name: screen.name,
    nodeType: "SCREEN",
    type: "container",
    layoutMode: screen.layoutMode,
    gap: screen.gap,
    padding: screen.padding,
    children: screen.children,
    ...(screen.primaryAxisAlignItems !== undefined ? { primaryAxisAlignItems: screen.primaryAxisAlignItems } : {}),
    ...(screen.counterAxisAlignItems !== undefined ? { counterAxisAlignItems: screen.counterAxisAlignItems } : {}),
    ...(screen.width !== undefined ? { width: screen.width } : {}),
    ...(screen.height !== undefined ? { height: screen.height } : {}),
    ...(screen.fillColor !== undefined ? { fillColor: screen.fillColor } : {}),
    ...(screen.fillGradient !== undefined ? { fillGradient: screen.fillGradient } : {}),
  };
  const solved = solveElement({
    element: screenElement,
    parent: {
      id: "__root__",
      name: "root",
      layoutMode: "VERTICAL",
      ...(screen.width !== undefined ? { width: screen.width } : {}),
      ...(screen.height !== undefined ? { height: screen.height } : {}),
    },
  });
  const rootClasses = ["min-h-screen", "w-full"];
  if (solved.className) {
    rootClasses.push(solved.className);
  }
  return {
    ...solved,
    className: toSortedClasses(rootClasses),
  };
};
