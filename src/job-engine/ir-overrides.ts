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
import type { DesignIR, ScreenElementIR, ScreenIR } from "../parity/types-ir.js";

/** Fields that map directly to numeric properties on IR elements. */
const NUMERIC_ELEMENT_FIELDS = new Set([
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "gap"
]);

/** Fields that map directly to string properties on IR elements. */
const STRING_ELEMENT_FIELDS = new Set([
  "fillColor",
  "fontFamily"
]);

/** Form validation fields that set properties directly on IR element data. */
const FORM_VALIDATION_FIELDS = new Set([
  "required",
  "validationType",
  "validationMessage"
]);

export interface ApplyIrOverridesResult {
  ir: DesignIR;
  appliedCount: number;
  skippedCount: number;
}

function cloneElement(element: ScreenElementIR): ScreenElementIR {
  const cloned: Record<string, unknown> = { ...element };
  if (element.children && element.children.length > 0) {
    cloned.children = element.children.map((child) => cloneElement(child));
  }
  if (element.padding) {
    cloned.padding = { ...element.padding };
  }
  return cloned as unknown as ScreenElementIR;
}

function cloneScreen(screen: ScreenIR): ScreenIR {
  return {
    ...screen,
    padding: { ...screen.padding },
    children: screen.children.map((child) => cloneElement(child))
  };
}

function applyOverrideToElement(
  element: ScreenElementIR,
  field: string,
  value: WorkspaceRegenerationOverrideEntry["value"]
): boolean {
  if (NUMERIC_ELEMENT_FIELDS.has(field)) {
    if (typeof value !== "number") {
      return false;
    }
    (element as unknown as Record<string, unknown>)[field] = value;
    return true;
  }

  if (STRING_ELEMENT_FIELDS.has(field)) {
    if (typeof value !== "string") {
      return false;
    }
    (element as unknown as Record<string, unknown>)[field] = value;
    return true;
  }

  if (field === "padding") {
    if (typeof value !== "object") {
      return false;
    }
    const paddingValue = value as unknown as { top: number; right: number; bottom: number; left: number };
    (element as unknown as Record<string, unknown>).padding = {
      top: paddingValue.top,
      right: paddingValue.right,
      bottom: paddingValue.bottom,
      left: paddingValue.left
    };
    return true;
  }

  if (FORM_VALIDATION_FIELDS.has(field)) {
    (element as unknown as Record<string, unknown>)[field] = value;
    return true;
  }

  return false;
}

function findAndApplyOverride(
  elements: ScreenElementIR[],
  nodeId: string,
  field: string,
  value: WorkspaceRegenerationOverrideEntry["value"]
): boolean {
  for (const element of elements) {
    if (element.id === nodeId) {
      return applyOverrideToElement(element, field, value);
    }
    if (element.children && element.children.length > 0) {
      if (findAndApplyOverride(element.children, nodeId, field, value)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Applies override entries to a Design IR in a pure transformation step.
 * Returns a new IR with overrides applied; the input IR is not mutated.
 */
export function applyIrOverrides({
  ir,
  overrides
}: {
  ir: DesignIR;
  overrides: readonly WorkspaceRegenerationOverrideEntry[];
}): ApplyIrOverridesResult {
  if (overrides.length === 0) {
    return {
      ir,
      appliedCount: 0,
      skippedCount: 0
    };
  }

  const clonedScreens = ir.screens.map((screen) => cloneScreen(screen));
  let appliedCount = 0;
  let skippedCount = 0;

  for (const override of overrides) {
    let applied = false;
    for (const screen of clonedScreens) {
      // Check if the screen root itself matches
      if (screen.id === override.nodeId) {
        // Screen-level overrides for applicable fields
        if (override.field === "fillColor" && typeof override.value === "string") {
          screen.fillColor = override.value;
          applied = true;
          break;
        }
        if (override.field === "gap" && typeof override.value === "number") {
          screen.gap = override.value;
          applied = true;
          break;
        }
        if (override.field === "padding" && typeof override.value === "object") {
          const paddingValue = override.value as { top: number; right: number; bottom: number; left: number };
          screen.padding = {
            top: paddingValue.top,
            right: paddingValue.right,
            bottom: paddingValue.bottom,
            left: paddingValue.left
          };
          applied = true;
          break;
        }
      }

      // Search children
      if (findAndApplyOverride(screen.children, override.nodeId, override.field, override.value)) {
        applied = true;
        break;
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
    tokens: { ...ir.tokens }
  };

  return {
    ir: clonedIr,
    appliedCount,
    skippedCount
  };
}
