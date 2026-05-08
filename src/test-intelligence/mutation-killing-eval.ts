/**
 * Mutation-killing-eval suite (Issue #2041).
 *
 * Coverage metrics describe what the generated test suite *exercises*; the
 * mutation-killing eval describes what it *detects*. The suite injects a
 * curated catalog of synthetic SUT bugs ("mutations") into a deterministic
 * synthetic SUT stub derived from the customer-eval rubric, then asks each
 * generated test case whether its expected results would diverge from the
 * mutated SUT's behavior. The fraction of catalog entries killed by at
 * least one accepted case is surfaced as the top-level
 * {@link MutationKillRateSummary} KPI alongside `policy-report.json`.
 *
 * The synthetic SUT is implicit: a mutation defines two predicates over a
 * test case + context — `applies` (is the case in scope of the mutation?)
 * and `kills` (is the case's expected result specific enough to detect
 * the mutated behavior?). No real SUT execution is required; the
 * evaluator is fully deterministic and never calls the LLM gateway, so it
 * stays well below the documented FinOps token-budget cap
 * ({@link MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP}).
 *
 * The catalog covers the mutation classes the issue spec calls out:
 *
 *   - field-required-flipped       — required input flipped to optional
 *   - vat-applied-to-netto         — VAT added to a netto amount
 *   - currency-rounding-off-by-one — totals drift by one cent
 *   - boundary-off-by-one          — `>=` flipped to `>` at a boundary
 *   - state-transition-skipped     — workflow step bypassed
 *   - regex-relaxed                — validation pattern accepts bad input
 *   - null-equals-empty            — null/empty conflated
 *   - optional-cost-treated-required — optional cost made required
 *   - currency-locale-confusion    — euro treated as dollar
 *   - error-message-suppressed     — required error text removed
 *   - accessibility-name-removed   — labelled element loses accessible name
 *   - iban-checksum-skipped        — IBAN checksum bypassed
 *   - pii-redaction-disabled       — PII appears unredacted
 *   - four-eyes-principle-skipped  — dual-control bypass
 *   - audit-log-omitted            — audit row not written
 *
 * Pair with B.3: the property-based domain-invariant layer (Issue #2040)
 * registers fail-closed safety predicates; the mutation eval registers the
 * dual — known bug archetypes a defensible suite must catch. Every
 * domain-invariant id has at least one mutation that violates it.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ALLOWED_MUTATION_CLASSES,
  MUTATION_KILL_RATE_DEFAULT_THRESHOLD,
  MUTATION_REPORT_ARTIFACT_FILENAME,
  MUTATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type MutationClass,
  type MutationClassKillRate,
  type MutationEvaluation,
  type MutationKillRateSummary,
  type MutationReport,
  type MutationSeverity,
  type TestDesignModel,
} from "../contracts/index.js";

export {
  ALLOWED_MUTATION_CLASSES,
  MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP,
  MUTATION_KILL_RATE_DEFAULT_THRESHOLD,
  MUTATION_REPORT_ARTIFACT_FILENAME,
  MUTATION_REPORT_SCHEMA_VERSION,
} from "../contracts/index.js";

/** Context passed to mutation predicates. */
export interface MutationContext {
  readonly intent: BusinessTestIntentIr;
  readonly model?: TestDesignModel;
}

/** Single registered mutation. */
export interface Mutation {
  readonly id: string;
  readonly mutationClass: MutationClass;
  readonly description: string;
  readonly source: string;
  readonly severity: MutationSeverity;
  readonly applies: (
    testCase: GeneratedTestCase,
    context: MutationContext,
  ) => boolean;
  readonly kills: (
    testCase: GeneratedTestCase,
    context: MutationContext,
  ) => boolean;
}

/** Mutable mutation catalog. */
export interface MutationCatalog {
  register(mutation: Mutation): void;
  list(): readonly Mutation[];
  ids(): readonly string[];
}

const ID_RE = /^MUT-[A-Z0-9-]{1,60}$/;

