/**
 * Release-quality-gates evaluator (Issue #1801).
 *
 * Adds four hard CI gates to `release:quality-gates`:
 *
 * 1. `mutationKillRate >= 0.85` against curated mutation fixtures.
 * 2. `promptCacheHitRate >= 0.7` across repair iterations 2..N.
 * 3. Tamper-detection round-trip 100% green per release job.
 * 4. `cacheBreakRate <= 5%`; spike attribution exposes the offending
 *    `querySource` so the diff-artifact review jumps straight to evidence.
 *
 * The evaluator is a pure function. The CLI runner under
 * `scripts/check-release-quality-gates.ts` produces and consumes the
 * canonical-JSON report this module defines.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_RELEASE_QUALITY_GATE_IDS,
  RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME,
  RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION,
  RELEASE_QUALITY_GATES_THRESHOLDS,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ReleaseQualityGateCacheBreakSample,
  type ReleaseQualityGateId,
  type ReleaseQualityGateMutationFixture,
  type ReleaseQualityGatePromptCacheRole,
  type ReleaseQualityGateTamperSample,
  type ReleaseQualityGateVerdict,
  type ReleaseQualityGatesInput,
  type ReleaseQualityGatesReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const ATTRIBUTION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0;

const isFiniteRate = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isAttributionLabel = (value: unknown): value is string =>
  typeof value === "string" && ATTRIBUTION_LABEL_PATTERN.test(value);

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUnique = (values: readonly string[]): readonly string[] => {
  const set = new Set<string>();
  for (const value of values) set.add(value);
  return [...set].sort(compareStrings);
};

const isMutationFixture = (
  value: unknown,
): value is ReleaseQualityGateMutationFixture => {
  if (!isRecord(value)) return false;
  if (!isAttributionLabel(value["fixtureId"])) return false;
  const mutationCount = value["mutationCount"];
  if (!isFiniteNonNegativeInteger(mutationCount)) return false;
  const killedMutations = value["killedMutations"];
  if (!isFiniteNonNegativeInteger(killedMutations)) return false;
  if (killedMutations > mutationCount) return false;
  if (!isFiniteRate(value["mutationKillRate"])) return false;
  const surviving = value["survivingMutationsForRepair"];
  if (!Array.isArray(surviving)) return false;
  for (const id of surviving) {
    if (!isAttributionLabel(id)) return false;
  }
  return true;
};

const isPromptCacheRole = (
  value: unknown,
): value is ReleaseQualityGatePromptCacheRole => {
  if (!isRecord(value)) return false;
  if (!isAttributionLabel(value["roleId"])) return false;
  if (!isFiniteNonNegativeInteger(value["iterationsCounted"])) return false;
  if (!isFiniteNonNegativeInteger(value["cacheHits"])) return false;
  if (!isFiniteNonNegativeInteger(value["cacheMisses"])) return false;
  if (!isFiniteRate(value["promptCacheHitRate"])) return false;
  return true;
};

const isTamperSample = (
  value: unknown,
): value is ReleaseQualityGateTamperSample => {
  if (!isRecord(value)) return false;
  if (!isAttributionLabel(value["sampleId"])) return false;
  if (typeof value["merkleChainVerified"] !== "boolean") return false;
  if (typeof value["headOfChainHashVerified"] !== "boolean") return false;
  if (typeof value["mlBomHashVerified"] !== "boolean") return false;
  return true;
};

const isCacheBreakSample = (
  value: unknown,
): value is ReleaseQualityGateCacheBreakSample => {
  if (!isRecord(value)) return false;
  if (!isAttributionLabel(value["querySource"])) return false;
  const responseCount = value["responseCount"];
  if (!isFiniteNonNegativeInteger(responseCount)) return false;
  const breakCount = value["breakCount"];
  if (!isFiniteNonNegativeInteger(breakCount)) return false;
  if (breakCount > responseCount) return false;
  const basenames = value["diffArtifactBasenames"];
  if (!Array.isArray(basenames)) return false;
  for (const basename of basenames) {
    if (!isAttributionLabel(basename)) return false;
  }
  return true;
};

/**
 * Hand-rolled validator for {@link ReleaseQualityGatesInput}. Returns
 * `false` on any malformed shape so the runner refuses unknown input
 * rather than silently passing the gate.
 */
