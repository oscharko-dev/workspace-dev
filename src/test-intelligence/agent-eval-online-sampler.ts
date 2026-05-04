import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";
import type { PiiKind } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { detectPii } from "./pii-detection.js";

/** Canonical filename written under `<runDir>/`. */
export const AGENT_ONLINE_EVAL_REPORT_FILENAME =
  "agent-online-eval-report.json" as const;

/** Schema version for {@link AgentOnlineEvalReport}. */
export const AGENT_ONLINE_EVAL_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Default sample rate (1%) when caller does not pass one. */
export const DEFAULT_AGENT_ONLINE_EVAL_SAMPLE_RATE = 0.01 as const;

/** Closed runtime list of evaluator verdict literals. */
export const ALLOWED_AGENT_ONLINE_EVAL_VERDICTS = [
  "fail",
  "pass",
  "refusal",
] as const;

export type AgentOnlineEvalVerdict =
  (typeof ALLOWED_AGENT_ONLINE_EVAL_VERDICTS)[number];

/** One production trace presented to the sampler. */
export interface AgentProductionTrace {
  readonly traceId: string;
  readonly runId: string;
  readonly archetypeId?: string;
  readonly prompt: string;
  readonly response: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** A trace after PII redaction, passed to the evaluator. */
export interface AgentRedactedProductionTrace {
  readonly traceId: string;
  readonly runId: string;
  readonly archetypeId?: string;
  readonly redactedPrompt: string;
  readonly redactedResponse: string;
  readonly redactedMetadata?: Readonly<Record<string, string>>;
  readonly redactionsApplied: readonly PiiKind[];
}

/** Score + verdict the evaluator returns for a redacted sampled trace. */
export interface AgentOnlineEvaluatorVerdict {
  /** Score in [0, 1]. */
  readonly score: number;
  readonly verdict: AgentOnlineEvalVerdict;
  readonly notes?: string;
}

/** Pluggable evaluator. Default is deterministic and air-gapped. */
export type AgentOnlineEvaluator = (
  trace: AgentRedactedProductionTrace,
) => AgentOnlineEvaluatorVerdict;

/** One persisted record inside {@link AgentOnlineEvalReport.samples}. */
export interface AgentOnlineEvalSample {
  readonly traceId: string;
  readonly runId: string;
  readonly archetypeId?: string;
  readonly redactedPrompt: string;
  readonly redactedResponse: string;
  readonly redactedMetadata?: Readonly<Record<string, string>>;
  readonly redactionsApplied: readonly PiiKind[];
  readonly score: number;
  readonly verdict: AgentOnlineEvalVerdict;
  readonly notes?: string;
}

/** Persisted, canonical-JSON, per-run online-eval report. */
export interface AgentOnlineEvalReport {
  readonly schemaVersion: typeof AGENT_ONLINE_EVAL_REPORT_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly seed: string;
  readonly sampleRate: number;
  readonly population: {
    readonly totalTraces: number;
    readonly sampledCount: number;
    readonly observedSampleRate: number;
  };
  readonly aggregate: {
    readonly meanScore: number;
    readonly passCount: number;
    readonly failCount: number;
    readonly refusalCount: number;
    readonly redactionCount: number;
  };
  readonly samples: readonly AgentOnlineEvalSample[];
}

const ROUND6 = 1_000_000;
const round6 = (value: number): number => Math.round(value * ROUND6) / ROUND6;

const SAMPLE_RATE_DENOM = 0x1_0000_0000_0000;

/**
 * Deterministic uniform [0, 1) score for a single trace. Derived from
 * `sha256(seed || "::" || traceId)` truncated to the top 48 bits, which
 * keeps the result inside `Number.MAX_SAFE_INTEGER` and gives 2^-48
 * resolution — far below the smallest sample rate we expect to set.
 */
export const computeTraceSamplingScore = (
  seed: string,
  traceId: string,
): number => {
  const digest = createHash("sha256")
    .update(`${seed}::${traceId}`)
    .digest();
  const hi = digest.readUInt32BE(0);
  const mid = digest.readUInt16BE(4);
  return (hi * 0x1_0000 + mid) / SAMPLE_RATE_DENOM;
};

/** Returns true iff the trace is in the deterministic sample. */
export const shouldSampleAgentTrace = (input: {
  traceId: string;
  seed: string;
  sampleRate: number;
}): boolean => {
  if (
    typeof input.sampleRate !== "number" ||
    !Number.isFinite(input.sampleRate) ||
    input.sampleRate < 0 ||
    input.sampleRate > 1
  ) {
    throw new RangeError(
      "shouldSampleAgentTrace: sampleRate must be a finite number in [0, 1]",
    );
  }
  if (input.sampleRate === 0) return false;
  if (input.sampleRate === 1) return true;
  return (
    computeTraceSamplingScore(input.seed, input.traceId) < input.sampleRate
  );
};

const redactString = (
  input: string,
): { readonly redacted: string; readonly kind: PiiKind | null } => {
  if (input.length === 0) return { redacted: input, kind: null };
  const match = detectPii(input);
  if (match === null) return { redacted: input, kind: null };
  return { redacted: match.redacted, kind: match.kind };
};

const redactMetadata = (
  metadata: Readonly<Record<string, string>>,
  kinds: Set<PiiKind>,
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  const keys = Object.keys(metadata).sort();
  for (const key of keys) {
    const value = metadata[key];
    if (value === undefined) continue;
    const { redacted, kind } = redactString(value);
    if (kind !== null) kinds.add(kind);
    result[key] = redacted;
  }
  return result;
};

/**
 * Apply PII redaction to every string field of `trace`. Mirrors the
 * codebase convention in {@link ./pii-redaction.ts}: when PII is detected
 * the entire field is replaced with the canonical token, never partially
 * masked.
 */
export const redactProductionTrace = (
  trace: AgentProductionTrace,
): AgentRedactedProductionTrace => {
  const kinds = new Set<PiiKind>();

  const promptResult = redactString(trace.prompt);
  if (promptResult.kind !== null) kinds.add(promptResult.kind);

  const responseResult = redactString(trace.response);
  if (responseResult.kind !== null) kinds.add(responseResult.kind);

  const redacted: AgentRedactedProductionTrace = {
    traceId: trace.traceId,
    runId: trace.runId,
    redactedPrompt: promptResult.redacted,
    redactedResponse: responseResult.redacted,
    redactionsApplied: [...kinds].sort(),
    ...(trace.archetypeId !== undefined
      ? { archetypeId: trace.archetypeId }
      : {}),
    ...(trace.metadata !== undefined
      ? { redactedMetadata: redactMetadata(trace.metadata, kinds) }
      : {}),
  };

  return {
    ...redacted,
    redactionsApplied: [...kinds].sort(),
  };
};

const REFUSAL_MARKERS: readonly RegExp[] = [
  /\bI (?:cannot|can't|won't|will not)\b/iu,
  /\b(?:refused|refusal|policy violation)\b/iu,
  /\bunable to (?:comply|assist|help)\b/iu,
];

const SHORT_RESPONSE_MIN = 16;
const VERBOSE_RESPONSE_MAX = 4_000;

/**
 * Default deterministic, air-gapped evaluator. No external service is
 * contacted; the score depends only on the redacted trace.
 *
 *   - `refusal` if the response matches any refusal marker.
 *   - `fail` if the response is empty or shorter than the minimum length.
 *   - `pass` otherwise; score is 1.0 in the canonical band and tapers off
 *     for very short or very verbose responses.
 */
export const defaultAgentOnlineEvaluator: AgentOnlineEvaluator = (trace) => {
  const response = trace.redactedResponse;
  if (REFUSAL_MARKERS.some((re) => re.test(response))) {
    return {
      score: 0,
      verdict: "refusal",
      notes: "matched refusal marker",
    };
  }
  if (response.trim().length < SHORT_RESPONSE_MIN) {
    return {
      score: 0,
      verdict: "fail",
      notes: "response below minimum length",
    };
  }
  if (response.length > VERBOSE_RESPONSE_MAX) {
    const overflow = response.length - VERBOSE_RESPONSE_MAX;
    const score = Math.max(0, 1 - overflow / VERBOSE_RESPONSE_MAX);
    return {
      score: round6(score),
      verdict: score > 0 ? "pass" : "fail",
      notes: "response above verbose ceiling",
    };
  }
  return { score: 1, verdict: "pass" };
};

/** Build a canonical online-eval report without persisting it. */
export const buildAgentOnlineEvalReport = (input: {
  traces: readonly AgentProductionTrace[];
  seed: string;
  sampleRate?: number;
  generatedAt: string;
  evaluator?: AgentOnlineEvaluator;
}): AgentOnlineEvalReport => {
  const sampleRate = input.sampleRate ?? DEFAULT_AGENT_ONLINE_EVAL_SAMPLE_RATE;
  if (
    typeof sampleRate !== "number" ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 0 ||
    sampleRate > 1
  ) {
    throw new RangeError(
      "buildAgentOnlineEvalReport: sampleRate must be a finite number in [0, 1]",
    );
  }
  if (typeof input.seed !== "string" || input.seed.length === 0) {
    throw new TypeError(
      "buildAgentOnlineEvalReport: seed must be a non-empty string",
    );
  }
  const evaluator = input.evaluator ?? defaultAgentOnlineEvaluator;
  const seenTraceIds = new Set<string>();

  const sortedTraces: AgentProductionTrace[] = input.traces
    .slice()
    .sort((a, b) => a.traceId.localeCompare(b.traceId, "en-US"));

  const samples: AgentOnlineEvalSample[] = [];
  let scoreSum = 0;
  let passCount = 0;
  let failCount = 0;
  let refusalCount = 0;
  let redactionCount = 0;

  for (const trace of sortedTraces) {
    if (typeof trace.traceId !== "string" || trace.traceId.length === 0) {
      throw new TypeError(
        "buildAgentOnlineEvalReport: every trace must carry a non-empty traceId",
      );
    }
    if (seenTraceIds.has(trace.traceId)) {
      throw new Error(
        `buildAgentOnlineEvalReport: duplicate traceId "${trace.traceId}"`,
      );
    }
    seenTraceIds.add(trace.traceId);

    if (!shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: input.seed,
      sampleRate,
    })) {
      continue;
    }

