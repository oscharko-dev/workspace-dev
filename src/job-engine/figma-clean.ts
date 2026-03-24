import type { FigmaFileResponse } from "./types.js";
import { isHelperItemNode, isNodeGeometryEmpty, isTechnicalPlaceholderNode } from "../figma-node-heuristics.js";

const ALLOWED_FILE_KEYS = new Set(["name", "document", "styles"]);

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
  "opacity",
  "fills",
  "strokes",
  "strokeWeight",
  "absoluteBoundingBox",
  "characters",
  "style",
  "styles",
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "cornerRadius",
  "effects",
  "boundVariables",
  "componentId",
  "componentSetId",
  "componentProperties",
  "componentPropertyDefinitions",
  "interactions"
]);

const ALLOWED_COLOR_KEYS = new Set(["r", "g", "b", "a"]);
const ALLOWED_PAINT_KEYS = new Set(["type", "visible", "color", "opacity", "gradientStops", "gradientHandlePositions"]);
const ALLOWED_BOX_KEYS = new Set(["x", "y", "width", "height"]);
const ALLOWED_STYLE_KEYS = new Set([
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeightPx",
  "letterSpacing",
  "textAlignHorizontal"
]);
const ALLOWED_GEOMETRY_KEYS = new Set(["path", "windingRule"]);
const ALLOWED_GRADIENT_STOP_KEYS = new Set(["position", "color"]);
const ALLOWED_GRADIENT_HANDLE_POSITION_KEYS = new Set(["x", "y"]);
const ALLOWED_EFFECT_KEYS = new Set(["type", "visible", "color", "radius", "offset"]);
const ALLOWED_EFFECT_OFFSET_KEYS = new Set(["x", "y"]);
const ALLOWED_COMPONENT_PROPERTY_KEYS = new Set(["type", "value"]);
const ALLOWED_COMPONENT_PROPERTY_DEFINITION_KEYS = new Set(["type", "defaultValue", "variantOptions"]);
const ALLOWED_INTERACTION_KEYS = new Set(["trigger", "action", "actions"]);
const ALLOWED_INTERACTION_TRIGGER_KEYS = new Set(["type"]);
const ALLOWED_INTERACTION_ACTION_KEYS = new Set(["type", "destinationId", "navigation", "transitionNodeID", "transitionNodeId"]);
const ALLOWED_FILE_STYLE_KEYS = new Set(["name", "styleType", "style_type", "key", "description"]);

