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

/**
 * Citation pointer to the legal source an invariant enforces (Issue #2108).
 * Auditors require traceability from the predicate back to the regulation
 * that justifies it; the field is optional because a handful of
 * Issue #2040 active-dataset invariants are calculation-bound rather than
 * regulation-bound.
 */
export interface DomainInvariantLegalSource {
  /** Short framework identifier — `PSD2`, `MiFID II`, `GwG`, `GDPR`, `EAA`, … */
  readonly framework: string;
  /**
   * Article + paragraph (or recital + section) the invariant cites, e.g.
   * `Article 97(1)`, `RTS 2018/389 Article 4`, `Section 10 paragraph 1
   * sentence 2`.
   */
  readonly citation: string;
  /** Optional canonical URL pointing to the consolidated legal text. */
  readonly url?: string;
}

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
 *
 * Issue #2108 added the optional `legalSource` field; regulation-bound
 * invariants must populate it so auditors can trace the predicate back to
 * the article + paragraph it enforces.
 */
export interface DomainInvariant {
  readonly id: string;
  readonly scope: string;
  readonly description: string;
  readonly source: string;
  readonly severity: DomainInvariantSeverity;
  readonly legalSource?: DomainInvariantLegalSource;
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
const NETTO_BRUTTO_FINANCIAL_RESULT_TEXT_RE =
  /\b(amounts?|betr[aä]g(?:e|en)?|berechn(?:et|ung)|equals?|ergibt|financ(?:e|ing) need|finanzierungsbedarf(?:es|s|e)?|gesamt(?:betrag|summe|wert)?|gleich|kaufpreis|preis|summe|total|value|wert)\b|\d[\d.,]*\s*(?:€|eur)\b/i;
const NETTO_BRUTTO_NUMERIC_AMOUNT_RE = /\d[\d.,]*\s*(?:€|eur)\b/i;
const NETTO_BRUTTO_RESULT_ASSERTION_RE =
  /\b(berechn(?:et|ung)|equals?|ergibt|gleich|gesamt(?:betrag|summe|wert)?|summe|total)\b/i;
const NETTO_BRUTTO_UI_ENUMERATION_TEXT_RE =
  /\b(fokus|focus|tab|tastatur|keyboard|screen[-\s]?reader|beschrift(?:ung|ungen)?|label|feld(?:er)?|field(?:s)?|option(?:en)?|radio|reihenfolge|order|navig(?:ation|ieren)?|sichtbar|visible|angekündigt|vorgelesen|announces?|reads?)\b/i;
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

const isNettoBruttoFinancialResultConflation = (text: string): boolean => {
  if (!NETTO_TEXT_RE.test(text) || !BRUTTO_TEXT_RE.test(text)) return false;
  if (!NETTO_BRUTTO_FINANCIAL_RESULT_TEXT_RE.test(text)) return false;

  const hasNumericAmount = NETTO_BRUTTO_NUMERIC_AMOUNT_RE.test(text);
  const hasResultAssertion = NETTO_BRUTTO_RESULT_ASSERTION_RE.test(text);
  const isUiEnumeration = NETTO_BRUTTO_UI_ENUMERATION_TEXT_RE.test(text);

  return !isUiEnumeration || hasNumericAmount || hasResultAssertion;
};

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
    return !candidates.some((entry) =>
      isNettoBruttoFinancialResultConflation(entry.text),
    );
  },
  violationMessage: (testCase) => {
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
    const offending = candidates.find((entry) =>
      isNettoBruttoFinancialResultConflation(entry.text),
    );
    return {
      path: offending?.path ?? "expectedResults",
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

/* -------------------------------------------------------------------- */
/*  EU banking + insurance compliance invariants (Issue #2108)           */
/* -------------------------------------------------------------------- */

/*
 * The Issue #2108 catalog encodes regulatory cross-field rules drawn from
 * the EU banking and insurance frameworks the eu-banking-default profile
 * targets. Each invariant fires on text-level evidence in the generated
 * test case (titles, objective, preconditions, steps, expected results)
 * because the validation pipeline operates on case content rather than
 * runtime telemetry. The legalSource field is mandatory for these
 * invariants and points back to the article/section that justifies the
 * predicate.
 *
 * Severity:
 *   - "error"   — hard regulatory; a violation should block export.
 *   - "warning" — soft / good practice; surfaces in coverage reports
 *                 but does not block.
 */

const PAYMENT_CONTEXT_RE =
  /\b(payment|payments|pay\b|transfer|überweis(?:ung|en)|sepa|wire transfer|remittance)\b/i;
const HIGH_VALUE_PAYMENT_RE =
  /\b(high[- ]value|hochbetrag|großbetrag|high amount|amount\s*(?:>|>=|greater than|over)\s*\d|exceeds?\s*(?:the\s*)?(?:threshold|limit))\b/i;
const SCA_REQUIREMENT_RE =
  /\b(sca|strong customer authentication|two[- ]factor|2fa|mfa|tan|smstan|chiptan|pushtan|otp\b|authenticator)\b/i;
const DYNAMIC_LINKING_RE =
  /\b(dynamic(?:ally)?\s*link(?:ed|ing)?|dynamische(?:s|n|r)?\s*verkn(?:ü|u)pf(?:ung|en)|amount\s*and\s*payee|betrag\s*und\s*empf(?:ä|a)nger)\b/i;
const SUITABILITY_RE =
  /\b(suitability|geeignetheit|geeignetheitspr(?:ü|u)fung|geeignetheitserkl(?:ä|a)rung)\b/i;
const COMPLEX_PRODUCT_RE =
  /\b(complex product|komplexes? produkt|cfd\b|warrant|certificate|zertifikat|leveraged|gehebelt|derivative|derivat)\b/i;
const APPROPRIATENESS_WARNING_RE =
  /\b(appropriateness|angemessenheitspr(?:ü|u)fung|warnung\s*(?:für|vor)|warnhinweis|complex[- ]product warning)\b/i;
const MIFID_ORDER_RE =
  /\b(securities order|wertpapierorder|wertpapier-order|order placement|order execution|trade order|isin|wkn)\b/i;
const COSTS_DISCLOSURE_RE =
  /\b(costs?\s*and\s*charges|kosten\s*und\s*(geb(?:ü|u)hren|nebenkosten)|ex[- ]ante (?:cost )?disclosure|kosteninformation|kostenausweis)\b/i;
const PEP_RE =
  /\b(pep\b|politically exposed person|politisch exponierte\s*person)\b/i;
const HIGH_VALUE_TRANSFER_RE =
  /\b(high[- ]value transfer|hochbetragsüberweisung|großbetrag(?:s)?überweisung|cash\s*deposit|bargeldeinzahlung|aml threshold|geldwäsche-?schwelle)\b/i;
const ICT_THIRD_PARTY_RE =
  /\b(ict[- ]third[- ]party|ikt[- ]drittpartei|outsourced|outsourcing|auslager(?:ung|n)|cloud provider|cloud-?anbieter)\b/i;
const DORA_FLAG_RE =
  /\b(dora|ict[- ]risk|ikt[- ]risiko|third[- ]party (?:flag|register)|drittpartei[- ]register)\b/i;
const SPECIAL_CATEGORY_RE =
  /\b(special[- ]category|besondere kategorie|sensitive personal data|sensible personenbezogene daten|health data|gesundheitsdaten|biometric data|biometrische daten|religion(?:szugeh(?:ö|o)rigkeit)?|sexual orientation|sexuelle orientierung)\b/i;
const EXPLICIT_CONSENT_RE =
  /\b(explicit consent|ausdrückliche einwilligung|opt[- ]in consent|written consent|schriftliche einwilligung)\b/i;
const INSURANCE_CONTRACT_RE =
  /\b(insurance contract|versicherungsvertrag|police\b|policy issuance|antrag (?:auf )?versicherung|versicherungsantrag)\b/i;
const DEMANDS_NEEDS_RE =
  /\b(demands\s*(?:and|&)\s*needs|wünsche\s*und\s*bed(?:ü|u)rfnisse|bedarfsanalyse|needs analysis|kundenwunschanalyse)\b/i;
const LONG_TERM_CONTRACT_RE =
  /\b(long[- ]term contract|langfristige(?:r|n)? vertrag|life insurance|lebensversicherung|riester|rürup|altersvorsorge)\b/i;
const COOLING_OFF_RE =
  /\b(cooling[- ]off|widerrufsrecht|widerrufsbelehrung|withdrawal period|right of withdrawal)\b/i;
const FX_CONTEXT_RE =
  /\b(fx|foreign exchange|currency conversion|w(?:ä|a)hrungsumrechnung|exchange rate|wechselkurs|cross[- ]currency)\b/i;
const FX_MARKUP_RE =
  /\b(markup|aufschlag|margin|marge|spread)\b/i;
const FX_DISCLOSURE_RE =
  /\b(fx[- ]?(?:margin|markup) disclosure|w(?:ä|a)hrungsaufschlag\s*(?:offen|ausweis)|exchange[- ]rate disclosure|wechselkurshinweis)\b/i;
const SESSION_AGGREGATION_RE =
  /\b(session aggregation|kumulativ(?:e|er)? betrag|cumulative amount|tageslimit|daily limit|aml aggregation)\b/i;
/*
 * KYC_CONTEXT_RE intentionally avoids generic markers like "onboarding"
 * or "account screen" — those leak into synthesized field-level stubs
 * (`Submit valid Email on s-onboarding-account`) and would force
 * INV-GWG-PEP-01 / INV-KYC-AGE-01 to fire on every name/email/postcode
 * field. The patterns below require an intentful KYC or CDD wizard.
 */
const KYC_CONTEXT_RE =
  /\b(kyc\b|know your customer|customer due diligence|cdd\b|kyc[- ]?wizard|kyc[- ]?onboarding|kontoer(?:ö|o)ffnungs[- ]?wizard|account[- ]?opening wizard)\b/i;
const AGE_GATE_RE =
  /\b(under[- ]?18|minderj(?:ä|a)hrig|altersgrenze|age gate|age check|altersprüfung|geburtsdatum)\b/i;
const A11Y_PAYMENT_CONTEXT_RE =
  /\b(payment flow|payment journey|zahlung(?:s|en)?[- ]?(?:flow|journey|prozess))\b/i;
const KEYBOARD_ONLY_RE =
  /\b(keyboard[- ]only|tastatur[- ]?(?:nur|only)|nur (?:per )?tastatur|sole keyboard|keyboard navigation|tab[- ]?reihenfolge|focus order|fokusreihenfolge)\b/i;
/*
 * ACCOUNT_SCREEN_RE matches only intentful self-service portal phrases.
 * The generic "account screen" / "account page" forms are excluded so
 * that synthesized field-level cases on onboarding screens (which leak
 * `s-onboarding-account` into the case text) do NOT pull
 * INV-GDPR-ART15-01 into scope. Real account-overview / portal cases
 * still match.
 */
const ACCOUNT_SCREEN_RE =
  /\b(account overview|kontoübersicht|kontoeinstellungen|konto[- ]?detail(?:s|seite)?|self[- ]service portal|kundenportal|my account dashboard|account dashboard)\b/i;
const AUSKUNFT_RE =
  /\b(auskunftsrecht|right of access|datenauskunft|subject access request|sar\b|art(?:ikel)?\.?\s*1[5-9]|art(?:ikel)?\.?\s*2[0-2])\b/i;
const ANLAGEVERMITTLUNG_RE =
  /\b(anlagevermittlung|investment intermediation|anlageberatung|investment advice|wertpapierberatung)\b/i;
const BERATUNGSPROTOKOLL_RE =
  /\b(beratungsprotokoll|advisory protocol|geeignetheitserkl(?:ä|a)rung|advice record|protokoll der beratung)\b/i;

/**
 * Verbs that distinguish an *intentful* transfer / KYC wizard step from
 * an incidental form-field test (e.g. "submit valid postcode"). Used to
 * AND-gate INV-GWG-PEP-01 so synthesized field-level stubs do not pull
 * the PEP-screening invariant into scope.
 */
const TRANSFER_OR_KYC_VERB_RE =
  /\b(initiate|execute|complete|onboard|conclude|approve)\s+(?:the\s+)?(?:high[- ]value\s+)?(?:transfer|payment|onboarding|kyc|cdd|customer due diligence|wizard|application)\b/i;

const collectAllText = (testCase: GeneratedTestCase): string =>
  collectCaseStrings(testCase).join("\n");

const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

/**
 * Risk categories that gate the Issue #2108 compliance invariants. The
 * registry intentionally avoids firing on accidentally-name-matching low-
 * risk stubs (e.g. an "Open Account" accessibility check synthesized by
 * the harness) — only cases the policy gate considers regulated reach
 * the compliance predicates.
 */
const REGULATED_RISK_CATEGORIES: ReadonlySet<string> = new Set([
  "regulated_data",
  "financial_transaction",
  "high",
]);

interface ContentInvariantSpec {
  readonly id: string;
  readonly scope: string;
  readonly description: string;
  readonly severity: DomainInvariantSeverity;
  readonly legalSource: DomainInvariantLegalSource;
  /**
   * Pattern groups that must ALL have at least one match for the case to
   * be in scope. Each group is `any-of` internally; the outer array is
   * `all-of`. Use multiple groups to AND-compose context anchors (e.g.
   * "payment context" AND "high-value indicator" AND "SCA invocation").
   */
  readonly inScope: readonly (readonly RegExp[])[];
  /**
   * Patterns that must all be satisfied (any-match per pattern array)
   * for `holds` to return `true`.
   */
  readonly mustEvidence: readonly (readonly RegExp[])[];
  /** Auditor-facing violation message. */
  readonly violationMessage: string;
  /**
   * When true (the default), cases whose `riskCategory` is not in
   * {@link REGULATED_RISK_CATEGORIES} are skipped. Set to `false` for
   * invariants that must fire regardless of policy-gate risk tagging
   * (e.g. accessibility-only invariants whose risk floor is "low").
   */
  readonly requiresRegulatedRisk?: boolean;
}

const ALLOWED_RISK_CATEGORIES_FOR_A11Y: ReadonlySet<string> = new Set([
  "regulated_data",
  "financial_transaction",
  "high",
  "low",
]);

const buildContentInvariant = (spec: ContentInvariantSpec): DomainInvariant => {
  const requiresRegulatedRisk = spec.requiresRegulatedRisk ?? true;
  const allowedRisks = requiresRegulatedRisk
    ? REGULATED_RISK_CATEGORIES
    : ALLOWED_RISK_CATEGORIES_FOR_A11Y;
  return {
    id: spec.id,
    scope: spec.scope,
    description: spec.description,
    source: "Issue #2108 (registered)",
    severity: spec.severity,
    legalSource: spec.legalSource,
    forall: (testCase) => {
      if (!allowedRisks.has(testCase.riskCategory)) return false;
      const text = collectAllText(testCase);
      return spec.inScope.every((group) => matchesAny(text, group));
    },
    holds: (testCase) => {
      const text = collectAllText(testCase);
      return spec.mustEvidence.every((group) => matchesAny(text, group));
    },
    violationMessage: () => ({
      path: "expectedResults",
      message: spec.violationMessage,
    }),
  };
};

const buildPsd2ScaInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-PSD2-SCA-01",
    scope: "eu-banking.psd2.sca",
    description:
      "High-value or remote electronic payments must declare a strong-customer-authentication step (PSD2 Article 97 + RTS 2018/389).",
    severity: "error",
    legalSource: {
      framework: "PSD2",
      citation:
        "Directive (EU) 2015/2366 Article 97 + Commission Delegated Regulation 2018/389 (RTS on SCA) Article 1, 4",
      url: "https://eur-lex.europa.eu/eli/reg_del/2018/389/oj",
    },
    inScope: [[PAYMENT_CONTEXT_RE], [HIGH_VALUE_PAYMENT_RE]],
    mustEvidence: [[SCA_REQUIREMENT_RE]],
    violationMessage:
      "High-value payment case is missing a strong-customer-authentication step; PSD2 Article 97 requires SCA before execution.",
  });

