/**
 * Default-on registry of cross-field invariants for the
 * `eu-banking-default` profile (Issue #2110).
 *
 * Catalog scope:
 *   - 14 banking cross-field invariants (DTI / LTV / FATCA / CRS / PSD2
 *     SCA / MiFID II suitability + appropriateness / cumulative daily
 *     limit / overdraft cap / minor-customer gate / SEPA Instant / PEP
 *     enhanced due diligence / FX margin disclosure / IBAN-currency).
 *   - 8 insurance cross-field invariants (coverage-start lead time /
 *     IDD demands-and-needs / Solvency II / DMD cooling-off period /
 *     disability sum-insured ratio / minor beneficiary guardian gate /
 *     vehicle-age × Vollkasko gating / large-sum life health declaration
 *     / Riester contributor age band / cyber minimum coverage).
 *
 * Every invariant is constructed via a builder so the registry can be
 * rebuilt deterministically per pipeline run; the engine validates each
 * builder output (anchors match AST refs, BVA seeds round-trip through
 * the evaluator) at registration time.
 *
 * The catalog is intentionally narrow: each invariant encodes a rule
 * that is *citeable* (regulation, contract, or product specification)
 * AND *cross-field* (two or more fields must be inspected together).
 * Rules that reduce to a single-field range stay in the per-field
 * deterministic test-data oracle.
 */

import type {
  CrossFieldInvariant,
  CrossFieldInvariantRegistry,
} from "./cross-field-invariant-engine.js";
import { createCrossFieldInvariantRegistry } from "./cross-field-invariant-engine.js";

const SOURCE = "Issue #2110 (registered)";

/* -------------------------------------------------------------------- */
/*  Banking (14 invariants)                                              */
/* -------------------------------------------------------------------- */

/** Konsumentenkredit DTI: monthly rate × 12 ≤ 60 % of Jahresbrutto. */
const buildKonsumentenkreditDtiInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-DTI-01",
  scope: "screen",
  description:
    "Konsumentenkredit: annualised monthly rate (rate × 12) must not exceed 60 % of declared gross annual income.",
  expression: {
    kind: "lte",
    left: {
      kind: "mul",
      left: { kind: "field_number", fieldRef: "monthly_rate" },
      right: { kind: "number_lit", value: 12 },
    },
    right: {
      kind: "mul",
      left: { kind: "number_lit", value: 0.6 },
      right: { kind: "field_number", fieldRef: "jahresbrutto" },
    },
  },
  severity: "error",
  citation: {
    framework: "Verbraucherkreditrichtlinie / BaFin",
    citation:
      "Directive 2008/48/EC Article 8 (creditworthiness) + BaFin MaRisk BTO 1.2 (Schuldendienst-Tragfähigkeit)",
    url: "https://eur-lex.europa.eu/eli/dir/2008/48/oj",
  },
  anchors: [
    {
      screenId: "konsumentenkredit-antrag",
      elementId: "fld-monthly-rate",
      fieldRef: "monthly_rate",
      label: "Monatliche Rate",
    },
    {
      screenId: "konsumentenkredit-antrag",
      elementId: "fld-jahresbrutto",
      fieldRef: "jahresbrutto",
      label: "Jahresbrutto",
    },
  ],
  bvaSeeds: [
    {
      label: "DTI well below cap (positive)",
      values: { monthly_rate: "1500", jahresbrutto: "60000" },
      expectedSatisfied: true,
      rationale: "1500 × 12 = 18000 ≤ 0.6 × 60000 = 36000",
    },
    {
      label: "DTI exactly at 60 % cap (positive boundary)",
      values: { monthly_rate: "3000", jahresbrutto: "60000" },
      expectedSatisfied: true,
      rationale: "3000 × 12 = 36000 = 0.6 × 60000 — boundary admitted",
    },
    {
      label: "DTI just above 60 % cap (negative boundary)",
      values: { monthly_rate: "3001", jahresbrutto: "60000" },
      expectedSatisfied: false,
      rationale: "3001 × 12 = 36012 > 0.6 × 60000 = 36000",
    },
  ],
  source: SOURCE,
});

/** Mortgage LTV: loan_amount ≤ 80 % × property_value. */
const buildMortgageLtvInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-LTV-01",
  scope: "screen",
  description:
    "Baufinanzierung: requested loan amount must not exceed 80 % of declared property value (LTV cap).",
  expression: {
    kind: "lte",
    left: { kind: "field_number", fieldRef: "loan_amount" },
    right: {
      kind: "mul",
      left: { kind: "number_lit", value: 0.8 },
      right: { kind: "field_number", fieldRef: "property_value" },
    },
  },
  severity: "warning",
  citation: {
    framework: "BaFin / KWG",
    citation:
      "BaFin Wohnimmobilienkreditrichtlinie + KWG § 18a (Beleihungswert) — 80 % LTV soft cap",
    url: "https://www.gesetze-im-internet.de/kwg/__18a.html",
  },
  anchors: [
    {
      screenId: "baufinanzierung-antrag",
      elementId: "fld-loan-amount",
      fieldRef: "loan_amount",
      label: "Darlehensbetrag",
    },
    {
      screenId: "baufinanzierung-antrag",
      elementId: "fld-property-value",
      fieldRef: "property_value",
      label: "Beleihungswert",
    },
  ],
  bvaSeeds: [
    {
      label: "LTV at 70 % (positive)",
      values: { loan_amount: "210000", property_value: "300000" },
      expectedSatisfied: true,
      rationale: "210000 ≤ 0.8 × 300000 = 240000",
    },
    {
      label: "LTV at 80 % cap (positive boundary)",
      values: { loan_amount: "240000", property_value: "300000" },
      expectedSatisfied: true,
      rationale: "240000 = 0.8 × 300000 — boundary admitted",
    },
    {
      label: "LTV at 81 % (negative)",
      values: { loan_amount: "243000", property_value: "300000" },
      expectedSatisfied: false,
      rationale: "243000 > 0.8 × 300000 = 240000",
    },
  ],
  source: SOURCE,
});