const validateMutation = (mutation: Mutation): void => {
  if (!ID_RE.test(mutation.id)) {
    throw new Error(
      `mutation-killing-eval: mutation id "${mutation.id}" must match ${ID_RE.source}`,
    );
  }
  if (mutation.description.trim().length === 0) {
    throw new Error(
      `mutation-killing-eval: mutation "${mutation.id}" must declare a non-empty description`,
    );
  }
  if (mutation.source.trim().length === 0) {
    throw new Error(
      `mutation-killing-eval: mutation "${mutation.id}" must declare a non-empty source`,
    );
  }
  if (!ALLOWED_MUTATION_CLASSES.includes(mutation.mutationClass)) {
    throw new Error(
      `mutation-killing-eval: mutation "${mutation.id}" declares unknown class "${mutation.mutationClass}"`,
    );
  }
};

/** Build a fresh empty catalog. */
export const createMutationCatalog = (): MutationCatalog => {
  const byId = new Map<string, Mutation>();
  return {
    register(mutation) {
      validateMutation(mutation);
      if (byId.has(mutation.id)) {
        throw new Error(
          `mutation-killing-eval: mutation id "${mutation.id}" is already registered`,
        );
      }
      byId.set(mutation.id, mutation);
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
/*  Catalog helpers                                                      */
/* -------------------------------------------------------------------- */

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

const REQUIRED_RE =
  /\b(required|pflicht(?:feld|angabe|eingabe)?|mandatory|must (?:be (?:provided|filled|entered)|provide))\b/i;
const BLOCKED_SUBMIT_RE =
  /\b(submit (?:is )?disabled|submission (?:is )?(?:blocked|prevented)|cannot submit|button (?:is )?disabled|prevent(?:s|ed)? submission)\b/i;
const VALIDATION_ERROR_RE =
  /\b(validation (?:error|fails)|error message|fehlermeldung|invalid input|rejected|abgewiesen)\b/i;

const NETTO_RE = /\b(netto|net amount)\b/i;
const VAT_EXCLUDED_RE =
  /\b(without vat|excludes? vat|vat[- ]?(?:free|excluded|exempt)|ohne mwst|ohne mehrwertsteuer|netto[- ]?betrag|exclusive of vat)\b/i;
const FINANCING_NEED_RE =
  /\b(financing need|finanzierungsbedarf|loan amount|funding need)\b/i;

const MONEY_RE = /[€$£]\s?\d|\d[.,]\d{2}\s?(?:€|eur|usd|chf|gbp)\b/i;
const TWO_DECIMAL_RE = /\d+[.,]\d{2}\b/;
const CURRENCY_EUR_RE = /\b(?:eur|euro|€)\b/i;
const CURRENCY_USD_RE = /\b(?:usd|dollar|\$)\b/i;

const BOUNDARY_RE =
  /\b(min(?:imum)?|max(?:imum)?|boundary|grenzwert|at most|at least|exactly|genau|>= ?\d|<= ?\d|>\s?\d|<\s?\d)\b/i;
const NUMERIC_BOUNDARY_RE = /\b\d+\s*(?:char(?:acter)?s?|digits?|zeichen)\b/i;

const WORKFLOW_STEP_RE =
  /\b(navigate|redirect|after submit|next screen|return to|back to|step \d|after (?:save|submit|approve))\b/i;
const RECEIPT_RE =
  /\b(receipt|confirmation|bestätigung|quittung|success page|next page)\b/i;

const REGEX_RE =
  /\b(format|pattern|regex|regular expression|email format|phone format|iban format)\b/i;
const REJECT_RE =
  /\b(reject(?:s|ed)?|refuse(?:s|d)?|decline(?:s|d)?|invalid|abgewiesen)\b/i;

const NULL_VS_EMPTY_RE =
  /\b(null|undefined|leer(?:es)?|empty|blank|no value|not provided)\b/i;

const OPTIONAL_COST_RE =
  /\b(optional (?:cost|fee|charge|aufpreis)|optional[ae]r? (?:kosten|gebühr|aufpreis))\b/i;
const SELECTED_RE =
  /\b(selected|chosen|opt(?:ed)?[- ]in|aktiviert|gewählt|opt[- ]in)\b/i;

const ERROR_MESSAGE_RE =
  /\b(error message|fehlermeldung|displays? (?:an? )?error|shows? (?:an? )?error|surface(?:s|d)? (?:an? )?error)\b/i;

const A11Y_NAME_RE =
  /\b(accessible name|aria[- ]label|screen reader (?:reads|announces|name)|labelled by|focus order|focus management|keyboard accessible|tab order)\b/i;

const IBAN_RE = /\b(iban|international bank account|bic|swift)\b/i;
const IBAN_INVALID_RE =
  /\b(invalid iban|iban (?:check|checksum) (?:fail(?:s|ed)?|invalid)|wrong iban)\b/i;

const PII_RE = /\b(pii|customer name|account number|kontonummer|vertragsnummer|personenbezogene daten|redact(?:ed|ion)?|maskier(?:t|ung))\b/i;

const FOUR_EYES_RE =
  /\b(four[- ]eyes|dual[- ]control|second approver|maker[- ]checker|vier[- ]augen|zweite freigabe|second person)\b/i;

const AUDIT_LOG_RE =
  /\b(audit (?:log|trail|entry|row)|log entry|audit-trail|protokolliert|audit record)\b/i;

const CALCULATION_RE =
  /\b(calculation|sum|total|gesamt(?:summe|preis)|berechnung|amount due|computed)\b/i;

/* -------------------------------------------------------------------- */
/*  Catalog                                                              */
/* -------------------------------------------------------------------- */

const isRequiredValidation = (rule: string): boolean =>
  /\b(required|mandatory|pflicht)\b/i.test(rule);

const isPatternValidation = (rule: string): boolean =>
  /\b(pattern|format|regex|email|phone|iban|postal|zip)\b/i.test(rule);

const isSubmitAction = (kind: string): boolean =>
  /\b(submit|save|approve|confirm|continue|complete|absenden|speichern|freigeben|bestätigen)\b/i.test(
    kind,
  );

const buildFieldRequiredFlippedMutation = (): Mutation => ({
  id: "MUT-FIELD-REQ-FLIP-01",
  mutationClass: "field-required-flipped",
  description:
    "A field that the spec marks required is treated as optional by the SUT. The case kills it by asserting that submission is blocked when the required field is empty.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const hasRequiredValidation = context.intent.detectedValidations.some(
      (validation) => isRequiredValidation(validation.rule),
    );
    if (!hasRequiredValidation && !caseTextMatches(testCase, REQUIRED_RE)) {
      return false;
    }
    return (
      caseTextMatches(testCase, REQUIRED_RE) ||
      testCase.type === "validation" ||
      testCase.type === "negative"
    );
  },
  kills: (testCase) =>
    (caseTextMatches(testCase, REQUIRED_RE) ||
      caseTextMatches(testCase, VALIDATION_ERROR_RE)) &&
    (caseTextMatches(testCase, BLOCKED_SUBMIT_RE) ||
      caseTextMatches(testCase, ERROR_MESSAGE_RE) ||
      caseTextMatches(testCase, REJECT_RE)),
});

const buildVatAppliedToNettoMutation = (): Mutation => ({
  id: "MUT-VAT-NETTO-01",
  mutationClass: "vat-applied-to-netto",
  description:
    "VAT is incorrectly added on top of a Netto amount. The case kills it by asserting a VAT-excluded total or a Netto-only result.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const inFinancingFlow =
      caseTextMatches(testCase, FINANCING_NEED_RE) ||
      caseTextMatches(testCase, NETTO_RE) ||
      context.intent.detectedFields.some((field) =>
        NETTO_RE.test(field.label),
      );
    return inFinancingFlow && caseTextMatches(testCase, CALCULATION_RE);
  },
  kills: (testCase) =>
    caseTextMatches(testCase, VAT_EXCLUDED_RE) ||
    (caseTextMatches(testCase, NETTO_RE) && caseTextMatches(testCase, MONEY_RE)),
});

