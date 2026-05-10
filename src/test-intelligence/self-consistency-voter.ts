import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME,
  SELF_CONSISTENCY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type GeneratedTestCaseQualitySignals,
  type SelfConsistencyDisagreementRoute,
  type SelfConsistencyFieldVote,
  type SelfConsistencyReport,
  type SelfConsistencyTargetReportEntry,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const canonicalTrim = (value: string): string =>
  value.trim().replace(/\s+/gu, " ");

const uniqueSorted = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

const deriveTargetKey = (testCase: GeneratedTestCase): string =>
  canonicalJson({
    screenIds: uniqueSorted(testCase.figmaTraceRefs.map((ref) => ref.screenId)),
    coveredFieldIds: uniqueSorted(testCase.qualitySignals.coveredFieldIds),
    coveredActionIds: uniqueSorted(testCase.qualitySignals.coveredActionIds),
    coveredValidationIds: uniqueSorted(
      testCase.qualitySignals.coveredValidationIds,
    ),
    coveredNavigationIds: uniqueSorted(
      testCase.qualitySignals.coveredNavigationIds,
    ),
  });

const cloneQualitySignals = (
  signals: GeneratedTestCaseQualitySignals,
): GeneratedTestCaseQualitySignals => ({
  ...signals,
  coveredFieldIds: [...signals.coveredFieldIds],
  coveredActionIds: [...signals.coveredActionIds],
  coveredValidationIds: [...signals.coveredValidationIds],
  coveredNavigationIds: [...signals.coveredNavigationIds],
  ...(signals.ambiguity !== undefined ? { ambiguity: signals.ambiguity } : {}),
});

const cloneCase = (testCase: GeneratedTestCase): GeneratedTestCase => ({
  ...testCase,
  preconditions: [...testCase.preconditions],
  testData: [...testCase.testData],
  steps: testCase.steps.map((step) => ({ ...step })),
  expectedResults: [...testCase.expectedResults],
  figmaTraceRefs: testCase.figmaTraceRefs.map((ref) => ({ ...ref })),
  assumptions: [...testCase.assumptions],
  openQuestions: [...testCase.openQuestions],
  qcMappingPreview: { ...testCase.qcMappingPreview },
  qualitySignals: cloneQualitySignals(testCase.qualitySignals),
  audit: { ...testCase.audit },
  ...(testCase.regulatoryRelevance !== undefined
    ? { regulatoryRelevance: { ...testCase.regulatoryRelevance } }
    : {}),
});

interface IndexedCase {
  readonly sampleIndex: number;
  readonly testCase: GeneratedTestCase;
}

interface VoteScalarResult {
  readonly winner: string | undefined;
  readonly majorityCount: number;
  readonly agreementRate: number;
  readonly confidenceInterval95: readonly [number, number];
  readonly bootstrapSampleSize: number;
  readonly consensusStrength: "strong_consensus" | "weak_consensus";
}

const SELF_CONSISTENCY_WEAK_LOWER_BOUND_THRESHOLD = 0.6;
const WILSON_Z_95 = 1.959963984540054;
const roundAgreement = (value: number): number => Number(value.toFixed(6));
const roundInterval = (low: number, high: number): readonly [number, number] =>
  [Number(low.toFixed(6)), Number(high.toFixed(6))] as const;

const wilsonInterval95 = (
  successCount: number,
  sampleSize: number,
): readonly [number, number] => {
  if (sampleSize <= 0) {
    return [0, 0] as const;
  }
  const z2 = WILSON_Z_95 ** 2;
  const denominator = 1 + z2 / sampleSize;
  const center =
    (successCount / sampleSize + z2 / (2 * sampleSize)) / denominator;
  const margin =
    (WILSON_Z_95 / denominator) *
    Math.sqrt(
      (successCount * (sampleSize - successCount)) / sampleSize ** 3 +
        z2 / (4 * sampleSize ** 2),
    );
  return roundInterval(
    Math.max(0, center - margin),
    Math.min(1, center + margin),
  );
};

