/**
 * Issue #2115 — benchmark expansion suite (28 stratified-random fixtures).
 *
 * Companion to `baseline-fixtures.ts` (7 MA-0 archetypes) and
 * `eingabemasken-fixtures.ts` (15 banking/insurance UI input masks).
 * Together the three suites form the 50-fixture benchmark corpus
 * argued in `docs/decisions/0042-benchmark-sample-plan.md`.
 *
 * Each fixture is a self-contained triple checked into
 * `src/test-intelligence/fixtures/`:
 *
 *   - `<id>.figma.json`             — Figma input.
 *   - `<id>.expected.summary.json`  — canonical-JSON summary
 *                                     snapshot (counts derived by
 *                                     `deriveBusinessTestIntentIr`).
 *   - `<id>.compliance.json`        — canonical-JSON compliance
 *                                     sidecar (regulations, rule
 *                                     packs, audit criticality).
 *
 * The summary's `figma.*Count` numbers are byte-stable and asserted by
 * `benchmark-expansion-fixtures.test.ts`. The generator that produced
 * the snapshots is `scripts/generate-benchmark-expansion-fixtures.ts`
 * and is idempotent: re-running it overwrites the snapshots with
 * identical bytes.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TestCaseRiskCategory } from "../contracts/index.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

/**
 * Frozen list of the 28 expansion fixture ids. Order is stratum-major,
 * then domain (banking before insurance), then tier 1 → 3.
 */
export const BENCHMARK_EXPANSION_FIXTURE_IDS = [
  // Banking retail (6).
  "benchmark-banking-retail-girokonto-eroeffnung",
  "benchmark-banking-retail-tagesgeld-aufgabe",
  "benchmark-banking-retail-instant-payment-cooloff",
  "benchmark-banking-retail-kreditkarten-antrag",
  "benchmark-banking-retail-streit-chargeback",
  "benchmark-banking-retail-paydirekt-setup",

  // Banking corporate (4).
  "benchmark-banking-corp-firmenkunde-onboarding-en",
  "benchmark-banking-corp-trade-finance-akkreditiv",
  "benchmark-banking-corp-treasury-fx",
  "benchmark-banking-corp-zahlungsverkehrs-export",

  // Insurance life (4).
  "benchmark-insurance-life-rentenversicherung-antrag",
  "benchmark-insurance-life-fondsgebunden-policentausch",
  "benchmark-insurance-life-leistungsantrag-tod",
  "benchmark-insurance-life-versorgungswerk-eintritt",

  // Insurance non-life (5).
  "benchmark-insurance-nonlife-haftpflicht-antrag",
  "benchmark-insurance-nonlife-rechtsschutz-meldung",
  "benchmark-insurance-nonlife-kfz-vertrags-uebernahme",
  "benchmark-insurance-nonlife-reise-storno-it",
  "benchmark-insurance-nonlife-tier-haftpflicht-fr",

  // Insurance health (4).
  "benchmark-insurance-health-pkv-antrag",
  "benchmark-insurance-health-zahnzusatz-leistung",
  "benchmark-insurance-health-pflegezusatz-antrag",
  "benchmark-insurance-health-arbeitsunfaehigkeit-en",

  // Regulatory reporting (5).
  "benchmark-regulatory-reporting-emir-meldung",
  "benchmark-regulatory-reporting-dora-incident",
  "benchmark-regulatory-reporting-aifmd-anlegerbericht",
  "benchmark-regulatory-reporting-mifid-cost-disclosure-fr",
  "benchmark-regulatory-reporting-vag-solvency-narrative",
] as const;

export type BenchmarkExpansionFixtureId =
  (typeof BENCHMARK_EXPANSION_FIXTURE_IDS)[number];

export type BenchmarkExpansionStratum =
  | "banking-retail"
  | "banking-corporate"
  | "insurance-life"
  | "insurance-non-life"
  | "insurance-health"
  | "regulatory-reporting";

export type BenchmarkExpansionDomain = "banking" | "insurance" | "compliance";

export type BenchmarkExpansionTier = 1 | 2 | 3;