const buildPsd2DynamicLinkingInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-PSD2-DYNLINK-01",
    scope: "eu-banking.psd2.dynamic-linking",
    description:
      "When SCA is invoked on a high-value payment, the authentication code must be dynamically linked to the amount AND the payee (RTS 2018/389 Article 5).",
    severity: "error",
    legalSource: {
      framework: "PSD2",
      citation: "Commission Delegated Regulation 2018/389 (RTS on SCA) Article 5",
      url: "https://eur-lex.europa.eu/eli/reg_del/2018/389/oj",
    },
    inScope: [[PAYMENT_CONTEXT_RE], [SCA_REQUIREMENT_RE], [HIGH_VALUE_PAYMENT_RE]],
    mustEvidence: [[DYNAMIC_LINKING_RE]],
    violationMessage:
      "High-value payment SCA case does not assert dynamic linking to amount AND payee; RTS 2018/389 Article 5 requires the authentication code to be bound to both.",
  });

const buildMifidSuitabilityInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-MIFID-SUITAB-01",
    scope: "eu-banking.mifid.suitability",
    description:
      "Investment-advice and portfolio-management orders must complete the suitability assessment before execution (MiFID II Article 25(2)).",
    severity: "error",
    legalSource: {
      framework: "MiFID II",
      citation: "Directive 2014/65/EU Article 25(2) + Delegated Regulation 2017/565 Article 54",
      url: "https://eur-lex.europa.eu/eli/dir/2014/65/oj",
    },
    inScope: [[MIFID_ORDER_RE]],
    mustEvidence: [[SUITABILITY_RE]],
    violationMessage:
      "MiFID II securities-order case must include a completed suitability assessment in preconditions or steps before submission; Article 25(2) prohibits execution without it.",
  });

const buildMifidAppropriatenessInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-MIFID-APPROP-01",
    scope: "eu-banking.mifid.appropriateness",
    description:
      "Execution-only orders on complex products must surface the appropriateness warning before submission (MiFID II Article 25(3)).",
    severity: "error",
    legalSource: {
      framework: "MiFID II",
      citation: "Directive 2014/65/EU Article 25(3)",
      url: "https://eur-lex.europa.eu/eli/dir/2014/65/oj",
    },
    inScope: [[COMPLEX_PRODUCT_RE], [MIFID_ORDER_RE]],
    mustEvidence: [[APPROPRIATENESS_WARNING_RE]],
    violationMessage:
      "Complex-product order case is missing the appropriateness warning step; MiFID II Article 25(3) requires the warning before execution-only orders.",
  });

const buildMifidCostsInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-MIFID-COSTS-01",
    scope: "eu-banking.mifid.costs-and-charges",
    description:
      "Securities orders must disclose ex-ante costs and charges before execution (MiFID II Article 24(4) + Delegated Regulation 2017/565 Article 50).",
    severity: "error",
    legalSource: {
      framework: "MiFID II",
      citation: "Directive 2014/65/EU Article 24(4) + Delegated Regulation 2017/565 Article 50",
      url: "https://eur-lex.europa.eu/eli/reg_del/2017/565/oj",
    },
    inScope: [[MIFID_ORDER_RE]],
    mustEvidence: [[COSTS_DISCLOSURE_RE]],
    violationMessage:
      "Securities-order case does not surface the ex-ante costs-and-charges disclosure; MiFID II Article 24(4) requires it before execution.",
  });

const buildGwgPepInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-GWG-PEP-01",
    scope: "eu-banking.gwg.pep-screening",
    description:
      "High-value transfers and onboarding must complete politically-exposed-person screening before execution (GwG §10/§15).",
    severity: "error",
    legalSource: {
      framework: "GwG (Geldwäschegesetz)",
      citation: "GwG §§ 10, 15 + 5th AML Directive (EU) 2018/843",
      url: "https://www.gesetze-im-internet.de/gwg_2017/",
    },
    inScope: [[HIGH_VALUE_TRANSFER_RE, KYC_CONTEXT_RE], [TRANSFER_OR_KYC_VERB_RE]],
    mustEvidence: [[PEP_RE]],
    violationMessage:
      "High-value transfer / KYC case must include PEP screening before execution; GwG §10 requires politically-exposed-person checks for enhanced due diligence.",
  });

const buildAmlAggregationInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-AML-CUMUL-01",
    scope: "eu-banking.aml.cumulative-amount",
    description:
      "AML thresholds must be checked on cumulative session amounts, not single-transaction amounts (4th AML Directive Article 11(c)).",
    severity: "warning",
    legalSource: {
      framework: "AMLD",
      citation: "Directive (EU) 2015/849 Article 11(c) (linked transactions)",
      url: "https://eur-lex.europa.eu/eli/dir/2015/849/oj",
    },
    inScope: [[HIGH_VALUE_TRANSFER_RE]],
    mustEvidence: [[SESSION_AGGREGATION_RE]],
    violationMessage:
      "AML threshold case must aggregate cumulative session amounts; AMLD Article 11(c) requires linked-transaction aggregation, not single-transaction comparison.",
  });

const buildDoraIctInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-DORA-ICT-01",
    scope: "eu-banking.dora.ict-third-party",
    description:
      "Workflows that depend on outsourced/cloud ICT services must declare an ICT-third-party flag for the DORA register of information (Regulation 2022/2554 Article 28).",
    severity: "warning",
    legalSource: {
      framework: "DORA",
      citation: "Regulation (EU) 2022/2554 Articles 28, 29 (register of information)",
      url: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
    },
    inScope: [[ICT_THIRD_PARTY_RE]],
    mustEvidence: [[DORA_FLAG_RE]],
    violationMessage:
      "Outsourced / ICT third-party workflow lacks a DORA register flag; Regulation 2022/2554 Article 28 requires registration of ICT third-party arrangements.",
  });

const buildGdprArt9Invariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-GDPR-ART9-01",
    scope: "eu-banking.gdpr.special-category",
    description:
      "Processing of special-category personal data must record explicit consent (GDPR Article 9(2)(a)).",
    severity: "error",
    legalSource: {
      framework: "GDPR",
      citation: "Regulation (EU) 2016/679 Article 9(2)(a)",
      url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    },
    inScope: [[SPECIAL_CATEGORY_RE]],
    mustEvidence: [[EXPLICIT_CONSENT_RE]],
    violationMessage:
      "Case touches special-category personal data without recording explicit consent; GDPR Article 9(2)(a) requires explicit opt-in consent.",
  });

const buildGdprAuskunftInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-GDPR-ART15-01",
    scope: "eu-banking.gdpr.right-of-access",
    description:
      "Self-service account screens must surface the data-subject right of access (GDPR Articles 15-22 / DSGVO Art. 12-22).",
    severity: "warning",
    legalSource: {
      framework: "GDPR",
      citation: "Regulation (EU) 2016/679 Articles 12-22",
      url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    },
    inScope: [[ACCOUNT_SCREEN_RE]],
    mustEvidence: [[AUSKUNFT_RE]],
    violationMessage:
      "Account screen case does not surface a right-of-access (Auskunftsrecht) entry point; GDPR Articles 15-22 require an actionable channel.",
  });

const buildIddDemandsAndNeedsInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-IDD-DEMANDS-01",
    scope: "eu-insurance.idd.demands-and-needs",
    description:
      "Insurance-contract distribution must record a demands-and-needs assessment before contract conclusion (IDD Article 20(1)).",
    severity: "error",
    legalSource: {
      framework: "IDD",
      citation: "Directive (EU) 2016/97 Article 20(1)",
      url: "https://eur-lex.europa.eu/eli/dir/2016/97/oj",
    },
    inScope: [[INSURANCE_CONTRACT_RE]],
    mustEvidence: [[DEMANDS_NEEDS_RE]],
    violationMessage:
      "Insurance-contract case is missing a demands-and-needs assessment; IDD Article 20(1) prohibits contract conclusion without it.",
  });

