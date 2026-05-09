/**
 * Deterministic measurement driver for the 15 Eingabemasken fixtures.
 *
 * Mirrors the validation/policy/coverage/traceability pipeline that
 * `baseline-eval.ts` runs against the seven MA-0 baseline archetypes, but
 * applied to the fifteen banking/insurance UI input mask fixtures landed
 * for this task.
 *
 * Run: `npx tsx scripts/measure-eingabemasken.ts`
 *
 * Outputs:
 *   - `sandbox/benchmarks/test-intelligence/scorecards/eingabemasken-K0.md`
 *   - `sandbox/benchmarks/test-intelligence/scorecards/eingabemasken-K0.json`
 *
 * The pipeline is the same deterministic mock that the test suite uses;
 * it does NOT call a real LLM gateway, so cross-modal faithfulness and
 * concrete-data oracles are NOT exercised here. What IS exercised:
 *
 *   - IR derivation (intent-derivation.ts)
 *   - Deterministic test-case synthesis (validation-harness.ts)
 *   - Validation pipeline incl. policy gate (validation-pipeline.ts)
 *   - Coverage + technique-quota report (test-case-coverage.ts, technique-quota.ts)
 *   - Traceability matrix (traceability-matrix.ts)
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCaseAuditMetadata,
} from "../src/contracts/index.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
import {
  EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS,
  EINGABEMASKEN_FIXTURE_DOMAINS,
  EINGABEMASKEN_FIXTURE_TIERS,
  loadEingabemaskenArchetypeFixture,
} from "../src/test-intelligence/eingabemasken-fixtures.js";
import { deriveBusinessTestIntentIr } from "../src/test-intelligence/intent-derivation.js";
import type { ComplianceRiskOverride } from "../src/test-intelligence/policy-gate.js";
import { buildTraceabilityMatrix } from "../src/test-intelligence/traceability-matrix.js";
import { runValidationPipeline } from "../src/test-intelligence/validation-pipeline.js";
import { synthesizeGeneratedTestCases } from "../src/test-intelligence/validation-harness.js";

const REPO_ROOT = join(new URL("..", import.meta.url).pathname);
const OUTPUT_DIR = join(
  REPO_ROOT,
  "sandbox",
  "benchmarks",
  "test-intelligence",
  "scorecards",
);
const GENERATED_AT = "2026-05-09T00:00:00.000Z";

interface FixtureMeasurement {
  archetypeId: string;
  tier: 1 | 2 | 3;
  domain: "banking" | "insurance" | "compliance";
  ir: {
    fields: number;
    actions: number;
    validations: number;
    navigation: number;
    screens: number;
    nodes: number;
  };
  testCases: {
    generated: number;
    positive: number;
    negative: number;
    boundary: number;
  };
  validation: {
    errorCount: number;
    warningCount: number;
    findingCount: number;
    findingsByRule: Record<string, number>;
  };
  policy: {
    blocked: boolean;
    blockingViolations: string[];
    nonBlockingViolations: string[];
  };
  coverage: {
    fieldCoverageRatio: number;
    actionCoverageTotal: number;
    duplicatePairs: number;
  };
  techniqueQuota?: {
    mode: string;
    deficitCount: number;
    deficits: Array<{
      screenId: string;
      technique: string;
      minCount: number;
      actual: number;
      missing: number;
    }>;
  };
  traceability: {
    totalCases: number;
    sourceRefPresenceRate: number;
    intentRefPresenceRate: number;
    visualRefPresenceRate: number;
  };
  pipeline: {
    blocked: boolean;
  };
}

const buildAudit = (jobId: string): GeneratedTestCaseAuditMetadata => ({
  jobId,
  generatedAt: GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: sha256Hex(`${jobId}::cache-key`),
  inputHash: sha256Hex(`${jobId}::input`),
  promptHash: sha256Hex(`${jobId}::prompt`),
  schemaHash: sha256Hex(`${jobId}::schema`),
});

const measureFixture = async (
  archetypeId: (typeof EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS)[number],
  options: { withComplianceOverrides: boolean },
): Promise<FixtureMeasurement> => {
  const fixture = await loadEingabemaskenArchetypeFixture(archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });

  const jobId = `measure-${archetypeId}`;
  const audit = buildAudit(jobId);
  // Issue #2030 follow-up: when enabled, derive a job-wide compliance
  // override from the fixture's `compliance.json` sidecar. Forward to
  // BOTH the synthesizer (so cases ship with the override-derived
  // riskCategory upfront and the policy gate stops emitting downgrade
  // warnings on label-less fields) and the policy gate (so the screen-
  // intent classification falls back to the override when no PII /
  // risks indicator fires).
  const complianceOverrides: ComplianceRiskOverride[] | undefined = options
    .withComplianceOverrides
    ? [
        {
          riskCategory: fixture.compliance.regulatedRiskOverride,
          rationale: `compliance sidecar (${fixture.compliance.complianceRulePackIds.join(", ")})`,
        },
      ]
    : undefined;

  const generatedList = synthesizeGeneratedTestCases({
    jobId,
    generatedAt: GENERATED_AT,
    intent,
    audit,
    ...(complianceOverrides !== undefined ? { complianceOverrides } : {}),
  });

  const pipeline = runValidationPipeline({
    jobId,
    generatedAt: GENERATED_AT,
    list: generatedList,
    intent,
    ...(complianceOverrides !== undefined ? { complianceOverrides } : {}),
  });

  const traceability = buildTraceabilityMatrix({
    jobId,
    generatedAt: GENERATED_AT,
    intent,
    list: pipeline.generatedTestCases,
    validation: pipeline.validation,
    policy: pipeline.policy,
  });

  const findingsByRule: Record<string, number> = {};
  for (const issue of pipeline.validation.issues) {
    const rule = issue.code ?? "<unknown>";
    findingsByRule[rule] = (findingsByRule[rule] ?? 0) + 1;
  }

  const blockingViolations: string[] = [];
  const nonBlockingViolations: string[] = [];
  const allViolations = [
    ...pipeline.policy.jobLevelViolations,
    ...pipeline.policy.decisions.flatMap((d) => d.violations),
  ];
  for (const violation of allViolations) {
    if (violation.severity === "error") {
      blockingViolations.push(violation.rule);
    } else {
      nonBlockingViolations.push(violation.rule);
    }
  }

  const traceabilityRows = traceability.rows;
  const totalCases = traceabilityRows.length;
  const casesWithSourceRefs = pipeline.generatedTestCases.testCases.filter(
    (tc) => tc.figmaTraceRefs.length > 0,
  ).length;
  const casesWithIntentRefs = traceabilityRows.filter(
    (row) =>
      row.intentFieldIds.length +
        row.intentActionIds.length +
        row.intentValidationIds.length +
        row.intentNavigationIds.length >
      0,
  ).length;
  const casesWithVisualRefs = traceabilityRows.filter(
    (row) => row.visualObservations.length > 0,
  ).length;
  const presenceRate = (n: number): number =>
    totalCases === 0 ? 0 : Math.round((n / totalCases) * 1_000_000) / 1_000_000;

  const measurement: FixtureMeasurement = {
    archetypeId,
    tier: EINGABEMASKEN_FIXTURE_TIERS[archetypeId],
    domain: EINGABEMASKEN_FIXTURE_DOMAINS[archetypeId],
    ir: {
      fields: intent.detectedFields.length,
      actions: intent.detectedActions.length,
      validations: intent.detectedValidations.length,
      navigation: intent.detectedNavigation.length,
      screens: fixture.figma.screens.length,
      nodes: fixture.figma.screens.reduce(
        (acc, s) => acc + s.nodes.length,
        0,
      ),
    },
    testCases: {
      generated: pipeline.generatedTestCases.testCases.length,
      positive: pipeline.coverage.positiveCaseCount,
      negative: pipeline.coverage.negativeCaseCount,
      boundary: pipeline.coverage.boundaryCaseCount,
    },
    validation: {
      errorCount: pipeline.validation.errorCount,
      warningCount: pipeline.validation.warningCount,
      findingCount: pipeline.validation.issues.length,
      findingsByRule,
    },
    policy: {
      blocked: pipeline.policy.blocked,
      blockingViolations,
      nonBlockingViolations,
    },
    coverage: {
      fieldCoverageRatio:
        pipeline.coverage.fieldCoverage?.ratio ?? 0,
      actionCoverageTotal:
        pipeline.coverage.actionCoverage?.total ?? 0,
      duplicatePairs: pipeline.coverage.duplicatePairs.length,
    },
    traceability: {
      totalCases,
      sourceRefPresenceRate: presenceRate(casesWithSourceRefs),
      intentRefPresenceRate: presenceRate(casesWithIntentRefs),
      visualRefPresenceRate: presenceRate(casesWithVisualRefs),
    },
    pipeline: {
      blocked: pipeline.blocked,
    },
  };

  if (pipeline.techniqueQuota !== undefined) {
    measurement.techniqueQuota = {
      mode: pipeline.techniqueQuota.mode,
      deficitCount: pipeline.techniqueQuota.deficits.length,
      deficits: pipeline.techniqueQuota.deficits.map((d) => ({
        screenId: d.screenId,
        technique: d.technique,
        minCount: d.minCount,
        actual: d.actual,
        missing: d.missing,
      })),
    };
  }

  return measurement;
};

const renderMarkdown = (
  measurements: ReadonlyArray<FixtureMeasurement>,
): string => {
  const lines: string[] = [];
  lines.push("# Eingabemasken K0 Scorecard");
  lines.push("");
  lines.push(`**Generated**: ${GENERATED_AT}`);
  lines.push(`**Methodology**: deterministic mock pipeline (no LLM gateway).`);
  lines.push("");
  lines.push("## Per-fixture summary");
  lines.push("");
  lines.push(
    "| Tier | Fixture | Cases | Pos/Neg/Bnd | Field-Cov | Action-Cov | ValErrors | Pipeline Blocked | Blocking Policies |",
  );
  lines.push(
    "|---:|---|---:|---|---:|---:|---:|---:|---|",
  );
  for (const m of measurements) {
    const blocked = m.pipeline.blocked ? "**YES**" : "no";
    const blockingPolicies =
      m.policy.blockingViolations.length === 0
        ? "—"
        : m.policy.blockingViolations.join(", ");
    lines.push(
      `| ${m.tier} | \`${m.archetypeId.replace("eingabemaske-", "")}\` | ${m.testCases.generated} | ${m.testCases.positive}/${m.testCases.negative}/${m.testCases.boundary} | ${m.coverage.fieldCoverageRatio.toFixed(3)} | ${m.coverage.actionCoverageTotal} | ${m.validation.errorCount} | ${blocked} | ${blockingPolicies} |`,
    );
  }

  lines.push("");
  lines.push("## Aggregated metrics");
  lines.push("");
  const blockedCount = measurements.filter((m) => m.pipeline.blocked).length;
  const validationErrorTotal = measurements.reduce(
    (acc, m) => acc + m.validation.errorCount,
    0,
  );
  const policyBlockedCount = measurements.filter(
    (m) => m.policy.blocked,
  ).length;
  const techniqueQuotaWithDeficits = measurements.filter(
    (m) =>
      m.techniqueQuota !== undefined && m.techniqueQuota.deficitCount > 0,
  ).length;
  lines.push(`- Total fixtures: **${measurements.length}**`);
  lines.push(`- Pipeline blocked: **${blockedCount} / ${measurements.length}**`);
  lines.push(
    `- Policy gate blocked: **${policyBlockedCount} / ${measurements.length}**`,
  );
  lines.push(`- Validation errors total: **${validationErrorTotal}**`);
  lines.push(
    `- Fixtures with technique-quota deficits: **${techniqueQuotaWithDeficits} / ${measurements.length}**`,
  );

  lines.push("");
  lines.push("## Validation findings by rule (top 20)");
  lines.push("");
  const ruleHits = new Map<string, number>();
  for (const m of measurements) {
    for (const [rule, count] of Object.entries(m.validation.findingsByRule)) {
      ruleHits.set(rule, (ruleHits.get(rule) ?? 0) + count);
    }
  }
  const ruleHitsSorted = [...ruleHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (ruleHitsSorted.length === 0) {
    lines.push("(no validation findings)");
  } else {
    lines.push("| Rule | Total occurrences |");
    lines.push("|---|---:|");
    for (const [rule, count] of ruleHitsSorted) {
      lines.push(`| \`${rule}\` | ${count} |`);
    }
  }

  lines.push("");
  lines.push("## Policy violations (all)");
  lines.push("");
  const policyHits = new Map<string, { error: number; warning: number }>();
  for (const m of measurements) {
    for (const v of m.policy.blockingViolations) {
      const cur = policyHits.get(v) ?? { error: 0, warning: 0 };
      cur.error += 1;
      policyHits.set(v, cur);
    }
    for (const v of m.policy.nonBlockingViolations) {
      const cur = policyHits.get(v) ?? { error: 0, warning: 0 };
      cur.warning += 1;
      policyHits.set(v, cur);
    }
  }
  if (policyHits.size === 0) {
    lines.push("(no policy violations across the suite)");
  } else {
    lines.push("| Rule | Errors | Warnings |");
    lines.push("|---|---:|---:|");
    const sorted = [...policyHits.entries()].sort(
      (a, b) => b[1].error + b[1].warning - (a[1].error + a[1].warning),
    );
    for (const [rule, counts] of sorted) {
      lines.push(`| \`${rule}\` | ${counts.error} | ${counts.warning} |`);
    }
  }

  lines.push("");
  lines.push("## Technique-quota deficits");
  lines.push("");
  const tqRows = measurements.flatMap((m) =>
    m.techniqueQuota === undefined
      ? []
      : m.techniqueQuota.deficits.map((d) => ({
          archetypeId: m.archetypeId,
          tier: m.tier,
          ...d,
        })),
  );
  if (tqRows.length === 0) {
    lines.push("(no deficits across the suite)");
  } else {
    lines.push("| Tier | Fixture | Screen | Technique | Min | Actual | Missing |");
    lines.push("|---:|---|---|---|---:|---:|---:|");
    for (const r of tqRows) {
      lines.push(
        `| ${r.tier} | \`${r.archetypeId.replace("eingabemaske-", "")}\` | \`${r.screenId}\` | ${r.technique} | ${r.minCount} | ${r.actual} | ${r.missing} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Traceability presence rates");
  lines.push("");
  lines.push(
    "| Tier | Fixture | Cases | Source-Ref | Intent-Ref | Visual-Ref |",
  );
  lines.push("|---:|---|---:|---:|---:|---:|");
  for (const m of measurements) {
    lines.push(
      `| ${m.tier} | \`${m.archetypeId.replace("eingabemaske-", "")}\` | ${m.traceability.totalCases} | ${m.traceability.sourceRefPresenceRate.toFixed(3)} | ${m.traceability.intentRefPresenceRate.toFixed(3)} | ${m.traceability.visualRefPresenceRate.toFixed(3)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
};

const aggregateWarnings = (
  measurements: ReadonlyArray<FixtureMeasurement>,
): { regRisk: number; downgrade: number; duplicate: number } => {
  let regRisk = 0;
  let downgrade = 0;
  let duplicate = 0;
  for (const m of measurements) {
    for (const v of m.policy.nonBlockingViolations) {
      if (v === "policy:regulated-risk-requires-review") regRisk += 1;
      else if (v === "policy:risk-tag-downgrade-detected") downgrade += 1;
      else if (v === "policy:duplicate-test-case") duplicate += 1;
    }
  }
  return { regRisk, downgrade, duplicate };
};

const renderRunComparison = (
  k0: ReadonlyArray<FixtureMeasurement>,
  k1: ReadonlyArray<FixtureMeasurement>,
): string => {
  const k0Agg = aggregateWarnings(k0);
  const k1Agg = aggregateWarnings(k1);
  const lines: string[] = [];
  lines.push("## K0 (no overrides) vs K1 (compliance-sidecar overrides) summary");
  lines.push("");
  lines.push("| Metric | K0 | K1 | Delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| policy:regulated-risk-requires-review (warnings) | ${k0Agg.regRisk} | ${k1Agg.regRisk} | ${k1Agg.regRisk - k0Agg.regRisk >= 0 ? "+" : ""}${k1Agg.regRisk - k0Agg.regRisk} |`);
  lines.push(`| policy:risk-tag-downgrade-detected (warnings) | ${k0Agg.downgrade} | ${k1Agg.downgrade} | ${k1Agg.downgrade - k0Agg.downgrade >= 0 ? "+" : ""}${k1Agg.downgrade - k0Agg.downgrade} |`);
  lines.push(`| policy:duplicate-test-case (warnings) | ${k0Agg.duplicate} | ${k1Agg.duplicate} | ${k1Agg.duplicate - k0Agg.duplicate >= 0 ? "+" : ""}${k1Agg.duplicate - k0Agg.duplicate} |`);

  lines.push("");
  lines.push("### Per-fixture reg-risk warnings (K0 -> K1)");
  lines.push("");
  lines.push("| Tier | Fixture | K0 reg-risk | K1 reg-risk | K0 downgrade | K1 downgrade |");
  lines.push("|---:|---|---:|---:|---:|---:|");
  for (let i = 0; i < k0.length; i += 1) {
    const a = k0[i]!;
    const b = k1[i]!;
    const ar = a.policy.nonBlockingViolations.filter((v) => v === "policy:regulated-risk-requires-review").length;
    const br = b.policy.nonBlockingViolations.filter((v) => v === "policy:regulated-risk-requires-review").length;
    const ad = a.policy.nonBlockingViolations.filter((v) => v === "policy:risk-tag-downgrade-detected").length;
    const bd = b.policy.nonBlockingViolations.filter((v) => v === "policy:risk-tag-downgrade-detected").length;
    lines.push(
      `| ${a.tier} | \`${a.archetypeId.replace("eingabemaske-", "")}\` | ${ar} | ${br} | ${ad} | ${bd} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const main = async (): Promise<void> => {
  const k0Measurements: FixtureMeasurement[] = [];
  for (const id of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
    k0Measurements.push(
      await measureFixture(id, { withComplianceOverrides: false }),
    );
  }
  const k1Measurements: FixtureMeasurement[] = [];
  for (const id of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
    k1Measurements.push(
      await measureFixture(id, { withComplianceOverrides: true }),
    );
  }

  const k0Markdown = renderMarkdown(k0Measurements);
  const k1Markdown = renderMarkdown(k1Measurements);
  const comparison = renderRunComparison(k0Measurements, k1Measurements);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const k0MdPath = join(OUTPUT_DIR, "eingabemasken-K0.md");
  const k0JsonPath = join(OUTPUT_DIR, "eingabemasken-K0.json");
  const k1MdPath = join(OUTPUT_DIR, "eingabemasken-K1.md");
  const k1JsonPath = join(OUTPUT_DIR, "eingabemasken-K1.json");
  const cmpPath = join(OUTPUT_DIR, "eingabemasken-K0-vs-K1.md");
  await writeFile(k0MdPath, k0Markdown, "utf8");
  await writeFile(
    k0JsonPath,
    JSON.stringify(k0Measurements, null, 2),
    "utf8",
  );
  await writeFile(k1MdPath, k1Markdown, "utf8");
  await writeFile(
    k1JsonPath,
    JSON.stringify(k1Measurements, null, 2),
    "utf8",
  );
  await writeFile(cmpPath, comparison, "utf8");

  // eslint-disable-next-line no-console
  console.log(comparison);
  // eslint-disable-next-line no-console
  console.log(
    `\n--- artifacts ---\n${k0MdPath}\n${k0JsonPath}\n${k1MdPath}\n${k1JsonPath}\n${cmpPath}`,
  );
};

await main();