    const redacted = redactProductionTrace(trace);
    const verdict = evaluator(redacted);
    if (
      typeof verdict.score !== "number" ||
      !Number.isFinite(verdict.score) ||
      verdict.score < 0 ||
      verdict.score > 1
    ) {
      throw new RangeError(
        `evaluator returned invalid score for trace "${trace.traceId}"`,
      );
    }
    if (!ALLOWED_AGENT_ONLINE_EVAL_VERDICTS.includes(verdict.verdict)) {
      throw new RangeError(
        `evaluator returned invalid verdict "${verdict.verdict}" for trace "${trace.traceId}"`,
      );
    }

    const sample: AgentOnlineEvalSample = {
      traceId: redacted.traceId,
      runId: redacted.runId,
      redactedPrompt: redacted.redactedPrompt,
      redactedResponse: redacted.redactedResponse,
      redactionsApplied: redacted.redactionsApplied,
      score: round6(verdict.score),
      verdict: verdict.verdict,
      ...(redacted.archetypeId !== undefined
        ? { archetypeId: redacted.archetypeId }
        : {}),
      ...(redacted.redactedMetadata !== undefined
        ? { redactedMetadata: redacted.redactedMetadata }
        : {}),
      ...(verdict.notes !== undefined ? { notes: verdict.notes } : {}),
    };

