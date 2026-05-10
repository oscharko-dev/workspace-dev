import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  BENCHMARK_EXPANSION_FIXTURE_IDS,
  BENCHMARK_EXPANSION_FIXTURE_STRATA,
  BENCHMARK_EXPANSION_PER_STRATUM_MINIMUM,
  isBenchmarkExpansionFixtureId,
  loadBenchmarkExpansionFixture,
  type BenchmarkExpansionComplianceAnnotation,
  type BenchmarkExpansionFixtureId,
  type BenchmarkExpansionStratum,
  type BenchmarkExpansionSummary,
} from "./benchmark-expansion-fixtures.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

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
const ALLOWED_LOCALES: ReadonlySet<string> = new Set(["de", "en", "fr", "it"]);
const ALLOWED_DOMAINS: ReadonlySet<string> = new Set([
  "banking",
  "insurance",
  "compliance",
]);
const ALLOWED_ADVERSARIAL_KINDS: ReadonlySet<string> = new Set([
  "",
  "multi-step-wizard",
  "conditional-section",
  "multilingual",
  "a11y-stress",
  "deeply-nested-validation",
]);

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

describe("benchmark-expansion-fixtures (Issue #2115)", () => {
  test("registers at least 28 expansion fixture ids and they round-trip the type guard", () => {
    assert.ok(
      BENCHMARK_EXPANSION_FIXTURE_IDS.length >= 28,
      `expected at least 28 expansion fixtures, got ${BENCHMARK_EXPANSION_FIXTURE_IDS.length}`,
    );
    assert.equal(
      new Set(BENCHMARK_EXPANSION_FIXTURE_IDS).size,
      BENCHMARK_EXPANSION_FIXTURE_IDS.length,
      "expansion fixture ids must be unique",
    );
    for (const id of BENCHMARK_EXPANSION_FIXTURE_IDS) {
      assert.equal(isBenchmarkExpansionFixtureId(id), true);
    }
    assert.equal(isBenchmarkExpansionFixtureId("not-a-fixture"), false);
  });

  test("the corpus 7 + 15 + N >= 50 once the expansion lands", () => {
    const baselineCount = 7;
    const eingabemaskenCount = 15;
    const total =
      baselineCount + eingabemaskenCount + BENCHMARK_EXPANSION_FIXTURE_IDS.length;
    assert.ok(
      total >= 50,
      `total benchmark corpus must reach >= 50 fixtures (current ${total})`,
    );
  });

  test("every per-stratum minimum from the sample plan ADR is satisfied", () => {
    const counts = new Map<BenchmarkExpansionStratum, number>();
    for (const id of BENCHMARK_EXPANSION_FIXTURE_IDS) {
      const stratum = BENCHMARK_EXPANSION_FIXTURE_STRATA[id];
      counts.set(stratum, (counts.get(stratum) ?? 0) + 1);
    }
    for (const [stratum, minimum] of Object.entries(
      BENCHMARK_EXPANSION_PER_STRATUM_MINIMUM,
    ) as Array<[BenchmarkExpansionStratum, number]>) {
      const actual = counts.get(stratum) ?? 0;
      assert.ok(
        actual >= minimum,
        `stratum ${stratum} requires >= ${minimum} fixtures (have ${actual})`,
      );
    }
  });

  test("the adversarial subset has at least 10 fixtures across at least three adversarial kinds", async () => {
    let adversarialCount = 0;
    const kinds = new Set<string>();
    for (const id of BENCHMARK_EXPANSION_FIXTURE_IDS) {
      const loaded = await loadBenchmarkExpansionFixture(id);
      if (loaded.adversarial) {
        adversarialCount += 1;
        kinds.add(loaded.adversarialKind);
      }
    }
    assert.ok(
      adversarialCount >= 10,
      `expected >= 10 adversarial fixtures (have ${adversarialCount})`,
    );
    assert.ok(
      kinds.size >= 3,
      `adversarial fixtures must cover >= 3 kinds (have ${kinds.size}: ${[...kinds].join(", ")})`,
    );
  });

  test("locale coverage spans DE, EN, FR, IT (Issue #2118 calibration)", async () => {
    const locales = new Set<string>();
    for (const id of BENCHMARK_EXPANSION_FIXTURE_IDS) {
      const loaded = await loadBenchmarkExpansionFixture(id);
      locales.add(loaded.locale);
    }
    for (const required of ["de", "en", "fr", "it"]) {
      assert.ok(
        locales.has(required),
        `locale ${required} must be represented in the expansion suite`,
      );
    }
  });

  test("rejects unknown archetype ids loudly", async () => {
    await assert.rejects(
      () =>
        loadBenchmarkExpansionFixture(
          "benchmark-not-a-fixture" as BenchmarkExpansionFixtureId,
        ),
      /unknown archetypeId/u,
    );
  });

  for (const archetypeId of BENCHMARK_EXPANSION_FIXTURE_IDS) {
    describe(archetypeId, () => {
      test("loads, derives an IR, and matches the expected summary", async () => {
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
        const { figma, summary, compliance } = loaded;

        assert.equal(summary.schemaVersion, "1.0.0");
        assert.equal(summary.archetypeId, archetypeId);
        assert.equal(compliance.fixtureId, archetypeId);
        assert.ok(summary.intent.length > 0, "intent must not be empty");
        assert.ok(summary.notes.length > 0, "notes must not be empty");
        assert.ok(ALLOWED_LOCALES.has(summary.locale));
        assert.ok(ALLOWED_DOMAINS.has(summary.domain));
        assert.ok([1, 2, 3].includes(summary.tier));
        assert.equal(summary.sources.hasJira, false);
        assert.equal(summary.sources.hasCustomMarkdown, false);
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
        // Files are written as `canonicalJson(...) + "\n"` to keep
        // POSIX-friendly line endings; the canonical-form check
        // strips that single trailing newline before comparison.
        const trimmed = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
        const parsed = JSON.parse(trimmed) as BenchmarkExpansionSummary;
        assert.equal(
          canonicalJson(parsed),
          trimmed,
          "stored summary must be in canonical form (sorted keys, no whitespace)",
        );
      });

      test("compliance sidecar is well-formed and matches the archetype id", async () => {
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
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
        assert.ok(c.rationale.length > 0, "rationale must not be empty");
      });

      test("compliance.json is byte-stable canonical JSON", async () => {
        const compliancePath = join(
          FIXTURES_DIR,
          `${archetypeId}.compliance.json`,
        );
        const raw = await readFile(compliancePath, "utf8");
        const trimmed = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
        const parsed = JSON.parse(trimmed) as BenchmarkExpansionComplianceAnnotation;
        assert.equal(
          canonicalJson(parsed),
          trimmed,
          "stored compliance sidecar must be in canonical form",
        );
      });

      test("high-criticality fixtures do not downgrade regulated risk to low", async () => {
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
        const c = loaded.compliance;
        if (c.auditCriticality === "high") {
          assert.notEqual(
            c.regulatedRiskOverride,
            "low",
            `fixture ${archetypeId} marked auditCriticality=high must NOT downgrade regulatedRiskOverride to low`,
          );
        }
      });

      test("adversarial fixtures declare a non-empty adversarialKind", async () => {
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
        if (loaded.adversarial) {
          assert.ok(
            ALLOWED_ADVERSARIAL_KINDS.has(loaded.adversarialKind),
            `adversarialKind "${loaded.adversarialKind}" must be a known kind`,
          );
          assert.notEqual(
            loaded.adversarialKind,
            "",
            `fixture ${archetypeId} marked adversarial=true must declare an adversarialKind`,
          );
        }
      });

      test("contains no raw screenshots and no obvious secrets", async () => {
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
        const candidatePaths: string[] = [
          loaded.figmaPath,
          loaded.summaryPath,
          loaded.compliancePath,
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
        const loaded = await loadBenchmarkExpansionFixture(archetypeId);
        const realisticIbanRegex = /\bDE\d{20}\b/;
        const taxIdRegex = /\b\d{11}\b/;
        const documentationIban = "DE89370400440532013000";
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
            if (
              node.nodePath !== undefined &&
              node.nodePath.endsWith("/iban") &&
              dv !== documentationIban
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
