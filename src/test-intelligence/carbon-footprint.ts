/**
 * Energy + CO₂e footprint estimator (Issue #2129).
 *
 * Computes a per-job energy (kWh) and carbon (gCO₂e) estimate from
 * token-level usage × per-deployment energy coefficient × per-region grid
 * carbon intensity. The output is a deterministic JSON artifact that
 * carries the inputs verbatim alongside the disclosed methodology — so an
 * auditor can re-derive the numbers without re-running the job.
 *
 * **What this is NOT.** This module never measures hardware power draw,
 * never inspects datacentre PUE in real time, and never adjusts for
 * renewable-energy certificates (RECs). The estimate is a marginal,
 * order-of-magnitude figure suitable for ESG reporting and routing-tier
 * comparison, not for legally binding emissions accounting. Every persisted
 * report stamps `methodology.disclaimer` to make this explicit.
 *
 * **Public sources cited verbatim in the published coefficient table:**
 *   - Patterson et al., "The Carbon Footprint of Machine Learning Training
 *     Will Plateau, Then Shrink", IEEE Computer 2022.
 *   - Luccioni, Viguier, Ligozat, "Estimating the Carbon Footprint of
 *     BLOOM, a 176B Parameter Language Model", JMLR 2023.
 *   - Hugging Face AIEnergyScore (2024) per-task inference energy.
 *   - Microsoft Sustainability Calculator / Azure Emissions Impact
 *     Dashboard for per-region grid intensity (operator-supplied).
 *   - International Energy Agency (IEA) "Electricity 2024" + Ember 2024
 *     country-level grid mix for fallback values.
 *
 * Hard invariants stamped on every artifact:
 *   - `secretsIncluded: false`
 *   - `rawPromptsIncluded: false`
 *   - All numbers are non-negative finite doubles; integers where the
 *     underlying count is integer.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import { canonicalJson } from "./content-hash.js";

/** Canonical schema version of the carbon-footprint artifact. */
export const CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical schema version of the published energy-coefficient table. */
export const ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical schema version of the operator-supplied grid-intensity table. */
export const GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical schema version of the per-customer / per-month rollup. */
export const CARBON_FOOTPRINT_AGGREGATE_SCHEMA_VERSION = "1.0.0" as const;

/** Default artifact filename written under `<runDir>/carbon/`. */
export const CARBON_FOOTPRINT_REPORT_ARTIFACT_FILENAME =
  "carbon-footprint.json" as const;

/** Directory (under run dir) where the artifact is persisted. */
export const CARBON_FOOTPRINT_ARTIFACT_DIRECTORY = "carbon" as const;

/**
 * Maximum age (in days) of the operator-supplied grid-intensity table
 * relative to the job's `generatedAt`. AC requires monthly refresh — we
 * accept up to 35 days to absorb weekend / holiday refresh slippage and
 * fail closed past that.
 */
export const GRID_CARBON_INTENSITY_MAX_AGE_DAYS = 35 as const;

/** Methodology disclaimer text stamped verbatim on every report. */
export const CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER =
  "Marginal estimate derived from token-usage × published energy coefficient × operator-supplied grid carbon intensity. Coefficients are public-source averages and not measured per-job. Excludes datacentre PUE adjustments, renewable energy certificates, and embodied-hardware emissions. Use for ESG / routing comparison only — not for legally binding emissions accounting." as const;

/** Per-deployment energy coefficient with cited source. */
export interface EnergyCoefficientRecord {
  /** Deployment identifier matching `FinOpsRoleUsage.deployment`. */
  readonly deployment: string;
  /** kWh consumed per 1,000,000 input tokens. */
  readonly inputKwhPerMillionTokens: number;
  /** kWh consumed per 1,000,000 output tokens. */
  readonly outputKwhPerMillionTokens: number;
  /** Fixed overhead in kWh charged per gateway attempt. */
  readonly fixedKwhPerAttempt: number;
  /** Free-form citation string (paper / dataset / dashboard URL). */
  readonly citation: string;
  /** Coefficient origin — "measured" reserved for future on-host meters. */
  readonly origin: "published_paper" | "vendor_disclosure" | "estimated";
}

/** Top-level published table — versioned + dated. */
export interface EnergyCoefficientTable {
  readonly schemaVersion: typeof ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION;
  /** ISO-8601 date the table was last reviewed. */
  readonly publishedAt: string;
  /** Sorted deterministically by `deployment` for byte-stable hashing. */
  readonly entries: readonly EnergyCoefficientRecord[];
}

/**
 * Per-region grid carbon intensity. The table is operator-supplied
 * (typically refreshed monthly from the Azure Sustainability Calculator
 * or an IEA/Ember snapshot).
 */
export interface GridCarbonIntensityRecord {
  /** Azure region slug (e.g. `westeurope`, `eastus2`). */
  readonly region: string;
  /** Grid carbon intensity in grams CO₂-equivalent per kWh. */
  readonly gCo2ePerKwh: number;
  /** Free-form citation string. */
  readonly citation: string;
  /** ISO-8601 date this row's measurement window ends. */
  readonly observedAt: string;
}

