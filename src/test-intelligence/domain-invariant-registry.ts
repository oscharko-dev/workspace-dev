/**
 * Domain-invariant registry (Issue #2040).
 *
 * Encodes domain rules — "VAT is never applied to a Netto base", "principal +
 * interest = total cost to two decimal places", etc. — as typed predicates
 * that the validation pipeline can evaluate against generated test cases.
 *
 * The registry is the source of truth for property-based hard checks. The
 * eval rubric still steers prompt language and structure; invariants enforce
 * facts. They are additive to (not a replacement for) the rubric.
 *
 * DSL:
 *
 *   {
 *     id:        "INV-VAT-01"
 *     scope:     "active-dataset.financing-need"
 *     forall:    (case, ctx) => boolean   // does the invariant apply?
 *     holds:     (case, ctx) => boolean   // does the case satisfy it?
 *     severity:  "error" | "warning"
 *     source:    "Issue #2040 (registered)"
 *   }
 *
 * `forall` is the scope predicate; only matched cases count toward
 * `invariantCoverage`. `holds` is the safety predicate; a `forall` match
 * with `holds === false` raises a violation.
 *
 * The exported {@link buildActiveDatasetInvariantRegistry} ships the
 * Wave-2 invariant set:
 *
 *   - INV-VAT-01            VAT exclusion on the financing-need calculation
 *   - INV-NETTO-BRUTTO-01   brutto/netto exclusivity
 *   - INV-OPTIONAL-COST-01  optional-cost-field semantics
 *   - INV-FINANCING-NEED-01 financing-need formula bounds
 *
 * Operators may register additional invariants via {@link registerInvariant}
 * before running the pipeline; downstream artifacts (`validation-report.json`,
 * `coverage-report.json`) surface the resulting per-case `exercises` and the
 * job-level `invariantCoverage` ratio.
 */

import type {
  BusinessTestIntentIr,
  GeneratedTestCase,
  TestDesignCalculationConstraint,
  TestDesignModel,
} from "../contracts/index.js";
import {
  detectCalculationConstraintViolation,
  extractCalculationConstraints,
} from "./calculation-constraints.js";

/** Severity surfaced for a single invariant violation. */
export type DomainInvariantSeverity = "error" | "warning";

/** Context passed to invariant predicates. */
export interface DomainInvariantContext {
  readonly intent: BusinessTestIntentIr;
  readonly model: TestDesignModel;
}

/**
 * One typed domain invariant. The DSL is intentionally narrow so registered
 * invariants compose without inheritance: `forall` selects the cases in
 * scope, `holds` answers "is the property satisfied". The optional
 * `violationMessage` factory is invoked when `holds` returns false to
 * produce a deterministic message + JSON path; a default fallback is used
 * when omitted.
 */
export interface DomainInvariant {
  readonly id: string;
  readonly scope: string;
  readonly description: string;
  readonly source: string;
  readonly severity: DomainInvariantSeverity;
  readonly forall: (
    testCase: GeneratedTestCase,
    context: DomainInvariantContext,
  ) => boolean;
  readonly holds: (
    testCase: GeneratedTestCase,
    context: DomainInvariantContext,
  ) => boolean;
  readonly violationMessage?: (
    testCase: GeneratedTestCase,
    context: DomainInvariantContext,
  ) => { readonly path: string; readonly message: string };
}

/** Single violation row produced by {@link evaluateInvariants}. */
export interface DomainInvariantViolation {
  readonly invariantId: string;
  readonly testCaseId: string;
  readonly severity: DomainInvariantSeverity;
  readonly path: string;
  readonly message: string;
  readonly source: string;
}

/** Per-case evaluation outcome. */
export interface DomainInvariantCaseEvaluation {
  readonly testCaseId: string;
  /** Sorted, deduplicated invariant ids the case is in-scope for (`forall === true`). */
  readonly exercises: readonly string[];
  /** Violations recorded for this case (sorted by invariantId). */
  readonly violations: readonly DomainInvariantViolation[];
}

