/**
 * CacheBreakDetector (Issue #1778).
 *
 * A two-phase wrap around the LLM gateway that flags unexpected cache
 * invalidations between consecutive iterations of the same query source
 * (typically a judge re-prompt). When a break is detected the detector
 *
 *   1. emits a structured `cache_break` event onto the
 *      {@link RunnerEventBus}, carrying the current Merkle `parentHash`
 *      so the event is part of the chain; and
 *   2. writes a canonical-JSON diff artifact under
 *      `<runDir>/observability/cache-breaks/<ts>.diff.json`. The diff
 *      runs through {@link normalizeUntrustedContent} +
 *      {@link redactHighRiskSecrets} before persistence — a poisoned
 *      tool result that broke the cache must never be persisted raw.
 *
 * Suppression APIs (`notifyCompaction`, `notifyCacheDeletion`) mark the
 * next break as intentional so it produces neither an event nor an
 * artifact.
 *
 * State is an LRU `Map<querySource, Snapshot>` capped at
 * {@link CACHE_BREAK_DETECTOR_MAX_SNAPSHOTS} entries.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CACHE_BREAK_ARTIFACT_DIRECTORY,
  CACHE_BREAK_DETECTOR_MAX_SNAPSHOTS,
  CACHE_BREAK_DIFF_SCHEMA_VERSION,
  CACHE_BREAK_MIN_CREATION_TOKENS,
  CACHE_BREAK_READ_RATIO_THRESHOLD,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CacheBreakSuppressionReason,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  type ProductionRunnerEvent,
  type RunnerEventBus,
} from "./production-runner-events.js";
import { normalizeUntrustedContent } from "./untrusted-content-normalizer.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** A message in an LLM prompt — minimal shape the detector needs to diff. */
export interface CacheBreakPromptMessage {
  readonly role: string;
  readonly content: unknown;
}

/** Caller-supplied input to {@link CacheBreakDetector.recordPromptState}. */
export interface RecordPromptStateInput {
  readonly jobId: string;
  readonly roleStepId: string;
  readonly messages: ReadonlyArray<CacheBreakPromptMessage>;
  readonly systemPrompt: string;
  readonly toolsHash: string;
  readonly ts: number;
  readonly querySource: string;
  /**
   * Token count the next call is expected to read from cache. Typically
   * the previous call's `cacheReadTokens + cacheCreationTokens`. Used as
   * the denominator of the heuristic (`cacheReadTokens < 0.05 *
   * expected`).
   */
  readonly expectedCacheReadTokens: number;
  /**
   * Most recent Merkle chain head. The emitted `cache_break` event
   * carries this value so it is part of the chain.
   */
  readonly parentHash: string;
}

/**
 * Snapshot of one prompt state stored in the LRU. Returned to the caller
 * by {@link CacheBreakDetector.recordPromptState} so it can be threaded
 * back into {@link CacheBreakDetector.checkResponseForCacheBreak}.
 *
 * Raw `messages` and `systemPrompt` are retained on the in-memory
 * snapshot so the detector can compute a structural diff when a break
 * fires. They never escape the process unless redacted first.
 */
export interface CacheBreakSnapshot {
  readonly jobId: string;
  readonly roleStepId: string;
  readonly querySource: string;
  readonly ts: number;
  readonly messages: ReadonlyArray<CacheBreakPromptMessage>;
  readonly systemPrompt: string;
  readonly toolsHash: string;
  readonly messagesHash: string;
  readonly systemPromptHash: string;
  readonly expectedCacheReadTokens: number;
  readonly parentHash: string;
}

/** Result of {@link CacheBreakDetector.recordPromptState}. */
export interface RecordPromptStateResult {
  /** Snapshot just stored (and to be passed to the response check). */
  readonly snapshot: CacheBreakSnapshot;
  /**
   * Snapshot previously stored under the same `querySource`, if any.
   * Pass this back as `prevSnapshot` to
   * {@link CacheBreakDetector.checkResponseForCacheBreak} to evaluate
   * the heuristic.
   */
  readonly previous: CacheBreakSnapshot | undefined;
}

