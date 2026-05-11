import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  GeneratedTestCase,
  GeneratedTestCaseList,
  GeneratedTestCaseReviewState,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type {
  ConsolidatedFinding,
  RepairChangeTarget,
} from "./finding-consolidator.js";

export const REPAIR_PLANNER_SCHEMA_VERSION = "1.0.0" as const;
export const REPAIR_PLANNER_ARTIFACT_FILENAME = "repair-plan.json" as const;
export const DEFAULT_REPAIR_PLANNER_ITERATIONS = 2 as const;
export const MAX_REPAIR_PLANNER_ITERATIONS = 3 as const;

export interface RepairChangeGuard {
  readonly testCaseId: string;
  readonly expectedCurrentHash: string;
  readonly findingIds: readonly string[];
  readonly allowedChange:
    | "steps"
    | "expected_result"
    | "test_data"
    | "traceability"
    | "metadata";
}

export interface RepairPlanItem {
  readonly guard: RepairChangeGuard;
  readonly summary: string;
  readonly patch: {
    readonly appendExpectedResults?: readonly string[];
    readonly appendOpenQuestions?: readonly string[];
    readonly appendSteps?: readonly {
      readonly action: string;
      readonly data?: string;
      readonly expected?: string;
    }[];
    readonly appendTestData?: readonly string[];
    readonly setReviewState?: GeneratedTestCaseReviewState;
  };
}

export interface RepairPlanRefusal {
  readonly code:
    | "repair_case_not_found"
    | "repair_case_sticky_accepted"
    | "repair_change_guard_refused"
    | "repair_hash_mismatch_refused";
  readonly findingIds: readonly string[];
  readonly testCaseId?: string;
  readonly detail: string;
}

export interface RepairPlan {
  readonly schemaVersion: typeof REPAIR_PLANNER_SCHEMA_VERSION;
  readonly iterationCount: number;
  readonly outcome: "planned" | "needs_review";
  readonly items: readonly RepairPlanItem[];
  readonly refusals: readonly RepairPlanRefusal[];
}

export interface BuildRepairPlanInput {
  readonly list: GeneratedTestCaseList;
  readonly findings: readonly ConsolidatedFinding[];
  readonly acceptedCaseIds?: ReadonlySet<string>;
  readonly iterationCount?: number;
}

export interface ApplyRepairPlanResult {
  readonly outcome: "applied" | "needs_review";
  readonly list: GeneratedTestCaseList;
  readonly refusals: readonly RepairPlanRefusal[];
}

const CHANGE_TARGET_PRIORITY: Readonly<Record<RepairChangeTarget, number>> =
  Object.freeze({
    expected_result: 0,
    metadata: 1,
    steps: 2,
    test_data: 3,
    traceability: 4,
  });

export const resolveRepairPlannerIterationCount = (
  iterationCount: number | undefined,
): number => {
  const resolved = iterationCount ?? DEFAULT_REPAIR_PLANNER_ITERATIONS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new RangeError("iterationCount must be an integer >= 1");
  }
  return Math.min(resolved, MAX_REPAIR_PLANNER_ITERATIONS);
};

export const computeGeneratedTestCaseRepairHash = (
  testCase: GeneratedTestCase,
): string => sha256Hex(testCase);

