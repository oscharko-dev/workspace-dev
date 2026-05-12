/**
 * Technique-quota gate (Issue #1942 + Issue #2068).
 *
 * Resolves the per-screen `policy:technique-coverage-minimum` quota and
 * compares the generated case list against it. The quota for the
 * `equivalence_partitioning` technique is tier-elastic by default: it
 * scales with the screen's coverage-relevant field count
 * ({@link TIER_ELASTIC_EP_TIERS}) instead of being trapped at the
 * planner's fixed `12` minimum on small-field screens. Customers that
 * contractually require a fixed floor opt into
 * `{ mode: "fixed" }` on a derived policy profile.
 *
 * The module is pure — no IO except the optional
 * {@link writeTechniqueQuotaReport} helper which writes a
 * byte-deterministic JSON artifact.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
  TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TIER_ELASTIC_EP_TIERS,
  type CoveragePlan,
  type GeneratedTestCase,
  type TechniqueCoverageMinimumMode,
  type TechniqueCoverageMinimumPolicy,
  type TechniqueCoverageMinimumTier,
  type TechniqueQuotaReport,
  type TechniqueQuotaReportEntry,
  type TestCaseTechnique29119,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export interface TechniqueQuotaDeficit {
  screenId: string;
  technique: TestCaseTechnique29119;
  minCount: number;
  actual: number;
  missing: number;
}

/** Default mode applied when the policy profile omits the override. */
const DEFAULT_TECHNIQUE_COVERAGE_MINIMUM_MODE: TechniqueCoverageMinimumMode =
  "tier-elastic";

/** Stable formula label used by `fixed` mode (no tiering applied). */
const FIXED_FORMULA_LABEL = "fixed:planner-quota" as const;
const FIXED_FORMULA_TIER = "planner-quota" as const;

/**
 * Defensive coercion of a (possibly undefined / non-array) value to a
 * read-only array. Mirrors the `safeArray` helper in `logic-judge.ts`
 * so the hard-gate can be invoked from operator-supplied inputs (test
 * fixtures, partial canonicalised plans) that may omit non-optional
 * contract fields without throwing.
 */
const safeArray = <T>(value: unknown): ReadonlyArray<T> =>
  Array.isArray(value) ? (value as ReadonlyArray<T>) : [];

/**
 * Resolve the active mode from a policy. `undefined` and unknown modes
 * fall back to {@link DEFAULT_TECHNIQUE_COVERAGE_MINIMUM_MODE} so a
 * legacy policy profile that predates Issue #2068 keeps working.
 */
export const resolveTechniqueCoverageMinimumMode = (
  policy: TechniqueCoverageMinimumPolicy | undefined,
): TechniqueCoverageMinimumMode =>
  policy?.mode ?? DEFAULT_TECHNIQUE_COVERAGE_MINIMUM_MODE;

const resolveTechniqueCoverageMinimumTiers = (
  policy: TechniqueCoverageMinimumPolicy | undefined,
): ReadonlyArray<TechniqueCoverageMinimumTier> =>
  policy?.mode === "tier-elastic" && policy.tiers !== undefined
    ? policy.tiers
    : TIER_ELASTIC_EP_TIERS;

/**
 * Tier-elastic equivalence-partitioning quota, derived from the screen's
 * coverage-relevant field count using {@link TIER_ELASTIC_EP_TIERS}.
 *
 * The result is `max(floor, ceil(multiplier * fieldCount))` where the
 * tier is chosen by the greatest `minFieldCount` less-than-or-equal to
 * `fieldCount`. The function is pure and total: a non-finite or negative
 * input is clamped to `0` to keep the deficit collector safe against
 * partial fixtures.
 */