/** Caller-supplied input to {@link CacheBreakDetector.checkResponseForCacheBreak}. */
export interface CheckResponseForCacheBreakInput {
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** Previous snapshot for this `querySource`, or `undefined` for the first call. */
  readonly prevSnapshot: CacheBreakSnapshot | undefined;
  /** Snapshot of the call whose response is being inspected. */
  readonly currentSnapshot: CacheBreakSnapshot;
}

/** Outcome of one {@link CacheBreakDetector.checkResponseForCacheBreak} call. */
export interface CacheBreakCheckOutcome {
  /** True only when the heuristic fired AND no suppression was active. */
  readonly fired: boolean;
  /** When `fired` is `false` because of an explicit suppression. */
  readonly suppressed?: { readonly reason: CacheBreakSuppressionReason };
  /** Absolute path to the diff artifact when `fired === true`. */
  readonly artifactPath?: string;
  /** The event emitted onto the bus when `fired === true`. */
  readonly event?: ProductionRunnerEvent;
}

/** Public detector interface. */
export interface CacheBreakDetector {
  recordPromptState(input: RecordPromptStateInput): RecordPromptStateResult;
  checkResponseForCacheBreak(
    input: CheckResponseForCacheBreakInput,
  ): Promise<CacheBreakCheckOutcome>;
  notifyCompaction(jobId: string, reason: string): void;
  notifyCacheDeletion(jobId: string, reason: string): void;
  /** For tests / diagnostics — current LRU size. */
  snapshotCount(): number;
}

/** Detector construction options. */
export interface CreateCacheBreakDetectorOptions {
  /** Bus the detector publishes `cache_break` events onto. */
  readonly bus: RunnerEventBus;
  /** Run directory under which the `observability/cache-breaks/` tree lives. */
  readonly runDir: string;
  /** Wall-clock source for the artifact filename and event timestamp. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /** Override for {@link CACHE_BREAK_DETECTOR_MAX_SNAPSHOTS} (tests only). */
  readonly maxSnapshots?: number;
}

// ---------------------------------------------------------------------------
// Diff artifact shape (canonical-JSON, redacted)
// ---------------------------------------------------------------------------

