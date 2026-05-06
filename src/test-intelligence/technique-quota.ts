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
 * Defensive coercion of a (possibly undefined / non-array) value to a
 * read-only array. Mirrors the `safeArray` helper in `logic-judge.ts`
 * so the hard-gate can be invoked from operator-supplied inputs (test
 * fixtures, partial canonicalised plans) that may omit non-optional
 * contract fields without throwing.
 */
const safeArray = <T>(value: unknown): ReadonlyArray<T> =>
  Array.isArray(value) ? (value as ReadonlyArray<T>) : [];

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
  const perScreen = safeArray<CoveragePlan["perScreen"][number]>(
    coveragePlan.perScreen,
  );
  for (const screen of [...perScreen].sort((left, right) =>
    left.screenId.localeCompare(right.screenId),
  )) {
    // Defensive against legacy / partial CoveragePlan fixtures that
    // omit `techniqueQuotas`; the contract field is non-optional in
    // current builds, but the hard-gate runs against arbitrary
    // operator inputs and must never throw on a missing array.
    const screenQuotas = safeArray<
      CoveragePlan["perScreen"][number]["techniqueQuotas"][number]
    >(screen.techniqueQuotas);
    const quotas = [...screenQuotas]
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
