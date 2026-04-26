import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME,
  MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type BusinessTestIntentScreen,
  type CustomContextPolicySignal,
  type CustomContextSource,
  type DetectedField,
  type DetectedValidation,
  type InferredBusinessObject,
  type JiraAcceptanceCriterion,
  type JiraIssueIr,
  type MultiSourceConflict,
  type MultiSourceConflictKind,
  type MultiSourceReconciliationReport,
  type MultiSourceReconciliationTranscriptEntry,
  type MultiSourceTestIntentEnvelope,
  type TestCaseRiskCategory,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { legacySourceFromMultiSourceEnvelope } from "./multi-source-envelope.js";
import { deriveCustomContextPolicySignals } from "./custom-context-policy.js";

export interface ReconcileMultiSourceIntentInput {
  envelope: MultiSourceTestIntentEnvelope;
  figmaIntent?: BusinessTestIntentIr;
  jiraIssues?: readonly JiraIssueIr[];
  customContextSources?: readonly CustomContextSource[];
}

export interface ReconcileMultiSourceIntentResult {
  mergedIntent: BusinessTestIntentIr;
  report: MultiSourceReconciliationReport;
}

export interface WriteMultiSourceReconciliationReportInput {
  report: MultiSourceReconciliationReport;
  destinationDir: string;
}

export interface WriteMultiSourceReconciliationReportResult {
  artifactPath: string;
}

interface CandidateField {
  sourceId: string;
  screenId: string;
  caseId: string;
  label: string;
  normalizedLabel: string;
  semanticKey: string;
  defaultValue?: string;
  sourceKind: TestIntentSourceRef["kind"];
}

interface CandidateValidation {
  sourceId: string;
  screenId: string;
  caseId: string;
  semanticKey: string;
  rule: string;
  normalizedRule: string;
  targetFieldLabel?: string;
  sourceKind: TestIntentSourceRef["kind"];
}

interface CandidateRisk {
  sourceId: string;
  category: TestCaseRiskCategory;
  rationale: string;
}

const sortedUnique = <T extends string>(values: readonly T[]): T[] =>
  Array.from(new Set(values)).sort();

const figmaKinds = new Set(["figma_local_json", "figma_plugin", "figma_rest"]);
const jiraKinds = new Set(["jira_rest", "jira_paste"]);

const cloneScreen = (
  screen: BusinessTestIntentScreen,
): BusinessTestIntentScreen => ({
  screenId: screen.screenId,
  screenName: screen.screenName,
  ...(screen.screenPath !== undefined ? { screenPath: screen.screenPath } : {}),
  trace: {
    ...(screen.trace.nodeId !== undefined ? { nodeId: screen.trace.nodeId } : {}),
    ...(screen.trace.nodeName !== undefined
      ? { nodeName: screen.trace.nodeName }
      : {}),
    ...(screen.trace.nodePath !== undefined
      ? { nodePath: screen.trace.nodePath }
      : {}),
    ...(screen.trace.sourceRefs !== undefined
      ? { sourceRefs: screen.trace.sourceRefs.map((ref) => ({ ...ref })) }
      : {}),
  },
});

const cloneField = (field: DetectedField): DetectedField => ({
  ...field,
  trace: {
    ...field.trace,
    ...(field.trace.sourceRefs !== undefined
      ? { sourceRefs: field.trace.sourceRefs.map((ref) => ({ ...ref })) }
      : {}),
  },
  ...(field.ambiguity !== undefined ? { ambiguity: { ...field.ambiguity } } : {}),
  ...(field.sourceRefs !== undefined
    ? { sourceRefs: field.sourceRefs.map((ref) => ({ ...ref })) }
    : {}),
});

const cloneValidation = (value: DetectedValidation): DetectedValidation => ({
  ...value,
  trace: {
    ...value.trace,
    ...(value.trace.sourceRefs !== undefined
      ? { sourceRefs: value.trace.sourceRefs.map((ref) => ({ ...ref })) }
      : {}),
  },
  ...(value.ambiguity !== undefined ? { ambiguity: { ...value.ambiguity } } : {}),
  ...(value.sourceRefs !== undefined
    ? { sourceRefs: value.sourceRefs.map((ref) => ({ ...ref })) }
    : {}),
});

const cloneBusinessObject = (
  value: InferredBusinessObject,
): InferredBusinessObject => ({
  ...value,
  fieldIds: value.fieldIds.slice(),
  trace: {
    ...value.trace,
    ...(value.trace.sourceRefs !== undefined
      ? { sourceRefs: value.trace.sourceRefs.map((ref) => ({ ...ref })) }
      : {}),
  },
  ...(value.ambiguity !== undefined ? { ambiguity: { ...value.ambiguity } } : {}),
  ...(value.sourceRefs !== undefined
    ? { sourceRefs: value.sourceRefs.map((ref) => ({ ...ref })) }
    : {}),
});

const normalizeText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const stableSlug = (value: string): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";