/** Aggregate evaluation across one job's generated test cases. */
export interface DomainInvariantEvaluation {
  /** Sorted invariant ids registered in the registry. */
  readonly registered: readonly string[];
  /** Per-case evaluation rows, ordered by index of the input list. */
  readonly cases: readonly DomainInvariantCaseEvaluation[];
  /** Sorted invariant ids exercised by at least one case. */
  readonly exercisedInvariants: readonly string[];
  /** All violations across all cases, deterministically ordered. */
  readonly violations: readonly DomainInvariantViolation[];
}

/** Mutable registry of {@link DomainInvariant} entries. */
export interface DomainInvariantRegistry {
  register(invariant: DomainInvariant): void;
  list(): readonly DomainInvariant[];
  ids(): readonly string[];
}

const ID_RE = /^INV-[A-Z0-9-]{1,40}$/;

const validateInvariant = (invariant: DomainInvariant): void => {
  if (!ID_RE.test(invariant.id)) {
    throw new Error(
      `domain-invariant-registry: invariant id "${invariant.id}" must match ${ID_RE.source}`,
    );
  }
  if (invariant.scope.trim().length === 0) {
    throw new Error(
      `domain-invariant-registry: invariant "${invariant.id}" must declare a non-empty scope`,
    );
  }
  if (invariant.source.trim().length === 0) {
    throw new Error(
      `domain-invariant-registry: invariant "${invariant.id}" must declare a non-empty source`,
    );
  }
};

/**
 * Build a fresh empty registry. Callers are expected to register invariants
 * either explicitly or by composing with {@link buildActiveDatasetInvariantRegistry}.
 */