interface CacheBreakDiffArtifact {
  readonly schemaVersion: typeof CACHE_BREAK_DIFF_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly jobId: string;
  readonly roleStepId: string;
  readonly querySource: string;
  readonly parentHash: string;
  readonly ts: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly expectedCacheReadTokens: number;
  readonly readRatio: number;
  readonly hashDiff: {
    readonly systemPrompt: {
      readonly previous: string;
      readonly current: string;
    };
    readonly messages: { readonly previous: string; readonly current: string };
    readonly tools: { readonly previous: string; readonly current: string };
  };
  readonly messageCountDelta: {
    readonly previous: number;
    readonly current: number;
  };
  readonly redactedDiff: {
    readonly systemPrompt: {
      readonly previous: string | null;
      readonly current: string | null;
    };
    readonly messages: ReadonlyArray<{
      readonly index: number;
      readonly side: "previous" | "current" | "both";
      readonly role: string;
      readonly previousText: string | null;
      readonly currentText: string | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const SECRET_REPLACEMENT = "[REDACTED:SECRET]";

/** Construct a fresh detector. */
export const createCacheBreakDetector = (
  options: CreateCacheBreakDetectorOptions,
): CacheBreakDetector => {
  const clock = options.clock ?? (() => Date.now());
  const maxSnapshots =
    options.maxSnapshots ?? CACHE_BREAK_DETECTOR_MAX_SNAPSHOTS;
  if (!Number.isInteger(maxSnapshots) || maxSnapshots <= 0) {
    throw new TypeError(
      "createCacheBreakDetector: maxSnapshots must be a positive integer",
    );
  }
  if (typeof options.runDir !== "string" || options.runDir.length === 0) {
    throw new TypeError(
      "createCacheBreakDetector: runDir must be a non-empty string",
    );
  }

  // LRU: keyed by querySource. Map preserves insertion order; on access
  // we delete + re-insert to refresh recency.
  const snapshots = new Map<string, CacheBreakSnapshot>();

  // Per-jobId pending suppression — a single notify clears the next break
  // for that jobId. Stored as the reason so the outcome can surface it.
  const pendingSuppressions = new Map<string, CacheBreakSuppressionReason>();

  const touch = (key: string, snapshot: CacheBreakSnapshot): void => {
    if (snapshots.has(key)) snapshots.delete(key);
    snapshots.set(key, snapshot);
    while (snapshots.size > maxSnapshots) {
      const oldest = snapshots.keys().next();
      if (oldest.done === true) break;
      snapshots.delete(oldest.value);
    }
  };

  const recordPromptState = (
    input: RecordPromptStateInput,
  ): RecordPromptStateResult => {
    validateRecordInput(input);
    const previous = snapshots.get(input.querySource);
    if (previous !== undefined) snapshots.delete(input.querySource);

    const snapshot: CacheBreakSnapshot = {
      jobId: input.jobId,
      roleStepId: input.roleStepId,
      querySource: input.querySource,
      ts: input.ts,
      messages: input.messages,
      systemPrompt: input.systemPrompt,
      toolsHash: input.toolsHash,
      messagesHash: sha256Hex(input.messages),
      systemPromptHash: sha256Hex(input.systemPrompt),
      expectedCacheReadTokens: input.expectedCacheReadTokens,
      parentHash: input.parentHash,
    };
    touch(input.querySource, snapshot);
    return { snapshot, previous };
  };

  const checkResponseForCacheBreak = async (
    input: CheckResponseForCacheBreakInput,
  ): Promise<CacheBreakCheckOutcome> => {
    validateCheckInput(input);
    const {
      cacheReadTokens,
      cacheCreationTokens,
      prevSnapshot,
      currentSnapshot,
    } = input;

    // No previous baseline → nothing to compare against; cannot have broken
    // the cache by definition.
    if (prevSnapshot === undefined) return { fired: false };

    const expected = currentSnapshot.expectedCacheReadTokens;
    if (expected <= 0) return { fired: false };

    const fired =
      cacheReadTokens < CACHE_BREAK_READ_RATIO_THRESHOLD * expected &&
      cacheCreationTokens > CACHE_BREAK_MIN_CREATION_TOKENS;
    if (!fired) return { fired: false };

    const suppression = pendingSuppressions.get(currentSnapshot.jobId);
    if (suppression !== undefined) {
      pendingSuppressions.delete(currentSnapshot.jobId);
      return { fired: false, suppressed: { reason: suppression } };
    }

    const ts = clock();
    const artifact = buildArtifact({
      ts,
      prevSnapshot,
      currentSnapshot,
      cacheReadTokens,
      cacheCreationTokens,
      expected,
    });

    const artifactDir = join(options.runDir, CACHE_BREAK_ARTIFACT_DIRECTORY);
    const artifactPath = join(artifactDir, `${ts}.diff.json`);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactPath, `${canonicalJson(artifact)}\n`, "utf8");

    const event: ProductionRunnerEvent = {
      phase: "cache_break",
      timestamp: ts,
      details: {
        jobId: currentSnapshot.jobId,
        roleStepId: currentSnapshot.roleStepId,
        querySource: currentSnapshot.querySource,
        parentHash: currentSnapshot.parentHash,
        cacheReadTokens,
        cacheCreationTokens,
        expectedCacheReadTokens: expected,
        readRatio: cacheReadTokens / expected,
        artifactPath,
        diffSchemaVersion: CACHE_BREAK_DIFF_SCHEMA_VERSION,
      },
    };
    options.bus.publish(currentSnapshot.jobId, event);

    return { fired: true, artifactPath, event };
  };

  const notifyCompaction = (jobId: string, reason: string): void => {
    if (typeof jobId !== "string" || jobId.length === 0) {
      throw new TypeError("notifyCompaction: jobId must be a non-empty string");
    }
    if (typeof reason !== "string" || reason.length === 0) {
      throw new TypeError(
        "notifyCompaction: reason must be a non-empty string",
      );
    }
    pendingSuppressions.set(jobId, "compaction");
  };

  const notifyCacheDeletion = (jobId: string, reason: string): void => {
    if (typeof jobId !== "string" || jobId.length === 0) {
      throw new TypeError(
        "notifyCacheDeletion: jobId must be a non-empty string",
      );
    }
    if (typeof reason !== "string" || reason.length === 0) {
      throw new TypeError(
        "notifyCacheDeletion: reason must be a non-empty string",
      );
    }
    pendingSuppressions.set(jobId, "cache_deletion");
  };

  return {
    recordPromptState,
    checkResponseForCacheBreak,
    notifyCompaction,
    notifyCacheDeletion,
    snapshotCount: () => snapshots.size,
  };
};

// ---------------------------------------------------------------------------
// Artifact construction
// ---------------------------------------------------------------------------

interface BuildArtifactInput {
  readonly ts: number;
  readonly prevSnapshot: CacheBreakSnapshot;
  readonly currentSnapshot: CacheBreakSnapshot;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly expected: number;
}

const buildArtifact = (input: BuildArtifactInput): CacheBreakDiffArtifact => {
  const { prevSnapshot, currentSnapshot } = input;

  const previousSystem = redactText(prevSnapshot.systemPrompt);
  const currentSystem = redactText(currentSnapshot.systemPrompt);

  const messageDiff = diffMessages(
    prevSnapshot.messages,
    currentSnapshot.messages,
  );

  return {
    schemaVersion: CACHE_BREAK_DIFF_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: currentSnapshot.jobId,
    roleStepId: currentSnapshot.roleStepId,
    querySource: currentSnapshot.querySource,
    parentHash: currentSnapshot.parentHash,
    ts: input.ts,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    expectedCacheReadTokens: input.expected,
    readRatio: input.cacheReadTokens / input.expected,
    hashDiff: {
      systemPrompt: {
        previous: prevSnapshot.systemPromptHash,
        current: currentSnapshot.systemPromptHash,
      },
      messages: {
        previous: prevSnapshot.messagesHash,
        current: currentSnapshot.messagesHash,
      },
      tools: {
        previous: prevSnapshot.toolsHash,
        current: currentSnapshot.toolsHash,
      },
    },
    messageCountDelta: {
      previous: prevSnapshot.messages.length,
      current: currentSnapshot.messages.length,
    },
    redactedDiff: {
      systemPrompt: {
        previous:
          prevSnapshot.systemPromptHash === currentSnapshot.systemPromptHash
            ? null
            : previousSystem,
        current:
          prevSnapshot.systemPromptHash === currentSnapshot.systemPromptHash
            ? null
            : currentSystem,
      },
      messages: messageDiff,
    },
  };
};

interface RedactedMessageEntry {
  readonly index: number;
  readonly side: "previous" | "current" | "both";
  readonly role: string;
  readonly previousText: string | null;
  readonly currentText: string | null;
}

/**
 * Build a per-index diff between two message arrays. Only positions where
 * the canonical-JSON serialization differs are included; identical
 * positions are omitted to keep the artifact bounded.
 */
const diffMessages = (
  previous: ReadonlyArray<CacheBreakPromptMessage>,
  current: ReadonlyArray<CacheBreakPromptMessage>,
): ReadonlyArray<RedactedMessageEntry> => {
  const max = Math.max(previous.length, current.length);
  const out: RedactedMessageEntry[] = [];
  for (let i = 0; i < max; i += 1) {
    const prevMsg = i < previous.length ? previous[i] : undefined;
    const currMsg = i < current.length ? current[i] : undefined;
    if (prevMsg !== undefined && currMsg !== undefined) {
      const prevSerial = canonicalJson(prevMsg);
      const currSerial = canonicalJson(currMsg);
      if (prevSerial === currSerial) continue;
      out.push({
        index: i,
        side: "both",
        role: currMsg.role,
        previousText: redactText(stringifyContent(prevMsg.content)),
        currentText: redactText(stringifyContent(currMsg.content)),
      });
      continue;
    }
    if (prevMsg !== undefined) {
      out.push({
        index: i,
        side: "previous",
        role: prevMsg.role,
        previousText: redactText(stringifyContent(prevMsg.content)),
        currentText: null,
      });
      continue;
    }
    if (currMsg !== undefined) {
      out.push({
        index: i,
        side: "current",
        role: currMsg.role,
        previousText: null,
        currentText: redactText(stringifyContent(currMsg.content)),
      });
    }
  }
  return out;
};

/**
 * Coerce arbitrary message content (string, content-part array, structured
 * tool result) into a plain string for the diff. Non-string content is
 * canonicalised.
 */
const stringifyContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  return canonicalJson(content);
};

/**
 * Redact a free-text payload before persistence:
 *   1. {@link normalizeUntrustedContent} strips 2025-vintage prompt-injection
 *      carriers (zero-width chars, sentinel layer names, markdown injection
 *      patterns) and counts them. We only keep the sanitised string — the
 *      report counts are deliberately discarded; the cache-break artifact
 *      is about cache attribution, not normalization.
 *   2. {@link redactHighRiskSecrets} replaces label-anchored and bare-token
 *      credential shapes with a stable placeholder.
 */
const redactText = (text: string): string => {
  if (text.length === 0) return text;
  const normalized = normalizeUntrustedContent({
    textFields: [{ id: "cache-break-diff", text }],
  });
  const sanitized = normalized.textFields?.[0]?.text ?? text;
  return redactHighRiskSecrets(sanitized, SECRET_REPLACEMENT);
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const validateRecordInput = (input: RecordPromptStateInput): void => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError("recordPromptState: jobId must be a non-empty string");
  }
  if (typeof input.roleStepId !== "string" || input.roleStepId.length === 0) {
    throw new TypeError(
      "recordPromptState: roleStepId must be a non-empty string",
    );
  }
  if (typeof input.querySource !== "string" || input.querySource.length === 0) {
    throw new TypeError(
      "recordPromptState: querySource must be a non-empty string",
    );
  }
  if (typeof input.parentHash !== "string" || input.parentHash.length === 0) {
    throw new TypeError(
      "recordPromptState: parentHash must be a non-empty string",
    );
  }
  if (typeof input.systemPrompt !== "string") {
    throw new TypeError("recordPromptState: systemPrompt must be a string");
  }
  if (typeof input.toolsHash !== "string" || input.toolsHash.length === 0) {
    throw new TypeError(
      "recordPromptState: toolsHash must be a non-empty string",
    );
  }
  if (!Number.isFinite(input.ts)) {
    throw new TypeError("recordPromptState: ts must be a finite number");
  }
  if (
    !Number.isFinite(input.expectedCacheReadTokens) ||
    input.expectedCacheReadTokens < 0
  ) {
    throw new TypeError(
      "recordPromptState: expectedCacheReadTokens must be a non-negative finite number",
    );
  }
  if (!Array.isArray(input.messages)) {
    throw new TypeError("recordPromptState: messages must be an array");
  }
};

const validateCheckInput = (input: CheckResponseForCacheBreakInput): void => {
  if (!Number.isFinite(input.cacheReadTokens) || input.cacheReadTokens < 0) {
    throw new TypeError(
      "checkResponseForCacheBreak: cacheReadTokens must be a non-negative finite number",
    );
  }
  if (
    !Number.isFinite(input.cacheCreationTokens) ||
    input.cacheCreationTokens < 0
  ) {
    throw new TypeError(
      "checkResponseForCacheBreak: cacheCreationTokens must be a non-negative finite number",
    );
  }
};
