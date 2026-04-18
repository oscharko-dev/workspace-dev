/**
 * Pure IR override application for regeneration from Inspector drafts.
 *
 * Applies structured scalar + form-validation overrides to a Design IR
 * without mutating the original. Returns a deep-cloned IR with override
 * values applied to matching nodes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/455
 */

import type { WorkspaceRegenerationOverrideEntry } from "../contracts/index.js";
import type {
  DesignIR,
  NonTextElementIR,
  ScreenElementIR,
  ScreenIR,
  TextElementIR,
} from "../parity/types-ir.js";
import {
  validateRegenerationOverrideEntry,
  type ValidatedRegenerationOverrideEntry,
} from "./ir-override-validation.js";

type NumericElementField =
  | "opacity"
  | "cornerRadius"
  | "fontSize"
  | "fontWeight"
  | "gap";
type DimensionElementField = "width" | "height";
type StringElementField = "fillColor" | "fontFamily";

function hasChildren(element: ScreenElementIR): boolean {
  return Array.isArray(element.children) && element.children.length > 0;
}

function applyPaddingOverride(
  element: ScreenElementIR,
  value: Extract<
    ValidatedRegenerationOverrideEntry,
    { field: "padding" }
  >["value"],
): boolean {
  element.padding = {
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left,
  };
  return true;
}

function applyLayoutModeOverride(
  element: ScreenElementIR,
  value: Extract<
    ValidatedRegenerationOverrideEntry,
    { field: "layoutMode" }
  >["value"],
): boolean {
  if (!hasChildren(element)) {
    return false;
  }
  element.layoutMode = value;
  if (value === "NONE") {
    delete element.primaryAxisAlignItems;
    delete element.counterAxisAlignItems;
  }
  return true;
}

export interface ApplyIrOverridesResult {
  ir: DesignIR;
  appliedCount: number;
  skippedCount: number;
}

function cloneTextElement(
  element: TextElementIR,
  clonedChildren: ScreenElementIR[] | undefined,
  clonedPadding: TextElementIR["padding"],
): TextElementIR {
  return {
    ...element,
    ...(clonedChildren ? { children: clonedChildren } : {}),
    ...(clonedPadding ? { padding: clonedPadding } : {}),
  };
}

function cloneNonTextElement(
  element: NonTextElementIR,
  clonedChildren: ScreenElementIR[] | undefined,
  clonedPadding: NonTextElementIR["padding"],
): NonTextElementIR {
  return {
    ...element,
    ...(clonedChildren ? { children: clonedChildren } : {}),
    ...(clonedPadding ? { padding: clonedPadding } : {}),
  };
}

function cloneElement(element: ScreenElementIR): ScreenElementIR {
  const clonedChildren = element.children?.map((child) => cloneElement(child));
  const clonedPadding = element.padding ? { ...element.padding } : undefined;

  if (element.type === "text") {
    return cloneTextElement(element, clonedChildren, clonedPadding);
  }

  return cloneNonTextElement(element, clonedChildren, clonedPadding);
}

function cloneScreen(screen: ScreenIR): ScreenIR {
  return {
    ...screen,
    padding: { ...screen.padding },
    children: screen.children.map((child) => cloneElement(child)),
  };
}