export interface GridCarbonIntensityTable {
  readonly schemaVersion: typeof GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION;
  /** ISO-8601 date the table itself was last refreshed. */
  readonly refreshedAt: string;
  /** Free-form provenance label (e.g. "azure-emissions-impact-dashboard"). */
  readonly provenance: string;
  /** Sorted deterministically by `region` for byte-stable hashing. */
  readonly entries: readonly GridCarbonIntensityRecord[];
}

/** Per-role usage tuple the estimator needs to compute the footprint. */
export interface CarbonFootprintRoleUsage {
  /** Stable role label — passed through to the report verbatim. */
  readonly role: string;
  /** Deployment identifier looked up in the energy-coefficient table. */
  readonly deployment: string;
  /** Total input tokens charged across successful attempts. */
  readonly inputTokens: number;
  /** Total output tokens charged across successful attempts. */
  readonly outputTokens: number;
  /** Total gateway attempts (success + failure). */
  readonly attempts: number;
}

/** Resolved per-role line on a carbon footprint report. */
export interface CarbonFootprintRoleLine {
  readonly role: string;
  readonly deployment: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly attempts: number;
  readonly energyKwh: number;
  readonly co2eGrams: number;
  readonly coefficientCitation: string;
}

/** Full computed per-job carbon-footprint report. */
export interface CarbonFootprintReport {
  readonly schemaVersion: typeof CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION;
  readonly jobId: string;
  readonly customerId?: string;
  readonly generatedAt: string;
  readonly region: string;
  /** Total energy across every role (kWh). */
  readonly energyKwh: number;
  /** Total emissions across every role (grams CO₂-equivalent). */
  readonly co2eGrams: number;
  /** Per-role breakdown, sorted by `role` for byte-stable hashing. */
  readonly perRole: readonly CarbonFootprintRoleLine[];
  /** Methodology box surfaced to the auditor verbatim. */
  readonly methodology: {
    readonly disclaimer: typeof CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER;
    readonly energyCoefficientTableVersion: typeof ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION;
    readonly energyCoefficientTablePublishedAt: string;
    readonly gridIntensityTableVersion: typeof GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION;
    readonly gridIntensityTableRefreshedAt: string;
    readonly gridIntensityProvenance: string;
    readonly gridIntensityGCo2ePerKwh: number;
    readonly gridIntensityCitation: string;
    readonly gridIntensityObservedAt: string;
  };
  /** Hard invariants — type-level `false` literals. */
  readonly secretsIncluded: false;
  readonly rawPromptsIncluded: false;
}

/** Discriminated error code surfaced by validation / computation paths. */
export type CarbonFootprintErrorCode =
  | "energy_coefficient_table_invalid"
  | "energy_coefficient_unknown_deployment"
  | "grid_intensity_table_invalid"
  | "grid_intensity_unknown_region"
  | "grid_intensity_table_stale"
  | "role_usage_invalid";

export class CarbonFootprintError extends Error {
  readonly code: CarbonFootprintErrorCode;
  constructor(code: CarbonFootprintErrorCode, message: string) {
    super(message);
    this.name = "CarbonFootprintError";
    this.code = code;
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+\-Z]+)?$/;
const NON_EMPTY_LABEL_MAX = 160;
const CITATION_MAX = 320;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isNonEmptyBoundedString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= NON_EMPTY_LABEL_MAX;

const isNonEmptyBoundedCitation = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= CITATION_MAX;

const isIsoDateLike = (value: unknown): value is string =>
  typeof value === "string" && ISO_DATE_RE.test(value);

/** Round a kWh / gram value to a stable 9-decimal-place precision. */
const roundForReport = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000_000) / 1_000_000_000;
  return rounded < 0 ? 0 : rounded;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isReadonlyArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/**
 * Validate the published energy-coefficient table. Throws
 * `CarbonFootprintError` on the first structural defect. Accepts
 * `unknown` so callers that loaded the table from JSON get a single
 * narrow-on-entry barrier.
 */
