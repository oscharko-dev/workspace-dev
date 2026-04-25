/**
 * Visual-sidecar validation gate (Issue #1364 / #1386).
 *
 * The multimodal sidecar that produces `VisualScreenDescription[]` is an
 * UNTRUSTED observation source. This module structurally validates each
 * description, then layers semantic outcome detection:
 *
 * - schema_invalid — required fields missing or types wrong
 * - low_confidence — region or summary confidence below threshold
 * - fallback_used — fallback deployment was selected for the screen
 * - possible_pii — sidecar reported `piiFlags` or visible text matches
 *   the local PII detector
 * - prompt_injection_like_text — region's `visibleText` contains
 *   instruction-shaped patterns (e.g. "ignore all previous", "system:")
 * - conflicts_with_figma_metadata — visual claim disagrees with the
 *   deterministic Figma metadata for that screen, and the region carries
 *   no `ambiguity` note acknowledging the conflict
 *
 * The output report is byte-stable: rows are sorted by screenId; outcomes
 * within a row are sorted; issues are emitted in encounter order.
 */

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type TestCaseValidationIssue,
  type VisualSidecarValidationOutcome,
  type VisualSidecarValidationRecord,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { detectPii } from "./pii-detection.js";

const LOW_CONFIDENCE_REGION = 0.5;
const LOW_CONFIDENCE_SUMMARY_MEAN = 0.55;
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all )?(previous|prior) (instructions|directives)\b/i,
  /\bdisregard (the )?(system|instructions)\b/i,
  /\bsystem\s*:\s*/i,
  /\b<\s*\/?\s*(system|user|assistant)\s*>/i,
  /\bsudo\s+/i,
  /\bjailbreak\b/i,
  /\boverride (this|the) (rule|policy)\b/i,
];
const VISUAL_DESCRIPTION_KEYS = [
  "screenId",
  "sidecarDeployment",
  "regions",
  "confidenceSummary",
  "screenName",
  "capturedAt",
  "piiFlags",
] as const;
const REGION_KEYS = [
  "regionId",
  "confidence",
  "label",
  "controlType",
  "visibleText",
  "stateHints",
  "validationHints",
  "ambiguity",
] as const;
const CONFIDENCE_SUMMARY_KEYS = ["min", "max", "mean"] as const;
const AMBIGUITY_KEYS = ["reason"] as const;
const PII_FLAG_KEYS = ["regionId", "kind", "confidence"] as const;
const PII_KINDS = [
  "iban",
  "bic",
  "pan",
  "tax_id",
  "email",
  "phone",
  "full_name",
] as const;

/**
 * Input for `validateVisualSidecar`. The `visual` array is typed as
 * `unknown[]` because the validator's job is to gate an UNTRUSTED
 * observation source — callers should not have to pre-narrow before
 * structural validation runs. Typed callers that already hold
 * `VisualScreenDescription[]` may pass the array directly: it is
 * structurally compatible with `unknown[]`.
 */
export interface ValidateVisualSidecarInput {
  jobId: string;
  generatedAt: string;
  visual: ReadonlyArray<unknown>;
  intent: BusinessTestIntentIr;
  primaryDeployment?: "llama-4-maverick-vision" | "phi-4-multimodal-poc";
}

