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

const canonicalTrim = (value: string): string => value.trim().replace(/\s+/gu, " ");

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
  readonly majorityValue: string | undefined;
  readonly majorityCount: number;
  readonly agreement: number;
}

const voteScalar = (
  values: readonly (string | undefined)[],
  sampleCount: number,
): VoteScalarResult => {
  const counts = new Map<string, { count: number; value: string | undefined }>();
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
  return {
    majorityValue: winner?.value,
    majorityCount,
    agreement:
      sampleCount === 0 ? 0 : Number((majorityCount / sampleCount).toFixed(6)),
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

  for (const [targetKey, samples] of [...targetMap.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const orderedSamples = [...samples].sort(stableCaseSort);
    const sampleByIndex = new Map<number, GeneratedTestCase>();
    for (const sample of orderedSamples) {
      sampleByIndex.set(sample.sampleIndex, sample.testCase);
    }
    const base = cloneCase(orderedSamples[0]!.testCase);
    const votes: SelfConsistencyFieldVote[] = [];

    const typeVote = voteScalar(
      Array.from({ length: sampleCount }, (_, index) =>
        sampleByIndex.get(index)?.type,
      ),
      sampleCount,
    );
    votes.push({
      field: "type",
      agreement: typeVote.agreement,
      majorityCount: typeVote.majorityCount,
      ...(typeVote.majorityValue !== undefined
        ? { majorityValue: typeVote.majorityValue }
        : {}),
    });
    if (typeVote.majorityCount >= threshold && typeVote.majorityValue !== undefined) {
      base.type = typeVote.majorityValue as GeneratedTestCase["type"];
    }

    const techniqueVote = voteScalar(
      Array.from({ length: sampleCount }, (_, index) =>
        sampleByIndex.get(index)?.technique,
      ),
      sampleCount,
    );
    votes.push({
      field: "technique",
      agreement: techniqueVote.agreement,
      majorityCount: techniqueVote.majorityCount,
      ...(techniqueVote.majorityValue !== undefined
        ? { majorityValue: techniqueVote.majorityValue }
        : {}),
    });
    if (
      techniqueVote.majorityCount >= threshold &&
      techniqueVote.majorityValue !== undefined
    ) {
      base.technique =
        techniqueVote.majorityValue as GeneratedTestCase["technique"];
    }

    const riskCategoryVote = voteScalar(
      Array.from({ length: sampleCount }, (_, index) =>
        sampleByIndex.get(index)?.riskCategory,
      ),
      sampleCount,
    );
    votes.push({
      field: "riskCategory",
      agreement: riskCategoryVote.agreement,
      majorityCount: riskCategoryVote.majorityCount,
      ...(riskCategoryVote.majorityValue !== undefined
        ? { majorityValue: riskCategoryVote.majorityValue }
        : {}),
    });
    if (
      riskCategoryVote.majorityCount >= threshold &&
      riskCategoryVote.majorityValue !== undefined
    ) {
      base.riskCategory =
        riskCategoryVote.majorityValue as GeneratedTestCase["riskCategory"];
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
        agreement: actionVote.agreement,
        majorityCount: actionVote.majorityCount,
        ...(actionVote.majorityValue !== undefined
          ? { majorityValue: actionVote.majorityValue }
          : {}),
      });
      if (
        actionVote.majorityCount >= threshold &&
        actionVote.majorityValue !== undefined
      ) {
        if (base.steps[stepIndex] === undefined) {
          base.steps.push({
            index: stepIndex + 1,
            action: actionVote.majorityValue,
          });
        } else {
          base.steps[stepIndex] = {
            ...base.steps[stepIndex]!,
            action: actionVote.majorityValue,
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
        agreement: expectedVote.agreement,
        majorityCount: expectedVote.majorityCount,
        ...(expectedVote.majorityValue !== undefined
          ? { majorityValue: expectedVote.majorityValue }
          : {}),
      });
      if (expectedVote.majorityCount >= threshold && base.steps[stepIndex] !== undefined) {
        base.steps[stepIndex] = {
          ...base.steps[stepIndex]!,
          ...(expectedVote.majorityValue !== undefined
            ? { expected: expectedVote.majorityValue }
            : {}),
        };
      }
    }

    base.steps = base.steps.map((step, index) => ({ ...step, index: index + 1 }));
    const agreement =
      votes.length === 0
        ? 1
        : Number(
            (
              votes.reduce((sum, vote) => sum + vote.agreement, 0) / votes.length
            ).toFixed(6),
          );
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
      disagreement,
      ...(disagreement ? { disagreementRoute: route } : {}),
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
  const bytes = Buffer.from(serializeSelfConsistencyReport(input.report), "utf8");
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, artifactPath);
  return { artifactPath, bytes };
};