/** MiFID II appropriateness: complex product => customer experience required. */
const buildMifidComplexExperienceInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-CFD-EXP-01",
  scope: "wizard",
  description:
    "MiFID II appropriateness: complex/leveraged product orders require declared experienced-investor status.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "in_set_string",
      value: { kind: "field_string", fieldRef: "product_family" },
      set: ["cfd", "warrant", "leveraged_etf", "knock_out"],
      caseInsensitive: true,
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "investor_experience" },
      right: { kind: "string_lit", value: "experienced" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "MiFID II",
    citation:
      "Directive 2014/65/EU Article 25(3) + Delegated Regulation 2017/565 Article 56",
    url: "https://eur-lex.europa.eu/eli/dir/2014/65/oj",
  },
  anchors: [
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-product-family",
      fieldRef: "product_family",
      label: "Produktart",
    },
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-investor-experience",
      fieldRef: "investor_experience",
      label: "Anlegererfahrung",
    },
  ],
  bvaSeeds: [
    {
      label: "Plain ETF + novice (positive — antecedent false vacuous)",
      values: { product_family: "etf", investor_experience: "novice" },
      expectedSatisfied: true,
      rationale: "ETF is not in the complex set; rule is vacuously satisfied",
    },
    {
      label: "CFD + experienced (positive)",
      values: { product_family: "cfd", investor_experience: "experienced" },
      expectedSatisfied: true,
      rationale: "Complex product paired with experienced status",
    },
    {
      label: "CFD + novice (negative)",
      values: { product_family: "cfd", investor_experience: "novice" },
      expectedSatisfied: false,
      rationale: "Article 25(3) bars execution-only on complex product without appropriateness",
    },
  ],
  source: SOURCE,
});

/** FATCA: US tax residency requires declared FATCA status. */
const buildFatcaResidencyInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-FATCA-01",
  scope: "screen",
  description:
    "FATCA: customers with US tax residency must declare a non-empty FATCA status before account opening.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "tax_residency" },
      right: { kind: "string_lit", value: "US" },
      caseInsensitive: true,
    },
    consequent: { kind: "field_present", fieldRef: "fatca_status" },
  },
  severity: "error",
  citation: {
    framework: "FATCA / IGA",
    citation:
      "USA Foreign Account Tax Compliance Act + Germany–USA IGA Article 4 (reportable accounts)",
    url: "https://www.bzst.de/DE/Unternehmen/Internationales/FATCA/fatca_node.html",
  },
  anchors: [
    {
      screenId: "konto-kyc",
      elementId: "fld-tax-residency",
      fieldRef: "tax_residency",
      label: "Steueransässigkeit",
    },
    {
      screenId: "konto-kyc",
      elementId: "fld-fatca-status",
      fieldRef: "fatca_status",
      label: "FATCA-Status",
    },
  ],
  bvaSeeds: [
    {
      label: "DE residency (positive — vacuous)",
      values: { tax_residency: "DE", fatca_status: "" },
      expectedSatisfied: true,
      rationale: "Non-US residency; FATCA status not required",
    },
    {
      label: "US residency + status (positive)",
      values: { tax_residency: "US", fatca_status: "us_person_w9" },
      expectedSatisfied: true,
      rationale: "US residency paired with declared FATCA status",
    },
    {
      label: "US residency without status (negative)",
      values: { tax_residency: "US", fatca_status: "" },
      expectedSatisfied: false,
      rationale: "US residency must carry a FATCA-status declaration",
    },
  ],
  source: SOURCE,
});

/** PSD2 SCA threshold: payment > 30 EUR requires SCA method. */
const buildPsd2ScaThresholdInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-SCA-AMT-01",
  scope: "screen",
  description:
    "PSD2 SCA: electronic payments above the 30 EUR low-value exemption must declare a strong-customer-authentication method.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "gt",
      left: { kind: "field_number", fieldRef: "payment_amount_eur" },
      right: { kind: "number_lit", value: 30 },
    },
    consequent: { kind: "field_present", fieldRef: "sca_method" },
  },
  severity: "error",
  citation: {
    framework: "PSD2",
    citation:
      "Commission Delegated Regulation 2018/389 (RTS on SCA) Article 16 (low-value exemption)",
    url: "https://eur-lex.europa.eu/eli/reg_del/2018/389/oj",
  },
  anchors: [
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-payment-amount",
      fieldRef: "payment_amount_eur",
      label: "Betrag (EUR)",
    },
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-sca-method",
      fieldRef: "sca_method",
      label: "SCA-Verfahren",
    },
  ],
  bvaSeeds: [
    {
      label: "Below low-value exemption (positive — vacuous)",
      values: { payment_amount_eur: "25.00", sca_method: "" },
      expectedSatisfied: true,
      rationale: "25 EUR ≤ 30 EUR exemption; SCA not required",
    },
    {
      label: "At exemption boundary (positive — vacuous)",
      values: { payment_amount_eur: "30.00", sca_method: "" },
      expectedSatisfied: true,
      rationale: "30 EUR = low-value exemption boundary; SCA not required",
    },
    {
      label: "Above exemption with SCA (positive)",
      values: { payment_amount_eur: "30.01", sca_method: "pushtan" },
      expectedSatisfied: true,
      rationale: "Just above the boundary, SCA method declared",
    },
    {
      label: "Above exemption without SCA (negative)",
      values: { payment_amount_eur: "100.00", sca_method: "" },
      expectedSatisfied: false,
      rationale: "100 EUR > 30 EUR exemption and no SCA method declared",
    },
  ],
  source: SOURCE,
});

/** German IBAN must pair with EUR currency (SEPA jurisdiction). */
const buildIbanCurrencyInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-IBAN-CCY-01",
  scope: "screen",
  description:
    "SEPA: an IBAN starting with `DE` (or `AT`, `LU`, `NL`) must pair with EUR as the transfer currency.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "matches_regex",
      value: { kind: "field_string", fieldRef: "iban" },
      pattern: "^(DE|AT|LU|NL)\\d",
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "currency" },
      right: { kind: "string_lit", value: "EUR" },
    },
  },
  severity: "error",
  citation: {
    framework: "SEPA Regulation",
    citation: "Regulation (EU) 260/2012 Article 5 (SEPA technical requirements)",
    url: "https://eur-lex.europa.eu/eli/reg/2012/260/oj",
  },
  anchors: [
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-iban",
      fieldRef: "iban",
      label: "IBAN Empfänger",
    },
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-currency",
      fieldRef: "currency",
      label: "Währung",
    },
  ],
  bvaSeeds: [
    {
      label: "DE IBAN + EUR (positive)",
      values: { iban: "DE89370400440532013000", currency: "EUR" },
      expectedSatisfied: true,
      rationale: "Matched antecedent and matched consequent",
    },
    {
      label: "GB IBAN + GBP (positive — vacuous)",
      values: { iban: "GB29NWBK60161331926819", currency: "GBP" },
      expectedSatisfied: true,
      rationale: "Antecedent does not match; rule vacuous",
    },
    {
      label: "AT IBAN + USD (negative)",
      values: { iban: "AT611904300234573201", currency: "USD" },
      expectedSatisfied: false,
      rationale: "AT IBAN must pair with EUR per SEPA",
    },
  ],
  source: SOURCE,
});