export const isReleaseQualityGatesInput = (
  value: unknown,
): value is ReleaseQualityGatesInput => {
  if (!isRecord(value)) return false;
  if (value["schemaVersion"] !== RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION)
    return false;
  if (value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION)
    return false;
  if (!isAttributionLabel(value["releaseId"])) return false;

  const mutation = value["mutation"];
  if (!isRecord(mutation) || !Array.isArray(mutation["fixtures"])) return false;
  for (const fixture of mutation["fixtures"] as readonly unknown[]) {
    if (!isMutationFixture(fixture)) return false;
  }

  const promptCache = value["promptCache"];
  if (!isRecord(promptCache) || !Array.isArray(promptCache["roles"]))
    return false;
  for (const role of promptCache["roles"] as readonly unknown[]) {
    if (!isPromptCacheRole(role)) return false;
  }

  const tamper = value["tamper"];
  if (!isRecord(tamper) || !Array.isArray(tamper["samples"])) return false;
  for (const sample of tamper["samples"] as readonly unknown[]) {
    if (!isTamperSample(sample)) return false;
  }

  const cacheBreak = value["cacheBreak"];
  if (!isRecord(cacheBreak) || !Array.isArray(cacheBreak["samples"]))
    return false;
  for (const sample of cacheBreak["samples"] as readonly unknown[]) {
    if (!isCacheBreakSample(sample)) return false;
  }

  return true;
};

const aggregateMutationKillRate = (
  fixtures: readonly ReleaseQualityGateMutationFixture[],
): { rate: number; offenders: readonly string[] } => {
  if (fixtures.length === 0) {
    return { rate: 0, offenders: ["no_curated_fixtures"] };
  }
  let totalMutations = 0;
  let totalKilled = 0;
  const offenders: string[] = [];
  for (const fixture of fixtures) {
    totalMutations += fixture.mutationCount;
    totalKilled += fixture.killedMutations;
    const perFixtureRate =
      fixture.mutationCount === 0
        ? 0
        : fixture.killedMutations / fixture.mutationCount;
    if (
      perFixtureRate <
      RELEASE_QUALITY_GATES_THRESHOLDS.minMutationKillRate
    ) {
      offenders.push(fixture.fixtureId);
    }
  }
  const rate =
    totalMutations === 0 ? 0 : round6(totalKilled / totalMutations);
  return { rate, offenders: sortedUnique(offenders) };
};

const aggregatePromptCacheHitRate = (
  roles: readonly ReleaseQualityGatePromptCacheRole[],
): { rate: number; offenders: readonly string[] } => {
  // Issue #1801 measures repair iterations 2..N — the caller filters to
  // those rows. A role with `iterationsCounted === 0` contributes nothing
  // and is *not* attributed, so a role that never repaired does not
  // mask a real cache regression.
  const counted = roles.filter((role) => role.iterationsCounted > 0);
  if (counted.length === 0) {
    return { rate: 0, offenders: ["no_repair_iterations"] };
  }
  let totalHits = 0;
  let totalLookups = 0;
  const offenders: string[] = [];
  for (const role of counted) {
    totalHits += role.cacheHits;
    totalLookups += role.cacheHits + role.cacheMisses;
    const roleLookups = role.cacheHits + role.cacheMisses;
    const perRoleRate = roleLookups === 0 ? 0 : role.cacheHits / roleLookups;
    if (
      perRoleRate <
      RELEASE_QUALITY_GATES_THRESHOLDS.minPromptCacheHitRate
    ) {
      offenders.push(role.roleId);
    }
  }
  const rate = totalLookups === 0 ? 0 : round6(totalHits / totalLookups);
  return { rate, offenders: sortedUnique(offenders) };
};

const aggregateTamper = (
  samples: readonly ReleaseQualityGateTamperSample[],
): { passed: boolean; offenders: readonly string[] } => {
  if (samples.length === 0) {
    return { passed: false, offenders: ["no_release_jobs_sampled"] };
  }
  const offenders: string[] = [];
  for (const sample of samples) {
    if (
      !sample.merkleChainVerified ||
      !sample.headOfChainHashVerified ||
      !sample.mlBomHashVerified
    ) {
      offenders.push(sample.sampleId);
    }
  }
  return { passed: offenders.length === 0, offenders: sortedUnique(offenders) };
};

