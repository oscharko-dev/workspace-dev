import type {
  BusinessTestIntentIr,
  DetectedField,
  DetectedValidation,
  InferredBusinessObject,
  IntentRedaction,
  PiiIndicator,
  VisualScreenDescription,
} from "../contracts/index.js";
import { detectPii, redactPii } from "./pii-detection.js";
import { maybeRedact, recordPiiIndicator } from "./pii-redaction.js";

export interface ReconcileSourcesInput {
  figmaIntent: BusinessTestIntentIr;
  visual: VisualScreenDescription[];
}

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const NON_ACTIONABLE_VISUAL_VALIDATION_HINTS = new Set([
  "button",
  "card",
  "checkbox",
  "column",
  "container",
  "dropdown",
  "header",
  "header row",
  "icon",
  "image",
  "label",
  "link",
  "list",
  "radio",
  "row",
  "section",
  "tab",
  "table",
  "table header",
  "table row",
  "table-header",
  "table-row",
  "text",
  "text input",
  "text-input",
]);

const ACTIONABLE_VALIDATION_HINT_PATTERNS: readonly RegExp[] = [
  /\b(required|mandatory|required field|pflicht|pflichtfeld)\b/iu,
  /\b(minimum|maximum|min|max|length|länge|zeichen|digits|stellen)\b/iu,
  /\b(format|pattern|regex|must match|muss entsprechen)\b/iu,
  /\b(valid|invalid|ungültig|gültig|error|fehler|warning|warnung)\b/iu,
  /\b(allowed|not allowed|erlaubt|nicht erlaubt|only|nur)\b/iu,
  /\b(must|muss|darf|soll)\b/iu,
  /\b(iban|bic|swift|email|e-mail|phone|telefon|tax|steuer)\b/iu,
  /\b(date|datum|amount|betrag|currency|währung)\b/iu,
];

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

  contextualizeChoiceFieldsFromVisualText(
    reconciledFields,
    visual,
    figmaIntent.piiIndicators,
    figmaIntent.redactions,
  );

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

interface VisualChoiceGroup {
  readonly context: string;
  readonly remainingChoices: Map<string, number>;
}

const COMMON_CHOICE_LABEL_PATTERN =
  /^(?:ja|nein|yes|no|true|false|wahr|falsch|netto|brutto)$/iu;

const CONTEXTUALIZED_CHOICE_SEPARATOR = " = ";

const contextualizeChoiceFieldsFromVisualText = (
  fields: DetectedField[],
  visual: readonly VisualScreenDescription[],
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  const contextsByScreen = new Map<string, VisualChoiceGroup[]>();
  for (const screen of visual) {
    const contexts = [
      ...parseChoiceContextsFromRegions(screen.regions),
      ...screen.regions.flatMap((region) =>
        parseChoiceContexts(region.visibleText ?? region.label ?? ""),
      ),
    ];
    if (contexts.length > 0) contextsByScreen.set(screen.screenId, contexts);
  }

  const fieldsByScreen = new Map<string, DetectedField[]>();
  for (const field of fields) {
    if (!isUncontextualizedCommonChoiceField(field)) continue;
    const existing = fieldsByScreen.get(field.screenId);
    if (existing === undefined) fieldsByScreen.set(field.screenId, [field]);
    else existing.push(field);
  }

  for (const [screenId, screenFields] of fieldsByScreen) {
    const contexts = contextsByScreen.get(screenId);
    if (contexts === undefined || contexts.length === 0) continue;
    let cursor = 0;
    for (const field of screenFields.sort(byId)) {
      const choice = normalizedChoice(field.label);
      const matchIndex = contexts.findIndex(
        (context, index) =>
          index >= cursor && (context.remainingChoices.get(choice) ?? 0) > 0,
      );
      if (matchIndex < 0) continue;
      const context = contexts[matchIndex];
      if (context === undefined) continue;
      const remaining = context.remainingChoices.get(choice) ?? 0;
      if (remaining <= 1) context.remainingChoices.delete(choice);
      else context.remainingChoices.set(choice, remaining - 1);
      while (
        cursor < contexts.length &&
        contexts[cursor]?.remainingChoices.size === 0
      ) {
        cursor += 1;
      }
      const contextualLabel = `${context.context}${CONTEXTUALIZED_CHOICE_SEPARATOR}${field.label}`;
      field.label = maybeRedact(
        contextualLabel,
        {
          screenId: field.screenId,
          elementId: field.id,
          traceRef: field.trace,
          location: "field_label",
        },
        piiIndicators,
        redactions,
      );
      field.provenance = "reconciled";
    }
  }
};