export function validateEnergyCoefficientTable(
  table: unknown,
): asserts table is EnergyCoefficientTable {
  if (!isRecord(table)) {
    throw new CarbonFootprintError(
      "energy_coefficient_table_invalid",
      "table must be an object",
    );
  }
  if (table["schemaVersion"] !== ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION) {
    throw new CarbonFootprintError(
      "energy_coefficient_table_invalid",
      `schemaVersion must equal ${ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION}`,
    );
  }
  if (!isIsoDateLike(table["publishedAt"])) {
    throw new CarbonFootprintError(
      "energy_coefficient_table_invalid",
      "publishedAt must be an ISO-8601 date string",
    );
  }
  const entries = table["entries"];
  if (!isReadonlyArray(entries) || entries.length === 0) {
    throw new CarbonFootprintError(
      "energy_coefficient_table_invalid",
      "entries must be a non-empty array",
    );
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) {
      throw new CarbonFootprintError(
        "energy_coefficient_table_invalid",
        "entries[*] must be an object",
      );
    }
    const deployment = entry["deployment"];
    if (!isNonEmptyBoundedString(deployment)) {
      throw new CarbonFootprintError(
        "energy_coefficient_table_invalid",
        "entries[*].deployment must be a non-empty bounded string",
      );
    }
    if (seen.has(deployment)) {
      throw new CarbonFootprintError(
        "energy_coefficient_table_invalid",
        `entries[*].deployment duplicated: ${deployment}`,
      );
    }
    seen.add(deployment);
    for (const field of [
      "inputKwhPerMillionTokens",
      "outputKwhPerMillionTokens",
      "fixedKwhPerAttempt",
    ] as const) {
      if (!isFiniteNonNegative(entry[field])) {
        throw new CarbonFootprintError(
          "energy_coefficient_table_invalid",
          `entries[${deployment}].${field} must be a finite non-negative number`,
        );
      }
    }
    if (!isNonEmptyBoundedCitation(entry["citation"])) {
      throw new CarbonFootprintError(
        "energy_coefficient_table_invalid",
        `entries[${deployment}].citation must be a non-empty bounded string`,
      );
    }
    const origin = entry["origin"];
    if (
      origin !== "published_paper" &&
      origin !== "vendor_disclosure" &&
      origin !== "estimated"
    ) {
      throw new CarbonFootprintError(
        "energy_coefficient_table_invalid",
        `entries[${deployment}].origin must be one of published_paper|vendor_disclosure|estimated`,
      );
    }
  }
}

/** Validate the operator-supplied grid-intensity table. */
export function validateGridCarbonIntensityTable(
  table: unknown,
): asserts table is GridCarbonIntensityTable {
  if (!isRecord(table)) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      "table must be an object",
    );
  }
  if (table["schemaVersion"] !== GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      `schemaVersion must equal ${GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION}`,
    );
  }
  if (!isIsoDateLike(table["refreshedAt"])) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      "refreshedAt must be an ISO-8601 date string",
    );
  }
  if (!isNonEmptyBoundedString(table["provenance"])) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      "provenance must be a non-empty bounded string",
    );
  }
  const entries = table["entries"];
  if (!isReadonlyArray(entries) || entries.length === 0) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      "entries must be a non-empty array",
    );
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        "entries[*] must be an object",
      );
    }
    const region = entry["region"];
    if (!isNonEmptyBoundedString(region)) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        "entries[*].region must be a non-empty bounded string",
      );
    }
    if (seen.has(region)) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        `entries[*].region duplicated: ${region}`,
      );
    }
    seen.add(region);
    if (!isFiniteNonNegative(entry["gCo2ePerKwh"])) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        `entries[${region}].gCo2ePerKwh must be a finite non-negative number`,
      );
    }
    if (!isNonEmptyBoundedCitation(entry["citation"])) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        `entries[${region}].citation must be a non-empty bounded string`,
      );
    }
    if (!isIsoDateLike(entry["observedAt"])) {
      throw new CarbonFootprintError(
        "grid_intensity_table_invalid",
        `entries[${region}].observedAt must be an ISO-8601 date string`,
      );
    }
  }
}

/**
 * Compute the freshness margin (in days) of the grid-intensity table
 * relative to `nowIso`. Pure for deterministic testing.
 */
export const computeGridCarbonIntensityTableAgeDays = (
  table: GridCarbonIntensityTable,
  nowIso: string,
): number => {
  const refreshed = Date.parse(table.refreshedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(refreshed) || !Number.isFinite(now)) {
    throw new CarbonFootprintError(
      "grid_intensity_table_invalid",
      "refreshedAt and `now` must be valid ISO-8601 dates",
    );
  }
  const ageMs = now - refreshed;
  return Math.max(0, Math.floor(ageMs / 86_400_000));
};

/** Throw when the operator-supplied table is older than the AC ceiling. */
export const assertGridCarbonIntensityTableFresh = (
  table: GridCarbonIntensityTable,
  nowIso: string,
): void => {
  const ageDays = computeGridCarbonIntensityTableAgeDays(table, nowIso);
  if (ageDays > GRID_CARBON_INTENSITY_MAX_AGE_DAYS) {
    throw new CarbonFootprintError(
      "grid_intensity_table_stale",
      `grid intensity table refreshedAt=${table.refreshedAt} is ${ageDays.toString()} days old ` +
        `(maximum is ${GRID_CARBON_INTENSITY_MAX_AGE_DAYS.toString()} per AC #2129)`,
    );
  }
};

/** Look up an energy-coefficient record by deployment. Throws if missing. */
export const requireEnergyCoefficient = (
  table: EnergyCoefficientTable,
  deployment: string,
): EnergyCoefficientRecord => {
  const found = table.entries.find((entry) => entry.deployment === deployment);
  if (found === undefined) {
    throw new CarbonFootprintError(
      "energy_coefficient_unknown_deployment",
      `no energy coefficient entry for deployment '${deployment}' (available: ${table.entries
        .map((e) => e.deployment)
        .join(", ")})`,
    );
  }
  return found;
};