    samples.push(sample);
    scoreSum += sample.score;
    if (sample.verdict === "pass") passCount += 1;
    else if (sample.verdict === "fail") failCount += 1;
    else refusalCount += 1;
    if (sample.redactionsApplied.length > 0) redactionCount += 1;
  }

  const totalTraces = sortedTraces.length;
  const sampledCount = samples.length;
  const observedSampleRate =
    totalTraces === 0 ? 0 : round6(sampledCount / totalTraces);
  const meanScore =
    sampledCount === 0 ? 0 : round6(scoreSum / sampledCount);

  return {
    schemaVersion: AGENT_ONLINE_EVAL_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    seed: input.seed,
    sampleRate: round6(sampleRate),
    population: {
      totalTraces,
      sampledCount,
      observedSampleRate,
    },
    aggregate: {
      meanScore,
      passCount,
      failCount,
      refusalCount,
      redactionCount,
    },
    samples,
  };
};

/** Resolve `<runDir>/agent-online-eval-report.json`. */
export const agentOnlineEvalReportPath = (runDir: string): string =>
  join(runDir, AGENT_ONLINE_EVAL_REPORT_FILENAME);

/**
 * Atomically persist `report` as canonical-JSON. Returns the resolved
 * output path. Mirrors the tmp+rename pattern used elsewhere in the
 * test-intelligence layer for byte-stable artifacts.
 */
export const writeAgentOnlineEvalReport = async (input: {
  report: AgentOnlineEvalReport;
  runDir: string;
}): Promise<string> => {
  const outputPath = agentOnlineEvalReportPath(input.runDir);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.report), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

/**
 * Convenience: build the report and write it under `runDir` in a single
 * call. Returns both so callers can inspect the in-memory report without
 * re-reading the file.
 */
export const runAgentOnlineEvalSampler = async (input: {
  traces: readonly AgentProductionTrace[];
  runDir: string;
  seed: string;
  sampleRate?: number;
  generatedAt: string;
  evaluator?: AgentOnlineEvaluator;
}): Promise<{
  readonly report: AgentOnlineEvalReport;
  readonly outputPath: string;
}> => {
  const report = buildAgentOnlineEvalReport({
    traces: input.traces,
    seed: input.seed,
    generatedAt: input.generatedAt,
    ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
    ...(input.evaluator !== undefined ? { evaluator: input.evaluator } : {}),
  });
  const outputPath = await writeAgentOnlineEvalReport({
    report,
    runDir: input.runDir,
  });
  return { report, outputPath };
};
