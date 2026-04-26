/**
 * Extended test-case deduplication for Wave 3 (Issue #1373).
 *
 * The existing {@link detectDuplicateTestCases} (Issue #1364) ships
 * the lexical Jaccard path. This module layers two ADDITIVE,
 * OPT-IN signal sources on top:
 *
 *   1. An optional {@link EmbeddingProvider} interface (caller
 *      supplies the vectors). When configured, cosine similarity
 *      over the per-case embeddings is computed alongside the
 *      lexical path. The default `null` provider keeps the
 *      air-gapped flow working — only the lexical path participates
 *      in that case.
 *   2. An optional {@link ExternalDedupeProbe} interface that
 *      checks each case against an existing QC folder (or any
 *      other external system). When unconfigured, the probe
 *      surfaces a `disabled` outcome; when supplied but unable to
 *      reach the target it surfaces an `unconfigured` outcome —
 *      both are non-error informational verdicts.
 *
 * Per Issue #1373 AC5, NO module-internal network call is made.
 * Both extensions are caller-injected. The `EmbeddingProvider`
 * never fetches external URLs itself — it consumes vectors from
 * the caller. The `ExternalDedupeProbe` is the only injection
 * point that may touch a remote system, and even there the
 * orchestrator catches every failure and surfaces a sanitised
 * informational note instead of throwing.
 *
 * The companion {@link writeTestCaseDedupeReport} persists the
 * report atomically using the `${pid}.${randomUUID()}.tmp` rename
 * pattern shared by the rest of the test-intelligence module.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEDUPE_REPORT_ARTIFACT_FILENAME,
  DEDUPE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type DedupeCaseVerdict,
  type DedupeExternalFinding,
  type DedupeExternalProbeState,
  type DedupeInternalFinding,
  type DedupeSimilaritySource,
  type GeneratedTestCase,
  type TestCaseDedupeReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildTestCaseFingerprint,
  detectDuplicateTestCases,
} from "./test-case-duplicate.js";

const FAILURE_DETAIL_MAX = 240;

/**
 * Caller-supplied embedding provider. Vectors are consumed only;
 * the dedupe module never makes a network call. Implementations
 * that DO call out to a remote model are the caller's
 * responsibility — and the caller is responsible for keeping that
 * call air-gapped-compatible.
 */
export interface EmbeddingProvider {
  /**
   * Stable identifier surfaced in the report so a downstream
   * verifier can tell which embedding model was used.
   */
  readonly identifier: string;
  /**
   * Resolve a fixed-dimension vector for a test case. Vectors of
   * different lengths or NaN/Infinity components are rejected by
   * the dedupe orchestrator (fail-closed).
   */
  embed(testCase: GeneratedTestCase): Promise<readonly number[]>;
}

/**
 * Outcome of an {@link ExternalDedupeProbe.lookup}. The discriminant
 * `kind` is policy-readable so the orchestrator can fail-closed
 * without parsing free-form text.
 */
export type ExternalDedupeProbeLookupResult =
  | { kind: "missing" }
  | {
      kind: "found";
      matchedEntityId?: string;
      matchedFolderPath?: string;
    }
  | { kind: "unavailable"; detail: string };

/**
 * Caller-supplied external dedupe probe. The pipeline calls
 * {@link lookup} for every test case in deterministic order. The
 * probe MUST be idempotent and MUST NOT mutate the target system.
 */
export interface ExternalDedupeProbe {
  /**
   * Stable identifier for the target system (e.g. `qc-folder:/Subject/...`).
   * Surfaced in the report; never logged.
   */
  readonly identifier: string;
  /** Per-case lookup against the configured target. */
  lookup(input: {
    testCase: GeneratedTestCase;
    externalIdCandidate?: string;
    targetFolderPath?: string;
  }): Promise<ExternalDedupeProbeLookupResult>;
}

/**
 * Minimal context the orchestrator hands to {@link ExternalDedupeProbe.lookup}
 * for each case. Both fields are optional because the caller may be
 * probing without QC mapping context (e.g. a generic semantic-dedup
 * sweep across multiple jobs).
 */
export interface ExternalDedupeProbeCaseContext {
  externalIdCandidate?: string;
  targetFolderPath?: string;
}

