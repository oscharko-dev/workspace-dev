/**
 * Traceability matrix builder (Issue #1373).
 *
 * Produces a deterministic {@link TraceabilityMatrix} that joins
 * the lifecycle of every generated test case across:
 *
 *   - Figma source (screen ids + node ids from `figmaTraceRefs`),
 *   - intent IR (field / action / validation / navigation ids the
 *     case covers, derived from `qualitySignals` + IR membership),
 *   - QC mapping preview (folder path + external-id candidate),
 *   - transfer report (resolved QC entity id + per-case outcome),
 *   - visual sidecar observations (per-screen deployment +
 *     outcomes + mean confidence),
 *   - reconciliation decisions (provenance + confidence per IR
 *     element, with explicit ambiguity sanitised),
 *   - validation + policy outcomes (per-case error/warning
 *     verdict + sorted policy outcome codes).
 *
 * The builder is pure: identical inputs produce byte-identical
 * output. The companion {@link writeTraceabilityMatrix} persists
 * the artifact atomically using the
 * `${pid}.${randomUUID()}.tmp` rename pattern shared by the rest
 * of the test-intelligence module. The artifact stamps the type-
 * level invariants `rawScreenshotsIncluded: false` and
 * `secretsIncluded: false`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  TRACEABILITY_MATRIX_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type IntentProvenance,
  type QcMappingPreviewArtifact,
  type ReviewGateSnapshot,
  type TestCasePolicyDecision,
  type TestCasePolicyOutcome,
  type TestCasePolicyReport,
  type TestCaseValidationIssue,
  type TestCaseValidationReport,
  type TraceabilityMatrix,
  type TraceabilityMatrixRow,
  type TraceabilityReconciliationDecision,
  type TraceabilityStepRow,
  type TraceabilityVisualObservation,
  type TransferEntityRecord,
  type TransferReportArtifact,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const AMBIGUITY_DETAIL_MAX = 240;

const sortedUnique = <T extends string>(values: Iterable<T>): T[] =>
  Array.from(new Set(values)).sort();

const sanitizeAmbiguity = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length <= AMBIGUITY_DETAIL_MAX
    ? cleaned
    : `${cleaned.slice(0, AMBIGUITY_DETAIL_MAX)}...`;
};

export interface BuildTraceabilityMatrixInput {
  jobId: string;
  generatedAt: string;
  intent: BusinessTestIntentIr;
  list: GeneratedTestCaseList;
  /** QC mapping preview produced by `buildQcMappingPreview`. */
  qcMapping?: QcMappingPreviewArtifact;
  /** Transfer report produced by `runOpenTextAlmApiTransfer`. */
  transferReport?: TransferReportArtifact;
  /** Visual sidecar validation report. */
  visual?: VisualSidecarValidationReport;
  /** Validation report (`validation-report.json`). */
  validation?: TestCaseValidationReport;
  /** Policy report (`policy-report.json`). */
  policy?: TestCasePolicyReport;
  /** Review-gate snapshot (`review-state.json` payload). */
  reviewSnapshot?: ReviewGateSnapshot;
  /** Identity of the export profile in play. */
  exportProfile?: { id: string; version: string };
  /** Identity of the policy profile in play. */
  policyProfile?: { id: string; version: string };
}

interface ValidationVerdict {
  outcome: "ok" | "warning" | "error";
}

const buildValidationIndex = (
  validation: TestCaseValidationReport | undefined,
): Map<string, ValidationVerdict> => {
  const out = new Map<string, ValidationVerdict>();
  if (validation === undefined) return out;
  for (const issue of validation.issues) {
    const id = extractTestCaseIdFromValidationIssue(issue);
    if (id === undefined) continue;
    const previous = out.get(id);
    const next: ValidationVerdict = aggregateValidationVerdict(
      previous,
      issue.severity,
    );
    out.set(id, next);
  }
  return out;
};

const aggregateValidationVerdict = (
  previous: ValidationVerdict | undefined,
  severity: "error" | "warning",
): ValidationVerdict => {
  if (severity === "error") return { outcome: "error" };
  if (previous?.outcome === "error") return previous;
  return { outcome: "warning" };
};

const extractTestCaseIdFromValidationIssue = (
  issue: TestCaseValidationIssue,
): string | undefined => {
  if (typeof issue.testCaseId === "string" && issue.testCaseId.length > 0) {
    return issue.testCaseId;
  }
  return undefined;
};

