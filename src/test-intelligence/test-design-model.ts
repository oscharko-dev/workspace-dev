import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TEST_DESIGN_MODEL_ARTIFACT_FILENAME,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type IntentTraceRef,
  type MultiSourceConflict,
  type MultiSourceTestIntentEnvelope,
  type TestDesignAction,
  type TestDesignAssumption,
  type TestDesignCalculation,
  type TestDesignElement,
  type TestDesignModel,
  type TestDesignOpenQuestion,
  type TestDesignRiskSignal,
  type TestDesignRule,
  type TestDesignScreen,
  type TestDesignValidation,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

const HEX64_RE = /^[0-9a-f]{64}$/;
const ROOT_KEYS = [
  "schemaVersion",
  "jobId",
  "sourceHash",
  "screens",
  "businessRules",
  "assumptions",
  "openQuestions",
  "riskSignals",
] as const;
const SCREEN_KEYS = [
  "screenId",
  "name",
  "purpose",
  "elements",
  "actions",
  "validations",
  "calculations",
  "visualRefs",
  "sourceRefs",
] as const;
const ELEMENT_KEYS = [
  "elementId",
  "label",
  "kind",
  "defaultValue",
  "ambiguity",
] as const;
const ACTION_KEYS = [
  "actionId",
  "label",
  "kind",
  "targetScreenId",
  "ambiguity",
] as const;
const VALIDATION_KEYS = [
  "validationId",
  "rule",
  "targetElementId",
  "ambiguity",
] as const;
const CALCULATION_KEYS = [
  "calculationId",
  "name",
  "inputElementIds",
  "ambiguity",
] as const;
const RULE_KEYS = ["ruleId", "description", "screenId", "sourceRefs"] as const;
const ASSUMPTION_KEYS = ["assumptionId", "text"] as const;
const OPEN_QUESTION_KEYS = ["openQuestionId", "text"] as const;
const RISK_SIGNAL_KEYS = [
  "riskSignalId",
  "text",
  "screenId",
  "sourceRefs",
] as const;
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all )?(previous|prior) (instructions|directives)\b/i,
  /\bdisregard (the )?(system|instructions)\b/i,
  /\bsystem\s*:\s*/i,
  /\b<\s*\/?\s*(system|user|assistant)\s*>/i,
  /\bsudo\s+/i,
  /\bjailbreak\b/i,
  /\boverride (this|the) (rule|policy)\b/i,
] as const;
const CALCULATION_RULE_PATTERN =
  /\b(computed|calculate(?:d)?|formula|rounded?|rounding|derived?)\b|=/i;

export interface BuildTestDesignModelInput {
  jobId: string;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
  sourceEnvelope?: MultiSourceTestIntentEnvelope;
}

export interface TestDesignModelValidationIssue {
  path: string;
  message: string;
}