export const computeTierElasticEquivalencePartitioningQuota = (
  fieldCount: number,
  tiers: ReadonlyArray<TechniqueCoverageMinimumTier> = TIER_ELASTIC_EP_TIERS,
): {
  quota: number;
  formula: string;
  formulaTier: string;
  formulaMultiplier: number;
} => {
  const safeCount =
    Number.isFinite(fieldCount) && fieldCount > 0 ? Math.floor(fieldCount) : 0;
  const safeTiers = tiers.length > 0 ? tiers : TIER_ELASTIC_EP_TIERS;
  const fallbackTier = safeTiers[0] ?? TIER_ELASTIC_EP_TIERS[0]!;
  if (safeCount === 0) {
    // A screen with zero coverage-relevant fields cannot be exercised
    // by EP cases, so the formula short-circuits to `0` instead of
    // tripping the tier-1 floor. The label is still emitted under the
    // tier-1 banner so the persisted report explains the path.
    return {
      quota: 0,
      formula: `tier-elastic:${fallbackTier.label}`,
      formulaTier: fallbackTier.label,
      formulaMultiplier: fallbackTier.multiplier,
    };
  }
  let selectedTier = fallbackTier;
  for (const tier of safeTiers) {
    if (safeCount >= tier.minFieldCount) {
      selectedTier = tier;
      continue;
    }
    break;
  }
  const candidate = Math.ceil(selectedTier.multiplier * safeCount);
  const quota = Math.max(selectedTier.floor, candidate);
  return {
    quota,
    formula: `tier-elastic:${selectedTier.label}`,
    formulaTier: selectedTier.label,
    formulaMultiplier: selectedTier.multiplier,
  };
};

/**
 * Per-screen coverage-relevant field count derived from
 * {@link CoveragePlan.perElement}. Each element entry counts once per
 * `(screenId, elementId)` pair; legacy fixtures missing the array
 * yield an empty map.
 */
export const buildPerScreenFieldCounts = (
  coveragePlan: CoveragePlan | undefined,
): ReadonlyMap<string, number> => {
  if (coveragePlan === undefined) return new Map();
  const counts = new Map<string, Set<string>>();
  for (const entry of safeArray<CoveragePlan["perElement"][number]>(
    coveragePlan.perElement,
  )) {
    const screenId = entry.screenId;
    if (typeof screenId !== "string" || screenId.length === 0) continue;
    const seen = counts.get(screenId) ?? new Set<string>();
    seen.add(entry.elementId);
    counts.set(screenId, seen);
  }
  return new Map(
    [...counts.entries()].map(([screenId, ids]) => [screenId, ids.size]),
  );
};

const buildPerScreenFieldTargets = (
  coveragePlan: CoveragePlan | undefined,
): ReadonlyMap<string, ReadonlySet<string>> => {
  if (coveragePlan === undefined) return new Map();
  const targets = new Map<string, Set<string>>();
  for (const entry of safeArray<CoveragePlan["perElement"][number]>(
    coveragePlan.perElement,
  )) {
    const screenId = entry.screenId;
    if (typeof screenId !== "string" || screenId.length === 0) continue;
    const seen = targets.get(screenId) ?? new Set<string>();
    seen.add(entry.elementId);
    targets.set(screenId, seen);
  }
  return new Map(targets);
};

interface ResolvedQuota {
  readonly screenId: string;
  readonly technique: TestCaseTechnique29119;
  readonly fieldCount: number;
  readonly requiredCount: number;
  readonly formula: string;
  readonly formulaTier: string;
  readonly formulaMultiplier: number | null;
}

/**
 * Apply the active mode to the planner's per-screen quotas.
 *
 *   - `fixed` mode preserves every quota row verbatim.
 *   - `tier-elastic` mode replaces the equivalence-partitioning quota
 *     with {@link computeTierElasticEquivalencePartitioningQuota}; rows
 *     for other techniques (use-case, accessibility, decision-table,
 *     boundary-value-analysis, …) keep the planner's published
 *     `minCount`. Conservative scope is unchanged from Issue #2068:
 *     when the planner omits an EP row entirely, the gate does not
 *     synthesise one.
 *
 * Pure. Returns rows sorted by `(screenId, technique)`.
 */