const buildVisualObservations = (
  testCase: GeneratedTestCase,
  visual: VisualSidecarValidationReport | undefined,
): TraceabilityVisualObservation[] => {
  if (visual === undefined) return [];
  const screenIds = new Set(testCase.figmaTraceRefs.map((r) => r.screenId));
  const observations: TraceabilityVisualObservation[] = [];
  for (const record of visual.records) {
    if (!screenIds.has(record.screenId)) continue;
    observations.push({
      screenId: record.screenId,
      deployment: record.deployment,
      outcomes: sortedUnique(record.outcomes),
      meanConfidence: record.meanConfidence,
    });
  }
  observations.sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );
  return observations;
};

interface IrElementProvenance {
  elementId: string;
  screenId: string;
  provenance: IntentProvenance;
  confidence: number;
  ambiguity?: string;
}

const collectIntentElements = (
  intent: BusinessTestIntentIr,
): Map<string, IrElementProvenance> => {
  const map = new Map<string, IrElementProvenance>();
  const push = (
    elementId: string,
    screenId: string,
    provenance: IntentProvenance,
    confidence: number,
    ambiguity: string | undefined,
  ): void => {
    const sanitized = sanitizeAmbiguity(ambiguity);
    const entry: IrElementProvenance = {
      elementId,
      screenId,
      provenance,
      confidence,
    };
    if (sanitized !== undefined) entry.ambiguity = sanitized;
    map.set(elementId, entry);
  };
  for (const f of intent.detectedFields) {
    push(f.id, f.screenId, f.provenance, f.confidence, f.ambiguity?.reason);
  }
  for (const a of intent.detectedActions) {
    push(a.id, a.screenId, a.provenance, a.confidence, a.ambiguity?.reason);
  }
  for (const v of intent.detectedValidations) {
    push(v.id, v.screenId, v.provenance, v.confidence, v.ambiguity?.reason);
  }
  for (const n of intent.detectedNavigation) {
    push(n.id, n.screenId, n.provenance, n.confidence, n.ambiguity?.reason);
  }
  return map;
};

const buildReconciliationDecisions = (
  testCase: GeneratedTestCase,
  irElements: ReadonlyMap<string, IrElementProvenance>,
): TraceabilityReconciliationDecision[] => {
  const ids = new Set<string>([
    ...testCase.qualitySignals.coveredFieldIds,
    ...testCase.qualitySignals.coveredActionIds,
    ...testCase.qualitySignals.coveredValidationIds,
    ...testCase.qualitySignals.coveredNavigationIds,
  ]);
  const out: TraceabilityReconciliationDecision[] = [];
  for (const id of Array.from(ids).sort()) {
    const entry = irElements.get(id);
    if (entry === undefined) continue;
    const row: TraceabilityReconciliationDecision = {
      screenId: entry.screenId,
      elementId: entry.elementId,
      provenance: entry.provenance,
      confidence: entry.confidence,
    };
    if (entry.ambiguity !== undefined) row.ambiguity = entry.ambiguity;
    out.push(row);
  }
  return out;
};

const buildIntentCoverageRow = (testCase: GeneratedTestCase) => ({
  fieldIds: sortedUnique(testCase.qualitySignals.coveredFieldIds),
  actionIds: sortedUnique(testCase.qualitySignals.coveredActionIds),
  validationIds: sortedUnique(testCase.qualitySignals.coveredValidationIds),
  navigationIds: sortedUnique(testCase.qualitySignals.coveredNavigationIds),
});

interface QcLinks {
  externalIdCandidate?: string;
  qcFolderPath?: string;
}

const buildQcLinks = (
  testCase: GeneratedTestCase,
  qcMappingIndex: ReadonlyMap<
    string,
    QcMappingPreviewArtifact["entries"][number]
  >,
): QcLinks => {
  const entry = qcMappingIndex.get(testCase.id);
  if (entry === undefined) return {};
  return {
    externalIdCandidate: entry.externalIdCandidate,
    qcFolderPath: entry.targetFolderPath,
  };
};

const buildTransferLinks = (
  testCaseId: string,
  transferIndex: ReadonlyMap<string, TransferEntityRecord>,
): {
  qcEntityId?: string;
  transferOutcome?: TransferEntityRecord["outcome"];
} => {
  const record = transferIndex.get(testCaseId);
  if (record === undefined) return {};
  const out: {
    qcEntityId?: string;
    transferOutcome?: TransferEntityRecord["outcome"];
  } = { transferOutcome: record.outcome };
  if (record.qcEntityId.length > 0) out.qcEntityId = record.qcEntityId;
  return out;
};

