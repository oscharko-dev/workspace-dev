/**
 * Cross-field invariant engine (Issue #2110).
 *
 * Complements the per-field deterministic test-data oracle
 * (`test-data-oracle.ts`, Issue #2071) with a typed, fully deterministic
 * engine for *cross-field* constraints — rules that span two or more form
 * fields and therefore cannot be expressed as per-field validation strings.
 *
 * Examples drawn from regulated EU banking + insurance forms:
 *
 *   - "Annual equivalent of the monthly rate (12 ×) ≤ 60 % of Jahresbrutto"
 *     (consumer credit — DTI ratio limit).
 *   - "If product family is `cfd` then customer experience must be
 *     `experienced`" (MiFID II appropriateness).
 *   - "If residency is `US` then FATCA-status must be set" (CRS / FATCA).
 *   - "Coverage start date >= contract signing date + 1 day" (insurance
 *     cooling-off).
 *
 * The previous oracle stops at per-field rules; multi-field constraints
 * become free-text `openQuestion`s that the LLM is expected to interpret —
 * a hallucination risk and an audit gap. This module fills that gap with
 * a typed AST evaluated by the engine itself; the LLM is no longer in the
 * loop for cross-field semantics.
 *
 * Key design choices:
 *
 *   - The expression language is a small **typed AST** — comparison,
 *     arithmetic, conditional (implies / and / or / not). It is NOT a
 *     string evaluator, NOT `eval`, NOT a regex DSL. Every node carries
 *     its own discriminant so the evaluator is total and side-effect-free.
 *   - The engine is **deterministic**: identical inputs (invariant + field
 *     values) produce identical outputs, byte-for-byte, with no
 *     randomness, no wall-clock, no implicit defaults.
 *   - **Boundary-value test-data synthesis** is a first-class output of
 *     the engine: every registered invariant ships with `bvaSeeds` —
 *     a small set of `(positive, negative)` field assignments that walk
 *     the boundary deliberately. The engine consumes these seeds, evaluates
 *     them against the AST, and refuses to register an invariant whose
 *     declared `expectedSatisfied` disagrees with the AST's verdict.
 *     Registry construction therefore double-checks every invariant.
 *   - Violations carry **field anchors** (`screenId` + `elementId` +
 *     logical `fieldRef`) so downstream artifacts can trace from a
 *     violation row back to the Figma node that motivated the rule.
 *
 * Out of scope for this engine (deliberately excluded to keep the AST
 * narrow and the evaluator total):
 *
 *   - Free-form locale conversions (decimal-comma vs decimal-period). The
 *     engine renders all numeric BVA values in ISO/period form; format
 *     parsing is the per-field oracle's job.
 *   - State-transition oracles (workflow lifecycle): the
 *     {@link CrossFieldInvariantContext} carries a flat field map, not a
 *     workflow-topology snapshot.
 *   - LLM-driven invariant suggestion. Issue #2110 acceptance notes that
 *     `mistral-large-3` may *suggest* invariants from form labels at
 *     design time, but the engine itself remains fully deterministic and
 *     the registry only accepts human-reviewed entries.
 */

/* -------------------------------------------------------------------- */
/*  Typed AST                                                            */
/* -------------------------------------------------------------------- */

/**
 * Numeric expression — arithmetic over field-bound or literal numbers.
 * Division by zero is treated as a contract violation: the evaluator
 * throws so a buggy invariant surfaces during registry construction
 * rather than silently returning NaN at audit time.
 */
export type InvariantNumberExpr =
  | { readonly kind: "number_lit"; readonly value: number }
  | { readonly kind: "field_number"; readonly fieldRef: string }
  | {
      readonly kind: "add";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "sub";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "mul";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "div";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "min";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "max";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    };

/**
 * String expression — narrow string-typed leaf. The engine treats string
 * fields as opaque values: equality, set-membership, and pinned-pattern
 * regex. Free-text matching is not supported; the registry should encode
 * such rules as `in_set_string` over a controlled vocabulary instead.
 */
export type InvariantStringExpr =
  | { readonly kind: "string_lit"; readonly value: string }
  | { readonly kind: "field_string"; readonly fieldRef: string };

