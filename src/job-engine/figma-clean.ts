import type { FigmaFileResponse } from "./types.js";

const PLACEHOLDER_TEXT_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);

const ALLOWED_FILE_KEYS = new Set(["name", "document"]);

const ALLOWED_NODE_KEYS = new Set([
  "id",
  "name",
  "type",
  "visible",
  "children",
  "fillGeometry",
  "strokeGeometry",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "itemSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fills",
  "strokes",
  "strokeWeight",
  "absoluteBoundingBox",
  "characters",
  "style",
  "cornerRadius",
  "componentProperties",
  "componentPropertyDefinitions"
]);

const ALLOWED_COLOR_KEYS = new Set(["r", "g", "b", "a"]);
const ALLOWED_PAINT_KEYS = new Set(["type", "color", "opacity"]);
const ALLOWED_BOX_KEYS = new Set(["x", "y", "width", "height"]);
const ALLOWED_STYLE_KEYS = new Set(["fontSize", "fontWeight", "fontFamily", "lineHeightPx", "textAlignHorizontal"]);
const ALLOWED_GEOMETRY_KEYS = new Set(["path", "windingRule"]);
const ALLOWED_COMPONENT_PROPERTY_KEYS = new Set(["type", "value"]);
const ALLOWED_COMPONENT_PROPERTY_DEFINITION_KEYS = new Set(["type", "defaultValue", "variantOptions"]);

interface FigmaCleaningAccumulator {
  outputNodeCount: number;
  removedHiddenNodes: number;
  removedPlaceholderNodes: number;
  removedHelperNodes: number;
  removedInvalidNodes: number;
  removedPropertyCount: number;
}

export interface FigmaCleaningReport {
  inputNodeCount: number;
  outputNodeCount: number;
  removedHiddenNodes: number;
  removedPlaceholderNodes: number;
  removedHelperNodes: number;
  removedInvalidNodes: number;
  removedPropertyCount: number;
  screenCandidateCount: number;
}

export interface CleanFigmaResult {
  cleanedFile: FigmaFileResponse;
  report: FigmaCleaningReport;
}

interface CleanNodeContext {
  inInstanceContext: boolean;
  metrics: FigmaCleaningAccumulator;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const countRemovedKeys = (value: Record<string, unknown>, allowList: Set<string>): number => {
  return Object.keys(value).filter((key) => !allowList.has(key)).length;
};

const countSubtreeNodes = (value: unknown): number => {
  if (!isRecord(value)) {
    return 0;
  }
  const children = Array.isArray(value.children) ? value.children : [];
  let count = 1;
  for (const child of children) {
    count += countSubtreeNodes(child);
  }
  return count;
};

const hasPlaceholderText = (node: Record<string, unknown>): boolean => {
  if (node.type !== "TEXT") {
    return false;
  }
  if (typeof node.characters !== "string") {
    return false;
  }
  return PLACEHOLDER_TEXT_VALUES.has(node.characters.trim().toLowerCase());
};

const isGeometryEmpty = (node: Record<string, unknown>): boolean => {
  if (!isRecord(node.absoluteBoundingBox)) {
    return false;
  }
  const width = node.absoluteBoundingBox.width;
  const height = node.absoluteBoundingBox.height;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    return false;
  }
  return width <= 0 || height <= 0;
};

const isHelperItemNode = (node: Record<string, unknown>): boolean => {
  if (typeof node.name !== "string") {
    return false;
  }
  const normalized = node.name.trim().toLowerCase();
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

const sanitizeColor = (value: unknown, metrics: FigmaCleaningAccumulator): Record<string, number> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_COLOR_KEYS);

  const next: Record<string, number> = {};
  if (isFiniteNumber(value.r)) {
    next.r = value.r;
  }
  if (isFiniteNumber(value.g)) {
    next.g = value.g;
  }
  if (isFiniteNumber(value.b)) {
    next.b = value.b;
  }
  if (isFiniteNumber(value.a)) {
    next.a = value.a;
  }

  return "r" in next && "g" in next && "b" in next ? next : undefined;
};