export const resolveTechniqueQuotas = (
  coveragePlan: CoveragePlan | undefined,
  policy: TechniqueCoverageMinimumPolicy | undefined,
): ReadonlyArray<ResolvedQuota> => {
  if (coveragePlan === undefined) return [];
  const mode = resolveTechniqueCoverageMinimumMode(policy);
  const tiers = resolveTechniqueCoverageMinimumTiers(policy);
  const fieldCounts = buildPerScreenFieldCounts(coveragePlan);
  const perScreen = safeArray<CoveragePlan["perScreen"][number]>(
    coveragePlan.perScreen,
  );
  const resolved: ResolvedQuota[] = [];

  for (const screen of perScreen) {
    const fieldCount = fieldCounts.get(screen.screenId) ?? 0;
    const screenQuotas = safeArray<
      CoveragePlan["perScreen"][number]["techniqueQuotas"][number]
    >(screen.techniqueQuotas);
    for (const quota of screenQuotas) {
      if (quota.minCount <= 0) continue;
      if (
        mode === "tier-elastic" &&
        quota.technique === "equivalence_partitioning"
      ) {
        const tier = computeTierElasticEquivalencePartitioningQuota(
          fieldCount,
          tiers,
        );
        // Tier-elastic mode RELAXES the planner's published EP quota
        // when the formula yields a lower number — it never raises
        // it. This preserves byte-for-byte backwards compatibility on
        // datasets where the planner already published a tight, well-
        // sized minimum (the formula would otherwise overshoot to the
        // tier floor and force the repair loop into spurious iterations).
        const effective = Math.min(quota.minCount, tier.quota);
        resolved.push({
          screenId: screen.screenId,
          technique: quota.technique,
          fieldCount,
          requiredCount: effective,
          formula:
            effective === tier.quota
              ? tier.formula
              : FIXED_FORMULA_LABEL,
          formulaTier: tier.formulaTier,
          formulaMultiplier: tier.formulaMultiplier,
        });
        continue;
      }
      resolved.push({
        screenId: screen.screenId,
        technique: quota.technique,
        fieldCount,
        requiredCount: quota.minCount,
        formula: FIXED_FORMULA_LABEL,
        formulaTier: FIXED_FORMULA_TIER,
        formulaMultiplier: null,
      });
    }
  }

  return resolved.sort(
    (left, right) =>
      left.screenId.localeCompare(right.screenId) ||
      left.technique.localeCompare(right.technique) ||
      left.requiredCount - right.requiredCount,
  );
};

const countAnchored = (
  cases: ReadonlyArray<GeneratedTestCase>,
  screenId: string,
  technique: TestCaseTechnique29119,
): number => {
  let total = 0;
  for (const testCase of cases) {
    if (testCase.technique !== technique) continue;
    if (
      !testCase.figmaTraceRefs.some(
        (traceRef) => traceRef.screenId === screenId,
      )
    ) {
      continue;
    }
    total += 1;
  }
  return total;
};

const countAnchoredCoveredFieldTargets = (
  cases: ReadonlyArray<GeneratedTestCase>,
  screenId: string,
  technique: TestCaseTechnique29119 | undefined,
  targets: ReadonlySet<string>,
): number => {
  if (targets.size === 0) return 0;
  const covered = new Set<string>();
  for (const testCase of cases) {
    if (technique !== undefined && testCase.technique !== technique) continue;
    if (
      !testCase.figmaTraceRefs.some(
        (traceRef) => traceRef.screenId === screenId,
      )
    ) {
      continue;
    }
    for (const fieldId of testCase.qualitySignals.coveredFieldIds) {
      if (targets.has(fieldId)) covered.add(fieldId);
    }
  }
  if (covered.size === 0 && targets.size === 1) {
    return cases.some(
      (testCase) =>
        (technique === undefined || testCase.technique === technique) &&
        testCase.qualitySignals.coveredFieldIds.length > 0 &&
        testCase.figmaTraceRefs.some((traceRef) => traceRef.screenId === screenId),
    )
      ? 1
      : 0;
  }
  return covered.size;
};

/**
 * Compare generated cases to per-screen policy-resolved quotas.
 *
 * The third argument is the policy profile knob from Issue #2068. When
 * omitted the function falls back to the secure default
 * (`tier-elastic`), which preserves backwards compatibility with the
 * pre-#2068 single-arg call sites.
 *
 * Anchoring semantics are unchanged: only cases whose `figmaTraceRefs`
 * include the target `screenId` count toward that screen's minimum.
 */
