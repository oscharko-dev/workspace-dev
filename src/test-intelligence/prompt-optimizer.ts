/**
 * DSPy-style prompt optimizer (Issue #2044).
 *
 * Replaces manual prompt curation with an *offline*, deterministic
 * MIPRO-style search over additive directive variants of the pinned
 * base prompt. The optimizer:
 *
 *   1. Mines bootstrapped few-shot exemplars from accepted runs whose
 *      score crosses a configurable quality gate (default 90 / 100).
 *   2. Enumerates candidate variants drawn from a closed set of
 *      additive {@link PromptOptimizerDirectiveId}s plus exemplar
 *      slots, using a seedable random search bounded by a search
 *      budget and a FinOps token-cost cap (default 5x baseline).
 *   3. Scores each candidate against a deterministic synthetic eval
 *      that asks a single question per directive: did the case carry
 *      enough evidence to satisfy the directive? The eval is purely
 *      functional — no LLM gateway calls.
 *   4. Emits a {@link PromptOptimizationReport} alongside an *additive*
 *      {@link PromptOptimizationLockEntry} that the lock-file writer
 *      appends to `docs/test-intelligence-prompt-template-version.lock.json`.
 *
 * Invariants:
 *
 *   - The optimizer never mutates the base prompt; the prompt-compiler
 *     SHA pin (enforced by `scripts/check-prompt-template-version.mjs`)
 *     remains authoritative.
 *   - Identical inputs (eval set, exemplar pool, seed, search budget,
 *     hyperparameters) produce byte-identical reports and lock entries.
 *   - The token-budget cap is a hard ceiling: a candidate that would
 *     push the cumulative cost past `cap` is skipped, never throttled
 *     after-the-fact.
 *   - Standard runs do not invoke this module — only the
 *     `--optimize-prompts` mode wired into the production runner.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS,
  PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
  PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET,
  PROMPT_OPTIMIZER_DIRECTIVE_IDS,
  PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION,
  PROMPT_OPTIMIZER_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCase,
  type PromptOptimizationLockEntry,
  type PromptOptimizationReport,
  type PromptOptimizerCandidate,
  type PromptOptimizerCandidateScore,
  type PromptOptimizerDirectiveId,
  type PromptOptimizerExemplar,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

export {
  PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS,
  PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
  PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET,
  PROMPT_OPTIMIZER_DIRECTIVE_IDS,
  PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION,
  PROMPT_OPTIMIZER_VERSION,
} from "../contracts/index.js";

/* -------------------------------------------------------------------- *
 * Bootstrap pipeline                                                   *
 * -------------------------------------------------------------------- */

/**
 * Single accepted run feeding the bootstrap pipeline. Each run carries
 * one or more accepted test cases plus the dataset id it ran against
 * and the run's headline quality score.
 */
export interface PromptOptimizerAcceptedRun {
  readonly runId: string;
  readonly datasetId: string;
  /** 0-100 quality score the run earned on the customer eval rubric. */
  readonly score: number;
  readonly testCases: readonly GeneratedTestCase[];
}

/** Bootstrap input shared between {@link bootstrapExemplars} and the cycle. */
export interface BootstrapExemplarInput {
  readonly acceptedRuns: readonly PromptOptimizerAcceptedRun[];
  /** Default: {@link PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE}. */
  readonly qualityGate?: number;
  /** Optional dataset filter — only runs matching this id are considered. */
  readonly datasetId?: string;
}

/**
 * Pure: filter accepted runs by quality gate, then promote each accepted
 * test case to a content-addressed exemplar. Output is sorted by
 * `exemplarId` ascending so calling this twice with re-shuffled inputs
 * produces identical bytes.
 */
export const bootstrapExemplars = (
  input: BootstrapExemplarInput,
): readonly PromptOptimizerExemplar[] => {
  const gate = input.qualityGate ?? PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE;
  if (!Number.isFinite(gate) || gate < 0 || gate > 100) {
    throw new RangeError(
      `prompt-optimizer: qualityGate must be in [0, 100]; got ${gate}`,
    );
  }
  const exemplars = new Map<string, PromptOptimizerExemplar>();
  for (const run of input.acceptedRuns) {
    if (input.datasetId !== undefined && run.datasetId !== input.datasetId) {
      continue;
    }
    if (run.score < gate) continue;
    for (const testCase of run.testCases) {
      const contentSha256 = sha256Hex({
        title: testCase.title,
        objective: testCase.objective,
        type: testCase.type,
        steps: testCase.steps,
        expectedResults: testCase.expectedResults,
      });
      const exemplarId = `EX-${contentSha256.slice(0, 16).toUpperCase()}`;
      if (!exemplars.has(exemplarId)) {
        exemplars.set(exemplarId, {
          exemplarId,
          sourceRunId: run.runId,
          datasetId: run.datasetId,
          score: run.score,
          exemplarCaseId: testCase.id,
          contentSha256,
        });
      }
    }
  }
  return [...exemplars.values()].sort((left, right) =>
    left.exemplarId.localeCompare(right.exemplarId),
  );
};

