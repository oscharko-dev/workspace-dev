/**
 * Banking and insurance Eingabemasken (UI input form) fixture loader.
 *
 * Companion to `baseline-fixtures.ts`. Where the MA-0 baselines pin the
 * lower bound of the seven generic mask archetypes, this suite pins
 * the upper bound for fifteen domain-specific Eingabemasken drawn from
 * regulated EU banking and insurance workflows. The suite is split
 * across three tiers, mirroring the rubric in
 * `fixtures/test-intelligence/customer-evals/Testfall-eines-Anwendungstests.md`:
 *
 *   - Tier 1 (smoke / baseline)        : SEPA payment, online-banking
 *                                        login + 2FA, KFZ tariff step 1,
 *                                        Hausrat damage report.
 *   - Tier 2 (standard / realistic)    : MiFID-II securities order,
 *                                        consumer-loan application, KYC
 *                                        onboarding wizard, BU application,
 *                                        KFZ Vollkasko damage report,
 *                                        LV beneficiary designation.
 *   - Tier 3 (adversarial)             : Anlegerprofil branching wizard,
 *                                        GwG suspicious activity report,
 *                                        Cyber-Versicherung risk
 *                                        assessment, bilingual DE/EN
 *                                        login, accessibility variant.
 *
 * On-disk layout under `src/test-intelligence/fixtures/`:
 *
 *   - `<archetypeId>.figma.json`             - required Figma input.
 *   - `<archetypeId>.expected.summary.json`  - hand-curated summary
 *                                              snapshot in canonical JSON.
 *
 * The companion test (`eingabemasken-fixtures.test.ts`) asserts that
 * loading each fixture's Figma input through `deriveBusinessTestIntentIr`
 * produces counts that match the snapshot, and that each summary file
 * is byte-stable canonical JSON.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TestCaseRiskCategory } from "../contracts/index.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

/**
 * Frozen list of the fifteen Eingabemaske archetype ids covered by this
 * suite, ordered by tier then by domain (banking before insurance).
 */
export const EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS = [
  "eingabemaske-sepa-ueberweisung",
  "eingabemaske-online-banking-login",
  "eingabemaske-kfz-tarifrechner-step1",
  "eingabemaske-hausrat-schadenmeldung",
  "eingabemaske-mifid-wertpapier-order",
  "eingabemaske-konsumentenkredit-antrag",
  "eingabemaske-konto-kyc",
  "eingabemaske-bu-antrag",
  "eingabemaske-kfz-vollkasko-schaden",
  "eingabemaske-lv-bezugsberechtigung",
  "eingabemaske-anlegerprofil-wizard",
  "eingabemaske-gwg-verdachtsmeldung",
  "eingabemaske-cyber-risiko-assessment",
  "eingabemaske-mehrsprachig-de-en",
  "eingabemaske-a11y-high-contrast",
] as const;

export type EingabemaskenArchetypeFixtureId =
  (typeof EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS)[number];

export type EingabemaskenTier = 1 | 2 | 3;

export type EingabemaskenDomain = "banking" | "insurance" | "compliance";

/**
 * Tier classification per fixture. Tier 1 is smoke-level baseline; tier
 * 2 is realistic regulatory load; tier 3 is adversarial (cross-screen
 * branching, repeating PII rows, high-density tooltip-driven cross-modal,
 * locale stress and accessibility stress).
 */
export const EINGABEMASKEN_FIXTURE_TIERS: Readonly<
  Record<EingabemaskenArchetypeFixtureId, EingabemaskenTier>
