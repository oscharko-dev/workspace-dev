/**
 * Tests for the Wave 4.I production-readiness CI eval gate
 * (`evaluateWave4ProductionReadiness`, `writeWave4ProductionReadinessEvalReport`)
 * introduced for Issue #1439.
 */

import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME,
  WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION,
} from "../contracts/index.js";
import {
  WAVE4_DEFAULT_EVAL_THRESHOLDS,
  evaluateWave4ProductionReadiness,
  writeWave4ProductionReadinessEvalReport,
  type Wave4EvalSourceMixResult,
} from "./multi-source-eval.js";
import type { Wave4ProductionReadinessRunResult } from "./multi-source-production-readiness.js";

interface RunResultOverrides {
  ok?: boolean;
  quotasPassed?: boolean;
  expectedSourceCount?: number;
  sourceProvenanceSummaries?: Wave4ProductionReadinessRunResult["sourceProvenanceSummaries"];
  fixtureId?: string;
}

const makeRunResult = (
  overrides: RunResultOverrides = {},
): Wave4ProductionReadinessRunResult => ({
  ok: overrides.ok ?? true,
  quotasPassed: overrides.quotasPassed ?? true,
  expectedSourceCount:
    overrides.expectedSourceCount ??
    overrides.sourceProvenanceSummaries?.length ??
    1,
  sourceProvenanceSummaries: overrides.sourceProvenanceSummaries ?? [
    {
      sourceId: "src-1",
      kind: "figma_local_json",
      irArtifactPath: "/tmp/ir.json",
      contentHash:
        "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
      bytes: 100,
    },
  ],
  provenanceRecords: [],
  rawScreenshotsIncluded: false,
  secretsIncluded: false,
  rawJiraResponsePersisted: false,
  rawPasteBytesPersisted: false,
  fixtureId: overrides.fixtureId ?? "release-multisource-onboarding",
  mixId: "figma_plus_jira_plus_custom",
  runDir: "/tmp/run",
});

const passingMix = (): Wave4EvalSourceMixResult => ({
  mixId: "figma_plus_jira_plus_custom",
  fixtureId: "release-multisource-onboarding",
  runResult: makeRunResult(),
});

test("WAVE4_DEFAULT_EVAL_THRESHOLDS: matches the documented production-readiness thresholds", () => {
  assert.equal(WAVE4_DEFAULT_EVAL_THRESHOLDS.minSourceProvenance, 1.0);
  assert.equal(WAVE4_DEFAULT_EVAL_THRESHOLDS.minTestCaseSourceAttribution, 1.0);
  assert.equal(WAVE4_DEFAULT_EVAL_THRESHOLDS.minConflictDetectionRecall, 0.95);
  assert.equal(WAVE4_DEFAULT_EVAL_THRESHOLDS.maxAirgapFetchCalls, 0);
});

test("evaluateWave4ProductionReadiness: a single passing source-mix yields passed=true", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [passingMix()],
  });
  assert.equal(report.passed, true);
  assert.equal(report.failureReasons.length, 0);
  assert.equal(report.sourceMixCoverage.length, 1);
  assert.equal(report.sourceMixCoverage[0]?.pass, true);
});

test("evaluateWave4ProductionReadiness: ok=false on the run produces passed=false", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "figma_only",
        fixtureId: "release-multisource-figma-only-regression",
        runResult: makeRunResult({ ok: false }),
      },
    ],
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.failureReasons.some((reason) => reason.endsWith(":run_not_ok")),
  );
});

test("evaluateWave4ProductionReadiness: quotasPassed=false produces passed=false", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "jira_paste_only",
        fixtureId: "release-multisource-jira-paste-only-airgap",
        runResult: makeRunResult({ quotasPassed: false }),
      },
    ],
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.failureReasons.some((reason) => reason.endsWith(":quota_breach")),
  );
});