const semanticKeyForLabel = (label: string): string => {
  const normalized = normalizeText(label)
    .replace(/\b(input|field|textbox|control|the)\b/g, "")
    .trim();
  if (/iban/.test(normalized)) return "iban";
  if (/e-?mail/.test(normalized)) return "email";
  if (/\bpan\b|card number/.test(normalized)) return "pan";
  if (/phone|mobile|telephone/.test(normalized)) return "phone";
  if (/tax/.test(normalized)) return "tax";
  if (/name/.test(normalized)) return "name";
  if (/address/.test(normalized)) return "address";
  if (/password/.test(normalized)) return "password";
  if (/amount|sum/.test(normalized)) return "amount";
  return normalized.replace(/[^a-z0-9]+/g, "_");
};

const inferRiskFromText = (value: string): TestCaseRiskCategory | undefined => {
  const normalized = normalizeText(value);
  if (/(payment|iban|transaction|card|pan|checkout)/.test(normalized)) {
    return "financial_transaction";
  }
  if (/(regulated|gdpr|pci|pii|personal data|kyc|aml|customer data)/.test(normalized)) {
    return "regulated_data";
  }
  if (/(high risk|privileged|authorization|admin)/.test(normalized)) {
    return "high";
  }
  return undefined;
};

const collectCustomContextPolicySignals = (
  envelope: MultiSourceTestIntentEnvelope,
  sources: readonly CustomContextSource[],
): CustomContextPolicySignal[] => {
  const out: CustomContextPolicySignal[] = [];
  for (const ref of envelope.sources) {
    if (ref.kind !== "custom_structured") continue;
    const source = sources.find(
      (candidate) =>
        candidate.sourceKind === "custom_structured" &&
        candidate.aggregateContentHash === ref.contentHash,
    );
    if (source === undefined) continue;
    out.push(
      ...deriveCustomContextPolicySignals({
        sourceId: ref.sourceId,
        structuredEntries: source.structuredEntries,
      }),
    );
  }
  return out.sort((a, b) =>
    a.sourceId === b.sourceId
      ? a.attributeKey.localeCompare(b.attributeKey)
      : a.sourceId.localeCompare(b.sourceId),
  );
};

const buildJiraOnlyScreen = (issue: JiraIssueIr): BusinessTestIntentScreen => ({
  screenId: `jira:${issue.issueKey}`,
  screenName: issue.issueKey,
  trace: {
    nodeId: issue.issueKey,
    nodeName: issue.summary,
  },
});

const extractAcceptanceText = (criterion: JiraAcceptanceCriterion): string => {
  return criterion.text;
};

const extractJiraFieldCandidates = (
  issue: JiraIssueIr,
  sourceId: string,
  figmaIntent: BusinessTestIntentIr | undefined,
): CandidateField[] => {
  const out: CandidateField[] = [];
  const figmaLabels = figmaIntent?.detectedFields.map((field) => field.label) ?? [];
  const texts = [
    issue.summary,
    issue.descriptionPlain,
    ...issue.acceptanceCriteria.map(extractAcceptanceText),
  ];
  const patterns = [
    /(?:field|input|label)\s+["']([A-Za-z][A-Za-z0-9 _/-]{1,40})["']/giu,
    /["']([A-Za-z][A-Za-z0-9 _/-]{1,40})["']\s+field/giu,
  ];
  const screenId = `jira:${issue.issueKey}`;
  for (const text of texts) {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const label = match[1]?.trim();
        if (!label) continue;
        const semanticKey = semanticKeyForLabel(label);
        out.push({
          sourceId,
          screenId,
          caseId: `case:${screenId}:field:${semanticKey}`,
          label,
          normalizedLabel: normalizeText(label),
          semanticKey,
          sourceKind: "jira_paste",
        });
      }
    }
    for (const figmaLabel of figmaLabels) {
      const escaped = figmaLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "iu").test(text)) {
        const semanticKey = semanticKeyForLabel(figmaLabel);
        out.push({
          sourceId,
          screenId,
          caseId: `case:${screenId}:field:${semanticKey}`,
          label: figmaLabel,
          normalizedLabel: normalizeText(figmaLabel),
          semanticKey,
          sourceKind: "jira_paste",
        });
      }
    }
  }
  return dedupeCandidateFields(out);
};

const dedupeCandidateFields = (
  fields: readonly CandidateField[],
): CandidateField[] => {
  const map = new Map<string, CandidateField>();
  for (const field of fields) {
    const key = JSON.stringify([
      field.sourceId,
      field.screenId,
      field.semanticKey,
      field.normalizedLabel,
    ]);
    if (!map.has(key)) map.set(key, field);
  }
  return [...map.values()].sort((a, b) =>
    a.caseId === b.caseId
      ? a.label.localeCompare(b.label)
      : a.caseId.localeCompare(b.caseId),
  );
};

const normalizeValidationRule = (value: string): string =>
  normalizeText(value).replace(/[^a-z0-9 ]+/g, " ").trim();