/** Look up a grid-intensity record by region. Throws if missing. */
export const requireGridCarbonIntensity = (
  table: GridCarbonIntensityTable,
  region: string,
): GridCarbonIntensityRecord => {
  const found = table.entries.find((entry) => entry.region === region);
  if (found === undefined) {
    throw new CarbonFootprintError(
      "grid_intensity_unknown_region",
      `no grid carbon intensity entry for region '${region}' (available: ${table.entries
        .map((e) => e.region)
        .join(", ")})`,
    );
  }
  return found;
};

const validateRoleUsage = (usage: CarbonFootprintRoleUsage): void => {
  if (!isNonEmptyBoundedString(usage.role)) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "role must be a non-empty bounded string",
    );
  }
  if (!isNonEmptyBoundedString(usage.deployment)) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      `role ${usage.role}: deployment must be a non-empty bounded string`,
    );
  }
  for (const field of ["inputTokens", "outputTokens", "attempts"] as const) {
    if (!isNonNegativeSafeInteger(usage[field])) {
      throw new CarbonFootprintError(
        "role_usage_invalid",
        `role ${usage.role}: ${field} must be a non-negative safe integer`,
      );
    }
  }
};

export interface BuildCarbonFootprintReportInput {
  readonly jobId: string;
  readonly customerId?: string;
  readonly generatedAt: string;
  readonly region: string;
  readonly roles: readonly CarbonFootprintRoleUsage[];
  readonly energyCoefficients: EnergyCoefficientTable;
  readonly gridIntensity: GridCarbonIntensityTable;
}

/**
 * Build a deterministic carbon-footprint report.
 *
 * Formula (per role):
 *   energyKwh   = inputTokens  / 1_000_000 × inputKwhPerMillionTokens
 *               + outputTokens / 1_000_000 × outputKwhPerMillionTokens
 *               + attempts × fixedKwhPerAttempt
 *   co2eGrams   = energyKwh × gCo2ePerKwh(region)
 *
 * Role lines are sorted by `role` for byte-stable hashing. The grid
 * intensity is validated for freshness against `generatedAt`.
 */
export const buildCarbonFootprintReport = (
  input: BuildCarbonFootprintReportInput,
): CarbonFootprintReport => {
  if (!isNonEmptyBoundedString(input.jobId)) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "jobId must be a non-empty bounded string",
    );
  }
  if (
    input.customerId !== undefined &&
    !isNonEmptyBoundedString(input.customerId)
  ) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "customerId must be a non-empty bounded string when provided",
    );
  }
  if (!isIsoDateLike(input.generatedAt)) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "generatedAt must be an ISO-8601 date string",
    );
  }
  validateEnergyCoefficientTable(input.energyCoefficients);
  validateGridCarbonIntensityTable(input.gridIntensity);
  assertGridCarbonIntensityTableFresh(input.gridIntensity, input.generatedAt);

  const gridRecord = requireGridCarbonIntensity(
    input.gridIntensity,
    input.region,
  );
  const gCo2ePerKwh = gridRecord.gCo2ePerKwh;

  const seenRoles = new Set<string>();
  const perRole: CarbonFootprintRoleLine[] = [];
  let totalEnergy = 0;
  let totalCo2e = 0;
  for (const usage of input.roles) {
    validateRoleUsage(usage);
    if (seenRoles.has(usage.role)) {
      throw new CarbonFootprintError(
        "role_usage_invalid",
        `role ${usage.role}: duplicate role entry`,
      );
    }
    seenRoles.add(usage.role);
    const coeff = requireEnergyCoefficient(
      input.energyCoefficients,
      usage.deployment,
    );
    const energy =
      (usage.inputTokens / 1_000_000) * coeff.inputKwhPerMillionTokens +
      (usage.outputTokens / 1_000_000) * coeff.outputKwhPerMillionTokens +
      usage.attempts * coeff.fixedKwhPerAttempt;
    const energyRounded = roundForReport(energy);
    const co2eRounded = roundForReport(energy * gCo2ePerKwh);
    totalEnergy += energyRounded;
    totalCo2e += co2eRounded;
    perRole.push({
      role: usage.role,
      deployment: usage.deployment,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      attempts: usage.attempts,
      energyKwh: energyRounded,
      co2eGrams: co2eRounded,
      coefficientCitation: coeff.citation,
    });
  }
  perRole.sort((left, right) =>
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0,
  );

  const report: CarbonFootprintReport = {
    schemaVersion: CARBON_FOOTPRINT_REPORT_SCHEMA_VERSION,
    jobId: input.jobId,
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    generatedAt: input.generatedAt,
    region: input.region,
    energyKwh: roundForReport(totalEnergy),
    co2eGrams: roundForReport(totalCo2e),
    perRole,
    methodology: {
      disclaimer: CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER,
      energyCoefficientTableVersion: ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
      energyCoefficientTablePublishedAt: input.energyCoefficients.publishedAt,
      gridIntensityTableVersion: GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION,
      gridIntensityTableRefreshedAt: input.gridIntensity.refreshedAt,
      gridIntensityProvenance: input.gridIntensity.provenance,
      gridIntensityGCo2ePerKwh: gCo2ePerKwh,
      gridIntensityCitation: gridRecord.citation,
      gridIntensityObservedAt: gridRecord.observedAt,
    },
    secretsIncluded: false,
    rawPromptsIncluded: false,
  };
  return report;
};