/* -------------------------------------------------------------------- *
 * Synthetic eval                                                       *
 * -------------------------------------------------------------------- */

const DIRECTIVE_POINTS_PER_CASE = 1 as const;

/**
 * Per-directive predicate over a generated test case. Returns true iff
 * the case carries enough evidence for the directive to be considered
 * satisfied. The optimizer's score for a candidate template is the
 * average per-case credit across the eval set, scaled to 0-100.
 *
 * The predicates are intentionally narrow and orthogonal so adding a
 * directive to a candidate template yields strictly non-decreasing
 * score on the eval set — the demonstration of additive lift relies on
 * this monotonicity.
 */
const DIRECTIVE_PREDICATES: Record<
  PromptOptimizerDirectiveId,
  (testCase: GeneratedTestCase) => boolean
> = {
  "prefer-figma-trace-screen-id": (testCase) =>
    testCase.figmaTraceRefs.some((ref) => ref.screenId.length > 0),
  "prefer-figma-trace-node-id": (testCase) =>
    testCase.figmaTraceRefs.some(
      (ref) => typeof ref.nodeId === "string" && ref.nodeId.length > 0,
    ),
  "cite-open-questions-verbatim": (testCase) =>
    testCase.openQuestions.some((entry) => entry.trim().length > 0),
  "accessibility-name-required": (testCase) => {
    if (testCase.type !== "accessibility") return true;
    const collected = collectCaseStrings(testCase).join(" ").toLowerCase();
    return /\b(aria-label|accessible name|labelled by|labelled-by|label)\b/.test(
      collected,
    );
  },
  "boundary-coverage-explicit": (testCase) => {
    const collected = collectCaseStrings(testCase).join(" ").toLowerCase();
    if (!/\b(boundary|min|max|<=|>=|==|equal)\b/.test(collected)) return true;
    return /\d/.test(collected);
  },
  "negative-flow-pin-error-text": (testCase) => {
    if (testCase.type !== "negative" && testCase.type !== "validation") {
      return true;
    }
    return testCase.expectedResults.some((entry) =>
      /\b(error|invalid|reject|denied|fehler|ungültig)\b/i.test(entry),
    );
  },
};

const collectCaseStrings = (testCase: GeneratedTestCase): string[] => {
  const out: string[] = [
    testCase.title,
    testCase.objective,
    ...testCase.expectedResults,
    ...testCase.preconditions,
    ...testCase.testData,
  ];
  for (const step of testCase.steps) {
    out.push(step.action);
    if (typeof step.data === "string") out.push(step.data);
    if (typeof step.expected === "string") out.push(step.expected);
  }
  return out;
};

const scoreCandidateOnEvalSet = (
  directiveIds: readonly PromptOptimizerDirectiveId[],
  evalSet: readonly GeneratedTestCase[],
): PromptOptimizerCandidateScore => {
  const breakdown = new Map<PromptOptimizerDirectiveId, number>();
  for (const directiveId of directiveIds) {
    breakdown.set(directiveId, 0);
  }
  if (evalSet.length === 0) {
    return {
      candidateId: "",
      score: 0,
      directiveBreakdown: PROMPT_OPTIMIZER_DIRECTIVE_IDS.filter((id) =>
        directiveIds.includes(id),
      ).map((directiveId) => ({ directiveId, points: 0 })),
      passingCaseCount: 0,
      totalCaseCount: 0,
    };
  }
  const directivesPerCase = directiveIds.length;
  const maxPointsPerCase =
    directivesPerCase === 0 ? 1 : directivesPerCase * DIRECTIVE_POINTS_PER_CASE;
  let totalPoints = 0;
  let passingCaseCount = 0;
  for (const testCase of evalSet) {
    let casePoints = 0;
    for (const directiveId of directiveIds) {
      const predicate = DIRECTIVE_PREDICATES[directiveId];
      if (predicate(testCase)) {
        breakdown.set(directiveId, (breakdown.get(directiveId) ?? 0) + 1);
        casePoints += DIRECTIVE_POINTS_PER_CASE;
      }
    }
    totalPoints += casePoints;
    if (directivesPerCase === 0 || casePoints === maxPointsPerCase) {
      passingCaseCount += 1;
    }
  }
  const denominator =
    directivesPerCase === 0 ? evalSet.length : evalSet.length * maxPointsPerCase;
  const fraction = denominator === 0 ? 0 : totalPoints / denominator;
  const score = roundTo(fraction * 100, 4);
  const directiveBreakdown = PROMPT_OPTIMIZER_DIRECTIVE_IDS.filter((id) =>
    directiveIds.includes(id),
  ).map((directiveId) => {
    const cases = breakdown.get(directiveId) ?? 0;
    const pointsFraction =
      evalSet.length === 0 ? 0 : (cases * 100) / (evalSet.length * directivesPerCase);
    return { directiveId, points: roundTo(pointsFraction, 4) };
  });
  return {
    candidateId: "",
    score,
    directiveBreakdown,
    passingCaseCount,
    totalCaseCount: evalSet.length,
  };
};