export interface TestDesignModelValidationResult {
  valid: boolean;
  errors: TestDesignModelValidationIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => Object.keys(value).every((key) => allowedKeys.includes(key));

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const stableId = (prefix: string, seed: unknown): string =>
  `${prefix}-${sha256Hex(seed).slice(0, 12)}`;

const toVisualRef = (screenId: string, regionId: string): string =>
  `visual:${screenId}:${regionId}`;

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const collectTraceSourceRefs = (trace: IntentTraceRef | undefined): string[] =>
  uniqueSorted((trace?.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId));

const buildScreenSourceRefs = ({
  screenId,
  intent,
}: {
  screenId: string;
  intent: BusinessTestIntentIr;
}): string[] =>
  uniqueSorted([
    ...collectTraceSourceRefs(
      intent.screens.find((screen) => screen.screenId === screenId)?.trace,
    ),
    ...intent.detectedFields
      .filter((field) => field.screenId === screenId)
      .flatMap((field) => [
        ...collectTraceSourceRefs(field.trace),
        ...(field.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
      ]),
    ...intent.detectedActions
      .filter((action) => action.screenId === screenId)
      .flatMap((action) => [
        ...collectTraceSourceRefs(action.trace),
        ...(action.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
      ]),
    ...intent.detectedValidations
      .filter((validation) => validation.screenId === screenId)
      .flatMap((validation) => [
        ...collectTraceSourceRefs(validation.trace),
        ...(validation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
      ]),
    ...intent.detectedNavigation
      .filter((navigation) => navigation.screenId === screenId)
      .flatMap((navigation) => [
        ...collectTraceSourceRefs(navigation.trace),
        ...(navigation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
      ]),
    ...intent.inferredBusinessObjects
      .filter((businessObject) => businessObject.screenId === screenId)
      .flatMap((businessObject) => [
        ...collectTraceSourceRefs(businessObject.trace),
        ...(businessObject.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
      ]),
    ...intent.piiIndicators
      .filter((indicator) => indicator.screenId === screenId)
      .flatMap((indicator) => collectTraceSourceRefs(indicator.traceRef)),
  ]);

const buildAllSourceRefs = ({
  intent,
  sourceEnvelope,
}: {
  intent: BusinessTestIntentIr;
  sourceEnvelope: MultiSourceTestIntentEnvelope | undefined;
}): string[] =>
  uniqueSorted([
    ...(sourceEnvelope?.sources.map((source) => source.sourceId) ?? []),
    ...intent.screens.flatMap((screen) => collectTraceSourceRefs(screen.trace)),
    ...intent.detectedFields.flatMap((field) => [
      ...collectTraceSourceRefs(field.trace),
      ...(field.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
    ]),
    ...intent.detectedActions.flatMap((action) => [
      ...collectTraceSourceRefs(action.trace),
      ...(action.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
    ]),
    ...intent.detectedValidations.flatMap((validation) => [
      ...collectTraceSourceRefs(validation.trace),
      ...(validation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
    ]),
    ...intent.detectedNavigation.flatMap((navigation) => [
      ...collectTraceSourceRefs(navigation.trace),
      ...(navigation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
    ]),
    ...intent.inferredBusinessObjects.flatMap((businessObject) => [
      ...collectTraceSourceRefs(businessObject.trace),
      ...(businessObject.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
    ]),
    ...intent.piiIndicators.flatMap((indicator) =>
      collectTraceSourceRefs(indicator.traceRef),
    ),
    ...(intent.multiSourceConflicts ?? []).flatMap(
      (conflict) => conflict.participatingSourceIds,
    ),
  ]);

const buildSourceHash = ({
  intent,
  visual,
  sourceEnvelope,
}: {
  intent: BusinessTestIntentIr;
  visual: ReadonlyArray<VisualScreenDescription>;
  sourceEnvelope: MultiSourceTestIntentEnvelope | undefined;
}): string =>
  sha256Hex({
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    intent,
    visual,
    sourceEnvelope,
  });

const buildBusinessRuleDescription = ({
  label,
  rule,
  screenName,
}: {
  label: string | undefined;
  rule: string;
  screenName: string | undefined;
}): string => {
  if (label !== undefined && label.length > 0) {
    return `${label}: ${rule}`;
  }
  if (screenName !== undefined && screenName.length > 0) {
    return `${screenName}: ${rule}`;
  }
  return rule;
};

const isCalculationRule = (rule: string): boolean =>
  CALCULATION_RULE_PATTERN.test(rule);

const containsPromptInjectionLikeText = (text: string | undefined): boolean => {
  if (text === undefined || text.length === 0) return false;
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
};

const inferCalculationInputElementIds = ({
  rule,
  targetElementId,
  fields,
}: {
  rule: string;
  targetElementId: string | undefined;
  fields: ReadonlyArray<TestDesignElement>;
}): string[] => {
  const normalizedRule = normalizeText(rule);
  const otherFields = fields.filter((field) => field.elementId !== targetElementId);
  const explicitMatches = otherFields
    .filter((field) => {
      const normalizedLabel = normalizeText(field.label);
      if (normalizedLabel.length > 0 && normalizedRule.includes(normalizedLabel)) {
        return true;
      }
      const tokens = normalizedLabel
        .split(" ")
        .filter((token) => token.length >= 4 || token === "rate");
      return tokens.some((token) => normalizedRule.includes(token));
    })
    .map((field) => field.elementId);
  if (explicitMatches.length > 0) {
    return uniqueSorted(explicitMatches);
  }
  return otherFields
    .map((field) => field.elementId)
    .sort((left, right) => left.localeCompare(right));
};

const buildCalculationsForScreen = ({
  screenId,
  fields,
  validations,
}: {
  screenId: string;
  fields: ReadonlyArray<TestDesignElement>;
  validations: ReadonlyArray<TestDesignValidation>;
}): TestDesignCalculation[] =>
  validations
    .filter((validation) => isCalculationRule(validation.rule))
    .map((validation) => {
      const inputElementIds = inferCalculationInputElementIds({
        rule: validation.rule,
        targetElementId: validation.targetElementId,
        fields,
      });
      const targetLabel =
        validation.targetElementId === undefined
          ? undefined
          : fields.find((field) => field.elementId === validation.targetElementId)?.label;
      return {
        calculationId: stableId("calculation", {
          screenId,
          rule: validation.rule,
          targetElementId: validation.targetElementId ?? null,
          inputElementIds,
        }),
        name: targetLabel ?? `Calculation on ${screenId}`,
        inputElementIds,
        ...(validation.ambiguity !== undefined
          ? { ambiguity: validation.ambiguity }
          : !validation.rule.includes("=") && inputElementIds.length > 0
            ? {
                ambiguity:
                  "Input operands were inferred from same-screen fields because the rule text did not name them explicitly.",
              }
            : {}),
      };
    })
    .sort((left, right) => left.calculationId.localeCompare(right.calculationId));

const buildConflictOpenQuestion = (conflict: MultiSourceConflict): string =>
  `multi-source conflict ${conflict.conflictId} requires reviewer attention`;

const buildEntityAmbiguityQuestion = ({
  screenName,
  screenId,
  entityKind,
  label,
  reason,
}: {
  screenName: string;
  screenId: string;
  entityKind: string;
  label: string;
  reason: string;
}): string =>
  `${entityKind} "${label}" on screen "${screenName}" (${screenId}) is ambiguous: ${reason}. What should test coverage assume?`;

const buildVisualCoverageQuestions = ({
  screen,
  visual,
}: {
  screen: TestDesignScreen;
  visual: VisualScreenDescription | undefined;
}): string[] => {
  if (visual === undefined) return [];
  const mappedIds = new Set([
    ...screen.elements.map((element) => element.elementId),
    ...screen.actions.map((action) => action.actionId),
  ]);
  const mappedLabels = new Set(
    [...screen.elements.map((element) => element.label), ...screen.actions.map((action) => action.label)]
      .map((label) => normalizeText(label))
      .filter((label) => label.length > 0),
  );
  return visual.regions.flatMap((region) => {
    const regionLabel = region.label ?? region.visibleText ?? region.regionId;
    const mapped =
      mappedIds.has(region.regionId) ||
      mappedLabels.has(normalizeText(regionLabel));
    const questions: string[] = [];
    if (!mapped && region.controlType !== undefined) {
      questions.push(
        `Visual region "${regionLabel}" on screen "${screen.name}" was not mapped to an intent element or action. Should test coverage include it?`,
      );
    }
    if (region.ambiguity !== undefined) {
      questions.push(
        `Visual region "${regionLabel}" on screen "${screen.name}" is ambiguous: ${region.ambiguity.reason}. What should test coverage assume?`,
      );
    }
    return questions;
  });
};

export const buildTestDesignModel = (
  input: BuildTestDesignModelInput,
): TestDesignModel => {
  const sourceEnvelope = input.sourceEnvelope ?? input.intent.sourceEnvelope;
  const visual = [...(input.visual ?? [])].sort((left, right) =>
    left.screenId.localeCompare(right.screenId),
  );
  const allSourceRefs = buildAllSourceRefs({ intent: input.intent, sourceEnvelope });
  const visualByScreenId = new Map(
    visual.map((screen) => [
      screen.screenId,
      uniqueSorted(
        screen.regions.map((region) => toVisualRef(screen.screenId, region.regionId)),
      ),
    ]),
  );
  const fieldLabelById = new Map(
    input.intent.detectedFields.map((field) => [field.id, field.label] as const),
  );

  const screens: TestDesignScreen[] = [...input.intent.screens]
    .sort((left, right) => left.screenId.localeCompare(right.screenId))
    .map((screen) => {
      const elements: TestDesignElement[] = input.intent.detectedFields
        .filter((field) => field.screenId === screen.screenId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((field) => ({
          elementId: field.id,
          label: field.label,
          kind: field.type,
          ...(field.defaultValue !== undefined
            ? { defaultValue: field.defaultValue }
            : {}),
          ...(field.ambiguity !== undefined
            ? { ambiguity: field.ambiguity.reason }
            : {}),
        }));

      const actions: TestDesignAction[] = input.intent.detectedActions
        .filter((action) => action.screenId === screen.screenId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((action) => {
          const navigationTarget = input.intent.detectedNavigation.find(
            (navigation) => navigation.triggerElementId === action.id,
          )?.targetScreenId;
          return {
            actionId: action.id,
            label: action.label,
            kind: action.kind,
            ...(navigationTarget !== undefined
              ? { targetScreenId: navigationTarget }
              : {}),
            ...(action.ambiguity !== undefined
              ? { ambiguity: action.ambiguity.reason }
              : {}),
          };
        });

      const validations: TestDesignValidation[] = input.intent.detectedValidations
        .filter((validation) => validation.screenId === screen.screenId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((validation) => ({
          validationId: validation.id,
          rule: validation.rule,
          ...(validation.targetFieldId !== undefined
            ? { targetElementId: validation.targetFieldId }
            : {}),
          ...(validation.ambiguity !== undefined
            ? { ambiguity: validation.ambiguity.reason }
            : {}),
        }));

      const sourceRefs = buildScreenSourceRefs({
        screenId: screen.screenId,
        intent: input.intent,
      });
      const calculations = buildCalculationsForScreen({
        screenId: screen.screenId,
        fields: elements,
        validations,
      });

      return {
        screenId: screen.screenId,
        name: screen.screenName,
        elements,
        actions,
        validations,
        calculations,
        visualRefs: visualByScreenId.get(screen.screenId) ?? [],
        sourceRefs,
      };
    });

  const businessRules: TestDesignRule[] = [...input.intent.detectedValidations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((validation) => {
      const screenName = input.intent.screens.find(
        (screen) => screen.screenId === validation.screenId,
      )?.screenName;
      return {
        ruleId: stableId("rule", {
          screenId: validation.screenId,
          rule: validation.rule,
          targetFieldId: validation.targetFieldId ?? null,
        }),
        description: buildBusinessRuleDescription({
          label:
            validation.targetFieldId !== undefined
              ? fieldLabelById.get(validation.targetFieldId)
              : undefined,
          rule: validation.rule,
          screenName,
        }),
        ...(validation.screenId.length > 0 ? { screenId: validation.screenId } : {}),
        sourceRefs: uniqueSorted([
          ...collectTraceSourceRefs(validation.trace),
          ...(validation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
        ]),
      };
    });

  const assumptions: TestDesignAssumption[] = uniqueSorted(input.intent.assumptions).map(
    (text) => ({
      assumptionId: stableId("assumption", text),
      text,
    }),
  );

  const screenNameById = new Map(
    input.intent.screens.map((screen) => [screen.screenId, screen.screenName] as const),
  );
  const visualMap = new Map(visual.map((screen) => [screen.screenId, screen] as const));

  const openQuestions: TestDesignOpenQuestion[] = uniqueSorted([
    ...input.intent.openQuestions,
    ...(input.intent.multiSourceConflicts ?? [])
      .filter((conflict) => conflict.resolution !== "auto_priority")
      .map(buildConflictOpenQuestion),
    ...input.intent.detectedFields
      .filter((field) => field.ambiguity !== undefined)
      .map((field) =>
        buildEntityAmbiguityQuestion({
          screenName: screenNameById.get(field.screenId) ?? field.screenId,
          screenId: field.screenId,
          entityKind: "Field",
          label: field.label,
          reason: field.ambiguity!.reason,
        }),
      ),
    ...input.intent.detectedActions
      .filter((action) => action.ambiguity !== undefined)
      .map((action) =>
        buildEntityAmbiguityQuestion({
          screenName: screenNameById.get(action.screenId) ?? action.screenId,
          screenId: action.screenId,
          entityKind: "Action",
          label: action.label,
          reason: action.ambiguity!.reason,
        }),
      ),
    ...input.intent.detectedValidations
      .filter((validation) => validation.ambiguity !== undefined)
      .map((validation) =>
        buildEntityAmbiguityQuestion({
          screenName: screenNameById.get(validation.screenId) ?? validation.screenId,
          screenId: validation.screenId,
          entityKind: "Validation",
          label: validation.rule,
          reason: validation.ambiguity!.reason,
        }),
      ),
    ...input.intent.detectedNavigation
      .filter((navigation) => navigation.ambiguity !== undefined)
      .map((navigation) =>
        buildEntityAmbiguityQuestion({
          screenName: screenNameById.get(navigation.screenId) ?? navigation.screenId,
          screenId: navigation.screenId,
          entityKind: "Navigation",
          label: navigation.id,
          reason: navigation.ambiguity!.reason,
        }),
      ),
    ...input.intent.inferredBusinessObjects
      .filter((businessObject) => businessObject.ambiguity !== undefined)
      .map((businessObject) =>
        buildEntityAmbiguityQuestion({
          screenName:
            screenNameById.get(businessObject.screenId) ?? businessObject.screenId,
          screenId: businessObject.screenId,
          entityKind: "Business object",
          label: businessObject.name,
          reason: businessObject.ambiguity!.reason,
        }),
      ),
    ...screens.flatMap((screen) =>
      buildVisualCoverageQuestions({
        screen,
        visual: visualMap.get(screen.screenId),
      }),
    ),
    ...screens.flatMap((screen) =>
      screen.calculations
        .filter((calculation) => calculation.ambiguity !== undefined)
        .map(
          (calculation) =>
            `Calculation "${calculation.name}" on screen "${screen.name}" (${screen.screenId}) is ambiguous: ${calculation.ambiguity}. What should test coverage assume?`,
        ),
    ),
  ]).map((text) => ({
    openQuestionId: stableId("open-question", text),
    text,
  }));

  const riskSignals: TestDesignRiskSignal[] = [
    ...uniqueSorted(input.intent.risks).map((text) => ({
      riskSignalId: stableId("risk", { kind: "intent-risk", text }),
      text,
      sourceRefs: allSourceRefs,
    })),
    ...input.intent.piiIndicators
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((indicator) => ({
        riskSignalId: stableId("risk", { kind: "pii-indicator", id: indicator.id }),
        text: `PII indicator ${indicator.kind} detected in ${indicator.matchLocation}`,
        ...(indicator.screenId !== undefined ? { screenId: indicator.screenId } : {}),
        sourceRefs: uniqueSorted([
          ...collectTraceSourceRefs(indicator.traceRef),
          ...(indicator.screenId !== undefined
            ? buildScreenSourceRefs({
                screenId: indicator.screenId,
                intent: input.intent,
              })
            : allSourceRefs),
        ]),
      })),
    ...visual.flatMap((screen) =>
      screen.regions
        .filter((region) => containsPromptInjectionLikeText(region.visibleText))
        .map((region) => ({
          riskSignalId: stableId("risk", {
            kind: "visual-prompt-injection",
            screenId: screen.screenId,
            regionId: region.regionId,
          }),
          text: `Visual region "${region.label ?? region.regionId}" contains instruction-shaped text (possible prompt injection)`,
          screenId: screen.screenId,
          sourceRefs:
            buildScreenSourceRefs({
              screenId: screen.screenId,
              intent: input.intent,
            }).length > 0
              ? buildScreenSourceRefs({
                  screenId: screen.screenId,
                  intent: input.intent,
                })
              : allSourceRefs,
        })),
    ),
    ...visual.flatMap((screen) =>
      (screen.piiFlags ?? []).map((flag) => ({
        riskSignalId: stableId("risk", {
          kind: "visual-pii-flag",
          screenId: screen.screenId,
          regionId: flag.regionId,
          piiKind: flag.kind,
        }),
        text: `Visual sidecar flagged ${flag.kind} on region ${flag.regionId}`,
        screenId: screen.screenId,
        sourceRefs:
          buildScreenSourceRefs({
            screenId: screen.screenId,
            intent: input.intent,
          }).length > 0
            ? buildScreenSourceRefs({
                screenId: screen.screenId,
                intent: input.intent,
              })
            : allSourceRefs,
      })),
    ),
    ...(input.intent.multiSourceConflicts ?? [])
      .slice()
      .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
      .map((conflict) => ({
        riskSignalId: stableId("risk", conflict.conflictId),
        text:
          conflict.detail !== undefined && conflict.detail.length > 0
            ? `Multi-source ${conflict.kind}: ${conflict.detail}`
            : `Multi-source ${conflict.kind}: ${conflict.normalizedValues.join(" vs ")}`,
        ...(conflict.affectedScreenIds?.[0] !== undefined
          ? { screenId: [...conflict.affectedScreenIds].sort()[0] }
          : {}),
        sourceRefs: uniqueSorted(conflict.participatingSourceIds),
      })),
  ]
    .sort((left, right) => left.riskSignalId.localeCompare(right.riskSignalId))
    .filter(
      (riskSignal, index, list) =>
        index === 0 ||
        riskSignal.riskSignalId !== list[index - 1]?.riskSignalId,
    );

  return {
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    jobId: input.jobId,
    sourceHash: buildSourceHash({ intent: input.intent, visual, sourceEnvelope }),
    screens,
    businessRules,
    assumptions,
    openQuestions,
    riskSignals,
  };
};

export const computeTestDesignModelSchemaHash = (): string =>
  sha256Hex({
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    rootKeys: ROOT_KEYS,
    screenKeys: SCREEN_KEYS,
    elementKeys: ELEMENT_KEYS,
    actionKeys: ACTION_KEYS,
    validationKeys: VALIDATION_KEYS,
    calculationKeys: CALCULATION_KEYS,
    ruleKeys: RULE_KEYS,
    assumptionKeys: ASSUMPTION_KEYS,
    openQuestionKeys: OPEN_QUESTION_KEYS,
    riskSignalKeys: RISK_SIGNAL_KEYS,
  });

export const validateTestDesignModel = (
  candidate: unknown,
): TestDesignModelValidationResult => {
  const errors: TestDesignModelValidationIssue[] = [];
  if (!isRecord(candidate)) {
    return {
      valid: false,
      errors: [{ path: "$", message: "expected object" }],
    };
  }
  if (!hasOnlyKeys(candidate, ROOT_KEYS)) {
    errors.push({ path: "$", message: "unexpected root property" });
  }
  if (candidate["schemaVersion"] !== TEST_DESIGN_MODEL_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `expected ${TEST_DESIGN_MODEL_SCHEMA_VERSION}`,
    });
  }
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) {
    errors.push({ path: "$.jobId", message: "expected non-empty string" });
  }
  if (
    typeof candidate["sourceHash"] !== "string" ||
    !HEX64_RE.test(candidate["sourceHash"])
  ) {
    errors.push({ path: "$.sourceHash", message: "expected 64-char hex string" });
  }

  const validateStringArray = (path: string, value: unknown): void => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      errors.push({ path, message: "expected string[]" });
    }
  };

  const screens = candidate["screens"];
  if (!Array.isArray(screens)) {
    errors.push({ path: "$.screens", message: "expected array" });
  } else {
    screens.forEach((screen, index) => {
      const path = `$.screens[${index}]`;
      if (!isRecord(screen)) {
        errors.push({ path, message: "expected object" });
        return;
      }
      if (!hasOnlyKeys(screen, SCREEN_KEYS)) {
        errors.push({ path, message: "unexpected screen property" });
      }
      if (typeof screen["screenId"] !== "string" || screen["screenId"].length === 0) {
        errors.push({ path: `${path}.screenId`, message: "expected non-empty string" });
      }
      if (typeof screen["name"] !== "string" || screen["name"].length === 0) {
        errors.push({ path: `${path}.name`, message: "expected non-empty string" });
      }
      if (
        screen["purpose"] !== undefined &&
        typeof screen["purpose"] !== "string"
      ) {
        errors.push({ path: `${path}.purpose`, message: "expected string" });
      }
      validateStringArray(`${path}.visualRefs`, screen["visualRefs"]);
      validateStringArray(`${path}.sourceRefs`, screen["sourceRefs"]);

      const validateEntries = (
        entryPath: string,
        entries: unknown,
        keys: readonly string[],
        required: readonly string[],
        optionalStringKeys: readonly string[],
      ): void => {
        if (!Array.isArray(entries)) {
          errors.push({ path: entryPath, message: "expected array" });
          return;
        }
        entries.forEach((entry, entryIndex) => {
          const nestedPath = `${entryPath}[${entryIndex}]`;
          if (!isRecord(entry)) {
            errors.push({ path: nestedPath, message: "expected object" });
            return;
          }
          if (!hasOnlyKeys(entry, keys)) {
            errors.push({ path: nestedPath, message: "unexpected property" });
          }
          required.forEach((requiredKey) => {
            if (
              typeof entry[requiredKey] !== "string" ||
              (entry[requiredKey] as string).length === 0
            ) {
              errors.push({
                path: `${nestedPath}.${requiredKey}`,
                message: "expected non-empty string",
              });
            }
          });
          optionalStringKeys.forEach((optionalKey) => {
            if (
              entry[optionalKey] !== undefined &&
              typeof entry[optionalKey] !== "string"
            ) {
              errors.push({
                path: `${nestedPath}.${optionalKey}`,
                message: "expected string",
              });
            }
          });
        });
      };

      validateEntries(`${path}.elements`, screen["elements"], ELEMENT_KEYS, [
        "elementId",
        "label",
        "kind",
      ], ["defaultValue", "ambiguity"]);
      validateEntries(`${path}.actions`, screen["actions"], ACTION_KEYS, [
        "actionId",
        "label",
        "kind",
      ], ["targetScreenId", "ambiguity"]);
      validateEntries(
        `${path}.validations`,
        screen["validations"],
        VALIDATION_KEYS,
        ["validationId", "rule"],
        ["targetElementId", "ambiguity"],
      );

      const calculations = screen["calculations"];
      if (!Array.isArray(calculations)) {
        errors.push({ path: `${path}.calculations`, message: "expected array" });
      } else {
        calculations.forEach((calculation, calculationIndex) => {
          const nestedPath = `${path}.calculations[${calculationIndex}]`;
          if (!isRecord(calculation)) {
            errors.push({ path: nestedPath, message: "expected object" });
            return;
          }
          if (!hasOnlyKeys(calculation, CALCULATION_KEYS)) {
            errors.push({ path: nestedPath, message: "unexpected property" });
          }
          if (
            typeof calculation["calculationId"] !== "string" ||
            calculation["calculationId"].length === 0
          ) {
            errors.push({
              path: `${nestedPath}.calculationId`,
              message: "expected non-empty string",
            });
          }
          if (
            typeof calculation["name"] !== "string" ||
            calculation["name"].length === 0
          ) {
            errors.push({
              path: `${nestedPath}.name`,
              message: "expected non-empty string",
            });
          }
          validateStringArray(
            `${nestedPath}.inputElementIds`,
            calculation["inputElementIds"],
          );
          if (
            calculation["ambiguity"] !== undefined &&
            typeof calculation["ambiguity"] !== "string"
          ) {
            errors.push({
              path: `${nestedPath}.ambiguity`,
              message: "expected string",
            });
          }
        });
      }
    });
  }

  const validateIdTextArray = (
    path: string,
    entries: unknown,
    keys: readonly string[],
    idKey: string,
  ): void => {
    if (!Array.isArray(entries)) {
      errors.push({ path, message: "expected array" });
      return;
    }
    entries.forEach((entry, index) => {
      const entryPath = `${path}[${index}]`;
      if (!isRecord(entry)) {
        errors.push({ path: entryPath, message: "expected object" });
        return;
      }
      if (!hasOnlyKeys(entry, keys)) {
        errors.push({ path: entryPath, message: "unexpected property" });
      }
      if (typeof entry[idKey] !== "string" || (entry[idKey] as string).length === 0) {
        errors.push({
          path: `${entryPath}.${idKey}`,
          message: "expected non-empty string",
        });
      }
      if (typeof entry["text"] !== "string" || entry["text"].length === 0) {
        errors.push({
          path: `${entryPath}.text`,
          message: "expected non-empty string",
        });
      }
    });
  };

  const businessRules = candidate["businessRules"];
  if (!Array.isArray(businessRules)) {
    errors.push({ path: "$.businessRules", message: "expected array" });
  } else {
    businessRules.forEach((rule, index) => {
      const path = `$.businessRules[${index}]`;
      if (!isRecord(rule)) {
        errors.push({ path, message: "expected object" });
        return;
      }
      if (!hasOnlyKeys(rule, RULE_KEYS)) {
        errors.push({ path, message: "unexpected property" });
      }
      if (typeof rule["ruleId"] !== "string" || rule["ruleId"].length === 0) {
        errors.push({ path: `${path}.ruleId`, message: "expected non-empty string" });
      }
      if (
        typeof rule["description"] !== "string" ||
        rule["description"].length === 0
      ) {
        errors.push({
          path: `${path}.description`,
          message: "expected non-empty string",
        });
      }
      if (rule["screenId"] !== undefined && typeof rule["screenId"] !== "string") {
        errors.push({ path: `${path}.screenId`, message: "expected string" });
      }
      validateStringArray(`${path}.sourceRefs`, rule["sourceRefs"]);
    });
  }

  validateIdTextArray(
    "$.assumptions",
    candidate["assumptions"],
    ASSUMPTION_KEYS,
    "assumptionId",
  );
  validateIdTextArray(
    "$.openQuestions",
    candidate["openQuestions"],
    OPEN_QUESTION_KEYS,
    "openQuestionId",
  );

  const riskSignals = candidate["riskSignals"];
  if (!Array.isArray(riskSignals)) {
    errors.push({ path: "$.riskSignals", message: "expected array" });
  } else {
    riskSignals.forEach((riskSignal, index) => {
      const path = `$.riskSignals[${index}]`;
      if (!isRecord(riskSignal)) {
        errors.push({ path, message: "expected object" });
        return;
      }
      if (!hasOnlyKeys(riskSignal, RISK_SIGNAL_KEYS)) {
        errors.push({ path, message: "unexpected property" });
      }
      if (
        typeof riskSignal["riskSignalId"] !== "string" ||
        riskSignal["riskSignalId"].length === 0
      ) {
        errors.push({
          path: `${path}.riskSignalId`,
          message: "expected non-empty string",
        });
      }
      if (
        typeof riskSignal["text"] !== "string" ||
        riskSignal["text"].length === 0
      ) {
        errors.push({ path: `${path}.text`, message: "expected non-empty string" });
      }
      if (
        riskSignal["screenId"] !== undefined &&
        typeof riskSignal["screenId"] !== "string"
      ) {
        errors.push({ path: `${path}.screenId`, message: "expected string" });
      }
      validateStringArray(`${path}.sourceRefs`, riskSignal["sourceRefs"]);
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const writeTestDesignModelArtifact = async (input: {
  model: TestDesignModel;
  runDir: string;
}): Promise<string> => {
  const artifactPath = join(input.runDir, TEST_DESIGN_MODEL_ARTIFACT_FILENAME);
  await mkdir(input.runDir, { recursive: true });
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, canonicalJson(input.model), "utf8");
  await rename(tmpPath, artifactPath);
  return artifactPath;
};