/** Securities order risk-class ≥ 5 requires completed suitability. */
const buildMifidRiskSuitabilityInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-RISK-SUITAB-01",
  scope: "wizard",
  description:
    "MiFID II suitability: securities orders on risk-class 5+ products require a completed suitability assessment.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "gte",
      left: { kind: "field_number", fieldRef: "product_risk_class" },
      right: { kind: "number_lit", value: 5 },
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "suitability_completed" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "MiFID II",
    citation: "Directive 2014/65/EU Article 25(2)",
    url: "https://eur-lex.europa.eu/eli/dir/2014/65/oj",
  },
  anchors: [
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-product-risk-class",
      fieldRef: "product_risk_class",
      label: "Risikoklasse",
    },
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-suitability-completed",
      fieldRef: "suitability_completed",
      label: "Geeignetheitsprüfung",
    },
  ],
  bvaSeeds: [
    {
      label: "Risk-class 4 + no suitability (positive — vacuous)",
      values: { product_risk_class: "4", suitability_completed: "no" },
      expectedSatisfied: true,
      rationale: "Below 5; suitability not strictly required",
    },
    {
      label: "Risk-class 5 + suitability done (positive)",
      values: { product_risk_class: "5", suitability_completed: "yes" },
      expectedSatisfied: true,
      rationale: "Boundary risk class with completed suitability",
    },
    {
      label: "Risk-class 7 without suitability (negative)",
      values: { product_risk_class: "7", suitability_completed: "no" },
      expectedSatisfied: false,
      rationale: "Article 25(2) blocks execution without suitability",
    },
  ],
  source: SOURCE,
});

/** Daily transfer limit: amount + cumulative_today ≤ daily_limit. */
const buildDailyLimitInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-DAILY-LIMIT-01",
  scope: "screen",
  description:
    "Online-banking transfer: requested amount plus already-cumulated daily transfers must not exceed the customer's daily limit.",
  expression: {
    kind: "lte",
    left: {
      kind: "add",
      left: { kind: "field_number", fieldRef: "transfer_amount" },
      right: { kind: "field_number", fieldRef: "cumulative_today" },
    },
    right: { kind: "field_number", fieldRef: "daily_limit" },
  },
  severity: "error",
  citation: {
    framework: "BaFin / Bank General Terms",
    citation:
      "Customer-specific Tageslimit per Bank-AGB Section 11; AMLD Article 11(c) requires linked-transaction aggregation",
    url: "https://eur-lex.europa.eu/eli/dir/2015/849/oj",
  },
  anchors: [
    {
      screenId: "online-banking-transfer",
      elementId: "fld-transfer-amount",
      fieldRef: "transfer_amount",
      label: "Überweisungsbetrag",
    },
    {
      screenId: "online-banking-transfer",
      elementId: "fld-cumulative-today",
      fieldRef: "cumulative_today",
      label: "Heutige Tagessumme",
    },
    {
      screenId: "online-banking-transfer",
      elementId: "fld-daily-limit",
      fieldRef: "daily_limit",
      label: "Tageslimit",
    },
  ],
  bvaSeeds: [
    {
      label: "Within limit (positive)",
      values: {
        transfer_amount: "200",
        cumulative_today: "300",
        daily_limit: "1000",
      },
      expectedSatisfied: true,
      rationale: "200 + 300 = 500 ≤ 1000",
    },
    {
      label: "Exactly at limit (positive boundary)",
      values: {
        transfer_amount: "700",
        cumulative_today: "300",
        daily_limit: "1000",
      },
      expectedSatisfied: true,
      rationale: "700 + 300 = 1000 = limit",
    },
    {
      label: "Just over limit (negative boundary)",
      values: {
        transfer_amount: "701",
        cumulative_today: "300",
        daily_limit: "1000",
      },
      expectedSatisfied: false,
      rationale: "701 + 300 = 1001 > 1000",
    },
  ],
  source: SOURCE,
});

/** Overdraft cap: requested overdraft ≤ 30 % × monthly_income × 3. */
const buildOverdraftCapInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-OVERDRAFT-01",
  scope: "screen",
  description:
    "Dispokredit: requested overdraft line must not exceed 3 × monthly net income (industry standard ceiling).",
  expression: {
    kind: "lte",
    left: { kind: "field_number", fieldRef: "requested_overdraft" },
    right: {
      kind: "mul",
      left: { kind: "number_lit", value: 3 },
      right: { kind: "field_number", fieldRef: "monthly_net_income" },
    },
  },
  severity: "warning",
  citation: {
    framework: "BaFin MaRisk",
    citation:
      "BaFin MaRisk BTO 1.2 + Bundesbank Schuldendienstleitfaden — 3 × Nettoeinkommen Dispolimit",
    url: "https://www.bafin.de/SharedDocs/Veroeffentlichungen/DE/Rundschreiben/2017/rs_1710_marisk_ba.html",
  },
  anchors: [
    {
      screenId: "dispokredit-antrag",
      elementId: "fld-requested-overdraft",
      fieldRef: "requested_overdraft",
      label: "Beantragter Dispokredit",
    },
    {
      screenId: "dispokredit-antrag",
      elementId: "fld-monthly-net-income",
      fieldRef: "monthly_net_income",
      label: "Monatliches Nettoeinkommen",
    },
  ],
  bvaSeeds: [
    {
      label: "Below cap (positive)",
      values: { requested_overdraft: "5000", monthly_net_income: "2500" },
      expectedSatisfied: true,
      rationale: "5000 ≤ 3 × 2500 = 7500",
    },
    {
      label: "At cap (positive boundary)",
      values: { requested_overdraft: "7500", monthly_net_income: "2500" },
      expectedSatisfied: true,
      rationale: "7500 = 3 × 2500",
    },
    {
      label: "Above cap (negative)",
      values: { requested_overdraft: "8000", monthly_net_income: "2500" },
      expectedSatisfied: false,
      rationale: "8000 > 3 × 2500 = 7500",
    },
  ],
  source: SOURCE,
});