export const collectTechniqueQuotaDeficits = (
  cases: ReadonlyArray<GeneratedTestCase>,
  coveragePlan: CoveragePlan | undefined,
  policy?: TechniqueCoverageMinimumPolicy,
): TechniqueQuotaDeficit[] => {
  if (coveragePlan === undefined) return [];
  const deficits: TechniqueQuotaDeficit[] = [];
  const fieldTargets = buildPerScreenFieldTargets(coveragePlan);
  for (const quota of resolveTechniqueQuotas(coveragePlan, policy)) {
    if (quota.requiredCount <= 0) continue;
    const actual = countAnchored(cases, quota.screenId, quota.technique);
    if (quota.technique === "equivalence_partitioning") {
      const coveredFieldCount = countAnchoredCoveredFieldTargets(
        cases,
        quota.screenId,
        undefined,
        fieldTargets.get(quota.screenId) ?? new Set<string>(),
      );
      if (coveredFieldCount >= quota.fieldCount && quota.fieldCount > 0) {
        continue;
      }
    }
    if (actual >= quota.requiredCount) continue;
    deficits.push({
      screenId: quota.screenId,
      technique: quota.technique,
      minCount: quota.requiredCount,
      actual,
      missing: quota.requiredCount - actual,
    });
  }
  return deficits;
};

export interface BuildTechniqueQuotaReportInput {
  readonly generatedAt: string;
  readonly jobId: string;
  readonly policyProfileId: string;
  readonly cases: ReadonlyArray<GeneratedTestCase>;
  readonly coveragePlan: CoveragePlan;
  readonly policy?: TechniqueCoverageMinimumPolicy;
}

/**
 * Build a deterministic per-run {@link TechniqueQuotaReport} that
 * captures the resolution path of every `(screen, technique)` pair the
 * gate enforces this run.
 *
 * Pure. Sorted by `(screenId, technique)` so the persisted artifact is
 * byte-stable.
 */
export const buildTechniqueQuotaReport = (
  input: BuildTechniqueQuotaReportInput,
): TechniqueQuotaReport => {
  const mode = resolveTechniqueCoverageMinimumMode(input.policy);
  const resolved = resolveTechniqueQuotas(input.coveragePlan, input.policy);
  const fieldTargets = buildPerScreenFieldTargets(input.coveragePlan);
  const screens = new Set<string>();
  let passCount = 0;
  let deficitCount = 0;
  const entries: TechniqueQuotaReportEntry[] = [];
  for (const quota of resolved) {
    screens.add(quota.screenId);
    const actualCount = countAnchored(
      input.cases,
      quota.screenId,
      quota.technique,
    );
    const coveredFieldCount =
      quota.technique === "equivalence_partitioning"
        ? countAnchoredCoveredFieldTargets(
            input.cases,
            quota.screenId,
            undefined,
            fieldTargets.get(quota.screenId) ?? new Set<string>(),
          )
        : 0;
    const status: TechniqueQuotaReportEntry["status"] =
      actualCount >= quota.requiredCount ||
      (quota.technique === "equivalence_partitioning" &&
        quota.fieldCount > 0 &&
        coveredFieldCount >= quota.fieldCount)
        ? "pass"
        : "deficit";
    if (status === "pass") passCount += 1;
    else deficitCount += 1;
    entries.push({
      screenId: quota.screenId,
      technique: quota.technique,
      fieldCount: quota.fieldCount,
      requiredCount: quota.requiredCount,
      actualCount,
      formula: quota.formula,
      formulaTier: quota.formulaTier,
      formulaMultiplier: quota.formulaMultiplier,
      mode,
      status,
    });
  }

  return {
    schemaVersion: TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.policyProfileId,
    mode,
    screenCount: screens.size,
    entryCount: entries.length,
    passCount,
    deficitCount,
    entries,
  };
};

export interface WriteTechniqueQuotaReportInput {
  readonly runDir: string;
  readonly artifact: TechniqueQuotaReport;
}

/**
 * Persist the report under
 * `${runDir}/${TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME}`.
 *
 * Atomic via tmp-then-rename. Returns the resolved path and emitted
 * byte buffer so callers can hash or upload the artifact.
 */
export const writeTechniqueQuotaReport = async (
  input: WriteTechniqueQuotaReportInput,
): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const filePath = join(
    input.runDir,
    TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = Buffer.from(canonicalJson(input.artifact), "utf8");
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
  return { path: filePath, bytes };
};