const parseChoiceContexts = (text: string): VisualChoiceGroup[] => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  const contexts: VisualChoiceGroup[] = [];
  let previousContext = "";
  for (const line of lines) {
    const choices = parseChoiceLine(line);
    if (choices.length >= 2 && previousContext.length > 0) {
      contexts.push({
        context: previousContext,
        remainingChoices: countChoices(choices),
      });
      continue;
    }
    if (!isLikelyNonContextLine(line)) previousContext = line;
  }
  return contexts;
};

const parseChoiceContextsFromRegions = (
  regions: readonly VisualScreenDescription["regions"][number][],
): VisualChoiceGroup[] => {
  const groups: VisualChoiceGroup[] = [];
  let previousContext = "";
  let pendingChoices: string[] = [];
  const flush = (): void => {
    if (pendingChoices.length >= 2 && previousContext.length > 0) {
      groups.push({
        context: previousContext,
        remainingChoices: countChoices(pendingChoices),
      });
    }
    pendingChoices = [];
  };

  for (const region of regions) {
    const text = regionText(region);
    if (text.length === 0) continue;
    const choices = parseChoiceLine(text);
    if (choices.length === 1 || COMMON_CHOICE_LABEL_PATTERN.test(text)) {
      if (previousContext.length > 0) pendingChoices.push(text);
      continue;
    }
    flush();
    if (isLikelyContextRegion(region, text)) previousContext = text;
  }
  flush();
  return groups;
};

const regionText = (
  region: VisualScreenDescription["regions"][number],
): string => (region.visibleText ?? region.label ?? "").replace(/\s+/gu, " ").trim();

const isLikelyContextRegion = (
  region: VisualScreenDescription["regions"][number],
  text: string,
): boolean => {
  if (isLikelyNonContextLine(text)) return false;
  const controlType = region.controlType?.trim().toLowerCase();
  return (
    controlType === undefined ||
    controlType === "label" ||
    controlType.startsWith("heading") ||
    controlType === "text"
  );
};

const countChoices = (choices: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const choice of choices) {
    const normalized = normalizedChoice(choice);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
};

const parseChoiceLine = (line: string): string[] => {
  const tokens = line
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length < 2 || tokens.length > 6) return [];
  return tokens.every((token) => COMMON_CHOICE_LABEL_PATTERN.test(token))
    ? tokens
    : [];
};

const isLikelyNonContextLine = (line: string): boolean =>
  /^[\d.,]+\s*(?:€|eur|%|monate?)?$/iu.test(line) ||
  COMMON_CHOICE_LABEL_PATTERN.test(line);

const isUncontextualizedCommonChoiceField = (field: DetectedField): boolean => {
  if (!COMMON_CHOICE_LABEL_PATTERN.test(field.label.trim())) return false;
  if (field.label.includes(CONTEXTUALIZED_CHOICE_SEPARATOR)) return false;
  return /(?:radio|checkbox|option|select)/iu.test(field.type);
};

const normalizedChoice = (value: string): string =>
  value.trim().normalize("NFKC").toLowerCase();

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
    if (!isActionableVisualValidationHint(rule)) continue;
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

const isActionableVisualValidationHint = (rule: string): boolean => {
  const normalized = rule
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length === 0) return false;
  if (NON_ACTIONABLE_VISUAL_VALIDATION_HINTS.has(normalized)) return false;
  if (detectPii(rule) !== null) return true;
  return ACTIONABLE_VALIDATION_HINT_PATTERNS.some((pattern) =>
    pattern.test(rule),
  );
};
