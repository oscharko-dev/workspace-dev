/**
 * Validation-pipeline gate for the cross-field invariant engine
 * (Issue #2110).
 *
 * The gate enforces the acceptance contract: every screen that has at
 * least one registered cross-field invariant MUST have at least one
 * test case that exercises the positive (satisfying) side AND at least
 * one test case that exercises the negative (violating) side.
 *
 * Coverage is asserted via *claims* — explicit, caller-supplied
 * `(testCaseId, invariantId, side)` triples. Claims keep the gate
 * purely deterministic: no natural-language matching, no LLM in the
 * loop. Generators (deterministic-test-data oracle, LLM, manual) MUST
 * declare which invariants their cases exercise; the gate then verifies
 * coverage breadth against the registry.
 *
 * Out-of-scope rules and edge cases:
 *
 *   - The gate does NOT re-evaluate the AST against the test case at
 *     this layer — claims declare *intent*. AST evaluation against
 *     concrete valuations happens elsewhere (engine smoke tests,
 *     benchmark, downstream test-data oracle).
 *   - A screen with zero registered invariants generates no gate output
 *     for that screen. Existing fixtures whose screens do not appear in
 *     the registry therefore see no new blocking issues.
 *   - A claim referencing an invariant id that is not in the registry
 *     surfaces an `invariant_unknown` warning but does not block — the
 *     case may still be otherwise valid, and operators sometimes prune
 *     a registry entry intentionally.
 */

import type {
  CrossFieldInvariantRegistry,
  CrossFieldInvariantSeverity,
} from "./cross-field-invariant-engine.js";

/** Claim that one test case exercises one cross-field invariant. */
export interface CrossFieldCaseClaim {
  /** The test case id this claim is anchored to. */
  readonly testCaseId: string;
  /** The cross-field invariant id this claim references. */
  readonly invariantId: string;
  /**
   * `positive` — the case is constructed to satisfy the invariant.
   * `negative` — the case is constructed to violate the invariant.
   */
  readonly side: "positive" | "negative";
}

/** Per-screen coverage row. */
export interface CrossFieldScreenCoverage {
  readonly screenId: string;
  /** Sorted, deduplicated invariant ids registered for this screen. */
  readonly invariantIds: ReadonlyArray<string>;
  /** Sorted test case ids that supplied a positive claim against this screen. */
  readonly positiveCaseIds: ReadonlyArray<string>;
  /** Sorted test case ids that supplied a negative claim against this screen. */
  readonly negativeCaseIds: ReadonlyArray<string>;
  /** True when no positive claim references any invariant on this screen. */
  readonly missingPositive: boolean;
  /** True when no negative claim references any invariant on this screen. */
  readonly missingNegative: boolean;
}

/** Per-invariant coverage row. */
export interface CrossFieldInvariantCoverageRow {
  readonly invariantId: string;
  readonly screenIds: ReadonlyArray<string>;
  readonly positiveCaseIds: ReadonlyArray<string>;
  readonly negativeCaseIds: ReadonlyArray<string>;
}

/** Coverage issue surfaced by the gate. */
export type CrossFieldInvariantCoverageIssueCode =
  | "screen_missing_positive_case"
  | "screen_missing_negative_case"
  | "invariant_unknown";

export interface CrossFieldInvariantCoverageIssue {
  readonly code: CrossFieldInvariantCoverageIssueCode;
  readonly severity: CrossFieldInvariantSeverity;
  readonly screenId?: string;
  readonly invariantId?: string;
  readonly testCaseId?: string;
  readonly message: string;
}

/** Coverage report — full output of the gate. */
export interface CrossFieldInvariantCoverageReport {
  readonly schemaVersion: "1.0.0";
  readonly jobId: string;
  readonly generatedAt: string;
  readonly perScreen: ReadonlyArray<CrossFieldScreenCoverage>;
  readonly perInvariant: ReadonlyArray<CrossFieldInvariantCoverageRow>;
  readonly issues: ReadonlyArray<CrossFieldInvariantCoverageIssue>;
  /** True when ANY issue has severity `error`. */
  readonly blocked: boolean;
  /** Total registered invariants visible to the gate. */
  readonly totalInvariants: number;
  /** Invariants exercised by at least one positive AND one negative case. */
  readonly fullyCoveredInvariants: number;
}

const sortedUnique = (values: Iterable<string>): string[] => {
  const set = new Set(values);
  return [...set].sort((left, right) => left.localeCompare(right));
};

