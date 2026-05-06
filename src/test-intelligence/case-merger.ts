/**
 * Parallel-pass case merger (Issue #1937, ti-prod Wave 2).
 *
 * Pairs with the diversity-sampling generator (Issue #1936): when two
 * generation passes emit `GeneratedTestCaseList`s for the same job, the
 * runner needs a deterministic merge step that:
 *
 * 1. Deduplicates near-identical cases via the canonical signature
 *    `(screenId, sorted(coveredFieldIds), sorted(coveredActionIds),
 *    technique)`.
 * 2. Preserves provenance (`runA`, `runB`, or `both`) per merged case.
 * 3. Resolves conflicts deterministically:
 *      - first, prefer the case whose pass produced no `repairInstructions`
 *        for that test-case id (the un-repaired side wins);
 *      - second, fall back to positive bias toward pass A.
 * 4. Merges quality-signal coverage sets across the two passes so the
 *    surviving case carries the union of `coveredFieldIds` and
 *    `coveredActionIds` (and, for completeness, the closed
 *    `coveredValidationIds` / `coveredNavigationIds` companions).
 * 5. Emits a deterministic `case-merger-report.json` audit log.
 *
 * The module deliberately keeps the legacy
 * {@link mergeGeneratedTestCaseLists} signature so existing
 * production-runner call sites (single-result merge consumers) keep
 * compiling without churn — the function now routes through the
 * provenance-aware implementation under the hood.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CASE_MERGER_REPORT_ARTIFACT_FILENAME,
  CASE_MERGER_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CaseMergerConflictResolution,
  type CaseMergerProvenance,
  type CaseMergerReport,
  type CaseMergerReportEntry,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type GeneratedTestCaseQualitySignals,
  type RepairInstruction,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/** Sentinel screen id used when a test case carries no `figmaTraceRefs`. */
const NO_SCREEN_SENTINEL = "__no_screen__" as const;

const sortedUnique = (values: ReadonlyArray<string>): string[] =>
  Array.from(new Set(values)).sort();

/**
 * Derive the canonical screen id for a test case. We prefer the lowest
 * `screenId` from `figmaTraceRefs` (sorted lexicographically) so two passes
 * that traverse refs in different orders still hash to the same signature.
 *
 * Cases without trace refs collapse onto a stable sentinel so they still
 * participate in deduplication via the rest of the signature tuple.
 */
const deriveCanonicalScreenId = (testCase: GeneratedTestCase): string => {
  const screenIds = sortedUnique(
    testCase.figmaTraceRefs.map((ref) => ref.screenId),
  );
  return screenIds[0] ?? NO_SCREEN_SENTINEL;
};

/**
 * Compute the per-case dedup signature
 * `(screenId, sorted(coveredFieldIds), sorted(coveredActionIds), technique)`.
 */
export const buildCaseMergerSignature = (
  testCase: GeneratedTestCase,
): string =>
  canonicalJson({
    screenId: deriveCanonicalScreenId(testCase),
    technique: testCase.technique,
    coveredFieldIds: sortedUnique(testCase.qualitySignals.coveredFieldIds),
    coveredActionIds: sortedUnique(testCase.qualitySignals.coveredActionIds),
  });

interface IndexedTestCase {
  readonly index: number;
  readonly testCase: GeneratedTestCase;
  readonly signature: string;
}

const indexBySignature = (
  list: GeneratedTestCaseList,
): {
  bySignature: Map<string, IndexedTestCase>;
  ordered: readonly IndexedTestCase[];
} => {
  const bySignature = new Map<string, IndexedTestCase>();
  const ordered: IndexedTestCase[] = [];
  list.testCases.forEach((testCase, index) => {
    const signature = buildCaseMergerSignature(testCase);
    const entry: IndexedTestCase = { index, testCase, signature };
    ordered.push(entry);
    if (!bySignature.has(signature)) {
      // First-wins: an intra-list duplicate keeps the earliest occurrence
      // so the merger output is stable across input orderings.
      bySignature.set(signature, entry);
    }
  });
  return { bySignature, ordered };
};