> = {
  "eingabemaske-sepa-ueberweisung": 1,
  "eingabemaske-online-banking-login": 1,
  "eingabemaske-kfz-tarifrechner-step1": 1,
  "eingabemaske-hausrat-schadenmeldung": 1,
  "eingabemaske-mifid-wertpapier-order": 2,
  "eingabemaske-konsumentenkredit-antrag": 2,
  "eingabemaske-konto-kyc": 2,
  "eingabemaske-bu-antrag": 2,
  "eingabemaske-kfz-vollkasko-schaden": 2,
  "eingabemaske-lv-bezugsberechtigung": 2,
  "eingabemaske-anlegerprofil-wizard": 3,
  "eingabemaske-gwg-verdachtsmeldung": 3,
  "eingabemaske-cyber-risiko-assessment": 3,
  "eingabemaske-mehrsprachig-de-en": 3,
  "eingabemaske-a11y-high-contrast": 3,
};

/**
 * Domain classification per fixture; the GwG suspicious-activity
 * report is filed under "compliance" because it is regulator-facing
 * rather than customer- or product-facing.
 */
export const EINGABEMASKEN_FIXTURE_DOMAINS: Readonly<
  Record<EingabemaskenArchetypeFixtureId, EingabemaskenDomain>
> = {
  "eingabemaske-sepa-ueberweisung": "banking",
  "eingabemaske-online-banking-login": "banking",
  "eingabemaske-kfz-tarifrechner-step1": "insurance",
  "eingabemaske-hausrat-schadenmeldung": "insurance",
  "eingabemaske-mifid-wertpapier-order": "banking",
  "eingabemaske-konsumentenkredit-antrag": "banking",
  "eingabemaske-konto-kyc": "banking",
  "eingabemaske-bu-antrag": "insurance",
  "eingabemaske-kfz-vollkasko-schaden": "insurance",
  "eingabemaske-lv-bezugsberechtigung": "insurance",
  "eingabemaske-anlegerprofil-wizard": "banking",
  "eingabemaske-gwg-verdachtsmeldung": "compliance",
  "eingabemaske-cyber-risiko-assessment": "insurance",
  "eingabemaske-mehrsprachig-de-en": "banking",
  "eingabemaske-a11y-high-contrast": "banking",
};

/**
 * Counts derivable from the Figma input alone - identical shape to
 * `BaselineArchetypeFigmaCounts` so dashboards and per-tier reports
 * can join the two suites without per-suite branching.
 */
export interface EingabemaskenArchetypeFigmaCounts {
  screenCount: number;
  nodeCount: number;
  fieldNodeCount: number;
  actionNodeCount: number;
  validationCount: number;
  navigationCount: number;
}

export interface EingabemaskenArchetypeSources {
  hasJira: boolean;
  hasCustomMarkdown: boolean;
}

/**
 * Hand-curated snapshot persisted as
 * `<archetypeId>.expected.summary.json` for every fixture. Same shape
 * as `BaselineArchetypeSummary` and asserted in canonical-JSON form by
 * `eingabemasken-fixtures.test.ts`.
 */
export interface EingabemaskenArchetypeSummary {
  schemaVersion: "1.0.0";
  archetypeId: EingabemaskenArchetypeFixtureId;
  archetype: string;
  intent: string;
  figma: EingabemaskenArchetypeFigmaCounts;
  sources: EingabemaskenArchetypeSources;
  expectedOpenQuestionsKeywords: string[];
  notes: string;
}

export interface LoadedEingabemaskenArchetypeFixture {
  archetypeId: EingabemaskenArchetypeFixtureId;
  tier: EingabemaskenTier;
  domain: EingabemaskenDomain;
  figma: IntentDerivationFigmaInput;
  figmaPath: string;
  summary: EingabemaskenArchetypeSummary;
  summaryPath: string;
  compliance: EingabemaskenComplianceAnnotation;
  compliancePath: string;
}

/**
 * Audit-criticality classification per fixture. Drives the
 * `auditCriticality` dimension of the compliance-coverage report
 * (Issue #2042 / `compliance-coverage-report.json`) for the Eingabemasken
 * suite.
 */
export type EingabemaskenAuditCriticality = "low" | "medium" | "high";

