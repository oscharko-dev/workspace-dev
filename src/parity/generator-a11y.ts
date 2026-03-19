import type { ScreenElementIR } from "./types.js";
import {
  firstText,
  collectTextNodes,
  normalizeHexColor
} from "./generator-templates.js";
import {
  normalizeInputSemanticText,
  isIconLikeNode,
  isSemanticIconWrapper,
  hasMeaningfulTextDescendants
} from "./generator-core.js";
import type {
  RenderContext,
  VirtualParent,
  HeadingComponent,
  LandmarkRole
} from "./generator-core.js";

export interface AccessibilityWarning {
  code: "W_A11Y_LOW_CONTRAST";
  screenId: string;
  screenName: string;
  nodeId: string;
  nodeName: string;
  message: string;
  foreground: string;
  background: string;
  contrastRatio: number;
}

export const A11Y_GENERIC_LABEL_PATTERNS: readonly RegExp[] = [
  /^frame\s*\d*$/i,
  /^group\s*\d*$/i,
  /^rectangle\s*\d*$/i,
  /^vector\s*\d*$/i,
  /^instance\s*\d*$/i,
  /^node\s*\d*$/i,
  /^component\s*\d*$/i,
  /^styled\(div\)$/i,
  /^mui[a-z0-9_-]+$/i
];
export const A11Y_IMAGE_DECORATIVE_HINTS: readonly string[] = ["decorative", "background", "placeholder", "pattern", "shape"];
export const A11Y_NAVIGATION_HINTS: readonly string[] = ["navigation", "navbar", "nav bar", "menu", "sidebar", "tabbar", "drawer"];
export const A11Y_INTERACTIVE_TYPES: Set<ScreenElementIR["type"]> = new Set<ScreenElementIR["type"]>([
  "button",
  "input",
  "select",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "rating",
  "tab",
  "navigation",
  "breadcrumbs",
  "drawer"
]);
export const HEADING_NAME_HINTS: readonly string[] = ["heading", "headline", "title", "h1", "h2", "h3", "ueberschrift", "überschrift", "titel"];

export const toA11yHumanizedLabel = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .replace(/[_./:-]+/g, " ")
    .replace(/\b(ic|icon|root|wrapper|container|component)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (A11Y_GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const resolveElementA11yLabel = ({
  element,
  fallback
}: {
  element: ScreenElementIR;
  fallback: string;
}): string => {
  const textLabel = toA11yHumanizedLabel(firstText(element)?.trim());
  if (textLabel) {
    return textLabel;
  }
  const nameLabel = toA11yHumanizedLabel(element.name);
  if (nameLabel) {
    return nameLabel;
  }
  return fallback;
};

export const resolveIconButtonAriaLabel = ({
  element,
  iconNode
}: {
  element: ScreenElementIR;
  iconNode: ScreenElementIR | undefined;
}): string => {
  const elementLabel = toA11yHumanizedLabel(element.name);
  if (elementLabel) {
    return elementLabel;
  }
  const iconLabel = toA11yHumanizedLabel(iconNode?.name);
  if (iconLabel) {
    return iconLabel;
  }
  return "Button";
};

export const hasInteractiveDescendants = ({
  element,
  context,
  visited = new Set<ScreenElementIR>()
}: {
  element: ScreenElementIR;
  context: RenderContext;
  visited?: Set<ScreenElementIR>;
}): boolean => {
  if (visited.has(element)) {
    return false;
  }
  const cached = context.interactiveDescendantCache.get(element.id);
  if (cached !== undefined) {
    return cached;
  }
  visited.add(element);
  const resolved =
    A11Y_INTERACTIVE_TYPES.has(element.type) ||
    (element.children ?? []).some((child) => hasInteractiveDescendants({ element: child, context, visited }));
  visited.delete(element);
  context.interactiveDescendantCache.set(element.id, resolved);
  return resolved;
};

export const inferLandmarkRole = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): LandmarkRole | undefined => {
  if (element.type === "navigation") {
    return "navigation";
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  if (!normalizedName) {
    return undefined;
  }
  const hasHint = A11Y_NAVIGATION_HINTS.some((hint) => normalizedName.includes(hint));
  if (!hasHint) {
    return undefined;
  }
  if (element.type === "input" || element.type === "select") {
    return undefined;
  }
  return hasInteractiveDescendants({ element, context }) ? "navigation" : undefined;
};

export const isDecorativeImageElement = (element: ScreenElementIR): boolean => {
  const normalizedName = normalizeInputSemanticText(element.name);
  if (!normalizedName) {
    return false;
  }
  const hasDecorativeHint = A11Y_IMAGE_DECORATIVE_HINTS.some((hint) => normalizedName.includes(hint));
  if (hasDecorativeHint) {
    return true;
  }
  return !toA11yHumanizedLabel(element.name);
};

export const isDecorativeElement = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type === "divider" || element.type === "skeleton") {
    return true;
  }
  if (element.type === "image") {
    return isDecorativeImageElement(element);
  }
  if ((isIconLikeNode(element) || isSemanticIconWrapper(element)) && !hasMeaningfulTextDescendants({ element, context })) {
    return true;
  }
  if (A11Y_INTERACTIVE_TYPES.has(element.type)) {
    return false;
  }
  return !hasMeaningfulTextDescendants({ element, context }) && !hasInteractiveDescendants({ element, context });
};

