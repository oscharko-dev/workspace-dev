/**
 * Test-case delta classifier (Issue #1373).
 *
 * Given the prior and current `GeneratedTestCaseList` for a job
 * plus the upstream `IntentDeltaReport`, mark each test case with
 * a {@link TestCaseDeltaVerdict}:
 *
 *   - `new` — case id present in current generation, absent from
 *     prior generation.
 *   - `unchanged` — case id present in both with byte-identical
 *     fingerprint AND no IR delta touches its `figmaTraceRefs`.
 *   - `changed` — case id present in both, fingerprint differs
 *     (or an IR delta touches one of its trace screens).
 *   - `obsolete` — case id present in prior generation but EVERY
 *     trace screen is absent from the current IR. Reported only —
 *     never destructively removed from QC (per Issue #1373 AC3).
 *   - `requires_review` — visual confidence dropped below the
 *     configured threshold OR a reconciliation conflict surfaced.
 *
 * The classifier is pure: identical inputs produce byte-identical
 * output. The companion {@link writeTestCaseDeltaReport} persists
 * the artifact atomically using the
 * `${pid}.${randomUUID()}.tmp` rename pattern shared by the rest of
 * the test-intelligence module.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TEST_CASE_DELTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type IntentDeltaReport,
  type TestCaseDeltaReason,
  type TestCaseDeltaReport,
  type TestCaseDeltaRow,
  type TestCaseDeltaVerdict,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { buildTestCaseFingerprint } from "./test-case-duplicate.js";

/**
 * Canonical filename for the persisted test-case delta artifact.
 * Distinct from `intent-delta-report.json`; the two reports cover
 * different surfaces and are typically written to the same run
 * directory.
 */
export const TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME =
  "test-case-delta-report.json" as const;

export interface ClassifyTestCaseDeltaInput {
  jobId: string;
  generatedAt: string;
  /** Prior generation. May be empty (first run). */
  prior: GeneratedTestCaseList;
  /** Current generation. Source of truth for the per-case verdicts. */
  current: GeneratedTestCaseList;
  /**
   * Current intent IR. Used to detect `obsolete` cases — when every
   * trace screen of a prior case is absent from the current IR's
   * screen set.
   */
  currentIntent: BusinessTestIntentIr;
  /** Optional pre-computed intent delta. When omitted, no delta-driven reasons fire. */
  intentDelta?: IntentDeltaReport;
  /**
   * Optional visual-sidecar validation report for the current run.
   * Used to surface `visual_confidence_dropped` /
   * `visual_ambiguity_increased` reasons; missing sidecar input
   * means visual reasons never fire.
   */
  visual?: VisualSidecarValidationReport;
  /**
   * Below-threshold mean confidence triggers `requires_review`.
   * Defaults to `0.7` (the same conservative bound the validation
   * pipeline uses for `low_confidence`).
   */
  visualConfidenceThreshold?: number;
}

/**
 * Default mean-confidence floor below which a case with a matching
 * visual sidecar record is escalated to `requires_review`.
 */
export const TEST_CASE_DELTA_DEFAULT_VISUAL_CONFIDENCE_FLOOR = 0.7;