/**
 * Side-car compliance annotation persisted as
 * `<archetypeId>.compliance.json` next to the Figma input. Each fixture
 * is paired with a hand-curated compliance annotation that maps the
 * mask to the EU regulatory frameworks it implements (PSD2/SCA, MiFID
 * II, GwG, FATCA, IDD/VVG, EAA, etc.) and to the compliance rule packs
 * the harness should evaluate against (Issue #2042).
 *
 * The `regulatedRiskOverride` field surfaces the screen-level intent
 * risk classification independently of the field-level PII detector so
 * the policy gate can elevate cases on regulated masks where no PII
 * pattern fires (e.g. MiFID-II ISIN, GwG-Sachverhalt, EAA-A11y). The
 * Eingabemasken K0 measurement (`scripts/measure-eingabemasken.ts`)
 * showed the gate was blind to MiFID/BU/Cyber/A11y without this hint.
 *
 * The annotation file is canonical JSON (sorted keys, no whitespace).
 */
export interface EingabemaskenComplianceAnnotation {
  schemaVersion: "1.0.0";
  fixtureId: EingabemaskenArchetypeFixtureId;
  /**
   * Human-readable regulation identifiers (`PSD2-SCA`, `MiFID-II`,
   * `GwG-Section-43`, `EAA`, `GDPR-Art-9`, …). Order is canonical
   * (alphabetical) but semantics are not ranked.
   */
  regulations: string[];
  /**
   * Stable identifiers of compliance rule packs the harness should
   * evaluate against this fixture. Values must match rule-pack ids
   * registered with the EU banking + insurance compliance-as-code
   * registry (Issue #2042).
   */
  complianceRulePackIds: string[];
  auditCriticality: EingabemaskenAuditCriticality;
  /**
   * Suggested screen-level intent risk classification. The policy gate
   * (Issue #2030 follow-up) may use this to override or augment the
   * field-derived classification. Allowed values match
   * `TestCaseRiskCategory`.
   */
  regulatedRiskOverride: TestCaseRiskCategory;
  /**
   * Short rationale (one paragraph) describing which articles or sections
   * apply and why. Auditor-facing.
   */
  rationale: string;
}

export const isEingabemaskenArchetypeFixtureId = (
  value: unknown,
): value is EingabemaskenArchetypeFixtureId => {
  return (
    typeof value === "string" &&
    (EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS as readonly string[]).includes(value)
  );
};

const fixturePath = (
  archetypeId: EingabemaskenArchetypeFixtureId,
  suffix: string,
): string => join(FIXTURES_DIR, `${archetypeId}.${suffix}`);

/**
 * Load an Eingabemaske archetype fixture into the shapes the test
 * suite consumes. Both the Figma input and the expected-summary
 * snapshot are mandatory; this suite has no optional Jira or custom
 * markdown sidecars and does not silently look for them.
 */
export const loadEingabemaskenArchetypeFixture = async (
  archetypeId: EingabemaskenArchetypeFixtureId,
): Promise<LoadedEingabemaskenArchetypeFixture> => {
  if (!isEingabemaskenArchetypeFixtureId(archetypeId)) {
    throw new RangeError(
      `loadEingabemaskenArchetypeFixture: unknown archetypeId "${String(
        archetypeId,
      )}". Allowed: ${EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS.join(", ")}.`,
    );
  }
  const figmaPath = fixturePath(archetypeId, "figma.json");
  const summaryPath = fixturePath(archetypeId, "expected.summary.json");
  const compliancePath = fixturePath(archetypeId, "compliance.json");

  const [figmaRaw, summaryRaw, complianceRaw] = await Promise.all([
    readFile(figmaPath, "utf8"),
    readFile(summaryPath, "utf8"),
    readFile(compliancePath, "utf8"),
  ]);

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const summary = JSON.parse(summaryRaw) as EingabemaskenArchetypeSummary;
  const compliance = JSON.parse(
    complianceRaw,
  ) as EingabemaskenComplianceAnnotation;
  if (compliance.fixtureId !== archetypeId) {
    throw new Error(
      `loadEingabemaskenArchetypeFixture: compliance sidecar for ${archetypeId} declares fixtureId="${compliance.fixtureId}"; expected "${archetypeId}".`,
    );
  }

  return {
    archetypeId,
    tier: EINGABEMASKEN_FIXTURE_TIERS[archetypeId],
    domain: EINGABEMASKEN_FIXTURE_DOMAINS[archetypeId],
    figma,
    figmaPath,
    summary,
    summaryPath,
    compliance,
    compliancePath,
  };
};

