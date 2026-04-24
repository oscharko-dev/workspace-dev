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
  type PiiMatchLocation,
  type IntentRedaction,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { detectPii, type PiiMatch } from "./pii-detection.js";
import { reconcileSources } from "./reconciliation.js";

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
  "TEXT",
]);
const ACTION_NODE_TYPES = new Set(["BUTTON", "CTA", "LINK"]);

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

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
        type: "text",
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
      if (!ACTION_NODE_TYPES.has(node.nodeType.toUpperCase())) continue;
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
        kind: node.nodeType.toLowerCase(),
      };
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
  return trace;
};

interface MaybeRedactContext {
  screenId: string;
  elementId?: string;
  traceRef: IntentTraceRef;
  location: PiiMatchLocation;
}

const maybeRedact = (
  value: string,
  ctx: MaybeRedactContext,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): string => {
  const match = detectPii(value);
  if (match === null) return value;
  recordPii(match, ctx, piiIndicators, redactions);
  return match.redacted;
};

const recordPii = (
  match: PiiMatch,
  ctx: MaybeRedactContext,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  const prefix = ctx.elementId ?? ctx.screenId;
  const indicatorId = `${prefix}::pii::${match.kind}::${ctx.location}`;
  const indicator: PiiIndicator = {
    id: indicatorId,
    kind: match.kind,
    confidence: match.confidence,
    matchLocation: ctx.location,
    redacted: match.redacted,
    screenId: ctx.screenId,
    traceRef: ctx.traceRef,
  };
  if (ctx.elementId !== undefined) indicator.elementId = ctx.elementId;
  piiIndicators.push(indicator);
  redactions.push({
    id: `${indicatorId}::redaction`,
    indicatorId,
    kind: match.kind,
    reason: `Detected ${match.kind} in ${ctx.location}`,
    replacement: match.redacted,
  });
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
