import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TEST_DESIGN_MODEL_ARTIFACT_FILENAME,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type IntentTraceRef,
  type TestDesignAction,
  type TestDesignAssumption,
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

export interface BuildTestDesignModelInput {
  jobId: string;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
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

const collectTraceSourceRefs = (trace: IntentTraceRef | undefined): string[] =>
  uniqueSorted((trace?.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId));

const buildSourceHash = ({
  intent,
  visual,
}: {
  intent: BusinessTestIntentIr;
  visual: ReadonlyArray<VisualScreenDescription>;
}): string =>
  sha256Hex({
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    intent,
    visual,
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

export const buildTestDesignModel = (
  input: BuildTestDesignModelInput,
): TestDesignModel => {
  const visual = [...(input.visual ?? [])].sort((left, right) =>
    left.screenId.localeCompare(right.screenId),
  );
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

      const sourceRefs = uniqueSorted([
        ...collectTraceSourceRefs(screen.trace),
        ...input.intent.detectedFields
          .filter((field) => field.screenId === screen.screenId)
          .flatMap((field) => [
            ...collectTraceSourceRefs(field.trace),
            ...(field.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
          ]),
        ...input.intent.detectedActions
          .filter((action) => action.screenId === screen.screenId)
          .flatMap((action) => [
            ...collectTraceSourceRefs(action.trace),
            ...(action.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
          ]),
        ...input.intent.detectedValidations
          .filter((validation) => validation.screenId === screen.screenId)
          .flatMap((validation) => [
            ...collectTraceSourceRefs(validation.trace),
            ...(validation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
          ]),
        ...input.intent.detectedNavigation
          .filter((navigation) => navigation.screenId === screen.screenId)
          .flatMap((navigation) => [
            ...collectTraceSourceRefs(navigation.trace),
            ...(navigation.sourceRefs ?? []).map((sourceRef) => sourceRef.sourceId),
          ]),
        ...input.intent.inferredBusinessObjects
          .filter((businessObject) => businessObject.screenId === screen.screenId)
          .flatMap((businessObject) => [
            ...collectTraceSourceRefs(businessObject.trace),
            ...(businessObject.sourceRefs ?? []).map(
              (sourceRef) => sourceRef.sourceId,
            ),
          ]),
      ]);

      return {
        screenId: screen.screenId,
        name: screen.screenName,
        elements,
        actions,
        validations,
        calculations: [],
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

  const openQuestions: TestDesignOpenQuestion[] = uniqueSorted(
    input.intent.openQuestions,
  ).map((text) => ({
    openQuestionId: stableId("open-question", text),
    text,
  }));

  const riskSignals: TestDesignRiskSignal[] = [
    ...uniqueSorted(input.intent.risks).map((text) => ({
      riskSignalId: stableId("risk", { kind: "intent-risk", text }),
      text,
      sourceRefs: [],
    })),
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
  ].sort((left, right) => left.riskSignalId.localeCompare(right.riskSignalId));

  return {
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    jobId: input.jobId,
    sourceHash: buildSourceHash({ intent: input.intent, visual }),
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