/**
 * Boolean expression — the top-level `expression` of an invariant must
 * resolve to one of these. Comparisons, set membership, regex membership,
 * boolean composition (and / or / not), and the conditional `implies`
 * primitive cover the cross-field constraints encoded in the registry.
 */
export type InvariantBoolExpr =
  | { readonly kind: "bool_lit"; readonly value: boolean }
  | {
      readonly kind: "lt";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "lte";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "gt";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "gte";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
    }
  | {
      readonly kind: "eq_number";
      readonly left: InvariantNumberExpr;
      readonly right: InvariantNumberExpr;
      /** Absolute tolerance, default 0. */
      readonly tolerance?: number;
    }
  | {
      readonly kind: "eq_string";
      readonly left: InvariantStringExpr;
      readonly right: InvariantStringExpr;
      readonly caseInsensitive?: boolean;
    }
  | {
      readonly kind: "in_set_string";
      readonly value: InvariantStringExpr;
      readonly set: ReadonlyArray<string>;
      readonly caseInsensitive?: boolean;
    }
  | {
      readonly kind: "matches_regex";
      readonly value: InvariantStringExpr;
      readonly pattern: string;
      readonly flags?: string;
    }
  | {
      readonly kind: "field_present";
      readonly fieldRef: string;
    }
  | {
      readonly kind: "field_absent";
      readonly fieldRef: string;
    }
  | {
      readonly kind: "and";
      readonly operands: ReadonlyArray<InvariantBoolExpr>;
    }
  | {
      readonly kind: "or";
      readonly operands: ReadonlyArray<InvariantBoolExpr>;
    }
  | { readonly kind: "not"; readonly operand: InvariantBoolExpr }
  | {
      /** `if antecedent then consequent` — vacuously true when antecedent is false. */
      readonly kind: "implies";
      readonly antecedent: InvariantBoolExpr;
      readonly consequent: InvariantBoolExpr;
    };

/** Top-level expression of an invariant — always boolean. */
export type InvariantExpr = InvariantBoolExpr;

/* -------------------------------------------------------------------- */
/*  Anchors, citations, severity                                         */
/* -------------------------------------------------------------------- */

/**
 * Citation pointer to the regulation, calculation source, or business
 * policy the invariant enforces. Mirrors `DomainInvariantLegalSource`
 * from `domain-invariant-registry.ts` so auditors see a uniform shape
 * across both engines.
 */
export interface InvariantCitation {
  /** Short framework identifier — `PSD2`, `MiFID II`, `IDD`, `WpHG`, ... */
  readonly framework: string;
  /** Article + paragraph (or section) reference. */
  readonly citation: string;
  /** Optional canonical URL pointing to the consolidated source text. */
  readonly url?: string;
}

/**
 * Anchor referencing the screen + element a cross-field invariant
 * constrains. Anchors enable traceability from a violation row back to
 * the Figma node and the logical `fieldRef` the AST refers to.
 */
export interface FieldAnchor {
  /** Stable Figma screen identifier. */
  readonly screenId: string;
  /** Stable element identifier within the screen. */
  readonly elementId: string;
  /** Logical name used inside the AST (e.g. `"monthly_rate"`). */
  readonly fieldRef: string;
  /** Optional human-readable label, displayed in audit reports. */
  readonly label?: string;
}

/** Severity surfaced for a single cross-field invariant violation. */
export type CrossFieldInvariantSeverity = "error" | "warning";

/* -------------------------------------------------------------------- */
/*  Boundary-value seeds                                                 */
/* -------------------------------------------------------------------- */

/**
 * One concrete BVA assignment paired with the satisfaction verdict the
 * registry author *expects* the engine to return. The engine re-evaluates
 * the seed during registry construction and refuses to register the
 * invariant when the AST verdict disagrees with `expectedSatisfied` —
 * that means the invariant author is wrong and the registry would be
 * inconsistent at audit time.
 *
 * Field values are strings to keep the artifact byte-stable on disk
 * (numbers parse via `parseFloat` at evaluation time; the canonical-JSON
 * representation is therefore stable across IEEE-754 quirks for the
 * exact string values authored).
 */
