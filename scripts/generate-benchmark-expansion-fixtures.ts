/**
 * Issue #2115 — generator for the benchmark expansion suite.
 *
 * Produces 28 stratified-random benchmark fixtures (figma.json,
 * expected.summary.json, compliance.json) under
 * `src/test-intelligence/fixtures/`. The expansion brings the
 * Test-Intelligence benchmark from 22 to 50 fixtures, satisfying
 * the per-stratum minimum counts defined in
 * `docs/decisions/0042-benchmark-sample-plan.md`.
 *
 * Idempotent: running this script overwrites the generated fixtures
 * with byte-stable canonical JSON. The companion test
 * (`benchmark-expansion-fixtures.test.ts`) asserts that each summary
 * matches the actual derivation output for its figma input, so any
 * drift between the generator and the derivation pipeline is caught
 * at test time.
 *
 * Run: `pnpm exec tsx scripts/generate-benchmark-expansion-fixtures.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TestCaseRiskCategory } from "../src/contracts/index.js";
import { canonicalJson } from "../src/test-intelligence/content-hash.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
  type IntentDerivationNodeInput,
  type IntentDerivationScreenInput,
} from "../src/test-intelligence/intent-derivation.js";

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname,
  "..",
  "src",
  "test-intelligence",
  "fixtures",
);

export type BenchmarkStratum =
  | "banking-retail"
  | "banking-corporate"
  | "insurance-life"
  | "insurance-non-life"
  | "insurance-health"
  | "regulatory-reporting";

export type BenchmarkLocale = "de" | "en" | "fr" | "it";

export type BenchmarkAdversarialKind =
  | "multi-step-wizard"
  | "conditional-section"
  | "multilingual"
  | "a11y-stress"
  | "deeply-nested-validation";

interface NodeSpec {
  id: string;
  type:
    | "TEXT_INPUT"
    | "RADIO_OPTION"
    | "SELECT_FIELD"
    | "RESULT_DISPLAY"
    | "INFORMATIVE_LABEL"
    | "BUTTON"
    | "LINK";
  name: string;
  text?: string;
  path: string;
  defaultValue?: string;
  validations?: readonly string[];
  navigationTarget?: string;
}

interface ScreenSpec {
  id: string;
  name: string;
  path: string;
  nodes: readonly NodeSpec[];
}

interface ComplianceSpec {
  regulations: readonly string[];
  complianceRulePackIds: readonly string[];
  auditCriticality: "low" | "medium" | "high";
  regulatedRiskOverride: TestCaseRiskCategory;
  rationale: string;
}

interface FixtureSpec {
  id: string;
  archetype: string;
  stratum: BenchmarkStratum;
  domain: "banking" | "insurance" | "compliance";
  tier: 1 | 2 | 3;
  adversarial: boolean;
  adversarialKind?: BenchmarkAdversarialKind;
  locale: BenchmarkLocale;
  intent: string;
  notes: string;
  screens: readonly ScreenSpec[];
  compliance: ComplianceSpec;
  applicableInvariants: readonly string[];
}

const buildFigmaInput = (
  spec: FixtureSpec,
): IntentDerivationFigmaInput => {
  const screens: IntentDerivationScreenInput[] = spec.screens.map((s) => {
    const nodes: IntentDerivationNodeInput[] = s.nodes.map((n) => {
      const node: IntentDerivationNodeInput = {
        nodeId: n.id,
        nodeName: n.name,
        nodeType: n.type,
        nodePath: n.path,
        text: n.text ?? n.name,
        childNodeIds: [],
      };
      if (n.defaultValue !== undefined) node.defaultValue = n.defaultValue;
      if (n.validations !== undefined) {
        node.validations = [...n.validations];
      }
      if (n.navigationTarget !== undefined) {
        node.navigationTarget = n.navigationTarget;
      }
      return node;
    });
    return {
      screenId: s.id,
      screenName: s.name,
      screenPath: s.path,
      nodes,
    };
  });
  return {
    source: { kind: "figma_local_json" },
    screens,
  };
};

const buildPrettyFigmaJson = (
  spec: FixtureSpec,
  input: IntentDerivationFigmaInput,
): string => {
  // Indented for human review; canonical-JSON requirement only applies
  // to summary and compliance sidecars.
  void spec;
  return JSON.stringify(input, null, 2) + "\n";
};

interface ExpansionSummary {
  schemaVersion: "1.0.0";
  archetypeId: string;
  archetype: string;
  stratum: BenchmarkStratum;
  domain: "banking" | "insurance" | "compliance";
  tier: 1 | 2 | 3;
  adversarial: boolean;
  adversarialKind: BenchmarkAdversarialKind | "";
  locale: BenchmarkLocale;
  intent: string;
  figma: {
    screenCount: number;
    nodeCount: number;
    fieldNodeCount: number;
    actionNodeCount: number;
    validationCount: number;
    navigationCount: number;
  };
  sources: { hasJira: false; hasCustomMarkdown: false };
  expectedOpenQuestionsKeywords: string[];
  notes: string;
}

const buildSummary = (
  spec: FixtureSpec,
  figma: IntentDerivationFigmaInput,
): ExpansionSummary => {
  const ir = deriveBusinessTestIntentIr({ figma });
  const nodeCount = figma.screens.reduce((acc, s) => acc + s.nodes.length, 0);
  const summary: ExpansionSummary = {
    schemaVersion: "1.0.0",
    archetypeId: spec.id,
    archetype: spec.archetype,
    stratum: spec.stratum,
    domain: spec.domain,
    tier: spec.tier,
    adversarial: spec.adversarial,
    adversarialKind: spec.adversarialKind ?? "",
    locale: spec.locale,
    intent: spec.intent,
    figma: {
      screenCount: figma.screens.length,
      nodeCount,
      fieldNodeCount: ir.detectedFields.length,
      actionNodeCount: ir.detectedActions.length,
      validationCount: ir.detectedValidations.length,
      navigationCount: ir.detectedNavigation.length,
    },
    sources: { hasJira: false, hasCustomMarkdown: false },
    expectedOpenQuestionsKeywords: [],
    notes: spec.notes,
  };
  return summary;
};

interface ExpansionCompliance {
  schemaVersion: "1.0.0";
  fixtureId: string;
  regulations: string[];
  complianceRulePackIds: string[];
  auditCriticality: "low" | "medium" | "high";
  regulatedRiskOverride: TestCaseRiskCategory;
  rationale: string;
}

const buildCompliance = (spec: FixtureSpec): ExpansionCompliance => ({
  schemaVersion: "1.0.0",
  fixtureId: spec.id,
  regulations: [...spec.compliance.regulations].sort(),
  complianceRulePackIds: [...spec.compliance.complianceRulePackIds].sort(),
  auditCriticality: spec.compliance.auditCriticality,
  regulatedRiskOverride: spec.compliance.regulatedRiskOverride,
  rationale: spec.compliance.rationale,
});

const FIXTURES = (): FixtureSpec[] => {
  // Helpers for compact node construction.
  const text = (
    id: string,
    name: string,
    path: string,
    validations: readonly string[] = [],
    extras: Partial<NodeSpec> = {},
  ): NodeSpec => ({
    id,
    type: "TEXT_INPUT",
    name,
    path,
    defaultValue: "",
    validations,
    ...extras,
  });
  const select = (
    id: string,
    name: string,
    path: string,
    defaultValue: string,
    validations: readonly string[] = ["Required"],
  ): NodeSpec => ({
    id,
    type: "SELECT_FIELD",
    name,
    path,
    defaultValue,
    validations,
  });
  const radio = (
    id: string,
    name: string,
    path: string,
    defaultValue = "No",
    validations: readonly string[] = ["Required"],
  ): NodeSpec => ({
    id,
    type: "RADIO_OPTION",
    name,
    path,
    defaultValue,
    validations,
  });
  const button = (
    id: string,
    name: string,
    path: string,
    navigationTarget?: string,
  ): NodeSpec => ({
    id,
    type: "BUTTON",
    name,
    path,
    ...(navigationTarget !== undefined ? { navigationTarget } : {}),
  });
  const info = (id: string, name: string, path: string): NodeSpec => ({
    id,
    type: "INFORMATIVE_LABEL",
    name,
    path,
  });

  return [
    // ─────────────── Banking retail (6) ───────────────
    {
      id: "benchmark-banking-retail-girokonto-eroeffnung",
      archetype: "girokonto-eroeffnung",
      stratum: "banking-retail",
      domain: "banking",
      tier: 1,
      adversarial: false,
      locale: "de",
      intent:
        "Single-screen Girokonto opening flow capturing applicant identity, contact channel, and AGB consent before submitting the account-opening request.",
      notes:
        "Stratum banking-retail (ECB SSM onboarding taxonomy). Lower-bound retail onboarding: one screen, eight fields, two compliance gates, one submit. Anchors the simple-mask end of the retail-onboarding distribution.",
      screens: [
        {
          id: "s-girokonto",
          name: "Girokonto eroeffnen",
          path: "/banking/retail/giro/open",
          nodes: [
            text(
              "n-vorname",
              "Vorname",
              "applicant/given-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-nachname",
              "Nachname",
              "applicant/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-geburtsdatum",
              "Geburtsdatum",
              "applicant/dob",
              ["Required", "ISO date", "Date implies age >= 18"],
            ),
            text(
              "n-email",
              "E-Mail",
              "applicant/contact/email",
              ["Required", "Email format"],
            ),
            text(
              "n-iban-referenz",
              "IBAN-Referenzkonto",
              "applicant/reference-iban",
              ["Required", "IBAN format"],
            ),
            select(
              "n-kontomodell",
              "Kontomodell",
              "product/giro-tier",
              "Basis",
              ["Required"],
            ),
            radio(
              "n-agb",
              "AGB akzeptiert",
              "compliance/agb-accepted",
            ),
            radio(
              "n-datenschutz",
              "Datenschutz akzeptiert",
              "compliance/privacy-accepted",
            ),
            button(
              "n-submit",
              "Konto eroeffnen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-6", "GwG", "PSD2"],
        complianceRulePackIds: ["eu-banking-onboarding-kyc-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Retail Girokonto opening triggers GwG identity verification and PSD2 contractual disclosures. GDPR Art-6(1)(b) supplies the lawful basis (contract). Customer has not yet authenticated, so SCA does not apply on this screen.",
      },
      applicableInvariants: ["INV-GDPR-ART15-01", "INV-KYC-AGE-01"],
    },
    {
      id: "benchmark-banking-retail-tagesgeld-aufgabe",
      archetype: "tagesgeld-aufgabe",
      stratum: "banking-retail",
      domain: "banking",
      tier: 1,
      adversarial: false,
      locale: "de",
      intent:
        "Tagesgeld deposit setup tying a new savings account to an existing Girokonto with an interest-tier disclosure and standing-order confirmation.",
      notes:
        "Stratum banking-retail (ECB retail-deposit taxonomy). Single-screen savings flow with one calculation result display and a standing-order confirmation. Tier-1 baseline; non-adversarial.",
      screens: [
        {
          id: "s-tagesgeld",
          name: "Tagesgeld einrichten",
          path: "/banking/retail/tagesgeld/setup",
          nodes: [
            text(
              "n-iban-source",
              "Quell-IBAN",
              "tagesgeld/source-iban",
              ["Required", "IBAN format", "IBAN is owned by applicant"],
            ),
            text(
              "n-betrag",
              "Erstanlage in EUR",
              "tagesgeld/initial-amount",
              ["Required", "Numeric", "Min 100", "Max 1000000"],
            ),
            select(
              "n-zinsmodell",
              "Zinsmodell",
              "tagesgeld/interest-tier",
              "Variabel",
              ["Required"],
            ),
            {
              id: "n-zins-anzeige",
              type: "RESULT_DISPLAY",
              name: "Zins p.a.",
              path: "tagesgeld/interest-rate",
              text: "Aktueller Zins p.a.",
              defaultValue: "",
              validations: [
                "Reflects active product table",
                "Updates when Zinsmodell changes",
              ],
            },
            radio(
              "n-zinsen-quartal",
              "Quartalsweise Zinszahlung",
              "tagesgeld/interest-frequency",
              "Yes",
            ),
            radio(
              "n-confirm-zins",
              "Zinsdisclosure bestaetigt",
              "compliance/zins-disclosure",
            ),
            button(
              "n-submit",
              "Tagesgeld eroeffnen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-6", "WpHG-Section-63"],
        complianceRulePackIds: ["eu-banking-savings-disclosure-v1"],
        auditCriticality: "low",
        regulatedRiskOverride: "low",
        rationale:
          "Standardised retail savings product with mandatory pre-contractual interest disclosure (WpHG s.63 + ECB SSM). No special-category data; lawful basis is contract performance.",
      },
      applicableInvariants: ["INV-NETTO-BRUTTO-01"],
    },
    {
      id: "benchmark-banking-retail-instant-payment-cooloff",
      archetype: "instant-payment-cooloff",
      stratum: "banking-retail",
      domain: "banking",
      tier: 2,
      adversarial: true,
      adversarialKind: "conditional-section",
      locale: "de",
      intent:
        "SEPA Instant Credit Transfer with a conditional cooling-off section that surfaces only for first-time recipients above a 10,000 EUR threshold; releases either after explicit override or after a delayed confirmation.",
      notes:
        "Stratum banking-retail (ECB SEPA Instant taxonomy). Adversarial-conditional fixture: the cool-off override field is only required when both 'recipient-new' and 'amount > 10000' fire. Models the highest-risk false-positive surface for the validation pipeline.",
      screens: [
        {
          id: "s-instant",
          name: "SEPA Instant Ueberweisung",
          path: "/banking/retail/payment/instant",
          nodes: [
            text(
              "n-empfaenger",
              "Empfaengername",
              "payment/recipient-name",
              ["Required", "Max 70 characters"],
            ),
            text(
              "n-iban-empfaenger",
              "Empfaenger-IBAN",
              "payment/recipient-iban",
              ["Required", "IBAN format"],
            ),
            text(
              "n-betrag",
              "Betrag in EUR",
              "payment/amount",
              [
                "Required",
                "Numeric",
                "Min 0.01",
                "Max 100000",
                "Cumulative daily ceiling 100000",
              ],
            ),
            text(
              "n-verwendungszweck",
              "Verwendungszweck",
              "payment/purpose",
              ["Max 140 characters"],
            ),
            radio(
              "n-recipient-new",
              "Empfaenger ist neu",
              "payment/recipient-is-new",
            ),
            text(
              "n-cooloff-override",
              "Cool-off Override Begruendung",
              "payment/cooloff-override-reason",
              [
                "Required if recipient-is-new is Yes and amount > 10000",
                "Min 20 characters",
                "Max 280 characters",
              ],
            ),
            radio(
              "n-sca-confirm",
              "SCA bestaetigt",
              "auth/sca-confirmed",
            ),
            button(
              "n-cancel",
              "Abbrechen",
              "actions/cancel",
            ),
            button(
              "n-submit",
              "Instant Ueberweisung ausloesen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: [
          "AML-CTF",
          "EBA-Guidelines-Fraud",
          "PSD2-SCA",
          "SEPA-Instant",
        ],
        complianceRulePackIds: ["eu-banking-payment-sca-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "SEPA Instant credit transfer in PSD2 SCA scope; AML/CTF cumulative limits apply; EBA fraud-control guidelines add a conditional cool-off override for first-recipient + high-amount combinations.",
      },
      applicableInvariants: [
        "INV-AML-CUMUL-01",
        "INV-PSD2-DYNLINK-01",
        "INV-PSD2-SCA-01",
      ],
    },
    {
      id: "benchmark-banking-retail-kreditkarten-antrag",
      archetype: "kreditkarten-antrag",
      stratum: "banking-retail",
      domain: "banking",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Two-screen credit-card application capturing income and employment data, then a Schufa-disclosure consent and product selection, ending in a final SCHUFA query confirmation.",
      notes:
        "Stratum banking-retail (ECB consumer-credit taxonomy). Two screens with one navigation edge; canonical mid-complexity retail credit application. Captures income, dependents, and the bonity-disclosure compliance gate.",
      screens: [
        {
          id: "s-kk-step1",
          name: "Kreditkarte Schritt 1: Einkommen",
          path: "/banking/retail/cc/step-1-income",
          nodes: [
            select(
              "n-anstellung",
              "Anstellungsverhaeltnis",
              "applicant/employment",
              "Angestellt",
              ["Required"],
            ),
            text(
              "n-arbeitgeber",
              "Arbeitgeber",
              "applicant/employer",
              ["Required if employment is Angestellt", "Max 80 characters"],
            ),
            text(
              "n-netto-einkommen",
              "Netto-Monatseinkommen in EUR",
              "applicant/income/net-monthly",
              ["Required", "Numeric", "Min 0", "Max 1000000"],
            ),
            text(
              "n-kinder",
              "Anzahl unterhaltsberechtigte Kinder",
              "applicant/dependents-count",
              ["Required", "Numeric", "Min 0", "Max 10"],
            ),
            radio(
              "n-zweiteinkommen",
              "Zweites Einkommen vorhanden",
              "applicant/income/second",
            ),
            button("n-next-1", "Weiter", "actions/next", "s-kk-step2"),
          ],
        },
        {
          id: "s-kk-step2",
          name: "Kreditkarte Schritt 2: Produkt",
          path: "/banking/retail/cc/step-2-product",
          nodes: [
            select(
              "n-produkt",
              "Kreditkartenprodukt",
              "product/cc-tier",
              "Classic",
              ["Required"],
            ),
            text(
              "n-wunschlimit",
              "Wunschlimit in EUR",
              "product/cc-limit",
              ["Required", "Numeric", "Min 500", "Max 50000"],
            ),
            radio(
              "n-schufa",
              "Einwilligung Schufa-Anfrage",
              "compliance/schufa-consent",
            ),
            radio(
              "n-agb",
              "AGB akzeptiert",
              "compliance/agb-accepted",
            ),
            button("n-back-2", "Zurueck", "actions/back", "s-kk-step1"),
            button("n-submit", "Kreditkarte beantragen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["BDSG-Section-31", "GDPR-Art-22", "VVG", "VerbrKrRL"],
        complianceRulePackIds: [
          "eu-banking-consumer-credit-v1",
          "eu-banking-onboarding-kyc-v1",
        ],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Consumer-credit product triggers VerbrKrRL/BDSG bonity-assessment rules; Schufa enquiry brings GDPR Art-22 (automated decision-making) into scope. Pre-contractual VVG disclosure and a SCHUFA-consent gate are mandatory.",
      },
      applicableInvariants: [
        "INV-FINANCING-NEED-01",
        "INV-KYC-AGE-01",
        "INV-NETTO-BRUTTO-01",
      ],
    },
    {
      id: "benchmark-banking-retail-streit-chargeback",
      archetype: "streit-chargeback",
      stratum: "banking-retail",
      domain: "banking",
      tier: 3,
      adversarial: true,
      adversarialKind: "multi-step-wizard",
      locale: "de",
      intent:
        "Three-step chargeback dispute wizard: transaction selection, dispute reason and evidence, then declaration and submission, with a back-edge between every step.",
      notes:
        "Stratum banking-retail. Adversarial multi-step wizard: three screens, six navigation edges. Stresses state retention, repeating attachment metadata, and conditional reason-code branching.",
      screens: [
        {
          id: "s-disp-1",
          name: "Chargeback Schritt 1: Transaktion",
          path: "/banking/retail/dispute/step-1",
          nodes: [
            text(
              "n-tx-id",
              "Transaktions-ID",
              "dispute/tx-id",
              ["Required", "Format TXN-############"],
            ),
            text(
              "n-tx-date",
              "Buchungsdatum",
              "dispute/tx-date",
              ["Required", "ISO date", "Date <= today"],
            ),
            text(
              "n-tx-amount",
              "Betrag in EUR",
              "dispute/tx-amount",
              ["Required", "Numeric", "Min 0.01"],
            ),
            text(
              "n-tx-merchant",
              "Haendler",
              "dispute/merchant-name",
              ["Required", "Max 80 characters"],
            ),
            button("n-next-1", "Weiter", "actions/next", "s-disp-2"),
          ],
        },
        {
          id: "s-disp-2",
          name: "Chargeback Schritt 2: Grund",
          path: "/banking/retail/dispute/step-2",
          nodes: [
            select(
              "n-reason",
              "Reklamationsgrund",
              "dispute/reason",
              "Ware nicht erhalten",
              ["Required"],
            ),
            text(
              "n-reason-detail",
              "Detailbeschreibung",
              "dispute/reason-detail",
              ["Required", "Min 30 characters", "Max 1000 characters"],
            ),
            text(
              "n-evidence-ref",
              "Evidenz-Referenz",
              "dispute/evidence-ref",
              [
                "Required if reason is 'Ware nicht erhalten' or 'Ware mangelhaft'",
                "Max 60 characters",
              ],
            ),
            radio(
              "n-merchant-contacted",
              "Haendler kontaktiert",
              "dispute/merchant-contacted",
            ),
            button("n-back-2", "Zurueck", "actions/back", "s-disp-1"),
            button("n-next-2", "Weiter", "actions/next", "s-disp-3"),
          ],
        },
        {
          id: "s-disp-3",
          name: "Chargeback Schritt 3: Erklaerung",
          path: "/banking/retail/dispute/step-3",
          nodes: [
            radio(
              "n-decl-truth",
              "Wahrheitsgemaesse Angaben",
              "dispute/declaration-truth",
            ),
            radio(
              "n-decl-card",
              "Karte nicht weitergegeben",
              "dispute/declaration-card-secrecy",
            ),
            radio(
              "n-decl-recover",
              "Keine Rueckerstattung erhalten",
              "dispute/declaration-no-recovery",
            ),
            radio(
              "n-agb",
              "AGB akzeptiert",
              "compliance/agb-accepted",
            ),
            button("n-back-3", "Zurueck", "actions/back", "s-disp-2"),
            button(
              "n-submit",
              "Reklamation einreichen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: [
          "EBA-Guidelines-Fraud",
          "Mastercard-Chargeback-Manual",
          "PSD2-Art-74",
        ],
        complianceRulePackIds: ["eu-banking-chargeback-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "Chargeback dispute under PSD2 Art-74 unauthorized-transaction liability. The declaration screen captures the customer attestation that conditions liability shifting; falsification has fraud implications. EBA fraud-control guidelines apply to evidence handling.",
      },
      applicableInvariants: ["INV-PSD2-SCA-01"],
    },
    {
      id: "benchmark-banking-retail-paydirekt-setup",
      archetype: "paydirekt-setup",
      stratum: "banking-retail",
      domain: "banking",
      tier: 1,
      adversarial: false,
      locale: "de",
      intent:
        "Pay-direct setup linking a Girokonto to the giropay/paydirekt e-commerce service with a one-time SCA confirmation.",
      notes:
        "Stratum banking-retail (paydirekt onboarding). Single-screen with one inline SCA radio acting as terminal action; no navigation edges.",
      screens: [
        {
          id: "s-paydirekt",
          name: "Paydirekt aktivieren",
          path: "/banking/retail/paydirekt/setup",
          nodes: [
            text(
              "n-iban-link",
              "Verknuepfte IBAN",
              "paydirekt/source-iban",
              ["Required", "IBAN format", "IBAN is owned by applicant"],
            ),
            text(
              "n-paydirekt-handle",
              "Paydirekt-Benutzername",
              "paydirekt/handle",
              ["Required", "Min 4 characters", "Max 32 characters"],
            ),
            text(
              "n-email",
              "Bestaetigungs-E-Mail",
              "paydirekt/email",
              ["Required", "Email format"],
            ),
            select(
              "n-limit-tier",
              "Tageslimit",
              "paydirekt/daily-limit",
              "1000",
              ["Required"],
            ),
            radio(
              "n-sca-confirm",
              "SCA bestaetigt",
              "auth/sca-confirmed",
            ),
            radio(
              "n-tos",
              "Nutzungsbedingungen akzeptiert",
              "compliance/tos-accepted",
            ),
            button("n-submit", "Paydirekt aktivieren", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-6", "PSD2-SCA"],
        complianceRulePackIds: ["eu-banking-payment-sca-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Pay-direct activation registers a payment instrument; PSD2 SCA covers the activation event. GDPR Art-6(1)(b) supplies the lawful basis (contract).",
      },
      applicableInvariants: ["INV-PSD2-SCA-01"],
    },

    // ─────────────── Banking corporate (4) ───────────────
    {
      id: "benchmark-banking-corp-firmenkunde-onboarding-en",
      archetype: "firmenkunde-onboarding",
      stratum: "banking-corporate",
      domain: "banking",
      tier: 3,
      adversarial: true,
      adversarialKind: "multilingual",
      locale: "en",
      intent:
        "English-language corporate onboarding for cross-border subsidiaries, capturing legal entity identifiers, beneficial-ownership chain, and a UBO-25%-threshold attestation.",
      notes:
        "Stratum banking-corporate (KYB onboarding). English-language to stress locale routing. Captures the LEI, UBO chain, and the GwG s.10 enhanced-due-diligence trigger when ownership chains exceed two layers.",
      screens: [
        {
          id: "s-kyb",
          name: "Corporate Onboarding",
          path: "/banking/corp/onboarding/kyb",
          nodes: [
            text(
              "n-legal-name",
              "Legal entity name",
              "entity/legal-name",
              ["Required", "Max 120 characters"],
            ),
            text(
              "n-lei",
              "LEI",
              "entity/lei",
              ["Required", "Length 20", "Format LEI-checksum"],
            ),
            text(
              "n-incorp-country",
              "Country of incorporation",
              "entity/incorp-country",
              ["Required", "ISO-3166 alpha-2"],
            ),
            text(
              "n-incorp-date",
              "Date of incorporation",
              "entity/incorp-date",
              ["Required", "ISO date", "Date <= today"],
            ),
            radio(
              "n-ubo-disclosed",
              "UBO chain disclosed",
              "kyb/ubo-disclosed",
            ),
            text(
              "n-ubo-name",
              "Primary UBO name",
              "kyb/ubo-name",
              ["Required if ubo-disclosed is Yes", "Max 80 characters"],
            ),
            text(
              "n-ubo-share",
              "Primary UBO ownership share (%)",
              "kyb/ubo-share",
              [
                "Required if ubo-disclosed is Yes",
                "Numeric",
                "Min 0",
                "Max 100",
                "Triggers EDD when share >= 25",
              ],
            ),
            radio(
              "n-edd-required",
              "Enhanced due diligence required",
              "kyb/edd-required",
            ),
            radio(
              "n-pep-related",
              "PEP-related party",
              "kyb/pep-related",
            ),
            button("n-submit", "Submit onboarding", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["AMLD6", "GwG-Section-10", "MiFID-II", "PSD2"],
        complianceRulePackIds: [
          "eu-banking-kyb-corp-v1",
          "eu-banking-onboarding-kyc-v1",
        ],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Corporate onboarding pulls in AMLD6 + GwG s.10 enhanced-due-diligence rules for ownership chains exceeding 25%. LEI capture and UBO disclosure are mandatory for SEPA/SWIFT eligibility.",
      },
      applicableInvariants: [
        "INV-GDPR-ART15-01",
        "INV-GWG-PEP-01",
        "INV-KYC-AGE-01",
      ],
    },
    {
      id: "benchmark-banking-corp-trade-finance-akkreditiv",
      archetype: "trade-finance-akkreditiv",
      stratum: "banking-corporate",
      domain: "banking",
      tier: 3,
      adversarial: true,
      adversarialKind: "deeply-nested-validation",
      locale: "de",
      intent:
        "Letter-of-credit (Akkreditiv) issuance with deeply nested Incoterms, sanction-screening, and document-presentation cross-rules where each shipment-mode change cascades across at least four downstream validations.",
      notes:
        "Stratum banking-corporate (trade finance). Adversarial fixture: nested validation chain triggered by Incoterms x shipment-mode x sanction-flag combinations. Stresses cross-field rule extraction for the policy-gate.",
      screens: [
        {
          id: "s-lc",
          name: "Akkreditiv eroeffnen",
          path: "/banking/corp/trade-finance/lc/issue",
          nodes: [
            text(
              "n-lc-number",
              "LC-Nummer",
              "lc/number",
              ["Required", "Format LC-############"],
            ),
            text(
              "n-applicant",
              "Auftraggeber",
              "lc/applicant",
              ["Required", "Max 120 characters"],
            ),
            text(
              "n-beneficiary",
              "Beguenstigter",
              "lc/beneficiary",
              ["Required", "Max 120 characters"],
            ),
            text(
              "n-amount",
              "LC-Betrag",
              "lc/amount",
              ["Required", "Numeric", "Min 1000", "Max 100000000"],
            ),
            select(
              "n-currency",
              "Waehrung",
              "lc/currency",
              "EUR",
              ["Required", "ISO-4217"],
            ),
            select(
              "n-incoterm",
              "Incoterm",
              "lc/incoterm",
              "FOB",
              ["Required"],
            ),
            select(
              "n-shipment-mode",
              "Versandart",
              "lc/shipment-mode",
              "Sea",
              ["Required"],
            ),
            text(
              "n-loading-port",
              "Verschiffungshafen",
              "lc/loading-port",
              [
                "Required if shipment-mode is Sea",
                "Required if shipment-mode is MultiModal",
                "ISO-port-code",
              ],
            ),
            text(
              "n-airport",
              "Verladeflughafen",
              "lc/loading-airport",
              [
                "Required if shipment-mode is Air",
                "ISO-airport-code",
              ],
            ),
            radio(
              "n-sanctions-screened",
              "Sanktionspruefung durchgefuehrt",
              "compliance/sanctions-screened",
            ),
            text(
              "n-sanctions-ref",
              "Sanktions-Pruefreferenz",
              "compliance/sanctions-ref",
              [
                "Required if sanctions-screened is Yes",
                "Format SANCT-############",
              ],
            ),
            text(
              "n-presentation-period",
              "Vorlagefrist (Tage)",
              "lc/presentation-period",
              ["Required", "Numeric", "Min 1", "Max 21"],
            ),
            radio(
              "n-confirmation",
              "Bestaetigtes Akkreditiv",
              "lc/is-confirmed",
            ),
            button(
              "n-submit",
              "Akkreditiv eroeffnen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: ["EU-Sanctions-833-2014", "ICC-UCP-600", "MiFID-II"],
        complianceRulePackIds: ["eu-banking-trade-finance-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "Letter-of-credit issuance falls under ICC UCP 600 documentary-credit rules and EU sanction regimes (Reg. 833/2014, OFAC interlock for USD-denominated LCs). Sanction screening is conditional on amount and counterparty.",
      },
      applicableInvariants: [
        "INV-AML-CUMUL-01",
        "INV-FX-MARGIN-01",
        "INV-MIFID-COSTS-01",
      ],
    },
    {
      id: "benchmark-banking-corp-treasury-fx",
      archetype: "treasury-fx",
      stratum: "banking-corporate",
      domain: "banking",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Corporate treasury FX-forward booking with a margin-disclosure result display and an MiFID-II appropriateness flag for non-deliverable forwards.",
      notes:
        "Stratum banking-corporate. Single-screen with a result-display deriving the bank margin from notional + tenor; a non-deliverable flag triggers an appropriateness gate.",
      screens: [
        {
          id: "s-fx",
          name: "FX-Forward buchen",
          path: "/banking/corp/treasury/fx/forward",
          nodes: [
            select(
              "n-pair",
              "Waehrungspaar",
              "fx/pair",
              "EUR-USD",
              ["Required", "ISO-4217 pair"],
            ),
            text(
              "n-notional",
              "Nominal",
              "fx/notional",
              [
                "Required",
                "Numeric",
                "Min 100000",
                "Max 1000000000",
              ],
            ),
            text(
              "n-tenor-days",
              "Laufzeit (Tage)",
              "fx/tenor-days",
              ["Required", "Numeric", "Min 1", "Max 730"],
            ),
            text(
              "n-strike",
              "Strike",
              "fx/strike",
              ["Required", "Numeric", "Min 0.0001"],
            ),
            radio(
              "n-non-deliverable",
              "Non-deliverable Forward",
              "fx/non-deliverable",
            ),
            radio(
              "n-mifid-appropriate",
              "MiFID Appropriateness bestaetigt",
              "compliance/mifid-appropriate",
            ),
            {
              id: "n-margin-anzeige",
              type: "RESULT_DISPLAY",
              name: "Bankmarge",
              path: "fx/margin-disclosure",
              text: "Bankmarge in Basispunkten",
              defaultValue: "",
              validations: [
                "Reflects notional x tenor x volatility table",
                "Updates when pair, notional, or tenor changes",
              ],
            },
            button("n-submit", "Forward buchen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EMIR", "MiFID-II", "REMIT"],
        complianceRulePackIds: ["eu-banking-trade-finance-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "FX forwards are MiFID-II financial instruments; margin disclosure is mandatory; EMIR reporting applies for derivatives. Non-deliverable flag elevates appropriateness review.",
      },
      applicableInvariants: ["INV-FX-MARGIN-01", "INV-MIFID-COSTS-01"],
    },
    {
      id: "benchmark-banking-corp-zahlungsverkehrs-export",
      archetype: "zahlungsverkehrs-export",
      stratum: "banking-corporate",
      domain: "banking",
      tier: 3,
      adversarial: true,
      adversarialKind: "conditional-section",
      locale: "de",
      intent:
        "Bulk SEPA payment-file submission with conditional supervisor approval that fires only when total file value crosses the daily 500k EUR ceiling.",
      notes:
        "Stratum banking-corporate. Adversarial conditional fixture: the supervisor-approval section is required if and only if total > 500k AND first-time-recipient is Yes.",
      screens: [
        {
          id: "s-export",
          name: "Bulk-Zahlung einreichen",
          path: "/banking/corp/payments/bulk/submit",
          nodes: [
            text(
              "n-pain-version",
              "PAIN-Version",
              "bulk/pain-version",
              ["Required", "Pattern PAIN.001.001.0[3-9]"],
            ),
            text(
              "n-file-id",
              "Datei-ID",
              "bulk/file-id",
              ["Required", "Length 16"],
            ),
            text(
              "n-message-count",
              "Anzahl Nachrichten",
              "bulk/message-count",
              ["Required", "Numeric", "Min 1", "Max 50000"],
            ),
            text(
              "n-total-amount",
              "Gesamtbetrag",
              "bulk/total-amount",
              [
                "Required",
                "Numeric",
                "Min 0.01",
                "Equals sum of message amounts",
              ],
            ),
            radio(
              "n-first-recipient",
              "Mindestens ein neuer Empfaenger",
              "bulk/has-first-time-recipient",
            ),
            text(
              "n-supervisor",
              "Freigabe Supervisor",
              "compliance/supervisor-id",
              [
                "Required if total-amount > 500000 and has-first-time-recipient is Yes",
                "Format SUP-####",
              ],
            ),
            text(
              "n-supervisor-otp",
              "Supervisor OTP",
              "compliance/supervisor-otp",
              [
                "Required if total-amount > 500000 and has-first-time-recipient is Yes",
                "Numeric",
                "Length 6",
              ],
            ),
            radio(
              "n-sanctions-clean",
              "Sanktionspruefung clean",
              "compliance/sanctions-clean",
            ),
            button(
              "n-submit",
              "Datei einreichen",
              "actions/submit",
            ),
          ],
        },
      ],
      compliance: {
        regulations: ["AML-CTF", "EBA-Guidelines-Fraud", "PSD2-SCA"],
        complianceRulePackIds: ["eu-banking-payment-sca-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "Bulk payment submission triggers PSD2 SCA + four-eyes corporate-banking authorisation when crossing daily ceilings. AML cumulative-limits and EBA fraud-control guidelines apply.",
      },
      applicableInvariants: ["INV-AML-CUMUL-01", "INV-PSD2-SCA-01"],
    },

    // ─────────────── Insurance life (4) ───────────────
    {
      id: "benchmark-insurance-life-rentenversicherung-antrag",
      archetype: "rentenversicherung-antrag",
      stratum: "insurance-life",
      domain: "insurance",
      tier: 3,
      adversarial: true,
      adversarialKind: "multi-step-wizard",
      locale: "de",
      intent:
        "Three-step pension-insurance application wizard: insured-person data, fund composition with branching for unit-linked products, and a Solvency-II cool-off declaration.",
      notes:
        "Stratum insurance-life (EIOPA distribution taxonomy). Adversarial multi-step wizard. Three screens with two forward + two back navigation edges; tier-3 fixture stress-tests the wizard state machine.",
      screens: [
        {
          id: "s-rv-1",
          name: "Rentenversicherung Schritt 1: Versicherte Person",
          path: "/insurance/life/rv/step-1",
          nodes: [
            text(
              "n-vorname",
              "Vorname",
              "insured/given-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-nachname",
              "Nachname",
              "insured/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-geburtsdatum",
              "Geburtsdatum",
              "insured/dob",
              [
                "Required",
                "ISO date",
                "Date implies age >= 18",
                "Date implies age <= 67",
              ],
            ),
            select(
              "n-geschlecht",
              "Geschlecht (versicherungsmathematisch)",
              "insured/sex",
              "F",
              ["Required"],
            ),
            radio(
              "n-raucher",
              "Raucher",
              "insured/smoker",
            ),
            button("n-next-1", "Weiter", "actions/next", "s-rv-2"),
          ],
        },
        {
          id: "s-rv-2",
          name: "Rentenversicherung Schritt 2: Fonds",
          path: "/insurance/life/rv/step-2",
          nodes: [
            select(
              "n-tarif",
              "Tarifvariante",
              "product/tarif",
              "Klassisch",
              ["Required"],
            ),
            radio(
              "n-fondsgebunden",
              "Fondsgebunden",
              "product/fund-linked",
            ),
            text(
              "n-fonds-anteil",
              "Fondsanteil (%)",
              "product/fund-share",
              [
                "Required if fund-linked is Yes",
                "Numeric",
                "Min 0",
                "Max 100",
              ],
            ),
            text(
              "n-monatsbeitrag",
              "Monatsbeitrag in EUR",
              "product/monthly-premium",
              ["Required", "Numeric", "Min 25", "Max 100000"],
            ),
            text(
              "n-laufzeit",
              "Laufzeit (Jahre)",
              "product/term-years",
              ["Required", "Numeric", "Min 5", "Max 60"],
            ),
            button("n-back-2", "Zurueck", "actions/back", "s-rv-1"),
            button("n-next-2", "Weiter", "actions/next", "s-rv-3"),
          ],
        },
        {
          id: "s-rv-3",
          name: "Rentenversicherung Schritt 3: Erklaerung",
          path: "/insurance/life/rv/step-3",
          nodes: [
            radio(
              "n-bedarfsanalyse",
              "Bedarfsanalyse durchgefuehrt",
              "compliance/idd-demands",
            ),
            radio(
              "n-cooloff",
              "Solvency-II Widerrufsbelehrung erhalten",
              "compliance/solv2-cooloff",
            ),
            radio(
              "n-gesundheitsdaten",
              "Einwilligung Gesundheitsdaten",
              "compliance/health-data-consent",
            ),
            radio(
              "n-vertrieb",
              "Bedingungen Versicherungsvertrieb",
              "compliance/idd-distribution-terms",
            ),
            button("n-back-3", "Zurueck", "actions/back", "s-rv-2"),
            button("n-submit", "Antrag einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EIOPA-Guidelines", "GDPR-Art-9", "IDD", "Solvency-II"],
        complianceRulePackIds: ["eu-insurance-life-distribution-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Pension insurance triggers IDD (demands and needs analysis), Solvency-II cool-off period, and GDPR Art-9 special-category processing for the smoker/health declaration.",
      },
      applicableInvariants: [
        "INV-GDPR-ART9-01",
        "INV-IDD-DEMANDS-01",
        "INV-SOLV2-COOLOFF-01",
      ],
    },
    {
      id: "benchmark-insurance-life-fondsgebunden-policentausch",
      archetype: "fondsgebunden-policentausch",
      stratum: "insurance-life",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Fund switch on a unit-linked life-insurance policy with a re-disclosure of total expense ratios and a MiFID-II suitability re-confirmation.",
      notes:
        "Stratum insurance-life. Single-screen, mid-density fixture. Models the recurring fund-switch operation that anchors continuous suitability under MiFID-II + IDD.",
      screens: [
        {
          id: "s-switch",
          name: "Policentausch / Fondswechsel",
          path: "/insurance/life/policy/fund-switch",
          nodes: [
            text(
              "n-policy-id",
              "Policen-Nummer",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            select(
              "n-fonds-aktuell",
              "Aktueller Fonds",
              "policy/current-fund",
              "Equity-Eu-Core",
              ["Required"],
            ),
            select(
              "n-fonds-neu",
              "Neuer Fonds",
              "policy/new-fund",
              "Bond-Eu-Aggregate",
              ["Required", "Differs from current-fund"],
            ),
            text(
              "n-anteile",
              "Anzahl Anteile",
              "policy/units",
              ["Required", "Numeric", "Min 0.01"],
            ),
            radio(
              "n-suitab",
              "MiFID-II Geeignetheit bestaetigt",
              "compliance/mifid-suitable",
            ),
            radio(
              "n-cost-disc",
              "Kostentransparenz bestaetigt",
              "compliance/mifid-costs",
            ),
            {
              id: "n-ter-result",
              type: "RESULT_DISPLAY",
              name: "Total Expense Ratio",
              path: "policy/ter-disclosure",
              text: "Voraussichtliche TER nach Tausch",
              defaultValue: "",
              validations: [
                "Reflects target-fund TER table",
                "Includes performance fees if applicable",
              ],
            },
            button("n-submit", "Fondstausch beauftragen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EIOPA-Guidelines", "MiFID-II", "Solvency-II"],
        complianceRulePackIds: ["eu-insurance-life-distribution-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Unit-linked policy switches require continuous MiFID-II suitability + IDD recurring-advice updates. Performance-fee disclosure is mandatory under EIOPA POG (product oversight + governance).",
      },
      applicableInvariants: [
        "INV-MIFID-APPROP-01",
        "INV-MIFID-COSTS-01",
        "INV-MIFID-SUITAB-01",
      ],
    },
    {
      id: "benchmark-insurance-life-leistungsantrag-tod",
      archetype: "leistungsantrag-tod",
      stratum: "insurance-life",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Death-benefit claim form for a life-insurance policy: deceased identification, beneficiary verification, and a GDPR Art-9 consent for processing cause-of-death data.",
      notes:
        "Stratum insurance-life. Single-screen, sensitive-data fixture. Captures Sterbeurkunde reference, beneficiary IBAN, and a special-category-data consent gate.",
      screens: [
        {
          id: "s-claim",
          name: "Leistungsantrag Todesfall",
          path: "/insurance/life/claim/death",
          nodes: [
            text(
              "n-policy-id",
              "Policen-Nummer",
              "claim/policy-id",
              ["Required", "Format POL-########"],
            ),
            text(
              "n-deceased-name",
              "Name der verstorbenen Person",
              "claim/deceased-name",
              ["Required", "Max 80 characters"],
            ),
            text(
              "n-deceased-dod",
              "Sterbedatum",
              "claim/deceased-dod",
              ["Required", "ISO date", "Date <= today"],
            ),
            text(
              "n-sterbeurkunde",
              "Sterbeurkunde-Nummer",
              "claim/death-certificate",
              ["Required", "Max 40 characters"],
            ),
            text(
              "n-beneficiary",
              "Beguenstigter Name",
              "claim/beneficiary-name",
              ["Required", "Max 80 characters"],
            ),
            text(
              "n-beneficiary-iban",
              "Beguenstigter IBAN",
              "claim/beneficiary-iban",
              ["Required", "IBAN format"],
            ),
            radio(
              "n-cod-consent",
              "Einwilligung Verarbeitung Todesursache",
              "compliance/cod-consent",
            ),
            radio(
              "n-attach-required",
              "Sterbeurkunde beigefuegt",
              "claim/death-certificate-attached",
            ),
            button("n-submit", "Antrag einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EIOPA-Guidelines", "GDPR-Art-9", "IDD"],
        complianceRulePackIds: ["eu-insurance-life-claims-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Death-benefit claims process special-category data (cause of death) under GDPR Art-9; explicit consent or Art-9(2)(f) substantial-public-interest basis is required. Beneficiary IBAN validation closes the AML loop.",
      },
      applicableInvariants: ["INV-GDPR-ART9-01", "INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-life-versorgungswerk-eintritt",
      archetype: "versorgungswerk-eintritt",
      stratum: "insurance-life",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Occupational pension scheme (bAV) enrollment for a new employee, capturing salary-conversion preferences and Versorgungswerk membership status.",
      notes:
        "Stratum insurance-life. Mid-complexity bAV fixture combining HR-system fields with insurance-product fields. Anchors the occupational-pension subdomain that production runs frequently misclassify as banking.",
      screens: [
        {
          id: "s-bav",
          name: "Versorgungswerk Eintritt",
          path: "/insurance/life/bav/enrollment",
          nodes: [
            text(
              "n-employer-id",
              "Arbeitgeber-ID",
              "employer/id",
              ["Required", "Format EMP-#####"],
            ),
            text(
              "n-employee-id",
              "Personalnummer",
              "employee/id",
              ["Required", "Max 20 characters"],
            ),
            text(
              "n-eintritt",
              "Eintrittsdatum",
              "employee/start-date",
              ["Required", "ISO date"],
            ),
            text(
              "n-bruttogehalt",
              "Brutto-Jahresgehalt",
              "salary/gross-yearly",
              ["Required", "Numeric", "Min 0", "Max 1000000"],
            ),
            text(
              "n-umwandlung",
              "Entgeltumwandlung in EUR/Monat",
              "bav/salary-conversion",
              ["Required", "Numeric", "Min 0", "Max 4000"],
            ),
            select(
              "n-durchfuehrungsweg",
              "Durchfuehrungsweg",
              "bav/path",
              "Direktversicherung",
              ["Required"],
            ),
            radio(
              "n-versorgungswerk",
              "Versorgungswerk-Mitglied",
              "bav/versorgungswerk-member",
            ),
            radio(
              "n-zustimmung",
              "Zustimmung zur Entgeltumwandlung",
              "compliance/salary-conversion-consent",
            ),
            button("n-submit", "Eintritt abschliessen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["BetrAVG", "EIOPA-IORP-II", "GDPR-Art-6"],
        complianceRulePackIds: ["eu-insurance-life-distribution-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Occupational pensions are regulated under the EU IORP-II directive + national BetrAVG. Salary-conversion consent is the lawful basis for processing salary data; Versorgungswerk membership has tax-coordination implications.",
      },
      applicableInvariants: ["INV-IDD-DEMANDS-01", "INV-NETTO-BRUTTO-01"],
    },

    // ─────────────── Insurance non-life (5) ───────────────
    {
      id: "benchmark-insurance-nonlife-haftpflicht-antrag",
      archetype: "haftpflicht-antrag",
      stratum: "insurance-non-life",
      domain: "insurance",
      tier: 1,
      adversarial: false,
      locale: "de",
      intent:
        "Private liability insurance application capturing household composition, optional rider selection, and a deductible election.",
      notes:
        "Stratum insurance-non-life. Tier-1 baseline; single-screen, eight fields plus one rider radio. Anchors the lower-bound liability-insurance distribution.",
      screens: [
        {
          id: "s-haftpflicht",
          name: "Privathaftpflicht beantragen",
          path: "/insurance/non-life/haftpflicht/apply",
          nodes: [
            text(
              "n-vorname",
              "Vorname",
              "applicant/given-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-nachname",
              "Nachname",
              "applicant/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-geburtsdatum",
              "Geburtsdatum",
              "applicant/dob",
              ["Required", "ISO date", "Date implies age >= 18"],
            ),
            select(
              "n-haushalt",
              "Haushaltsform",
              "household/type",
              "Single",
              ["Required"],
            ),
            select(
              "n-deckung",
              "Deckungssumme",
              "product/coverage-tier",
              "10_000_000",
              ["Required"],
            ),
            select(
              "n-selbstbeteiligung",
              "Selbstbeteiligung",
              "product/excess",
              "150",
              ["Required"],
            ),
            radio(
              "n-tier-rider",
              "Optional: Tierhalter-Baustein",
              "product/optional-pet-rider",
            ),
            radio(
              "n-bedarfsanalyse",
              "Bedarfsanalyse erfolgt",
              "compliance/idd-demands",
            ),
            button("n-submit", "Antrag absenden", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["IDD", "VVG"],
        complianceRulePackIds: ["eu-insurance-non-life-distribution-v1"],
        auditCriticality: "low",
        regulatedRiskOverride: "low",
        rationale:
          "Standard private liability product under IDD + VVG. No special-category data; lawful basis is contract.",
      },
      applicableInvariants: ["INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-nonlife-rechtsschutz-meldung",
      archetype: "rechtsschutz-meldung",
      stratum: "insurance-non-life",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Legal-protection insurance claim filing: matter classification, opposing-party identification, and a counsel-selection consent.",
      notes:
        "Stratum insurance-non-life. Mid-complexity claim. Classifies the matter under the policy's covered-risks taxonomy and captures counsel-selection (free-choice-of-lawyer right).",
      screens: [
        {
          id: "s-rs",
          name: "Rechtsschutzfall melden",
          path: "/insurance/non-life/rechtsschutz/claim",
          nodes: [
            text(
              "n-policy-id",
              "Policen-Nummer",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            select(
              "n-rechtsbereich",
              "Rechtsbereich",
              "claim/legal-area",
              "Verkehrsrecht",
              ["Required"],
            ),
            text(
              "n-ereignisdatum",
              "Schadendatum",
              "claim/event-date",
              ["Required", "ISO date", "Date <= today"],
            ),
            text(
              "n-gegner-name",
              "Gegnername",
              "claim/opposing-party-name",
              ["Required", "Max 120 characters"],
            ),
            text(
              "n-streitwert",
              "Streitwert (EUR)",
              "claim/dispute-value",
              ["Required", "Numeric", "Min 0", "Max 5000000"],
            ),
            text(
              "n-anwalt-name",
              "Bevollmaechtigter Anwalt",
              "claim/counsel-name",
              ["Required", "Max 120 characters"],
            ),
            radio(
              "n-anwalt-frei",
              "Freie Anwaltswahl ausgeuebt",
              "compliance/free-choice",
            ),
            radio(
              "n-erstdeckung",
              "Erstdeckung beantragt",
              "claim/first-coverage",
            ),
            button("n-submit", "Schaden melden", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["IDD", "RDG", "VVG"],
        complianceRulePackIds: ["eu-insurance-non-life-claims-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Legal-protection claims must respect the EU free-choice-of-lawyer rule (Directive 87/344) and the German RDG. Matter classification routes the claim into the correct rule pack.",
      },
      applicableInvariants: ["INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-nonlife-kfz-vertrags-uebernahme",
      archetype: "kfz-vertrags-uebernahme",
      stratum: "insurance-non-life",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Auto-insurance policy transfer between policyholders on a vehicle sale, capturing the SF (no-claims) class transfer and odometer reading.",
      notes:
        "Stratum insurance-non-life. Mid-complexity; the SF-class transfer is the regulator-watched fairness gate (no SF erosion without consent of either party).",
      screens: [
        {
          id: "s-kfz-transfer",
          name: "KFZ Vertragsuebernahme",
          path: "/insurance/non-life/kfz/transfer",
          nodes: [
            text(
              "n-policy-id",
              "Policen-Nummer",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            text(
              "n-vin",
              "Fahrgestellnummer (VIN)",
              "vehicle/vin",
              ["Required", "Length 17", "VIN-checksum"],
            ),
            text(
              "n-odometer",
              "Kilometerstand",
              "vehicle/odometer",
              ["Required", "Numeric", "Min 0", "Max 1000000"],
            ),
            text(
              "n-old-holder",
              "Bisheriger Halter",
              "transfer/from-name",
              ["Required", "Max 80 characters"],
            ),
            text(
              "n-new-holder",
              "Neuer Halter",
              "transfer/to-name",
              ["Required", "Max 80 characters"],
            ),
            select(
              "n-sf-klasse",
              "SF-Klasse",
              "transfer/sf-class",
              "SF-1",
              ["Required"],
            ),
            radio(
              "n-sf-konsens",
              "Beidseitige Zustimmung SF-Uebertragung",
              "transfer/sf-mutual-consent",
            ),
            radio(
              "n-bedarfsanalyse",
              "Bedarfsanalyse erfolgt",
              "compliance/idd-demands",
            ),
            button("n-submit", "Uebernahme abschliessen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["IDD", "PflVG", "VVG"],
        complianceRulePackIds: ["eu-insurance-non-life-distribution-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "PflVG (compulsory motor insurance) requires continuous coverage during transfer; SF-class transfer falls under the BaFin fairness guidance.",
      },
      applicableInvariants: ["INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-nonlife-reise-storno-it",
      archetype: "reise-storno",
      stratum: "insurance-non-life",
      domain: "insurance",
      tier: 3,
      adversarial: true,
      adversarialKind: "multilingual",
      locale: "it",
      intent:
        "Italian-language travel-cancellation claim form covering the trip details, cancellation reason, and a Sanitary-document upload consent for medical-cancellation cases.",
      notes:
        "Stratum insurance-non-life. Adversarial multilingual fixture (Italian copy). Stresses the locale-aware label normaliser plus the conditional-section pattern when reason='Malattia' triggers the medical-document consent.",
      screens: [
        {
          id: "s-storno",
          name: "Annullamento viaggio",
          path: "/insurance/non-life/travel/cancel",
          nodes: [
            text(
              "n-policy-id",
              "Numero polizza",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            text(
              "n-trip-start",
              "Data inizio viaggio",
              "trip/start-date",
              ["Required", "ISO date"],
            ),
            text(
              "n-trip-end",
              "Data fine viaggio",
              "trip/end-date",
              ["Required", "ISO date", "Date >= trip-start"],
            ),
            text(
              "n-trip-cost",
              "Costo viaggio (EUR)",
              "trip/total-cost",
              ["Required", "Numeric", "Min 0", "Max 100000"],
            ),
            select(
              "n-motivo",
              "Motivo annullamento",
              "claim/reason",
              "Malattia",
              ["Required"],
            ),
            text(
              "n-doc-medico",
              "Riferimento certificato medico",
              "claim/medical-doc-ref",
              [
                "Required if motivo is Malattia or Infortunio",
                "Max 60 characters",
              ],
            ),
            radio(
              "n-consenso-sanitario",
              "Consenso al trattamento dati sanitari",
              "compliance/health-data-consent",
            ),
            radio(
              "n-dichiarazione",
              "Dichiarazione veridica",
              "compliance/truthful-statement",
            ),
            button("n-submit", "Inviare richiesta", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-9", "IDD", "Italian-Codice-Assicurazioni"],
        complianceRulePackIds: ["eu-insurance-non-life-claims-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Travel cancellation triggers GDPR Art-9 special-category processing for medical reasons; Italian Codice delle Assicurazioni Private supplies national IDD transposition.",
      },
      applicableInvariants: ["INV-GDPR-ART9-01", "INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-nonlife-tier-haftpflicht-fr",
      archetype: "tier-haftpflicht",
      stratum: "insurance-non-life",
      domain: "insurance",
      tier: 3,
      adversarial: true,
      adversarialKind: "a11y-stress",
      locale: "fr",
      intent:
        "French-language pet liability insurance application with explicit a11y stress: every input carries a programmatic label-source override and an aria-described validation message reference.",
      notes:
        "Stratum insurance-non-life. Adversarial a11y-stress fixture (French copy). The deepest-nested validation chain is on the dangerous-breed flag which conditions both the surcharge result and the kennel-clause radio.",
      screens: [
        {
          id: "s-tier-fr",
          name: "Assurance responsabilite civile animaux",
          path: "/insurance/non-life/pets/apply",
          nodes: [
            text(
              "n-nom",
              "Nom du proprietaire",
              "applicant/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-prenom",
              "Prenom du proprietaire",
              "applicant/given-name",
              ["Required", "Max 60 characters"],
            ),
            select(
              "n-espece",
              "Espece",
              "pet/species",
              "Chien",
              ["Required"],
            ),
            text(
              "n-race",
              "Race",
              "pet/breed",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-poids",
              "Poids (kg)",
              "pet/weight-kg",
              ["Required", "Numeric", "Min 0.1", "Max 200"],
            ),
            radio(
              "n-categorie-1-2",
              "Categorie 1 ou 2 (chien dangereux)",
              "pet/dangerous-breed",
            ),
            text(
              "n-permis-detention",
              "Numero permis de detention",
              "pet/dangerous-permit",
              [
                "Required if dangerous-breed is Yes",
                "Format PERMIS-#######",
              ],
            ),
            radio(
              "n-chenil",
              "Clause chenil acceptee",
              "compliance/kennel-clause",
            ),
            info(
              "n-a11y-help",
              "Aide saisie",
              "a11y/help-region",
            ),
            button("n-submit", "Souscrire", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["French-Code-Assurances", "GDPR-Art-6", "IDD"],
        complianceRulePackIds: ["eu-insurance-non-life-distribution-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "low",
        rationale:
          "Pet liability under French Code des assurances + IDD transposition; dangerous-breed permit triggers a national mandatory-disclosure clause. EAA accessibility expectations apply to the public-facing UI.",
      },
      applicableInvariants: ["INV-EAA-KBD-01", "INV-IDD-DEMANDS-01"],
    },

    // ─────────────── Insurance health (4) ───────────────
    {
      id: "benchmark-insurance-health-pkv-antrag",
      archetype: "pkv-antrag",
      stratum: "insurance-health",
      domain: "insurance",
      tier: 3,
      adversarial: true,
      adversarialKind: "deeply-nested-validation",
      locale: "de",
      intent:
        "Private health-insurance (PKV) application with a deeply nested medical-history section: every Yes answer surfaces a follow-up free-text and a date-range pair, ending in a GDPR Art-9 consent.",
      notes:
        "Stratum insurance-health. Adversarial fixture: every Yes on the medical-history radio cascades two follow-up validations. Anchors the upper bound on conditional-validation density in the suite.",
      screens: [
        {
          id: "s-pkv",
          name: "PKV Antrag",
          path: "/insurance/health/pkv/apply",
          nodes: [
            text(
              "n-vorname",
              "Vorname",
              "applicant/given-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-nachname",
              "Nachname",
              "applicant/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-dob",
              "Geburtsdatum",
              "applicant/dob",
              ["Required", "ISO date", "Date implies age >= 18"],
            ),
            text(
              "n-groesse",
              "Koerpergroesse (cm)",
              "health/height-cm",
              ["Required", "Numeric", "Min 50", "Max 250"],
            ),
            text(
              "n-gewicht",
              "Gewicht (kg)",
              "health/weight-kg",
              ["Required", "Numeric", "Min 20", "Max 300"],
            ),
            radio(
              "n-vorerkrankung",
              "Vorerkrankungen vorhanden",
              "health/preexisting-condition",
            ),
            text(
              "n-vorerkrankung-text",
              "Beschreibung Vorerkrankungen",
              "health/preexisting-condition-text",
              [
                "Required if preexisting-condition is Yes",
                "Min 30 characters",
                "Max 1000 characters",
              ],
            ),
            text(
              "n-vorerkrankung-von",
              "Erkrankung seit",
              "health/preexisting-since",
              [
                "Required if preexisting-condition is Yes",
                "ISO date",
                "Date <= today",
              ],
            ),
            text(
              "n-vorerkrankung-bis",
              "Erkrankung bis",
              "health/preexisting-until",
              [
                "Required if preexisting-condition is Yes",
                "ISO date",
                "Date >= preexisting-since",
              ],
            ),
            radio(
              "n-medikation",
              "Dauermedikation",
              "health/permanent-medication",
            ),
            text(
              "n-medikation-text",
              "Beschreibung Medikation",
              "health/permanent-medication-text",
              [
                "Required if permanent-medication is Yes",
                "Max 1000 characters",
              ],
            ),
            radio(
              "n-art9-consent",
              "Einwilligung Verarbeitung Gesundheitsdaten",
              "compliance/art9-consent",
            ),
            button("n-submit", "Antrag einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EIOPA-Guidelines", "GDPR-Art-9", "IDD", "VAG"],
        complianceRulePackIds: ["eu-insurance-health-distribution-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Private health insurance under VAG + IDD; mandatory medical history triggers GDPR Art-9 special-category processing. Explicit Art-9(2)(a) consent gates the submission.",
      },
      applicableInvariants: [
        "INV-GDPR-ART9-01",
        "INV-IDD-DEMANDS-01",
        "INV-VAG-BERATUNG-01",
      ],
    },
    {
      id: "benchmark-insurance-health-zahnzusatz-leistung",
      archetype: "zahnzusatz-leistung",
      stratum: "insurance-health",
      domain: "insurance",
      tier: 1,
      adversarial: false,
      locale: "de",
      intent:
        "Dental-supplement claim filing: invoice upload reference, treatment classification, and GOZ-conformance attestation.",
      notes:
        "Stratum insurance-health. Tier-1 baseline. Captures the GOZ (German dental fee schedule) classification and the customer attestation that the bill matches the treatment plan.",
      screens: [
        {
          id: "s-zz",
          name: "Zahnzusatz Leistung",
          path: "/insurance/health/dental/claim",
          nodes: [
            text(
              "n-policy-id",
              "Policen-Nummer",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            text(
              "n-rechnung-ref",
              "Rechnungsreferenz",
              "claim/invoice-ref",
              ["Required", "Max 40 characters"],
            ),
            text(
              "n-rechnung-datum",
              "Rechnungsdatum",
              "claim/invoice-date",
              ["Required", "ISO date", "Date <= today"],
            ),
            text(
              "n-rechnung-betrag",
              "Rechnungsbetrag (EUR)",
              "claim/invoice-amount",
              ["Required", "Numeric", "Min 0.01"],
            ),
            select(
              "n-behandlungsart",
              "Behandlungsart",
              "claim/treatment-class",
              "Inlay",
              ["Required"],
            ),
            text(
              "n-goz-pos",
              "GOZ-Positionen",
              "claim/goz-positions",
              ["Required", "Max 200 characters"],
            ),
            radio(
              "n-attestat",
              "Bestaetigung GOZ-konforme Rechnung",
              "claim/goz-conformity",
            ),
            button("n-submit", "Leistung beantragen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["GOZ", "IDD", "VAG"],
        complianceRulePackIds: ["eu-insurance-health-claims-v1"],
        auditCriticality: "low",
        regulatedRiskOverride: "low",
        rationale:
          "Dental supplement claims operate under the GOZ fee schedule + VAG. No special-category data on this screen (medical-record details remain on the invoice attachment).",
      },
      applicableInvariants: ["INV-IDD-DEMANDS-01"],
    },
    {
      id: "benchmark-insurance-health-pflegezusatz-antrag",
      archetype: "pflegezusatz-antrag",
      stratum: "insurance-health",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "Long-term care supplement insurance application: care-degree expectation, household composition, and a GDPR Art-9 attestation.",
      notes:
        "Stratum insurance-health. Mid-complexity fixture; the care-degree (Pflegegrad) selection conditions tariff routing.",
      screens: [
        {
          id: "s-pz",
          name: "Pflegezusatz Antrag",
          path: "/insurance/health/care-supplement/apply",
          nodes: [
            text(
              "n-vorname",
              "Vorname",
              "applicant/given-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-nachname",
              "Nachname",
              "applicant/family-name",
              ["Required", "Max 60 characters"],
            ),
            text(
              "n-dob",
              "Geburtsdatum",
              "applicant/dob",
              ["Required", "ISO date", "Date implies age >= 18"],
            ),
            select(
              "n-pflegegrad",
              "Erwarteter Pflegegrad",
              "care/expected-grade",
              "0",
              ["Required"],
            ),
            text(
              "n-monatsbeitrag",
              "Monatsbeitrag (EUR)",
              "product/monthly-premium",
              ["Required", "Numeric", "Min 5", "Max 500"],
            ),
            radio(
              "n-haushalt-pflegebed",
              "Pflegebeduerftige Person im Haushalt",
              "care/household-care-need",
            ),
            radio(
              "n-art9-consent",
              "Einwilligung Gesundheitsdaten",
              "compliance/art9-consent",
            ),
            radio(
              "n-bedarfsanalyse",
              "Bedarfsanalyse durchgefuehrt",
              "compliance/idd-demands",
            ),
            button("n-submit", "Antrag absenden", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-9", "IDD", "SGB-XI", "VAG"],
        complianceRulePackIds: ["eu-insurance-health-distribution-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Care supplement insurance interacts with statutory care insurance (SGB XI). Health-related questions trigger GDPR Art-9. IDD demands-and-needs analysis is mandatory.",
      },
      applicableInvariants: [
        "INV-GDPR-ART9-01",
        "INV-IDD-DEMANDS-01",
        "INV-VAG-BERATUNG-01",
      ],
    },
    {
      id: "benchmark-insurance-health-arbeitsunfaehigkeit-en",
      archetype: "arbeitsunfaehigkeit",
      stratum: "insurance-health",
      domain: "insurance",
      tier: 2,
      adversarial: false,
      locale: "en",
      intent:
        "English-language inability-to-work claim filing: doctor reference, ICD-10 code, expected return date, and special-category-data consent.",
      notes:
        "Stratum insurance-health. English copy to keep cross-locale coverage broad. ICD-10 coding stresses the validation pipeline's external-codeset support.",
      screens: [
        {
          id: "s-au",
          name: "Inability-to-work claim",
          path: "/insurance/health/sickness/claim",
          nodes: [
            text(
              "n-policy-id",
              "Policy number",
              "policy/id",
              ["Required", "Format POL-########"],
            ),
            text(
              "n-au-from",
              "Inability start date",
              "claim/au-from",
              ["Required", "ISO date", "Date <= today"],
            ),
            text(
              "n-au-to",
              "Expected return date",
              "claim/au-expected-to",
              ["Required", "ISO date", "Date >= au-from"],
            ),
            text(
              "n-doctor",
              "Treating physician",
              "claim/physician-name",
              ["Required", "Max 80 characters"],
            ),
            text(
              "n-doctor-bsnr",
              "Practice identifier (BSNR)",
              "claim/physician-bsnr",
              ["Required", "Length 9", "Numeric"],
            ),
            text(
              "n-icd10",
              "ICD-10 code",
              "claim/icd10",
              ["Required", "ICD-10 format"],
            ),
            radio(
              "n-art9-consent",
              "Special-category-data consent",
              "compliance/art9-consent",
            ),
            radio(
              "n-truth",
              "Truthful-statement declaration",
              "compliance/truthful-statement",
            ),
            button("n-submit", "Submit claim", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["GDPR-Art-9", "IDD", "VAG"],
        complianceRulePackIds: ["eu-insurance-health-claims-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "Sickness allowance claims process special-category data; ICD-10 codes are health data under GDPR Art-9. VAG product-oversight rules apply to the supplement.",
      },
      applicableInvariants: ["INV-GDPR-ART9-01", "INV-IDD-DEMANDS-01"],
    },

    // ─────────────── Regulatory reporting (5) ───────────────
    {
      id: "benchmark-regulatory-reporting-emir-meldung",
      archetype: "emir-meldung",
      stratum: "regulatory-reporting",
      domain: "compliance",
      tier: 3,
      adversarial: true,
      adversarialKind: "deeply-nested-validation",
      locale: "de",
      intent:
        "EMIR derivative trade report filing under the refit RTS: instrument identifiers, counterparty LEIs, and a clearing-status section that branches on collateralised-status and trade-source.",
      notes:
        "Stratum regulatory-reporting (ESMA EMIR REFIT). Adversarial deeply-nested-validation fixture: clearing-status conditions both the CCP-LEI requirement and the collateral-flag.",
      screens: [
        {
          id: "s-emir",
          name: "EMIR-Trade-Meldung",
          path: "/regulatory/emir/report",
          nodes: [
            text(
              "n-uti",
              "Unique Trade Identifier",
              "trade/uti",
              ["Required", "Length 52", "ISO-23897"],
            ),
            text(
              "n-isin",
              "Instrument ISIN",
              "trade/isin",
              ["Required", "Length 12", "ISIN-checksum"],
            ),
            text(
              "n-cpty-lei",
              "Counterparty LEI",
              "trade/counterparty-lei",
              ["Required", "Length 20", "LEI-checksum"],
            ),
            text(
              "n-other-cpty-lei",
              "Other Counterparty LEI",
              "trade/other-counterparty-lei",
              ["Required", "Length 20", "LEI-checksum"],
            ),
            text(
              "n-notional",
              "Notional",
              "trade/notional",
              ["Required", "Numeric", "Min 0.01"],
            ),
            select(
              "n-asset-class",
              "Asset class",
              "trade/asset-class",
              "INTR",
              ["Required", "ESMA RTS-1 codeset"],
            ),
            radio(
              "n-cleared",
              "Cleared",
              "trade/cleared",
            ),
            text(
              "n-ccp-lei",
              "CCP-LEI",
              "trade/ccp-lei",
              [
                "Required if cleared is Yes",
                "Length 20",
                "LEI-checksum",
              ],
            ),
            radio(
              "n-collat",
              "Collateralised",
              "trade/collateralised",
            ),
            text(
              "n-collat-portfolio",
              "Collateral portfolio code",
              "trade/collateral-portfolio",
              [
                "Required if collateralised is Yes",
                "Max 52 characters",
              ],
            ),
            select(
              "n-source",
              "Trade source",
              "trade/source",
              "Voice",
              ["Required"],
            ),
            text(
              "n-mtm",
              "Mark-to-market value",
              "trade/mtm-value",
              ["Required", "Numeric"],
            ),
            radio(
              "n-late",
              "Late report",
              "trade/late-report",
            ),
            text(
              "n-late-reason",
              "Reason for late report",
              "trade/late-reason",
              [
                "Required if late-report is Yes",
                "Min 30 characters",
                "Max 280 characters",
              ],
            ),
            button("n-submit", "Meldung einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EMIR-REFIT", "ESMA-RTS-2022-1855", "MiFID-II"],
        complianceRulePackIds: ["eu-regulatory-emir-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "EMIR REFIT mandates trade-by-trade reporting to a registered TR. ESMA RTS 2022/1855 sets the validation rules; late reporting carries enforcement consequences.",
      },
      applicableInvariants: [
        "INV-FX-MARGIN-01",
        "INV-MIFID-COSTS-01",
      ],
    },
    {
      id: "benchmark-regulatory-reporting-dora-incident",
      archetype: "dora-incident",
      stratum: "regulatory-reporting",
      domain: "compliance",
      tier: 3,
      adversarial: true,
      adversarialKind: "conditional-section",
      locale: "de",
      intent:
        "DORA ICT-related incident initial notification with a conditional cross-border-impact section that fires only when the incident classification meets the major-incident threshold.",
      notes:
        "Stratum regulatory-reporting (DORA Art. 17). Adversarial conditional fixture: the cross-border + significant-impact section is required iff classification is 'major'. Mirrors the upstream incident-reporting hooks landed for #2114.",
      screens: [
        {
          id: "s-dora",
          name: "DORA Initial Incident Notification",
          path: "/regulatory/dora/incident/initial",
          nodes: [
            text(
              "n-incident-id",
              "Incident-ID",
              "incident/id",
              ["Required", "Format INC-YYYYMMDD-####"],
            ),
            text(
              "n-detected-at",
              "Erkannt am",
              "incident/detected-at",
              ["Required", "ISO datetime"],
            ),
            select(
              "n-classification",
              "Klassifikation",
              "incident/classification",
              "minor",
              ["Required"],
            ),
            text(
              "n-affected-services",
              "Betroffene Dienste",
              "incident/affected-services",
              ["Required", "Min 5 characters", "Max 500 characters"],
            ),
            radio(
              "n-cross-border",
              "Grenzueberschreitende Auswirkung",
              "incident/cross-border-impact",
            ),
            text(
              "n-eu-states",
              "Betroffene EU-Mitgliedstaaten",
              "incident/eu-states",
              [
                "Required if classification is major",
                "Pattern ISO-3166 alpha-2 list",
              ],
            ),
            text(
              "n-impact-clients",
              "Betroffene Kunden",
              "incident/impact-clients",
              [
                "Required if classification is major",
                "Numeric",
                "Min 0",
              ],
            ),
            radio(
              "n-malicious",
              "Boeswillige Ursache",
              "incident/malicious",
            ),
            radio(
              "n-bcp-activated",
              "BCP aktiviert",
              "incident/bcp-activated",
            ),
            text(
              "n-handler",
              "Verantwortlicher Handler",
              "incident/handler",
              ["Required", "Format INC-HANDLER-####"],
            ),
            button("n-submit", "Meldung absenden", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: [
          "DORA-Art-17",
          "DORA-Art-19",
          "ESMA-DORA-RTS",
          "NIS2",
        ],
        complianceRulePackIds: ["eu-regulatory-dora-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "DORA Articles 17 + 19 mandate ICT incident classification + reporting. Major incidents require a 4-hour initial notification window with cross-border-impact data. NIS2 supplies overlapping critical-entity reporting.",
      },
      applicableInvariants: ["INV-DORA-ICT-01"],
    },
    {
      id: "benchmark-regulatory-reporting-aifmd-anlegerbericht",
      archetype: "aifmd-anlegerbericht",
      stratum: "regulatory-reporting",
      domain: "compliance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "AIFMD-Anlegerbericht (alternative-investment-fund investor disclosure) capturing fund identifiers, NAV, leverage, and risk-profile classification.",
      notes:
        "Stratum regulatory-reporting. Mid-complexity fixture; mandatory AIFMD periodic disclosure. Anchors the AIF-domain that production runs frequently misclassify as a UCITS report.",
      screens: [
        {
          id: "s-aif",
          name: "AIFMD Anlegerbericht",
          path: "/regulatory/aifmd/investor-report",
          nodes: [
            text(
              "n-fund-id",
              "Fund-Identifier",
              "fund/id",
              ["Required", "Format AIF-#######"],
            ),
            text(
              "n-fund-isin",
              "Fund ISIN",
              "fund/isin",
              ["Required", "Length 12", "ISIN-checksum"],
            ),
            text(
              "n-aifm-lei",
              "AIFM LEI",
              "fund/aifm-lei",
              ["Required", "Length 20", "LEI-checksum"],
            ),
            text(
              "n-period-start",
              "Berichtsperiode Beginn",
              "report/period-start",
              ["Required", "ISO date"],
            ),
            text(
              "n-period-end",
              "Berichtsperiode Ende",
              "report/period-end",
              ["Required", "ISO date", "Date >= period-start"],
            ),
            text(
              "n-nav",
              "Nettoinventarwert (EUR)",
              "fund/nav",
              ["Required", "Numeric", "Min 0"],
            ),
            text(
              "n-leverage",
              "Leverage-Faktor",
              "fund/leverage",
              ["Required", "Numeric", "Min 0", "Max 50"],
            ),
            select(
              "n-risk-profile",
              "Risikoprofil",
              "fund/risk-profile",
              "moderate",
              ["Required"],
            ),
            radio(
              "n-art-23-disclosed",
              "AIFMD Art. 23 Erstinformation veroeffentlicht",
              "compliance/art-23-disclosed",
            ),
            button("n-submit", "Bericht einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["AIFMD", "ESMA-Guidelines-AIFMD", "MiFID-II"],
        complianceRulePackIds: ["eu-regulatory-aifmd-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "AIFMD Articles 22-23 require periodic investor reporting + ESMA Guidelines on AIFMD reporting templates. NAV and leverage are core risk indicators.",
      },
      applicableInvariants: ["INV-MIFID-COSTS-01"],
    },
    {
      id: "benchmark-regulatory-reporting-mifid-cost-disclosure-fr",
      archetype: "mifid-cost-disclosure",
      stratum: "regulatory-reporting",
      domain: "compliance",
      tier: 3,
      adversarial: true,
      adversarialKind: "a11y-stress",
      locale: "fr",
      intent:
        "French-language MiFID-II ex-ante cost-and-charges disclosure with explicit a11y emphasis: every cost line is exposed both as a numeric input and as a screen-reader-labelled total result-display.",
      notes:
        "Stratum regulatory-reporting. Adversarial a11y-stress fixture (French copy). Stresses the cross-modal-faithfulness tier on result-display + numeric-input pairings under MiFID-II ex-ante cost rules.",
      screens: [
        {
          id: "s-mifid-cost",
          name: "MiFID-II Cout ex-ante",
          path: "/regulatory/mifid/costs/ex-ante",
          nodes: [
            text(
              "n-instrument",
              "Instrument",
              "instrument/name",
              ["Required", "Max 120 characters"],
            ),
            text(
              "n-isin",
              "ISIN",
              "instrument/isin",
              ["Required", "Length 12", "ISIN-checksum"],
            ),
            text(
              "n-notional",
              "Notional",
              "instrument/notional",
              ["Required", "Numeric", "Min 0"],
            ),
            text(
              "n-entry-fee-pct",
              "Frais d'entree (%)",
              "costs/entry-pct",
              ["Required", "Numeric", "Min 0", "Max 10"],
            ),
            text(
              "n-ongoing-pct",
              "Frais courants (%)",
              "costs/ongoing-pct",
              ["Required", "Numeric", "Min 0", "Max 10"],
            ),
            text(
              "n-perf-fee-pct",
              "Frais de performance (%)",
              "costs/perf-pct",
              ["Numeric", "Min 0", "Max 30"],
            ),
            {
              id: "n-total-result",
              type: "RESULT_DISPLAY",
              name: "Cout total ex-ante",
              path: "costs/total-result",
              text: "Cout total ex-ante (EUR)",
              defaultValue: "",
              validations: [
                "Sums entry + ongoing x assumed-tenor + perf",
                "Bound to instrument-notional and assumed-return",
              ],
            },
            info(
              "n-a11y-summary",
              "Resume accessible",
              "a11y/summary-region",
            ),
            radio(
              "n-disclosure",
              "Disclosure ex-ante remise",
              "compliance/mifid-cost-disclosure",
            ),
            button("n-submit", "Confirmer", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["MiFID-II", "PRIIPs"],
        complianceRulePackIds: ["eu-regulatory-mifid-cost-v1"],
        auditCriticality: "high",
        regulatedRiskOverride: "financial_transaction",
        rationale:
          "MiFID-II Article 24(4) + delegated regulation 2017/565 mandate ex-ante cost-and-charges disclosure. PRIIPs Regulation supplies the comparable methodology. EAA accessibility expectations apply to the public-facing UI.",
      },
      applicableInvariants: [
        "INV-EAA-KBD-01",
        "INV-MIFID-COSTS-01",
        "INV-OPTIONAL-COST-01",
      ],
    },
    {
      id: "benchmark-regulatory-reporting-vag-solvency-narrative",
      archetype: "vag-solvency-narrative",
      stratum: "regulatory-reporting",
      domain: "compliance",
      tier: 2,
      adversarial: false,
      locale: "de",
      intent:
        "VAG / Solvency-II narrative SFCR section capturing capital-adequacy text blocks, internal-model usage, and a senior-management attestation.",
      notes:
        "Stratum regulatory-reporting. Mid-complexity narrative fixture; pins long-form free-text validation under the Solvency-II SFCR template.",
      screens: [
        {
          id: "s-sfcr",
          name: "VAG SFCR Narrative",
          path: "/regulatory/vag/sfcr/narrative",
          nodes: [
            text(
              "n-undertaking-lei",
              "Undertaking LEI",
              "undertaking/lei",
              ["Required", "Length 20", "LEI-checksum"],
            ),
            text(
              "n-period",
              "Berichtsperiode (Jahr)",
              "report/year",
              ["Required", "Numeric", "Min 2016", "Max 2099"],
            ),
            text(
              "n-scr",
              "SCR (EUR)",
              "report/scr",
              ["Required", "Numeric", "Min 0"],
            ),
            text(
              "n-mcr",
              "MCR (EUR)",
              "report/mcr",
              [
                "Required",
                "Numeric",
                "Min 0",
                "Max <= scr",
              ],
            ),
            text(
              "n-narrative-cap",
              "Kapitaltext",
              "report/narrative/capital",
              ["Required", "Min 200 characters", "Max 5000 characters"],
            ),
            radio(
              "n-internal-model",
              "Internes Modell verwendet",
              "report/internal-model",
            ),
            text(
              "n-internal-model-ref",
              "Genehmigungsreferenz internes Modell",
              "report/internal-model-ref",
              [
                "Required if internal-model is Yes",
                "Format BAFIN-IM-#######",
              ],
            ),
            radio(
              "n-mgmt-attest",
              "Vorstands-Attestation",
              "compliance/management-attestation",
            ),
            button("n-submit", "SFCR-Abschnitt einreichen", "actions/submit"),
          ],
        },
      ],
      compliance: {
        regulations: ["EIOPA-Guidelines", "Solvency-II", "VAG"],
        complianceRulePackIds: ["eu-regulatory-vag-v1"],
        auditCriticality: "medium",
        regulatedRiskOverride: "regulated_data",
        rationale:
          "VAG implements Solvency II in Germany; the SFCR narrative carries the EIOPA-template-driven capital-adequacy disclosure. Senior-management attestation is mandatory.",
      },
      applicableInvariants: ["INV-MIFID-COSTS-01"],
    },
  ];
};

const writeFixtureFiles = async (spec: FixtureSpec): Promise<void> => {
  const figma = buildFigmaInput(spec);
  const summary = buildSummary(spec, figma);
  const compliance = buildCompliance(spec);

  const figmaPath = join(FIXTURES_DIR, `${spec.id}.figma.json`);
  const summaryPath = join(FIXTURES_DIR, `${spec.id}.expected.summary.json`);
  const compliancePath = join(FIXTURES_DIR, `${spec.id}.compliance.json`);

  await writeFile(figmaPath, buildPrettyFigmaJson(spec, figma), "utf8");
  await writeFile(summaryPath, canonicalJson(summary) + "\n", "utf8");
  await writeFile(compliancePath, canonicalJson(compliance) + "\n", "utf8");
};

const main = async (): Promise<void> => {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const fixtures = FIXTURES();
  // Sanity: every id must be unique.
  const ids = new Set<string>();
  for (const spec of fixtures) {
    if (ids.has(spec.id)) {
      throw new Error(`duplicate fixture id: ${spec.id}`);
    }
    ids.add(spec.id);
  }
  if (fixtures.length < 28) {
    throw new Error(
      `expected at least 28 fixtures, generator produced ${fixtures.length}`,
    );
  }
  for (const spec of fixtures) {
    await writeFixtureFiles(spec);
  }
  // eslint-disable-next-line no-console
  console.log(`generated ${fixtures.length} benchmark expansion fixtures`);
};

await main();