export interface DetectTestCaseDuplicatesExtendedInput {
  jobId: string;
  generatedAt: string;
  testCases: ReadonlyArray<GeneratedTestCase>;
  /** Lexical similarity threshold; identical to the existing path. */
  lexicalThreshold: number;
  /** Embedding cosine similarity threshold; required when `embeddingProvider` is set. */
  embeddingThreshold?: number;
  /** Pluggable embedding provider; absent → lexical-only (air-gapped). */
  embeddingProvider?: EmbeddingProvider;
  /** Pluggable external probe; absent → external state = `disabled`. */
  externalProbe?: ExternalDedupeProbe;
  /** Per-case external context lookup (only consulted when probe is set). */
  externalContext?: (
    testCase: GeneratedTestCase,
  ) => ExternalDedupeProbeCaseContext;
}

const sanitizeProbeDetail = (detail: string): string => {
  const cleaned = detail.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "external_probe_unavailable";
  return cleaned.length <= FAILURE_DETAIL_MAX
    ? cleaned
    : `${cleaned.slice(0, FAILURE_DETAIL_MAX)}...`;
};

const sortedUniqueSources = (
  sources: Iterable<DedupeSimilaritySource>,
): DedupeSimilaritySource[] => Array.from(new Set(sources)).sort();

/** Cosine similarity in `[-1, 1]`; clamped to `[0, 1]` for the report. */
export const cosineSimilarity = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number => {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    throw new RangeError("cosineSimilarity: vectors have different lengths");
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("cosineSimilarity: non-finite vector component");
    }
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
};

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const validateEmbedding = (
  vector: ReadonlyArray<number>,
  expectedDimension: number | undefined,
): readonly number[] => {
  if (vector.length === 0) {
    throw new RangeError(
      "EmbeddingProvider.embed must return a non-empty vector",
    );
  }
  if (expectedDimension !== undefined && vector.length !== expectedDimension) {
    throw new RangeError(
      "EmbeddingProvider.embed must return vectors of consistent length",
    );
  }
  for (const v of vector) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new RangeError(
        "EmbeddingProvider.embed must return finite numbers",
      );
    }
  }
  return vector;
};

const computeEmbeddingFindings = async (
  testCases: ReadonlyArray<GeneratedTestCase>,
  provider: EmbeddingProvider,
  threshold: number,
): Promise<DedupeInternalFinding[]> => {
  if (threshold < 0 || threshold > 1) {
    throw new RangeError(
      "detectTestCaseDuplicatesExtended: embeddingThreshold must be in [0, 1]",
    );
  }
  const vectors: { id: string; vec: readonly number[] }[] = [];
  let dim: number | undefined;
  for (const tc of testCases) {
    const raw = await provider.embed(tc);
    const validated = validateEmbedding(raw, dim);
    if (dim === undefined) dim = validated.length;
    vectors.push({ id: tc.id, vec: validated });
  }
  const findings: DedupeInternalFinding[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    const left = vectors[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < vectors.length; j += 1) {
      const right = vectors[j];
      if (right === undefined) continue;
      const sim = cosineSimilarity(left.vec, right.vec);
      if (sim >= threshold) {
        const [lo, hi] =
          left.id <= right.id ? [left.id, right.id] : [right.id, left.id];
        findings.push({
          source: "embedding",
          leftTestCaseId: lo,
          rightTestCaseId: hi,
          similarity: roundTo(sim, 6),
        });
      }
    }
  }
  findings.sort((a, b) => {
    if (a.leftTestCaseId !== b.leftTestCaseId) {
      return a.leftTestCaseId < b.leftTestCaseId ? -1 : 1;
    }
    return a.rightTestCaseId < b.rightTestCaseId ? -1 : 1;
  });
  return findings;
};

interface ExternalProbeOutcome {
  state: DedupeExternalProbeState;
  cases: number;
  note?: string;
  findings: DedupeExternalFinding[];
}