/**
 * Issue #2108 — declarative mapping from each Eingabemaske fixture to the
 * domain-invariant ids it MUST exercise when the validation pipeline runs
 * a compliance-aware test set against it. The mapping is the contract
 * the benchmark test enforces: a regression that hides an invariant from
 * a regulatory mask (e.g. dropping the MiFID-II appropriateness rule for
 * the securities-order Eingabemaske) is caught before it ships.
 *
 * Empty arrays are valid (e.g. accessibility-only fixtures); the test
 * suite enforces that *all* applicable invariants for a fixture are at
 * minimum registered in the active-dataset registry.
 */
export const EINGABEMASKEN_APPLICABLE_INVARIANTS: Readonly<
  Record<EingabemaskenArchetypeFixtureId, readonly string[]>
> = {
  "eingabemaske-sepa-ueberweisung": [
    "INV-PSD2-SCA-01",
    "INV-PSD2-DYNLINK-01",
    "INV-AML-CUMUL-01",
  ],
  "eingabemaske-online-banking-login": ["INV-PSD2-SCA-01", "INV-PSD2-DYNLINK-01"],
  "eingabemaske-kfz-tarifrechner-step1": [
    "INV-IDD-DEMANDS-01",
    "INV-NETTO-BRUTTO-01",
  ],
  "eingabemaske-hausrat-schadenmeldung": ["INV-IDD-DEMANDS-01"],
  "eingabemaske-mifid-wertpapier-order": [
    "INV-MIFID-SUITAB-01",
    "INV-MIFID-APPROP-01",
    "INV-MIFID-COSTS-01",
    "INV-VAG-BERATUNG-01",
  ],
  "eingabemaske-konsumentenkredit-antrag": [
    "INV-VAT-01",
    "INV-FINANCING-NEED-01",
    "INV-NETTO-BRUTTO-01",
    "INV-OPTIONAL-COST-01",
    "INV-FX-MARGIN-01",
  ],
  "eingabemaske-konto-kyc": [
    "INV-GWG-PEP-01",
    "INV-KYC-AGE-01",
    "INV-GDPR-ART9-01",
    "INV-GDPR-ART15-01",
  ],
  "eingabemaske-bu-antrag": [
    "INV-IDD-DEMANDS-01",
    "INV-SOLV2-COOLOFF-01",
    "INV-GDPR-ART9-01",
  ],
  "eingabemaske-kfz-vollkasko-schaden": ["INV-IDD-DEMANDS-01"],
  "eingabemaske-lv-bezugsberechtigung": [
    "INV-IDD-DEMANDS-01",
    "INV-SOLV2-COOLOFF-01",
  ],
  "eingabemaske-anlegerprofil-wizard": [
    "INV-MIFID-SUITAB-01",
    "INV-MIFID-APPROP-01",
    "INV-VAG-BERATUNG-01",
  ],
  "eingabemaske-gwg-verdachtsmeldung": [
    "INV-GWG-PEP-01",
    "INV-AML-CUMUL-01",
    "INV-DORA-ICT-01",
  ],
  "eingabemaske-cyber-risiko-assessment": ["INV-IDD-DEMANDS-01", "INV-DORA-ICT-01"],
  "eingabemaske-mehrsprachig-de-en": ["INV-EAA-KBD-01"],
  "eingabemaske-a11y-high-contrast": ["INV-EAA-KBD-01"],
};