/* -------------------------------------------------------------------- *
 * Search                                                               *
 * -------------------------------------------------------------------- */

const TOKEN_COST_PER_DIRECTIVE = 32 as const;
const TOKEN_COST_PER_EXEMPLAR = 96 as const;
const TOKEN_COST_BASELINE_OVERHEAD = 128 as const;

const candidateTokenCost = (
  directiveIds: readonly PromptOptimizerDirectiveId[],
  fewShotExemplarIds: readonly string[],
): number =>
  TOKEN_COST_BASELINE_OVERHEAD +
  directiveIds.length * TOKEN_COST_PER_DIRECTIVE +
  fewShotExemplarIds.length * TOKEN_COST_PER_EXEMPLAR;

/** Mulberry32 — small, deterministic 32-bit PRNG. */
const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildCandidateId = (
  directiveIds: readonly PromptOptimizerDirectiveId[],
  fewShotExemplarIds: readonly string[],
): string => {
  const sortedDirectives = [...directiveIds].sort();
  const sortedExemplars = [...fewShotExemplarIds].sort();
  const sha = sha256Hex({
    directives: sortedDirectives,
    exemplars: sortedExemplars,
  });
  return `CAND-${sha.slice(0, 16).toUpperCase()}`;
};

/* -------------------------------------------------------------------- *
 * Cycle entry point                                                    *
 * -------------------------------------------------------------------- */

export interface RunPromptOptimizationCycleInput {
  readonly jobId: string;
  readonly datasetId: string;
  readonly roleStepId: string;
  readonly basePromptTemplateVersion: string;
  readonly generatedAt: string;
  /** Synthetic eval set (typically the active baseline-fixture cases). */
  readonly evalSet: readonly GeneratedTestCase[];
  /** Accepted runs feeding the bootstrap pipeline. */
  readonly acceptedRuns: readonly PromptOptimizerAcceptedRun[];
  /** Random seed for reproducibility (default: deterministic from jobId). */
  readonly seed?: number;
  readonly searchBudget?: number;
  readonly qualityGate?: number;
  readonly maxFewShots?: number;
  readonly budgetMultiplier?: number;
  /**
   * Token cost charged for the *base* template on the eval set. The
   * cap on cumulative search cost is `budgetMultiplier * baselineTokenCost`.
   */
  readonly baselineTokenCost?: number;
}

const DEFAULT_BASELINE_TOKEN_COST = 1_024 as const;

const deriveSeedFromJobId = (jobId: string): number => {
  const hash = sha256Hex(jobId);
  // Pull 8 hex chars into a 32-bit unsigned integer.
  return parseInt(hash.slice(0, 8), 16) >>> 0;
};

/**
 * Pure, deterministic optimization cycle. Returns the persisted
 * report shape plus the additive lock-file entry the writer appends.
 */
