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
import {
  validateRegenerationOverrideEntry,
  type PaddingOverrideValue,
  type ValidatedRegenerationOverrideEntry
} from "./ir-override-validation.js";

/** Fields that map directly to numeric properties on IR elements. */
const NUMERIC_ELEMENT_FIELDS = new Set([
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "gap"
]);

const DIMENSION_ELEMENT_FIELDS = new Set([
  "width",
  "height"
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
  "validationMessage",
  "validationMin",
  "validationMax",
  "validationMinLength",
  "validationMaxLength",
  "validationPattern"
]);

function hasChildren(element: ScreenElementIR): boolean {
  return Array.isArray(element.children) && element.children.length > 0;
}

function applyPaddingOverride(element: ScreenElementIR, value: PaddingOverrideValue): boolean {
  (element as unknown as Record<string, unknown>).padding = {
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left
  };
  return true;
}

function applyLayoutModeOverride(
  element: ScreenElementIR,
  value: ValidatedRegenerationOverrideEntry["value"]
): boolean {
  if (!hasChildren(element) || typeof value !== "string") {
    return false;
  }
  (element as unknown as Record<string, unknown>).layoutMode = value;
  if (value === "NONE") {
    delete (element as unknown as Record<string, unknown>).primaryAxisAlignItems;
    delete (element as unknown as Record<string, unknown>).counterAxisAlignItems;
  }
  return true;
}

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
  override: ValidatedRegenerationOverrideEntry
): boolean {
  const { field, value } = override;

  if (NUMERIC_ELEMENT_FIELDS.has(field)) {
    if (typeof value !== "number") {
      return false;
    }
    (element as unknown as Record<string, unknown>)[field] = value;
    return true;
  }

  if (DIMENSION_ELEMENT_FIELDS.has(field)) {
    if (typeof value !== "number" || element.type === "text") {
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
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    return applyPaddingOverride(element, value as PaddingOverrideValue);
  }

  if (field === "layoutMode") {
    return applyLayoutModeOverride(element, value);
  }

  if (field === "primaryAxisAlignItems" || field === "counterAxisAlignItems") {
    if (!hasChildren(element) || typeof value !== "string" || element.layoutMode === "NONE") {
      return false;
    }
    (element as unknown as Record<string, unknown>)[field] = value;
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
  override: ValidatedRegenerationOverrideEntry
): boolean {
  for (const element of elements) {
    if (element.id === override.nodeId) {
      return applyOverrideToElement(element, override);
    }
    if (element.children && element.children.length > 0) {
      if (findAndApplyOverride(element.children, override)) {
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
    const validationResult = validateRegenerationOverrideEntry(override);
    if (!validationResult.ok) {
      skippedCount += 1;
      continue;
    }

    const validatedOverride = validationResult.entry;
    let applied = false;
    for (const screen of clonedScreens) {
      // Check if the screen root itself matches
      if (screen.id === validatedOverride.nodeId) {
        // Screen-level overrides for applicable fields
        if (validatedOverride.field === "fillColor" && typeof validatedOverride.value === "string") {
          screen.fillColor = validatedOverride.value;
          applied = true;
          break;
        }
        if (validatedOverride.field === "gap" && typeof validatedOverride.value === "number") {
          screen.gap = validatedOverride.value;
          applied = true;
          break;
        }
        if (validatedOverride.field === "padding"
          && typeof validatedOverride.value === "object"
          && validatedOverride.value !== null
          && !Array.isArray(validatedOverride.value)) {
          const paddingValue = validatedOverride.value as PaddingOverrideValue;
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
      if (findAndApplyOverride(screen.children, validatedOverride)) {
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