const extractValidationRulesFromText = (text: string): string[] => {
  const rules = new Set<string>();
  const lines = text
    .split(/[\n.]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (/\brequired\b/i.test(line)) rules.add("required");
    const must = line.match(/\bmust\b(.+)$/i);
    if (must?.[0]) rules.add(must[0].trim());
    const should = line.match(/\bshould\b(.+)$/i);
    if (should?.[0]) rules.add(should[0].trim());
    const regex = line.match(/\bregex\b[: ]+(.+)$/i);
    if (regex?.[1]) rules.add(`regex ${regex[1].trim()}`);
    const example = line.match(/\bexample\b[: ]+(.+)$/i);
    if (example?.[1]) rules.add(`example ${example[1].trim()}`);
  }
  return [...rules].sort();
};

const extractJiraValidationCandidates = (
  issue: JiraIssueIr,
  sourceId: string,
  fieldCandidates: readonly CandidateField[],
): CandidateValidation[] => {
  const bySemantic = new Map<string, CandidateField[]>();
  for (const field of fieldCandidates) {
    const existing = bySemantic.get(field.semanticKey);
    if (existing === undefined) bySemantic.set(field.semanticKey, [field]);
    else existing.push(field);
  }
  const out: CandidateValidation[] = [];
  const criteriaTexts = issue.acceptanceCriteria.map(extractAcceptanceText);
  const screenId = `jira:${issue.issueKey}`;
  for (const text of criteriaTexts) {
    const rules = extractValidationRulesFromText(text);
    for (const [semanticKey, fields] of bySemantic.entries()) {
      const field = fields[0];
      if (field === undefined) continue;
      if (!new RegExp(`\\b${field.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(text)) {
        continue;
      }
      for (const rule of rules) {
        out.push({
          sourceId,
          screenId,
          caseId: `case:${screenId}:validation:${semanticKey}`,
          semanticKey,
          rule,
          normalizedRule: normalizeValidationRule(rule),
          targetFieldLabel: field.label,
          sourceKind: "jira_paste",
        });
      }
    }
  }
  return dedupeCandidateValidations(out);
};

const dedupeCandidateValidations = (
  validations: readonly CandidateValidation[],
): CandidateValidation[] => {
  const map = new Map<string, CandidateValidation>();
  for (const value of validations) {
    const key = JSON.stringify([
      value.sourceId,
      value.screenId,
      value.semanticKey,
      value.normalizedRule,
    ]);
    if (!map.has(key)) map.set(key, value);
  }
  return [...map.values()].sort((a, b) =>
    a.caseId === b.caseId
      ? a.normalizedRule.localeCompare(b.normalizedRule)
      : a.caseId.localeCompare(b.caseId),
  );
};

const extractCandidateRisks = (
  input: ReconcileMultiSourceIntentInput,
): CandidateRisk[] => {
  const out: CandidateRisk[] = [];
  for (const ref of input.envelope.sources) {
    if (figmaKinds.has(ref.kind) && input.figmaIntent !== undefined) {
      const seen = new Set<string>();
      for (const risk of input.figmaIntent.risks) {
        const category = inferRiskFromText(risk);
        if (category === undefined) continue;
        const key = `${ref.sourceId}:${category}:${risk}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ sourceId: ref.sourceId, category, rationale: risk });
      }
      if (
        input.figmaIntent.piiIndicators.length > 0 &&
        !seen.has(`${ref.sourceId}:regulated_data:pii`)
      ) {
        out.push({
          sourceId: ref.sourceId,
          category: "regulated_data",
          rationale: "PII indicators present in Figma-derived intent",
        });
      }
    }
  }
  for (const signal of collectCustomContextPolicySignals(
    input.envelope,
    input.customContextSources ?? [],
  )) {
    out.push({
      sourceId: signal.sourceId,
      category: signal.riskCategory,
      rationale: signal.reason,
    });
  }
  return out.sort((a, b) =>
    a.sourceId === b.sourceId
      ? a.category.localeCompare(b.category)
      : a.sourceId.localeCompare(b.sourceId),
  );
};

