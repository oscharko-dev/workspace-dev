/**
 * Coverage-baseline drift gate (Issue #1950, Wave-4).
 *
 * Pins a per-tenant, per-archetype, per-policy-profile coverage-ratio
 * baseline at:
 *
 *   `<runtimeRoot>/coverage-baselines/<tenantId>/<archetype>.json`
 *
 * On every job we either:
 *
 *   - **Seed** the baseline atomically when none exists (first run per
 *     archetype). The current run's ratios become the new pin and no
 *     drift is evaluated.
 *   - **Check** the baseline by comparing the candidate ratios against
 *     the persisted pin. When the absolute drift on any of
 *     `fieldCoverage`, `actionCoverage`, `validationCoverage`,
 *     `navigationCoverage` exceeds {@link COVERAGE_BASELINE_DRIFT_THRESHOLD}
 *     (10 %), a `policy:coverage-drift-exceeded` job-level violation is
 *     emitted at *warning* severity. The decision class is `needs_review`
 *     — operator-actionable but not auto-blocking, so a single bad day of
 *     telemetry cannot brick production.
 *   - **Update** the baseline (operator-driven re-baseline) by atomically
 *     rewriting the pin with the candidate ratios. Triggered by the
 *     `--coverage-baseline-update` CLI flag.
 *
 * Determinism / I/O surface:
 *   - {@link evaluateCoverageBaselineDrift},
 *     {@link buildCoverageBaselineRecord},
 *     {@link buildCoverageDriftPolicyViolation},
 *     {@link extractCoverageRatiosFromReport} and the threshold/path
 *     helpers are pure functions over their inputs.
 *   - {@link loadCoverageBaseline} / {@link writeCoverageBaseline} /
 *     {@link syncCoverageBaselineForJob} are the only filesystem touches
 *     and are atomic (temp file + rename, ENOENT-tolerant load).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  TestCaseCoverageReport,
  TestCasePolicyReport,
  TestCasePolicyViolation,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/** Schema version pinned on every persisted coverage-baseline record. */
export const COVERAGE_BASELINE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Maximum tolerated absolute drift on any tracked coverage axis (per
 * Issue #1950). Drift in (-threshold, +threshold) is absorbed silently;
 * drift outside that band trips the gate and surfaces a `needs_review`
 * job-level policy violation. Coverage ratios are already in [0, 1] so a
 * 0.10 absolute delta is the canonical "10 %" tolerance band.
 */
export const COVERAGE_BASELINE_DRIFT_THRESHOLD = 0.1 as const;

/** Stable directory segment under `<runtimeRoot>` for the runtime store. */
export const COVERAGE_BASELINES_DIRNAME = "coverage-baselines" as const;

/** Policy-rule identifier emitted on the `coverage_drift_exceeded` outcome. */
export const COVERAGE_BASELINE_DRIFT_RULE_ID =
  "policy:coverage-drift-exceeded" as const;

/** Closed list of coverage axes evaluated by the drift gate. */
export const COVERAGE_BASELINE_AXES = [
  "fieldCoverage",
  "actionCoverage",
  "validationCoverage",
  "navigationCoverage",
] as const;

export type CoverageBaselineAxis = (typeof COVERAGE_BASELINE_AXES)[number];

export interface CoverageBaselineRatios {
  readonly fieldCoverage: number;
  readonly actionCoverage: number;
  readonly validationCoverage: number;
  readonly navigationCoverage: number;
}

export interface CoverageBaselineRecord {
  readonly schemaVersion: typeof COVERAGE_BASELINE_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly archetype: string;
  readonly policyProfileId: string;
  readonly generatedAt: string;
  readonly ratios: CoverageBaselineRatios;
}

export interface CoverageBaselineDriftFinding {
  readonly axis: CoverageBaselineAxis;
  readonly baseline: number;
  readonly candidate: number;
  /** Signed delta `candidate - baseline`, rounded to 6 decimals. */
  readonly absoluteDelta: number;
  /**
   * Drift expressed as a fraction of the baseline value. `null` when
   * baseline is 0 (no relative reference exists).
   */
  readonly relativeDelta: number | null;
  readonly threshold: number;
}

export interface CoverageBaselineDriftEvaluation {
  readonly tenantId: string;
  readonly archetype: string;
  readonly policyProfileId: string;
  readonly threshold: number;
  /** True when no baseline existed and the current ratios will be (or were) seeded. */
  readonly seeded: boolean;
  /** True when at least one axis exceeded the absolute threshold. */
  readonly exceeded: boolean;
  readonly findings: ReadonlyArray<CoverageBaselineDriftFinding>;
}

/**
 * Runtime sync mode requested by the caller.
 *
 *   - `"check"` (default): evaluate drift against the persisted baseline;
 *     seed (write) when missing.
 *   - `"update"`: re-baseline by atomically rewriting the pin to the
 *     candidate ratios. Drift evaluation is skipped.
 */
export type CoverageBaselineSyncMode = "check" | "update";

const STABLE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

const assertStableSegment = (label: string, value: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `coverage-baseline-drift: ${label} must be a non-empty string`,
    );
  }
  if (!STABLE_SEGMENT_RE.test(value)) {
    throw new Error(
      `coverage-baseline-drift: ${label} "${value}" must match ${STABLE_SEGMENT_RE.source}`,
    );
  }
};