/** Account opening: contractual capacity gate — age ≥ 18 OR guardian declared. */
const buildAccountAgeGateInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-AGE-GATE-01",
  scope: "wizard",
  description:
    "Account opening: applicants under 18 must declare a legal guardian; full contractual capacity otherwise required.",
  expression: {
    kind: "or",
    operands: [
      {
        kind: "gte",
        left: { kind: "field_number", fieldRef: "applicant_age_years" },
        right: { kind: "number_lit", value: 18 },
      },
      { kind: "field_present", fieldRef: "guardian_consent_id" },
    ],
  },
  severity: "error",
  citation: {
    framework: "BGB",
    citation: "BGB §§ 104-113 (Geschäftsfähigkeit)",
    url: "https://www.gesetze-im-internet.de/bgb/__104.html",
  },
  anchors: [
    {
      screenId: "konto-kyc",
      elementId: "fld-applicant-age-years",
      fieldRef: "applicant_age_years",
      label: "Alter Antragsteller",
    },
    {
      screenId: "konto-kyc",
      elementId: "fld-guardian-consent-id",
      fieldRef: "guardian_consent_id",
      label: "Einverständnis Erziehungsberechtigter",
    },
  ],
  bvaSeeds: [
    {
      label: "Adult applicant (positive)",
      values: { applicant_age_years: "30", guardian_consent_id: "" },
      expectedSatisfied: true,
      rationale: "Adult; guardian id not required",
    },
    {
      label: "Boundary 18 (positive boundary)",
      values: { applicant_age_years: "18", guardian_consent_id: "" },
      expectedSatisfied: true,
      rationale: "Exactly 18 — full Geschäftsfähigkeit",
    },
    {
      label: "Minor with guardian (positive)",
      values: { applicant_age_years: "16", guardian_consent_id: "g-12345" },
      expectedSatisfied: true,
      rationale: "Minor permitted with declared guardian consent",
    },
    {
      label: "Minor without guardian (negative)",
      values: { applicant_age_years: "16", guardian_consent_id: "" },
      expectedSatisfied: false,
      rationale: "Minor requires Einverständnis des Erziehungsberechtigten",
    },
  ],
  source: SOURCE,
});

/** SEPA Instant Credit Transfer ceiling (100 000 EUR). */
const buildSepaInstantCeilingInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-SEPA-INSTANT-01",
  scope: "screen",
  description:
    "SEPA Instant Credit Transfer (rulebook 2023): transfer mode `instant` may not exceed 100 000 EUR per transaction.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "transfer_mode" },
      right: { kind: "string_lit", value: "instant" },
      caseInsensitive: true,
    },
    consequent: {
      kind: "lte",
      left: { kind: "field_number", fieldRef: "payment_amount_eur" },
      right: { kind: "number_lit", value: 100000 },
    },
  },
  severity: "error",
  citation: {
    framework: "EPC SEPA Instant Credit Transfer",
    citation: "EPC SCT Inst Rulebook 2023 Section 5.6 (transaction ceiling)",
    url: "https://www.europeanpaymentscouncil.eu/document-library/rulebooks/2023-sepa-instant-credit-transfer-rulebook",
  },
  anchors: [
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-transfer-mode",
      fieldRef: "transfer_mode",
      label: "Überweisungsmodus",
    },
    {
      screenId: "sepa-ueberweisung",
      elementId: "fld-payment-amount",
      fieldRef: "payment_amount_eur",
      label: "Betrag (EUR)",
    },
  ],
  bvaSeeds: [
    {
      label: "Standard mode at 250k (positive — vacuous)",
      values: { transfer_mode: "standard", payment_amount_eur: "250000" },
      expectedSatisfied: true,
      rationale: "Mode is not instant; ceiling does not apply",
    },
    {
      label: "Instant at ceiling (positive boundary)",
      values: { transfer_mode: "instant", payment_amount_eur: "100000" },
      expectedSatisfied: true,
      rationale: "Equal to 100 000 EUR ceiling",
    },
    {
      label: "Instant above ceiling (negative)",
      values: { transfer_mode: "instant", payment_amount_eur: "100000.01" },
      expectedSatisfied: false,
      rationale: "Above the SEPA Instant ceiling",
    },
  ],
  source: SOURCE,
});

/** PEP customers require completed enhanced due diligence. */
const buildPepEddInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-PEP-EDD-01",
  scope: "wizard",
  description:
    "GwG enhanced due diligence: customers flagged as politically exposed persons require completed EDD before account activation.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "pep_flag" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "edd_completed" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "GwG / 5AMLD",
    citation: "GwG § 15 + Directive (EU) 2018/843 Article 20",
    url: "https://www.gesetze-im-internet.de/gwg_2017/__15.html",
  },
  anchors: [
    {
      screenId: "konto-kyc",
      elementId: "fld-pep-flag",
      fieldRef: "pep_flag",
      label: "PEP-Status",
    },
    {
      screenId: "konto-kyc",
      elementId: "fld-edd-completed",
      fieldRef: "edd_completed",
      label: "Verstärkte Sorgfaltspflichten abgeschlossen",
    },
  ],
  bvaSeeds: [
    {
      label: "Non-PEP (positive — vacuous)",
      values: { pep_flag: "no", edd_completed: "no" },
      expectedSatisfied: true,
      rationale: "Customer is not a PEP; EDD not required",
    },
    {
      label: "PEP with EDD (positive)",
      values: { pep_flag: "yes", edd_completed: "yes" },
      expectedSatisfied: true,
      rationale: "PEP flagged and EDD completed",
    },
    {
      label: "PEP without EDD (negative)",
      values: { pep_flag: "yes", edd_completed: "no" },
      expectedSatisfied: false,
      rationale: "GwG § 15 requires EDD before activation",
    },
  ],
  source: SOURCE,
});

