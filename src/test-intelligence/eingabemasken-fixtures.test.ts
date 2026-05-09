import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS,
  EINGABEMASKEN_FIXTURE_DOMAINS,
  EINGABEMASKEN_FIXTURE_TIERS,
  isEingabemaskenArchetypeFixtureId,
  loadEingabemaskenArchetypeFixture,
  type EingabemaskenArchetypeFixtureId,
  type EingabemaskenArchetypeSummary,
  type EingabemaskenComplianceAnnotation,
} from "./eingabemasken-fixtures.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";

const ALLOWED_AUDIT_CRITICALITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
]);
const ALLOWED_REGULATED_RISK_OVERRIDES: ReadonlySet<string> = new Set([
  "low",
  "regulated_data",
  "financial_transaction",
  "high",
]);

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname,
  "fixtures",
);

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----/i,
];

const RAW_BINARY_EXTENSIONS: ReadonlyArray<string> = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
];

describe("eingabemasken-fixtures (banking and insurance UI input masks)", () => {
  test("registers exactly fifteen Eingabemaske archetype ids", () => {
    assert.equal(EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS.length, 15);
    assert.deepEqual([...EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS].sort(), [
      "eingabemaske-a11y-high-contrast",
      "eingabemaske-anlegerprofil-wizard",
      "eingabemaske-bu-antrag",
      "eingabemaske-cyber-risiko-assessment",
      "eingabemaske-gwg-verdachtsmeldung",
      "eingabemaske-hausrat-schadenmeldung",
      "eingabemaske-kfz-tarifrechner-step1",
      "eingabemaske-kfz-vollkasko-schaden",
      "eingabemaske-konsumentenkredit-antrag",
      "eingabemaske-konto-kyc",
      "eingabemaske-lv-bezugsberechtigung",
      "eingabemaske-mehrsprachig-de-en",
      "eingabemaske-mifid-wertpapier-order",
      "eingabemaske-online-banking-login",
      "eingabemaske-sepa-ueberweisung",
    ]);
    for (const id of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
      assert.equal(isEingabemaskenArchetypeFixtureId(id), true);
    }
    assert.equal(
      isEingabemaskenArchetypeFixtureId("not-a-fixture"),
      false,
    );
  });

  test("every fixture has a tier in {1,2,3} and a domain", () => {
    for (const id of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
      const tier = EINGABEMASKEN_FIXTURE_TIERS[id];
      assert.ok(
        tier === 1 || tier === 2 || tier === 3,
        `tier for ${id} must be 1, 2, or 3`,
      );
      const domain = EINGABEMASKEN_FIXTURE_DOMAINS[id];
      assert.ok(
        domain === "banking" ||
          domain === "insurance" ||
          domain === "compliance",
        `domain for ${id} must be banking, insurance, or compliance`,
      );
    }
  });

  test("the suite covers all three tiers and at least banking + insurance", () => {
    const tiers = new Set<number>();
    const domains = new Set<string>();
    for (const id of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
      tiers.add(EINGABEMASKEN_FIXTURE_TIERS[id]);
      domains.add(EINGABEMASKEN_FIXTURE_DOMAINS[id]);
    }
    assert.deepEqual([...tiers].sort(), [1, 2, 3]);
    assert.ok(domains.has("banking"));
    assert.ok(domains.has("insurance"));
  });

  test("rejects unknown archetype ids loudly", async () => {
    await assert.rejects(
      () =>
        loadEingabemaskenArchetypeFixture(
          "eingabemaske-not-a-thing" as EingabemaskenArchetypeFixtureId,
        ),
      /unknown archetypeId/u,
    );
  });

  for (const archetypeId of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
    describe(archetypeId, () => {
      test("loads, derives an IR, and matches the expected summary", async () => {
        const loaded = await loadEingabemaskenArchetypeFixture(archetypeId);
        const { figma, summary } = loaded;

        assert.equal(summary.schemaVersion, "1.0.0");
        assert.equal(summary.archetypeId, archetypeId);
        assert.ok(
          summary.intent.length > 0,
          "summary.intent must not be empty",
        );
        assert.ok(
          summary.notes.length > 0,
          "summary.notes must not be empty",
        );

        // This suite never carries Jira or customer-supplied markdown
        // sidecars; the dedicated multi-context fixture lives in the
        // baseline suite.
        assert.equal(summary.sources.hasJira, false);
        assert.equal(summary.sources.hasCustomMarkdown, false);

        // Eingabemasken are concrete enough that the OpenQuestions
        // surface is empty; ambiguous-rule modeling stays in the
        // baseline-ambiguous-rules archetype.
        assert.deepEqual(summary.expectedOpenQuestionsKeywords, []);

        const screenCount = figma.screens.length;
        const nodeCount = figma.screens.reduce(
          (n, s) => n + s.nodes.length,
          0,
        );
        assert.equal(screenCount, summary.figma.screenCount);
        assert.equal(nodeCount, summary.figma.nodeCount);

        const ir = deriveBusinessTestIntentIr({ figma });
        assert.equal(
          ir.detectedFields.length,
          summary.figma.fieldNodeCount,
          "detectedFields count must match summary.figma.fieldNodeCount",
        );
        assert.equal(
          ir.detectedActions.length,
          summary.figma.actionNodeCount,
          "detectedActions count must match summary.figma.actionNodeCount",
        );
        assert.equal(
          ir.detectedValidations.length,
          summary.figma.validationCount,
          "detectedValidations count must match summary.figma.validationCount",
        );
        assert.equal(
          ir.detectedNavigation.length,
          summary.figma.navigationCount,
          "detectedNavigation count must match summary.figma.navigationCount",
        );
      });

      test("expected.summary.json is byte-stable canonical JSON", async () => {
        const summaryPath = join(
          FIXTURES_DIR,
          `${archetypeId}.expected.summary.json`,
        );
        const raw = await readFile(summaryPath, "utf8");
        const parsed = JSON.parse(raw) as EingabemaskenArchetypeSummary;
        const recanon = canonicalJson(parsed);
        assert.equal(recanon, canonicalJson(JSON.parse(recanon)));
        assert.equal(
          canonicalJson(parsed),
          recanon,
          "stored summary must already be in canonical form (sorted keys, no whitespace)",
        );
      });

      test("compliance sidecar is well-formed and matches the archetype id", async () => {
        const loaded = await loadEingabemaskenArchetypeFixture(archetypeId);
        const c = loaded.compliance;
        assert.equal(c.schemaVersion, "1.0.0");
        assert.equal(c.fixtureId, archetypeId);
        assert.ok(
          Array.isArray(c.regulations) && c.regulations.length > 0,
          "regulations must be a non-empty array",
        );
        assert.ok(
          Array.isArray(c.complianceRulePackIds) &&
            c.complianceRulePackIds.length > 0,
          "complianceRulePackIds must be a non-empty array",
        );
        assert.ok(
          ALLOWED_AUDIT_CRITICALITIES.has(c.auditCriticality),
          `auditCriticality "${c.auditCriticality}" must be one of low|medium|high`,
        );
        assert.ok(
          ALLOWED_REGULATED_RISK_OVERRIDES.has(c.regulatedRiskOverride),
          `regulatedRiskOverride "${c.regulatedRiskOverride}" must be a TestCaseRiskCategory value`,
        );
        assert.ok(
          c.rationale.length > 0,
          "rationale must not be empty",
        );
      });

      test("compliance.json is byte-stable canonical JSON", async () => {
        const compliancePath = join(
          FIXTURES_DIR,
          `${archetypeId}.compliance.json`,
        );
        const raw = await readFile(compliancePath, "utf8");
        const parsed = JSON.parse(raw) as EingabemaskenComplianceAnnotation;
        const recanon = canonicalJson(parsed);
        assert.equal(recanon, canonicalJson(JSON.parse(recanon)));
        assert.equal(
          canonicalJson(parsed),
          recanon,
          "stored compliance sidecar must already be in canonical form",
        );
      });

      test("at-risk fixtures (high audit criticality) declare regulated risk", async () => {
        const loaded = await loadEingabemaskenArchetypeFixture(archetypeId);
        const c = loaded.compliance;
        if (c.auditCriticality === "high") {
          assert.notEqual(
            c.regulatedRiskOverride,
            "low",
            `fixture ${archetypeId} marked auditCriticality=high must NOT downgrade regulatedRiskOverride to low`,
          );
        }
      });

      test("contains no raw screenshots and no obvious secrets", async () => {
        const loaded = await loadEingabemaskenArchetypeFixture(archetypeId);
        const candidatePaths: string[] = [
          loaded.figmaPath,
          loaded.summaryPath,
        ];
        for (const path of candidatePaths) {
          for (const ext of RAW_BINARY_EXTENSIONS) {
            assert.ok(
              !path.toLowerCase().endsWith(ext),
              `fixture path must not be a raw image: ${path}`,
            );
          }
          const content = await readFile(path, "utf8");
          for (const pattern of SECRET_PATTERNS) {
            assert.equal(
              pattern.test(content),
              false,
              `fixture ${path} must not contain ${pattern.source}`,
            );
          }
        }
      });

      test("default values do not leak realistic-looking PII", async () => {
        const loaded = await loadEingabemaskenArchetypeFixture(archetypeId);
        // The rubric forbids productive personally-identifiable data
        // in fixtures. The KYC, Schadenmeldung and BU fixtures all
        // ship with empty defaultValue strings precisely so the
        // generator cannot mistake them for canonical examples.
        const realisticIbanRegex = /\bDE\d{20}\b/;
        const taxIdRegex = /\b\d{11}\b/;
        for (const screen of loaded.figma.screens) {
          for (const node of screen.nodes) {
            const dv = node.defaultValue;
            if (dv === undefined || dv === "") continue;
            if (
              node.nodePath !== undefined &&
              node.nodePath.includes("tax-id")
            ) {
              assert.equal(
                taxIdRegex.test(dv),
                false,
                `tax-id defaultValue in ${archetypeId} must not look like a real eleven-digit number; got "${dv}"`,
              );
            }
            // The SEPA fixture ships an example IBAN that is a known
            // documentation IBAN (the public test bank "Bundesbank
            // Testbank"); we whitelist it explicitly.
            if (
              node.nodePath !== undefined &&
              node.nodePath.endsWith("/iban") &&
              dv !== "DE89370400440532013000"
            ) {
              assert.equal(
                realisticIbanRegex.test(dv),
                false,
                `IBAN defaultValue in ${archetypeId} must be the documentation IBAN or empty; got "${dv}"`,
              );
            }
          }
        }
      });
    });
  }
});