export interface CrossFieldBoundaryAssignment {
  /** Short label that names the boundary case (e.g. `"DTI at 60% boundary"`). */
  readonly label: string;
  /**
   * Logical field name => string-rendered value. Numbers must use
   * period-decimal ISO form (the engine's
   * {@link evaluateInvariantExpression} parses with `parseFloat`).
   */
  readonly values: Readonly<Record<string, string>>;
  /** Whether the assignment should satisfy the invariant. */
  readonly expectedSatisfied: boolean;
  /** Auditor-facing rationale — why this assignment walks the boundary. */
  readonly rationale: string;
}

/* -------------------------------------------------------------------- */
/*  CrossFieldInvariant                                                  */
/* -------------------------------------------------------------------- */

/**
 * One typed cross-field invariant.
 *
 * The four required fields (`id`, `scope`, `expression`, `severity`,
 * `citation`) are the Issue #2110 acceptance contract. `description`,
 * `anchors`, and `bvaSeeds` are mandatory in this engine because they
 * are the contract-of-trust between a registry author and the
 * downstream validation pipeline:
 *
 *   - `anchors` give violation rows their audit trail.
 *   - `bvaSeeds` are the synthesizer's hand-curated boundary cases. The
 *     engine refuses to register an invariant without at least one
 *     `expectedSatisfied: true` *and* one `expectedSatisfied: false`
 *     seed — both halves of the boundary are required so the validation
 *     pipeline gate can prove a screen has positive + negative coverage.
 */
export interface CrossFieldInvariant {
  readonly id: string;
  /** Whether the invariant fires per-screen or across a multi-screen wizard. */
  readonly scope: "screen" | "wizard";
  /** Auditor-facing English description of the invariant. */
  readonly description: string;
  /** Typed AST expressing the constraint. */
  readonly expression: InvariantExpr;
  readonly severity: CrossFieldInvariantSeverity;
  readonly citation: InvariantCitation;
  /** Field anchors used for traceability on violations. */
  readonly anchors: ReadonlyArray<FieldAnchor>;
  /**
   * BVA seeds for synthesizing concrete positive + negative test data.
   * MUST contain at least one `expectedSatisfied: true` and one
   * `expectedSatisfied: false` entry; the registry validates this
   * invariant at construction time.
   */
  readonly bvaSeeds: ReadonlyArray<CrossFieldBoundaryAssignment>;
  /** Provenance — usually `"Issue #2110 (registered)"`. */
  readonly source: string;
}

/* -------------------------------------------------------------------- */
/*  Evaluator                                                            */
/* -------------------------------------------------------------------- */

/** Field map for evaluation. Keys are logical `fieldRef`s. */
export type CrossFieldValuation = Readonly<Record<string, string>>;

