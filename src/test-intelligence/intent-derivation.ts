import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type BusinessTestIntentIrSource,
  type BusinessTestIntentScreen,
  type DetectedAction,
  type DetectedField,
  type DetectedNavigation,
  type DetectedValidation,
  type IntentTraceRef,
  type PiiIndicator,
  type IntentRedaction,
  type SupportedLocale,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { reconcileSources } from "./reconciliation.js";
import { maybeRedact } from "./pii-redaction.js";

/** Narrow, test-friendly input shape consumed by the derivation. */
export interface IntentDerivationFigmaInput {
  source: {
    kind: "figma_local_json" | "figma_plugin" | "figma_rest" | "hybrid";
  };
  screens: IntentDerivationScreenInput[];
}

export interface IntentDerivationScreenInput {
  screenId: string;
  screenName: string;
  screenPath?: string;
  nodes: IntentDerivationNodeInput[];
  /**
   * Optional locale tag for this screen (Issue #2117).  Carried verbatim from
   * the importer into the IR `BusinessTestIntentScreen.locale` field.
   * Derivation consumers use `deriveLocaleFromBusinessTestIntentScreen` from
   * `locale-calibration.ts`; intent-derivation itself does no locale
   * resolution — it just copies the field when present.
   */
  locale?: SupportedLocale;
}