const buildConflict = (input: {
  kind: MultiSourceConflictKind;
  participatingSourceIds: string[];
  normalizedValues: string[];
  resolution: MultiSourceConflict["resolution"];
  affectedElementIds?: string[];
  affectedScreenIds?: string[];
  detail?: string;
}): MultiSourceConflict => {
  const participatingSourceIds = sortedUnique(input.participatingSourceIds);
  const normalizedValues = sortedUnique(input.normalizedValues);
  const affectedElementIds =
    input.affectedElementIds !== undefined
      ? sortedUnique(input.affectedElementIds)
      : undefined;
  const affectedScreenIds =
    input.affectedScreenIds !== undefined
      ? sortedUnique(input.affectedScreenIds)
      : undefined;
  return {
    conflictId: sha256Hex({
      kind: input.kind,
      sourceRefs: participatingSourceIds,
      normalizedValues,
    }),
    kind: input.kind,
    participatingSourceIds,
    normalizedValues,
    resolution: input.resolution,
    ...(affectedElementIds !== undefined && affectedElementIds.length > 0
      ? { affectedElementIds }
      : {}),
    ...(affectedScreenIds !== undefined && affectedScreenIds.length > 0
      ? { affectedScreenIds }
      : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
};

const buildTranscriptEntry = (
  value: Omit<MultiSourceReconciliationTranscriptEntry, "decisionId">,
): MultiSourceReconciliationTranscriptEntry => ({
  decisionId: sha256Hex(value),
  sourceIds: sortedUnique(value.sourceIds),
  action: value.action,
  rationale: value.rationale,
  affectedElementIds: sortedUnique(value.affectedElementIds),
});

export const reconcileMultiSourceIntent = (
  input: ReconcileMultiSourceIntentInput,
): ReconcileMultiSourceIntentResult => {
  const legacySource =
    legacySourceFromMultiSourceEnvelope(input.envelope) ?? {
      kind: "hybrid" as const,
      contentHash: input.envelope.aggregateContentHash,
    };
  const figmaSourceRefs = input.envelope.sources.filter((ref) =>
    figmaKinds.has(ref.kind),
  );
  const figmaSourceIds = figmaSourceRefs.map((ref) => ref.sourceId);
  const jiraSourceRefs = input.envelope.sources.filter((ref) =>
    jiraKinds.has(ref.kind),
  );

  const baseIntent: BusinessTestIntentIr =
    input.figmaIntent !== undefined
      ? {
          ...input.figmaIntent,
          screens: input.figmaIntent.screens.map(cloneScreen),
          detectedFields: input.figmaIntent.detectedFields.map(cloneField),
          detectedActions: input.figmaIntent.detectedActions.map((value) => ({
            ...value,
            trace: {
              ...value.trace,
              ...(value.trace.sourceRefs !== undefined
                ? {
                    sourceRefs: value.trace.sourceRefs.map((ref) => ({ ...ref })),
                  }
                : {}),
            },
            ...(value.ambiguity !== undefined
              ? { ambiguity: { ...value.ambiguity } }
              : {}),
            ...(value.sourceRefs !== undefined
              ? { sourceRefs: value.sourceRefs.map((ref) => ({ ...ref })) }
              : {}),
          })),
          detectedValidations:
            input.figmaIntent.detectedValidations.map(cloneValidation),
          detectedNavigation: input.figmaIntent.detectedNavigation.map((value) => ({
            ...value,
            trace: {
              ...value.trace,
              ...(value.trace.sourceRefs !== undefined
                ? {
                    sourceRefs: value.trace.sourceRefs.map((ref) => ({ ...ref })),
                  }
                : {}),
            },
            ...(value.ambiguity !== undefined
              ? { ambiguity: { ...value.ambiguity } }
              : {}),
            ...(value.sourceRefs !== undefined
              ? { sourceRefs: value.sourceRefs.map((ref) => ({ ...ref })) }
              : {}),
          })),
          inferredBusinessObjects:
            input.figmaIntent.inferredBusinessObjects.map(cloneBusinessObject),
          risks: input.figmaIntent.risks.slice(),
          assumptions: input.figmaIntent.assumptions.slice(),
          openQuestions: input.figmaIntent.openQuestions.slice(),
          piiIndicators: input.figmaIntent.piiIndicators.slice(),
          redactions: input.figmaIntent.redactions.slice(),
          source: legacySource,
          sourceEnvelope: input.envelope,
        }
      : {
          version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
          source: legacySource,
          screens: (input.jiraIssues ?? []).map(buildJiraOnlyScreen).sort((a, b) =>
            a.screenId.localeCompare(b.screenId),
          ),
          detectedFields: [],
          detectedActions: [],
          detectedValidations: [],
          detectedNavigation: [],
          inferredBusinessObjects: [],
          risks: [],
          assumptions: [],
          openQuestions: [],
          piiIndicators: [],
          redactions: [],
          sourceEnvelope: input.envelope,
        };

  const usedSourceIds = new Set<string>();
  const conflicts: MultiSourceConflict[] = [];
  const transcript: MultiSourceReconciliationTranscriptEntry[] = [];
  const contributingSourcesPerCase = new Map<string, Set<string>>();

  const recordContribution = (caseId: string, sourceIds: readonly string[]): void => {
    const existing = contributingSourcesPerCase.get(caseId) ?? new Set<string>();
    for (const sourceId of sourceIds) existing.add(sourceId);
    contributingSourcesPerCase.set(caseId, existing);
  };

  for (const field of baseIntent.detectedFields) {
    const sourceRefs =
      field.sourceRefs ??
      (figmaSourceRefs.length > 0 ? figmaSourceRefs.map((ref) => ({ ...ref })) : []);
    if (sourceRefs.length > 0) {
      field.sourceRefs = sourceRefs;
      field.trace.sourceRefs = sourceRefs.map((ref) => ({ ...ref }));
      for (const ref of sourceRefs) usedSourceIds.add(ref.sourceId);
      recordContribution(`case:${field.screenId}:field:${stableSlug(field.id)}`, sourceRefs.map((ref) => ref.sourceId));
    }
  }
  for (const validation of baseIntent.detectedValidations) {
    const sourceRefs =
      validation.sourceRefs ??
      (figmaSourceRefs.length > 0
        ? figmaSourceRefs.map((ref) => ({ ...ref }))
        : []);
    if (sourceRefs.length > 0) {
      validation.sourceRefs = sourceRefs;
      validation.trace.sourceRefs = sourceRefs.map((ref) => ({ ...ref }));
      for (const ref of sourceRefs) usedSourceIds.add(ref.sourceId);
      recordContribution(
        `case:${validation.screenId}:validation:${stableSlug(validation.id)}`,
        sourceRefs.map((ref) => ref.sourceId),
      );
    }
  }

  const jiraIssues = input.jiraIssues ?? [];
  const jiraFieldCandidates = jiraIssues.flatMap((issue) => {
    const ref = jiraSourceRefs.find((candidate) => candidate.contentHash === issue.contentHash);
    return ref === undefined
      ? []
      : extractJiraFieldCandidates(issue, ref.sourceId, input.figmaIntent);
  });
  const jiraValidationCandidates = jiraIssues.flatMap((issue) => {
    const ref = jiraSourceRefs.find((candidate) => candidate.contentHash === issue.contentHash);
    if (ref === undefined) return [];
    const fields = jiraFieldCandidates.filter((field) => field.sourceId === ref.sourceId);
    return extractJiraValidationCandidates(issue, ref.sourceId, fields);
  });

  const figmaFieldsBySemantic = new Map<string, DetectedField[]>();
  for (const field of baseIntent.detectedFields) {
    const key = semanticKeyForLabel(field.label);
    const existing = figmaFieldsBySemantic.get(key);
    if (existing === undefined) figmaFieldsBySemantic.set(key, [field]);
    else existing.push(field);
  }

  const figmaValidationsBySemantic = new Map<string, DetectedValidation[]>();
  for (const validation of baseIntent.detectedValidations) {
    const targetField = validation.targetFieldId
      ? baseIntent.detectedFields.find((field) => field.id === validation.targetFieldId)
      : undefined;
    const key = targetField
      ? semanticKeyForLabel(targetField.label)
      : semanticKeyForLabel(validation.rule);
    const existing = figmaValidationsBySemantic.get(key);
    if (existing === undefined) figmaValidationsBySemantic.set(key, [validation]);
    else existing.push(validation);
  }

  for (const candidate of jiraFieldCandidates) {
    usedSourceIds.add(candidate.sourceId);
    recordContribution(candidate.caseId, [candidate.sourceId]);
    const figmaMatches = figmaFieldsBySemantic.get(candidate.semanticKey) ?? [];
    if (figmaMatches.length === 0) {
      const id = `${candidate.screenId}::field::${candidate.sourceId}::${stableSlug(candidate.label)}`;
      baseIntent.detectedFields.push({
        id,
        screenId: candidate.screenId,
        trace: {
          nodeId: candidate.screenId,
          nodeName: candidate.label,
          sourceRefs: [sourceRefForId(input.envelope, candidate.sourceId)],
        },
        provenance: "reconciled",
        confidence: 0.7,
        label: candidate.label,
        type: "text",
        ...(candidate.defaultValue !== undefined
          ? { defaultValue: candidate.defaultValue }
          : {}),
        sourceRefs: [sourceRefForId(input.envelope, candidate.sourceId)],
      });
      transcript.push(
        buildTranscriptEntry({
          sourceIds: [candidate.sourceId],
          action: "accepted",
          rationale: `accepted Jira-derived field "${candidate.label}" without a Figma counterpart`,
          affectedElementIds: [id],
        }),
      );
      continue;
    }

    for (const field of figmaMatches) {
      const fieldSourceIds = field.sourceRefs?.map((ref) => ref.sourceId) ?? figmaSourceIds;
      const participatingSourceIds = [...fieldSourceIds, candidate.sourceId];
      const caseId = `case:${field.screenId}:field:${stableSlug(field.id)}`;
      recordContribution(caseId, participatingSourceIds);
      if (normalizeText(field.label) !== candidate.normalizedLabel) {
        const resolution = resolutionForPolicy(input.envelope.conflictResolutionPolicy);
        const conflict = buildConflict({
          kind: "field_label_mismatch",
          participatingSourceIds,
          normalizedValues: [field.label, candidate.label],
          resolution,
          affectedElementIds: [field.id],
          affectedScreenIds: [field.screenId],
          detail: `Figma field "${field.label}" disagrees with Jira field "${candidate.label}"`,
        });
        conflicts.push(conflict);
        applyFieldConflictPolicy({
          policy: input.envelope.conflictResolutionPolicy,
          field,
          candidate,
          envelope: input.envelope,
        });
        transcript.push(
          buildTranscriptEntry({
            sourceIds: participatingSourceIds,
            action:
              input.envelope.conflictResolutionPolicy === "keep_both"
                ? "alternative_emitted"
                : "conflict_recorded",
            rationale: conflict.detail ?? "field label conflict recorded",
            affectedElementIds: [field.id],
          }),
        );
      } else {
        const mergedRefs = mergeSourceRefs(field.sourceRefs, [
          sourceRefForId(input.envelope, candidate.sourceId),
        ]);
        field.sourceRefs = mergedRefs;
        field.trace.sourceRefs = mergedRefs.map((ref) => ({ ...ref }));
        transcript.push(
          buildTranscriptEntry({
            sourceIds: participatingSourceIds,
            action: "merged",
            rationale: `merged matching field "${field.label}" across sources`,
            affectedElementIds: [field.id],
          }),
        );
      }
    }
  }

  for (const candidate of jiraValidationCandidates) {
    usedSourceIds.add(candidate.sourceId);
    recordContribution(candidate.caseId, [candidate.sourceId]);
    const figmaMatches =
      figmaValidationsBySemantic.get(candidate.semanticKey) ?? [];
    if (figmaMatches.length === 0) {
      const targetField = baseIntent.detectedFields.find(
        (field) => semanticKeyForLabel(field.label) === candidate.semanticKey,
      );
      const id = `${candidate.screenId}::validation::${candidate.sourceId}::${stableSlug(candidate.rule)}`;
      baseIntent.detectedValidations.push({
        id,
        screenId: candidate.screenId,
        trace: {
          nodeId: candidate.screenId,
          nodeName: candidate.rule,
          sourceRefs: [sourceRefForId(input.envelope, candidate.sourceId)],
        },
        provenance: "reconciled",
        confidence: 0.7,
        rule: candidate.rule,
        ...(targetField !== undefined ? { targetFieldId: targetField.id } : {}),
        sourceRefs: [sourceRefForId(input.envelope, candidate.sourceId)],
      });
      transcript.push(
        buildTranscriptEntry({
          sourceIds: [candidate.sourceId],
          action: "accepted",
          rationale: `accepted Jira-derived validation "${candidate.rule}" without a Figma counterpart`,
          affectedElementIds: [id],
        }),
      );
      continue;
    }

    for (const validation of figmaMatches) {
      const validationSourceIds =
        validation.sourceRefs?.map((ref) => ref.sourceId) ?? figmaSourceIds;
      const participatingSourceIds = [...validationSourceIds, candidate.sourceId];
      if (normalizeValidationRule(validation.rule) !== candidate.normalizedRule) {
        const conflict = buildConflict({
          kind: "validation_rule_mismatch",
          participatingSourceIds,
          normalizedValues: [validation.rule, candidate.rule],
          resolution: resolutionForPolicy(input.envelope.conflictResolutionPolicy),
          affectedElementIds: [validation.id],
          affectedScreenIds: [validation.screenId],
          detail: `Figma validation "${validation.rule}" disagrees with Jira validation "${candidate.rule}"`,
        });
        conflicts.push(conflict);
        applyValidationConflictPolicy({
          policy: input.envelope.conflictResolutionPolicy,
          validation,
          candidate,
          envelope: input.envelope,
        });
        transcript.push(
          buildTranscriptEntry({
            sourceIds: participatingSourceIds,
            action:
              input.envelope.conflictResolutionPolicy === "keep_both"
                ? "alternative_emitted"
                : "conflict_recorded",
            rationale: conflict.detail ?? "validation conflict recorded",
            affectedElementIds: [validation.id],
          }),
        );
      } else {
        const mergedRefs = mergeSourceRefs(validation.sourceRefs, [
          sourceRefForId(input.envelope, candidate.sourceId),
        ]);
        validation.sourceRefs = mergedRefs;
        validation.trace.sourceRefs = mergedRefs.map((ref) => ({ ...ref }));
        transcript.push(
          buildTranscriptEntry({
            sourceIds: participatingSourceIds,
            action: "merged",
            rationale: `merged matching validation "${validation.rule}" across sources`,
            affectedElementIds: [validation.id],
          }),
        );
      }
    }
  }

  const candidateRisks = extractCandidateRisks(input);
  const riskByCategory = new Map<TestCaseRiskCategory, CandidateRisk[]>();
  for (const risk of candidateRisks) {
    const existing = riskByCategory.get(risk.category);
    if (existing === undefined) riskByCategory.set(risk.category, [risk]);
    else existing.push(risk);
  }
  for (const [category, risks] of riskByCategory.entries()) {
    if (risks.length === 0) continue;
    const sourceIds = sortedUnique(risks.map((risk) => risk.sourceId));
    for (const sourceId of sourceIds) usedSourceIds.add(sourceId);
    baseIntent.risks.push(category);
    if (sourceIds.length > 1) {
      continue;
    }
    // The category itself is accepted; mismatches are emitted below.
  }
  const riskCategories = [...riskByCategory.keys()].sort();
  if (riskCategories.length > 1) {
    conflicts.push(
      buildConflict({
        kind: "risk_category_mismatch",
        participatingSourceIds: candidateRisks.map((risk) => risk.sourceId),
        normalizedValues: riskCategories,
        resolution: resolutionForPolicy(input.envelope.conflictResolutionPolicy),
        affectedScreenIds: baseIntent.screens.map((screen) => screen.screenId),
        detail: `Sources disagree on risk categories: ${riskCategories.join(", ")}`,
      }),
    );
  }

  const acceptanceCounts = new Map<string, { count: number; sourceIds: string[] }>();
  for (const issue of jiraIssues) {
    const ref = jiraSourceRefs.find((candidate) => candidate.contentHash === issue.contentHash);
    if (ref === undefined) continue;
    for (const criterion of issue.acceptanceCriteria) {
      const text = normalizeText(extractAcceptanceText(criterion));
      const existing = acceptanceCounts.get(text);
      if (existing === undefined) {
        acceptanceCounts.set(text, { count: 1, sourceIds: [ref.sourceId] });
      } else {
        existing.count += 1;
        existing.sourceIds.push(ref.sourceId);
      }
    }
  }
  for (const [text, value] of acceptanceCounts.entries()) {
    if (value.count < 2) continue;
    conflicts.push(
      buildConflict({
        kind: "duplicate_acceptance_criterion",
        participatingSourceIds: value.sourceIds,
        normalizedValues: [text],
        resolution: "unresolved",
        detail: `Duplicate acceptance criterion detected: "${text}"`,
      }),
    );
  }

  const jiraKeys = new Map<string, string[]>();
  for (const ref of jiraSourceRefs) {
    if (ref.canonicalIssueKey === undefined) continue;
    const existing = jiraKeys.get(ref.canonicalIssueKey);
    if (existing === undefined) jiraKeys.set(ref.canonicalIssueKey, [ref.sourceId]);
    else existing.push(ref.sourceId);
  }
  for (const [issueKey, sourceIds] of jiraKeys.entries()) {
    if (sourceIds.length < 2) continue;
    conflicts.push(
      buildConflict({
        kind: "paste_collision",
        participatingSourceIds: sourceIds,
        normalizedValues: [issueKey],
        resolution: "unresolved",
        detail: `Multiple Jira sources resolve to canonical issue key "${issueKey}"`,
      }),
    );
  }

  baseIntent.detectedFields.sort((a, b) => a.id.localeCompare(b.id));
  baseIntent.detectedValidations.sort((a, b) => a.id.localeCompare(b.id));
  baseIntent.risks = sortedUnique(baseIntent.risks);
  baseIntent.openQuestions = sortedUnique([
    ...baseIntent.openQuestions,
    ...conflicts
      .filter((conflict) => conflict.resolution !== "auto_priority")
      .map(
        (conflict) =>
          `multi-source conflict ${conflict.conflictId} requires reviewer attention`,
      ),
  ]);
  if (conflicts.length > 0) {
    baseIntent.multiSourceConflicts = conflicts
      .slice()
      .sort((a, b) => a.conflictId.localeCompare(b.conflictId));
  }

  const unmatchedSources = input.envelope.sources
    .map((ref) => ref.sourceId)
    .filter((sourceId) => !usedSourceIds.has(sourceId))
    .sort();
  for (const sourceId of unmatchedSources) {
    transcript.push(
      buildTranscriptEntry({
        sourceIds: [sourceId],
        action: "source_unmatched",
        rationale: `source "${sourceId}" contributed no accepted or conflicting elements`,
        affectedElementIds: [],
      }),
    );
  }

  const report: MultiSourceReconciliationReport = {
    version: MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
    envelopeHash: input.envelope.aggregateContentHash,
    conflicts: conflicts.slice().sort((a, b) => a.conflictId.localeCompare(b.conflictId)),
    unmatchedSources,
    contributingSourcesPerCase: [...contributingSourcesPerCase.entries()]
      .map(([testCaseId, sourceIds]) => ({
        testCaseId,
        sourceIds: [...sourceIds].sort(),
      }))
      .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId)),
    policyApplied: input.envelope.conflictResolutionPolicy,
    transcript: transcript
      .slice()
      .sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
  };

  return {
    mergedIntent: baseIntent,
    report,
  };
};