const buildCurrencyRoundingMutation = (): Mutation => ({
  id: "MUT-CURRENCY-ROUND-01",
  mutationClass: "currency-rounding-off-by-one",
  description:
    "Final monetary totals drift by one cent due to wrong rounding direction. The case kills it by pinning the expected total to two decimals.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) =>
    caseTextMatches(testCase, CALCULATION_RE) &&
    caseTextMatches(testCase, MONEY_RE),
  kills: (testCase) => {
    for (const text of collectCaseStrings(testCase)) {
      if (TWO_DECIMAL_RE.test(text)) return true;
    }
    return false;
  },
});

const buildBoundaryOffByOneMutation = (): Mutation => ({
  id: "MUT-BOUNDARY-OFF-01",
  mutationClass: "boundary-off-by-one",
  description:
    "A `>=` is flipped to `>` (or vice versa) at a numeric/length boundary. The case kills it by asserting the exact boundary value, not just the happy-path interior.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) =>
    testCase.type === "boundary" || caseTextMatches(testCase, BOUNDARY_RE),
  kills: (testCase) =>
    testCase.type === "boundary" &&
    (caseTextMatches(testCase, BOUNDARY_RE) ||
      caseTextMatches(testCase, NUMERIC_BOUNDARY_RE)) &&
    (caseTextMatches(testCase, REJECT_RE) ||
      caseTextMatches(testCase, BLOCKED_SUBMIT_RE) ||
      caseTextMatches(testCase, ERROR_MESSAGE_RE)),
});