export const buildRepairPlan = (input: BuildRepairPlanInput): RepairPlan => {
  const acceptedCaseIds = input.acceptedCaseIds ?? new Set<string>();
  const iterationCount = resolveRepairPlannerIterationCount(
    input.iterationCount,
  );
  const planItemsByKey = new Map<string, RepairPlanItem>();
  const refusals: RepairPlanRefusal[] = [];

  for (const finding of [...input.findings].sort(compareFindings)) {
    const testCase = selectTargetCase(
      input.list.testCases,
      finding,
      acceptedCaseIds,
    );
    if (testCase === undefined) {
      refusals.push({
        code: "repair_case_not_found",
        findingIds: [finding.findingId],
        detail: `No mutable case available for finding ${finding.findingId}.`,
      });
      continue;
    }
    if (acceptedCaseIds.has(testCase.id)) {
      refusals.push({
        code: "repair_case_sticky_accepted",
        findingIds: [finding.findingId],
        testCaseId: testCase.id,
        detail: `Accepted case ${testCase.id} must remain unchanged.`,
      });
      continue;
    }
    const item = buildPlanItem(testCase, finding);
    const planKey = `${item.guard.testCaseId}:${item.guard.allowedChange}`;
    const existing = planItemsByKey.get(planKey);
    if (existing === undefined) {
      planItemsByKey.set(planKey, item);
    } else {
      planItemsByKey.set(planKey, mergePlanItems(existing, item));
    }
  }

  return {
    schemaVersion: REPAIR_PLANNER_SCHEMA_VERSION,
    iterationCount,
    outcome: refusals.length === 0 ? "planned" : "needs_review",
    items: [...planItemsByKey.values()].sort(comparePlanItems),
    refusals: refusals.sort(compareRefusals),
  };
};

export const applyRepairPlan = (input: {
  readonly list: GeneratedTestCaseList;
  readonly plan: RepairPlan;
  readonly acceptedCaseIds?: ReadonlySet<string>;
}): ApplyRepairPlanResult => {
  const acceptedCaseIds = input.acceptedCaseIds ?? new Set<string>();
  const byId = new Map(
    input.list.testCases.map((testCase) => [testCase.id, testCase] as const),
  );
  const refusals = [...input.plan.refusals];
  const itemsByCaseId = new Map<string, RepairPlanItem[]>();

  for (const item of input.plan.items) {
    const existing = itemsByCaseId.get(item.guard.testCaseId);
    if (existing === undefined) {
      itemsByCaseId.set(item.guard.testCaseId, [item]);
    } else {
      existing.push(item);
    }
  }

  for (const [testCaseId, items] of itemsByCaseId) {
    const current = byId.get(testCaseId);
    if (current === undefined) {
      for (const item of items) {
        refusals.push({
          code: "repair_case_not_found",
          findingIds: [...item.guard.findingIds],
          testCaseId,
          detail: `Case ${testCaseId} no longer exists.`,
        });
      }
      continue;
    }
    if (acceptedCaseIds.has(current.id)) {
      for (const item of items) {
        refusals.push({
          code: "repair_case_sticky_accepted",
          findingIds: [...item.guard.findingIds],
          testCaseId: current.id,
          detail: `Accepted case ${current.id} must remain unchanged.`,
        });
      }
      continue;
    }
    const currentHash = computeGeneratedTestCaseRepairHash(current);
    const guardFailure = items.find((item) => {
      const mismatch = currentHash !== item.guard.expectedCurrentHash;
      const patchInvalid = !isPatchAllowed(item);
      return mismatch || patchInvalid;
    });
    if (guardFailure !== undefined) {
      for (const item of items) {
        const patchInvalid = !isPatchAllowed(item);
        refusals.push({
          code: patchInvalid
            ? "repair_change_guard_refused"
            : "repair_hash_mismatch_refused",
          findingIds: [...item.guard.findingIds],
          testCaseId: current.id,
          detail: patchInvalid
            ? `Patch fields exceed allowedChange "${item.guard.allowedChange}".`
            : `Expected ${item.guard.expectedCurrentHash} but found ${currentHash}.`,
        });
      }
      continue;
    }
    let nextCase = current;
    for (const item of items.sort(comparePlanItems)) {
      nextCase = applyPlanItem(nextCase, item);
    }
    byId.set(current.id, nextCase);
  }

  return {
    outcome: refusals.length > 0 ? "needs_review" : "applied",
    list: {
      ...input.list,
      testCases: input.list.testCases.map(
        (testCase) => byId.get(testCase.id) ?? testCase,
      ),
    },
    refusals: refusals.sort(compareRefusals),
  };
};

export const serializeRepairPlan = (plan: RepairPlan): string =>
  canonicalJson(plan);