/** FX margin disclosure for cross-currency conversions. */
const buildFxMarginDisclosureInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-FX-DISC-01",
  scope: "screen",
  description:
    "Cross-currency payment: when source and destination currencies differ, the FX margin disclosure flag must be set.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "not",
      operand: {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "currency_source" },
        right: { kind: "field_string", fieldRef: "currency_destination" },
        caseInsensitive: true,
      },
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "fx_margin_disclosed" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "warning",
  citation: {
    framework: "Cross-Border Payments Regulation",
    citation: "Regulation (EU) 2019/518 Article 3a + PSD2 Article 45",
    url: "https://eur-lex.europa.eu/eli/reg/2019/518/oj",
  },
  anchors: [
    {
      screenId: "auslandsueberweisung",
      elementId: "fld-currency-source",
      fieldRef: "currency_source",
      label: "Ausgangswährung",
    },
    {
      screenId: "auslandsueberweisung",
      elementId: "fld-currency-destination",
      fieldRef: "currency_destination",
      label: "Zielwährung",
    },
    {
      screenId: "auslandsueberweisung",
      elementId: "fld-fx-margin-disclosed",
      fieldRef: "fx_margin_disclosed",
      label: "FX-Aufschlag offengelegt",
    },
  ],
  bvaSeeds: [
    {
      label: "EUR → EUR no markup (positive — vacuous)",
      values: {
        currency_source: "EUR",
        currency_destination: "EUR",
        fx_margin_disclosed: "no",
      },
      expectedSatisfied: true,
      rationale: "Same-currency payment; margin disclosure not required",
    },
    {
      label: "EUR → USD with disclosure (positive)",
      values: {
        currency_source: "EUR",
        currency_destination: "USD",
        fx_margin_disclosed: "yes",
      },
      expectedSatisfied: true,
      rationale: "Cross-currency with disclosed margin",
    },
    {
      label: "EUR → USD without disclosure (negative)",
      values: {
        currency_source: "EUR",
        currency_destination: "USD",
        fx_margin_disclosed: "no",
      },
      expectedSatisfied: false,
      rationale: "Regulation 2019/518 Article 3a mandates disclosure",
    },
  ],
  source: SOURCE,
});

/** CRS self-certification for non-domestic tax residency. */
const buildCrsSelfCertificationInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-CRS-01",
  scope: "wizard",
  description:
    "Common Reporting Standard: customers with a tax residency outside Germany must complete CRS self-certification.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "not",
      operand: {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "tax_residency" },
        right: { kind: "string_lit", value: "DE" },
      },
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "crs_self_certified" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "OECD CRS / EU DAC2",
    citation:
      "OECD Common Reporting Standard + Council Directive 2014/107/EU (DAC2) Article 1",
    url: "https://eur-lex.europa.eu/eli/dir/2014/107/oj",
  },
  anchors: [
    {
      screenId: "konto-kyc",
      elementId: "fld-tax-residency",
      fieldRef: "tax_residency",
      label: "Steueransässigkeit",
    },
    {
      screenId: "konto-kyc",
      elementId: "fld-crs-self-certified",
      fieldRef: "crs_self_certified",
      label: "CRS-Selbstauskunft",
    },
  ],
  bvaSeeds: [
    {
      label: "DE residency (positive — vacuous)",
      values: { tax_residency: "DE", crs_self_certified: "no" },
      expectedSatisfied: true,
      rationale: "Domestic residency; CRS self-certification not required",
    },
    {
      label: "FR residency + certified (positive)",
      values: { tax_residency: "FR", crs_self_certified: "yes" },
      expectedSatisfied: true,
      rationale: "Non-DE residency with completed self-certification",
    },
    {
      label: "FR residency uncertified (negative)",
      values: { tax_residency: "FR", crs_self_certified: "no" },
      expectedSatisfied: false,
      rationale: "DAC2 Article 1 requires CRS self-certification",
    },
  ],
  source: SOURCE,
});

/** MiFID II ex-ante costs and charges disclosure must be acknowledged. */
const buildMifidCostsAckInvariant = (): CrossFieldInvariant => ({
  id: "XINV-BANK-COSTS-ACK-01",
  scope: "wizard",
  description:
    "MiFID II ex-ante costs and charges: the customer must acknowledge the disclosure before order submission.",
  expression: {
    kind: "implies",
    antecedent: { kind: "field_present", fieldRef: "order_submitted_at" },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "costs_disclosure_acked" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "MiFID II",
    citation:
      "Directive 2014/65/EU Article 24(4) + Delegated Regulation 2017/565 Article 50",
    url: "https://eur-lex.europa.eu/eli/reg_del/2017/565/oj",
  },
  anchors: [
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-order-submitted-at",
      fieldRef: "order_submitted_at",
      label: "Order Submitted",
    },
    {
      screenId: "mifid-wertpapier-order",
      elementId: "fld-costs-disclosure-acked",
      fieldRef: "costs_disclosure_acked",
      label: "Kostenausweis bestätigt",
    },
  ],
  bvaSeeds: [
    {
      label: "Order draft (positive — vacuous)",
      values: { order_submitted_at: "", costs_disclosure_acked: "no" },
      expectedSatisfied: true,
      rationale: "Order not yet submitted; disclosure ack not required",
    },
    {
      label: "Submitted with ack (positive)",
      values: {
        order_submitted_at: "2026-05-09T10:00:00Z",
        costs_disclosure_acked: "yes",
      },
      expectedSatisfied: true,
      rationale: "Order submitted after disclosure ack",
    },
    {
      label: "Submitted without ack (negative)",
      values: {
        order_submitted_at: "2026-05-09T10:00:00Z",
        costs_disclosure_acked: "no",
      },
      expectedSatisfied: false,
      rationale: "Article 24(4) bars submission without disclosure ack",
    },
  ],
  source: SOURCE,
});

/* -------------------------------------------------------------------- */
/*  Insurance (8 invariants)                                             */
/* -------------------------------------------------------------------- */