const buildSolvency2CoolingOffInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-SOLV2-COOLOFF-01",
    scope: "eu-insurance.solvency2.cooling-off",
    description:
      "Long-term insurance and life-insurance contracts must surface the cooling-off / withdrawal period (Solvency II + Distance Marketing Directive 2002/65/EC Article 6).",
    severity: "warning",
    legalSource: {
      framework: "Solvency II / DMD",
      citation:
        "Directive 2002/65/EC Article 6 (right of withdrawal) + Solvency II Directive 2009/138/EC Article 185",
      url: "https://eur-lex.europa.eu/eli/dir/2002/65/oj",
    },
    inScope: [[LONG_TERM_CONTRACT_RE]],
    mustEvidence: [[COOLING_OFF_RE]],
    violationMessage:
      "Long-term insurance / life-insurance case does not surface the cooling-off period; the right of withdrawal is mandatory before binding the customer.",
  });

const buildFxMarginInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-FX-MARGIN-01",
    scope: "eu-banking.fx.margin-disclosure",
    description:
      "Cross-currency conversions with an FX markup must disclose the FX margin (Cross-Border Payments Regulation 2019/518 + PSD2 transparency).",
    severity: "warning",
    legalSource: {
      framework: "Cross-Border Payments Regulation",
      citation: "Regulation (EU) 2019/518 Article 3a + PSD2 Article 45",
      url: "https://eur-lex.europa.eu/eli/reg/2019/518/oj",
    },
    inScope: [[FX_CONTEXT_RE], [FX_MARKUP_RE]],
    mustEvidence: [[FX_DISCLOSURE_RE]],
    violationMessage:
      "FX conversion with markup is missing the FX-margin disclosure; Regulation 2019/518 Article 3a requires transparent currency-conversion charges.",
  });

const buildKycAgeGateInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-KYC-AGE-01",
    scope: "eu-banking.kyc.age-gate",
    description:
      "Onboarding flows for age-restricted products must include an age-gate / under-18 path (Civil-law capacity + product-suitability rules).",
    severity: "warning",
    legalSource: {
      framework: "BGB / MiFID II",
      citation: "BGB §§ 104-113 (Geschäftsfähigkeit) + MiFID II Article 25 (suitability)",
      url: "https://www.gesetze-im-internet.de/bgb/",
    },
    inScope: [[KYC_CONTEXT_RE]],
    mustEvidence: [[AGE_GATE_RE]],
    violationMessage:
      "KYC onboarding case does not declare an age-gate / under-18 branch; minors cannot validly conclude account-opening or suitability-bound contracts without parental consent.",
  });

const buildEaaKeyboardInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-EAA-KBD-01",
    scope: "eu-banking.eaa.keyboard-only",
    description:
      "Payment flows must be completable using the keyboard alone (European Accessibility Act + EN 301 549 / WCAG 2.1 SC 2.1.1).",
    severity: "error",
    legalSource: {
      framework: "European Accessibility Act",
      citation:
        "Directive (EU) 2019/882 Annex I Section III + EN 301 549 v3.2.1 § 9.2.1.1 (WCAG 2.1 SC 2.1.1 Keyboard)",
      url: "https://eur-lex.europa.eu/eli/dir/2019/882/oj",
    },
    inScope: [[A11Y_PAYMENT_CONTEXT_RE]],
    mustEvidence: [[KEYBOARD_ONLY_RE]],
    violationMessage:
      "Payment-flow case is missing a keyboard-only completability assertion; EAA + WCAG 2.1 SC 2.1.1 require sole keyboard operation.",
  });

const buildVagBeratungsprotokollInvariant = (): DomainInvariant =>
  buildContentInvariant({
    id: "INV-VAG-BERATUNG-01",
    scope: "eu-insurance.vag.beratungsprotokoll",
    description:
      "Anlagevermittlung / Anlageberatung sessions must hand the customer a Beratungsprotokoll (VAG / VVG §§ 6, 6a; WpHG § 64).",
    severity: "warning",
    legalSource: {
      framework: "VAG / VVG / WpHG",
      citation: "VVG § 6, § 6a + WpHG § 64 (Beratungsprotokoll)",
      url: "https://www.gesetze-im-internet.de/vvg/",
    },
    inScope: [[ANLAGEVERMITTLUNG_RE]],
    mustEvidence: [[BERATUNGSPROTOKOLL_RE]],
    violationMessage:
      "Anlagevermittlung / Anlageberatung case is missing a Beratungsprotokoll handout step; VVG § 6 + WpHG § 64 require the protocol before transaction confirmation.",
  });

const ALL_EU_BANKING_COMPLIANCE_INVARIANT_BUILDERS: ReadonlyArray<
  () => DomainInvariant
> = [
  buildPsd2ScaInvariant,
  buildPsd2DynamicLinkingInvariant,
  buildMifidSuitabilityInvariant,
  buildMifidAppropriatenessInvariant,
  buildMifidCostsInvariant,
  buildGwgPepInvariant,
  buildAmlAggregationInvariant,
  buildDoraIctInvariant,
  buildGdprArt9Invariant,
  buildGdprAuskunftInvariant,
  buildIddDemandsAndNeedsInvariant,
  buildSolvency2CoolingOffInvariant,
  buildFxMarginInvariant,
  buildKycAgeGateInvariant,
  buildEaaKeyboardInvariant,
  buildVagBeratungsprotokollInvariant,
];

/**
 * Register the Issue #2108 EU banking + insurance compliance invariants on
 * an existing registry. The catalog is the default-on extension that ships
 * with the eu-banking-default profile; downstream callers may register
 * additional jurisdiction-specific invariants on top.
 */
export const registerEuBankingComplianceInvariants = (
  registry: DomainInvariantRegistry,
): void => {
  for (const build of ALL_EU_BANKING_COMPLIANCE_INVARIANT_BUILDERS) {
    registry.register(build());
  }
};

/**
 * Build a fresh registry pre-populated with the active-dataset invariants
 * (Issue #2040) and the EU banking + insurance compliance catalog
 * (Issue #2108). The combined registry is the **default-on** registry for
 * the `eu-banking-default` profile: passing nothing into
 * {@link RunValidationPipelineInput#invariantRegistry} reuses it.
 *
 * The returned registry is mutable; callers may register additional
 * invariants before evaluation.
 */
export const buildActiveDatasetInvariantRegistry =
  (): DomainInvariantRegistry => {
    const registry = createInvariantRegistry();
    registerActiveDatasetInvariants(registry);
    registerEuBankingComplianceInvariants(registry);
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