const buildStateTransitionSkippedMutation = (): Mutation => ({
  id: "MUT-STATE-TRANSITION-SKIP-01",
  mutationClass: "state-transition-skipped",
  description:
    "A workflow step (e.g. confirmation, receipt navigation) is skipped. The case kills it by asserting the post-transition screen / state.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const hasNavigation =
      context.intent.detectedNavigation.length > 0 ||
      context.intent.detectedActions.some((action) =>
        isSubmitAction(action.kind),
      );
    return (
      hasNavigation &&
      (testCase.type === "navigation" || testCase.type === "functional")
    );
  },
  kills: (testCase) =>
    testCase.type === "navigation" &&
    (caseTextMatches(testCase, WORKFLOW_STEP_RE) ||
      caseTextMatches(testCase, RECEIPT_RE)),
});

const buildRegexRelaxedMutation = (): Mutation => ({
  id: "MUT-REGEX-RELAX-01",
  mutationClass: "regex-relaxed",
  description:
    "A validation pattern is widened so it accepts inputs it should reject. The case kills it by asserting that an off-pattern input is rejected.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const hasPatternValidation = context.intent.detectedValidations.some(
      (validation) => isPatternValidation(validation.rule),
    );
    return (
      hasPatternValidation &&
      (testCase.type === "validation" || testCase.type === "negative")
    );
  },
  kills: (testCase) =>
    caseTextMatches(testCase, REGEX_RE) &&
    caseTextMatches(testCase, REJECT_RE),
});

const buildNullEqualsEmptyMutation = (): Mutation => ({
  id: "MUT-NULL-EMPTY-01",
  mutationClass: "null-equals-empty",
  description:
    "Null is treated as an empty string (or vice versa). The case kills it by exercising the null/empty distinction in either preconditions or expected results.",
  source: "Issue #2041 (registered)",
  severity: "warning",
  applies: (testCase) =>
    testCase.type === "negative" || testCase.type === "validation",
  kills: (testCase) => caseTextMatches(testCase, NULL_VS_EMPTY_RE),
});

const buildOptionalCostMutation = (): Mutation => ({
  id: "MUT-OPTIONAL-COST-FLIP-01",
  mutationClass: "optional-cost-treated-required",
  description:
    "An optional cost field is treated as required by the SUT. The case kills it by exercising the optional-flow without selecting the cost.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) => caseTextMatches(testCase, OPTIONAL_COST_RE),
  kills: (testCase) => {
    if (!caseTextMatches(testCase, OPTIONAL_COST_RE)) return false;
    const declaresUnselected = testCase.preconditions.some((text) =>
      /\b(not selected|nicht (?:gewählt|aktiviert)|left empty|leer)\b/i.test(
        text,
      ),
    );
    const positiveFlowWithoutSelect =
      testCase.type === "functional" &&
      !testCase.preconditions.some((text) =>
        SELECTED_RE.test(text),
      ) &&
      !testCase.steps.some((step) => SELECTED_RE.test(step.action));
    return declaresUnselected || positiveFlowWithoutSelect;
  },
});