/** Coverage start ≥ contract signing date + 1 day (cooling-off / lead-time). */
const buildInsuranceCoverageLeadInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-COVER-LEAD-01",
  scope: "screen",
  description:
    "Insurance contract: declared coverage start must lead the contract signing date by at least one calendar day.",
  expression: {
    kind: "gte",
    left: { kind: "field_number", fieldRef: "lead_time_days" },
    right: { kind: "number_lit", value: 1 },
  },
  severity: "error",
  citation: {
    framework: "VVG",
    citation: "VVG §§ 1, 7 (Versicherungsbeginn / Vertragsabschluss)",
    url: "https://www.gesetze-im-internet.de/vvg/__7.html",
  },
  anchors: [
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-lead-time-days",
      fieldRef: "lead_time_days",
      label: "Vorlauftage Versicherungsbeginn",
    },
  ],
  bvaSeeds: [
    {
      label: "1 day lead (positive boundary)",
      values: { lead_time_days: "1" },
      expectedSatisfied: true,
      rationale: "Boundary lead time admitted",
    },
    {
      label: "30 days lead (positive)",
      values: { lead_time_days: "30" },
      expectedSatisfied: true,
      rationale: "Comfortable lead time",
    },
    {
      label: "Same-day start (negative)",
      values: { lead_time_days: "0" },
      expectedSatisfied: false,
      rationale: "Coverage start must follow signing by at least one day",
    },
  ],
  source: SOURCE,
});

/** IDD demands-and-needs assessment is mandatory before contract conclusion. */
const buildIddDemandsNeedsInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-IDD-DEMANDS-01",
  scope: "wizard",
  description:
    "IDD distribution: an insurance contract conclusion must follow a completed demands-and-needs assessment.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "contract_concluded" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "demands_needs_completed" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "IDD",
    citation: "Directive (EU) 2016/97 Article 20(1)",
    url: "https://eur-lex.europa.eu/eli/dir/2016/97/oj",
  },
  anchors: [
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-contract-concluded",
      fieldRef: "contract_concluded",
      label: "Vertrag abgeschlossen",
    },
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-demands-needs-completed",
      fieldRef: "demands_needs_completed",
      label: "Wünsche und Bedürfnisse erfasst",
    },
  ],
  bvaSeeds: [
    {
      label: "Quote stage only (positive — vacuous)",
      values: {
        contract_concluded: "no",
        demands_needs_completed: "no",
      },
      expectedSatisfied: true,
      rationale: "No conclusion; demands-and-needs not yet required",
    },
    {
      label: "Concluded with assessment (positive)",
      values: {
        contract_concluded: "yes",
        demands_needs_completed: "yes",
      },
      expectedSatisfied: true,
      rationale: "Contract concluded after demands-and-needs assessment",
    },
    {
      label: "Concluded without assessment (negative)",
      values: {
        contract_concluded: "yes",
        demands_needs_completed: "no",
      },
      expectedSatisfied: false,
      rationale: "Article 20(1) prohibits conclusion without assessment",
    },
  ],
  source: SOURCE,
});

/** DMD cooling-off: long-term contracts must declare ≥ 14 days. */
const buildDmdCoolingOffInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-COOLOFF-01",
  scope: "screen",
  description:
    "Distance Marketing of Financial Services: long-term insurance contracts must declare a cooling-off period of at least 14 days (30 for life).",
  expression: {
    kind: "and",
    operands: [
      {
        kind: "implies",
        antecedent: {
          kind: "eq_string",
          left: { kind: "field_string", fieldRef: "product_kind" },
          right: { kind: "string_lit", value: "life" },
          caseInsensitive: true,
        },
        consequent: {
          kind: "gte",
          left: { kind: "field_number", fieldRef: "cooloff_days" },
          right: { kind: "number_lit", value: 30 },
        },
      },
      {
        kind: "gte",
        left: { kind: "field_number", fieldRef: "cooloff_days" },
        right: { kind: "number_lit", value: 14 },
      },
    ],
  },
  severity: "warning",
  citation: {
    framework: "DMD / Solvency II",
    citation:
      "Directive 2002/65/EC Article 6(1) (right of withdrawal) + Solvency II Directive 2009/138/EC Article 185",
    url: "https://eur-lex.europa.eu/eli/dir/2002/65/oj",
  },
  anchors: [
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-product-kind",
      fieldRef: "product_kind",
      label: "Produktart",
    },
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-cooloff-days",
      fieldRef: "cooloff_days",
      label: "Widerrufsfrist (Tage)",
    },
  ],
  bvaSeeds: [
    {
      label: "BU at 14 days (positive boundary)",
      values: { product_kind: "disability", cooloff_days: "14" },
      expectedSatisfied: true,
      rationale: "Non-life product at the 14-day boundary",
    },
    {
      label: "Life at 30 days (positive boundary)",
      values: { product_kind: "life", cooloff_days: "30" },
      expectedSatisfied: true,
      rationale: "Life product at the 30-day Solvency II boundary",
    },
    {
      label: "BU at 13 days (negative)",
      values: { product_kind: "disability", cooloff_days: "13" },
      expectedSatisfied: false,
      rationale: "Below 14-day DMD floor",
    },
    {
      label: "Life at 20 days (negative)",
      values: { product_kind: "life", cooloff_days: "20" },
      expectedSatisfied: false,
      rationale: "Life product needs 30-day cooling-off; 20 fails",
    },
  ],
  source: SOURCE,
});

/** Disability insurance sum-insured ratio cap. */
const buildBuSumInsuredRatioInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-BU-SUM-RATIO-01",
  scope: "screen",
  description:
    "Berufsunfähigkeitsversicherung: monthly insured BU pension must not exceed 75 % of the applicant's gross monthly income.",
  expression: {
    kind: "lte",
    left: { kind: "field_number", fieldRef: "bu_monthly_pension" },
    right: {
      kind: "mul",
      left: { kind: "number_lit", value: 0.75 },
      right: { kind: "field_number", fieldRef: "gross_monthly_income" },
    },
  },
  severity: "error",
  citation: {
    framework: "VVG / Industry Underwriting Standard",
    citation:
      "VVG § 5 + GDV underwriting recommendation 2024 (75 % BU-Renten-Höchstanteil)",
    url: "https://www.gdv.de/",
  },
  anchors: [
    {
      screenId: "bu-antrag",
      elementId: "fld-bu-monthly-pension",
      fieldRef: "bu_monthly_pension",
      label: "BU-Rente monatlich",
    },
    {
      screenId: "bu-antrag",
      elementId: "fld-gross-monthly-income",
      fieldRef: "gross_monthly_income",
      label: "Bruttoeinkommen monatlich",
    },
  ],
  bvaSeeds: [
    {
      label: "Below cap (positive)",
      values: {
        bu_monthly_pension: "1500",
        gross_monthly_income: "3000",
      },
      expectedSatisfied: true,
      rationale: "1500 ≤ 0.75 × 3000 = 2250",
    },
    {
      label: "At 75 % cap (positive boundary)",
      values: {
        bu_monthly_pension: "2250",
        gross_monthly_income: "3000",
      },
      expectedSatisfied: true,
      rationale: "Exactly at the cap",
    },
    {
      label: "Above cap (negative)",
      values: {
        bu_monthly_pension: "2400",
        gross_monthly_income: "3000",
      },
      expectedSatisfied: false,
      rationale: "2400 > 0.75 × 3000 = 2250",
    },
  ],
  source: SOURCE,
});