interface FigmaCleaningAccumulator {
  inputNodeCount: number;
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

const sanitizeStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const sanitizeStyleCatalog = (value: unknown, metrics: FigmaCleaningAccumulator): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [styleId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    metrics.removedPropertyCount += countRemovedKeys(entry, ALLOWED_FILE_STYLE_KEYS);
    const nextEntry: Record<string, unknown> = {};
    if (typeof entry.name === "string" && entry.name.trim().length > 0) {
      nextEntry.name = entry.name;
    }
    if (typeof entry.styleType === "string" && entry.styleType.trim().length > 0) {
      nextEntry.styleType = entry.styleType;
    }
    if (typeof entry.style_type === "string" && entry.style_type.trim().length > 0) {
      nextEntry.style_type = entry.style_type;
    }
    if (typeof entry.key === "string" && entry.key.trim().length > 0) {
      nextEntry.key = entry.key;
    }
    if (typeof entry.description === "string" && entry.description.trim().length > 0) {
      nextEntry.description = entry.description;
    }
    if (Object.keys(nextEntry).length > 0) {
      output[styleId] = nextEntry;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const countRemovedKeys = (value: Record<string, unknown>, allowList: Set<string>): number => {
  return Object.keys(value).filter((key) => !allowList.has(key)).length;
};

const countSubtreeNodes = (value: unknown): number => {
  if (!isRecord(value)) {
    return 0;
  }

  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!isRecord(current)) {
      continue;
    }
    count += 1;
    if (!Array.isArray(current.children)) {
      continue;
    }
    for (const child of current.children) {
      stack.push(child);
    }
  }

  return count;
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

const sanitizeGradientStops = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Array<{ position: number; color: Record<string, number> }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const next = value
    .map((stopCandidate) => {
      if (!isRecord(stopCandidate)) {
        return undefined;
      }
      metrics.removedPropertyCount += countRemovedKeys(stopCandidate, ALLOWED_GRADIENT_STOP_KEYS);
      if (!isFiniteNumber(stopCandidate.position)) {
        return undefined;
      }
      const color = sanitizeColor(stopCandidate.color, metrics);
      if (!color) {
        return undefined;
      }
      return {
        position: stopCandidate.position,
        color
      };
    })
    .filter((stop): stop is { position: number; color: Record<string, number> } => Boolean(stop));

  return next.length > 0 ? next : undefined;
};

const sanitizeGradientHandlePositions = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): Array<{ x: number; y: number }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const next = value
    .map((positionCandidate) => {
      if (!isRecord(positionCandidate)) {
        return undefined;
      }
      metrics.removedPropertyCount += countRemovedKeys(positionCandidate, ALLOWED_GRADIENT_HANDLE_POSITION_KEYS);
      if (!isFiniteNumber(positionCandidate.x) || !isFiniteNumber(positionCandidate.y)) {
        return undefined;
      }
      return {
        x: positionCandidate.x,
        y: positionCandidate.y
      };
    })
    .filter((position): position is { x: number; y: number } => Boolean(position));

  return next.length > 0 ? next : undefined;
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

      if (paintCandidate.visible === false) {
        return undefined;
      }

      const type = typeof paintCandidate.type === "string" ? paintCandidate.type : undefined;
      if (!type) {
        return undefined;
      }
      const normalizedType = type.trim().toUpperCase();

      if (normalizedType === "IMAGE") {
        const nextPaint: Record<string, unknown> = { type: normalizedType };
        if (isFiniteNumber(paintCandidate.opacity)) {
          nextPaint.opacity = paintCandidate.opacity;
        }
        return nextPaint;
      }

      if (normalizedType === "SOLID") {
        const color = sanitizeColor(paintCandidate.color, metrics);
        if (!color) {
          return undefined;
        }

        const nextPaint: Record<string, unknown> = { type: normalizedType, color };
        if (isFiniteNumber(paintCandidate.opacity)) {
          nextPaint.opacity = paintCandidate.opacity;
        }
        return nextPaint;
      }

      if (!normalizedType.includes("GRADIENT")) {
        return undefined;
      }

      const gradientStops = sanitizeGradientStops(paintCandidate.gradientStops, metrics);
      if (!gradientStops) {
        return undefined;
      }

      const nextPaint: Record<string, unknown> = {
        type: normalizedType,
        gradientStops
      };
      if (isFiniteNumber(paintCandidate.opacity)) {
        nextPaint.opacity = paintCandidate.opacity;
      }
      const gradientHandlePositions = sanitizeGradientHandlePositions(paintCandidate.gradientHandlePositions, metrics);
      if (gradientHandlePositions) {
        nextPaint.gradientHandlePositions = gradientHandlePositions;
      }
      return nextPaint;
    })
    .filter((paint): paint is Record<string, unknown> => Boolean(paint));

  return sanitized.length > 0 ? sanitized : undefined;
};

const sanitizeEffectOffset = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): { x: number; y: number } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_EFFECT_OFFSET_KEYS);
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return undefined;
  }
  return {
    x: value.x,
    y: value.y
  };
};

const sanitizeEffects = (value: unknown, metrics: FigmaCleaningAccumulator): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .map((effectCandidate) => {
      if (!isRecord(effectCandidate)) {
        return undefined;
      }
      metrics.removedPropertyCount += countRemovedKeys(effectCandidate, ALLOWED_EFFECT_KEYS);

      const type = typeof effectCandidate.type === "string" ? effectCandidate.type.trim().toUpperCase() : "";
      if (type !== "DROP_SHADOW" && type !== "INNER_SHADOW") {
        return undefined;
      }
      if (effectCandidate.visible === false) {
        return undefined;
      }

      const color = sanitizeColor(effectCandidate.color, metrics);
      const offset = sanitizeEffectOffset(effectCandidate.offset, metrics);
      if (!color || !offset || !isFiniteNumber(effectCandidate.radius)) {
        return undefined;
      }

      const nextEffect: Record<string, unknown> = {
        type,
        color,
        radius: effectCandidate.radius,
        offset
      };
      if (typeof effectCandidate.visible === "boolean") {
        nextEffect.visible = effectCandidate.visible;
      }
      return nextEffect;
    })
    .filter((effect): effect is Record<string, unknown> => Boolean(effect));

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
  if (isFiniteNumber(value.letterSpacing)) {
    next.letterSpacing = value.letterSpacing;
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

const sanitizeInteractionTrigger = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
): { type: string } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_INTERACTION_TRIGGER_KEYS);
  if (typeof value.type !== "string") {
    return undefined;
  }
  const type = value.type.trim().toUpperCase();
  if (type.length === 0) {
    return undefined;
  }
  return { type };
};

