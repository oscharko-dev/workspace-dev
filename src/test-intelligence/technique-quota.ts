import type {
  CoveragePlan,
  GeneratedTestCase,
  TestCaseTechnique29119,
} from "../contracts/index.js";

export interface TechniqueQuotaDeficit {
  screenId: string;
  technique: TestCaseTechnique29119;
  minCount: number;
  actual: number;
  missing: number;
}

/**
 * Compare generated cases to per-screen coverage-plan quotas using the same
 * anchoring semantics everywhere: only cases whose `figmaTraceRefs` include
 * the target `screenId` count toward that screen's minimum.
 */
export const collectTechniqueQuotaDeficits = (
  cases: ReadonlyArray<GeneratedTestCase>,
  coveragePlan: CoveragePlan | undefined,
): TechniqueQuotaDeficit[] => {
  if (coveragePlan === undefined) {
    return [];
  }

  const deficits: TechniqueQuotaDeficit[] = [];
  for (const screen of [...coveragePlan.perScreen].sort((left, right) =>
    left.screenId.localeCompare(right.screenId),
  )) {
    const quotas = [...screen.techniqueQuotas]
      .filter((quota) => quota.minCount > 0)
      .sort(
        (left, right) =>
          left.technique.localeCompare(right.technique) ||
          left.minCount - right.minCount,
      );
    if (quotas.length === 0) {
      continue;
    }

    const counts = new Map<TestCaseTechnique29119, number>();
    for (const testCase of cases) {
      if (
        !testCase.figmaTraceRefs.some(
          (traceRef) => traceRef.screenId === screen.screenId,
        )
      ) {
        continue;
      }
      counts.set(testCase.technique, (counts.get(testCase.technique) ?? 0) + 1);
    }

    for (const quota of quotas) {
      const actual = counts.get(quota.technique) ?? 0;
      if (actual >= quota.minCount) {
        continue;
      }
      deficits.push({
        screenId: screen.screenId,
        technique: quota.technique,
        minCount: quota.minCount,
        actual,
        missing: quota.minCount - actual,
      });
    }
  }

  return deficits;
};