/** Compute the coverage report for one pipeline run. */
export const evaluateCrossFieldInvariantCoverage = (input: {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly registry: CrossFieldInvariantRegistry;
  readonly claims: ReadonlyArray<CrossFieldCaseClaim>;
}): CrossFieldInvariantCoverageReport => {
  const invariants = input.registry.list();
  const knownIds = new Set(invariants.map((invariant) => invariant.id));

  /* Build screen → invariants map and invariant → screens map. */
  const screenToInvariantIds = new Map<string, Set<string>>();
  const invariantToScreenIds = new Map<string, Set<string>>();
  for (const invariant of invariants) {
    const seenScreens = new Set<string>();
    for (const anchor of invariant.anchors) {
      seenScreens.add(anchor.screenId);
      const bucket =
        screenToInvariantIds.get(anchor.screenId) ?? new Set<string>();
      bucket.add(invariant.id);
      screenToInvariantIds.set(anchor.screenId, bucket);
    }
    invariantToScreenIds.set(invariant.id, seenScreens);
  }

  /* Index claims. */
  const screenPositive = new Map<string, Set<string>>();
  const screenNegative = new Map<string, Set<string>>();
  const invariantPositive = new Map<string, Set<string>>();
  const invariantNegative = new Map<string, Set<string>>();
  const issues: CrossFieldInvariantCoverageIssue[] = [];

  for (const claim of input.claims) {
    if (!knownIds.has(claim.invariantId)) {
      issues.push({
        code: "invariant_unknown",
        severity: "warning",
        invariantId: claim.invariantId,
        testCaseId: claim.testCaseId,
        message: `Claim references invariant "${claim.invariantId}" not present in the registry.`,
      });
      continue;
    }
    const positiveBucket =
      claim.side === "positive" ? invariantPositive : invariantNegative;
    const positiveSet =
      positiveBucket.get(claim.invariantId) ?? new Set<string>();
    positiveSet.add(claim.testCaseId);
    positiveBucket.set(claim.invariantId, positiveSet);

    const screensForClaim = invariantToScreenIds.get(claim.invariantId);
    if (screensForClaim === undefined) continue;
    for (const screenId of screensForClaim) {
      const sideMap = claim.side === "positive" ? screenPositive : screenNegative;
      const screenSet = sideMap.get(screenId) ?? new Set<string>();
      screenSet.add(claim.testCaseId);
      sideMap.set(screenId, screenSet);
    }
  }

  /* Per-screen rows + missing-coverage issues. */
  const perScreen: CrossFieldScreenCoverage[] = [];
  const screenIds = sortedUnique(screenToInvariantIds.keys());
  for (const screenId of screenIds) {
    const invariantIds = sortedUnique(
      screenToInvariantIds.get(screenId) ?? new Set<string>(),
    );
    const positiveCaseIds = sortedUnique(
      screenPositive.get(screenId) ?? new Set<string>(),
    );
    const negativeCaseIds = sortedUnique(
      screenNegative.get(screenId) ?? new Set<string>(),
    );
    const missingPositive = positiveCaseIds.length === 0;
    const missingNegative = negativeCaseIds.length === 0;
    perScreen.push({
      screenId,
      invariantIds,
      positiveCaseIds,
      negativeCaseIds,
      missingPositive,
      missingNegative,
    });
    if (missingPositive) {
      issues.push({
        code: "screen_missing_positive_case",
        severity: "error",
        screenId,
        message: `Screen "${screenId}" has ${invariantIds.length} cross-field invariant(s) but no positive test case claim. Issue #2110 requires at least one positive case per screen.`,
      });
    }
    if (missingNegative) {
      issues.push({
        code: "screen_missing_negative_case",
        severity: "error",
        screenId,
        message: `Screen "${screenId}" has ${invariantIds.length} cross-field invariant(s) but no negative test case claim. Issue #2110 requires at least one negative case per screen.`,
      });
    }
  }

  /* Per-invariant rows. */
  const perInvariant: CrossFieldInvariantCoverageRow[] = [];
  let fullyCovered = 0;
  for (const invariant of invariants) {
    const positiveCaseIds = sortedUnique(
      invariantPositive.get(invariant.id) ?? new Set<string>(),
    );
    const negativeCaseIds = sortedUnique(
      invariantNegative.get(invariant.id) ?? new Set<string>(),
    );
    const screenIdsForRow = sortedUnique(
      invariantToScreenIds.get(invariant.id) ?? new Set<string>(),
    );
    perInvariant.push({
      invariantId: invariant.id,
      screenIds: screenIdsForRow,
      positiveCaseIds,
      negativeCaseIds,
    });
    if (positiveCaseIds.length > 0 && negativeCaseIds.length > 0) {
      fullyCovered += 1;
    }
  }

  /* Stable issue ordering. */
  issues.sort((left, right) => {
    const codeOrder = left.code.localeCompare(right.code);
    if (codeOrder !== 0) return codeOrder;
    const screenOrder = (left.screenId ?? "").localeCompare(right.screenId ?? "");
    if (screenOrder !== 0) return screenOrder;
    return (left.invariantId ?? "").localeCompare(right.invariantId ?? "");
  });

  return {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    perScreen,
    perInvariant,
    issues,
    blocked: issues.some((issue) => issue.severity === "error"),
    totalInvariants: invariants.length,
    fullyCoveredInvariants: fullyCovered,
  };
};

/** Canonical artifact filename for the coverage report. */
export const CROSS_FIELD_INVARIANT_COVERAGE_ARTIFACT_FILENAME =
  "cross-field-invariant-coverage-report.json" as const;