const aggregateCacheBreakRate = (
  samples: readonly ReleaseQualityGateCacheBreakSample[],
): { rate: number; offenders: readonly string[] } => {
  if (samples.length === 0) {
    // Rate 1 (100%) is the conservative worst-case sentinel: it naturally
    // fails the `lte` threshold check without needing out-of-range values
    // (which would break isFiniteRate validation in the parser). Attribution
    // explains the root cause.
    return { rate: 1, offenders: ["no_cache_break_samples"] };
  }
  let totalResponses = 0;
  let totalBreaks = 0;
  const offenders: string[] = [];
  for (const sample of samples) {
    totalResponses += sample.responseCount;
    totalBreaks += sample.breakCount;
    if (sample.responseCount === 0) continue;
    const rate = sample.breakCount / sample.responseCount;
    if (rate > RELEASE_QUALITY_GATES_THRESHOLDS.maxCacheBreakRate) {
      offenders.push(sample.querySource);
    }
  }
  const rate =
    totalResponses === 0 ? 0 : round6(totalBreaks / totalResponses);
  return { rate, offenders: sortedUnique(offenders) };
};

const buildVerdict = (
  gateId: ReleaseQualityGateId,
  observed: number,
  threshold: number,
  comparator: "gte" | "lte" | "eq",
  attribution: readonly string[],
): ReleaseQualityGateVerdict => {
  let passed: boolean;
  switch (comparator) {
    case "gte":
      passed = observed >= threshold;
      break;
    case "lte":
      passed = observed <= threshold;
      break;
    case "eq":
      passed = observed === threshold;
      break;
  }
  return {
    gateId,
    observed,
    threshold,
    comparator,
    passed,
    attribution: sortedUnique(attribution),
  };
};

/**
 * Pure evaluator. Computes the four release gate verdicts in a single
 * pass, then folds them into the canonical-JSON report. The report's
 * verdict order matches {@link ALLOWED_RELEASE_QUALITY_GATE_IDS} so a
 * reviewer can scan deterministically.
 */
export const evaluateReleaseQualityGates = (
  input: ReleaseQualityGatesInput,
): ReleaseQualityGatesReport => {
  if (!isReleaseQualityGatesInput(input)) {
    throw new TypeError(
      "evaluateReleaseQualityGates: input failed structural validation",
    );
  }
  const mutation = aggregateMutationKillRate(input.mutation.fixtures);
  const promptCache = aggregatePromptCacheHitRate(input.promptCache.roles);
  const tamper = aggregateTamper(input.tamper.samples);
  const cacheBreak = aggregateCacheBreakRate(input.cacheBreak.samples);

  const verdictsById = new Map<
    ReleaseQualityGateId,
    ReleaseQualityGateVerdict
  >();
  verdictsById.set(
    "mutation_kill_rate",
    buildVerdict(
      "mutation_kill_rate",
      mutation.rate,
      RELEASE_QUALITY_GATES_THRESHOLDS.minMutationKillRate,
      "gte",
      mutation.offenders,
    ),
  );
  verdictsById.set(
    "prompt_cache_hit_rate",
    buildVerdict(
      "prompt_cache_hit_rate",
      promptCache.rate,
      RELEASE_QUALITY_GATES_THRESHOLDS.minPromptCacheHitRate,
      "gte",
      promptCache.offenders,
    ),
  );
  verdictsById.set(
    "tamper_detection_round_trip",
    buildVerdict(
      "tamper_detection_round_trip",
      tamper.passed ? 1 : 0,
      1,
      "eq",
      tamper.offenders,
    ),
  );
  verdictsById.set(
    "cache_break_rate",
    buildVerdict(
      "cache_break_rate",
      cacheBreak.rate,
      RELEASE_QUALITY_GATES_THRESHOLDS.maxCacheBreakRate,
      "lte",
      cacheBreak.offenders,
    ),
  );

  const verdicts = ALLOWED_RELEASE_QUALITY_GATE_IDS.map((id) => {
    const verdict = verdictsById.get(id);
    if (!verdict) {
      throw new Error(
        `evaluateReleaseQualityGates: missing verdict for ${id}`,
      );
    }
    return verdict;
  });

  return {
    schemaVersion: RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    releaseId: input.releaseId,
    mutationKillRate: mutation.rate,
    promptCacheHitRate: promptCache.rate,
    tamperDetectionPassed: tamper.passed,
    cacheBreakRate: cacheBreak.rate,
    verdicts,
    passed: verdicts.every((verdict) => verdict.passed),
  };
};