const collectRepairTargets = (
  instructions: ReadonlyArray<RepairInstruction> | undefined,
): ReadonlySet<string> => {
  const ids = new Set<string>();
  if (instructions === undefined) return ids;
  for (const instruction of instructions) {
    if (instruction.testCaseId.length === 0) continue;
    ids.add(instruction.testCaseId);
  }
  return ids;
};

const mergeQualitySignalCoverage = (
  primary: GeneratedTestCaseQualitySignals,
  secondary: GeneratedTestCaseQualitySignals,
): {
  signals: GeneratedTestCaseQualitySignals;
  coverageGrew: boolean;
} => {
  const mergedFields = sortedUnique([
    ...primary.coveredFieldIds,
    ...secondary.coveredFieldIds,
  ]);
  const mergedActions = sortedUnique([
    ...primary.coveredActionIds,
    ...secondary.coveredActionIds,
  ]);
  const mergedValidations = sortedUnique([
    ...primary.coveredValidationIds,
    ...secondary.coveredValidationIds,
  ]);
  const mergedNavigations = sortedUnique([
    ...primary.coveredNavigationIds,
    ...secondary.coveredNavigationIds,
  ]);
  const coverageGrew =
    mergedFields.length > primary.coveredFieldIds.length ||
    mergedActions.length > primary.coveredActionIds.length ||
    mergedValidations.length > primary.coveredValidationIds.length ||
    mergedNavigations.length > primary.coveredNavigationIds.length;
  const merged: GeneratedTestCaseQualitySignals = {
    ...primary,
    coveredFieldIds: mergedFields,
    coveredActionIds: mergedActions,
    coveredValidationIds: mergedValidations,
    coveredNavigationIds: mergedNavigations,
  };
  return { signals: merged, coverageGrew };
};

const cloneCase = (testCase: GeneratedTestCase): GeneratedTestCase => ({
  ...testCase,
  qualitySignals: { ...testCase.qualitySignals },
});

const stableTestCaseSort = (
  a: GeneratedTestCase,
  b: GeneratedTestCase,
): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Optional repair-instruction context used for conflict resolution. When
 * absent for a pass, that pass is treated as having no repair targets.
 */
export interface CaseMergerRepairContext {
  readonly runA?: ReadonlyArray<RepairInstruction>;
  readonly runB?: ReadonlyArray<RepairInstruction>;
}

export interface MergeGeneratedTestCaseListsWithProvenanceInput {
  readonly lists: readonly [GeneratedTestCaseList, GeneratedTestCaseList];
  /**
   * ISO-8601 timestamp recorded onto the report. Callers should pass the
   * same `generatedAt` they thread through the rest of the production
   * runner so the artifact stays byte-stable across replay-cache hits.
   */
  readonly generatedAt: string;
  /** Optional repair context driving conflict-resolution rule 1. */
  readonly repairs?: CaseMergerRepairContext;
}

export interface MergeGeneratedTestCaseListsWithProvenanceResult {
  readonly merged: GeneratedTestCaseList;
  readonly report: CaseMergerReport;
}

interface ConflictDecision {
  readonly winner: IndexedTestCase;
  readonly loser: IndexedTestCase;
  readonly resolution: Exclude<CaseMergerConflictResolution, "no_conflict">;
}