const sanitizePaints = (value: unknown, metrics: FigmaCleaningAccumulator): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .map((paintCandidate) => {
      if (!isRecord(paintCandidate)) {
        return undefined;
      }

      metrics.removedPropertyCount += countRemovedKeys(paintCandidate, ALLOWED_PAINT_KEYS);

      const type = typeof paintCandidate.type === "string" ? paintCandidate.type : undefined;
      if (type !== "SOLID") {
        return undefined;
      }

      const color = sanitizeColor(paintCandidate.color, metrics);
      if (!color) {
        return undefined;
      }

      const nextPaint: Record<string, unknown> = { type, color };
      if (isFiniteNumber(paintCandidate.opacity)) {
        nextPaint.opacity = paintCandidate.opacity;
      }
      return nextPaint;
    })
    .filter((paint): paint is Record<string, unknown> => Boolean(paint));

  return sanitized.length > 0 ? sanitized : undefined;
};

const sanitizeAbsoluteBoundingBox = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Record<string, number> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_BOX_KEYS);

  const next: Record<string, number> = {};
  if (isFiniteNumber(value.x)) {
    next.x = value.x;
  }
  if (isFiniteNumber(value.y)) {
    next.y = value.y;
  }
  if (isFiniteNumber(value.width)) {
    next.width = value.width;
  }
  if (isFiniteNumber(value.height)) {
    next.height = value.height;
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const sanitizeStyle = (value: unknown, metrics: FigmaCleaningAccumulator): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_STYLE_KEYS);

  const next: Record<string, unknown> = {};
  if (isFiniteNumber(value.fontSize)) {
    next.fontSize = value.fontSize;
  }
  if (isFiniteNumber(value.fontWeight)) {
    next.fontWeight = value.fontWeight;
  }
  if (typeof value.fontFamily === "string") {
    next.fontFamily = value.fontFamily;
  }
  if (isFiniteNumber(value.lineHeightPx)) {
    next.lineHeightPx = value.lineHeightPx;
  }
  if (typeof value.textAlignHorizontal === "string") {
    next.textAlignHorizontal = value.textAlignHorizontal;
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const sanitizeGeometryList = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Array<Record<string, string>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const next = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return undefined;
      }
      metrics.removedPropertyCount += countRemovedKeys(entry, ALLOWED_GEOMETRY_KEYS);

      if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
        return undefined;
      }

      const geometry: Record<string, string> = { path: entry.path };
      if (typeof entry.windingRule === "string") {
        geometry.windingRule = entry.windingRule;
      }
      return geometry;
    })
    .filter((entry): entry is Record<string, string> => Boolean(entry));

  return next.length > 0 ? next : undefined;
};