const assertNonEmpty = (label: string, value: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `coverage-baseline-drift: ${label} must be a non-empty string`,
    );
  }
};

export interface CoverageBaselinePathInput {
  readonly runtimeRoot: string;
  readonly tenantId: string;
  readonly archetype: string;
}

/**
 * Resolve the canonical baseline path for the supplied identifiers.
 * Throws when {@link tenantId} or {@link archetype} contain characters
 * that would escape the per-tenant directory (path traversal, NUL bytes,
 * separators). The path is purely deterministic — it does not check
 * existence or perform any filesystem call.
 */
export const coverageBaselinePath = (
  input: CoverageBaselinePathInput,
): string => {
  assertNonEmpty("runtimeRoot", input.runtimeRoot);
  assertStableSegment("tenantId", input.tenantId);
  assertStableSegment("archetype", input.archetype);
  return join(
    input.runtimeRoot,
    COVERAGE_BASELINES_DIRNAME,
    input.tenantId,
    `${input.archetype}.json`,
  );
};

export interface ExtractCoverageRatiosInput {
  readonly coverage: Pick<
    TestCaseCoverageReport,
    | "fieldCoverage"
    | "actionCoverage"
    | "validationCoverage"
    | "navigationCoverage"
  >;
}

export const extractCoverageRatiosFromReport = (
  input: ExtractCoverageRatiosInput,
): CoverageBaselineRatios => ({
  fieldCoverage: input.coverage.fieldCoverage.ratio,
  actionCoverage: input.coverage.actionCoverage.ratio,
  validationCoverage: input.coverage.validationCoverage.ratio,
  navigationCoverage: input.coverage.navigationCoverage.ratio,
});

export interface BuildCoverageBaselineRecordInput {
  readonly tenantId: string;
  readonly archetype: string;
  readonly policyProfileId: string;
  readonly generatedAt: string;
  readonly ratios: CoverageBaselineRatios;
}

export const buildCoverageBaselineRecord = (
  input: BuildCoverageBaselineRecordInput,
): CoverageBaselineRecord => {
  assertStableSegment("tenantId", input.tenantId);
  assertStableSegment("archetype", input.archetype);
  assertNonEmpty("policyProfileId", input.policyProfileId);
  assertNonEmpty("generatedAt", input.generatedAt);
  return {
    schemaVersion: COVERAGE_BASELINE_SCHEMA_VERSION,
    tenantId: input.tenantId,
    archetype: input.archetype,
    policyProfileId: input.policyProfileId,
    generatedAt: input.generatedAt,
    ratios: { ...input.ratios },
  };
};

export interface LoadCoverageBaselineInput extends CoverageBaselinePathInput {
  readonly policyProfileId: string;
}

/**
 * Load the persisted baseline for the supplied identifiers. Returns
 * `undefined` when the file does not exist (first run per archetype).
 * Throws on JSON parse errors, schema-version mismatch, or identity
 * drift between the path and the file body — these indicate operator
 * misconfiguration or tampering and must not be silently absorbed.
 */