const buildStepRows = (
  input: {
    testCase: GeneratedTestCase;
    qcEntry: QcMappingPreviewArtifact["entries"][number] | undefined;
    figmaScreenIds: string[];
    figmaNodeIds: string[];
    visualObservations: TraceabilityVisualObservation[];
    validationOutcome: "ok" | "warning" | "error";
    policyVerdict: PolicyVerdict | undefined;
  },
): TraceabilityStepRow[] => {
  const qcStepIndexes = new Set(
    input.qcEntry?.designSteps.map((step) => step.index) ?? [],
  );
  return input.testCase.steps
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((step) => {
      const row: TraceabilityStepRow = {
        stepIndex: step.index,
        action: step.action,
        figmaScreenIds: input.figmaScreenIds,
        figmaNodeIds: input.figmaNodeIds,
        visualObservations: input.visualObservations,
        validationOutcome: input.validationOutcome,
        policyOutcomes: input.policyVerdict?.outcomes ?? [],
      };
      if (step.expected !== undefined) row.expected = step.expected;
      if (qcStepIndexes.has(step.index)) row.qcDesignStepIndex = step.index;
      if (input.policyVerdict !== undefined) {
        row.policyDecision = input.policyVerdict.decision;
      }
      return row;
    });
};

interface PolicyVerdict {
  decision: TestCasePolicyDecision;
  outcomes: TestCasePolicyOutcome[];
}

const buildPolicyIndex = (
  policy: TestCasePolicyReport | undefined,
): Map<string, PolicyVerdict> => {
  const out = new Map<string, PolicyVerdict>();
  if (policy === undefined) return out;
  for (const decision of policy.decisions) {
    const outcomes = sortedUnique(decision.violations.map((v) => v.outcome));
    out.set(decision.testCaseId, {
      decision: decision.decision,
      outcomes,
    });
  }
  return out;
};

const buildReviewIndex = (
  reviewSnapshot: ReviewGateSnapshot | undefined,
): Map<string, ReviewGateSnapshot["perTestCase"][number]> => {
  const out = new Map<string, ReviewGateSnapshot["perTestCase"][number]>();
  if (reviewSnapshot === undefined) return out;
  for (const r of reviewSnapshot.perTestCase) out.set(r.testCaseId, r);
  return out;
};