export const createInvariantRegistry = (): DomainInvariantRegistry => {
  const byId = new Map<string, DomainInvariant>();
  return {
    register(invariant) {
      validateInvariant(invariant);
      if (byId.has(invariant.id)) {
        throw new Error(
          `domain-invariant-registry: invariant id "${invariant.id}" is already registered`,
        );
      }
      byId.set(invariant.id, invariant);
    },
    list() {
      return [...byId.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    },
    ids() {
      return [...byId.keys()].sort((left, right) => left.localeCompare(right));
    },
  };
};

/* -------------------------------------------------------------------- */
/*  Active-dataset invariant set                                         */
/* -------------------------------------------------------------------- */

const FINANCING_NEED_TEXT_RE =
  /\b(financing need|finance need|loan amount|funding need|finanzierungsbedarf(?:es|s|e)?)\b/i;
const VAT_TEXT_RE =
  /\b(vat|value added tax|mwst\.?|mehrwertsteuer(?:n|s)?|umsatzsteuer(?:n|s)?)\b/i;
const NETTO_TEXT_RE = /\b(netto|net amount)\b/i;
const BRUTTO_TEXT_RE = /\b(brutto|gross amount)\b/i;
const OPTIONAL_COST_TEXT_RE =
  /\b(optional (?:cost|fee|charge)|optional[ae]r? (?:kosten|gebühr|aufpreis))\b/i;

const collectCaseStrings = (testCase: GeneratedTestCase): string[] => {
  const out: string[] = [
    testCase.title,
    testCase.objective,
    ...testCase.expectedResults,
    ...testCase.preconditions,
    ...testCase.testData,
  ];
  for (const step of testCase.steps) {
    out.push(step.action);
    if (typeof step.data === "string") out.push(step.data);
    if (typeof step.expected === "string") out.push(step.expected);
  }
  return out;
};

const caseTextMatches = (
  testCase: GeneratedTestCase,
  pattern: RegExp,
): boolean => collectCaseStrings(testCase).some((text) => pattern.test(text));

const screenIdsForCase = (testCase: GeneratedTestCase): Set<string> =>
  new Set(testCase.figmaTraceRefs.map((ref) => ref.screenId));

const screenLooksFinancingRelated = (
  context: DomainInvariantContext,
  testCase: GeneratedTestCase,
): boolean => {
  const ids = screenIdsForCase(testCase);
  for (const screen of context.model.screens) {
    if (!ids.has(screen.screenId)) continue;
    if (
      screen.elements.some(
        (element) =>
          FINANCING_NEED_TEXT_RE.test(element.label) ||
          VAT_TEXT_RE.test(element.label),
      )
    ) {
      return true;
    }
  }
  return false;
};

const collectModelConstraints = (
  context: DomainInvariantContext,
): TestDesignCalculationConstraint[] => {
  const seen = new Set<string>();
  const out: TestDesignCalculationConstraint[] = [];
  const candidates = [
    ...context.model.calculationConstraints,
    ...extractCalculationConstraints(context.model),
  ];
  for (const constraint of candidates) {
    const key = `${constraint.kind}|${constraint.evidenceText}|${constraint.screenId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(constraint);
  }
  return out;
};

/** INV-VAT-01 — VAT must be excluded from the financing-need calculation. */
const buildVatExclusionInvariant = (): DomainInvariant => ({
  id: "INV-VAT-01",
  scope: "active-dataset.financing-need",
  description:
    "When the test-design model excludes VAT from the financing-need calculation, no generated test case may include VAT in the financing-need result.",
  source: "Issue #2040 (registered)",
  severity: "error",
  forall: (testCase, context) => {
    const constraints = collectModelConstraints(context);
    const hasExclusion = constraints.some(
      (constraint) => constraint.kind === "exclude_component",
    );
    if (!hasExclusion) return false;
    return (
      caseTextMatches(testCase, FINANCING_NEED_TEXT_RE) ||
      screenLooksFinancingRelated(context, testCase)
    );
  },
  holds: (testCase, context) =>
    detectCalculationConstraintViolation({
      model: context.model,
      testCase,
    }) === undefined,
  violationMessage: (testCase, context) => {
    const violation = detectCalculationConstraintViolation({
      model: context.model,
      testCase,
    });
    return {
      path: violation?.path ?? "expectedResults",
      message:
        violation?.message ??
        "Generated case includes VAT in the financing-need calculation, contradicting INV-VAT-01.",
    };
  },
});

/**
 * INV-NETTO-BRUTTO-01 — a single financial result must not be presented as
 * both Netto (excl. VAT) AND Brutto (incl. VAT) without an explicit
 * conversion step. The invariant guards against the LLM conflating the two
 * bases in one expected-result string.
 */
const buildNettoBruttoExclusivityInvariant = (): DomainInvariant => ({
  id: "INV-NETTO-BRUTTO-01",
  scope: "active-dataset.netto-brutto",
  description:
    "A single expected-result string must not present a result simultaneously as Netto and Brutto. Netto/Brutto are mutually exclusive bases for the same value.",
  source: "Issue #2040 (registered)",
  severity: "error",
  forall: (testCase) =>
    caseTextMatches(testCase, NETTO_TEXT_RE) ||
    caseTextMatches(testCase, BRUTTO_TEXT_RE),
  holds: (testCase) => {
    const candidates: { path: string; text: string }[] = [];
    testCase.expectedResults.forEach((text, idx) =>
      candidates.push({ path: `expectedResults[${idx}]`, text }),
    );
    testCase.steps.forEach((step, idx) => {
      if (typeof step.expected === "string") {
        candidates.push({
          path: `steps[${idx}].expected`,
          text: step.expected,
        });
      }
    });
    return !candidates.some(
      (entry) =>
        NETTO_TEXT_RE.test(entry.text) && BRUTTO_TEXT_RE.test(entry.text),
    );
  },
  violationMessage: (testCase) => {
    let path = "expectedResults";
    for (const [idx, text] of testCase.expectedResults.entries()) {
      if (NETTO_TEXT_RE.test(text) && BRUTTO_TEXT_RE.test(text)) {
        path = `expectedResults[${idx}]`;
        break;
      }
    }
    return {
      path,
      message:
        "Expected result conflates Netto and Brutto in a single string; invariant INV-NETTO-BRUTTO-01 forbids the dual basis without an explicit conversion step.",
    };
  },
});

/**
 * INV-OPTIONAL-COST-01 — optional cost fields (e.g. "optional fee", "optional
 * Aufpreis") must not be assumed populated in a positive-flow expected
 * result. The invariant fires when a case mentions an optional cost yet
 * embeds the cost in the financing-need / total-cost result without an
 * explicit precondition that the optional cost was selected.
 */
const buildOptionalCostInvariant = (): DomainInvariant => ({
  id: "INV-OPTIONAL-COST-01",
  scope: "active-dataset.optional-cost",
  description:
    "Optional cost fields are absent unless explicitly selected. A case that mentions an optional cost in an expected-result must declare that the cost was selected in preconditions or steps.",
  source: "Issue #2040 (registered)",
  severity: "error",
  forall: (testCase) => caseTextMatches(testCase, OPTIONAL_COST_TEXT_RE),
  holds: (testCase) => {
    const expectedTouched =
      testCase.expectedResults.some((text) =>
        OPTIONAL_COST_TEXT_RE.test(text),
      ) ||
      testCase.steps.some((step) =>
        typeof step.expected === "string"
          ? OPTIONAL_COST_TEXT_RE.test(step.expected)
          : false,
      );
    if (!expectedTouched) return true;
    const declaredSelected =
      testCase.preconditions.some((text) =>
        OPTIONAL_COST_TEXT_RE.test(text),
      ) ||
      testCase.steps.some((step) =>
        OPTIONAL_COST_TEXT_RE.test(step.action) ||
        (typeof step.data === "string" && OPTIONAL_COST_TEXT_RE.test(step.data))
      );
    return declaredSelected;
  },
  violationMessage: () => ({
    path: "expectedResults",
    message:
      "Expected result depends on an optional cost field but the case declares neither a precondition nor a step that selects it; invariant INV-OPTIONAL-COST-01 forbids assuming optional fields are populated.",
  }),
});

/**
 * INV-FINANCING-NEED-01 — financing-need totals must be bounded by the
 * inputs declared on the active screen. The invariant defers numeric
 * verification to {@link detectCalculationConstraintViolation}; the helper
 * computes the VAT-excluded amount from the screen elements and rejects
 * any expected total that strays from it by more than half a cent.
 */
const buildFinancingNeedFormulaInvariant = (): DomainInvariant => ({
  id: "INV-FINANCING-NEED-01",
  scope: "active-dataset.financing-need",
  description:
    "The expected financing-need total must equal the VAT-excluded sum of the bounded inputs declared on the active screen, rounded to two decimals.",
  source: "Issue #2040 (registered)",
  severity: "error",
  forall: (testCase, context) => {
    const constraints = collectModelConstraints(context);
    if (constraints.length === 0) return false;
    return (
      caseTextMatches(testCase, FINANCING_NEED_TEXT_RE) ||
      screenLooksFinancingRelated(context, testCase)
    );
  },
  holds: (testCase, context) =>
    detectCalculationConstraintViolation({
      model: context.model,
      testCase,
    }) === undefined,
  violationMessage: (testCase, context) => {
    const violation = detectCalculationConstraintViolation({
      model: context.model,
      testCase,
    });
    return {
      path: violation?.path ?? "expectedResults",
      message:
        violation?.message ??
        "Financing-need total is outside the bounded-input formula; invariant INV-FINANCING-NEED-01 was violated.",
    };
  },
});

/**
 * Register the Wave-2 active-dataset invariants on an existing registry.
 * Used by the validation pipeline default registry and by tests.
 */
export const registerActiveDatasetInvariants = (
  registry: DomainInvariantRegistry,
): void => {
  registry.register(buildVatExclusionInvariant());
  registry.register(buildNettoBruttoExclusivityInvariant());
  registry.register(buildOptionalCostInvariant());
  registry.register(buildFinancingNeedFormulaInvariant());
};

/**
 * Build a fresh registry pre-populated with the active-dataset invariants.
 * The returned registry is mutable; callers may register additional
 * invariants before evaluation.
 */
export const buildActiveDatasetInvariantRegistry =
  (): DomainInvariantRegistry => {
    const registry = createInvariantRegistry();
    registerActiveDatasetInvariants(registry);
    return registry;
  };

/* -------------------------------------------------------------------- */
/*  Evaluation                                                           */
/* -------------------------------------------------------------------- */

const sortedUnique = (values: readonly string[]): string[] => {
  const set = new Set(values);
  return [...set].sort((left, right) => left.localeCompare(right));
};

/**
 * Evaluate a registry against a generated test case list. The result is
 * deterministic: cases keep input order, exercises/ids are sorted, and
 * violations are sorted by `(testCaseId, invariantId)`.
 */
export const evaluateInvariants = (input: {
  readonly registry: DomainInvariantRegistry;
  readonly testCases: ReadonlyArray<GeneratedTestCase>;
  readonly context: DomainInvariantContext;
}): DomainInvariantEvaluation => {
  const invariants = input.registry.list();
  const registered = invariants.map((invariant) => invariant.id);
  const exercisedSet = new Set<string>();
  const violations: DomainInvariantViolation[] = [];
  const cases: DomainInvariantCaseEvaluation[] = [];

  for (const testCase of input.testCases) {
    const exercises: string[] = [];
    const caseViolations: DomainInvariantViolation[] = [];
    for (const invariant of invariants) {
      let inScope: boolean;
      try {
        inScope = invariant.forall(testCase, input.context);
      } catch (error) {
        throw new Error(
          `domain-invariant-registry: invariant "${invariant.id}".forall threw: ${(error as Error).message}`,
        );
      }
      if (!inScope) continue;
      exercises.push(invariant.id);
      exercisedSet.add(invariant.id);
      let satisfies: boolean;
      try {
        satisfies = invariant.holds(testCase, input.context);
      } catch (error) {
        throw new Error(
          `domain-invariant-registry: invariant "${invariant.id}".holds threw on case "${testCase.id}": ${(error as Error).message}`,
        );
      }
      if (satisfies) continue;
      const detail =
        invariant.violationMessage?.(testCase, input.context) ?? {
          path: "expectedResults",
          message: `Domain invariant ${invariant.id} (${invariant.description}) was violated by test case "${testCase.id}".`,
        };
      const violation: DomainInvariantViolation = {
        invariantId: invariant.id,
        testCaseId: testCase.id,
        severity: invariant.severity,
        path: detail.path,
        message: detail.message,
        source: invariant.source,
      };
      caseViolations.push(violation);
      violations.push(violation);
    }
    caseViolations.sort((left, right) =>
      left.invariantId.localeCompare(right.invariantId),
    );
    cases.push({
      testCaseId: testCase.id,
      exercises: sortedUnique(exercises),
      violations: caseViolations,
    });
  }

  violations.sort((left, right) => {
    const byCase = left.testCaseId.localeCompare(right.testCaseId);
    if (byCase !== 0) return byCase;
    return left.invariantId.localeCompare(right.invariantId);
  });

  return {
    registered,
    cases,
    exercisedInvariants: [...exercisedSet].sort((left, right) =>
      left.localeCompare(right),
    ),
    violations,
  };
};

/**
 * Compute the job-level invariant-coverage ratio: the share of registered
 * invariants exercised by at least one accepted test case. The ratio is
 * rounded to six digits to match the byte-stable canonical-JSON contract.
 */
export const computeInvariantCoverageRatio = (
  evaluation: DomainInvariantEvaluation,
): { total: number; exercised: number; ratio: number } => {
  const total = evaluation.registered.length;
  const exercised = evaluation.exercisedInvariants.length;
  if (total === 0) return { total, exercised, ratio: 0 };
  const ratio = Math.round((exercised / total) * 1_000_000) / 1_000_000;
  return { total, exercised, ratio };
};