export type BenchmarkExpansionLocale = "de" | "en" | "fr" | "it";

export type BenchmarkExpansionAdversarialKind =
  | ""
  | "multi-step-wizard"
  | "conditional-section"
  | "multilingual"
  | "a11y-stress"
  | "deeply-nested-validation";

export type BenchmarkExpansionAuditCriticality = "low" | "medium" | "high";

/**
 * Per-stratum minimum fixture counts argued in
 * `docs/decisions/0042-benchmark-sample-plan.md`. The companion test
 * asserts that the live registry meets every minimum so a regression
 * (e.g. a fixture renamed but not re-registered) is caught.
 */
export const BENCHMARK_EXPANSION_PER_STRATUM_MINIMUM: Readonly<
  Record<BenchmarkExpansionStratum, number>
> = {
  "banking-retail": 5,
  "banking-corporate": 3,
  "insurance-life": 3,
  "insurance-non-life": 4,
  "insurance-health": 3,
  "regulatory-reporting": 3,
};

/**
 * Stratum classification per fixture; used by the per-stratum coverage
 * assertion and by the deterministic measurement driver.
 */
export const BENCHMARK_EXPANSION_FIXTURE_STRATA: Readonly<
  Record<BenchmarkExpansionFixtureId, BenchmarkExpansionStratum>
> = {
  "benchmark-banking-retail-girokonto-eroeffnung": "banking-retail",
  "benchmark-banking-retail-tagesgeld-aufgabe": "banking-retail",
  "benchmark-banking-retail-instant-payment-cooloff": "banking-retail",
  "benchmark-banking-retail-kreditkarten-antrag": "banking-retail",
  "benchmark-banking-retail-streit-chargeback": "banking-retail",
  "benchmark-banking-retail-paydirekt-setup": "banking-retail",
  "benchmark-banking-corp-firmenkunde-onboarding-en": "banking-corporate",
  "benchmark-banking-corp-trade-finance-akkreditiv": "banking-corporate",
  "benchmark-banking-corp-treasury-fx": "banking-corporate",
  "benchmark-banking-corp-zahlungsverkehrs-export": "banking-corporate",
  "benchmark-insurance-life-rentenversicherung-antrag": "insurance-life",
  "benchmark-insurance-life-fondsgebunden-policentausch": "insurance-life",
  "benchmark-insurance-life-leistungsantrag-tod": "insurance-life",
  "benchmark-insurance-life-versorgungswerk-eintritt": "insurance-life",
  "benchmark-insurance-nonlife-haftpflicht-antrag": "insurance-non-life",
  "benchmark-insurance-nonlife-rechtsschutz-meldung": "insurance-non-life",
  "benchmark-insurance-nonlife-kfz-vertrags-uebernahme": "insurance-non-life",
  "benchmark-insurance-nonlife-reise-storno-it": "insurance-non-life",
  "benchmark-insurance-nonlife-tier-haftpflicht-fr": "insurance-non-life",
  "benchmark-insurance-health-pkv-antrag": "insurance-health",
  "benchmark-insurance-health-zahnzusatz-leistung": "insurance-health",
  "benchmark-insurance-health-pflegezusatz-antrag": "insurance-health",
  "benchmark-insurance-health-arbeitsunfaehigkeit-en": "insurance-health",
  "benchmark-regulatory-reporting-emir-meldung": "regulatory-reporting",
  "benchmark-regulatory-reporting-dora-incident": "regulatory-reporting",
  "benchmark-regulatory-reporting-aifmd-anlegerbericht": "regulatory-reporting",
  "benchmark-regulatory-reporting-mifid-cost-disclosure-fr":
    "regulatory-reporting",
  "benchmark-regulatory-reporting-vag-solvency-narrative":
    "regulatory-reporting",
};

/**
 * Loaded snapshot persisted as `<id>.expected.summary.json`. Same shape
 * across the three benchmark suites, with stratum/locale/adversarial
 * surfaced for the expansion suite.
 */