function applyOverrideToElement(
  element: ScreenElementIR,
  override: ValidatedRegenerationOverrideEntry,
): boolean {
  switch (override.field) {
    case "opacity":
    case "cornerRadius":
    case "fontSize":
    case "fontWeight":
    case "gap": {
      const field: NumericElementField = override.field;
      if (typeof override.value !== "number") {
        return false;
      }
      element[field] = override.value;
      return true;
    }
    case "width":
    case "height": {
      const field: DimensionElementField = override.field;
      if (typeof override.value !== "number" || element.type === "text") {
        return false;
      }
      element[field] = override.value;
      return true;
    }
    case "fillColor":
    case "fontFamily": {
      const field: StringElementField = override.field;
      if (typeof override.value !== "string") {
        return false;
      }
      element[field] = override.value;
      return true;
    }
    case "padding":
      return applyPaddingOverride(element, override.value);
    case "layoutMode":
      return applyLayoutModeOverride(element, override.value);
    case "primaryAxisAlignItems":
      if (!hasChildren(element) || element.layoutMode === "NONE") {
        return false;
      }
      element.primaryAxisAlignItems = override.value;
      return true;
    case "counterAxisAlignItems":
      if (!hasChildren(element) || element.layoutMode === "NONE") {
        return false;
      }
      element.counterAxisAlignItems = override.value;
      return true;
    case "required":
      element.required = override.value;
      return true;
    case "validationType":
      element.validationType = override.value;
      return true;
    case "validationMessage":
      element.validationMessage = override.value;
      return true;
    case "validationMin":
      element.validationMin = override.value;
      return true;
    case "validationMax":
      element.validationMax = override.value;
      return true;
    case "validationMinLength":
      element.validationMinLength = override.value;
      return true;
    case "validationMaxLength":
      element.validationMaxLength = override.value;
      return true;
    case "validationPattern":
      element.validationPattern = override.value;
      return true;
    default:
      return false;
  }
}

function collectElements(
  elements: ScreenElementIR[],
  map: Map<string, ScreenElementIR>,
): void {
  for (const element of elements) {
    map.set(element.id, element);
    if (element.children && element.children.length > 0) {
      collectElements(element.children, map);
    }
  }
}

function applyScreenOverride(
  screen: ScreenIR,
  override: ValidatedRegenerationOverrideEntry,
): boolean {
  if (override.field === "fillColor" && typeof override.value === "string") {
    screen.fillColor = override.value;
    return true;
  }
  if (override.field === "gap" && typeof override.value === "number") {
    screen.gap = override.value;
    return true;
  }
  if (override.field === "padding") {
    screen.padding = {
      top: override.value.top,
      right: override.value.right,
      bottom: override.value.bottom,
      left: override.value.left,
    };
    return true;
  }
  return false;
}

/**
 * Applies override entries to a Design IR in a pure transformation step.
 * Returns a new IR with overrides applied; the input IR is not mutated.
 *
 * Complexity: O(n + m) where n is the number of overrides and m is the
 * number of IR nodes. Node lookup uses a pre-built Map populated in a
 * single pass over the cloned tree; each override is then resolved in
 * O(1) instead of walking the tree per override.
 */
export function applyIrOverrides({
  ir,
  overrides,
}: {
  ir: DesignIR;
  overrides: readonly WorkspaceRegenerationOverrideEntry[];
}): ApplyIrOverridesResult {
  if (overrides.length === 0) {
    return {
      ir,
      appliedCount: 0,
      skippedCount: 0,
    };
  }

  const clonedScreens = ir.screens.map((screen) => cloneScreen(screen));
  const screenMap = new Map<string, ScreenIR>();
  const elementMap = new Map<string, ScreenElementIR>();
  for (const screen of clonedScreens) {
    screenMap.set(screen.id, screen);
    collectElements(screen.children, elementMap);
  }

  let appliedCount = 0;
  let skippedCount = 0;

  for (const override of overrides) {
    const validationResult = validateRegenerationOverrideEntry(override);
    if (!validationResult.ok) {
      skippedCount += 1;
      continue;
    }

    const validatedOverride = validationResult.entry;
    let applied = false;

    const screen = screenMap.get(validatedOverride.nodeId);
    if (screen) {
      applied = applyScreenOverride(screen, validatedOverride);
    } else {
      const element = elementMap.get(validatedOverride.nodeId);
      if (element) {
        applied = applyOverrideToElement(element, validatedOverride);
      }
    }

    if (applied) {
      appliedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  const clonedIr: DesignIR = {
    ...ir,
    screens: clonedScreens,
    tokens: { ...ir.tokens },
  };

  return {
    ir: clonedIr,
    appliedCount,
    skippedCount,
  };
}