/** Pure compare of prior + current generations into a deterministic delta report. */
export const classifyTestCaseDelta = (
  input: ClassifyTestCaseDeltaInput,
): TestCaseDeltaReport => {
  const visualFloor =
    input.visualConfidenceThreshold ??
    TEST_CASE_DELTA_DEFAULT_VISUAL_CONFIDENCE_FLOOR;
  if (visualFloor < 0 || visualFloor > 1) {
    throw new RangeError(
      "classifyTestCaseDelta: visualConfidenceThreshold must be in [0, 1]",
    );
  }

  const priorMap = new Map<string, GeneratedTestCase>();
  for (const tc of input.prior.testCases) priorMap.set(tc.id, tc);
  const currentMap = new Map<string, GeneratedTestCase>();
  for (const tc of input.current.testCases) currentMap.set(tc.id, tc);

  const currentScreenIds = new Set<string>(
    input.currentIntent.screens.map((s) => s.screenId),
  );
  const changedScreenIds = collectChangedScreenIds(input.intentDelta);
  const removedScreenIds = collectRemovedScreenIds(input.intentDelta);
  const ambiguityIncreasedScreenIds = collectAmbiguityIncreasedScreenIds(
    input.intentDelta,
  );
  const visualByScreen = new Map<
    string,
    {
      meanConfidence: number;
      conflict: boolean;
    }
  >();
  if (input.visual !== undefined) {
    for (const r of input.visual.records) {
      visualByScreen.set(r.screenId, {
        meanConfidence: r.meanConfidence,
        conflict: r.outcomes.includes("conflicts_with_figma_metadata"),
      });
    }
  }

  const rows: TestCaseDeltaRow[] = [];
  const seenIds = new Set<string>();

  for (const [id, currentCase] of currentMap.entries()) {
    seenIds.add(id);
    const priorCase = priorMap.get(id);
    rows.push(
      classifyOne({
        id,
        priorCase,
        currentCase,
        currentScreenIds,
        changedScreenIds,
        removedScreenIds,
        ambiguityIncreasedScreenIds,
        visualByScreen,
        visualFloor,
      }),
    );
  }

  for (const [id, priorCase] of priorMap.entries()) {
    if (seenIds.has(id)) continue;
    rows.push(
      classifyOne({
        id,
        priorCase,
        currentCase: undefined,
        currentScreenIds,
        changedScreenIds,
        removedScreenIds,
        ambiguityIncreasedScreenIds,
        visualByScreen,
        visualFloor,
      }),
    );
  }

  rows.sort((a, b) =>
    a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
  );

  const totals = computeTotals(rows);

  return {
    schemaVersion: TEST_CASE_DELTA_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    rows,
    totals,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
  };
};

const collectChangedScreenIds = (
  delta: IntentDeltaReport | undefined,
): Set<string> => {
  const out = new Set<string>();
  if (delta === undefined) return out;
  for (const e of delta.entries) {
    if (e.changeType === "added") continue;
    if (e.changeType === "removed") continue;
    if (e.screenId !== undefined) out.add(e.screenId);
  }
  return out;
};

const collectRemovedScreenIds = (
  delta: IntentDeltaReport | undefined,
): Set<string> => {
  const out = new Set<string>();
  if (delta === undefined) return out;
  for (const e of delta.entries) {
    if (e.kind === "screen" && e.changeType === "removed") {
      out.add(e.elementId);
    }
  }
  return out;
};

const collectAmbiguityIncreasedScreenIds = (
  delta: IntentDeltaReport | undefined,
): Set<string> => {
  const out = new Set<string>();
  if (delta === undefined) return out;
  for (const e of delta.entries) {
    if (e.changeType === "ambiguity_increased" && e.screenId !== undefined) {
      out.add(e.screenId);
    }
  }
  return out;
};

interface ClassifyOneInput {
  id: string;
  priorCase: GeneratedTestCase | undefined;
  currentCase: GeneratedTestCase | undefined;
  currentScreenIds: ReadonlySet<string>;
  changedScreenIds: ReadonlySet<string>;
  removedScreenIds: ReadonlySet<string>;
  ambiguityIncreasedScreenIds: ReadonlySet<string>;
  visualByScreen: ReadonlyMap<
    string,
    { meanConfidence: number; conflict: boolean }
  >;
  visualFloor: number;
}