export interface BenchmarkExpansionSummary {
  schemaVersion: "1.0.0";
  archetypeId: BenchmarkExpansionFixtureId;
  archetype: string;
  stratum: BenchmarkExpansionStratum;
  domain: BenchmarkExpansionDomain;
  tier: BenchmarkExpansionTier;
  adversarial: boolean;
  adversarialKind: BenchmarkExpansionAdversarialKind;
  locale: BenchmarkExpansionLocale;
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

/**
 * Side-car compliance annotation persisted as `<id>.compliance.json`.
 * Mirrors the eingabemasken sidecar shape so the policy gate and
 * compliance-coverage reports can join the two suites without per-suite
 * branching.
 */
export interface BenchmarkExpansionComplianceAnnotation {
  schemaVersion: "1.0.0";
  fixtureId: BenchmarkExpansionFixtureId;
  regulations: string[];
  complianceRulePackIds: string[];
  auditCriticality: BenchmarkExpansionAuditCriticality;
  regulatedRiskOverride: TestCaseRiskCategory;
  rationale: string;
}

export interface LoadedBenchmarkExpansionFixture {
  archetypeId: BenchmarkExpansionFixtureId;
  stratum: BenchmarkExpansionStratum;
  domain: BenchmarkExpansionDomain;
  tier: BenchmarkExpansionTier;
  locale: BenchmarkExpansionLocale;
  adversarial: boolean;
  adversarialKind: BenchmarkExpansionAdversarialKind;
  figma: IntentDerivationFigmaInput;
  figmaPath: string;
  summary: BenchmarkExpansionSummary;
  summaryPath: string;
  compliance: BenchmarkExpansionComplianceAnnotation;
  compliancePath: string;
}

export const isBenchmarkExpansionFixtureId = (
  value: unknown,
): value is BenchmarkExpansionFixtureId => {
  return (
    typeof value === "string" &&
    (BENCHMARK_EXPANSION_FIXTURE_IDS as readonly string[]).includes(value)
  );
};

const fixturePath = (
  archetypeId: BenchmarkExpansionFixtureId,
  suffix: string,
): string => join(FIXTURES_DIR, `${archetypeId}.${suffix}`);

/**
 * Load a benchmark-expansion fixture into the shapes the test suite
 * consumes. All three sidecars (figma, summary, compliance) are
 * mandatory; this suite has no optional Jira or custom-markdown
 * sidecars and does not silently look for them.
 */
export const loadBenchmarkExpansionFixture = async (
  archetypeId: BenchmarkExpansionFixtureId,
): Promise<LoadedBenchmarkExpansionFixture> => {
  if (!isBenchmarkExpansionFixtureId(archetypeId)) {
    throw new RangeError(
      `loadBenchmarkExpansionFixture: unknown archetypeId "${String(
        archetypeId,
      )}". Allowed: ${BENCHMARK_EXPANSION_FIXTURE_IDS.join(", ")}.`,
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
  const summary = JSON.parse(summaryRaw) as BenchmarkExpansionSummary;
  const compliance = JSON.parse(
    complianceRaw,
  ) as BenchmarkExpansionComplianceAnnotation;

  if (compliance.fixtureId !== archetypeId) {
    throw new Error(
      `loadBenchmarkExpansionFixture: compliance sidecar for ${archetypeId} declares fixtureId="${compliance.fixtureId}"; expected "${archetypeId}".`,
    );
  }
  if (summary.archetypeId !== archetypeId) {
    throw new Error(
      `loadBenchmarkExpansionFixture: summary for ${archetypeId} declares archetypeId="${summary.archetypeId}"; expected "${archetypeId}".`,
    );
  }
  if (summary.stratum !== BENCHMARK_EXPANSION_FIXTURE_STRATA[archetypeId]) {
    throw new Error(
      `loadBenchmarkExpansionFixture: summary stratum for ${archetypeId} drifted from registered stratum`,
    );
  }

  return {
    archetypeId,
    stratum: summary.stratum,
    domain: summary.domain,
    tier: summary.tier,
    locale: summary.locale,
    adversarial: summary.adversarial,
    adversarialKind: summary.adversarialKind,
    figma,
    figmaPath,
    summary,
    summaryPath,
    compliance,
    compliancePath,
  };
};