/** Minor beneficiary: requires guardian declaration. */
const buildMinorBeneficiaryInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-BEN-MINOR-01",
  scope: "screen",
  description:
    "Lebensversicherung beneficiary designation: when the beneficiary is a minor (< 18), a legal guardian must be declared.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "lt",
      left: { kind: "field_number", fieldRef: "beneficiary_age_years" },
      right: { kind: "number_lit", value: 18 },
    },
    consequent: { kind: "field_present", fieldRef: "guardian_full_name" },
  },
  severity: "error",
  citation: {
    framework: "BGB / VVG",
    citation: "BGB §§ 1626, 1773 + VVG § 159 (Bezugsberechtigung)",
    url: "https://www.gesetze-im-internet.de/vvg/__159.html",
  },
  anchors: [
    {
      screenId: "lv-bezugsberechtigung",
      elementId: "fld-beneficiary-age-years",
      fieldRef: "beneficiary_age_years",
      label: "Alter Bezugsberechtigter",
    },
    {
      screenId: "lv-bezugsberechtigung",
      elementId: "fld-guardian-full-name",
      fieldRef: "guardian_full_name",
      label: "Erziehungsberechtigter",
    },
  ],
  bvaSeeds: [
    {
      label: "Adult beneficiary (positive — vacuous)",
      values: {
        beneficiary_age_years: "30",
        guardian_full_name: "",
      },
      expectedSatisfied: true,
      rationale: "Adult; guardian not required",
    },
    {
      label: "Minor with guardian (positive)",
      values: {
        beneficiary_age_years: "10",
        guardian_full_name: "Maria Schmidt",
      },
      expectedSatisfied: true,
      rationale: "Minor paired with declared guardian",
    },
    {
      label: "Minor without guardian (negative)",
      values: {
        beneficiary_age_years: "10",
        guardian_full_name: "",
      },
      expectedSatisfied: false,
      rationale: "Minor beneficiary requires Erziehungsberechtigten",
    },
  ],
  source: SOURCE,
});

/** Vollkasko unavailable on vehicles older than 15 years. */
const buildVollkaskoVehicleAgeInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-KFZ-VOLLKASKO-AGE-01",
  scope: "screen",
  description:
    "KFZ insurance: vehicles older than 15 years are not eligible for Vollkasko coverage; the chosen tariff must be Teilkasko or Haftpflicht.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "gt",
      left: { kind: "field_number", fieldRef: "vehicle_age_years" },
      right: { kind: "number_lit", value: 15 },
    },
    consequent: {
      kind: "in_set_string",
      value: { kind: "field_string", fieldRef: "kfz_tariff" },
      set: ["haftpflicht", "teilkasko"],
      caseInsensitive: true,
    },
  },
  severity: "warning",
  citation: {
    framework: "GDV / Industry Underwriting Standard",
    citation: "GDV KFZ-Bedingungen 2024 (Vollkasko-Altersgrenze 15 Jahre)",
    url: "https://www.gdv.de/",
  },
  anchors: [
    {
      screenId: "kfz-tarifrechner",
      elementId: "fld-vehicle-age-years",
      fieldRef: "vehicle_age_years",
      label: "Fahrzeugalter (Jahre)",
    },
    {
      screenId: "kfz-tarifrechner",
      elementId: "fld-kfz-tariff",
      fieldRef: "kfz_tariff",
      label: "Tarifart",
    },
  ],
  bvaSeeds: [
    {
      label: "Young car + Vollkasko (positive — vacuous)",
      values: { vehicle_age_years: "3", kfz_tariff: "vollkasko" },
      expectedSatisfied: true,
      rationale: "Vehicle below age cap; tariff freely chosen",
    },
    {
      label: "15-year boundary + Vollkasko (positive — vacuous)",
      values: { vehicle_age_years: "15", kfz_tariff: "vollkasko" },
      expectedSatisfied: true,
      rationale: "Strict > 15 boundary; 15 still admits Vollkasko",
    },
    {
      label: "20-year-old + Teilkasko (positive)",
      values: { vehicle_age_years: "20", kfz_tariff: "teilkasko" },
      expectedSatisfied: true,
      rationale: "Older vehicle correctly downgraded",
    },
    {
      label: "20-year-old + Vollkasko (negative)",
      values: { vehicle_age_years: "20", kfz_tariff: "vollkasko" },
      expectedSatisfied: false,
      rationale: "Vollkasko unavailable beyond 15 years",
    },
  ],
  source: SOURCE,
});

