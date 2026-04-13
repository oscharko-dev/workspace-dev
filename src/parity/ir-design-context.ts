// ---------------------------------------------------------------------------
// ir-design-context.ts — Figma Design-Context to DesignIR transformer
// Issue #1002: Converts structured Figma node data into the DesignIR model
// ---------------------------------------------------------------------------
import type {
  DesignIR,
  DesignTokens,
  FigmaMcpEnrichment,
  GenerationMetrics,
  ScreenElementIR,
  ScreenElementType,
  ScreenIR,
} from "./types.js";
import type { FigmaNode, FigmaFile } from "./ir-helpers.js";
import { resolveFirstVisibleSolidPaint, toHexColor } from "./ir-colors.js";
import { deriveTokens } from "./ir-tokens.js";

// ---------------------------------------------------------------------------
// Type narrowing for unknown subtree documents
// ---------------------------------------------------------------------------

const isFigmaNodeLike = (value: unknown): value is FigmaNode =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof (value as Record<string, unknown>)["id"] === "string" &&
  "type" in value &&
  typeof (value as Record<string, unknown>)["type"] === "string";

// ---------------------------------------------------------------------------
// mapFigmaNodeTypeToIrElementType
// ---------------------------------------------------------------------------

export const mapFigmaNodeTypeToIrElementType = (
  nodeType: string,
  layoutMode?: string,
): ScreenElementType => {
  switch (nodeType) {
    case "FRAME":
      return layoutMode !== undefined && layoutMode !== "NONE"
        ? "container"
        : "frame";
    case "COMPONENT":
      return "component";
    case "INSTANCE":
      return "instance";
    case "TEXT":
      return "text";
    case "RECTANGLE":
      return "shape";
    case "VECTOR":
    case "ELLIPSE":
    case "STAR":
    case "LINE":
    case "BOOLEAN_OPERATION":
      return "vector";
    case "GROUP":
      return "group";
    case "SECTION":
      return "section";
    case "COMPONENT_SET":
      return "componentSet";
    default:
      return "container";
  }
};

// ---------------------------------------------------------------------------
// Visual property extraction helpers
// ---------------------------------------------------------------------------

const extractFillColor = (node: FigmaNode): string | undefined => {
  const paint = resolveFirstVisibleSolidPaint(node.fills);
  if (!paint) {
    return undefined;
  }
  return toHexColor(paint.color, paint.opacity);
};

const extractStrokeColor = (node: FigmaNode): string | undefined => {
  const paint = resolveFirstVisibleSolidPaint(node.strokes);
  if (!paint) {
    return undefined;
  }
  return toHexColor(paint.color, paint.opacity);
};