export const writeRepairPlan = async (input: {
  readonly plan: RepairPlan;
  readonly runDir: string;
}): Promise<{ artifactPath: string; serialised: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError("writeRepairPlan: runDir must be a non-empty string");
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(input.runDir, REPAIR_PLANNER_ARTIFACT_FILENAME);
  const serialised = serializeRepairPlan(input.plan);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialised, { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath, serialised };
};

const buildPlanItem = (
  testCase: GeneratedTestCase,
  finding: ConsolidatedFinding,
): RepairPlanItem => {
  const summary = `Repair ${finding.repairTarget} for ${finding.summary}`;
  switch (finding.repairTarget) {
    case "expected_result":
      return {
        guard: buildGuard(testCase, finding),
        summary,
        patch: {
          appendExpectedResults: [finding.summary],
        },
      };
    case "steps":
      return {
        guard: buildGuard(testCase, finding),
        summary,
        patch: {
          appendSteps: [
            {
              action: `Cover missing workflow path for ${finding.kind}`,
              expected: finding.summary,
            },
          ],
        },
      };
    case "test_data":
      return {
        guard: buildGuard(testCase, finding),
        summary,
        patch: {
          appendTestData: [finding.summary],
        },
      };
    case "metadata":
    case "traceability":
      return {
        guard: buildGuard(testCase, finding),
        summary,
        patch: {
          appendOpenQuestions: [finding.summary],
          setReviewState: "needs_review",
        },
      };
  }
};

const buildGuard = (
  testCase: GeneratedTestCase,
  finding: ConsolidatedFinding,
): RepairChangeGuard => ({
  testCaseId: testCase.id,
  expectedCurrentHash: computeGeneratedTestCaseRepairHash(testCase),
  findingIds: [finding.findingId],
  allowedChange: finding.repairTarget,
});

const mergePlanItems = (
  left: RepairPlanItem,
  right: RepairPlanItem,
): RepairPlanItem => {
  const appendExpectedResults = mergeOptionalLists(
    left.patch.appendExpectedResults,
    right.patch.appendExpectedResults,
  );
  const appendOpenQuestions = mergeOptionalLists(
    left.patch.appendOpenQuestions,
    right.patch.appendOpenQuestions,
  );
  const appendSteps =
    left.patch.appendSteps === undefined && right.patch.appendSteps === undefined
      ? undefined
      : [...(left.patch.appendSteps ?? []), ...(right.patch.appendSteps ?? [])];
  const appendTestData = mergeOptionalLists(
    left.patch.appendTestData,
    right.patch.appendTestData,
  );
  const setReviewState = right.patch.setReviewState ?? left.patch.setReviewState;

  return {
    guard: {
      ...left.guard,
      findingIds: uniqueAppend(left.guard.findingIds, right.guard.findingIds),
    },
    summary: [left.summary, right.summary]
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(" | "),
    patch: {
      ...(appendExpectedResults !== undefined
        ? { appendExpectedResults }
        : {}),
      ...(appendOpenQuestions !== undefined ? { appendOpenQuestions } : {}),
      ...(appendSteps !== undefined ? { appendSteps } : {}),
      ...(appendTestData !== undefined ? { appendTestData } : {}),
      ...(setReviewState !== undefined ? { setReviewState } : {}),
    },
  };
};

const applyPlanItem = (
  testCase: GeneratedTestCase,
  item: RepairPlanItem,
): GeneratedTestCase => {
  const nextSteps =
    item.patch.appendSteps === undefined
      ? testCase.steps
      : [
          ...testCase.steps,
          ...item.patch.appendSteps.map((step, index) => ({
            index: testCase.steps.length + index + 1,
            action: step.action,
            ...(step.data !== undefined ? { data: step.data } : {}),
            ...(step.expected !== undefined ? { expected: step.expected } : {}),
          })),
        ];

  return {
    ...testCase,
    expectedResults: uniqueAppend(
      testCase.expectedResults,
      item.patch.appendExpectedResults,
    ),
    openQuestions: uniqueAppend(
      testCase.openQuestions,
      item.patch.appendOpenQuestions,
    ),
    steps: nextSteps,
    testData: uniqueAppend(testCase.testData, item.patch.appendTestData),
    reviewState: item.patch.setReviewState ?? testCase.reviewState,
  };
};