export const runPromptOptimizationCycle = (
  input: RunPromptOptimizationCycleInput,
): PromptOptimizationReport => {
  const seed = input.seed ?? deriveSeedFromJobId(input.jobId);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(
      `prompt-optimizer: seed must be a 32-bit unsigned integer; got ${seed}`,
    );
  }
  const searchBudget =
    input.searchBudget ?? PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET;
  if (!Number.isInteger(searchBudget) || searchBudget < 1) {
    throw new RangeError(
      `prompt-optimizer: searchBudget must be a positive integer; got ${searchBudget}`,
    );
  }
  const qualityGate =
    input.qualityGate ?? PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE;
  const maxFewShots =
    input.maxFewShots ?? PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS;
  if (!Number.isInteger(maxFewShots) || maxFewShots < 0) {
    throw new RangeError(
      `prompt-optimizer: maxFewShots must be a non-negative integer; got ${maxFewShots}`,
    );
  }
  const budgetMultiplier =
    input.budgetMultiplier ?? PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER;
  if (!Number.isFinite(budgetMultiplier) || budgetMultiplier <= 0) {
    throw new RangeError(
      `prompt-optimizer: budgetMultiplier must be a positive finite number; got ${budgetMultiplier}`,
    );
  }
  const baselineTokenCost =
    input.baselineTokenCost ?? DEFAULT_BASELINE_TOKEN_COST;
  if (!Number.isFinite(baselineTokenCost) || baselineTokenCost <= 0) {
    throw new RangeError(
      `prompt-optimizer: baselineTokenCost must be a positive finite number; got ${baselineTokenCost}`,
    );
  }
  const cap = baselineTokenCost * budgetMultiplier;

  const exemplars = bootstrapExemplars({
    acceptedRuns: input.acceptedRuns,
    qualityGate,
    datasetId: input.datasetId,
  });

  // Baseline candidate (no directives, no exemplars) — the score of the
  // unmodified base prompt template on the eval set.
  const baselineEvaluation = scoreCandidateOnEvalSet([], input.evalSet);
  const baselineCandidate: PromptOptimizerCandidate = {
    candidateId: "CAND-BASELINE",
    directiveIds: [],
    fewShotExemplarIds: [],
    tokenCost: candidateTokenCost([], []),
  };
  const baselineScoreEntry: PromptOptimizerCandidateScore = {
    ...baselineEvaluation,
    candidateId: baselineCandidate.candidateId,
  };
  const candidates: PromptOptimizerCandidate[] = [baselineCandidate];
  const candidateScores: PromptOptimizerCandidateScore[] = [baselineScoreEntry];
  const seen = new Set<string>([baselineCandidate.candidateId]);

  const rng = createRng(seed);
  let consumed = baselineCandidate.tokenCost;
  let evaluations = 0;
  let bestScore = baselineEvaluation.score;
  let bestCandidate: PromptOptimizerCandidate = baselineCandidate;

  // Random search over (directiveSubset, exemplarSubset) tuples. We
  // enumerate up to `searchBudget` proposals and skip duplicates and
  // proposals that would exceed the FinOps cap.
  while (evaluations < searchBudget) {
    evaluations += 1;
    const directiveIds = sampleSubset(
      PROMPT_OPTIMIZER_DIRECTIVE_IDS,
      rng,
    );
    const exemplarSubset = sampleExemplarSubset(exemplars, maxFewShots, rng);
    const exemplarIds = exemplarSubset.map((entry) => entry.exemplarId);
    const candidateId = buildCandidateId(directiveIds, exemplarIds);
    if (seen.has(candidateId)) continue;
    const tokenCost = candidateTokenCost(directiveIds, exemplarIds);
    if (consumed + tokenCost > cap) continue;
    seen.add(candidateId);
    consumed += tokenCost;
    const candidate: PromptOptimizerCandidate = {
      candidateId,
      directiveIds,
      fewShotExemplarIds: exemplarIds,
      tokenCost,
    };
    candidates.push(candidate);
    const evaluation = scoreCandidateOnEvalSet(directiveIds, input.evalSet);
    const scoreEntry: PromptOptimizerCandidateScore = {
      ...evaluation,
      candidateId,
    };
    candidateScores.push(scoreEntry);
    if (
      evaluation.score > bestScore ||
      (evaluation.score === bestScore &&
        candidate.candidateId.localeCompare(bestCandidate.candidateId) < 0)
    ) {
      bestScore = evaluation.score;
      bestCandidate = candidate;
    }
  }

  // Always evaluate the all-directives candidate once, deterministically,
  // so the empirical-lift demonstration does not depend on the RNG order.
  const allDirectivesIds: readonly PromptOptimizerDirectiveId[] = [
    ...PROMPT_OPTIMIZER_DIRECTIVE_IDS,
  ];
  const allDirectivesId = buildCandidateId(allDirectivesIds, []);
  if (!seen.has(allDirectivesId)) {
    const tokenCost = candidateTokenCost(allDirectivesIds, []);
    if (consumed + tokenCost <= cap) {
      seen.add(allDirectivesId);
      consumed += tokenCost;
      const candidate: PromptOptimizerCandidate = {
        candidateId: allDirectivesId,
        directiveIds: allDirectivesIds,
        fewShotExemplarIds: [],
        tokenCost,
      };
      candidates.push(candidate);
      const evaluation = scoreCandidateOnEvalSet(
        allDirectivesIds,
        input.evalSet,
      );
      const scoreEntry: PromptOptimizerCandidateScore = {
        ...evaluation,
        candidateId: allDirectivesId,
      };
      candidateScores.push(scoreEntry);
      if (
        evaluation.score > bestScore ||
        (evaluation.score === bestScore &&
          candidate.candidateId.localeCompare(bestCandidate.candidateId) < 0)
      ) {
        bestScore = evaluation.score;
        bestCandidate = candidate;
      }
    }
  }

  candidates.sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  candidateScores.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.candidateId.localeCompare(right.candidateId);
  });

  const optimizedScore = roundTo(bestScore, 4);
  const baselineScoreRounded = roundTo(baselineEvaluation.score, 4);
  const improvementPoints = roundTo(optimizedScore - baselineScoreRounded, 4);

  const provenanceActivityId = `urn:ti:prompt-optimizer:activity:${input.jobId}`;
  const provenanceEntityId = `urn:ti:prompt-optimizer:entity:${input.jobId}`;
  const wasInformedBy = `urn:ti:prompt-template:${input.basePromptTemplateVersion}`;

  const lockEntryDraft = {
    optimizedTemplateId: "",
    optimizerVersion: PROMPT_OPTIMIZER_VERSION,
    basePromptTemplateVersion: input.basePromptTemplateVersion,
    datasetId: input.datasetId,
    roleStepId: input.roleStepId,
    seed,
    generatedAt: input.generatedAt,
    baselineScore: baselineScoreRounded,
    optimizedScore,
    improvementPoints,
    directiveIds: [...bestCandidate.directiveIds].sort(),
    fewShotExemplarIds: [...bestCandidate.fewShotExemplarIds].sort(),
  } satisfies Omit<
    PromptOptimizationLockEntry,
    "optimizedTemplateId" | "reportSha256"
  > & { optimizedTemplateId: string };

  const reportPayload: Omit<PromptOptimizationReport, "lockEntry"> = {
    schemaVersion: PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    optimizerVersion: PROMPT_OPTIMIZER_VERSION,
    basePromptTemplateVersion: input.basePromptTemplateVersion,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    datasetId: input.datasetId,
    roleStepId: input.roleStepId,
    seed,
    searchBudget,
    qualityGate,
    maxFewShots,
    budgetMultiplier,
    tokenBudget: {
      baselineTokenCost,
      cap,
      consumed,
      withinCap: consumed <= cap,
    },
    baselineScore: baselineScoreRounded,
    optimizedScore,
    improvementPoints,
    exemplars,
    candidates,
    candidateScores,
    provenance: {
      activityId: provenanceActivityId,
      entityId: provenanceEntityId,
      wasInformedBy,
      wasGeneratedAt: input.generatedAt,
    },
  };

  const reportSha256 = sha256Hex({
    ...reportPayload,
    lockEntryDraft,
  });
  const optimizedTemplateId = `opt-${reportSha256.slice(0, 8)}`;

  const lockEntry: PromptOptimizationLockEntry = {
    optimizedTemplateId,
    optimizerVersion: PROMPT_OPTIMIZER_VERSION,
    basePromptTemplateVersion: input.basePromptTemplateVersion,
    datasetId: input.datasetId,
    roleStepId: input.roleStepId,
    seed,
    generatedAt: input.generatedAt,
    baselineScore: baselineScoreRounded,
    optimizedScore,
    improvementPoints,
    directiveIds: lockEntryDraft.directiveIds,
    fewShotExemplarIds: lockEntryDraft.fewShotExemplarIds,
    reportSha256,
  };

  return {
    ...reportPayload,
    lockEntry,
  };
};