const buildCurrencyLocaleMutation = (): Mutation => ({
  id: "MUT-CURRENCY-LOCALE-01",
  mutationClass: "currency-locale-confusion",
  description:
    "A euro amount is treated as a USD amount in the calculation. The case kills it by pinning the currency code in the expected total.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) =>
    caseTextMatches(testCase, CALCULATION_RE) &&
    (caseTextMatches(testCase, CURRENCY_EUR_RE) ||
      caseTextMatches(testCase, CURRENCY_USD_RE)),
  kills: (testCase) => {
    const expectedHasCurrency = testCase.expectedResults.some(
      (text) => CURRENCY_EUR_RE.test(text) || CURRENCY_USD_RE.test(text),
    );
    const stepHasCurrency = testCase.steps.some((step) =>
      typeof step.expected === "string"
        ? CURRENCY_EUR_RE.test(step.expected) ||
          CURRENCY_USD_RE.test(step.expected)
        : false,
    );
    return expectedHasCurrency || stepHasCurrency;
  },
});

const buildErrorMessageSuppressedMutation = (): Mutation => ({
  id: "MUT-ERROR-MSG-SUPPRESS-01",
  mutationClass: "error-message-suppressed",
  description:
    "A required error message no longer surfaces on a negative-flow case. The case kills it by asserting the error text or its presence.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) =>
    testCase.type === "negative" || testCase.type === "validation",
  kills: (testCase) =>
    caseTextMatches(testCase, ERROR_MESSAGE_RE) ||
    caseTextMatches(testCase, VALIDATION_ERROR_RE),
});

const buildAccessibilityNameMutation = (): Mutation => ({
  id: "MUT-A11Y-NAME-REMOVED-01",
  mutationClass: "accessibility-name-removed",
  description:
    "A labelled element loses its accessible name. The case kills it by asserting the screen-reader / focus / aria contract.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) => testCase.type === "accessibility",
  kills: (testCase) => caseTextMatches(testCase, A11Y_NAME_RE),
});

const buildIbanChecksumMutation = (): Mutation => ({
  id: "MUT-IBAN-CHECKSUM-SKIP-01",
  mutationClass: "iban-checksum-skipped",
  description:
    "IBAN checksum validation is bypassed. The case kills it by exercising an invalid-IBAN input and asserting rejection.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const hasIbanField =
      context.intent.detectedFields.some((field) => IBAN_RE.test(field.label)) ||
      caseTextMatches(testCase, IBAN_RE);
    return hasIbanField && (testCase.type === "negative" || testCase.type === "validation");
  },
  kills: (testCase) =>
    caseTextMatches(testCase, IBAN_RE) &&
    (caseTextMatches(testCase, IBAN_INVALID_RE) ||
      caseTextMatches(testCase, REJECT_RE)),
});

const buildPiiRedactionMutation = (): Mutation => ({
  id: "MUT-PII-REDACT-DISABLE-01",
  mutationClass: "pii-redaction-disabled",
  description:
    "PII appears unredacted in a downstream artifact. The case kills it by asserting the redaction / masking contract.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase) => caseTextMatches(testCase, PII_RE),
  kills: (testCase) =>
    caseTextMatches(testCase, PII_RE) &&
    /\b(redact(?:ed|ion)?|maskier(?:t|ung)|masked|hidden|obscured)\b/i.test(
      collectCaseStrings(testCase).join("\n"),
    ),
});

const buildFourEyesMutation = (): Mutation => ({
  id: "MUT-FOUR-EYES-SKIP-01",
  mutationClass: "four-eyes-principle-skipped",
  description:
    "A state-changing action skips the four-eyes / dual-control gate. The case kills it by asserting the second-approver requirement.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (testCase, context) => {
    const isStateChanging = context.intent.detectedActions.some((action) =>
      isSubmitAction(action.kind),
    );
    return isStateChanging && testCase.type !== "accessibility";
  },
  kills: (testCase) => caseTextMatches(testCase, FOUR_EYES_RE),
});

const buildAuditLogMutation = (): Mutation => ({
  id: "MUT-AUDIT-LOG-OMIT-01",
  mutationClass: "audit-log-omitted",
  description:
    "A state-changing action no longer writes the audit-log entry. The case kills it by asserting the audit row / trail.",
  source: "Issue #2041 (registered)",
  severity: "error",
  applies: (_testCase, context) =>
    context.intent.detectedActions.some((action) =>
      isSubmitAction(action.kind),
    ),
  kills: (testCase) => caseTextMatches(testCase, AUDIT_LOG_RE),
});

/**
 * Register the default Wave-2 mutation catalog on an existing catalog.
 * The catalog covers every {@link MutationClass} listed in
 * {@link ALLOWED_MUTATION_CLASSES} with at least one entry.
 */