/** Canonical-JSON byte payload for the report. */
export const serializeReleaseQualityGatesReport = (
  report: ReleaseQualityGatesReport,
): string => `${canonicalJson(report)}\n`;

/**
 * Strict parser. Returns `undefined` on any malformed payload so the
 * release pipeline cannot accept a half-written or hand-edited file.
 */
export const parseReleaseQualityGatesReport = (
  payload: string,
): ReleaseQualityGatesReport | undefined => {
  if (!payload.endsWith("\n")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed["schemaVersion"] !== RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION)
    return undefined;
  if (parsed["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION)
    return undefined;
  if (!isAttributionLabel(parsed["releaseId"])) return undefined;
  if (!isFiniteRate(parsed["mutationKillRate"])) return undefined;
  if (!isFiniteRate(parsed["promptCacheHitRate"])) return undefined;
  if (typeof parsed["tamperDetectionPassed"] !== "boolean") return undefined;
  if (!isFiniteRate(parsed["cacheBreakRate"])) return undefined;
  if (typeof parsed["passed"] !== "boolean") return undefined;
  if (!Array.isArray(parsed["verdicts"])) return undefined;
  const seenIds = new Set<string>();
  for (const verdict of parsed["verdicts"] as readonly unknown[]) {
    if (!isRecord(verdict)) return undefined;
    if (
      !(ALLOWED_RELEASE_QUALITY_GATE_IDS as readonly string[]).includes(
        verdict["gateId"] as string,
      )
    ) {
      return undefined;
    }
    if (seenIds.has(verdict["gateId"] as string)) return undefined;
    seenIds.add(verdict["gateId"] as string);
    if (typeof verdict["observed"] !== "number") return undefined;
    if (!Number.isFinite(verdict["observed"])) return undefined;
    if (typeof verdict["threshold"] !== "number") return undefined;
    if (!Number.isFinite(verdict["threshold"])) return undefined;
    if (
      verdict["comparator"] !== "gte" &&
      verdict["comparator"] !== "lte" &&
      verdict["comparator"] !== "eq"
    ) {
      return undefined;
    }
    if (typeof verdict["passed"] !== "boolean") return undefined;
    // Validate internal consistency: `passed` must match the comparator.
    const obs = verdict["observed"];
    const thr = verdict["threshold"];
    const cmp = verdict["comparator"] as string;
    const expectedPassed =
      cmp === "gte" ? obs >= thr : cmp === "lte" ? obs <= thr : obs === thr;
    if (verdict["passed"] !== expectedPassed) return undefined;
    if (!Array.isArray(verdict["attribution"])) return undefined;
    for (const label of verdict["attribution"] as readonly unknown[]) {
      if (!isAttributionLabel(label)) return undefined;
    }
  }
  if (seenIds.size !== ALLOWED_RELEASE_QUALITY_GATE_IDS.length) return undefined;
  // Validate top-level `passed` matches all verdict `passed` values.
  const allVerdictsPassed = (parsed["verdicts"] as readonly { passed: boolean }[]).every(
    (v) => v.passed,
  );
  if (parsed["passed"] !== allVerdictsPassed) return undefined;
  return parsed as unknown as ReleaseQualityGatesReport;
};

export interface WriteReleaseQualityGatesReportInput {
  readonly report: ReleaseQualityGatesReport;
  readonly runDir: string;
}

export interface WriteReleaseQualityGatesReportResult {
  readonly artifactPath: string;
  readonly serialized: string;
}

/**
 * Atomically write `<runDir>/release-quality-gates.json`. Uses the same
 * tmp + rename pattern as the rest of the test-intelligence persistence
 * layer so partial writes never become evidence.
 */
export const writeReleaseQualityGatesReport = async (
  input: WriteReleaseQualityGatesReportInput,
): Promise<WriteReleaseQualityGatesReportResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeReleaseQualityGatesReport: runDir must be a non-empty string",
    );
  }
  const serialized = serializeReleaseQualityGatesReport(input.report);
  const artifactPath = join(
    input.runDir,
    RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, serialized };
};