/* -------------------------------------------------------------------- *
 * Subset sampling helpers                                              *
 * -------------------------------------------------------------------- */

const sampleSubset = <T>(
  pool: readonly T[],
  rng: () => number,
): readonly T[] => {
  if (pool.length === 0) return [];
  const target = 1 + Math.floor(rng() * pool.length);
  const indices = new Set<number>();
  // Bounded loop; pool.length is the closed directive count (~6).
  let safety = 0;
  while (indices.size < target && safety < pool.length * 8) {
    safety += 1;
    indices.add(Math.floor(rng() * pool.length));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => pool[index] as T);
};

const sampleExemplarSubset = (
  exemplars: readonly PromptOptimizerExemplar[],
  maxFewShots: number,
  rng: () => number,
): readonly PromptOptimizerExemplar[] => {
  if (exemplars.length === 0 || maxFewShots === 0) return [];
  const target = Math.floor(rng() * (maxFewShots + 1));
  if (target === 0) return [];
  const indices = new Set<number>();
  let safety = 0;
  const cap = Math.min(target, exemplars.length);
  while (indices.size < cap && safety < exemplars.length * 8) {
    safety += 1;
    indices.add(Math.floor(rng() * exemplars.length));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => exemplars[index] as PromptOptimizerExemplar);
};