export const registerDefaultMutations = (catalog: MutationCatalog): void => {
  catalog.register(buildFieldRequiredFlippedMutation());
  catalog.register(buildVatAppliedToNettoMutation());
  catalog.register(buildCurrencyRoundingMutation());
  catalog.register(buildBoundaryOffByOneMutation());
  catalog.register(buildStateTransitionSkippedMutation());
  catalog.register(buildRegexRelaxedMutation());
  catalog.register(buildNullEqualsEmptyMutation());
  catalog.register(buildOptionalCostMutation());
  catalog.register(buildCurrencyLocaleMutation());
  catalog.register(buildErrorMessageSuppressedMutation());
  catalog.register(buildAccessibilityNameMutation());
  catalog.register(buildIbanChecksumMutation());
  catalog.register(buildPiiRedactionMutation());
  catalog.register(buildFourEyesMutation());
  catalog.register(buildAuditLogMutation());
};

/** Build a fresh catalog pre-populated with the default mutations. */
export const buildDefaultMutationCatalog = (): MutationCatalog => {
  const catalog = createMutationCatalog();
  registerDefaultMutations(catalog);
  return catalog;
};

/* -------------------------------------------------------------------- */
/*  Evaluation                                                           */
/* -------------------------------------------------------------------- */

const sortedUnique = (values: readonly string[]): string[] => {
  const set = new Set(values);
  return [...set].sort((left, right) => left.localeCompare(right));
};

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface EvaluateMutationKillingSuiteInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly policyProfileId: string;
  readonly testCases: ReadonlyArray<GeneratedTestCase>;
  readonly intent: BusinessTestIntentIr;
  readonly model?: TestDesignModel;
  readonly catalog?: MutationCatalog;
  /** KPI threshold; defaults to {@link MUTATION_KILL_RATE_DEFAULT_THRESHOLD}. */
  readonly threshold?: number;
}

/**
 * Run every catalog mutation against every accepted test case and
 * produce the persisted {@link MutationReport}. The result is
 * deterministic: arrays are sorted, ratios are rounded to six digits,
 * and only set fields are emitted.
 */
export const evaluateMutationKillingSuite = (
  input: EvaluateMutationKillingSuiteInput,
): MutationReport => {
  const catalog = input.catalog ?? buildDefaultMutationCatalog();
  const threshold =
    input.threshold ?? MUTATION_KILL_RATE_DEFAULT_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(
      `mutation-killing-eval: threshold must be a finite number in [0, 1]; got ${threshold}`,
    );
  }

  const context: MutationContext = {
    intent: input.intent,
    ...(input.model !== undefined ? { model: input.model } : {}),
  };

  const mutations = catalog.list();
  const evaluations: MutationEvaluation[] = [];

  for (const mutation of mutations) {
    const applicable: string[] = [];
    const killing: string[] = [];
    for (const testCase of input.testCases) {
      let inScope: boolean;
      try {
        inScope = mutation.applies(testCase, context);
      } catch (error) {
        throw new Error(
          `mutation-killing-eval: mutation "${mutation.id}".applies threw on case "${testCase.id}": ${(error as Error).message}`,
        );
      }
      if (!inScope) continue;
      applicable.push(testCase.id);
      let kills: boolean;
      try {
        kills = mutation.kills(testCase, context);
      } catch (error) {
        throw new Error(
          `mutation-killing-eval: mutation "${mutation.id}".kills threw on case "${testCase.id}": ${(error as Error).message}`,
        );
      }
      if (kills) killing.push(testCase.id);
    }
    evaluations.push({
      mutationId: mutation.id,
      mutationClass: mutation.mutationClass,
      description: mutation.description,
      source: mutation.source,
      severity: mutation.severity,
      applicableTestCaseIds: sortedUnique(applicable),
      killingTestCaseIds: sortedUnique(killing),
      killed: killing.length > 0,
      applicable: applicable.length > 0,
    });
  }
  evaluations.sort((left, right) =>
    left.mutationId.localeCompare(right.mutationId),
  );

  const totalMutations = evaluations.length;
  const applicableMutations = evaluations.filter((e) => e.applicable).length;
  const killedMutations = evaluations.filter((e) => e.killed).length;
  const killRate =
    applicableMutations === 0
      ? 0
      : roundTo(killedMutations / applicableMutations, 6);

  const byClassMap = new Map<MutationClass, MutationClassKillRate>();
  for (const cls of ALLOWED_MUTATION_CLASSES) {
    byClassMap.set(cls, {
      mutationClass: cls,
      total: 0,
      applicable: 0,
      killed: 0,
      killRate: 0,
    });
  }
  for (const evaluation of evaluations) {
    const row = byClassMap.get(evaluation.mutationClass);
    if (row === undefined) continue;
    const next: MutationClassKillRate = {
      mutationClass: row.mutationClass,
      total: row.total + 1,
      applicable: row.applicable + (evaluation.applicable ? 1 : 0),
      killed: row.killed + (evaluation.killed ? 1 : 0),
      killRate: 0,
    };
    byClassMap.set(evaluation.mutationClass, next);
  }
  const byClass: MutationClassKillRate[] = [];
  for (const cls of ALLOWED_MUTATION_CLASSES) {
    const row = byClassMap.get(cls);
    if (row === undefined) continue;
    const rate =
      row.applicable === 0 ? 0 : roundTo(row.killed / row.applicable, 6);
    byClass.push({ ...row, killRate: rate });
  }

  const unkilledMutations = evaluations
    .filter((e) => e.applicable && !e.killed)
    .map((e) => e.mutationId)
    .sort((left, right) => left.localeCompare(right));

  // Compare the rounded values that actually land on disk so a caller
  // who passes a threshold with more than six decimal places sees a
  // self-consistent report (`killRate >= threshold` always agrees with
  // `meetsThreshold`).
  const persistedThreshold = roundTo(threshold, 6);
  return {
    schemaVersion: MUTATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.policyProfileId,
    totalTestCases: input.testCases.length,
    totalMutations,
    applicableMutations,
    killedMutations,
    killRate,
    threshold: persistedThreshold,
    meetsThreshold: killRate >= persistedThreshold,
    byClass,
    mutations: evaluations,
    unkilledMutations,
  };
};

