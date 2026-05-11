import type {
  BusinessTestIntentIr,
  DetectedField,
  DetectedValidation,
  InferredBusinessObject,
  IntentRedaction,
  PiiIndicator,
  VisualScreenDescription,
} from "../contracts/index.js";
import { redactPii } from "./pii-detection.js";
import { maybeRedact, recordPiiIndicator } from "./pii-redaction.js";

export interface ReconcileSourcesInput {
  figmaIntent: BusinessTestIntentIr;
  visual: VisualScreenDescription[];
}

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Merge visual-sidecar findings into a Figma-derived intent IR.
 *
 * Conflict rule:
 *   - Figma wins on label/type conflicts when Figma has a trace (is
 *     grounded in deterministic metadata).
 *   - A visual-side disagreement is surfaced as an `ambiguity` on the
 *     Figma field, rather than overwriting it.
 *   - Visual-only regions are added as new `detectedFields` with
 *     `provenance: "visual_sidecar"`.
 *   - Visual `validationHints` that are not already present in Figma
 *     become new `detectedValidations` tagged `visual_sidecar`.
 */
export const reconcileSources = (
  input: ReconcileSourcesInput,
): BusinessTestIntentIr => {
  const { figmaIntent, visual } = input;

  const reconciledFields: DetectedField[] = figmaIntent.detectedFields.map(
    (field) => ({ ...field }),
  );
  const fieldsByScreenAndNode = indexFieldsByTrace(reconciledFields);
  const newFields: DetectedField[] = [];
  const newValidations: DetectedValidation[] = [];
  const newBusinessObjects: InferredBusinessObject[] = [];

  for (const screen of visual) {
    for (const region of screen.regions) {
      const key = `${screen.screenId}::${region.regionId}`;
      const existing = fieldsByScreenAndNode.get(key);
      recordVisualPiiFlags(
        screen,
        region,
        existing?.id ?? toVisualFieldId(screen.screenId, region.regionId),
        figmaIntent.piiIndicators,
        figmaIntent.redactions,
      );
      if (existing) {
        reconcileExistingField(
          existing,
          region,
          figmaIntent.piiIndicators,
          figmaIntent.redactions,
        );
      } else if (region.controlType === "text_input") {
        newFields.push(
          buildVisualField(
            screen.screenId,
            region,
            figmaIntent.piiIndicators,
            figmaIntent.redactions,
          ),
        );
      }
      if (region.validationHints && region.validationHints.length > 0) {
        newValidations.push(
          ...buildVisualValidations(
            screen.screenId,
            region,
            figmaIntent,
            figmaIntent.piiIndicators,
            figmaIntent.redactions,
          ),
        );
      }
    }
  }

  const detectedFields = [...reconciledFields, ...newFields].sort(byId);
  const detectedValidations = [
    ...figmaIntent.detectedValidations,
    ...newValidations,
  ].sort(byId);
  const inferredBusinessObjects = [
    ...figmaIntent.inferredBusinessObjects,
    ...newBusinessObjects,
  ].sort(byId);

  return {
    ...figmaIntent,
    detectedFields,
    detectedValidations,
    inferredBusinessObjects,
  };
};

const indexFieldsByTrace = (
  fields: DetectedField[],
): Map<string, DetectedField> => {
  const map = new Map<string, DetectedField>();
  for (const field of fields) {
    const nodeId = field.trace.nodeId;
    if (nodeId === undefined) continue;
    map.set(`${field.screenId}::${nodeId}`, field);
  }
  return map;
};

const reconcileExistingField = (
  field: DetectedField,
  region: VisualScreenDescription["regions"][number],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  const visualLabel = region.label ?? region.visibleText;
  if (visualLabel === undefined) {
    field.provenance = "reconciled";
    return;
  }
  const visualLabelSource = region.label !== undefined ? "field_label" : "screen_text";
  const redactedVisualLabel = maybeRedact(
    visualLabel,
    {
      screenId: field.screenId,
      elementId: field.id,
      traceRef: field.trace,
      location: visualLabelSource,
    },
    piiIndicators,
    redactions,
  );
  if (labelsAgree(field.label, visualLabel)) {
    field.provenance = "reconciled";
    return;
  }
  field.provenance = "reconciled";
  field.ambiguity = {
    reason: maybeRedact(
      `Visual sidecar label "${redactedVisualLabel}" disagrees with Figma label "${field.label}"`,
      {
        screenId: field.screenId,
        elementId: field.id,
        traceRef: field.trace,
        location: "screen_text",
      },
      piiIndicators,
      redactions,
    ),
  };
};

const labelsAgree = (a: string, b: string): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

const buildVisualField = (
  screenId: string,
  region: VisualScreenDescription["regions"][number],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedField => {
  const id = toVisualFieldId(screenId, region.regionId);
  const labelSource =
    region.label !== undefined
      ? { text: region.label, location: "field_label" as const }
      : region.visibleText !== undefined
        ? { text: region.visibleText, location: "screen_text" as const }
        : undefined;
  const field: DetectedField = {
    id,
    screenId,
    trace: { nodeId: region.regionId },
    provenance: "visual_sidecar",
    confidence: region.confidence,
    label:
      labelSource === undefined
        ? region.regionId
        : maybeRedact(
            labelSource.text,
            {
              screenId,
              elementId: id,
              traceRef: { nodeId: region.regionId },
              location: labelSource.location,
            },
            piiIndicators,
            redactions,
          ),
    type: "text",
  };
  if (region.ambiguity) {
    field.ambiguity = {
      reason: maybeRedact(
        region.ambiguity.reason,
        {
          screenId,
          elementId: id,
          traceRef: { nodeId: region.regionId },
          location: "screen_text",
        },
        piiIndicators,
        redactions,
      ),
    };
  }
  return field;
};

const toVisualFieldId = (screenId: string, regionId: string): string => {
  return `${screenId}::field::visual::${regionId}`;
};

const recordVisualPiiFlags = (
  screen: VisualScreenDescription,
  region: VisualScreenDescription["regions"][number],
  elementId: string,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  for (const flag of screen.piiFlags ?? []) {
    if (flag.regionId !== region.regionId) continue;
    const redacted = redactPii(flag.kind);
    recordPiiIndicator(
      {
        kind: flag.kind,
        confidence: flag.confidence,
        redacted,
      },
      {
        screenId: screen.screenId,
        elementId,
        traceRef: { nodeId: region.regionId },
        location: "screen_text",
      },
      piiIndicators,
      redactions,
    );
  }
};

const buildVisualValidations = (
  screenId: string,
  region: VisualScreenDescription["regions"][number],
  figmaIntent: BusinessTestIntentIr,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): DetectedValidation[] => {
  const hints = region.validationHints ?? [];
  const existingRules = new Set(
    figmaIntent.detectedValidations
      .filter((v) => v.screenId === screenId)
      .map((v) => v.rule.toLowerCase()),
  );
  const out: DetectedValidation[] = [];
  for (const [index, rule] of hints.entries()) {
    if (existingRules.has(rule.toLowerCase())) continue;
    const redactedRule = maybeRedact(
      rule,
      {
        screenId,
        elementId: `${screenId}::validation::visual::${region.regionId}::${index}`,
        traceRef: { nodeId: region.regionId },
        location: "validation_rule",
      },
      piiIndicators,
      redactions,
    );
    out.push({
      id: `${screenId}::validation::visual::${region.regionId}::${index}::${redactedRule}`,
      screenId,
      trace: { nodeId: region.regionId },
      provenance: "visual_sidecar",
      confidence: region.confidence,
      rule: redactedRule,
    });
  }
  return out;
};