const sanitizeVariantComponentProperties = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Record<string, { type: "VARIANT"; value: string }> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const next: Record<string, { type: "VARIANT"; value: string }> = {};
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    if (!isRecord(propertyValue)) {
      continue;
    }
    metrics.removedPropertyCount += countRemovedKeys(propertyValue, ALLOWED_COMPONENT_PROPERTY_KEYS);

    const propertyType = typeof propertyValue.type === "string" ? propertyValue.type.trim().toUpperCase() : "";
    if (propertyType !== "VARIANT") {
      continue;
    }
    if (typeof propertyValue.value !== "string") {
      continue;
    }
    const normalizedValue = propertyValue.value.trim();
    if (normalizedValue.length === 0) {
      continue;
    }
    next[propertyName] = {
      type: "VARIANT",
      value: normalizedValue
    };
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const sanitizeVariantComponentPropertyDefinitions = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Record<string, { type: "VARIANT"; defaultValue?: string; variantOptions?: string[] }> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const next: Record<string, { type: "VARIANT"; defaultValue?: string; variantOptions?: string[] }> = {};
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    if (!isRecord(propertyValue)) {
      continue;
    }
    metrics.removedPropertyCount += countRemovedKeys(propertyValue, ALLOWED_COMPONENT_PROPERTY_DEFINITION_KEYS);

    const propertyType = typeof propertyValue.type === "string" ? propertyValue.type.trim().toUpperCase() : "";
    if (propertyType !== "VARIANT") {
      continue;
    }

    const definition: { type: "VARIANT"; defaultValue?: string; variantOptions?: string[] } = {
      type: "VARIANT"
    };
    if (typeof propertyValue.defaultValue === "string") {
      const defaultValue = propertyValue.defaultValue.trim();
      if (defaultValue.length > 0) {
        definition.defaultValue = defaultValue;
      }
    }
    if (Array.isArray(propertyValue.variantOptions)) {
      const variantOptions = propertyValue.variantOptions
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (variantOptions.length > 0) {
        definition.variantOptions = variantOptions;
      }
    }
    next[propertyName] = definition;
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const sanitizeNode = (nodeCandidate: unknown, context: CleanNodeContext): Record<string, unknown> | null => {
  const { metrics } = context;
  if (!isRecord(nodeCandidate)) {
    return null;
  }

  if (nodeCandidate.visible === false) {
    metrics.removedHiddenNodes += countSubtreeNodes(nodeCandidate);
    return null;
  }

  const nodeType = typeof nodeCandidate.type === "string" ? nodeCandidate.type : undefined;
  const nodeId = typeof nodeCandidate.id === "string" ? nodeCandidate.id : undefined;
  if (!nodeType || !nodeId) {
    metrics.removedInvalidNodes += countSubtreeNodes(nodeCandidate);
    return null;
  }

  if (context.inInstanceContext && hasPlaceholderText(nodeCandidate)) {
    metrics.removedPlaceholderNodes += 1;
    return null;
  }

  if (isHelperItemNode(nodeCandidate) && isGeometryEmpty(nodeCandidate)) {
    metrics.removedHelperNodes += countSubtreeNodes(nodeCandidate);
    return null;
  }

  metrics.removedPropertyCount += countRemovedKeys(nodeCandidate, ALLOWED_NODE_KEYS);

  const nextNode: Record<string, unknown> = {
    id: nodeId,
    type: nodeType
  };
  if (typeof nodeCandidate.name === "string") {
    nextNode.name = nodeCandidate.name;
  }
  if (typeof nodeCandidate.layoutMode === "string") {
    nextNode.layoutMode = nodeCandidate.layoutMode;
  }
  if (typeof nodeCandidate.primaryAxisAlignItems === "string") {
    nextNode.primaryAxisAlignItems = nodeCandidate.primaryAxisAlignItems;
  }
  if (typeof nodeCandidate.counterAxisAlignItems === "string") {
    nextNode.counterAxisAlignItems = nodeCandidate.counterAxisAlignItems;
  }
  if (isFiniteNumber(nodeCandidate.itemSpacing)) {
    nextNode.itemSpacing = nodeCandidate.itemSpacing;
  }
  if (isFiniteNumber(nodeCandidate.paddingTop)) {
    nextNode.paddingTop = nodeCandidate.paddingTop;
  }
  if (isFiniteNumber(nodeCandidate.paddingRight)) {
    nextNode.paddingRight = nodeCandidate.paddingRight;
  }
  if (isFiniteNumber(nodeCandidate.paddingBottom)) {
    nextNode.paddingBottom = nodeCandidate.paddingBottom;
  }
  if (isFiniteNumber(nodeCandidate.paddingLeft)) {
    nextNode.paddingLeft = nodeCandidate.paddingLeft;
  }
  if (isFiniteNumber(nodeCandidate.strokeWeight)) {
    nextNode.strokeWeight = nodeCandidate.strokeWeight;
  }
  if (isFiniteNumber(nodeCandidate.cornerRadius)) {
    nextNode.cornerRadius = nodeCandidate.cornerRadius;
  }
  if (typeof nodeCandidate.characters === "string") {
    nextNode.characters = nodeCandidate.characters;
  }

  const absoluteBoundingBox = sanitizeAbsoluteBoundingBox(nodeCandidate.absoluteBoundingBox, metrics);
  if (absoluteBoundingBox) {
    nextNode.absoluteBoundingBox = absoluteBoundingBox;
  }

  const style = sanitizeStyle(nodeCandidate.style, metrics);
  if (style) {
    nextNode.style = style;
  }

  const fills = sanitizePaints(nodeCandidate.fills, metrics);
  if (fills) {
    nextNode.fills = fills;
  }

  const strokes = sanitizePaints(nodeCandidate.strokes, metrics);
  if (strokes) {
    nextNode.strokes = strokes;
  }

  const fillGeometry = sanitizeGeometryList(nodeCandidate.fillGeometry, metrics);
  if (fillGeometry) {
    nextNode.fillGeometry = fillGeometry;
  }

  const strokeGeometry = sanitizeGeometryList(nodeCandidate.strokeGeometry, metrics);
  if (strokeGeometry) {
    nextNode.strokeGeometry = strokeGeometry;
  }

  const componentProperties = sanitizeVariantComponentProperties(nodeCandidate.componentProperties, metrics);
  if (componentProperties) {
    nextNode.componentProperties = componentProperties;
  }

  const componentPropertyDefinitions = sanitizeVariantComponentPropertyDefinitions(
    nodeCandidate.componentPropertyDefinitions,
    metrics
  );
  if (componentPropertyDefinitions) {
    nextNode.componentPropertyDefinitions = componentPropertyDefinitions;
  }

  const isNextInstanceContext =
    context.inInstanceContext || nodeType === "INSTANCE" || nodeType === "COMPONENT_SET";
  if (Array.isArray(nodeCandidate.children)) {
    const children = nodeCandidate.children
      .map((child) =>
        sanitizeNode(child, {
          inInstanceContext: isNextInstanceContext,
          metrics
        })
      )
      .filter((child): child is Record<string, unknown> => Boolean(child));
    if (children.length > 0) {
      nextNode.children = children;
    }
  }

  metrics.outputNodeCount += 1;
  return nextNode;
};