/**
 * Project the persisted {@link MutationReport} down to the compact
 * summary embedded in `policy-report.json#mutationKillRate`.
 */
export const buildMutationKillRateSummary = (
  report: MutationReport,
): MutationKillRateSummary => ({
  artifactFilename: MUTATION_REPORT_ARTIFACT_FILENAME,
  killRate: report.killRate,
  totalMutations: report.totalMutations,
  applicableMutations: report.applicableMutations,
  killedMutations: report.killedMutations,
  threshold: report.threshold,
  meetsThreshold: report.meetsThreshold,
});

/* -------------------------------------------------------------------- */
/*  Persistence                                                          */
/* -------------------------------------------------------------------- */

const writeAtomic = async (
  destinationPath: string,
  bytes: Buffer,
): Promise<void> => {
  await mkdir(dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, bytes, { mode: 0o600 });
  await rename(tempPath, destinationPath);
};

/**
 * Write the canonical-JSON `mutation-report.json` artifact to
 * `<artifactDir>/${MUTATION_REPORT_ARTIFACT_FILENAME}` using the
 * standard atomic temp + rename idiom. Returns the destination path.
 */
export const writeMutationReportArtifact = async (input: {
  readonly artifactDir: string;
  readonly report: MutationReport;
}): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const path = join(input.artifactDir, MUTATION_REPORT_ARTIFACT_FILENAME);
  const bytes = encodeCanonicalReportBytes(input.report);
  await writeAtomic(path, bytes);
  return { path, bytes };
};

/**
 * Encode a {@link MutationReport} as canonical-JSON bytes (UTF-8, sorted
 * keys, trailing newline) so the artifact is byte-stable across runs.
 */
export const encodeCanonicalReportBytes = (report: MutationReport): Buffer =>
  Buffer.from(`${canonicalStringify(report)}\n`, "utf8");

const canonicalStringify = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `mutation-killing-eval: cannot canonicalize non-finite number ${value}`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((key) => {
      const inner = (value as Record<string, unknown>)[key];
      if (inner === undefined) return undefined;
      return `${JSON.stringify(key)}:${canonicalStringify(inner)}`;
    });
    return `{${parts.filter((part) => part !== undefined).join(",")}}`;
  }
  throw new Error(
    `mutation-killing-eval: cannot canonicalize value of type ${typeof value}`,
  );
};