export const loadCoverageBaseline = async (
  input: LoadCoverageBaselineInput,
): Promise<CoverageBaselineRecord | undefined> => {
  const path = coverageBaselinePath(input);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `coverage-baseline-drift: failed to parse ${path}: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(
      `coverage-baseline-drift: ${path} did not parse as a JSON object`,
    );
  }
  const record = parsed as Partial<CoverageBaselineRecord> &
    Record<string, unknown>;
  if (record.schemaVersion !== COVERAGE_BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `coverage-baseline-drift: unsupported schema "${String(record.schemaVersion)}" at ${path} ` +
        `(expected "${COVERAGE_BASELINE_SCHEMA_VERSION}")`,
    );
  }
  if (record.tenantId !== input.tenantId) {
    throw new Error(
      `coverage-baseline-drift: tenantId mismatch in ${path} ` +
        `(expected "${input.tenantId}", got "${String(record.tenantId)}")`,
    );
  }
  if (record.archetype !== input.archetype) {
    throw new Error(
      `coverage-baseline-drift: archetype mismatch in ${path} ` +
        `(expected "${input.archetype}", got "${String(record.archetype)}")`,
    );
  }
  if (record.policyProfileId !== input.policyProfileId) {
    throw new Error(
      `coverage-baseline-drift: policyProfileId mismatch in ${path} ` +
        `(expected "${input.policyProfileId}", got "${String(record.policyProfileId)}")`,
    );
  }
  return record as CoverageBaselineRecord;
};

export interface WriteCoverageBaselineInput extends CoverageBaselinePathInput {
  readonly record: CoverageBaselineRecord;
}

/**
 * Atomically write the baseline record (temp file + rename). Creates
 * intermediate directories as needed.
 */
export const writeCoverageBaseline = async (
  input: WriteCoverageBaselineInput,
): Promise<string> => {
  if (input.record.tenantId !== input.tenantId) {
    throw new Error(
      `coverage-baseline-drift: record.tenantId "${input.record.tenantId}" ` +
        `does not match path tenantId "${input.tenantId}"`,
    );
  }
  if (input.record.archetype !== input.archetype) {
    throw new Error(
      `coverage-baseline-drift: record.archetype "${input.record.archetype}" ` +
        `does not match path archetype "${input.archetype}"`,
    );
  }
  const path = coverageBaselinePath(input);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.record)}\n`, "utf8");
  await rename(tempPath, path);
  return path;
};

export interface EvaluateCoverageBaselineDriftInput {
  readonly baseline: CoverageBaselineRecord | undefined;
  readonly tenantId: string;
  readonly archetype: string;
  readonly policyProfileId: string;
  readonly candidateRatios: CoverageBaselineRatios;
  readonly threshold?: number;
}

/**
 * Pure drift evaluation. When `baseline === undefined` the caller is
 * about to seed (or already seeded); the returned evaluation has
 * `seeded: true`, `exceeded: false`, no findings.
 */
export const evaluateCoverageBaselineDrift = (
  input: EvaluateCoverageBaselineDriftInput,
): CoverageBaselineDriftEvaluation => {
  const threshold = input.threshold ?? COVERAGE_BASELINE_DRIFT_THRESHOLD;
  if (threshold < 0 || !Number.isFinite(threshold)) {
    throw new Error(
      `coverage-baseline-drift: threshold must be a finite non-negative number; got ${threshold}`,
    );
  }
  if (input.baseline === undefined) {
    return {
      tenantId: input.tenantId,
      archetype: input.archetype,
      policyProfileId: input.policyProfileId,
      threshold,
      seeded: true,
      exceeded: false,
      findings: [],
    };
  }
  const findings: CoverageBaselineDriftFinding[] = [];
  for (const axis of COVERAGE_BASELINE_AXES) {
    const baselineValue = input.baseline.ratios[axis];
    const candidateValue = input.candidateRatios[axis];
    const absoluteDelta = roundTo(candidateValue - baselineValue);
    if (Math.abs(absoluteDelta) <= threshold) continue;
    const relativeDelta =
      baselineValue === 0
        ? null
        : roundTo(Math.abs(absoluteDelta) / Math.abs(baselineValue));
    findings.push({
      axis,
      baseline: baselineValue,
      candidate: candidateValue,
      absoluteDelta,
      relativeDelta,
      threshold,
    });
  }
  return {
    tenantId: input.tenantId,
    archetype: input.archetype,
    policyProfileId: input.policyProfileId,
    threshold,
    seeded: false,
    exceeded: findings.length > 0,
    findings,
  };
};

/**
 * Build the {@link TestCasePolicyViolation} surfaced when the drift gate
 * trips. Returns `undefined` when no findings exceeded the threshold so
 * the caller can splice the result without a presence check.
 */
export const buildCoverageDriftPolicyViolation = (
  evaluation: CoverageBaselineDriftEvaluation,
): TestCasePolicyViolation | undefined => {
  if (!evaluation.exceeded) return undefined;
  return {
    rule: COVERAGE_BASELINE_DRIFT_RULE_ID,
    outcome: "coverage_drift_exceeded",
    severity: "warning",
    reason: formatCoverageDriftReason(evaluation),
  };
};

const formatCoverageDriftReason = (
  evaluation: CoverageBaselineDriftEvaluation,
): string => {
  const parts = evaluation.findings
    .slice()
    .sort((a, b) => a.axis.localeCompare(b.axis))
    .map((f) => {
      const direction = f.absoluteDelta >= 0 ? "↑" : "↓";
      const relative =
        f.relativeDelta === null ? "n/a" : formatPercent(f.relativeDelta);
      return (
        `${f.axis}: ${formatRatio(f.baseline)} → ${formatRatio(f.candidate)} ` +
        `(${direction}${formatRatio(Math.abs(f.absoluteDelta))} abs, ${relative} rel)`
      );
    });
  return (
    `coverage drift exceeded ${formatPercent(evaluation.threshold)} threshold for archetype ` +
    `"${evaluation.archetype}" under profile "${evaluation.policyProfileId}" ` +
    `(tenant "${evaluation.tenantId}"): ${parts.join("; ")}`
  );
};