export const validateVisualSidecar = (
  input: ValidateVisualSidecarInput,
): VisualSidecarValidationReport => {
  const intentScreenIds = new Set(input.intent.screens.map((s) => s.screenId));
  const intentByScreen = new Map<
    string,
    {
      fieldLabels: Map<string, string>;
      actionLabels: Map<string, string>;
    }
  >();
  for (const f of input.intent.detectedFields) {
    const slot = intentByScreen.get(f.screenId) ?? {
      fieldLabels: new Map<string, string>(),
      actionLabels: new Map<string, string>(),
    };
    slot.fieldLabels.set(idTail(f.id), f.label);
    intentByScreen.set(f.screenId, slot);
  }
  for (const a of input.intent.detectedActions) {
    const slot = intentByScreen.get(a.screenId) ?? {
      fieldLabels: new Map<string, string>(),
      actionLabels: new Map<string, string>(),
    };
    slot.actionLabels.set(idTail(a.id), a.label);
    intentByScreen.set(a.screenId, slot);
  }

  const records: VisualSidecarValidationRecord[] = [];
  for (const description of input.visual) {
    const single: SingleInput = {
      description,
      intentScreenIds,
      intentByScreen,
    };
    if (input.primaryDeployment !== undefined) {
      single.primaryDeployment = input.primaryDeployment;
    }
    records.push(validateSingle(single));
  }
  records.sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );

  const screensWithFindings = records.filter((r) =>
    r.outcomes.some((o) => o !== "ok"),
  ).length;
  const blocked = records.some((r) =>
    r.outcomes.some(
      (o) =>
        o === "schema_invalid" ||
        o === "possible_pii" ||
        o === "prompt_injection_like_text" ||
        o === "conflicts_with_figma_metadata",
    ),
  );

  return {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    totalScreens: records.length,
    screensWithFindings,
    blocked,
    records,
  };
};

const idTail = (id: string): string => {
  const idx = id.lastIndexOf("::");
  if (idx === -1) return id;
  return id.slice(idx + 2);
};

interface SingleInput {
  description: unknown;
  intentScreenIds: Set<string>;
  intentByScreen: Map<
    string,
    { fieldLabels: Map<string, string>; actionLabels: Map<string, string> }
  >;
  primaryDeployment?: "llama-4-maverick-vision" | "phi-4-multimodal-poc";
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const expectExactKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: TestCaseValidationIssue[],
  outcomesSet: Set<VisualSidecarValidationOutcome>,
): void => {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        path,
        code: "schema_invalid",
        severity: "error",
        message: `unexpected property "${key}"`,
      });
      outcomesSet.add("schema_invalid");
      return;
    }
  }
};

const expectStringArray = (
  value: unknown,
  path: string,
  issues: TestCaseValidationIssue[],
  outcomesSet: Set<VisualSidecarValidationOutcome>,
): void => {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "schema_invalid",
      severity: "error",
      message: "expected an array of strings",
    });
    outcomesSet.add("schema_invalid");
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      issues.push({
        path: `${path}[${i}]`,
        code: "schema_invalid",
        severity: "error",
        message: "expected a string",
      });
      outcomesSet.add("schema_invalid");
    }
  }
};

const expectAmbiguity = (
  value: unknown,
  path: string,
  issues: TestCaseValidationIssue[],
  outcomesSet: Set<VisualSidecarValidationOutcome>,
): void => {
  if (!isObject(value)) {
    issues.push({
      path,
      code: "schema_invalid",
      severity: "error",
      message: "ambiguity must be an object",
    });
    outcomesSet.add("schema_invalid");
    return;
  }
  expectExactKeys(value, AMBIGUITY_KEYS, path, issues, outcomesSet);
  if (!isNonEmptyString(value["reason"])) {
    issues.push({
      path: `${path}.reason`,
      code: "schema_invalid",
      severity: "error",
      message: "ambiguity.reason must be a non-empty string",
    });
    outcomesSet.add("schema_invalid");
  }
};

const isPiiKind = (value: unknown): value is (typeof PII_KINDS)[number] => {
  return (
    typeof value === "string" &&
    (PII_KINDS as readonly string[]).includes(value)
  );
};

const asDeployment = (
  value: unknown,
): "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock" | undefined => {
  if (
    value === "llama-4-maverick-vision" ||
    value === "phi-4-multimodal-poc" ||
    value === "mock"
  ) {
    return value;
  }
  return undefined;
};

