import type {
  BusinessTestIntentIr,
  DetectedField,
  DetectedValidation,
  InferredBusinessObject,
  VisualScreenDescription,
} from "../contracts/index.js";

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
      if (existing) {
        reconcileExistingField(existing, region);
      } else if (region.controlType === "text_input") {
        newFields.push(buildVisualField(screen.screenId, region));
      }
      if (region.validationHints && region.validationHints.length > 0) {
        newValidations.push(
          ...buildVisualValidations(screen.screenId, region, figmaIntent),
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
): void => {
  const visualLabel = region.label ?? region.visibleText;
  if (visualLabel === undefined) {
    field.provenance = "reconciled";
    return;
  }
  if (labelsAgree(field.label, visualLabel)) {
    field.provenance = "reconciled";
    return;
  }
  field.provenance = "reconciled";
  field.ambiguity = {
    reason: `Visual sidecar label "${visualLabel}" disagrees with Figma label "${field.label}"`,
  };
};

const labelsAgree = (a: string, b: string): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

const buildVisualField = (
  screenId: string,
  region: VisualScreenDescription["regions"][number],
): DetectedField => {
  const id = `${screenId}::field::visual::${region.regionId}`;
  const field: DetectedField = {
    id,
    screenId,
    trace: { nodeId: region.regionId },
    provenance: "visual_sidecar",
    confidence: region.confidence,
    label: region.label ?? region.visibleText ?? region.regionId,
    type: "text",
  };
  if (region.ambiguity) field.ambiguity = region.ambiguity;
  return field;
};

const buildVisualValidations = (
  screenId: string,
  region: VisualScreenDescription["regions"][number],
  figmaIntent: BusinessTestIntentIr,
): DetectedValidation[] => {
  const hints = region.validationHints ?? [];
  const existingRules = new Set(
    figmaIntent.detectedValidations
      .filter((v) => v.screenId === screenId)
      .map((v) => v.rule.toLowerCase()),
  );
  const out: DetectedValidation[] = [];
  for (const rule of hints) {
    if (existingRules.has(rule.toLowerCase())) continue;
    out.push({
      id: `${screenId}::validation::visual::${region.regionId}::${rule}`,
      screenId,
      trace: { nodeId: region.regionId },
      provenance: "visual_sidecar",
      confidence: region.confidence,
      rule,
    });
  }
  return out;
};