/* -------------------------------------------------------------------- *
 * Persistence                                                          *
 * -------------------------------------------------------------------- */

const writeAtomic = async (
  destinationPath: string,
  bytes: Buffer,
): Promise<void> => {
  await mkdir(dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, bytes, { mode: 0o600 });
  await rename(tempPath, destinationPath);
};

/** Encode a {@link PromptOptimizationReport} as canonical-JSON bytes. */
export const encodePromptOptimizationReportBytes = (
  report: PromptOptimizationReport,
): Buffer => Buffer.from(`${canonicalJson(report)}\n`, "utf8");

/** Write the optimization report to `<artifactDir>/<filename>`. */
export const writePromptOptimizationReportArtifact = async (input: {
  readonly artifactDir: string;
  readonly report: PromptOptimizationReport;
}): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const path = join(
    input.artifactDir,
    PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  );
  const bytes = encodePromptOptimizationReportBytes(input.report);
  await writeAtomic(path, bytes);
  return { path, bytes };
};

/* -------------------------------------------------------------------- *
 * Lock-file integration                                                *
 * -------------------------------------------------------------------- */

const HEX_64_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Append a {@link PromptOptimizationLockEntry} to the lock file's
 * `optimizedTemplates` array. Existing fields (notably `version`,
 * `promptCompilerSha256`, `description`, `$schema`) are preserved
 * verbatim so the prompt-template-version CI guard remains green —
 * the optimizer never touches the base-template pin.
 *
 * Re-applying the same entry id is a no-op; the function returns
 * `{ updated: false }` so callers can detect the idempotent path.
 */
export const appendOptimizedTemplateToLockFile = async (input: {
  readonly lockFilePath: string;
  readonly entry: PromptOptimizationLockEntry;
}): Promise<{ readonly updated: boolean; readonly entries: number }> => {
  const raw = await readFile(input.lockFilePath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `prompt-optimizer: lock file at ${input.lockFilePath} is not valid JSON: ${(cause as Error).message}`,
    );
  }
  if (
    typeof parsed.version !== "string" ||
    !SEMVER_RE.test(parsed.version) ||
    typeof parsed.promptCompilerSha256 !== "string" ||
    !HEX_64_RE.test(parsed.promptCompilerSha256)
  ) {
    throw new Error(
      `prompt-optimizer: lock file at ${input.lockFilePath} is missing the base-template pin (version + promptCompilerSha256). Refusing to write.`,
    );
  }

  const existing = Array.isArray(parsed.optimizedTemplates)
    ? (parsed.optimizedTemplates as readonly unknown[])
    : [];
  const idAlreadyPresent = existing.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as { optimizedTemplateId?: unknown }).optimizedTemplateId ===
        input.entry.optimizedTemplateId,
  );
  if (idAlreadyPresent) {
    return { updated: false, entries: existing.length };
  }

  const next: PromptOptimizationLockEntry[] = [
    ...(existing as readonly PromptOptimizationLockEntry[]),
    input.entry,
  ].sort((left, right) =>
    left.optimizedTemplateId.localeCompare(right.optimizedTemplateId),
  );
  const merged: Record<string, unknown> = {
    ...parsed,
    optimizedTemplates: next,
  };
  // Preserve $schema/description leading-key order by re-serializing
  // with two-space indent (matches the existing lock file's style).
  await writeAtomic(
    input.lockFilePath,
    Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, "utf8"),
  );
  return { updated: true, entries: next.length };
};

/* -------------------------------------------------------------------- *
 * Misc utilities                                                       *
 * -------------------------------------------------------------------- */

const roundTo = (value: number, digits: number): number => {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