test("evaluateWave4ProductionReadiness: missing source provenance fails against expected source count", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "figma_plus_jira_plus_custom",
        fixtureId: "release-multisource-onboarding",
        runResult: makeRunResult({
          expectedSourceCount: 3,
          sourceProvenanceSummaries: [],
        }),
      },
    ],
  });
  assert.equal(report.passed, false);
  assert.equal(report.sourceMixCoverage[0]?.sourceProvenanceCoverage, 0);
  assert.ok(
    report.failureReasons.some((reason) =>
      reason.endsWith(":source_provenance_below_threshold"),
    ),
  );
});

test("evaluateWave4ProductionReadiness: conflict recall below threshold fails the gate", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "all_sources_with_conflict",
        fixtureId: "release-multisource-payment-with-conflict",
        runResult: makeRunResult(),
        conflictRecallScore: 0.5,
      },
    ],
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.failureReasons.some((reason) =>
      reason.endsWith(":conflict_detection_recall_below_threshold"),
    ),
  );
});

test("evaluateWave4ProductionReadiness: airgap fetch calls above threshold fails the gate", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "jira_paste_only",
        fixtureId: "release-multisource-paste-only-airgap",
        runResult: makeRunResult(),
        airgapFetchCallCount: 1,
      },
    ],
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.failureReasons.some((reason) =>
      reason.endsWith(":airgap_fetch_calls_above_threshold"),
    ),
  );
});

test("evaluateWave4ProductionReadiness: empty sourceMixResults passes vacuously", () => {
  const report = evaluateWave4ProductionReadiness({ sourceMixResults: [] });
  assert.equal(report.passed, true);
  assert.equal(report.sourceMixCoverage.length, 0);
  assert.equal(report.overallSourceProvenanceCoverage, 1);
  assert.equal(report.overallTestCaseAttributionCoverage, 1);
});

test("evaluateWave4ProductionReadiness: overall coverage is clamped to [0, 1]", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [passingMix(), passingMix()],
  });
  assert.ok(report.overallSourceProvenanceCoverage >= 0);
  assert.ok(report.overallSourceProvenanceCoverage <= 1);
  assert.ok(report.overallTestCaseAttributionCoverage >= 0);
  assert.ok(report.overallTestCaseAttributionCoverage <= 1);
});

test("evaluateWave4ProductionReadiness: markdownCustomContextCoverage reflects supplied counts", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [
      {
        mixId: "custom_markdown_only",
        fixtureId: "release-multisource-custom-markdown-adversarial",
        runResult: makeRunResult(),
        markdownSourceCount: 4,
        markdownSourcesWithProvenance: 3,
      },
    ],
  });
  assert.equal(report.markdownCustomContextCoverage.totalMarkdownSources, 4);
  assert.equal(report.markdownCustomContextCoverage.sourcesWithProvenance, 3);
  assert.equal(report.markdownCustomContextCoverage.coverageRatio, 3 / 4);
});

test("evaluateWave4ProductionReadiness: report.version matches the schema constant", () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [passingMix()],
  });
  assert.equal(
    report.version,
    WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION,
  );
});

test("writeWave4ProductionReadinessEvalReport: writes a deterministic JSON artifact", async () => {
  const runDir = await mkdtemp(join(os.tmpdir(), "wave4-eval-"));
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [passingMix()],
  });
  const result = await writeWave4ProductionReadinessEvalReport(report, runDir);
  const expectedPath = join(
    runDir,
    WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME,
  );
  assert.equal(result.artifactPath, expectedPath);
  const raw = await readFile(expectedPath, "utf8");
  const parsed = JSON.parse(raw) as { version: string; passed: boolean };
  assert.equal(
    parsed.version,
    WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION,
  );
  assert.equal(parsed.passed, true);
});

test("writeWave4ProductionReadinessEvalReport: throws TypeError when runDir is empty", async () => {
  const report = evaluateWave4ProductionReadiness({
    sourceMixResults: [passingMix()],
  });
  await assert.rejects(
    () => writeWave4ProductionReadinessEvalReport(report, ""),
    (err) => err instanceof TypeError,
  );
});
