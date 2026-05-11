const TECHNICAL_PLACEHOLDER_TEXT_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);

interface BoundingBoxLike {
  width?: unknown;
  height?: unknown;
}

interface NodeLike {
  type?: unknown;
  name?: unknown;
  characters?: unknown;
  absoluteBoundingBox?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const normalizePlaceholderText = ({ value }: { value: string }): string => {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
};

export const isTechnicalPlaceholderText = ({ text }: { text: string | undefined }): boolean => {
  if (typeof text !== "string") {
    return false;
  }
  return TECHNICAL_PLACEHOLDER_TEXT_VALUES.has(normalizePlaceholderText({ value: text }));
};

export const isTechnicalPlaceholderNode = ({ node }: { node: NodeLike }): boolean => {
  if (node.type !== "TEXT") {
    return false;
  }
  return isTechnicalPlaceholderText({
    text: typeof node.characters === "string" ? node.characters : undefined
  });
};

export const isHelperItemNodeName = ({ name }: { name: string | undefined }): boolean => {
  if (typeof name !== "string") {
    return false;
  }
  const normalized = name.trim().toLowerCase();
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

export const isHelperItemNode = ({ node }: { node: NodeLike }): boolean => {
  return isHelperItemNodeName({
    name: typeof node.name === "string" ? node.name : undefined
  });
};

export const isGeometryEmpty = ({ absoluteBoundingBox }: { absoluteBoundingBox: BoundingBoxLike | undefined }): boolean => {
  if (!absoluteBoundingBox) {
    return false;
  }
  if (!isFiniteNumber(absoluteBoundingBox.width) || !isFiniteNumber(absoluteBoundingBox.height)) {
    return false;
  }
  return absoluteBoundingBox.width <= 0 || absoluteBoundingBox.height <= 0;
};

export const isNodeGeometryEmpty = ({ node }: { node: NodeLike }): boolean => {
  if (!isRecord(node.absoluteBoundingBox)) {
    return false;
  }
  return isGeometryEmpty({
    absoluteBoundingBox: node.absoluteBoundingBox
  });
};