const classifyOne = (input: ClassifyOneInput): TestCaseDeltaRow => {
  const reasons = new Set<TestCaseDeltaReason>();
  const traceCase = input.currentCase ?? input.priorCase;
  const affectedScreenIds = traceCase
    ? Array.from(
        new Set(traceCase.figmaTraceRefs.map((r) => r.screenId)),
      ).sort()
    : [];

  const priorFingerprintHash = input.priorCase
    ? sha256Hex(Array.from(buildTestCaseFingerprint(input.priorCase)).sort())
    : undefined;
  const currentFingerprintHash = input.currentCase
    ? sha256Hex(Array.from(buildTestCaseFingerprint(input.currentCase)).sort())
    : undefined;

  let verdict: TestCaseDeltaVerdict;

  if (input.currentCase === undefined && input.priorCase !== undefined) {
    // Prior exists, current does not.
    const everyTraceMissing = affectedScreenIds.every(
      (id) => !input.currentScreenIds.has(id),
    );
    if (affectedScreenIds.length > 0 && everyTraceMissing) {
      verdict = "obsolete";
      reasons.add("trace_screen_removed");
    } else {
      // Case is gone from generation but the screens still exist —
      // that's an "absent" change, not yet obsolete. Mark obsolete
      // so the operator can prune; never deletes from QC.
      verdict = "obsolete";
      reasons.add("absent_in_current");
    }
  } else if (input.currentCase !== undefined && input.priorCase === undefined) {
    verdict = "new";
    reasons.add("absent_in_prior");
  } else if (input.currentCase !== undefined && input.priorCase !== undefined) {
    const fingerprintChanged = priorFingerprintHash !== currentFingerprintHash;
    const traceChanged = affectedScreenIds.some((id) =>
      input.changedScreenIds.has(id),
    );
    const traceRemoved = affectedScreenIds.some((id) =>
      input.removedScreenIds.has(id),
    );
    if (traceRemoved) reasons.add("trace_screen_removed");
    if (fingerprintChanged) reasons.add("fingerprint_changed");
    if (traceChanged) reasons.add("trace_screen_changed");
    if (fingerprintChanged || traceChanged || traceRemoved) verdict = "changed";
    else verdict = "unchanged";
  } else {
    // Both undefined — should never happen since we iterate by id.
    verdict = "unchanged";
  }

  // Visual signals always layered on top: even an `unchanged` case
  // can be escalated to `requires_review` when the visual sidecar
  // reports low confidence or a Figma conflict on its trace screens,
  // or when the intent delta records ambiguity growth on a trace screen.
  let escalate = false;
  for (const screenId of affectedScreenIds) {
    const visual = input.visualByScreen.get(screenId);
    if (visual !== undefined) {
      if (visual.meanConfidence < input.visualFloor) {
        reasons.add("visual_confidence_dropped");
        escalate = true;
      }
      if (visual.conflict) {
        reasons.add("reconciliation_conflict");
        escalate = true;
      }
    }
    if (input.ambiguityIncreasedScreenIds.has(screenId)) {
      reasons.add("visual_ambiguity_increased");
      escalate = true;
    }
  }
  if (escalate && verdict !== "obsolete") verdict = "requires_review";

  const row: TestCaseDeltaRow = {
    testCaseId: input.id,
    verdict,
    reasons: Array.from(reasons).sort(),
    affectedScreenIds,
  };
  if (priorFingerprintHash !== undefined)
    row.priorFingerprintHash = priorFingerprintHash;
  if (currentFingerprintHash !== undefined)
    row.currentFingerprintHash = currentFingerprintHash;
  return row;
};

const computeTotals = (
  rows: ReadonlyArray<TestCaseDeltaRow>,
): TestCaseDeltaReport["totals"] => {
  const totals: TestCaseDeltaReport["totals"] = {
    new: 0,
    unchanged: 0,
    changed: 0,
    obsolete: 0,
    requiresReview: 0,
  };
  for (const r of rows) {
    if (r.verdict === "new") totals.new += 1;
    else if (r.verdict === "unchanged") totals.unchanged += 1;
    else if (r.verdict === "changed") totals.changed += 1;
    else if (r.verdict === "obsolete") totals.obsolete += 1;
    else totals.requiresReview += 1;
  }
  return totals;
};

export interface WriteTestCaseDeltaReportInput {
  report: TestCaseDeltaReport;
  destinationDir: string;
}

export interface WriteTestCaseDeltaReportResult {
  artifactPath: string;
}

/**
 * Persist a test-case delta report atomically using the
 * `${pid}.${randomUUID()}.tmp` rename pattern.
 */
export const writeTestCaseDeltaReport = async (
  input: WriteTestCaseDeltaReportInput,
): Promise<WriteTestCaseDeltaReportResult> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.report);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return { artifactPath: path };
};