const buildRow = (
  testCase: GeneratedTestCase,
  ctx: {
    qcMappingIndex: ReadonlyMap<
      string,
      QcMappingPreviewArtifact["entries"][number]
    >;
    transferIndex: ReadonlyMap<string, TransferEntityRecord>;
    visual: VisualSidecarValidationReport | undefined;
    validationIndex: ReadonlyMap<string, ValidationVerdict>;
    policyIndex: ReadonlyMap<string, PolicyVerdict>;
    reviewIndex: ReadonlyMap<string, ReviewGateSnapshot["perTestCase"][number]>;
    irElements: ReadonlyMap<string, IrElementProvenance>;
  },
): TraceabilityMatrixRow => {
  const figmaScreenIds = sortedUnique(
    testCase.figmaTraceRefs.map((r) => r.screenId),
  );
  const figmaNodeIds = sortedUnique(
    testCase.figmaTraceRefs
      .map((r) => r.nodeId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const coverage = buildIntentCoverageRow(testCase);
  const qcLinks = buildQcLinks(testCase, ctx.qcMappingIndex);
  const transferLinks = buildTransferLinks(testCase.id, ctx.transferIndex);
  const visualObservations = buildVisualObservations(testCase, ctx.visual);
  const reconciliation = buildReconciliationDecisions(testCase, ctx.irElements);
  const validationVerdict =
    ctx.validationIndex.get(testCase.id)?.outcome ?? "ok";
  const policyVerdict = ctx.policyIndex.get(testCase.id);
  const review = ctx.reviewIndex.get(testCase.id);
  const qcEntry = ctx.qcMappingIndex.get(testCase.id);
  const stepRows = buildStepRows({
    testCase,
    qcEntry,
    figmaScreenIds,
    figmaNodeIds,
    visualObservations,
    validationOutcome: validationVerdict,
    policyVerdict,
  });

  const row: TraceabilityMatrixRow = {
    testCaseId: testCase.id,
    title: testCase.title,
    figmaScreenIds,
    figmaNodeIds,
    intentFieldIds: coverage.fieldIds,
    intentActionIds: coverage.actionIds,
    intentValidationIds: coverage.validationIds,
    intentNavigationIds: coverage.navigationIds,
    visualObservations,
    steps: stepRows,
    reconciliationDecisions: reconciliation,
    validationOutcome: validationVerdict,
    policyOutcomes: policyVerdict?.outcomes ?? [],
  };
  if (qcLinks.externalIdCandidate !== undefined)
    row.externalIdCandidate = qcLinks.externalIdCandidate;
  if (qcLinks.qcFolderPath !== undefined)
    row.qcFolderPath = qcLinks.qcFolderPath;
  if (transferLinks.qcEntityId !== undefined)
    row.qcEntityId = transferLinks.qcEntityId;
  if (transferLinks.transferOutcome !== undefined)
    row.transferOutcome = transferLinks.transferOutcome;
  if (policyVerdict !== undefined) row.policyDecision = policyVerdict.decision;
  if (review !== undefined) row.reviewState = review.state;
  return row;
};

const computeTotals = (
  rows: ReadonlyArray<TraceabilityMatrixRow>,
): TraceabilityMatrix["totals"] => {
  const totals: TraceabilityMatrix["totals"] = {
    rows: rows.length,
    transferred: 0,
    failed: 0,
    skippedDuplicate: 0,
    refused: 0,
  };
  for (const r of rows) {
    if (r.transferOutcome === "created") totals.transferred += 1;
    else if (r.transferOutcome === "failed") totals.failed += 1;
    else if (r.transferOutcome === "skipped_duplicate")
      totals.skippedDuplicate += 1;
    else if (r.transferOutcome === "refused") totals.refused += 1;
  }
  return totals;
};

const buildQcMappingIndex = (
  qcMapping: QcMappingPreviewArtifact | undefined,
): Map<string, QcMappingPreviewArtifact["entries"][number]> => {
  const out = new Map<string, QcMappingPreviewArtifact["entries"][number]>();
  if (qcMapping === undefined) return out;
  for (const entry of qcMapping.entries) out.set(entry.testCaseId, entry);
  return out;
};

const buildTransferIndex = (
  transfer: TransferReportArtifact | undefined,
): Map<string, TransferEntityRecord> => {
  const out = new Map<string, TransferEntityRecord>();
  if (transfer === undefined) return out;
  for (const record of transfer.records) out.set(record.testCaseId, record);
  return out;
};

/** Pure builder for a deterministic traceability matrix. */
export const buildTraceabilityMatrix = (
  input: BuildTraceabilityMatrixInput,
): TraceabilityMatrix => {
  const validationIndex = buildValidationIndex(input.validation);
  const policyIndex = buildPolicyIndex(input.policy);
  const reviewIndex = buildReviewIndex(input.reviewSnapshot);
  const irElements = collectIntentElements(input.intent);
  const qcMappingIndex = buildQcMappingIndex(input.qcMapping);
  const transferIndex = buildTransferIndex(input.transferReport);

  const rows: TraceabilityMatrixRow[] = input.list.testCases
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((tc) =>
      buildRow(tc, {
        qcMappingIndex,
        transferIndex,
        visual: input.visual,
        validationIndex,
        policyIndex,
        reviewIndex,
        irElements,
      }),
    );

  const totals = computeTotals(rows);

  const matrix: TraceabilityMatrix = {
    schemaVersion: TRACEABILITY_MATRIX_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    rows,
    totals,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
  };
  if (input.exportProfile !== undefined) {
    matrix.exportProfile = {
      id: input.exportProfile.id,
      version: input.exportProfile.version,
    };
  }
  if (input.policyProfile !== undefined) {
    matrix.policyProfile = {
      id: input.policyProfile.id,
      version: input.policyProfile.version,
    };
  }
  return matrix;
};

export interface WriteTraceabilityMatrixInput {
  matrix: TraceabilityMatrix;
  destinationDir: string;
}

export interface WriteTraceabilityMatrixResult {
  artifactPath: string;
}

/** Persist a traceability matrix atomically using the shared temp-rename pattern. */
export const writeTraceabilityMatrix = async (
  input: WriteTraceabilityMatrixInput,
): Promise<WriteTraceabilityMatrixResult> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.matrix);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return { artifactPath: path };
};
