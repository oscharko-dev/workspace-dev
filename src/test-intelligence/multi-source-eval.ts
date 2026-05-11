/**
 * Wave 4.I CI eval gate (Issue #1439).
 *
 * Aggregates per-fixture {@link Wave4ProductionReadinessRunResult}s into a
 * deterministic {@link Wave4ProductionReadinessEvalReport}. The gate
 * applies threshold checks for source provenance, test-case attribution,
 * conflict-detection recall, and air-gap fetch counts.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME,
  WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION,
  type Wave4ProductionReadinessEvalReport,
  type Wave4ProductionReadinessEvalThresholds,
  type Wave4SourceMixCoverageEntry,
  type Wave4SourceMixId,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { Wave4ProductionReadinessRunResult } from "./multi-source-production-readiness.js";

/** Default Wave 4.I production-readiness eval thresholds. */
export const WAVE4_DEFAULT_EVAL_THRESHOLDS: Wave4ProductionReadinessEvalThresholds =
  Object.freeze({
    minSourceProvenance: 1.0,
    minTestCaseSourceAttribution: 1.0,
    minConflictDetectionRecall: 0.95,
    maxAirgapFetchCalls: 0,
  });

export interface Wave4EvalSourceMixResult {
  mixId: Wave4SourceMixId;
  fixtureId: string;
  runResult: Wave4ProductionReadinessRunResult;
  /** For conflict-bearing fixtures: reconciliation conflict-detection recall. */
  conflictRecallScore?: number;
  /** For air-gap fixtures: number of outbound fetch calls observed. */
  airgapFetchCallCount?: number;
  /** Number of envelope sources in the markdown input format. */
  markdownSourceCount?: number;
  /** Number of those markdown sources with provenance records. */
  markdownSourcesWithProvenance?: number;
  /** Expected envelope source count. Defaults to the harness result value. */
  expectedSourceCount?: number;
}

export interface EvaluateWave4ProductionReadinessInput {
  thresholds?: Partial<Wave4ProductionReadinessEvalThresholds>;
  sourceMixResults: readonly Wave4EvalSourceMixResult[];
  /** ISO-8601 timestamp to embed in the report; defaults to now(). */
  generatedAt?: string;
}

export const evaluateWave4ProductionReadiness = (
  input: EvaluateWave4ProductionReadinessInput,
): Wave4ProductionReadinessEvalReport => {
  const thresholds = resolveThresholds(input.thresholds);
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const entries: Wave4SourceMixCoverageEntry[] = [];
  let totalProvenance = 0;
  let totalProvenanceWeight = 0;
  let totalAttribution = 0;
  let totalAttributionWeight = 0;
  let totalMarkdownSources = 0;
  let totalMarkdownWithProv = 0;

  const failureReasons: string[] = [];

  for (const item of input.sourceMixResults) {
    const sourceCount = item.runResult.sourceProvenanceSummaries.length;
    const expectedSourceCount = countEnvelopeSources(item);
    const provCoverage =
      expectedSourceCount === 0 ? 1 : sourceCount / expectedSourceCount;
    const attrCoverage = computeAttributionCoverage(item);

    const reasons = collectMixFailureReasons({
      thresholds,
      provCoverage,
      attrCoverage,
      item,
    });

    const entry: Wave4SourceMixCoverageEntry = {
      mixId: item.mixId,
      fixtureId: item.fixtureId,
      pass: reasons.length === 0,
      sourceProvenanceCoverage: clamp01(provCoverage),
      testCaseAttributionCoverage: clamp01(attrCoverage),
      failureReasons: reasons,
    };
    if (item.conflictRecallScore !== undefined) {
      entry.conflictDetectionRecall = item.conflictRecallScore;
    }
    if (item.airgapFetchCallCount !== undefined) {
      entry.airgapFetchCalls = item.airgapFetchCallCount;
    }
    entries.push(entry);

    totalProvenance += sourceCount;
    totalProvenanceWeight += expectedSourceCount;
    totalAttribution += attrCoverage * (expectedSourceCount > 0 ? 1 : 0);
    totalAttributionWeight += expectedSourceCount > 0 ? 1 : 0;

    if (item.markdownSourceCount !== undefined) {
      totalMarkdownSources += item.markdownSourceCount;
    }
    if (item.markdownSourcesWithProvenance !== undefined) {
      totalMarkdownWithProv += item.markdownSourcesWithProvenance;
    }

    for (const reason of reasons)
      failureReasons.push(`${item.mixId}:${reason}`);
  }

  const overallProv =
    totalProvenanceWeight === 0 ? 1 : totalProvenance / totalProvenanceWeight;
  const overallAttr =
    totalAttributionWeight === 0
      ? 1
      : totalAttribution / totalAttributionWeight;

  const passed = entries.every((entry) => entry.pass);
  const markdownCoverage = {
    totalMarkdownSources,
    sourcesWithProvenance: totalMarkdownWithProv,
    coverageRatio:
      totalMarkdownSources === 0
        ? 1
        : totalMarkdownWithProv / totalMarkdownSources,
  };

  return {
    version: WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION,
    generatedAt,
    thresholds,
    passed,
    overallSourceProvenanceCoverage: clamp01(overallProv),
    overallTestCaseAttributionCoverage: clamp01(overallAttr),
    sourceMixCoverage: entries,
    markdownCustomContextCoverage: markdownCoverage,
    failureReasons,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
    rawJiraResponsePersisted: false,
    rawPasteBytesPersisted: false,
  };
};