/** Result of evaluating one assignment against one invariant. */
export interface CrossFieldEvaluationResult {
  readonly invariantId: string;
  readonly satisfied: boolean;
  /** True when the antecedent of an `implies` chain is false (vacuous truth). */
  readonly vacuous: boolean;
  /** Field anchors involved in the evaluation, in registration order. */
  readonly anchors: ReadonlyArray<FieldAnchor>;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const requireNumber = (raw: string | undefined, fieldRef: string): number => {
  if (raw === undefined) {
    throw new Error(
      `cross-field-invariant-engine: numeric field "${fieldRef}" is missing from the valuation`,
    );
  }
  const parsed = Number.parseFloat(raw);
  if (!isFiniteNumber(parsed)) {
    throw new Error(
      `cross-field-invariant-engine: numeric field "${fieldRef}" has non-numeric value "${raw}"`,
    );
  }
  return parsed;
};

const requireString = (raw: string | undefined, fieldRef: string): string => {
  if (raw === undefined) {
    throw new Error(
      `cross-field-invariant-engine: string field "${fieldRef}" is missing from the valuation`,
    );
  }
  return raw;
};

/** Evaluate a numeric AST node against a valuation. */
export const evaluateNumberExpr = (
  expr: InvariantNumberExpr,
  valuation: CrossFieldValuation,
): number => {
  switch (expr.kind) {
    case "number_lit":
      if (!isFiniteNumber(expr.value)) {
        throw new Error(
          `cross-field-invariant-engine: literal must be a finite number, got ${expr.value}`,
        );
      }
      return expr.value;
    case "field_number":
      return requireNumber(valuation[expr.fieldRef], expr.fieldRef);
    case "add":
      return (
        evaluateNumberExpr(expr.left, valuation) +
        evaluateNumberExpr(expr.right, valuation)
      );
    case "sub":
      return (
        evaluateNumberExpr(expr.left, valuation) -
        evaluateNumberExpr(expr.right, valuation)
      );
    case "mul":
      return (
        evaluateNumberExpr(expr.left, valuation) *
        evaluateNumberExpr(expr.right, valuation)
      );
    case "div": {
      const denom = evaluateNumberExpr(expr.right, valuation);
      if (denom === 0) {
        throw new Error(
          "cross-field-invariant-engine: division by zero in invariant expression",
        );
      }
      return evaluateNumberExpr(expr.left, valuation) / denom;
    }
    case "min":
      return Math.min(
        evaluateNumberExpr(expr.left, valuation),
        evaluateNumberExpr(expr.right, valuation),
      );
    case "max":
      return Math.max(
        evaluateNumberExpr(expr.left, valuation),
        evaluateNumberExpr(expr.right, valuation),
      );
  }
};

const evaluateStringExpr = (
  expr: InvariantStringExpr,
  valuation: CrossFieldValuation,
): string => {
  switch (expr.kind) {
    case "string_lit":
      return expr.value;
    case "field_string":
      return requireString(valuation[expr.fieldRef], expr.fieldRef);
  }
};

/**
 * Evaluate a boolean expression. The third tuple member is `vacuous` —
 * `true` when an `implies` antecedent was false, so the invariant is
 * trivially satisfied. Vacuous results count as `satisfied = true` but
 * the validation-pipeline gate uses the flag to refuse counting a
 * vacuous case as positive coverage.
 */
export const evaluateBoolExpr = (
  expr: InvariantBoolExpr,
  valuation: CrossFieldValuation,
): { satisfied: boolean; vacuous: boolean } => {
  switch (expr.kind) {
    case "bool_lit":
      return { satisfied: expr.value, vacuous: false };
    case "lt":
      return {
        satisfied:
          evaluateNumberExpr(expr.left, valuation) <
          evaluateNumberExpr(expr.right, valuation),
        vacuous: false,
      };
    case "lte":
      return {
        satisfied:
          evaluateNumberExpr(expr.left, valuation) <=
          evaluateNumberExpr(expr.right, valuation),
        vacuous: false,
      };
    case "gt":
      return {
        satisfied:
          evaluateNumberExpr(expr.left, valuation) >
          evaluateNumberExpr(expr.right, valuation),
        vacuous: false,
      };
    case "gte":
      return {
        satisfied:
          evaluateNumberExpr(expr.left, valuation) >=
          evaluateNumberExpr(expr.right, valuation),
        vacuous: false,
      };
    case "eq_number": {
      const tol = expr.tolerance ?? 0;
      if (tol < 0 || !isFiniteNumber(tol)) {
        throw new Error(
          `cross-field-invariant-engine: eq_number tolerance must be a non-negative finite number, got ${tol}`,
        );
      }
      const lhs = evaluateNumberExpr(expr.left, valuation);
      const rhs = evaluateNumberExpr(expr.right, valuation);
      return { satisfied: Math.abs(lhs - rhs) <= tol, vacuous: false };
    }
    case "eq_string": {
      const lhs = evaluateStringExpr(expr.left, valuation);
      const rhs = evaluateStringExpr(expr.right, valuation);
      const matches = expr.caseInsensitive
        ? lhs.toLowerCase() === rhs.toLowerCase()
        : lhs === rhs;
      return { satisfied: matches, vacuous: false };
    }
    case "in_set_string": {
      const value = evaluateStringExpr(expr.value, valuation);
      const needle = expr.caseInsensitive ? value.toLowerCase() : value;
      const matches = expr.set.some((entry) =>
        expr.caseInsensitive ? entry.toLowerCase() === needle : entry === value,
      );
      return { satisfied: matches, vacuous: false };
    }
    case "matches_regex": {
      const value = evaluateStringExpr(expr.value, valuation);
      const re = new RegExp(expr.pattern, expr.flags ?? "");
      return { satisfied: re.test(value), vacuous: false };
    }
    case "field_present": {
      const raw = valuation[expr.fieldRef];
      return {
        satisfied: typeof raw === "string" && raw.length > 0,
        vacuous: false,
      };
    }
    case "field_absent": {
      const raw = valuation[expr.fieldRef];
      return {
        satisfied: raw === undefined || raw.length === 0,
        vacuous: false,
      };
    }
    case "and": {
      let vacuousAll = true;
      for (const operand of expr.operands) {
        const child = evaluateBoolExpr(operand, valuation);
        if (!child.satisfied) {
          return { satisfied: false, vacuous: false };
        }
        if (!child.vacuous) vacuousAll = false;
      }
      return {
        satisfied: true,
        vacuous: expr.operands.length > 0 ? vacuousAll : false,
      };
    }
    case "or": {
      let vacuousAll = true;
      for (const operand of expr.operands) {
        const child = evaluateBoolExpr(operand, valuation);
        if (child.satisfied) {
          return { satisfied: true, vacuous: child.vacuous };
        }
        if (!child.vacuous) vacuousAll = false;
      }
      return {
        satisfied: false,
        vacuous: expr.operands.length > 0 ? vacuousAll : false,
      };
    }
    case "not": {
      const child = evaluateBoolExpr(expr.operand, valuation);
      return { satisfied: !child.satisfied, vacuous: child.vacuous };
    }
    case "implies": {
      const antecedent = evaluateBoolExpr(expr.antecedent, valuation);
      if (!antecedent.satisfied) {
        return { satisfied: true, vacuous: true };
      }
      const consequent = evaluateBoolExpr(expr.consequent, valuation);
      return { satisfied: consequent.satisfied, vacuous: false };
    }
  }
};

/** Public top-level entry point. */
export const evaluateInvariantExpression = (
  expression: InvariantExpr,
  valuation: CrossFieldValuation,
): { satisfied: boolean; vacuous: boolean } =>
  evaluateBoolExpr(expression, valuation);

/* -------------------------------------------------------------------- */
/*  Field-reference collection                                           */
/* -------------------------------------------------------------------- */

/**
 * Collect every `fieldRef` referenced inside an expression. The set is
 * returned sorted (lexicographic) so registry self-checks and audit
 * artifacts are byte-stable.
 */
export const collectInvariantFieldRefs = (
  expression: InvariantExpr,
): ReadonlyArray<string> => {
  const out = new Set<string>();
  const visitNumber = (node: InvariantNumberExpr): void => {
    switch (node.kind) {
      case "number_lit":
        return;
      case "field_number":
        out.add(node.fieldRef);
        return;
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "min":
      case "max":
        visitNumber(node.left);
        visitNumber(node.right);
        return;
    }
  };
  const visitString = (node: InvariantStringExpr): void => {
    if (node.kind === "field_string") out.add(node.fieldRef);
  };
  const visitBool = (node: InvariantBoolExpr): void => {
    switch (node.kind) {
      case "bool_lit":
        return;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "eq_number":
        visitNumber(node.left);
        visitNumber(node.right);
        return;
      case "eq_string":
        visitString(node.left);
        visitString(node.right);
        return;
      case "in_set_string":
      case "matches_regex":
        visitString(node.value);
        return;
      case "field_present":
      case "field_absent":
        out.add(node.fieldRef);
        return;
      case "and":
      case "or":
        for (const operand of node.operands) visitBool(operand);
        return;
      case "not":
        visitBool(node.operand);
        return;
      case "implies":
        visitBool(node.antecedent);
        visitBool(node.consequent);
        return;
    }
  };
  visitBool(expression);
  return [...out].sort((left, right) => left.localeCompare(right));
};

/* -------------------------------------------------------------------- */
/*  Registry                                                              */
/* -------------------------------------------------------------------- */

const ID_RE = /^XINV-[A-Z0-9-]{1,40}$/;

const validateInvariant = (invariant: CrossFieldInvariant): void => {
  if (!ID_RE.test(invariant.id)) {
    throw new Error(
      `cross-field-invariant-engine: id "${invariant.id}" must match ${ID_RE.source}`,
    );
  }
  if (invariant.description.trim().length === 0) {
    throw new Error(
      `cross-field-invariant-engine: invariant "${invariant.id}" must declare a non-empty description`,
    );
  }
  if (invariant.anchors.length === 0) {
    throw new Error(
      `cross-field-invariant-engine: invariant "${invariant.id}" must declare at least one field anchor`,
    );
  }
  // Every fieldRef in the AST must have a corresponding anchor — this is
  // the traceability contract: a violation can always point back to a
  // concrete (screenId, elementId) pair.
  const exprRefs = new Set(collectInvariantFieldRefs(invariant.expression));
  const anchorRefs = new Set(
    invariant.anchors.map((anchor) => anchor.fieldRef),
  );
  for (const ref of exprRefs) {
    if (!anchorRefs.has(ref)) {
      throw new Error(
        `cross-field-invariant-engine: invariant "${invariant.id}" references field "${ref}" without a matching anchor`,
      );
    }
  }
  // BVA seeds: at least one positive + one negative.
  const hasPositive = invariant.bvaSeeds.some(
    (seed) => seed.expectedSatisfied,
  );
  const hasNegative = invariant.bvaSeeds.some(
    (seed) => !seed.expectedSatisfied,
  );
  if (!hasPositive || !hasNegative) {
    throw new Error(
      `cross-field-invariant-engine: invariant "${invariant.id}" must declare at least one positive and one negative bvaSeed`,
    );
  }
  // Engine-author cross-check: every seed must round-trip through the
  // evaluator with a verdict matching its declared `expectedSatisfied`.
  let nonVacuousPositiveSeen = false;
  for (const seed of invariant.bvaSeeds) {
    const verdict = evaluateInvariantExpression(
      invariant.expression,
      seed.values,
    );
    if (verdict.satisfied !== seed.expectedSatisfied) {
      throw new Error(
        `cross-field-invariant-engine: bvaSeed "${seed.label}" of invariant "${invariant.id}" expected satisfied=${seed.expectedSatisfied} but engine returned ${verdict.satisfied}`,
      );
    }
    if (seed.expectedSatisfied && !verdict.vacuous) {
      nonVacuousPositiveSeen = true;
    }
  }
  // Vacuous truth (an `implies` whose antecedent is false) is allowed as
  // a positive seed for documentation and BVA breadth, but the registry
  // requires at least one *non-vacuous* positive seed: otherwise a
  // wizard could pass the validation gate with only "antecedent never
  // matched" coverage and never actually exercise the consequent.
  if (!nonVacuousPositiveSeen) {
    throw new Error(
      `cross-field-invariant-engine: invariant "${invariant.id}" must declare at least one non-vacuous positive bvaSeed (one where the antecedent matches and the consequent holds)`,
    );
  }
};

/** Mutable registry of {@link CrossFieldInvariant} entries. */
export interface CrossFieldInvariantRegistry {
  register(invariant: CrossFieldInvariant): void;
  list(): readonly CrossFieldInvariant[];
  ids(): readonly string[];
  byScreen(screenId: string): readonly CrossFieldInvariant[];
}

/** Build a fresh empty registry. */
export const createCrossFieldInvariantRegistry =
  (): CrossFieldInvariantRegistry => {
    const byId = new Map<string, CrossFieldInvariant>();
    return {
      register(invariant) {
        validateInvariant(invariant);
        if (byId.has(invariant.id)) {
          throw new Error(
            `cross-field-invariant-engine: invariant id "${invariant.id}" is already registered`,
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
        return [...byId.keys()].sort((left, right) =>
          left.localeCompare(right),
        );
      },
      byScreen(screenId) {
        return [...byId.values()]
          .filter((invariant) =>
            invariant.anchors.some((anchor) => anchor.screenId === screenId),
          )
          .sort((left, right) => left.id.localeCompare(right.id));
      },
    };
  };

/* -------------------------------------------------------------------- */
/*  Engine: BVA test-data synthesis                                       */
/* -------------------------------------------------------------------- */

/**
 * One synthesized cross-field test datum. The shape is intentionally
 * close to the per-field `OracleValue` so downstream consumers can treat
 * cross-field and per-field synthetic data uniformly — the
 * `category` discriminator distinguishes the two boundary halves.
 */
export interface CrossFieldOracleValue {
  readonly invariantId: string;
  readonly label: string;
  readonly category: "cross_field_positive" | "cross_field_negative";
  readonly values: Readonly<Record<string, string>>;
  readonly anchors: ReadonlyArray<FieldAnchor>;
  readonly rationale: string;
  readonly synthetic: true;
}

/**
 * Synthesize concrete BVA test data (positive + negative) for a single
 * invariant. The output is sorted (positive first, then negative) and
 * stable across runs — the registry's seeds drive the order, and the
 * engine refuses to produce data when an invariant lacks both halves
 * (the registry's `validateInvariant` already enforces this).
 */
export const synthesizeCrossFieldTestData = (
  invariant: CrossFieldInvariant,
): ReadonlyArray<CrossFieldOracleValue> => {
  const out: CrossFieldOracleValue[] = [];
  for (const seed of invariant.bvaSeeds) {
    out.push({
      invariantId: invariant.id,
      label: seed.label,
      category: seed.expectedSatisfied
        ? "cross_field_positive"
        : "cross_field_negative",
      values: seed.values,
      anchors: invariant.anchors,
      rationale: seed.rationale,
      synthetic: true,
    });
  }
  // Stable: positive first, then negative; tie-break by label.
  out.sort((left, right) => {
    if (left.category !== right.category) {
      return left.category === "cross_field_positive" ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
  return out;
};

/* -------------------------------------------------------------------- */
/*  Violation row                                                        */
/* -------------------------------------------------------------------- */

/**
 * One cross-field violation. Carries both the invariant id and its
 * field anchors so audit reports can render `(screenId, elementId, rule)`
 * triples without re-joining against the registry.
 */
export interface CrossFieldInvariantViolation {
  readonly invariantId: string;
  readonly screenId: string;
  readonly elementId: string;
  readonly fieldRef: string;
  readonly path: string;
  readonly severity: CrossFieldInvariantSeverity;
  readonly message: string;
  readonly citation: InvariantCitation;
  readonly source: string;
}

/**
 * Evaluate one valuation against an invariant; return a
 * {@link CrossFieldInvariantViolation} per anchor when `holds` is false,
 * or the empty array when the valuation satisfies the invariant.
 *
 * The function is deliberately dumb: callers (the validation-pipeline
 * gate or a benchmark) decide whether to evaluate at all (for example,
 * a positive-flow case need not be re-evaluated against an invariant
 * the case is meant to violate). One row per anchor lets downstream
 * artifacts surface the violation against every constrained field.
 */
export const evaluateValuationAgainstInvariant = (
  invariant: CrossFieldInvariant,
  valuation: CrossFieldValuation,
): {
  readonly result: CrossFieldEvaluationResult;
  readonly violations: ReadonlyArray<CrossFieldInvariantViolation>;
} => {
  const verdict = evaluateInvariantExpression(invariant.expression, valuation);
  const result: CrossFieldEvaluationResult = {
    invariantId: invariant.id,
    satisfied: verdict.satisfied,
    vacuous: verdict.vacuous,
    anchors: invariant.anchors,
  };
  if (verdict.satisfied) {
    return { result, violations: [] };
  }
  const violations = invariant.anchors.map(
    (anchor): CrossFieldInvariantViolation => ({
      invariantId: invariant.id,
      screenId: anchor.screenId,
      elementId: anchor.elementId,
      fieldRef: anchor.fieldRef,
      path: `screens[${anchor.screenId}].elements[${anchor.elementId}]`,
      severity: invariant.severity,
      message: `${invariant.id}: ${invariant.description}`,
      citation: invariant.citation,
      source: invariant.source,
    }),
  );
  return { result, violations };
};
