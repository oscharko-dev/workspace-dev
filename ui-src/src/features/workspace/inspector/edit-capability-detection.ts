/**
 * Edit-mode capability detection for Inspector nodes.
 *
 * Determines whether a selected IR node supports structured edits
 * based on its element type, available fields, manifest mapping,
 * and supported override translators.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/451
 */
import {
  SCALAR_OVERRIDE_FIELDS,
  extractSupportedScalarOverrideFields,
  type ScalarOverrideField
} from "./scalar-override-translators";
import {
  FORM_VALIDATION_OVERRIDE_FIELDS,
  extractSupportedFormValidationOverrideFields,
  type FormValidationOverrideField
} from "./form-validation-override-translators";
import {
  LAYOUT_OVERRIDE_FIELDS,
  extractSupportedLayoutOverrideFields,
  type LayoutOverrideField
} from "./layout-override-translators";

// ---------------------------------------------------------------------------
// Supported override translator registry
// ---------------------------------------------------------------------------

/**
 * The set of IR field names for which downstream override translators exist.
 * These are the real field names from BaseElementIR / TextElementIR in
 * `src/parity/types-ir.ts`. Only nodes possessing at least one of these
 * fields are candidates for structured editing.
 *
 * Includes scalar visual overrides, layout/dimension overrides,
 * and form validation overrides.
 * @see https://github.com/oscharko-dev/workspace-dev/issues/453
 */
export const SUPPORTED_OVERRIDE_FIELDS: readonly SupportedOverrideField[] = [
  ...SCALAR_OVERRIDE_FIELDS,
  ...LAYOUT_OVERRIDE_FIELDS,
  ...FORM_VALIDATION_OVERRIDE_FIELDS
];

export type SupportedOverrideField =
  | ScalarOverrideField
  | LayoutOverrideField
  | FormValidationOverrideField;

// ---------------------------------------------------------------------------
// Element types eligible for edit mode
// ---------------------------------------------------------------------------

/**
 * Element types (IR `type` values) that are eligible for structured editing.
 * Types not in this set cannot enter edit mode regardless of their fields.
 */
export const EDITABLE_ELEMENT_TYPES = new Set([
  "text",
  "button",
  "input",
  "card",
  "container",
  "paper",
  "chip",
  "stack",
  "grid",
  "image",
  "avatar",
  "badge",
  "appbar",
  "dialog",
  "snackbar",
  "drawer",
  "navigation",
  "list",
  "divider"
]);

// ---------------------------------------------------------------------------
// Capability result types
// ---------------------------------------------------------------------------

export interface EditCapabilityResult {
  /** Whether the node can enter edit mode. */
  readonly editable: boolean;
  /** Human-readable reason when not editable. */
  readonly reason: string | null;
  /** Override fields available for this node (empty when not editable). */
  readonly editableFields: readonly SupportedOverrideField[];
}

// ---------------------------------------------------------------------------
// Node shape expected by capability detection
// ---------------------------------------------------------------------------

/**
 * Minimal node shape required for capability detection.
 * This aligns with the DesignIrElementNode + fields available via
 * the design-ir endpoint and manifest data.
 */
export interface EditCapabilityNode {
  readonly id: string;
  readonly name: string;
  /** The IR element type (e.g. "text", "button", "container"). */
  readonly type: string;
  /** Whether this node has a manifest mapping to generated code. */
  readonly mapped: boolean;
  /**
   * Known IR field names present on this node.
   * Used to intersect with SUPPORTED_OVERRIDE_FIELDS.
   */
  readonly presentFields?: readonly string[];
}

// ---------------------------------------------------------------------------
// Core detection logic
// ---------------------------------------------------------------------------

/**
 * Determines whether the given IR node supports structured editing.
 *
 * A node is editable when ALL of the following conditions hold:
 * 1. The node has a manifest mapping (is represented in generated code).
 * 2. The node's element type is in the EDITABLE_ELEMENT_TYPES set.
 * 3. The node has at least one field covered by a supported override translator.
 *
 * When any condition fails, the result includes an explicit reason string
 * explaining why the node cannot enter edit mode.
 */
export function detectEditCapability(node: EditCapabilityNode): EditCapabilityResult {
  // Condition 1: manifest mapping required
  if (!node.mapped) {
    return {
      editable: false,
      reason: `Node "${node.name}" is not mapped in the component manifest. Only nodes with generated code can be edited.`,
      editableFields: []
    };
  }

  // Condition 2: element type must be in the editable set
  if (!EDITABLE_ELEMENT_TYPES.has(node.type)) {
    return {
      editable: false,
      reason: `Element type "${node.type}" does not support structured editing. Supported types: ${Array.from(EDITABLE_ELEMENT_TYPES).join(", ")}.`,
      editableFields: []
    };
  }

  // Condition 3: at least one supported override field must be present
  const presentFields = node.presentFields ?? [];
  const editableFields = SUPPORTED_OVERRIDE_FIELDS.filter(
    (field) => presentFields.includes(field)
  );

  if (editableFields.length === 0) {
    return {
      editable: false,
      reason: `Node "${node.name}" (${node.type}) has no fields supported by override translators. Supported fields: ${SUPPORTED_OVERRIDE_FIELDS.join(", ")}.`,
      editableFields: []
    };
  }

  return {
    editable: true,
    reason: null,
    editableFields
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the set of supported IR field names from a flat design-IR element node.
 * This is used to build the `presentFields` input for `detectEditCapability`.
 */
export function extractPresentFields(
  nodeData: Readonly<Record<string, unknown>>
): string[] {
  return [
    ...extractSupportedScalarOverrideFields(nodeData),
    ...extractSupportedLayoutOverrideFields(nodeData),
    ...extractSupportedFormValidationOverrideFields(nodeData)
  ];
}