const decideConflict = (
  runA: IndexedTestCase,
  runB: IndexedTestCase,
  repairsA: ReadonlySet<string>,
  repairsB: ReadonlySet<string>,
): ConflictDecision => {
  const aHasRepair = repairsA.has(runA.testCase.id);
  const bHasRepair = repairsB.has(runB.testCase.id);
  // Rule 1: prefer the un-repaired side. The "un-repaired" case is the one
  // *without* a repair instruction (the judge accepted it as-is).
  if (aHasRepair && !bHasRepair) {
    return { winner: runB, loser: runA, resolution: "prefer_unrepaired" };
  }
  if (bHasRepair && !aHasRepair) {
    return { winner: runA, loser: runB, resolution: "prefer_unrepaired" };
  }
  // Rule 2: positive bias toward pass A.
  return { winner: runA, loser: runB, resolution: "positive_bias_run_a" };
};

const buildEntry = (
  winner: IndexedTestCase,
  provenance: CaseMergerProvenance,
  resolution: CaseMergerConflictResolution,
  droppedTestCaseId: string | undefined,
  qualitySignalsCoverageMerged: boolean,
  qualitySignalsForReport: GeneratedTestCaseQualitySignals,
): CaseMergerReportEntry => ({
  testCaseId: winner.testCase.id,
  provenance,
  signature: winner.signature,
  technique: winner.testCase.technique,
  screenId: deriveCanonicalScreenId(winner.testCase),
  coveredFieldIds: sortedUnique(qualitySignalsForReport.coveredFieldIds),
  coveredActionIds: sortedUnique(qualitySignalsForReport.coveredActionIds),
  conflictResolution: resolution,
  ...(droppedTestCaseId !== undefined ? { droppedTestCaseId } : {}),
  qualitySignalsCoverageMerged,
});

/**
 * Deterministic merge of two parallel-pass `GeneratedTestCaseList`s.
 *
 * The two lists MUST share `jobId`. `schemaVersion` is a closed string
 * literal at the type level so a divergence cannot reach this function
 * without a hard cast — the contract invariant is enforced by the
 * compiler. The result is sorted by test-case id so it is byte-stable
 * regardless of input order within each pass.
 */