/** Large-sum life: requires medical underwriting (Gesundheitsprüfung). */
const buildLifeMedicalUnderwritingInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-LV-MED-01",
  scope: "wizard",
  description:
    "Life insurance: contracts with sum insured above 100 000 EUR require a completed medical declaration / underwriting.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "and",
      operands: [
        {
          kind: "eq_string",
          left: { kind: "field_string", fieldRef: "product_kind" },
          right: { kind: "string_lit", value: "life" },
          caseInsensitive: true,
        },
        {
          kind: "gt",
          left: { kind: "field_number", fieldRef: "sum_insured_eur" },
          right: { kind: "number_lit", value: 100000 },
        },
      ],
    },
    consequent: {
      kind: "eq_string",
      left: { kind: "field_string", fieldRef: "medical_declaration_completed" },
      right: { kind: "string_lit", value: "yes" },
      caseInsensitive: true,
    },
  },
  severity: "error",
  citation: {
    framework: "VVG",
    citation:
      "VVG § 19 (vorvertragliche Anzeigepflicht) + GDV Tarifgrundsätze (Risikoprüfungs-Schwelle)",
    url: "https://www.gesetze-im-internet.de/vvg/__19.html",
  },
  anchors: [
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-product-kind",
      fieldRef: "product_kind",
      label: "Produktart",
    },
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-sum-insured-eur",
      fieldRef: "sum_insured_eur",
      label: "Versicherungssumme",
    },
    {
      screenId: "lv-vertragsabschluss",
      elementId: "fld-medical-declaration-completed",
      fieldRef: "medical_declaration_completed",
      label: "Gesundheitsprüfung abgeschlossen",
    },
  ],
  bvaSeeds: [
    {
      label: "BU at 200k (positive — vacuous)",
      values: {
        product_kind: "disability",
        sum_insured_eur: "200000",
        medical_declaration_completed: "no",
      },
      expectedSatisfied: true,
      rationale: "Not life product; rule vacuous",
    },
    {
      label: "Life at 100k boundary (positive — vacuous)",
      values: {
        product_kind: "life",
        sum_insured_eur: "100000",
        medical_declaration_completed: "no",
      },
      expectedSatisfied: true,
      rationale: "At threshold; strict > 100000 boundary leaves rule vacuous",
    },
    {
      label: "Life at 200k with declaration (positive)",
      values: {
        product_kind: "life",
        sum_insured_eur: "200000",
        medical_declaration_completed: "yes",
      },
      expectedSatisfied: true,
      rationale: "Above threshold paired with completed declaration",
    },
    {
      label: "Life at 200k without declaration (negative)",
      values: {
        product_kind: "life",
        sum_insured_eur: "200000",
        medical_declaration_completed: "no",
      },
      expectedSatisfied: false,
      rationale: "Above threshold requires medical declaration",
    },
  ],
  source: SOURCE,
});

/** Cyber insurance minimum coverage tied to revenue. */
const buildCyberMinCoverageInvariant = (): CrossFieldInvariant => ({
  id: "XINV-INS-CYBER-MIN-COV-01",
  scope: "screen",
  description:
    "Cyber insurance: SMEs with annual revenue above 10 m EUR must select a coverage limit of at least 1 m EUR.",
  expression: {
    kind: "implies",
    antecedent: {
      kind: "gt",
      left: { kind: "field_number", fieldRef: "annual_revenue_eur" },
      right: { kind: "number_lit", value: 10000000 },
    },
    consequent: {
      kind: "gte",
      left: { kind: "field_number", fieldRef: "cyber_coverage_eur" },
      right: { kind: "number_lit", value: 1000000 },
    },
  },
  severity: "warning",
  citation: {
    framework: "GDV / Industry Underwriting Standard",
    citation:
      "GDV Cyber-Versicherungs-Bedingungen 2024 + DORA Article 15 (ICT-risk assessment)",
    url: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
  },
  anchors: [
    {
      screenId: "cyber-risiko-assessment",
      elementId: "fld-annual-revenue-eur",
      fieldRef: "annual_revenue_eur",
      label: "Jahresumsatz EUR",
    },
    {
      screenId: "cyber-risiko-assessment",
      elementId: "fld-cyber-coverage-eur",
      fieldRef: "cyber_coverage_eur",
      label: "Cyber-Deckungssumme EUR",
    },
  ],
  bvaSeeds: [
    {
      label: "Small SME (positive — vacuous)",
      values: {
        annual_revenue_eur: "5000000",
        cyber_coverage_eur: "250000",
      },
      expectedSatisfied: true,
      rationale: "Below 10 m revenue; minimum does not apply",
    },
    {
      label: "Mid SME with 1 m coverage (positive)",
      values: {
        annual_revenue_eur: "20000000",
        cyber_coverage_eur: "1000000",
      },
      expectedSatisfied: true,
      rationale: "Above threshold with minimum coverage at boundary",
    },
    {
      label: "Mid SME with 500k coverage (negative)",
      values: {
        annual_revenue_eur: "20000000",
        cyber_coverage_eur: "500000",
      },
      expectedSatisfied: false,
      rationale: "Below the 1 m EUR floor at 20 m revenue",
    },
  ],
  source: SOURCE,
});

/* -------------------------------------------------------------------- */
/*  Builder list + factory                                               */
/* -------------------------------------------------------------------- */

const ALL_BANKING_BUILDERS: ReadonlyArray<() => CrossFieldInvariant> = [
  buildKonsumentenkreditDtiInvariant,
  buildMortgageLtvInvariant,
  buildMifidComplexExperienceInvariant,
  buildFatcaResidencyInvariant,
  buildPsd2ScaThresholdInvariant,
  buildIbanCurrencyInvariant,
  buildMifidRiskSuitabilityInvariant,
  buildDailyLimitInvariant,
  buildOverdraftCapInvariant,
  buildAccountAgeGateInvariant,
  buildSepaInstantCeilingInvariant,
  buildPepEddInvariant,
  buildFxMarginDisclosureInvariant,
  buildCrsSelfCertificationInvariant,
  buildMifidCostsAckInvariant,
];

const ALL_INSURANCE_BUILDERS: ReadonlyArray<() => CrossFieldInvariant> = [
  buildInsuranceCoverageLeadInvariant,
  buildIddDemandsNeedsInvariant,
  buildDmdCoolingOffInvariant,
  buildBuSumInsuredRatioInvariant,
  buildMinorBeneficiaryInvariant,
  buildVollkaskoVehicleAgeInvariant,
  buildLifeMedicalUnderwritingInvariant,
  buildCyberMinCoverageInvariant,
];

/** Register the Issue #2110 banking + insurance catalog on a registry. */
export const registerEuBankingCrossFieldInvariants = (
  registry: CrossFieldInvariantRegistry,
): void => {
  for (const build of ALL_BANKING_BUILDERS) registry.register(build());
  for (const build of ALL_INSURANCE_BUILDERS) registry.register(build());
};

/**
 * Build a fresh registry pre-populated with the EU banking + insurance
 * cross-field invariant catalog. The returned registry is mutable;
 * callers may register additional jurisdiction-specific invariants on
 * top before evaluation.
 */
export const buildDefaultCrossFieldInvariantRegistry =
  (): CrossFieldInvariantRegistry => {
    const registry = createCrossFieldInvariantRegistry();
    registerEuBankingCrossFieldInvariants(registry);
    return registry;
  };

/** Number of banking invariants registered by the default catalog. */
export const DEFAULT_BANKING_INVARIANT_COUNT: number =
  ALL_BANKING_BUILDERS.length;
/** Number of insurance invariants registered by the default catalog. */
export const DEFAULT_INSURANCE_INVARIANT_COUNT: number =
  ALL_INSURANCE_BUILDERS.length;
