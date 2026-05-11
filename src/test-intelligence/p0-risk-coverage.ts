import type {
  CoveragePlan,
  CoveragePlanElementRiskClass,
  CoveragePlanPerElement,
  GeneratedTestCase,
} from "../contracts/index.js";

/**
 * Risk classes the Risk-Ranker (Wave 2) treats as p0 priority — the highest
 * tier that must always be covered by at least one generated test case.
 *
 * The taxonomy aligns with `CoveragePlanElementRiskClass` (which is itself the
 * `TestCaseRiskCategory` taxonomy). For Banking the p0 categories are
 * `regulated_data` and `financial_transaction`; the Risk-Ranker's
 * deterministic baseline scores them at 0.85+ which is above every other
 * non-strict class, so they are the natural p0 set.
 */
export const P0_RISK_CLASSES: ReadonlySet<CoveragePlanElementRiskClass> =
  new Set(["regulated_data", "financial_transaction"]);

export interface UncoveredP0Element {
  readonly screenId: string;
  readonly elementId: string;
  readonly riskClass: CoveragePlanElementRiskClass;
}

const isP0Element = (element: CoveragePlanPerElement): boolean =>
  P0_RISK_CLASSES.has(element.riskClass);

const collectCoveredElementIds = (
  cases: ReadonlyArray<GeneratedTestCase>,
): ReadonlySet<string> => {
  const covered = new Set<string>();
  for (const testCase of cases) {
    for (const fieldId of testCase.qualitySignals.coveredFieldIds) {
      covered.add(fieldId);
    }
    for (const actionId of testCase.qualitySignals.coveredActionIds) {
      covered.add(actionId);
    }
  }
  return covered;
};

/**
 * Identify p0 risk-class IR elements that no generated case references via
 * `qualitySignals.coveredFieldIds` or `qualitySignals.coveredActionIds`.
 *
 * The function mirrors the Wave 2 Risk-Ranker semantics: a "p0 IR element" is
 * a `CoveragePlanPerElement` whose `riskClass` is in `P0_RISK_CLASSES`. The
 * result is sorted deterministically by `(screenId, elementId)` so the
 * downstream policy-gate emits stable violation rows.
 */
export const collectUncoveredP0Elements = (
  cases: ReadonlyArray<GeneratedTestCase>,
  coveragePlan: CoveragePlan | undefined,
): UncoveredP0Element[] => {
  if (coveragePlan === undefined) {
    return [];
  }
  const p0Elements = coveragePlan.perElement.filter(isP0Element);
  if (p0Elements.length === 0) {
    return [];
  }
  const covered = collectCoveredElementIds(cases);
  const uncovered: UncoveredP0Element[] = [];
  for (const element of p0Elements) {
    if (covered.has(element.elementId)) {
      continue;
    }
    uncovered.push({
      screenId: element.screenId,
      elementId: element.elementId,
      riskClass: element.riskClass,
    });
  }
  uncovered.sort(
    (left, right) =>
      left.screenId.localeCompare(right.screenId) ||
      left.elementId.localeCompare(right.elementId),
  );
  return uncovered;
};