const voteScalar = (
  values: readonly (string | undefined)[],
  sampleCount: number,
): VoteScalarResult => {
  const counts = new Map<
    string,
    { count: number; value: string | undefined }
  >();
  for (const value of values) {
    const key = value === undefined ? "__undefined__" : value;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { count: 1, value });
    } else {
      existing.count += 1;
    }
  }
  let winner:
    | {
        readonly count: number;
        readonly value: string | undefined;
      }
    | undefined;
  for (const candidate of counts.values()) {
    if (
      winner === undefined ||
      candidate.count > winner.count ||
      (candidate.count === winner.count &&
        (candidate.value ?? "").localeCompare(winner.value ?? "") < 0)
    ) {
      winner = candidate;
    }
  }
  const majorityCount = winner?.count ?? 0;
  const agreementRate =
    sampleCount === 0 ? 0 : roundAgreement(majorityCount / sampleCount);
  const confidenceInterval95 = wilsonInterval95(majorityCount, sampleCount);
  const consensusStrength =
    sampleCount === 3 &&
    majorityCount >= majorityThreshold(sampleCount) &&
    majorityCount < sampleCount &&
    confidenceInterval95[0] < SELF_CONSISTENCY_WEAK_LOWER_BOUND_THRESHOLD
      ? "weak_consensus"
      : "strong_consensus";
  return {
    winner: winner?.value,
    majorityCount,
    agreementRate,
    confidenceInterval95,
    bootstrapSampleSize: sampleCount,
    consensusStrength,
  };
};

const majorityThreshold = (sampleCount: number): number =>
  Math.floor(sampleCount / 2) + 1;

const stableCaseSort = (left: IndexedCase, right: IndexedCase): number => {
  if (left.sampleIndex !== right.sampleIndex) {
    return left.sampleIndex - right.sampleIndex;
  }
  return left.testCase.id.localeCompare(right.testCase.id);
};

export interface VoteGeneratedTestCaseSamplesInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly lists: readonly GeneratedTestCaseList[];
  readonly disagreementRoute?: SelfConsistencyDisagreementRoute;
  readonly arbitrationTriggered?: boolean;
}

export interface VoteGeneratedTestCaseSamplesResult {
  readonly merged: GeneratedTestCaseList;
  readonly report: SelfConsistencyReport;
}

const buildDisagreementMarker = (
  targetKey: string,
  votes: readonly SelfConsistencyFieldVote[],
  route: SelfConsistencyDisagreementRoute,
): string => {
  const disputed = votes
    .filter((vote) => vote.majorityCount < 2)
    .map((vote) =>
      vote.stepIndex === undefined
        ? vote.field
        : `${vote.field}[${vote.stepIndex}]`,
    )
    .join(", ");
  return `self_consistency_disagreement: route=${route}; target=${targetKey}; fields=${disputed}`;
};