const runExternalProbe = async (
  input: DetectTestCaseDuplicatesExtendedInput,
): Promise<ExternalProbeOutcome> => {
  if (input.externalProbe === undefined) {
    return { state: "disabled", cases: 0, findings: [] };
  }
  const findings: DedupeExternalFinding[] = [];
  let unavailableNote: string | undefined;
  let completedLookups = 0;
  for (const tc of input.testCases) {
    const ctx = input.externalContext?.(tc) ?? {};
    let result: ExternalDedupeProbeLookupResult;
    try {
      result = await input.externalProbe.lookup({
        testCase: tc,
        ...(ctx.externalIdCandidate !== undefined
          ? { externalIdCandidate: ctx.externalIdCandidate }
          : {}),
        ...(ctx.targetFolderPath !== undefined
          ? { targetFolderPath: ctx.targetFolderPath }
          : {}),
      });
    } catch (err) {
      const detail = sanitizeProbeDetail(
        err instanceof Error ? err.message : "external_probe_threw",
      );
      unavailableNote = unavailableNote ?? detail;
      continue;
    }
    if (result.kind === "found") completedLookups += 1;
    if (result.kind === "missing") completedLookups += 1;
    if (result.kind === "found") {
      const finding: DedupeExternalFinding = {
        source: "external_lookup",
        testCaseId: tc.id,
        externalIdCandidate: ctx.externalIdCandidate ?? "",
      };
      if (result.matchedFolderPath !== undefined) {
        finding.matchedFolderPath = result.matchedFolderPath;
      }
      if (result.matchedEntityId !== undefined) {
        finding.matchedEntityId = result.matchedEntityId;
      }
      findings.push(finding);
    } else if (result.kind === "unavailable") {
      unavailableNote = unavailableNote ?? sanitizeProbeDetail(result.detail);
    }
  }
  findings.sort((a, b) =>
    a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
  );
  // The probe is `unconfigured` only when EVERY case failed to
  // produce a usable result — at least one `missing` or `found`
  // verdict means the probe successfully exercised its surface.
  // Empty input lists (no cases to probe) inherit the same
  // unconfigured fail-closed semantics so an operator cannot
  // accidentally certify an empty-input run as "executed".
  if (
    completedLookups === 0 &&
    (unavailableNote !== undefined || input.testCases.length === 0)
  ) {
    return {
      state: "unconfigured",
      cases: input.testCases.length,
      note: unavailableNote ?? "no_probe_results",
      findings: [],
    };
  }
  return {
    state: "executed",
    cases: input.testCases.length,
    findings,
    ...(unavailableNote !== undefined ? { note: unavailableNote } : {}),
  };
};

const buildPerCase = (
  testCases: ReadonlyArray<GeneratedTestCase>,
  internal: ReadonlyArray<DedupeInternalFinding>,
  external: ReadonlyArray<DedupeExternalFinding>,
): DedupeCaseVerdict[] => {
  const sources = new Map<string, Set<DedupeSimilaritySource>>();
  const maxInternalSim = new Map<string, number>();
  for (const finding of internal) {
    for (const id of [finding.leftTestCaseId, finding.rightTestCaseId]) {
      const existing = sources.get(id) ?? new Set<DedupeSimilaritySource>();
      existing.add(finding.source);
      sources.set(id, existing);
      const prevMax = maxInternalSim.get(id);
      if (prevMax === undefined || finding.similarity > prevMax) {
        maxInternalSim.set(id, finding.similarity);
      }
    }
  }
  for (const finding of external) {
    const existing =
      sources.get(finding.testCaseId) ?? new Set<DedupeSimilaritySource>();
    existing.add("external_lookup");
    sources.set(finding.testCaseId, existing);
  }
  const rows: DedupeCaseVerdict[] = testCases.map((tc) => {
    const matched = sources.get(tc.id) ?? new Set<DedupeSimilaritySource>();
    return {
      testCaseId: tc.id,
      isDuplicate: matched.size > 0,
      matchedSources: sortedUniqueSources(matched),
      maxInternalSimilarity: roundTo(maxInternalSim.get(tc.id) ?? 0, 6),
    };
  });
  rows.sort((a, b) =>
    a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
  );
  return rows;
};

/**
 * Run the lexical + (optional) embedding + (optional) external
 * dedupe pipelines into a deterministic {@link TestCaseDedupeReport}.
 */