const resolutionForPolicy = (
  policy: MultiSourceTestIntentEnvelope["conflictResolutionPolicy"],
): MultiSourceConflict["resolution"] => {
  if (policy === "priority") return "auto_priority";
  if (policy === "reviewer_decides") return "deferred_to_reviewer";
  return "kept_both";
};

const sourceRefForId = (
  envelope: MultiSourceTestIntentEnvelope,
  sourceId: string,
): TestIntentSourceRef => {
  const ref = envelope.sources.find((candidate) => candidate.sourceId === sourceId);
  if (ref === undefined) {
    throw new Error(`unknown sourceId "${sourceId}"`);
  }
  return { ...ref };
};

const mergeSourceRefs = (
  base: readonly TestIntentSourceRef[] | undefined,
  extra: readonly TestIntentSourceRef[],
): TestIntentSourceRef[] => {
  const map = new Map<string, TestIntentSourceRef>();
  for (const ref of base ?? []) map.set(ref.sourceId, { ...ref });
  for (const ref of extra) map.set(ref.sourceId, { ...ref });
  return [...map.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
};

const applyFieldConflictPolicy = (input: {
  policy: MultiSourceTestIntentEnvelope["conflictResolutionPolicy"];
  field: DetectedField;
  candidate: CandidateField;
  envelope: MultiSourceTestIntentEnvelope;
}): void => {
  const candidateRef = sourceRefForId(input.envelope, input.candidate.sourceId);
  if (input.policy === "priority") {
    const winner = winnerSourceId(input.envelope, [
      ...(input.field.sourceRefs?.map((ref) => ref.sourceId) ?? []),
      input.candidate.sourceId,
    ]);
    if (winner === input.candidate.sourceId) {
      input.field.label = input.candidate.label;
      input.field.sourceRefs = [candidateRef];
      input.field.trace.sourceRefs = [candidateRef];
    }
    input.field.provenance = "reconciled";
    return;
  }
  input.field.provenance = "reconciled";
  input.field.ambiguity = {
    reason:
      input.policy === "keep_both"
        ? `Alternative field labels retained: "${input.field.label}" and "${input.candidate.label}"`
        : `Reviewer must choose between field labels "${input.field.label}" and "${input.candidate.label}"`,
  };
  input.field.sourceRefs = mergeSourceRefs(input.field.sourceRefs, [candidateRef]);
  input.field.trace.sourceRefs = input.field.sourceRefs.map((ref) => ({ ...ref }));
  if (input.policy === "keep_both") {
    input.field.defaultValue = appendDisambiguationNote(
      input.field.defaultValue,
      `Alternative Jira label: ${input.candidate.label}`,
    );
  }
};

const applyValidationConflictPolicy = (input: {
  policy: MultiSourceTestIntentEnvelope["conflictResolutionPolicy"];
  validation: DetectedValidation;
  candidate: CandidateValidation;
  envelope: MultiSourceTestIntentEnvelope;
}): void => {
  const candidateRef = sourceRefForId(input.envelope, input.candidate.sourceId);
  if (input.policy === "priority") {
    const winner = winnerSourceId(input.envelope, [
      ...(input.validation.sourceRefs?.map((ref) => ref.sourceId) ?? []),
      input.candidate.sourceId,
    ]);
    if (winner === input.candidate.sourceId) {
      input.validation.rule = input.candidate.rule;
      input.validation.sourceRefs = [candidateRef];
      input.validation.trace.sourceRefs = [candidateRef];
    }
    input.validation.provenance = "reconciled";
    return;
  }
  input.validation.provenance = "reconciled";
  input.validation.ambiguity = {
    reason:
      input.policy === "keep_both"
        ? `Alternative validation rules retained: "${input.validation.rule}" and "${input.candidate.rule}"`
        : `Reviewer must choose between validation rules "${input.validation.rule}" and "${input.candidate.rule}"`,
  };
  input.validation.sourceRefs = mergeSourceRefs(input.validation.sourceRefs, [
    candidateRef,
  ]);
  input.validation.trace.sourceRefs = input.validation.sourceRefs.map((ref) => ({
    ...ref,
  }));
};

const appendDisambiguationNote = (
  value: string | undefined,
  note: string,
): string => {
  if (value === undefined || value.length === 0) return note;
  if (value.includes(note)) return value;
  return `${value} | ${note}`;
};

const winnerSourceId = (
  envelope: MultiSourceTestIntentEnvelope,
  sourceIds: readonly string[],
): string | undefined => {
  if (envelope.conflictResolutionPolicy !== "priority") return undefined;
  const order = envelope.priorityOrder ?? [];
  const refs = sourceIds
    .map((sourceId) => envelope.sources.find((ref) => ref.sourceId === sourceId))
    .filter((ref): ref is TestIntentSourceRef => ref !== undefined);
  refs.sort((a, b) => {
    const aIndex = order.indexOf(a.kind);
    const bIndex = order.indexOf(b.kind);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.sourceId.localeCompare(b.sourceId);
  });
  return refs[0]?.sourceId;
};

export const writeMultiSourceReconciliationReport = async (
  input: WriteMultiSourceReconciliationReportInput,
): Promise<WriteMultiSourceReconciliationReportResult> => {
  await mkdir(input.destinationDir, { recursive: true });
  const artifactPath = join(
    input.destinationDir,
    MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME,
  );
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.report), "utf8");
  await rename(tempPath, artifactPath);
  return { artifactPath };
};