const sanitizeInteractionAction = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
):
  | {
      type: string;
      destinationId?: string;
      navigation?: string;
      transitionNodeID?: string;
      transitionNodeId?: string;
    }
  | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  metrics.removedPropertyCount += countRemovedKeys(value, ALLOWED_INTERACTION_ACTION_KEYS);
  if (typeof value.type !== "string") {
    return undefined;
  }
  const type = value.type.trim().toUpperCase();
  if (type.length === 0) {
    return undefined;
  }

  const nextAction: {
    type: string;
    destinationId?: string;
    navigation?: string;
    transitionNodeID?: string;
    transitionNodeId?: string;
  } = { type };
  if (typeof value.destinationId === "string" && value.destinationId.trim().length > 0) {
    nextAction.destinationId = value.destinationId.trim();
  }
  if (typeof value.navigation === "string" && value.navigation.trim().length > 0) {
    nextAction.navigation = value.navigation.trim().toUpperCase();
  }
  if (typeof value.transitionNodeID === "string" && value.transitionNodeID.trim().length > 0) {
    nextAction.transitionNodeID = value.transitionNodeID.trim();
  }
  if (typeof value.transitionNodeId === "string" && value.transitionNodeId.trim().length > 0) {
    nextAction.transitionNodeId = value.transitionNodeId.trim();
  }
  return nextAction;
};

const sanitizeInteractions = (
  value: unknown,
  metrics: FigmaCleaningAccumulator
):
  | Array<{
      trigger: {
        type: string;
      };
      actions: Array<{
        type: string;
        destinationId?: string;
        navigation?: string;
        transitionNodeID?: string;
        transitionNodeId?: string;
      }>;
    }>
  | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const nextInteractions = value
    .map((interactionCandidate) => {
      if (!isRecord(interactionCandidate)) {
        return undefined;
      }
      metrics.removedPropertyCount += countRemovedKeys(interactionCandidate, ALLOWED_INTERACTION_KEYS);
      const trigger = sanitizeInteractionTrigger(interactionCandidate.trigger, metrics);
      if (!trigger) {
        return undefined;
      }
      const actionCandidates = Array.isArray(interactionCandidate.actions)
        ? interactionCandidate.actions
        : interactionCandidate.action !== undefined
          ? [interactionCandidate.action]
          : [];
      const actions = actionCandidates
        .map((actionCandidate) => sanitizeInteractionAction(actionCandidate, metrics))
        .filter(
          (
            action
          ): action is {
            type: string;
            destinationId?: string;
            navigation?: string;
            transitionNodeID?: string;
            transitionNodeId?: string;
          } => Boolean(action)
        );
      if (actions.length === 0) {
        return undefined;
      }
      return {
        trigger,
        actions
      };
    })
    .filter(
      (
        interaction
      ): interaction is {
        trigger: {
          type: string;
        };
        actions: Array<{
          type: string;
          destinationId?: string;
          navigation?: string;
          transitionNodeID?: string;
          transitionNodeId?: string;
        }>;
      } => Boolean(interaction)
    );

  return nextInteractions.length > 0 ? nextInteractions : undefined;
};

interface TraverseFrameProcess {
  kind: "process";
  nodeCandidate: unknown;
  inInstanceContext: boolean;
  target: Record<string, unknown>[];
}