export const detectTestCaseDuplicatesExtended = async (
  input: DetectTestCaseDuplicatesExtendedInput,
): Promise<TestCaseDedupeReport> => {
  if (input.lexicalThreshold < 0 || input.lexicalThreshold > 1) {
    throw new RangeError(
      "detectTestCaseDuplicatesExtended: lexicalThreshold must be in [0, 1]",
    );
  }
  // Touch the lexical fingerprint helper so callers cannot accidentally
  // skip it (and so the function stays inert when no test cases exist).
  if (input.testCases.length > 0) {
    buildTestCaseFingerprint(input.testCases[0] as GeneratedTestCase);
  }

  const lexicalPairs = detectDuplicateTestCases({
    testCases: input.testCases,
    threshold: input.lexicalThreshold,
  });
  const lexicalFindings: DedupeInternalFinding[] = lexicalPairs.map((p) => ({
    source: "lexical",
    leftTestCaseId: p.leftTestCaseId,
    rightTestCaseId: p.rightTestCaseId,
    similarity: p.similarity,
  }));

  const embeddingFindings: DedupeInternalFinding[] =
    input.embeddingProvider !== undefined
      ? await computeEmbeddingFindings(
          input.testCases,
          input.embeddingProvider,
          input.embeddingThreshold ?? input.lexicalThreshold,
        )
      : [];

  const internalFindings: DedupeInternalFinding[] = [
    ...lexicalFindings,
    ...embeddingFindings,
  ].sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    if (a.leftTestCaseId !== b.leftTestCaseId)
      return a.leftTestCaseId < b.leftTestCaseId ? -1 : 1;
    return a.rightTestCaseId < b.rightTestCaseId ? -1 : 1;
  });

  const external = await runExternalProbe(input);
  const perCase = buildPerCase(
    input.testCases,
    internalFindings,
    external.findings,
  );

  const totals = {
    duplicates: perCase.filter((c) => c.isDuplicate).length,
    internalLexical: lexicalFindings.length,
    internalEmbedding: embeddingFindings.length,
    externalMatches: external.findings.length,
  };

  const report: TestCaseDedupeReport = {
    schemaVersion: DEDUPE_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    lexicalThreshold: input.lexicalThreshold,
    ...(input.embeddingThreshold !== undefined
      ? { embeddingThreshold: input.embeddingThreshold }
      : {}),
    embeddingProvider: {
      configured: input.embeddingProvider !== undefined,
      ...(input.embeddingProvider !== undefined
        ? { identifier: input.embeddingProvider.identifier }
        : {}),
    },
    externalProbe: {
      state: external.state,
      cases: external.cases,
      ...(external.note !== undefined ? { note: external.note } : {}),
    },
    internalFindings,
    externalFindings: external.findings,
    perCase,
    totals,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
  };
  return report;
};

/**
 * Sentinel external probe whose `lookup` always reports `unavailable`.
 * Use this in fail-closed startups where the operator has decided
 * the external probe is mandatory but not yet configured — it
 * surfaces an `unconfigured` state on every run instead of
 * silently downgrading to `disabled`.
 */
export const createUnconfiguredExternalDedupeProbe =
  (): ExternalDedupeProbe => ({
    identifier: "external-dedupe-probe:unconfigured",
    lookup: () =>
      Promise.resolve({
        kind: "unavailable",
        detail: "external_probe_not_configured",
      }),
  });

/**
 * Sentinel external probe whose `lookup` always reports `missing`.
 * Useful in tests / dry-runs where the probe path needs to be
 * exercised without surfacing duplicates.
 */
export const createDisabledExternalDedupeProbe = (): ExternalDedupeProbe => ({
  identifier: "external-dedupe-probe:disabled",
  lookup: () => Promise.resolve({ kind: "missing" }),
});

export interface WriteTestCaseDedupeReportInput {
  report: TestCaseDedupeReport;
  destinationDir: string;
}

export interface WriteTestCaseDedupeReportResult {
  artifactPath: string;
}

/** Persist a dedupe report atomically using the shared temp-rename pattern. */
export const writeTestCaseDedupeReport = async (
  input: WriteTestCaseDedupeReportInput,
): Promise<WriteTestCaseDedupeReportResult> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(input.destinationDir, DEDUPE_REPORT_ARTIFACT_FILENAME);
  const serialized = canonicalJson(input.report);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return { artifactPath: path };
};