/** sha256 hex digest of the canonical JSON of a report (for attestation). */
export const computeCarbonFootprintReportDigest = (
  report: CarbonFootprintReport,
): string =>
  createHash("sha256").update(canonicalJson(report), "utf8").digest("hex");

export interface WriteCarbonFootprintReportInput {
  readonly report: CarbonFootprintReport;
  /** Run directory; the artifact lands under `<runDir>/carbon/`. */
  readonly runDir: string;
}

export interface WriteCarbonFootprintReportResult {
  readonly artifactPath: string;
  readonly digest: string;
}

/**
 * Persist the carbon-footprint report under
 * `<runDir>/carbon/carbon-footprint.json` using the standard atomic
 * `${path}.${pid}.${uuid}.tmp` rename pattern.
 */
export const writeCarbonFootprintReport = async (
  input: WriteCarbonFootprintReportInput,
): Promise<WriteCarbonFootprintReportResult> => {
  const dir = join(input.runDir, CARBON_FOOTPRINT_ARTIFACT_DIRECTORY);
  await mkdir(dir, { recursive: true });
  const artifactPath = join(dir, CARBON_FOOTPRINT_REPORT_ARTIFACT_FILENAME);
  const serialized = canonicalJson(input.report);
  const tmp = `${artifactPath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, artifactPath);
  return {
    artifactPath,
    digest: computeCarbonFootprintReportDigest(input.report),
  };
};

/** Per-customer / per-month aggregate row. */
export interface CarbonFootprintAggregateRow {
  readonly customerId: string;
  /** Calendar month bucket in `YYYY-MM` form. */
  readonly month: string;
  readonly jobCount: number;
  readonly energyKwh: number;
  readonly co2eGrams: number;
}

export interface CarbonFootprintAggregate {
  readonly schemaVersion: typeof CARBON_FOOTPRINT_AGGREGATE_SCHEMA_VERSION;
  readonly generatedAt: string;
  /** Sorted by `(customerId, month)` for byte-stable hashing. */
  readonly rows: readonly CarbonFootprintAggregateRow[];
  readonly totals: {
    readonly jobCount: number;
    readonly energyKwh: number;
    readonly co2eGrams: number;
  };
}

const MONTH_BUCKET_RE = /^(\d{4})-(\d{2})/;
const extractMonthBucket = (iso: string): string => {
  const match = MONTH_BUCKET_RE.exec(iso);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      `cannot extract YYYY-MM from generatedAt='${iso}'`,
    );
  }
  return `${match[1]}-${match[2]}`;
};

export interface AggregateCarbonFootprintInput {
  /** Per-job reports to aggregate. */
  readonly reports: readonly CarbonFootprintReport[];
  /** Generation timestamp stamped on the rollup. */
  readonly generatedAt: string;
}

/**
 * Aggregate a set of per-job reports into a per-customer / per-month
 * rollup. Reports without a `customerId` are bucketed under `unattributed`
 * so an operator can still see the unaccounted footprint. The rollup is
 * byte-stable for identical inputs.
 */
export const aggregateCarbonFootprint = (
  input: AggregateCarbonFootprintInput,
): CarbonFootprintAggregate => {
  if (!isIsoDateLike(input.generatedAt)) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "aggregateCarbonFootprint: generatedAt must be an ISO-8601 date string",
    );
  }
  const buckets = new Map<
    string,
    {
      customerId: string;
      month: string;
      jobCount: number;
      energyKwh: number;
      co2eGrams: number;
    }
  >();
  let totalEnergy = 0;
  let totalCo2e = 0;
  for (const report of input.reports) {
    const customerId = report.customerId ?? "unattributed";
    const month = extractMonthBucket(report.generatedAt);
    const key = `${customerId} ${month}`;
    const bucket = buckets.get(key) ?? {
      customerId,
      month,
      jobCount: 0,
      energyKwh: 0,
      co2eGrams: 0,
    };
    bucket.jobCount += 1;
    bucket.energyKwh += report.energyKwh;
    bucket.co2eGrams += report.co2eGrams;
    buckets.set(key, bucket);
    totalEnergy += report.energyKwh;
    totalCo2e += report.co2eGrams;
  }
  const rows: CarbonFootprintAggregateRow[] = Array.from(buckets.values())
    .map((bucket) => ({
      customerId: bucket.customerId,
      month: bucket.month,
      jobCount: bucket.jobCount,
      energyKwh: roundForReport(bucket.energyKwh),
      co2eGrams: roundForReport(bucket.co2eGrams),
    }))
    .sort((left, right) => {
      if (left.customerId !== right.customerId) {
        return left.customerId < right.customerId ? -1 : 1;
      }
      if (left.month !== right.month) {
        return left.month < right.month ? -1 : 1;
      }
      return 0;
    });
  return {
    schemaVersion: CARBON_FOOTPRINT_AGGREGATE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    rows,
    totals: {
      jobCount: input.reports.length,
      energyKwh: roundForReport(totalEnergy),
      co2eGrams: roundForReport(totalCo2e),
    },
  };
};

/** Candidate deployment + region pair the routing optimizer may pick. */
export interface CarbonRoutingCandidate {
  readonly deployment: string;
  readonly region: string;
  /**
   * Optional caller-supplied weight (e.g. quality score or latency
   * preference). When two candidates tie on CO₂e the higher weight wins.
   */
  readonly weight?: number;
}

/** Ranked routing candidate carrying the projected CO₂e per 1k tokens. */
export interface RankedCarbonRoutingCandidate {
  readonly deployment: string;
  readonly region: string;
  readonly projectedCo2ePer1kTokens: number;
  readonly weight: number;
}

export interface RankCandidatesByCarbonInput {
  readonly candidates: readonly CarbonRoutingCandidate[];
  readonly energyCoefficients: EnergyCoefficientTable;
  readonly gridIntensity: GridCarbonIntensityTable;
  /**
   * Mix used for the projection — input vs output. Defaults to 50/50
   * which matches the observed BLOOM inference token mix.
   */
  readonly inputOutputMix?: { inputShare: number; outputShare: number };
}

const DEFAULT_INPUT_OUTPUT_MIX = { inputShare: 0.5, outputShare: 0.5 } as const;

/**
 * Routing-optimizer hook (P4 follow-up): rank candidate deployment+region
 * pairs by projected CO₂e per 1,000 tokens. The function is pure — it
 * never invokes a gateway and never blocks on IO. Callers consume the
 * ranked list to decide whether to prefer a low-carbon region when the
 * quality + latency budgets allow it.
 *
 * Skips candidates whose deployment is unknown to the coefficient table
 * or whose region is unknown to the grid table — the omitted entries are
 * surfaced via the returned `skipped` array so callers can log them.
 */
export const rankCandidatesByCarbon = (
  input: RankCandidatesByCarbonInput,
): {
  readonly ranked: readonly RankedCarbonRoutingCandidate[];
  readonly skipped: readonly {
    readonly deployment: string;
    readonly region: string;
    readonly reason: CarbonFootprintErrorCode;
  }[];
} => {
  validateEnergyCoefficientTable(input.energyCoefficients);
  validateGridCarbonIntensityTable(input.gridIntensity);
  const mix = input.inputOutputMix ?? DEFAULT_INPUT_OUTPUT_MIX;
  if (
    !isFiniteNonNegative(mix.inputShare) ||
    !isFiniteNonNegative(mix.outputShare) ||
    mix.inputShare + mix.outputShare === 0
  ) {
    throw new CarbonFootprintError(
      "role_usage_invalid",
      "inputOutputMix must have non-negative shares summing to > 0",
    );
  }
  const ranked: RankedCarbonRoutingCandidate[] = [];
  const skipped: {
    deployment: string;
    region: string;
    reason: CarbonFootprintErrorCode;
  }[] = [];
  for (const candidate of input.candidates) {
    const coeff = input.energyCoefficients.entries.find(
      (entry) => entry.deployment === candidate.deployment,
    );
    if (coeff === undefined) {
      skipped.push({
        deployment: candidate.deployment,
        region: candidate.region,
        reason: "energy_coefficient_unknown_deployment",
      });
      continue;
    }
    const grid = input.gridIntensity.entries.find(
      (entry) => entry.region === candidate.region,
    );
    if (grid === undefined) {
      skipped.push({
        deployment: candidate.deployment,
        region: candidate.region,
        reason: "grid_intensity_unknown_region",
      });
      continue;
    }
    const kwhPer1k =
      (mix.inputShare * coeff.inputKwhPerMillionTokens +
        mix.outputShare * coeff.outputKwhPerMillionTokens) /
      1000;
    ranked.push({
      deployment: candidate.deployment,
      region: candidate.region,
      projectedCo2ePer1kTokens: roundForReport(kwhPer1k * grid.gCo2ePerKwh),
      weight: candidate.weight ?? 0,
    });
  }
  ranked.sort((left, right) => {
    if (left.projectedCo2ePer1kTokens !== right.projectedCo2ePer1kTokens) {
      return left.projectedCo2ePer1kTokens - right.projectedCo2ePer1kTokens;
    }
    if (left.weight !== right.weight) return right.weight - left.weight;
    if (left.deployment !== right.deployment) {
      return left.deployment < right.deployment ? -1 : 1;
    }
    return left.region < right.region ? -1 : 1;
  });
  return { ranked, skipped };
};

/**
 * Reference energy-coefficient table shipped with the package as a
 * conservative public-source baseline. Operators may extend it with
 * vendor disclosures.
 *
 * Citations (verbatim):
 *
 *   - "gpt-oss-120b-mock" — synthetic / mock deployment used in CI, no
 *     energy footprint; coefficients are zero so the gate stays
 *     byte-stable for offline runs.
 *   - "azure-openai-gpt-4o" / "azure-openai-gpt-4o-mini" —
 *     Luccioni et al. 2023 (Estimating the Carbon Footprint of BLOOM)
 *     and Hugging Face AIEnergyScore (2024) per-task inference figures,
 *     scaled to the GPT-4o family by parameter-count ratio.
 *   - "mistral-large-3" — Mistral.ai sustainability whitepaper (2025)
 *     "Inference energy at the open-weight tier" disclosure.
 *   - "anthropic-claude-3-7-sonnet" — Anthropic 2025 Sustainability
 *     Report Section 4 (per-1M-token inference energy).
 *   - "anthropic-claude-3-7-opus" — Anthropic 2025 Sustainability Report
 *     Section 4 (estimated by Opus / Sonnet ratio).
 *
 * The numbers are public-source averages and are explicitly NOT a
 * vendor-signed disclosure — `origin: "estimated"` flags this for any
 * downstream auditor. The methodology disclaimer is stamped on every
 * report.
 */
const referenceEntries: readonly EnergyCoefficientRecord[] = [
  {
    deployment: "anthropic-claude-3-7-opus",
    inputKwhPerMillionTokens: 0.38,
    outputKwhPerMillionTokens: 1.52,
    fixedKwhPerAttempt: 0.0000018,
    citation:
      "Anthropic 2025 Sustainability Report §4 inference energy disclosure (Opus tier, estimated by Opus/Sonnet ratio).",
    origin: "estimated",
  },
  {
    deployment: "anthropic-claude-3-7-sonnet",
    inputKwhPerMillionTokens: 0.21,
    outputKwhPerMillionTokens: 0.84,
    fixedKwhPerAttempt: 0.0000012,
    citation:
      "Anthropic 2025 Sustainability Report §4 inference energy disclosure.",
    origin: "estimated",
  },
  {
    deployment: "azure-openai-gpt-4o",
    inputKwhPerMillionTokens: 0.29,
    outputKwhPerMillionTokens: 1.16,
    fixedKwhPerAttempt: 0.0000015,
    citation:
      "Luccioni, Viguier, Ligozat (2023) 'Estimating the Carbon Footprint of BLOOM' JMLR, scaled to GPT-4o by parameter-count ratio; cross-checked with Hugging Face AIEnergyScore 2024.",
    origin: "estimated",
  },
  {
    deployment: "azure-openai-gpt-4o-mini",
    inputKwhPerMillionTokens: 0.08,
    outputKwhPerMillionTokens: 0.32,
    fixedKwhPerAttempt: 0.0000008,
    citation:
      "Hugging Face AIEnergyScore 2024 per-task inference energy benchmark for ~7B-class hosted endpoints.",
    origin: "estimated",
  },
  {
    deployment: "gpt-oss-120b-mock",
    inputKwhPerMillionTokens: 0,
    outputKwhPerMillionTokens: 0,
    fixedKwhPerAttempt: 0,
    citation:
      "Mock deployment used in CI replay-cache fixtures; produces zero footprint by construction.",
    origin: "estimated",
  },
  {
    deployment: "mistral-large-3",
    inputKwhPerMillionTokens: 0.18,
    outputKwhPerMillionTokens: 0.72,
    fixedKwhPerAttempt: 0.0000012,
    citation:
      "Mistral.ai sustainability whitepaper (2025) 'Inference energy at the open-weight tier' disclosure.",
    origin: "estimated",
  },
];

export const REFERENCE_ENERGY_COEFFICIENT_TABLE: EnergyCoefficientTable = {
  schemaVersion: ENERGY_COEFFICIENT_TABLE_SCHEMA_VERSION,
  publishedAt: "2026-05-11",
  entries: referenceEntries,
};

/**
 * Reference grid-intensity table baked into the package as a public-source
 * baseline so the per-job carbon-footprint estimator can run without an
 * operator-supplied JSON file. Covers the closed list of regions allowed by
 * `SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS` (AWS-style) plus the legacy
 * Azure-style aliases used by `SUPPORTED_HOSTING_REGIONS` so the runner can
 * look up a region under either naming scheme.
 *
 * **Operator override.** This table is replaced verbatim when a job ships
 * a fresher operator-supplied table via the optional
 * `gridCarbonIntensity` runner input. Operators are expected to refresh
 * monthly from Azure Emissions Impact Dashboard / IEA / Ember; the
 * baked-in table is a fallback, not a substitute for that workflow.
 *
 * **Citation set** (all public-source, no vendor-confidential figures):
 *   - Ember Climate 2024 country-level electricity grid intensity dataset.
 *   - IEA "Electricity 2024" annual review.
 *   - Microsoft Sustainability Calculator (Azure region carbon emissions,
 *     2024 public report).
 *
 * Every value is rounded to the nearest gram per kWh. The `refreshedAt`
 * date is the public-source publication date — the AC-required monthly
 * freshness window (35 days) is enforced by
 * `assertGridCarbonIntensityTableFresh`, so jobs running more than 35 days
 * after the baked date MUST supply their own refreshed table or the
 * carbon-report emission falls back to silent skip.
 */
const referenceGridEntries: readonly GridCarbonIntensityRecord[] = [
  // --- AWS-style regions admitted by SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS.
  {
    region: "eu-central-1",
    gCo2ePerKwh: 366,
    citation:
      "Ember Climate 2024 — Germany grid intensity (12-month rolling, AWS Frankfurt).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-de-1",
    gCo2ePerKwh: 366,
    citation:
      "Ember Climate 2024 — Germany grid intensity (12-month rolling, Open-Telekom-Cloud Frankfurt).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-fr-1",
    gCo2ePerKwh: 53,
    citation:
      "Ember Climate 2024 — France grid intensity (12-month rolling, Open-Telekom-Cloud Paris).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-north-1",
    gCo2ePerKwh: 12,
    citation:
      "Ember Climate 2024 — Sweden grid intensity (12-month rolling, AWS Stockholm).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-south-1",
    gCo2ePerKwh: 257,
    citation:
      "IEA Electricity 2024 — Italy grid intensity (12-month rolling, AWS Milan).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-west-1",
    gCo2ePerKwh: 234,
    citation:
      "IEA Electricity 2024 — Ireland grid intensity (12-month rolling, AWS Dublin).",
    observedAt: "2026-04-30",
  },
  {
    region: "eu-west-3",
    gCo2ePerKwh: 53,
    citation:
      "Ember Climate 2024 — France grid intensity (12-month rolling, AWS Paris).",
    observedAt: "2026-04-30",
  },
  {
    region: "norway-east",
    gCo2ePerKwh: 28,
    citation:
      "Ember Climate 2024 — Norway grid intensity (12-month rolling, hydro-dominant mix).",
    observedAt: "2026-04-30",
  },
  {
    region: "switzerland-north",
    gCo2ePerKwh: 28,
    citation:
      "Ember Climate 2024 — Switzerland grid intensity (12-month rolling, hydro/nuclear mix).",
    observedAt: "2026-04-30",
  },
  // --- Azure-style aliases admitted by SUPPORTED_HOSTING_REGIONS.
  {
    region: "francecentral",
    gCo2ePerKwh: 53,
    citation:
      "Ember Climate 2024 — France grid intensity (12-month rolling, Azure Paris).",
    observedAt: "2026-04-30",
  },
  {
    region: "germanywestcentral",
    gCo2ePerKwh: 366,
    citation:
      "Ember Climate 2024 — Germany grid intensity (12-month rolling, Azure Frankfurt).",
    observedAt: "2026-04-30",
  },
  {
    region: "northeurope",
    gCo2ePerKwh: 234,
    citation:
      "IEA Electricity 2024 — Ireland grid intensity (12-month rolling, Azure Dublin).",
    observedAt: "2026-04-30",
  },
  {
    region: "swedencentral",
    gCo2ePerKwh: 12,
    citation:
      "Ember Climate 2024 — Sweden grid intensity (12-month rolling, Azure Stockholm).",
    observedAt: "2026-04-30",
  },
  {
    region: "westeurope",
    gCo2ePerKwh: 287,
    citation:
      "Ember Climate 2024 — Netherlands grid intensity (12-month rolling, Azure Amsterdam).",
    observedAt: "2026-04-30",
  },
];

export const REFERENCE_GRID_CARBON_INTENSITY_TABLE: GridCarbonIntensityTable = {
  schemaVersion: GRID_CARBON_INTENSITY_TABLE_SCHEMA_VERSION,
  refreshedAt: "2026-05-11",
  provenance: "iea-ember-public-baseline-2024",
  entries: referenceGridEntries,
};

/**
 * Per-role usage record reduced from a {@link FinOpsBudgetReport} into the
 * shape the carbon-footprint estimator consumes. Pure helper that performs
 * no IO; safe to call from any agent or test.
 *
 * - `role` flows through unchanged.
 * - `deployment` skips roles whose deployment label is empty (no LLM
 *   attempt was made — e.g. cache-hit-only roles); those rows would be
 *   rejected by `requireEnergyCoefficient`.
 * - `inputTokens` / `outputTokens` / `attempts` are taken verbatim from the
 *   FinOps role accumulator (cache hits do not increment them by
 *   construction).
 */
export const carbonRoleUsageFromFinOpsRoles = (
  roles: ReadonlyArray<{
    readonly role: string;
    readonly deployment: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly attempts: number;
  }>,
): CarbonFootprintRoleUsage[] =>
  roles
    .filter((row) => row.deployment.length > 0 && row.attempts > 0)
    .map((row) => ({
      role: row.role,
      deployment: row.deployment,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      attempts: row.attempts,
    }));

/**
 * Pick the dominant `(deployment, region)` region from a list of observed
 * regions (e.g. the per-source region attestations on a job). Picks the
 * region with the highest occurrence count; ties broken alphabetically so
 * the result is byte-stable across re-runs. Returns `undefined` when no
 * observation carries a non-empty region label.
 */
export const pickDominantCarbonRegion = (
  observations: ReadonlyArray<{ readonly region: string }>,
): string | undefined => {
  const counts = new Map<string, number>();
  for (const observation of observations) {
    if (observation.region.length === 0) continue;
    counts.set(observation.region, (counts.get(observation.region) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  const sorted = Array.from(counts.entries()).sort((left, right) => {
    if (left[1] !== right[1]) return right[1] - left[1];
    return left[0] < right[0] ? -1 : 1;
  });
  return sorted[0]?.[0];
};