export const inferHeadingComponentByNodeId = (elements: ScreenElementIR[]): Map<string, HeadingComponent> => {
  const headingCandidates = elements
    .flatMap((element) => collectTextNodes(element))
    .filter((node) => {
      const normalizedName = normalizeInputSemanticText(node.name);
      const hasHeadingHint = HEADING_NAME_HINTS.some((hint) => normalizedName.includes(hint));
      const fontSize = typeof node.fontSize === "number" ? node.fontSize : 0;
      const fontWeight = typeof node.fontWeight === "number" ? node.fontWeight : 0;
      return hasHeadingHint || fontSize >= 20 || fontWeight >= 650;
    })
    .sort((left, right) => {
      const leftFontSize = typeof left.fontSize === "number" ? left.fontSize : 0;
      const rightFontSize = typeof right.fontSize === "number" ? right.fontSize : 0;
      if (leftFontSize !== rightFontSize) {
        return rightFontSize - leftFontSize;
      }
      const leftWeight = typeof left.fontWeight === "number" ? left.fontWeight : 0;
      const rightWeight = typeof right.fontWeight === "number" ? right.fontWeight : 0;
      if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight;
      }
      return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || left.id.localeCompare(right.id);
    });

  const byNodeId = new Map<string, HeadingComponent>();
  const levelByIndex: HeadingComponent[] = ["h1", "h2", "h3", "h4", "h5", "h6"];
  for (const candidate of headingCandidates) {
    if (byNodeId.has(candidate.id)) {
      continue;
    }
    const nextLevel = levelByIndex[byNodeId.size];
    if (!nextLevel) {
      break;
    }
    byNodeId.set(candidate.id, nextLevel);
  }
  return byNodeId;
};

export const resolveBackgroundHexForText = ({
  parent,
  context
}: {
  parent: VirtualParent;
  context: RenderContext;
}): string | undefined => {
  const normalizedParentColor = normalizeHexColor(parent.fillColor);
  if (normalizedParentColor) {
    return normalizedParentColor;
  }
  return (
    context.pageBackgroundColorNormalized ??
    normalizeHexColor(context.tokens?.palette.background)
  );
};

export const pushLowContrastWarning = ({
  context,
  element,
  foreground,
  background,
  contrastRatio
}: {
  context: RenderContext;
  element: ScreenElementIR;
  foreground: string;
  background: string;
  contrastRatio: number;
}): void => {
  const warningKey = `${element.id}:${foreground}:${background}`;
  if (context.emittedAccessibilityWarningKeys.has(warningKey)) {
    return;
  }
  context.emittedAccessibilityWarningKeys.add(warningKey);
  const ratioLiteral = `${Math.round(contrastRatio * 100) / 100}:1`;
  context.accessibilityWarnings.push({
    code: "W_A11Y_LOW_CONTRAST",
    screenId: context.screenId,
    screenName: context.screenName,
    nodeId: element.id,
    nodeName: element.name,
    message: `Low contrast (${ratioLiteral}) for text node '${element.name}' on screen '${context.screenName}'`,
    foreground,
    background,
    contrastRatio: Math.round(contrastRatio * 1000) / 1000
  });
};
