/**
 * Carbon-footprint estimator tests (Issue #2129).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  CARBON_FOOTPRINT_AGGREGATE_SCHEMA_VERSION,
  CARBON_FOOTPRINT_ARTIFACT_DIRECTORY,
  CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER,
  CARBON_FOOTPRINT_REPORT_ARTIFACT_FILENAME,
  CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION,
  CarbonFootprintError,
  ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
  GRID_CARBON_INTENSITY_MAX_AGE_DAYS,
  GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION,
  REFERENCE_ENERGY_COEFFICIENT_TABLE,
  REFERENCE_GRID_CARBON_INTENSITY_TABLE,
  aggregateCarbonFootprint,
  assertGridCarbonIntensityTableFresh,
  buildCarbonFootprintReport,
  carbonRoleUsageFromFinOpsRoles,
  computeCarbonFootprintReportDigest,
  computeGridCarbonIntensityTableAgeDays,
  pickDominantCarbonRegion,
  rankCandidatesByCarbon,
  requireEnergyCoefficient,
  requireGridCarbonIntensity,
  validateEnergyCoefficientTable,
  validateGridCarbonIntensityTable,
  writeCarbonFootprintReport,
  type CarbonFootprintReport,
  type EnergyCoefficientTable,
  type GridCarbonIntensityTable,
} from "./carbon-footprint.js";
import { SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS } from "../contracts/index.js";

const FIXED_NOW = "2026-05-11T00:00:00Z";

const REGION_TABLE: GridCarbonIntensityTable = {
  schemaVersion: GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION,
  refreshedAt: "2026-05-01T00:00:00Z",
  provenance: "azure-emissions-impact-dashboard-2026-04",
  entries: [
    {
      region: "francecentral",
      gCo2ePerKwh: 53,
      citation:
        "Ember Climate 2024 — France grid intensity (12-month rolling).",
      observedAt: "2026-04-30",
    },
    {
      region: "northeurope",
      gCo2ePerKwh: 234,
      citation:
        "IEA Electricity 2024 — Ireland grid intensity (12-month rolling).",
      observedAt: "2026-04-30",
    },
    {
      region: "swedencentral",
      gCo2ePerKwh: 12,
      citation: "Ember Climate 2024 — Sweden grid intensity.",
      observedAt: "2026-04-30",
    },
    {
      region: "westeurope",
      gCo2ePerKwh: 287,
      citation:
        "Ember Climate 2024 — Netherlands grid intensity (12-month rolling).",
      observedAt: "2026-04-30",
    },
  ],
};

const BUILD_INPUT = {
  jobId: "job-2129-smoke",
  customerId: "acme-bank",
  generatedAt: FIXED_NOW,
  region: "westeurope",
  roles: [
    {
      role: "test_generation",
      deployment: "azure-openai-gpt-4o",
      inputTokens: 12_500,
      outputTokens: 4_300,
      attempts: 3,
    },
    {
      role: "visual_primary",
      deployment: "anthropic-claude-3-7-sonnet",
      inputTokens: 8_000,
      outputTokens: 2_100,
      attempts: 2,
    },
  ],
  energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
  gridIntensity: REGION_TABLE,
} as const;

describe("carbon-footprint: published table integrity", () => {
  test("reference table passes its own validator", () => {
    validateEnergyCoefficientTable(REFERENCE_ENERGY_COEFFICIENT_TABLE);
  });

  test("reference table cites a source for every entry", () => {
    for (const entry of REFERENCE_ENERGY_COEFFICIENT_TABLE.entries) {
      assert.ok(
        entry.citation.length > 0,
        `${entry.deployment} missing citation`,
      );
      assert.ok(
        entry.origin === "estimated" ||
          entry.origin === "published_paper" ||
          entry.origin === "vendor_disclosure",
      );
    }
  });

  test("schema versions are stable constants", () => {
    assert.equal(CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION, "1.0.0");
    assert.equal(ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION, "1.0.0");
    assert.equal(GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION, "1.0.0");
    assert.equal(CARBON_FOOTPRINT_AGGREGATE_SCHEMA_VERSION, "1.0.0");
  });
});

describe("carbon-footprint: validators", () => {
  test("validateEnergyCoefficientTable rejects unknown origin", () => {
    const bad: EnergyCoefficientTable = {
      schemaVersion: ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
      publishedAt: "2026-05-11",
      entries: [
        {
          deployment: "x",
          inputKwhPerMillionTokens: 1,
          outputKwhPerMillionTokens: 1,
          fixedKwhPerAttempt: 0,
          citation: "test",
          origin:
            "guess" as unknown as EnergyCoefficientTable["entries"][number]["origin"],
        },
      ],
    };
    assert.throws(
      () => validateEnergyCoefficientTable(bad),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "energy_coefficient_table_invalid",
    );
  });

  test("validateEnergyCoefficientTable rejects negative coefficient", () => {
    const bad: EnergyCoefficientTable = {
      schemaVersion: ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
      publishedAt: "2026-05-11",
      entries: [
        {
          deployment: "x",
          inputKwhPerMillionTokens: -1,
          outputKwhPerMillionTokens: 1,
          fixedKwhPerAttempt: 0,
          citation: "test",
          origin: "estimated",
        },
      ],
    };
    assert.throws(
      () => validateEnergyCoefficientTable(bad),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "energy_coefficient_table_invalid",
    );
  });

  test("validateEnergyCoefficientTable rejects duplicate deployment", () => {
    const bad: EnergyCoefficientTable = {
      schemaVersion: ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
      publishedAt: "2026-05-11",
      entries: [
        {
          deployment: "x",
          inputKwhPerMillionTokens: 1,
          outputKwhPerMillionTokens: 1,
          fixedKwhPerAttempt: 0,
          citation: "test",
          origin: "estimated",
        },
        {
          deployment: "x",
          inputKwhPerMillionTokens: 1,
          outputKwhPerMillionTokens: 1,
          fixedKwhPerAttempt: 0,
          citation: "test",
          origin: "estimated",
        },
      ],
    };
    assert.throws(
      () => validateEnergyCoefficientTable(bad),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "energy_coefficient_table_invalid",
    );
  });

  test("validateGridCarbonIntensityTable accepts our fixture", () => {
    validateGridCarbonIntensityTable(REGION_TABLE);
  });

  test("requireEnergyCoefficient throws on unknown deployment", () => {
    assert.throws(
      () =>
        requireEnergyCoefficient(REFERENCE_ENERGY_COEFFICIENT_TABLE, "unknown"),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "energy_coefficient_unknown_deployment",
    );
  });

  test("requireGridCarbonIntensity throws on unknown region", () => {
    assert.throws(
      () => requireGridCarbonIntensity(REGION_TABLE, "atlantis"),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "grid_intensity_unknown_region",
    );
  });
});

describe("carbon-footprint: freshness ceiling", () => {
  test("age in days is computed correctly", () => {
    const days = computeGridCarbonIntensityTableAgeDays(
      { ...REGION_TABLE, refreshedAt: "2026-04-01T00:00:00Z" },
      "2026-05-01T00:00:00Z",
    );
    assert.equal(days, 30);
  });

  test("assertGridCarbonIntensityTableFresh passes within the window", () => {
    assertGridCarbonIntensityTableFresh(REGION_TABLE, FIXED_NOW);
  });

  test("assertGridCarbonIntensityTableFresh rejects > 35 days", () => {
    const stale: GridCarbonIntensityTable = {
      ...REGION_TABLE,
      refreshedAt: "2026-01-01T00:00:00Z",
    };
    assert.throws(
      () => assertGridCarbonIntensityTableFresh(stale, FIXED_NOW),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "grid_intensity_table_stale",
    );
  });

  test("max-age constant matches AC monthly cadence (~35d)", () => {
    assert.equal(GRID_CARBON_INTENSITY_MAX_AGE_DAYS, 35);
  });
});

describe("carbon-footprint: buildCarbonFootprintReport", () => {
  const report = buildCarbonFootprintReport(BUILD_INPUT);

  test("stamps schemaVersion and methodology disclaimer", () => {
    assert.equal(report.schemaVersion, CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION);
    assert.equal(
      report.methodology.disclaimer,
      CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER,
    );
  });

  test("carries energyKwh and co2eGrams on the manifest", () => {
    assert.ok(report.energyKwh > 0);
    assert.ok(report.co2eGrams > 0);
    assert.ok(
      report.energyKwh < 1,
      "energy should be sub-kWh on smoke fixture",
    );
  });

  test("energyKwh equals the sum of per-role energy", () => {
    const sum = report.perRole.reduce((acc, line) => acc + line.energyKwh, 0);
    assert.ok(Math.abs(report.energyKwh - sum) < 1e-9);
  });

  test("co2eGrams equals energyKwh × region intensity to ≤1e-3 g", () => {
    const expected = report.perRole.reduce(
      (acc, line) => acc + line.co2eGrams,
      0,
    );
    assert.ok(Math.abs(report.co2eGrams - expected) < 1e-9);
    const intensity = report.methodology.gridIntensityGCo2ePerKwh;
    const reCheck = report.perRole.reduce(
      (acc, line) => acc + line.energyKwh * intensity,
      0,
    );
    assert.ok(Math.abs(reCheck - report.co2eGrams) < 1e-3);
  });

  test("per-role lines are sorted by role for byte-stable hashing", () => {
    const roles = report.perRole.map((line) => line.role);
    const sorted = [...roles].sort();
    assert.deepEqual(roles, sorted);
  });

  test("type-level invariants are stamped false", () => {
    assert.equal(report.secretsIncluded, false);
    assert.equal(report.rawPromptsIncluded, false);
  });

  test("methodology pins the cited grid intensity row", () => {
    assert.equal(report.methodology.gridIntensityGCo2ePerKwh, 287);
    assert.match(
      report.methodology.gridIntensityCitation,
      /Netherlands grid intensity/,
    );
    assert.equal(report.methodology.gridIntensityObservedAt, "2026-04-30");
  });

  test("identical inputs produce byte-identical reports", () => {
    const second = buildCarbonFootprintReport(BUILD_INPUT);
    assert.equal(
      computeCarbonFootprintReportDigest(report),
      computeCarbonFootprintReportDigest(second),
    );
  });

  test("zero-token job produces a zero-footprint report (no NaN)", () => {
    const zero = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      roles: [
        {
          role: "test_generation",
          deployment: "gpt-oss-120b-mock",
          inputTokens: 0,
          outputTokens: 0,
          attempts: 0,
        },
      ],
    });
    assert.equal(zero.energyKwh, 0);
    assert.equal(zero.co2eGrams, 0);
  });

  test("rejects unknown deployment with clear error", () => {
    assert.throws(
      () =>
        buildCarbonFootprintReport({
          ...BUILD_INPUT,
          roles: [
            {
              role: "test_generation",
              deployment: "not-a-real-deployment",
              inputTokens: 1,
              outputTokens: 1,
              attempts: 1,
            },
          ],
        }),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "energy_coefficient_unknown_deployment",
    );
  });

  test("rejects duplicate role entry", () => {
    assert.throws(
      () =>
        buildCarbonFootprintReport({
          ...BUILD_INPUT,
          roles: [
            {
              role: "test_generation",
              deployment: "gpt-oss-120b-mock",
              inputTokens: 0,
              outputTokens: 0,
              attempts: 0,
            },
            {
              role: "test_generation",
              deployment: "gpt-oss-120b-mock",
              inputTokens: 0,
              outputTokens: 0,
              attempts: 0,
            },
          ],
        }),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "role_usage_invalid",
    );
  });

  test("rejects negative token counts", () => {
    assert.throws(
      () =>
        buildCarbonFootprintReport({
          ...BUILD_INPUT,
          roles: [
            {
              role: "test_generation",
              deployment: "gpt-oss-120b-mock",
              inputTokens: -1,
              outputTokens: 0,
              attempts: 0,
            },
          ],
        }),
      (err: unknown) =>
        err instanceof CarbonFootprintError &&
        err.code === "role_usage_invalid",
    );
  });

  test("low-carbon region produces lower co2eGrams than coal-heavy region", () => {
    const lowCarbon = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      region: "swedencentral",
    });
    assert.ok(
      lowCarbon.co2eGrams < report.co2eGrams,
      "Sweden grid (12g/kWh) must produce lower CO2e than Netherlands (287g/kWh)",
    );
    assert.ok(
      Math.abs(lowCarbon.energyKwh - report.energyKwh) < 1e-9,
      "energy is region-agnostic",
    );
  });
});

describe("carbon-footprint: writeCarbonFootprintReport", () => {
  test("writes the artifact under <runDir>/carbon/", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "carbon-2129-"));
    const report = buildCarbonFootprintReport(BUILD_INPUT);
    const result = await writeCarbonFootprintReport({ report, runDir });
    assert.equal(
      result.artifactPath,
      join(
        runDir,
        CARBON_FOOTPRINT_ARTIFACT_DIRECTORY,
        CARBON_FOOTPRINT_REPORT_ARTIFACT_FILENAME,
      ),
    );
    const persisted = JSON.parse(
      await readFile(result.artifactPath, "utf8"),
    ) as CarbonFootprintReport;
    assert.equal(persisted.energyKwh, report.energyKwh);
    assert.equal(persisted.co2eGrams, report.co2eGrams);
    assert.equal(persisted.secretsIncluded, false);
    assert.equal(persisted.rawPromptsIncluded, false);
  });
});

describe("carbon-footprint: aggregateCarbonFootprint", () => {
  test("groups by (customerId, month) and totals", () => {
    const base = buildCarbonFootprintReport(BUILD_INPUT);
    const second = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      jobId: "job-2129-second",
      generatedAt: "2026-05-12T00:00:00Z",
      customerId: "acme-bank",
    });
    const third = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      jobId: "job-2129-other-customer",
      customerId: "globex-insurance",
      generatedAt: "2026-05-09T00:00:00Z",
    });
    const aggregate = aggregateCarbonFootprint({
      reports: [base, second, third],
      generatedAt: FIXED_NOW,
    });
    assert.equal(aggregate.rows.length, 2);
    const acme = aggregate.rows.find((row) => row.customerId === "acme-bank");
    assert.ok(acme !== undefined);
    assert.equal(acme.month, "2026-05");
    assert.equal(acme.jobCount, 2);
    assert.ok(acme.energyKwh > 0);
    const globex = aggregate.rows.find(
      (row) => row.customerId === "globex-insurance",
    );
    assert.ok(globex !== undefined);
    assert.equal(globex.jobCount, 1);
    assert.equal(aggregate.totals.jobCount, 3);
    assert.ok(
      Math.abs(
        aggregate.totals.energyKwh - (acme.energyKwh + globex.energyKwh),
      ) < 1e-9,
    );
  });

  test("rows are sorted by (customerId, month)", () => {
    const base = buildCarbonFootprintReport(BUILD_INPUT);
    const other = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      customerId: "zeta-bank",
      generatedAt: "2026-05-02T00:00:00Z",
    });
    const out = aggregateCarbonFootprint({
      reports: [other, base],
      generatedAt: FIXED_NOW,
    });
    assert.deepEqual(
      out.rows.map((row) => row.customerId),
      ["acme-bank", "zeta-bank"],
    );
  });

  test("unattributed bucket appears when customerId is omitted", () => {
    const noCustomer = buildCarbonFootprintReport({
      ...BUILD_INPUT,
      customerId: undefined,
    });
    const out = aggregateCarbonFootprint({
      reports: [noCustomer],
      generatedAt: FIXED_NOW,
    });
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0]?.customerId, "unattributed");
  });
});

describe("carbon-footprint: rankCandidatesByCarbon (routing optimizer hook)", () => {
  test("ranks low-carbon regions first", () => {
    const ranked = rankCandidatesByCarbon({
      candidates: [
        { deployment: "azure-openai-gpt-4o", region: "westeurope" },
        { deployment: "azure-openai-gpt-4o", region: "swedencentral" },
        { deployment: "azure-openai-gpt-4o", region: "francecentral" },
      ],
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REGION_TABLE,
    });
    assert.deepEqual(
      ranked.ranked.map((entry) => entry.region),
      ["swedencentral", "francecentral", "westeurope"],
    );
    assert.equal(ranked.skipped.length, 0);
  });

  test("smaller models beat larger ones on the same region", () => {
    const ranked = rankCandidatesByCarbon({
      candidates: [
        { deployment: "azure-openai-gpt-4o", region: "westeurope" },
        { deployment: "azure-openai-gpt-4o-mini", region: "westeurope" },
        { deployment: "anthropic-claude-3-7-opus", region: "westeurope" },
      ],
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REGION_TABLE,
    });
    assert.equal(ranked.ranked[0]?.deployment, "azure-openai-gpt-4o-mini");
  });

  test("unknown deployment / region surfaces in `skipped`", () => {
    const ranked = rankCandidatesByCarbon({
      candidates: [
        { deployment: "ghost-deployment", region: "westeurope" },
        { deployment: "azure-openai-gpt-4o", region: "atlantis" },
        { deployment: "azure-openai-gpt-4o", region: "westeurope" },
      ],
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REGION_TABLE,
    });
    assert.equal(ranked.ranked.length, 1);
    assert.equal(ranked.skipped.length, 2);
    const reasons = new Set(ranked.skipped.map((s) => s.reason));
    assert.ok(reasons.has("energy_coefficient_unknown_deployment"));
    assert.ok(reasons.has("grid_intensity_unknown_region"));
  });

  test("higher weight wins on a CO2e tie", () => {
    const tieBreaker = rankCandidatesByCarbon({
      candidates: [
        { deployment: "gpt-oss-120b-mock", region: "swedencentral", weight: 1 },
        { deployment: "gpt-oss-120b-mock", region: "francecentral", weight: 5 },
      ],
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REGION_TABLE,
    });
    // Mock has zero coefficient → both candidates project zero CO2e/1k;
    // tie-break should prefer the higher weight first.
    assert.equal(tieBreaker.ranked[0]?.region, "francecentral");
    assert.equal(tieBreaker.ranked[0]?.weight, 5);
  });

  test("custom input/output mix changes the ranking signal", () => {
    const outputHeavy = rankCandidatesByCarbon({
      candidates: [
        { deployment: "azure-openai-gpt-4o", region: "westeurope" },
        { deployment: "azure-openai-gpt-4o-mini", region: "westeurope" },
      ],
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REGION_TABLE,
      inputOutputMix: { inputShare: 0.1, outputShare: 0.9 },
    });
    // Output-heavy mix should still favor mini (smaller output coefficient).
    assert.equal(outputHeavy.ranked[0]?.deployment, "azure-openai-gpt-4o-mini");
  });
});

describe("carbon-footprint: production-runner wiring (Issue #2129 Wave B.3)", () => {
  test("REFERENCE_GRID_CARBON_INTENSITY_TABLE passes the standard validator", () => {
    validateGridCarbonIntensityTable(REFERENCE_GRID_CARBON_INTENSITY_TABLE);
  });

  test("REFERENCE_GRID_CARBON_INTENSITY_TABLE covers every region admitted by SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS", () => {
    const covered = new Set(
      REFERENCE_GRID_CARBON_INTENSITY_TABLE.entries.map(
        (entry) => entry.region,
      ),
    );
    for (const region of SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS) {
      assert.ok(
        covered.has(region),
        `region "${region}" is admitted by the attestation contract but missing from REFERENCE_GRID_CARBON_INTENSITY_TABLE`,
      );
    }
  });

  test("REFERENCE_GRID_CARBON_INTENSITY_TABLE also covers the legacy Azure-style aliases", () => {
    const covered = new Set(
      REFERENCE_GRID_CARBON_INTENSITY_TABLE.entries.map(
        (entry) => entry.region,
      ),
    );
    for (const region of [
      "francecentral",
      "germanywestcentral",
      "northeurope",
      "swedencentral",
      "westeurope",
    ]) {
      assert.ok(
        covered.has(region),
        `legacy alias "${region}" missing from REFERENCE_GRID_CARBON_INTENSITY_TABLE`,
      );
    }
  });

  test("carbonRoleUsageFromFinOpsRoles drops rows with no deployment label and rows with zero attempts", () => {
    const reduced = carbonRoleUsageFromFinOpsRoles([
      // Active row.
      {
        role: "test_generation",
        deployment: "azure-openai-gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        attempts: 2,
      },
      // Cache-hit-only role: no deployment observed.
      {
        role: "judge_primary",
        deployment: "",
        inputTokens: 0,
        outputTokens: 0,
        attempts: 0,
      },
      // Configured but skipped role: deployment recorded but zero attempts.
      {
        role: "visual_primary",
        deployment: "anthropic-claude-3-7-sonnet",
        inputTokens: 0,
        outputTokens: 0,
        attempts: 0,
      },
    ]);
    assert.equal(reduced.length, 1);
    assert.equal(reduced[0]?.role, "test_generation");
    assert.equal(reduced[0]?.deployment, "azure-openai-gpt-4o");
  });

  test("pickDominantCarbonRegion picks the most-frequent region and ties break alphabetically", () => {
    assert.equal(
      pickDominantCarbonRegion([
        { region: "eu-west-1" },
        { region: "eu-central-1" },
        { region: "eu-west-1" },
      ]),
      "eu-west-1",
    );
    // Tie between eu-central-1 and eu-west-1 → alphabetical wins.
    assert.equal(
      pickDominantCarbonRegion([
        { region: "eu-west-1" },
        { region: "eu-central-1" },
      ]),
      "eu-central-1",
    );
    // Empty observation set returns undefined so the wiring can skip
    // silently.
    assert.equal(pickDominantCarbonRegion([]), undefined);
    // Empty region strings are ignored.
    assert.equal(
      pickDominantCarbonRegion([{ region: "" }, { region: "" }]),
      undefined,
    );
  });

  test("buildCarbonFootprintReport works end-to-end with the baked-in reference tables", () => {
    const report = buildCarbonFootprintReport({
      jobId: "job-wave-b3-smoke",
      generatedAt: "2026-05-11T00:00:00Z",
      region: "eu-central-1",
      roles: carbonRoleUsageFromFinOpsRoles([
        {
          role: "test_generation",
          deployment: "azure-openai-gpt-4o",
          inputTokens: 12_500,
          outputTokens: 4_300,
          attempts: 3,
        },
      ]),
      energyCoefficients: REFERENCE_ENERGY_COEFFICIENT_TABLE,
      gridIntensity: REFERENCE_GRID_CARBON_INTENSITY_TABLE,
    });
    assert.equal(report.region, "eu-central-1");
    assert.equal(report.perRole.length, 1);
    assert.equal(report.perRole[0]?.role, "test_generation");
    // Energy = (12500/1e6)*0.29 + (4300/1e6)*1.16 + 3*0.0000015
    // ≈ 0.00362 + 0.004988 + 0.0000045 ≈ 0.00861 kWh
    assert.ok(report.energyKwh > 0.008 && report.energyKwh < 0.009);
    // CO2e at 366 g/kWh ≈ 3.15 g
    assert.ok(report.co2eGrams > 3 && report.co2eGrams < 3.3);
    assert.equal(
      report.methodology.gridIntensityProvenance,
      "iea-ember-public-baseline-2024",
    );
  });
});