const extractDimensions = (
  node: FigmaNode,
): { width?: number; height?: number } => {
  if (node.absoluteBoundingBox) {
    return {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }
  const size = (node as unknown as Record<string, unknown>)["size"];
  if (typeof size === "object" && size !== null && "x" in size && "y" in size) {
    const sizeRecord = size as Record<string, unknown>;
    const x = sizeRecord["x"];
    const y = sizeRecord["y"];
    if (typeof x === "number" && typeof y === "number") {
      return { width: x, height: y };
    }
  }
  return {};
};

const extractPadding = (
  node: FigmaNode,
): { top: number; right: number; bottom: number; left: number } => ({
  top: node.paddingTop ?? 0,
  right: node.paddingRight ?? 0,
  bottom: node.paddingBottom ?? 0,
  left: node.paddingLeft ?? 0,
});

const extractLayoutMode = (
  node: FigmaNode,
): "VERTICAL" | "HORIZONTAL" | "NONE" => {
  const mode = node.layoutMode;
  if (mode === "VERTICAL" || mode === "HORIZONTAL") {
    return mode;
  }
  return "NONE";
};

// ---------------------------------------------------------------------------
// transformNodeToScreenElement
// ---------------------------------------------------------------------------

export const transformNodeToScreenElement = (
  document: unknown,
): ScreenElementIR => {
  const node = isFigmaNodeLike(document)
    ? document
    : ({ id: "unknown", type: "FRAME", name: "Unknown" } satisfies FigmaNode);

  const elementType = mapFigmaNodeTypeToIrElementType(
    node.type,
    node.layoutMode,
  );

  const dimensions = extractDimensions(node);
  const fillColor = extractFillColor(node);
  const strokeColor = extractStrokeColor(node);
  const layoutMode = extractLayoutMode(node);
  const padding = extractPadding(node);
  const gap = node.itemSpacing ?? 0;

  const children: ScreenElementIR[] | undefined =
    Array.isArray(node.children) && node.children.length > 0
      ? node.children.map(transformNodeToScreenElement)
      : undefined;

  const base = {
    id: node.id,
    name: node.name ?? "",
    nodeType: node.type,
    semanticSource: "board" as const,
    ...(dimensions.width !== undefined ? { width: dimensions.width } : {}),
    ...(dimensions.height !== undefined ? { height: dimensions.height } : {}),
    ...(fillColor !== undefined ? { fillColor } : {}),
    ...(strokeColor !== undefined ? { strokeColor } : {}),
    ...(node.strokeWeight !== undefined
      ? { strokeWidth: node.strokeWeight }
      : {}),
    ...(node.cornerRadius !== undefined
      ? { cornerRadius: node.cornerRadius }
      : {}),
    ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    ...(layoutMode !== "NONE" ? { layoutMode } : {}),
    ...(gap > 0 ? { gap } : {}),
    ...(padding.top > 0 ||
    padding.right > 0 ||
    padding.bottom > 0 ||
    padding.left > 0
      ? { padding }
      : {}),
    ...(node.primaryAxisAlignItems !== undefined
      ? { primaryAxisAlignItems: node.primaryAxisAlignItems }
      : {}),
    ...(node.counterAxisAlignItems !== undefined
      ? { counterAxisAlignItems: node.counterAxisAlignItems }
      : {}),
    ...(children !== undefined ? { children } : {}),
  };

  if (elementType === "text") {
    const style = node.style;
    return {
      ...base,
      type: "text" as const,
      text: node.characters ?? "",
      ...(style?.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
      ...(style?.fontWeight !== undefined
        ? { fontWeight: style.fontWeight }
        : {}),
      ...(style?.fontFamily !== undefined
        ? { fontFamily: style.fontFamily }
        : {}),
      ...(style?.lineHeightPx !== undefined
        ? { lineHeight: style.lineHeightPx }
        : {}),
      ...(style?.letterSpacing !== undefined
        ? { letterSpacing: style.letterSpacing }
        : {}),
      ...(style?.textAlignHorizontal !== undefined
        ? { textAlign: style.textAlignHorizontal }
        : {}),
    };
  }

  return {
    ...base,
    type: elementType,
  };
};

// ---------------------------------------------------------------------------
// transformDesignContextToScreens
// ---------------------------------------------------------------------------

export const transformDesignContextToScreens = ({
  authoritativeSubtrees,
}: {
  authoritativeSubtrees: ReadonlyArray<{
    nodeId: string;
    document: unknown;
  }>;
  enrichment?: FigmaMcpEnrichment;
}): ScreenIR[] =>
  authoritativeSubtrees.map((subtree): ScreenIR => {
    const doc = subtree.document;
    const node = isFigmaNodeLike(doc)
      ? doc
      : ({
          id: subtree.nodeId,
          type: "FRAME",
          name: subtree.nodeId,
        } satisfies FigmaNode);

    const layoutMode = extractLayoutMode(node);
    const padding = extractPadding(node);
    const dimensions = extractDimensions(node);
    const fillColor = extractFillColor(node);

    const children: ScreenElementIR[] =
      Array.isArray(node.children) && node.children.length > 0
        ? node.children.map(transformNodeToScreenElement)
        : [];

    return {
      id: node.id,
      name: node.name ?? subtree.nodeId,
      layoutMode,
      gap: node.itemSpacing ?? 0,
      padding,
      ...(dimensions.width !== undefined ? { width: dimensions.width } : {}),
      ...(dimensions.height !== undefined ? { height: dimensions.height } : {}),
      ...(fillColor !== undefined ? { fillColor } : {}),
      ...(node.primaryAxisAlignItems !== undefined
        ? { primaryAxisAlignItems: node.primaryAxisAlignItems }
        : {}),
      ...(node.counterAxisAlignItems !== undefined
        ? { counterAxisAlignItems: node.counterAxisAlignItems }
        : {}),
      children,
    };
  });

// ---------------------------------------------------------------------------
// transformDesignContextToTokens
// ---------------------------------------------------------------------------

const EMPTY_FIGMA_FILE: FigmaFile = {
  name: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [],
  },
};

export const transformDesignContextToTokens = ({
  enrichment,
}: {
  enrichment?: FigmaMcpEnrichment;
}): DesignTokens => deriveTokens(EMPTY_FIGMA_FILE, enrichment);

// ---------------------------------------------------------------------------
// Element counting
// ---------------------------------------------------------------------------

const countElements = (elements: ReadonlyArray<ScreenElementIR>): number => {
  let count = 0;
  for (const element of elements) {
    count += 1;
    if (element.children && element.children.length > 0) {
      count += countElements(element.children);
    }
  }
  return count;
};

// ---------------------------------------------------------------------------
// transformDesignContextToDesignIr
// ---------------------------------------------------------------------------

export const transformDesignContextToDesignIr = ({
  authoritativeSubtrees,
  enrichment,
  sourceName,
}: {
  authoritativeSubtrees: ReadonlyArray<{
    nodeId: string;
    document: unknown;
  }>;
  enrichment?: FigmaMcpEnrichment;
  sourceName?: string;
}): DesignIR => {
  const screens = transformDesignContextToScreens({
    authoritativeSubtrees,
    ...(enrichment !== undefined ? { enrichment } : {}),
  });
  const tokens = transformDesignContextToTokens(
    enrichment !== undefined ? { enrichment } : {},
  );

  const metrics: GenerationMetrics = {
    fetchedNodes: 0,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    prototypeNavigationDetected: 0,
    prototypeNavigationResolved: 0,
    prototypeNavigationUnresolved: 0,
    screenElementCounts: screens.map((s) => ({
      screenId: s.id,
      screenName: s.name,
      elements: countElements(s.children),
    })),
    truncatedScreens: [],
    depthTruncatedScreens: [],
    classificationFallbacks: [],
    degradedGeometryNodes: [],
    nodeDiagnostics: [],
  };

  return {
    sourceName: sourceName ?? "Figma Design Context",
    screens,
    tokens,
    metrics,
  };
};