export const mergeGeneratedTestCaseListsWithProvenance = (
  input: MergeGeneratedTestCaseListsWithProvenanceInput,
): MergeGeneratedTestCaseListsWithProvenanceResult => {
  const [runA, runB] = input.lists;
  if (runA.jobId !== runB.jobId) {
    throw new RangeError(
      "mergeGeneratedTestCaseListsWithProvenance: lists must share the same jobId",
    );
  }
  if (typeof input.generatedAt !== "string" || input.generatedAt.length === 0) {
    throw new TypeError(
      "mergeGeneratedTestCaseListsWithProvenance: generatedAt must be a non-empty string",
    );
  }

  const indexedA = indexBySignature(runA);
  const indexedB = indexBySignature(runB);

  const repairsA = collectRepairTargets(input.repairs?.runA);
  const repairsB = collectRepairTargets(input.repairs?.runB);

  const mergedCases: GeneratedTestCase[] = [];
  const entries: CaseMergerReportEntry[] = [];
  const consumedFromB = new Set<string>();

  let conflictsResolvedByRepair = 0;
  let conflictsResolvedByPositiveBias = 0;

  // Walk pass A first (positive bias preserves A's ordering as the
  // primary tie-breaker). For each A entry, look up the matching B entry
  // by signature.
  for (const entryA of indexedA.ordered) {
    // Skip intra-list duplicates inside pass A: only the first occurrence
    // of each signature drives the merge.
    if (indexedA.bySignature.get(entryA.signature) !== entryA) {
      continue;
    }
    const matchB = indexedB.bySignature.get(entryA.signature);
    if (matchB === undefined) {
      mergedCases.push(cloneCase(entryA.testCase));
      entries.push(
        buildEntry(
          entryA,
          "runA",
          "no_conflict",
          undefined,
          false,
          entryA.testCase.qualitySignals,
        ),
      );
      continue;
    }

    consumedFromB.add(matchB.signature);
    const decision = decideConflict(entryA, matchB, repairsA, repairsB);
    if (decision.resolution === "prefer_unrepaired") {
      conflictsResolvedByRepair += 1;
    } else {
      conflictsResolvedByPositiveBias += 1;
    }
    const winnerCounterpart =
      decision.winner === entryA ? matchB : entryA;
    const mergedSignals = mergeQualitySignalCoverage(
      decision.winner.testCase.qualitySignals,
      winnerCounterpart.testCase.qualitySignals,
    );
    const mergedCase: GeneratedTestCase = {
      ...cloneCase(decision.winner.testCase),
      qualitySignals: mergedSignals.signals,
    };
    mergedCases.push(mergedCase);
    entries.push(
      buildEntry(
        decision.winner,
        "both",
        decision.resolution,
        decision.loser.testCase.id,
        mergedSignals.coverageGrew,
        mergedSignals.signals,
      ),
    );
  }

  // Pass B leftovers — entries whose signature did not appear in A.
  for (const entryB of indexedB.ordered) {
    if (indexedB.bySignature.get(entryB.signature) !== entryB) continue;
    if (consumedFromB.has(entryB.signature)) continue;
    if (indexedA.bySignature.has(entryB.signature)) continue;
    mergedCases.push(cloneCase(entryB.testCase));
    entries.push(
      buildEntry(
        entryB,
        "runB",
        "no_conflict",
        undefined,
        false,
        entryB.testCase.qualitySignals,
      ),
    );
  }

  mergedCases.sort(stableTestCaseSort);
  entries.sort((a, b) =>
    a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
  );

  const onlyInRunA = entries.filter((e) => e.provenance === "runA").length;
  const onlyInRunB = entries.filter((e) => e.provenance === "runB").length;
  const inBoth = entries.filter((e) => e.provenance === "both").length;

  const report: CaseMergerReport = {
    schemaVersion: CASE_MERGER_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: runA.jobId,
    generatedAt: input.generatedAt,
    totals: {
      runACount: runA.testCases.length,
      runBCount: runB.testCases.length,
      mergedCount: mergedCases.length,
      onlyInRunA,
      onlyInRunB,
      inBoth,
      conflictsResolvedByRepair,
      conflictsResolvedByPositiveBias,
    },
    entries,
  };

  return {
    merged: {
      schemaVersion: runA.schemaVersion,
      jobId: runA.jobId,
      testCases: mergedCases,
    },
    report,
  };
};

/**
 * Legacy single-output entrypoint preserved for the production-runner
 * call sites that pre-date Issue #1937. New callers should prefer
 * {@link mergeGeneratedTestCaseListsWithProvenance} so the
 * `case-merger-report.json` artifact can be persisted alongside the merged
 * list.
 */
export const mergeGeneratedTestCaseLists = (
  lists: readonly [GeneratedTestCaseList, GeneratedTestCaseList],
): GeneratedTestCaseList =>
  mergeGeneratedTestCaseListsWithProvenance({
    lists,
    generatedAt: "1970-01-01T00:00:00.000Z",
  }).merged;

export interface WriteCaseMergerReportInput {
  readonly report: CaseMergerReport;
  readonly destinationDir: string;
}

export interface WriteCaseMergerReportResult {
  readonly artifactPath: string;
}

/**
 * Persist a {@link CaseMergerReport} atomically using the standard
 * `${pid}.${randomUUID()}.tmp` rename pattern shared by every other
 * test-intelligence artifact writer.
 */
export const writeCaseMergerReport = async (
  input: WriteCaseMergerReportInput,
): Promise<WriteCaseMergerReportResult> => {
  if (
    typeof input.destinationDir !== "string" ||
    input.destinationDir.length === 0
  ) {
    throw new TypeError(
      "writeCaseMergerReport: destinationDir must be a non-empty string",
    );
  }
  await mkdir(input.destinationDir, { recursive: true });
  const artifactPath = join(
    input.destinationDir,
    CASE_MERGER_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.report);
  const tmp = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, artifactPath);
  return { artifactPath };
};