interface TraverseFrameFinalize {
  kind: "finalize";
  node: Record<string, unknown>;
  children: Record<string, unknown>[];
  target: Record<string, unknown>[];
}

type TraverseFrame = TraverseFrameProcess | TraverseFrameFinalize;

const sanitizeNode = (nodeCandidate: unknown, context: CleanNodeContext): Record<string, unknown> | null => {
  const { metrics } = context;
  const rootResult: Record<string, unknown>[] = [];
  const stack: TraverseFrame[] = [
    {
      kind: "process",
      nodeCandidate,
      inInstanceContext: context.inInstanceContext,
      target: rootResult
    }
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }

    if (frame.kind === "finalize") {
      if (frame.children.length > 0) {
        frame.node.children = frame.children;
      }
      frame.target.push(frame.node);
      metrics.outputNodeCount += 1;
      continue;
    }

    const current = frame.nodeCandidate;
    if (!isRecord(current)) {
      continue;
    }

    if (current.visible === false) {
      const removedSubtreeCount = countSubtreeNodes(current);
      metrics.inputNodeCount += removedSubtreeCount;
      metrics.removedHiddenNodes += removedSubtreeCount;
      continue;
    }

    const nodeType = typeof current.type === "string" ? current.type : undefined;
    const nodeId = typeof current.id === "string" ? current.id : undefined;
    if (!nodeType || !nodeId) {
      const removedSubtreeCount = countSubtreeNodes(current);
      metrics.inputNodeCount += removedSubtreeCount;
      metrics.removedInvalidNodes += removedSubtreeCount;
      continue;
    }

    if (frame.inInstanceContext && isTechnicalPlaceholderNode({ node: current })) {
      const removedSubtreeCount = countSubtreeNodes(current);
      metrics.inputNodeCount += removedSubtreeCount;
      metrics.removedPlaceholderNodes += 1;
      continue;
    }

    if (isHelperItemNode({ node: current }) && isNodeGeometryEmpty({ node: current })) {
      const removedSubtreeCount = countSubtreeNodes(current);
      metrics.inputNodeCount += removedSubtreeCount;
      metrics.removedHelperNodes += removedSubtreeCount;
      continue;
    }

    metrics.inputNodeCount += 1;
    metrics.removedPropertyCount += countRemovedKeys(current, ALLOWED_NODE_KEYS);

    const nextNode: Record<string, unknown> = {
      id: nodeId,
      type: nodeType
    };
    if (typeof current.name === "string") {
      nextNode.name = current.name;
    }
    if (typeof current.layoutMode === "string") {
      nextNode.layoutMode = current.layoutMode;
    }
    if (typeof current.primaryAxisAlignItems === "string") {
      nextNode.primaryAxisAlignItems = current.primaryAxisAlignItems;
    }
    if (typeof current.counterAxisAlignItems === "string") {
      nextNode.counterAxisAlignItems = current.counterAxisAlignItems;
    }
    if (isFiniteNumber(current.itemSpacing)) {
      nextNode.itemSpacing = current.itemSpacing;
    }
    if (isFiniteNumber(current.paddingTop)) {
      nextNode.paddingTop = current.paddingTop;
    }
    if (isFiniteNumber(current.paddingRight)) {
      nextNode.paddingRight = current.paddingRight;
    }
    if (isFiniteNumber(current.paddingBottom)) {
      nextNode.paddingBottom = current.paddingBottom;
    }
    if (isFiniteNumber(current.paddingLeft)) {
      nextNode.paddingLeft = current.paddingLeft;
    }
    if (isFiniteNumber(current.strokeWeight)) {
      nextNode.strokeWeight = current.strokeWeight;
    }
    if (isFiniteNumber(current.cornerRadius)) {
      nextNode.cornerRadius = current.cornerRadius;
    }
    if (typeof current.componentId === "string") {
      nextNode.componentId = current.componentId;
    }
    if (typeof current.componentSetId === "string") {
      nextNode.componentSetId = current.componentSetId;
    }
    if (isFiniteNumber(current.opacity) && current.opacity >= 0 && current.opacity < 1) {
      nextNode.opacity = current.opacity;
    }
    if (typeof current.characters === "string") {
      nextNode.characters = current.characters;
    }

    const absoluteBoundingBox = sanitizeAbsoluteBoundingBox(current.absoluteBoundingBox, metrics);
    if (absoluteBoundingBox) {
      nextNode.absoluteBoundingBox = absoluteBoundingBox;
    }

    const style = sanitizeStyle(current.style, metrics);
    if (style) {
      nextNode.style = style;
    }
    const styles = sanitizeStringRecord(current.styles);
    if (styles) {
      nextNode.styles = styles;
    }
    if (typeof current.fillStyleId === "string" && current.fillStyleId.trim().length > 0) {
      nextNode.fillStyleId = current.fillStyleId;
    }
    if (typeof current.strokeStyleId === "string" && current.strokeStyleId.trim().length > 0) {
      nextNode.strokeStyleId = current.strokeStyleId;
    }
    if (typeof current.effectStyleId === "string" && current.effectStyleId.trim().length > 0) {
      nextNode.effectStyleId = current.effectStyleId;
    }
    if (typeof current.textStyleId === "string" && current.textStyleId.trim().length > 0) {
      nextNode.textStyleId = current.textStyleId;
    }
    if (isRecord(current.boundVariables) && Object.keys(current.boundVariables).length > 0) {
      nextNode.boundVariables = current.boundVariables;
    }

    const fills = sanitizePaints(current.fills, metrics);
    if (fills) {
      nextNode.fills = fills;
    }

    const strokes = sanitizePaints(current.strokes, metrics);
    if (strokes) {
      nextNode.strokes = strokes;
    }

    const effects = sanitizeEffects(current.effects, metrics);
    if (effects) {
      nextNode.effects = effects;
    }

    const fillGeometry = sanitizeGeometryList(current.fillGeometry, metrics);
    if (fillGeometry) {
      nextNode.fillGeometry = fillGeometry;
    }

    const strokeGeometry = sanitizeGeometryList(current.strokeGeometry, metrics);
    if (strokeGeometry) {
      nextNode.strokeGeometry = strokeGeometry;
    }

    const componentProperties = sanitizeVariantComponentProperties(current.componentProperties, metrics);
    if (componentProperties) {
      nextNode.componentProperties = componentProperties;
    }

    const componentPropertyDefinitions = sanitizeVariantComponentPropertyDefinitions(
      current.componentPropertyDefinitions,
      metrics
    );
    if (componentPropertyDefinitions) {
      nextNode.componentPropertyDefinitions = componentPropertyDefinitions;
    }

    const interactions = sanitizeInteractions(current.interactions, metrics);
    if (interactions) {
      nextNode.interactions = interactions;
    }

    const childTarget: Record<string, unknown>[] = [];
    stack.push({
      kind: "finalize",
      node: nextNode,
      children: childTarget,
      target: frame.target
    });

    if (!Array.isArray(current.children) || current.children.length === 0) {
      continue;
    }

    const isNextInstanceContext = frame.inInstanceContext || nodeType === "INSTANCE" || nodeType === "COMPONENT_SET";
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        kind: "process",
        nodeCandidate: current.children[index],
        inInstanceContext: isNextInstanceContext,
        target: childTarget
      });
    }
  }

  return rootResult[0] ?? null;
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
    inputNodeCount: 0,
    outputNodeCount: 0,
    removedHiddenNodes: 0,
    removedPlaceholderNodes: 0,
    removedHelperNodes: 0,
    removedInvalidNodes: 0,
    removedPropertyCount: countRemovedKeys(rawFile, ALLOWED_FILE_KEYS)
  };

  const cleanedDocument = sanitizeNode(rawFile.document, {
    inInstanceContext: false,
    metrics
  });

  const cleanedFile: FigmaFileResponse = {};
  if (typeof rawFile.name === "string") {
    cleanedFile.name = rawFile.name;
  }
  const styleCatalog = sanitizeStyleCatalog(rawFile.styles, metrics);
  if (styleCatalog) {
    cleanedFile.styles = styleCatalog;
  }
  if (cleanedDocument) {
    cleanedFile.document = cleanedDocument;
  }

  const report: FigmaCleaningReport = {
    inputNodeCount: metrics.inputNodeCount,
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