const collectSectionScreensCount = (sectionNode: Record<string, unknown>): number => {
  if (!Array.isArray(sectionNode.children)) {
    return 0;
  }

  let total = 0;
  for (const child of sectionNode.children) {
    if (!isRecord(child)) {
      continue;
    }
    const childType = typeof child.type === "string" ? child.type : "";
    if (childType === "SECTION") {
      total += collectSectionScreensCount(child);
      continue;
    }
    if (childType === "FRAME" || childType === "COMPONENT") {
      total += 1;
    }
  }
  return total;
};

const countScreenCandidates = (documentNode: Record<string, unknown> | undefined): number => {
  if (!documentNode || !Array.isArray(documentNode.children)) {
    return 0;
  }

  let total = 0;
  for (const page of documentNode.children) {
    if (!isRecord(page) || !Array.isArray(page.children)) {
      continue;
    }
    for (const child of page.children) {
      if (!isRecord(child)) {
        continue;
      }
      const childType = typeof child.type === "string" ? child.type : "";
      if (childType === "SECTION") {
        total += collectSectionScreensCount(child);
        continue;
      }
      if (childType === "FRAME" || childType === "COMPONENT") {
        total += 1;
      }
    }
  }
  return total;
};

export const cleanFigmaForCodegen = ({ file }: { file: FigmaFileResponse }): CleanFigmaResult => {
  const rawFile = isRecord(file) ? file : {};

  const metrics: FigmaCleaningAccumulator = {
    outputNodeCount: 0,
    removedHiddenNodes: 0,
    removedPlaceholderNodes: 0,
    removedHelperNodes: 0,
    removedInvalidNodes: 0,
    removedPropertyCount: countRemovedKeys(rawFile, ALLOWED_FILE_KEYS)
  };

  const inputNodeCount = countSubtreeNodes(rawFile.document);
  const cleanedDocument = sanitizeNode(rawFile.document, {
    inInstanceContext: false,
    metrics
  });

  const cleanedFile: FigmaFileResponse = {};
  if (typeof rawFile.name === "string") {
    cleanedFile.name = rawFile.name;
  }
  if (cleanedDocument) {
    cleanedFile.document = cleanedDocument;
  }

  const report: FigmaCleaningReport = {
    inputNodeCount,
    outputNodeCount: metrics.outputNodeCount,
    removedHiddenNodes: metrics.removedHiddenNodes,
    removedPlaceholderNodes: metrics.removedPlaceholderNodes,
    removedHelperNodes: metrics.removedHelperNodes,
    removedInvalidNodes: metrics.removedInvalidNodes,
    removedPropertyCount: metrics.removedPropertyCount,
    screenCandidateCount: countScreenCandidates(cleanedDocument ?? undefined)
  };

  return {
    cleanedFile,
    report
  };
};