const uniqueAppend = (
  current: readonly string[],
  additions: readonly string[] | undefined,
): string[] => {
  if (additions === undefined || additions.length === 0) {
    return [...current];
  }
  return [...new Set([...current, ...additions])];
};

const mergeOptionalLists = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined => {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  return [...new Set([...(left ?? []), ...(right ?? [])])];
};

const isPatchAllowed = (item: RepairPlanItem): boolean => {
  switch (item.guard.allowedChange) {
    case "expected_result":
      return (
        item.patch.appendExpectedResults !== undefined &&
        item.patch.appendOpenQuestions === undefined &&
        item.patch.appendSteps === undefined &&
        item.patch.appendTestData === undefined &&
        item.patch.setReviewState === undefined
      );
    case "metadata":
      return (
        item.patch.appendExpectedResults === undefined &&
        item.patch.appendSteps === undefined &&
        item.patch.appendTestData === undefined
      );
    case "steps":
      return (
        item.patch.appendExpectedResults === undefined &&
        item.patch.appendOpenQuestions === undefined &&
        item.patch.appendSteps !== undefined &&
        item.patch.appendTestData === undefined &&
        item.patch.setReviewState === undefined
      );
    case "test_data":
      return (
        item.patch.appendExpectedResults === undefined &&
        item.patch.appendOpenQuestions === undefined &&
        item.patch.appendSteps === undefined &&
        item.patch.appendTestData !== undefined &&
        item.patch.setReviewState === undefined
      );
    case "traceability":
      return (
        item.patch.appendExpectedResults === undefined &&
        item.patch.appendSteps === undefined &&
        item.patch.appendTestData === undefined
      );
  }
};

const selectTargetCase = (
  testCases: readonly GeneratedTestCase[],
  finding: ConsolidatedFinding,
  acceptedCaseIds: ReadonlySet<string>,
): GeneratedTestCase | undefined => {
  if (finding.testCaseId !== undefined) {
    return testCases.find((testCase) => testCase.id === finding.testCaseId);
  }
  const mutableCases = testCases.filter(
    (testCase) => !acceptedCaseIds.has(testCase.id),
  );
  const preferredTypes = new Set(finding.preferredCaseTypes ?? []);
  const preferred = mutableCases
    .filter(
      (testCase) =>
        preferredTypes.size === 0 || preferredTypes.has(testCase.type),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return (
    preferred[0] ??
    mutableCases.sort((left, right) => left.id.localeCompare(right.id))[0]
  );
};

const compareFindings = (
  left: ConsolidatedFinding,
  right: ConsolidatedFinding,
): number =>
  (left.testCaseId ?? "").localeCompare(right.testCaseId ?? "") ||
  CHANGE_TARGET_PRIORITY[left.repairTarget] -
    CHANGE_TARGET_PRIORITY[right.repairTarget] ||
  left.findingId.localeCompare(right.findingId);

const comparePlanItems = (
  left: RepairPlanItem,
  right: RepairPlanItem,
): number =>
  left.guard.testCaseId.localeCompare(right.guard.testCaseId) ||
  CHANGE_TARGET_PRIORITY[left.guard.allowedChange] -
    CHANGE_TARGET_PRIORITY[right.guard.allowedChange] ||
  left.guard.findingIds.join("\0").localeCompare(
    right.guard.findingIds.join("\0"),
  );

const compareRefusals = (
  left: RepairPlanRefusal,
  right: RepairPlanRefusal,
): number =>
  left.code.localeCompare(right.code) ||
  (left.testCaseId ?? "").localeCompare(right.testCaseId ?? "") ||
  left.findingIds.join("\0").localeCompare(right.findingIds.join("\0"));