interface CollectMixFailureReasonsInput {
  thresholds: Wave4ProductionReadinessEvalThresholds;
  provCoverage: number;
  attrCoverage: number;
  item: Wave4EvalSourceMixResult;
}

const collectMixFailureReasons = (
  input: CollectMixFailureReasonsInput,
): string[] => {
  const reasons: string[] = [];
  if (!input.item.runResult.ok) {
    reasons.push("run_not_ok");
  }
  if (!input.item.runResult.quotasPassed) {
    reasons.push("quota_breach");
  }
  if (input.provCoverage < input.thresholds.minSourceProvenance) {
    reasons.push("source_provenance_below_threshold");
  }
  if (input.attrCoverage < input.thresholds.minTestCaseSourceAttribution) {
    reasons.push("test_case_attribution_below_threshold");
  }
  if (
    input.item.conflictRecallScore !== undefined &&
    input.item.conflictRecallScore < input.thresholds.minConflictDetectionRecall
  ) {
    reasons.push("conflict_detection_recall_below_threshold");
  }
  if (
    input.item.airgapFetchCallCount !== undefined &&
    input.item.airgapFetchCallCount > input.thresholds.maxAirgapFetchCalls
  ) {
    reasons.push("airgap_fetch_calls_above_threshold");
  }
  return reasons;
};

const countEnvelopeSources = (item: Wave4EvalSourceMixResult): number => {
  return item.expectedSourceCount ?? item.runResult.expectedSourceCount;
};

const computeAttributionCoverage = (item: Wave4EvalSourceMixResult): number => {
  // For the production-readiness gate, source attribution coverage is the
  // fraction of provenance summaries that carry a non-empty content hash.
  const summaries = item.runResult.sourceProvenanceSummaries;
  if (summaries.length === 0) return item.runResult.ok ? 1 : 0;
  const attributed = summaries.filter(
    (summary) =>
      typeof summary.contentHash === "string" &&
      summary.contentHash.length > 0 &&
      summary.bytes > 0,
  ).length;
  return attributed / summaries.length;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const resolveThresholds = (
  partial: Partial<Wave4ProductionReadinessEvalThresholds> | undefined,
): Wave4ProductionReadinessEvalThresholds => {
  if (partial === undefined) {
    return { ...WAVE4_DEFAULT_EVAL_THRESHOLDS };
  }
  return {
    minSourceProvenance:
      partial.minSourceProvenance ??
      WAVE4_DEFAULT_EVAL_THRESHOLDS.minSourceProvenance,
    minTestCaseSourceAttribution:
      partial.minTestCaseSourceAttribution ??
      WAVE4_DEFAULT_EVAL_THRESHOLDS.minTestCaseSourceAttribution,
    minConflictDetectionRecall:
      partial.minConflictDetectionRecall ??
      WAVE4_DEFAULT_EVAL_THRESHOLDS.minConflictDetectionRecall,
    maxAirgapFetchCalls:
      partial.maxAirgapFetchCalls ??
      WAVE4_DEFAULT_EVAL_THRESHOLDS.maxAirgapFetchCalls,
  };
};

export interface WriteWave4ProductionReadinessEvalReportResult {
  artifactPath: string;
}

export const writeWave4ProductionReadinessEvalReport = async (
  report: Wave4ProductionReadinessEvalReport,
  runDir: string,
): Promise<WriteWave4ProductionReadinessEvalReportResult> => {
  if (typeof runDir !== "string" || runDir.length === 0) {
    throw new TypeError(
      "writeWave4ProductionReadinessEvalReport: runDir must be a non-empty string",
    );
  }
  await mkdir(runDir, { recursive: true });
  const artifactPath = join(
    runDir,
    WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME,
  );
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(report), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};