const formatRatio = (value: number): string => {
  if (Number.isInteger(value)) return value.toString();
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const roundTo = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

export interface SyncCoverageBaselineForJobInput
  extends CoverageBaselinePathInput {
  readonly policyProfileId: string;
  readonly generatedAt: string;
  readonly candidateRatios: CoverageBaselineRatios;
  /** Operation mode; defaults to {@link DEFAULT_COVERAGE_BASELINE_SYNC_MODE}. */
  readonly mode?: CoverageBaselineSyncMode;
  /** Override the absolute drift threshold (defaults to 10 %). */
  readonly threshold?: number;
}

export interface SyncCoverageBaselineForJobResult {
  readonly evaluation: CoverageBaselineDriftEvaluation;
  /** Path that was (re)written when seeding or updating; `undefined` on a pure check pass. */
  readonly persistedPath?: string;
}

export const DEFAULT_COVERAGE_BASELINE_SYNC_MODE: CoverageBaselineSyncMode =
  "check";

/**
 * One-shot orchestration for production runners and CLIs:
 *
 *   - `check` mode (default): loads the baseline and either seeds it
 *     atomically (first run per archetype) or evaluates drift without
 *     touching the persisted file.
 *   - `update` mode: rewrites the baseline with the candidate ratios.
 *     Drift evaluation is skipped — the candidate becomes the new pin.
 */
export const syncCoverageBaselineForJob = async (
  input: SyncCoverageBaselineForJobInput,
): Promise<SyncCoverageBaselineForJobResult> => {
  assertStableSegment("tenantId", input.tenantId);
  assertStableSegment("archetype", input.archetype);
  assertNonEmpty("policyProfileId", input.policyProfileId);
  assertNonEmpty("generatedAt", input.generatedAt);

  const mode = input.mode ?? DEFAULT_COVERAGE_BASELINE_SYNC_MODE;
  const threshold = input.threshold ?? COVERAGE_BASELINE_DRIFT_THRESHOLD;

  if (mode === "update") {
    const record = buildCoverageBaselineRecord({
      tenantId: input.tenantId,
      archetype: input.archetype,
      policyProfileId: input.policyProfileId,
      generatedAt: input.generatedAt,
      ratios: input.candidateRatios,
    });
    const persistedPath = await writeCoverageBaseline({
      runtimeRoot: input.runtimeRoot,
      tenantId: input.tenantId,
      archetype: input.archetype,
      record,
    });
    return {
      evaluation: {
        tenantId: input.tenantId,
        archetype: input.archetype,
        policyProfileId: input.policyProfileId,
        threshold,
        seeded: true,
        exceeded: false,
        findings: [],
      },
      persistedPath,
    };
  }

  const baseline = await loadCoverageBaseline({
    runtimeRoot: input.runtimeRoot,
    tenantId: input.tenantId,
    archetype: input.archetype,
    policyProfileId: input.policyProfileId,
  });

  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: input.tenantId,
    archetype: input.archetype,
    policyProfileId: input.policyProfileId,
    candidateRatios: input.candidateRatios,
    threshold,
  });

  if (baseline === undefined) {
    const record = buildCoverageBaselineRecord({
      tenantId: input.tenantId,
      archetype: input.archetype,
      policyProfileId: input.policyProfileId,
      generatedAt: input.generatedAt,
      ratios: input.candidateRatios,
    });
    const persistedPath = await writeCoverageBaseline({
      runtimeRoot: input.runtimeRoot,
      tenantId: input.tenantId,
      archetype: input.archetype,
      record,
    });
    return { evaluation, persistedPath };
  }

  return { evaluation };
};

/**
 * Splice a {@link COVERAGE_BASELINE_DRIFT_RULE_ID} job-level violation
 * into an existing policy report when the supplied evaluation reports
 * `exceeded === true`. The returned report is a shallow copy with an
 * extended `jobLevelViolations` list; the input report is not mutated.
 *
 * Severity is `warning` so `report.blocked` is preserved as-is — the
 * decision class is `needs_review`, never auto-blocking.
 */
export const augmentPolicyReportWithCoverageDrift = (
  report: TestCasePolicyReport,
  evaluation: CoverageBaselineDriftEvaluation,
): TestCasePolicyReport => {
  const violation = buildCoverageDriftPolicyViolation(evaluation);
  if (violation === undefined) return report;
  return {
    ...report,
    jobLevelViolations: [...report.jobLevelViolations, violation],
  };
};