const validateSingle = (input: SingleInput): VisualSidecarValidationRecord => {
  const issues: TestCaseValidationIssue[] = [];
  const outcomesSet = new Set<VisualSidecarValidationOutcome>();

  if (!isObject(input.description)) {
    issues.push({
      path: "$.visual[?]",
      code: "schema_invalid",
      severity: "error",
      message: "expected visual sidecar description to be an object",
    });
    return {
      screenId: "",
      deployment: "mock",
      outcomes: ["schema_invalid"],
      issues,
      meanConfidence: 0,
    };
  }
  const description = input.description;
  const screenIdRaw = description["screenId"];
  const screenId = isNonEmptyString(screenIdRaw) ? screenIdRaw : "";
  const basePath = `$.visual[${screenId}]`;
  expectExactKeys(
    description,
    VISUAL_DESCRIPTION_KEYS,
    basePath,
    issues,
    outcomesSet,
  );

  if (!isNonEmptyString(screenIdRaw)) {
    issues.push({
      path: `${basePath}.screenId`,
      code: "schema_invalid",
      severity: "error",
      message: "screenId must be a non-empty string",
    });
    outcomesSet.add("schema_invalid");
  }

  const sidecarDeployment = asDeployment(description["sidecarDeployment"]);
  if (sidecarDeployment === undefined) {
    issues.push({
      path: `${basePath}.sidecarDeployment`,
      code: "schema_invalid",
      severity: "error",
      message: `unrecognised deployment "${String(description["sidecarDeployment"])}"`,
    });
    outcomesSet.add("schema_invalid");
  }

  if (
    description["screenName"] !== undefined &&
    typeof description["screenName"] !== "string"
  ) {
    issues.push({
      path: `${basePath}.screenName`,
      code: "schema_invalid",
      severity: "error",
      message: "screenName must be a string when present",
    });
    outcomesSet.add("schema_invalid");
  }
  if (
    description["capturedAt"] !== undefined &&
    typeof description["capturedAt"] !== "string"
  ) {
    issues.push({
      path: `${basePath}.capturedAt`,
      code: "schema_invalid",
      severity: "error",
      message: "capturedAt must be a string when present",
    });
    outcomesSet.add("schema_invalid");
  }

  const regionsValue = description["regions"];
  if (!Array.isArray(regionsValue)) {
    issues.push({
      path: `${basePath}.regions`,
      code: "schema_invalid",
      severity: "error",
      message: "regions must be an array",
    });
    outcomesSet.add("schema_invalid");
  }

  const summaryRaw = description["confidenceSummary"];
  let summary: { min: number; max: number; mean: number } | undefined;
  if (
    isObject(summaryRaw) &&
    typeof summaryRaw["min"] === "number" &&
    typeof summaryRaw["max"] === "number" &&
    typeof summaryRaw["mean"] === "number"
  ) {
    expectExactKeys(
      summaryRaw,
      CONFIDENCE_SUMMARY_KEYS,
      `${basePath}.confidenceSummary`,
      issues,
      outcomesSet,
    );
    summary = {
      min: summaryRaw["min"],
      max: summaryRaw["max"],
      mean: summaryRaw["mean"],
    };
  } else {
    issues.push({
      path: `${basePath}.confidenceSummary`,
      code: "schema_invalid",
      severity: "error",
      message: "confidenceSummary must declare {min, max, mean} as numbers",
    });
    outcomesSet.add("schema_invalid");
  }
  if (
    summary !== undefined &&
    (summary.min < 0 ||
      summary.max > 1 ||
      summary.min > summary.max ||
      summary.mean < summary.min ||
      summary.mean > summary.max)
  ) {
    issues.push({
      path: `${basePath}.confidenceSummary`,
      code: "schema_invalid",
      severity: "error",
      message: "confidenceSummary values must satisfy 0<=min<=mean<=max<=1",
    });
    outcomesSet.add("schema_invalid");
  }

  // Region structural and semantic checks.
  if (Array.isArray(regionsValue)) {
    const regionsArray = regionsValue as ReadonlyArray<unknown>;
    for (let i = 0; i < regionsArray.length; i++) {
      const region = regionsArray[i];
      if (!isObject(region)) {
        issues.push({
          path: `${basePath}.regions[${i}]`,
          code: "schema_invalid",
          severity: "error",
          message: "region must be an object",
        });
        outcomesSet.add("schema_invalid");
        continue;
      }
      const regionPath = `${basePath}.regions[${i}]`;
      expectExactKeys(region, REGION_KEYS, regionPath, issues, outcomesSet);
      const regionIdRaw = region["regionId"];
      if (!isNonEmptyString(regionIdRaw)) {
        issues.push({
          path: `${regionPath}.regionId`,
          code: "schema_invalid",
          severity: "error",
          message: "region.regionId must be a non-empty string",
        });
        outcomesSet.add("schema_invalid");
      }
      const confidence = region["confidence"];
      if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
        issues.push({
          path: `${regionPath}.confidence`,
          code: "schema_invalid",
          severity: "error",
          message: "region.confidence must be a number in [0, 1]",
        });
        outcomesSet.add("schema_invalid");
      } else if (confidence < LOW_CONFIDENCE_REGION) {
        outcomesSet.add("low_confidence");
      }
      if (
        region["label"] !== undefined &&
        typeof region["label"] !== "string"
      ) {
        issues.push({
          path: `${regionPath}.label`,
          code: "schema_invalid",
          severity: "error",
          message: "region.label must be a string when present",
        });
        outcomesSet.add("schema_invalid");
      }
      if (
        region["controlType"] !== undefined &&
        typeof region["controlType"] !== "string"
      ) {
        issues.push({
          path: `${regionPath}.controlType`,
          code: "schema_invalid",
          severity: "error",
          message: "region.controlType must be a string when present",
        });
        outcomesSet.add("schema_invalid");
      }
      if (
        region["visibleText"] !== undefined &&
        typeof region["visibleText"] !== "string"
      ) {
        issues.push({
          path: `${regionPath}.visibleText`,
          code: "schema_invalid",
          severity: "error",
          message: "region.visibleText must be a string when present",
        });
        outcomesSet.add("schema_invalid");
      }
      if (region["stateHints"] !== undefined) {
        expectStringArray(
          region["stateHints"],
          `${regionPath}.stateHints`,
          issues,
          outcomesSet,
        );
      }
      if (region["validationHints"] !== undefined) {
        expectStringArray(
          region["validationHints"],
          `${regionPath}.validationHints`,
          issues,
          outcomesSet,
        );
      }
      if (region["ambiguity"] !== undefined) {
        expectAmbiguity(
          region["ambiguity"],
          `${regionPath}.ambiguity`,
          issues,
          outcomesSet,
        );
      }
      const visibleText = region["visibleText"];
      if (typeof visibleText === "string") {
        if (containsInjectionLikeText(visibleText)) {
          issues.push({
            path: `${regionPath}.visibleText`,
            code: "schema_invalid",
            severity: "error",
            message:
              "visibleText contains instruction-shaped patterns (possible prompt injection)",
          });
          outcomesSet.add("prompt_injection_like_text");
        }
        if (detectPii(visibleText) !== null) {
          outcomesSet.add("possible_pii");
        }
      }
    }
  }

  // PII flags carried by the sidecar are always treated as possible PII.
  const piiFlags = description["piiFlags"];
  if (piiFlags !== undefined) {
    if (!Array.isArray(piiFlags)) {
      issues.push({
        path: `${basePath}.piiFlags`,
        code: "schema_invalid",
        severity: "error",
        message: "piiFlags must be an array when present",
      });
      outcomesSet.add("schema_invalid");
    } else {
      const flags = piiFlags as readonly unknown[];
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        if (!isObject(flag)) {
          issues.push({
            path: `${basePath}.piiFlags[${i}]`,
            code: "schema_invalid",
            severity: "error",
            message: "piiFlags entries must be objects",
          });
          outcomesSet.add("schema_invalid");
          continue;
        }
        const flagPath = `${basePath}.piiFlags[${i}]`;
        expectExactKeys(flag, PII_FLAG_KEYS, flagPath, issues, outcomesSet);
        if (!isNonEmptyString(flag["regionId"])) {
          issues.push({
            path: `${flagPath}.regionId`,
            code: "schema_invalid",
            severity: "error",
            message: "piiFlags.regionId must be a non-empty string",
          });
          outcomesSet.add("schema_invalid");
        }
        if (!isPiiKind(flag["kind"])) {
          issues.push({
            path: `${flagPath}.kind`,
            code: "schema_invalid",
            severity: "error",
            message: `piiFlags.kind must be one of ${PII_KINDS.join(", ")}`,
          });
          outcomesSet.add("schema_invalid");
        }
        if (
          typeof flag["confidence"] !== "number" ||
          flag["confidence"] < 0 ||
          flag["confidence"] > 1
        ) {
          issues.push({
            path: `${flagPath}.confidence`,
            code: "schema_invalid",
            severity: "error",
            message: "piiFlags.confidence must be a number in [0, 1]",
          });
          outcomesSet.add("schema_invalid");
        }
      }
      if (flags.length > 0) {
        outcomesSet.add("possible_pii");
      }
    }
  }

  if (summary !== undefined && summary.mean < LOW_CONFIDENCE_SUMMARY_MEAN) {
    outcomesSet.add("low_confidence");
  }

  // Fallback / primary detection.
  if (input.primaryDeployment !== undefined) {
    if (sidecarDeployment === "mock") {
      outcomesSet.add("fallback_used");
    } else if (
      sidecarDeployment !== undefined &&
      sidecarDeployment !== input.primaryDeployment &&
      sidecarDeployment === "phi-4-multimodal-poc"
    ) {
      outcomesSet.add("fallback_used");
    }
  } else if (sidecarDeployment === "mock") {
    outcomesSet.add("fallback_used");
  }

  // Conflict with deterministic Figma metadata.
  if (
    isNonEmptyString(screenIdRaw) &&
    !input.intentScreenIds.has(screenIdRaw)
  ) {
    issues.push({
      path: `${basePath}.screenId`,
      code: "trace_screen_unknown",
      severity: "error",
      message: `visual sidecar describes screenId "${screenIdRaw}" which is absent from the Business Test Intent IR`,
    });
    outcomesSet.add("conflicts_with_figma_metadata");
  } else if (Array.isArray(regionsValue)) {
    const intent = input.intentByScreen.get(screenId) ?? {
      fieldLabels: new Map<string, string>(),
      actionLabels: new Map<string, string>(),
    };
    const regionsArray = regionsValue as ReadonlyArray<unknown>;
    for (let i = 0; i < regionsArray.length; i++) {
      const region = regionsArray[i];
      if (!isObject(region)) continue;
      if (region["ambiguity"] !== undefined) continue;
      const regionPath = `${basePath}.regions[${i}]`;
      const regionId = region["regionId"];
      if (!isNonEmptyString(regionId)) continue;
      const figmaField = intent.fieldLabels.get(regionId);
      const figmaAction = intent.actionLabels.get(regionId);
      if (figmaField === undefined && figmaAction === undefined) continue;
      const claimedLabel = region["label"];
      const expectedLabel = figmaField ?? figmaAction;
      if (
        typeof claimedLabel === "string" &&
        typeof expectedLabel === "string" &&
        claimedLabel.length > 0 &&
        normalize(claimedLabel) !== normalize(expectedLabel) &&
        !normalize(expectedLabel).includes(normalize(claimedLabel)) &&
        !normalize(claimedLabel).includes(normalize(expectedLabel))
      ) {
        issues.push({
          path: `${regionPath}.label`,
          code: "schema_invalid",
          severity: "error",
          message: `visual label "${claimedLabel}" disagrees with Figma label "${expectedLabel}" without an ambiguity note`,
        });
        outcomesSet.add("conflicts_with_figma_metadata");
      }
    }
  }

  if (outcomesSet.size === 0) outcomesSet.add("ok");

  const outcomes = Array.from(outcomesSet).sort();
  const meanConfidence = summary !== undefined ? summary.mean : 0;

  return {
    screenId,
    deployment: sidecarDeployment ?? "mock",
    outcomes,
    issues,
    meanConfidence,
  };
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

const containsInjectionLikeText = (text: string): boolean => {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