export const voteGeneratedTestCaseSamples = (
  input: VoteGeneratedTestCaseSamplesInput,
): VoteGeneratedTestCaseSamplesResult => {
  if (input.lists.length === 0) {
    throw new TypeError(
      "voteGeneratedTestCaseSamples: lists must contain at least one sample",
    );
  }
  const sampleCount = input.lists.length;
  const targetMap = new Map<string, IndexedCase[]>();
  input.lists.forEach((list, sampleIndex) => {
    if (list.jobId !== input.jobId) {
      throw new TypeError(
        `voteGeneratedTestCaseSamples: sample[${sampleIndex}] jobId "${list.jobId}" does not match "${input.jobId}"`,
      );
    }
    const seenInSample = new Set<string>();
    const ordered = [...list.testCases].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (const testCase of ordered) {
      const targetKey = deriveTargetKey(testCase);
      if (seenInSample.has(targetKey)) continue;
      seenInSample.add(targetKey);
      const group = targetMap.get(targetKey);
      const entry: IndexedCase = { sampleIndex, testCase };
      if (group === undefined) {
        targetMap.set(targetKey, [entry]);
      } else {
        group.push(entry);
      }
    }
  });

  const route = input.disagreementRoute ?? "human_review";
  const targetReports: SelfConsistencyTargetReportEntry[] = [];
  const mergedCases: GeneratedTestCase[] = [];
  const threshold = majorityThreshold(sampleCount);

  for (const [targetKey, samples] of [...targetMap.entries()].sort(
    (left, right) => left[0].localeCompare(right[0]),
  )) {
    const orderedSamples = [...samples].sort(stableCaseSort);
    const sampleByIndex = new Map<number, GeneratedTestCase>();
    for (const sample of orderedSamples) {
      sampleByIndex.set(sample.sampleIndex, sample.testCase);
    }
    const base = cloneCase(orderedSamples[0]!.testCase);
    const votes: SelfConsistencyFieldVote[] = [];

    const typeVote = voteScalar(
      Array.from(
        { length: sampleCount },
        (_, index) => sampleByIndex.get(index)?.type,
      ),
      sampleCount,
    );
    votes.push({
      field: "type",
      agreement: typeVote.agreementRate,
      agreementRate: typeVote.agreementRate,
      confidenceInterval95: typeVote.confidenceInterval95,
      bootstrapSampleSize: typeVote.bootstrapSampleSize,
      consensusStrength: typeVote.consensusStrength,
      ...(typeVote.winner !== undefined ? { winner: typeVote.winner } : {}),
      majorityCount: typeVote.majorityCount,
      ...(typeVote.winner !== undefined
        ? { majorityValue: typeVote.winner }
        : {}),
    });
    if (typeVote.majorityCount >= threshold && typeVote.winner !== undefined) {
      base.type = typeVote.winner as GeneratedTestCase["type"];
    }

    const techniqueVote = voteScalar(
      Array.from(
        { length: sampleCount },
        (_, index) => sampleByIndex.get(index)?.technique,
      ),
      sampleCount,
    );
    votes.push({
      field: "technique",
      agreement: techniqueVote.agreementRate,
      agreementRate: techniqueVote.agreementRate,
      confidenceInterval95: techniqueVote.confidenceInterval95,
      bootstrapSampleSize: techniqueVote.bootstrapSampleSize,
      consensusStrength: techniqueVote.consensusStrength,
      ...(techniqueVote.winner !== undefined
        ? { winner: techniqueVote.winner }
        : {}),
      majorityCount: techniqueVote.majorityCount,
      ...(techniqueVote.winner !== undefined
        ? { majorityValue: techniqueVote.winner }
        : {}),
    });
    if (
      techniqueVote.majorityCount >= threshold &&
      techniqueVote.winner !== undefined
    ) {
      base.technique = techniqueVote.winner as GeneratedTestCase["technique"];
    }

    const riskCategoryVote = voteScalar(
      Array.from(
        { length: sampleCount },
        (_, index) => sampleByIndex.get(index)?.riskCategory,
      ),
      sampleCount,
    );
    votes.push({
      field: "riskCategory",
      agreement: riskCategoryVote.agreementRate,
      agreementRate: riskCategoryVote.agreementRate,
      confidenceInterval95: riskCategoryVote.confidenceInterval95,
      bootstrapSampleSize: riskCategoryVote.bootstrapSampleSize,
      consensusStrength: riskCategoryVote.consensusStrength,
      ...(riskCategoryVote.winner !== undefined
        ? { winner: riskCategoryVote.winner }
        : {}),
      majorityCount: riskCategoryVote.majorityCount,
      ...(riskCategoryVote.winner !== undefined
        ? { majorityValue: riskCategoryVote.winner }
        : {}),
    });
    if (
      riskCategoryVote.majorityCount >= threshold &&
      riskCategoryVote.winner !== undefined
    ) {
      base.riskCategory =
        riskCategoryVote.winner as GeneratedTestCase["riskCategory"];
    }

    const maxStepCount = Math.max(
      ...orderedSamples.map((sample) => sample.testCase.steps.length),
      0,
    );
    for (let stepIndex = 0; stepIndex < maxStepCount; stepIndex += 1) {
      const actionVote = voteScalar(
        Array.from({ length: sampleCount }, (_, index) => {
          const step = sampleByIndex.get(index)?.steps[stepIndex];
          return step === undefined ? undefined : canonicalTrim(step.action);
        }),
        sampleCount,
      );
      votes.push({
        field: "step_action",
        stepIndex,
        agreement: actionVote.agreementRate,
        agreementRate: actionVote.agreementRate,
        confidenceInterval95: actionVote.confidenceInterval95,
        bootstrapSampleSize: actionVote.bootstrapSampleSize,
        consensusStrength: actionVote.consensusStrength,
        ...(actionVote.winner !== undefined
          ? { winner: actionVote.winner }
          : {}),
        majorityCount: actionVote.majorityCount,
        ...(actionVote.winner !== undefined
          ? { majorityValue: actionVote.winner }
          : {}),
      });
      if (
        actionVote.majorityCount >= threshold &&
        actionVote.winner !== undefined
      ) {
        if (base.steps[stepIndex] === undefined) {
          base.steps.push({
            index: stepIndex + 1,
            action: actionVote.winner,
          });
        } else {
          base.steps[stepIndex] = {
            ...base.steps[stepIndex]!,
            action: actionVote.winner,
          };
        }
      }

      const expectedVote = voteScalar(
        Array.from({ length: sampleCount }, (_, index) => {
          const expected = sampleByIndex.get(index)?.steps[stepIndex]?.expected;
          return expected === undefined ? undefined : canonicalTrim(expected);
        }),
        sampleCount,
      );
      votes.push({
        field: "step_expected",
        stepIndex,
        agreement: expectedVote.agreementRate,
        agreementRate: expectedVote.agreementRate,
        confidenceInterval95: expectedVote.confidenceInterval95,
        bootstrapSampleSize: expectedVote.bootstrapSampleSize,
        consensusStrength: expectedVote.consensusStrength,
        ...(expectedVote.winner !== undefined
          ? { winner: expectedVote.winner }
          : {}),
        majorityCount: expectedVote.majorityCount,
        ...(expectedVote.winner !== undefined
          ? { majorityValue: expectedVote.winner }
          : {}),
      });
      if (
        expectedVote.majorityCount >= threshold &&
        base.steps[stepIndex] !== undefined
      ) {
        base.steps[stepIndex] = {
          ...base.steps[stepIndex]!,
          ...(expectedVote.winner !== undefined
            ? { expected: expectedVote.winner }
            : {}),
        };
      }
    }

    base.steps = base.steps.map((step, index) => ({
      ...step,
      index: index + 1,
    }));
    const agreement =
      votes.length === 0
        ? 1
        : Number(
            (
              votes.reduce((sum, vote) => sum + vote.agreementRate, 0) /
              votes.length
            ).toFixed(6),
          );
    const consensusStrength = votes.some(
      (vote) => vote.consensusStrength === "weak_consensus",
    )
      ? "weak_consensus"
      : "strong_consensus";
    const disagreement = votes.some((vote) => vote.majorityCount < threshold);
    if (disagreement) {
      base.reviewState = "needs_review";
      const marker = buildDisagreementMarker(targetKey, votes, route);
      if (!base.openQuestions.includes(marker)) {
        base.openQuestions.push(marker);
      }
    }
    base.qualitySignals.confidence = Math.min(
      base.qualitySignals.confidence,
      agreement,
    );
    mergedCases.push(base);
    targetReports.push({
      targetKey,
      selectedTestCaseId: base.id,
      samplePresenceCount: orderedSamples.length,
      agreement,
      consensusStrength,
      disagreement,
      ...(disagreement ? { disagreementRoute: route } : {}),
      ...(input.arbitrationTriggered ? { arbitrationTriggered: true } : {}),
      votes,
    });
  }

  mergedCases.sort((left, right) => left.id.localeCompare(right.id));
  const report: SelfConsistencyReport = {
    schemaVersion: SELF_CONSISTENCY_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    sampleCount,
    selfConsistencyAgreement:
      targetReports.length === 0
        ? 1
        : Number(
            (
              targetReports.reduce((sum, target) => sum + target.agreement, 0) /
              targetReports.length
            ).toFixed(6),
          ),
    targets: targetReports,
  };
  return {
    merged: {
      schemaVersion: input.lists[0]!.schemaVersion,
      jobId: input.jobId,
      testCases: mergedCases,
    },
    report,
  };
};

export const serializeSelfConsistencyReport = (
  report: SelfConsistencyReport,
): string => `${canonicalJson(report)}\n`;

export interface WriteSelfConsistencyReportInput {
  readonly runDir: string;
  readonly report: SelfConsistencyReport;
}

export interface WriteSelfConsistencyReportResult {
  readonly artifactPath: string;
  readonly bytes: Buffer;
}

export const writeSelfConsistencyReport = async (
  input: WriteSelfConsistencyReportInput,
): Promise<WriteSelfConsistencyReportResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeSelfConsistencyReport: runDir must be a non-empty string",
    );
  }
  const artifactPath = join(
    input.runDir,
    SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${randomUUID()}.tmp`;
  const bytes = Buffer.from(
    serializeSelfConsistencyReport(input.report),
    "utf8",
  );
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, artifactPath);
  return { artifactPath, bytes };
};