export interface IntentDerivationNodeInput {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodePath?: string;
  text?: string;
  defaultValue?: string;
  validations?: string[];
  navigationTarget?: string;
  childNodeIds?: string[];
  /**
   * Semantic kind preserved from the Figma normalizer so downstream passes
   * can distinguish radio options, select fields, result displays, and
   * informative labels from generic text.
   */
  semanticKind?: string;
  /**
   * Original Figma component-instance name for actions/fields whose visible
   * label was synthesised from a sibling TEXT node (Issue #1902). Surfaced
   * onto the trace so judges can recover the raw component identity.
   */
  componentName?: string;
  /**
   * How the visible label was derived (Issue #1902). Either a real text node
   * (`node_text`), a fallback to the node name (`node_name`), or a spatial
   * cluster donor (`sibling_text`).
   */
  labelSource?: "node_text" | "node_name" | "sibling_text";
  /** Confidence in the synthesised label (Issue #1902); 0 = weak label. */
  labelConfidence?: number;
  /** Spatial-cluster id assigned by the normalizer (Issue #1902). */
  clusterId?: string;
  /**
   * Absolute bounding box of the source Figma node. Optional and unused by
   * the public derivation, but carried for downstream consumers that want to
   * re-derive geometry without re-walking the REST tree.
   */
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface DeriveBusinessTestIntentIrInput {
  figma: IntentDerivationFigmaInput;
  visual?: VisualScreenDescription[];
}

const INPUT_TEXT_FIELD_TYPES = new Set([
  "TEXT_INPUT",
  "INPUT",
  "TEXT_FIELD",
  "TEXTFIELD",
  "RADIO_OPTION",
  "SELECT_FIELD",
  "RESULT_DISPLAY",
  "INFORMATIVE_LABEL",
  "TEXT",
]);
const ACTION_NODE_TYPES = new Set(["BUTTON", "CTA", "LINK"]);
const INTERACTION_ACTION_NODE_TYPES = new Set([
  "TEXT_INPUT",
  "INPUT",
  "TEXT_FIELD",
  "TEXTFIELD",
  "RADIO_OPTION",
  "SELECT_FIELD",
]);
const INTERACTION_ACTION_SEMANTIC_KINDS = new Set([
  "text_input",
  "input",
  "text_field",
  "textfield",
  "radio_option",
  "select_field",
  "select",
  "dropdown",
]);

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const resolveFieldType = (node: IntentDerivationNodeInput): string => {
  const semanticKind = node.semanticKind?.trim().toLowerCase();
  if (semanticKind && semanticKind !== "button" && semanticKind !== "decorative") {
    return semanticKind;
  }
  const nodeType = node.nodeType.trim().toUpperCase();
  switch (nodeType) {
    case "TEXT_INPUT":
      return "text_input";
    case "RADIO_OPTION":
      return "radio_option";
    case "SELECT_FIELD":
      return "select_field";
    case "RESULT_DISPLAY":
      return "result_display";
    case "INFORMATIVE_LABEL":
      return "informative_label";
    default:
      return nodeType.toLowerCase();
  }
};

const isInteractionActionNode = (node: IntentDerivationNodeInput): boolean => {
  if (INTERACTION_ACTION_NODE_TYPES.has(node.nodeType.trim().toUpperCase())) {
    return true;
  }
  const semanticKind = node.semanticKind?.trim().toLowerCase();
  return (
    semanticKind !== undefined &&
    INTERACTION_ACTION_SEMANTIC_KINDS.has(semanticKind)
  );
};

const resolveInteractionActionKind = (
  node: IntentDerivationNodeInput,
): string => {
  switch (resolveFieldType(node)) {
    case "radio_option":
      return "select_radio_option";
    case "select_field":
    case "select":
    case "dropdown":
      return "change_select";
    default:
      return "change_input";
  }
};

/**
 * Pure derivation from a normalized Figma input (and optional visual sidecar)
 * into a redacted, trace-carrying Business Test Intent IR. The function is
 * deterministic: identical inputs produce byte-identical outputs.
 */
export const deriveBusinessTestIntentIr = (
  input: DeriveBusinessTestIntentIrInput,
): BusinessTestIntentIr => {
  const source: BusinessTestIntentIrSource = {
    kind: input.figma.source.kind,
    contentHash: sha256Hex({
      figma: input.figma,
      visual: input.visual ?? [],
    }),
  };

  const piiIndicators: PiiIndicator[] = [];
  const redactions: IntentRedaction[] = [];

  const screens = deriveScreens(input.figma.screens, piiIndicators, redactions);

  const detectedFields = deriveFields(
    input.figma.screens,
    piiIndicators,
    redactions,
  );
  const detectedActions = deriveActions(
    input.figma.screens,
    piiIndicators,
    redactions,
  );
  const detectedValidations = deriveValidationsFromFigma(
    input.figma.screens,
    piiIndicators,
    redactions,
  );
  const detectedNavigation = deriveNavigation(
    input.figma.screens,
    piiIndicators,
    redactions,
  );

  const figmaIr: BusinessTestIntentIr = {
    version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
    source,
    screens,
    detectedFields,
    detectedActions,
    detectedValidations,
    detectedNavigation,
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    piiIndicators,
    redactions,
  };

  const reconciled = input.visual
    ? reconcileSources({ figmaIntent: figmaIr, visual: input.visual })
    : figmaIr;

  return sortAllArrays(reconciled);
};

const deriveScreens = (
  screens: IntentDerivationScreenInput[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): BusinessTestIntentScreen[] => {
  const result: BusinessTestIntentScreen[] = screens.map((screen) => {
    const screenTraceRef: IntentTraceRef = { nodeId: screen.screenId };
    const screenName = maybeRedact(
      screen.screenName,
      {
        screenId: screen.screenId,
        traceRef: screenTraceRef,
        location: "screen_name",
      },
      piiIndicators,
      redactions,
    );
    const trace: IntentTraceRef = {
      nodeId: screen.screenId,
      nodeName: screenName,
    };
    let screenPath: string | undefined;
    if (screen.screenPath !== undefined) {
      screenPath = maybeRedact(
        screen.screenPath,
        {
          screenId: screen.screenId,
          traceRef: screenTraceRef,
          location: "screen_path",
        },
        piiIndicators,
        redactions,
      );
      trace.nodePath = screenPath;
    }
    const entry: BusinessTestIntentScreen = {
      screenId: screen.screenId,
      screenName,
      trace,
    };
    if (screenPath !== undefined) entry.screenPath = screenPath;
    // Carry locale verbatim from the importer (Issue #2117); no derivation
    // is done here — consumers call deriveLocaleFromBusinessTestIntentScreen.
    if (screen.locale !== undefined) entry.locale = screen.locale;
    return entry;
  });
  return result.sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );
};

const deriveFields = (
  screens: IntentDerivationScreenInput[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedField[] => {
  const fields: DetectedField[] = [];
  for (const screen of screens) {
    for (const node of screen.nodes) {
      if (!INPUT_TEXT_FIELD_TYPES.has(node.nodeType.toUpperCase())) continue;
      const id = `${screen.screenId}::field::${node.nodeId}`;
      const trace = buildTrace(
        node,
        screen.screenId,
        id,
        piiIndicators,
        redactions,
      );
      const label = node.text ?? node.nodeName;
      const field: DetectedField = {
        id,
        screenId: screen.screenId,
        trace,
        provenance: "figma_node",
        confidence: 0.9,
        label: maybeRedact(
          label,
          {
            screenId: screen.screenId,
            elementId: id,
            traceRef: trace,
            location: "field_label",
          },
          piiIndicators,
          redactions,
        ),
        type: resolveFieldType(node),
      };
      if (node.defaultValue !== undefined) {
        field.defaultValue = maybeRedact(
          node.defaultValue,
          {
            screenId: screen.screenId,
            elementId: id,
            traceRef: trace,
            location: "field_default_value",
          },
          piiIndicators,
          redactions,
        );
      }
      if (node.labelSource !== undefined) field.labelSource = node.labelSource;
      if (node.labelConfidence !== undefined) {
        field.labelConfidence = node.labelConfidence;
      }
      if (node.clusterId !== undefined) field.clusterId = node.clusterId;
      fields.push(field);
    }
  }
  return fields.sort(byId);
};

const deriveActions = (
  screens: IntentDerivationScreenInput[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedAction[] => {
  const actions: DetectedAction[] = [];
  for (const screen of screens) {
    for (const node of screen.nodes) {
      const isPrimaryAction = ACTION_NODE_TYPES.has(node.nodeType.toUpperCase());
      if (!isPrimaryAction && !isInteractionActionNode(node)) continue;
      const id = `${screen.screenId}::action::${node.nodeId}`;
      const trace = buildTrace(
        node,
        screen.screenId,
        id,
        piiIndicators,
        redactions,
      );
      const label = node.text ?? node.nodeName;
      const action: DetectedAction = {
        id,
        screenId: screen.screenId,
        trace,
        provenance: "figma_node",
        confidence: 0.9,
        label: maybeRedact(
          label,
          {
            screenId: screen.screenId,
            elementId: id,
            traceRef: trace,
            location: "action_label",
          },
          piiIndicators,
          redactions,
        ),
        kind:
          isPrimaryAction
            ? (node.semanticKind?.trim().toLowerCase() ??
              node.nodeType.toLowerCase())
            : resolveInteractionActionKind(node),
      };
      if (node.labelSource !== undefined) {
        action.labelSource = node.labelSource;
      }
      if (node.labelConfidence !== undefined) {
        action.labelConfidence = node.labelConfidence;
      }
      actions.push(action);
    }
  }
  return actions.sort(byId);
};

const deriveValidationsFromFigma = (
  screens: IntentDerivationScreenInput[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedValidation[] => {
  const validations: DetectedValidation[] = [];
  for (const screen of screens) {
    for (const node of screen.nodes) {
      if (!node.validations || node.validations.length === 0) continue;
      const targetFieldId = INPUT_TEXT_FIELD_TYPES.has(
        node.nodeType.toUpperCase(),
      )
        ? `${screen.screenId}::field::${node.nodeId}`
        : undefined;
      for (const rule of node.validations) {
        const validationId = `${screen.screenId}::validation::${node.nodeId}`;
        const owningElementId = targetFieldId ?? validationId;
        const traceRef: IntentTraceRef = { nodeId: node.nodeId };
        const redactedRule = maybeRedact(
          rule,
          {
            screenId: screen.screenId,
            elementId: owningElementId,
            traceRef,
            location: "validation_rule",
          },
          piiIndicators,
          redactions,
        );
        const id = `${validationId}::${redactedRule}`;
        const trace = buildTrace(
          node,
          screen.screenId,
          owningElementId,
          piiIndicators,
          redactions,
        );
        const validation: DetectedValidation = {
          id,
          screenId: screen.screenId,
          trace,
          provenance: "figma_node",
          confidence: 0.85,
          rule: redactedRule,
        };
        if (targetFieldId !== undefined)
          validation.targetFieldId = targetFieldId;
        validations.push(validation);
      }
    }
  }
  return validations.sort(byId);
};

const deriveNavigation = (
  screens: IntentDerivationScreenInput[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedNavigation[] => {
  const nav: DetectedNavigation[] = [];
  for (const screen of screens) {
    for (const node of screen.nodes) {
      if (node.navigationTarget === undefined) continue;
      const id = `${screen.screenId}::nav::${node.nodeId}`;
      const traceRef: IntentTraceRef = { nodeId: node.nodeId };
      const targetScreenId = maybeRedact(
        node.navigationTarget,
        {
          screenId: screen.screenId,
          elementId: id,
          traceRef,
          location: "navigation_target",
        },
        piiIndicators,
        redactions,
      );
      const trace = buildTrace(
        node,
        screen.screenId,
        id,
        piiIndicators,
        redactions,
      );
      nav.push({
        id,
        screenId: screen.screenId,
        trace,
        provenance: "figma_node",
        confidence: 0.8,
        targetScreenId,
        triggerElementId: `${screen.screenId}::action::${node.nodeId}`,
      });
    }
  }
  return nav.sort(byId);
};

const buildTrace = (
  node: IntentDerivationNodeInput,
  screenId: string,
  elementId: string,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): IntentTraceRef => {
  const traceRef: IntentTraceRef = { nodeId: node.nodeId };
  const nodeName = maybeRedact(
    node.nodeName,
    {
      screenId,
      elementId,
      traceRef,
      location: "trace_node_name",
    },
    piiIndicators,
    redactions,
  );
  const trace: IntentTraceRef = {
    nodeId: node.nodeId,
    nodeName,
  };
  if (node.nodePath !== undefined) {
    trace.nodePath = maybeRedact(
      node.nodePath,
      {
        screenId,
        elementId,
        traceRef,
        location: "trace_node_path",
      },
      piiIndicators,
      redactions,
    );
  }
  if (node.componentName !== undefined) {
    trace.componentName = maybeRedact(
      node.componentName,
      {
        screenId,
        elementId,
        traceRef,
        location: "trace_node_name",
      },
      piiIndicators,
      redactions,
    );
  }
  return trace;
};

const sortAllArrays = (ir: BusinessTestIntentIr): BusinessTestIntentIr => {
  return {
    ...ir,
    screens: [...ir.screens].sort((a, b) =>
      a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
    ),
    detectedFields: [...ir.detectedFields].sort(byId),
    detectedActions: [...ir.detectedActions].sort(byId),
    detectedValidations: [...ir.detectedValidations].sort(byId),
    detectedNavigation: [...ir.detectedNavigation].sort(byId),
    inferredBusinessObjects: [...ir.inferredBusinessObjects].sort(byId),
    piiIndicators: [...ir.piiIndicators].sort(byId),
    redactions: [...ir.redactions].sort(byId),
    risks: [...ir.risks].sort(),
    assumptions: [...ir.assumptions].sort(),
    openQuestions: [...ir.openQuestions].sort(),
  };
};
