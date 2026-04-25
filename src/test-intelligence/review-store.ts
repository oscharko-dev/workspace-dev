/**
 * Review-gate persistent store (Issue #1365).
 *
 * Mirrors the import-session-event-store pattern:
 *   - file-per-job event log (`review-events.json`)
 *   - file-per-job snapshot of per-test-case state (`review-state.json`)
 *   - atomic writes via `${path}.${pid}.tmp` rename
 *   - monotonic `sequence` counter persisted alongside the event log
 *   - mutex serialization so concurrent appends do not interleave
 *
 * The store is fail-closed: the seeding API constructs an initial
 * snapshot from a validation pipeline output, which carries the policy
 * decisions; only the review handler may transition state via
 * `recordTransition`, and only via the state machine.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_REVIEW_EVENT_KINDS,
  ALLOWED_REVIEW_STATES,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCaseList,
  type ReviewEvent,
  type ReviewEventKind,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type ReviewState,
  type TestCasePolicyDecision,
  type TestCasePolicyReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  seedReviewStateFromPolicy,
  transitionReviewState,
  type ReviewTransitionRefusalCode,
} from "./review-state-machine.js";

const NOTE_MAX_LENGTH = 1024;
const ACTOR_MAX_LENGTH = 256;

const REVIEW_EVENT_KINDS: ReadonlySet<ReviewEventKind> = new Set(
  ALLOWED_REVIEW_EVENT_KINDS,
);
const REVIEW_STATES_SET: ReadonlySet<ReviewState> = new Set(
  ALLOWED_REVIEW_STATES,
);

interface PersistedReviewEventsEnvelope {
  schemaVersion: typeof REVIEW_GATE_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  events: ReviewEvent[];
  nextSequence: number;
}

export interface RecordTransitionInput {
  jobId: string;
  testCaseId?: string;
  kind: ReviewEventKind;
  at: string;
  actor?: string;
  note?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type RecordTransitionResult =
  | { ok: true; event: ReviewEvent; snapshot: ReviewGateSnapshot }
  | {
      ok: false;
      code:
        | "snapshot_missing"
        | "test_case_unknown"
        | "test_case_id_required"
        | "note_too_long"
        | "actor_too_long"
        | "kind_unknown"
        | ReviewTransitionRefusalCode;
    };

export interface ReviewStore {
  /**
   * Initialize the store for a job from validation pipeline outputs.
   * If a snapshot already exists for the job, returns it as-is.
   */
  seedSnapshot(input: {
    jobId: string;
    generatedAt: string;
    list: GeneratedTestCaseList;
    policy: TestCasePolicyReport;
  }): Promise<ReviewGateSnapshot>;
  /** List all events for a job in sequence order. */
  listEvents(jobId: string): Promise<ReviewEvent[]>;
  /** Read the snapshot for a job. */
  readSnapshot(jobId: string): Promise<ReviewGateSnapshot | undefined>;
  /** Record a state transition. Fail-closed when the transition is illegal. */
  recordTransition(
    input: RecordTransitionInput,
  ): Promise<RecordTransitionResult>;
}

export interface CreateFileSystemReviewStoreInput {
  destinationDir: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFlatMetadata = (
  value: unknown,
): value is Record<string, string | number | boolean | null> => {
  if (!isRecord(value)) return false;
  for (const v of Object.values(value)) {
    if (
      v !== null &&
      typeof v !== "string" &&
      typeof v !== "number" &&
      typeof v !== "boolean"
    ) {
      return false;
    }
  }
  return true;
};

const isReviewEvent = (value: unknown): value is ReviewEvent => {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  const state = value["toState"];
  const fromState = value["fromState"];
  if (
    value["schemaVersion"] !== REVIEW_GATE_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["id"] !== "string" ||
    typeof value["jobId"] !== "string" ||
    typeof value["at"] !== "string" ||
    typeof value["sequence"] !== "number" ||
    !Number.isInteger(value["sequence"]) ||
    value["sequence"] < 1 ||
    typeof kind !== "string" ||
    !REVIEW_EVENT_KINDS.has(kind as ReviewEventKind)
  ) {
    return false;
  }
  if (
    value["testCaseId"] !== undefined &&
    typeof value["testCaseId"] !== "string"
  ) {
    return false;
  }
  if (value["actor"] !== undefined && typeof value["actor"] !== "string") {
    return false;
  }
  if (value["note"] !== undefined && typeof value["note"] !== "string") {
    return false;
  }
  if (
    fromState !== undefined &&
    (typeof fromState !== "string" ||
      !REVIEW_STATES_SET.has(fromState as ReviewState))
  ) {
    return false;
  }
  if (
    state !== undefined &&
    (typeof state !== "string" || !REVIEW_STATES_SET.has(state as ReviewState))
  ) {
    return false;
  }
  if (value["metadata"] !== undefined && !isFlatMetadata(value["metadata"])) {
    return false;
  }
  return true;
};

const isReviewSnapshotEntry = (value: unknown): value is ReviewSnapshot => {
  if (!isRecord(value)) return false;
  if (
    typeof value["testCaseId"] !== "string" ||
    typeof value["state"] !== "string" ||
    !REVIEW_STATES_SET.has(value["state"] as ReviewState) ||
    typeof value["policyDecision"] !== "string" ||
    typeof value["lastEventId"] !== "string" ||
    typeof value["lastEventAt"] !== "string" ||
    typeof value["fourEyesEnforced"] !== "boolean" ||
    !Array.isArray(value["approvers"]) ||
    !value["approvers"].every((a) => typeof a === "string")
  ) {
    return false;
  }
  return true;
};

const isReviewGateSnapshot = (value: unknown): value is ReviewGateSnapshot => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== REVIEW_GATE_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["jobId"] !== "string" ||
    typeof value["generatedAt"] !== "string" ||
    typeof value["approvedCount"] !== "number" ||
    typeof value["needsReviewCount"] !== "number" ||
    typeof value["rejectedCount"] !== "number" ||
    !Array.isArray(value["perTestCase"]) ||
    !value["perTestCase"].every(isReviewSnapshotEntry)
  ) {
    return false;
  }
  return true;
};

const isPersistedEnvelope = (
  value: unknown,
): value is PersistedReviewEventsEnvelope => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === REVIEW_GATE_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    Array.isArray(value["events"]) &&
    value["events"].every(isReviewEvent) &&
    typeof value["nextSequence"] === "number" &&
    Number.isInteger(value["nextSequence"]) &&
    value["nextSequence"] >= 1
  );
};

const writeAtomicJson = async (
  path: string,
  payload: unknown,
): Promise<void> => {
  const serialized = canonicalJson(payload);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
};

const computeCounts = (
  perTestCase: ReviewSnapshot[],
): {
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
} => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const entry of perTestCase) {
    if (
      entry.state === "approved" ||
      entry.state === "exported" ||
      entry.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (entry.state === "needs_review" || entry.state === "edited") {
      needsReviewCount += 1;
    } else if (entry.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return { approvedCount, needsReviewCount, rejectedCount };
};

const sortSnapshotEntries = (entries: ReviewSnapshot[]): ReviewSnapshot[] => {
  return [...entries].sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
};

interface JobLock {
  promise: Promise<void>;
  release: () => void;
}

const buildJobLock = (): JobLock => {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

class FileSystemReviewStore implements ReviewStore {
  private readonly destinationDir: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(input: CreateFileSystemReviewStoreInput) {
    this.destinationDir = input.destinationDir;
  }

  private jobDir(jobId: string): string {
    return join(this.destinationDir, jobId);
  }

  private eventsPath(jobId: string): string {
    return join(this.jobDir(jobId), REVIEW_EVENTS_ARTIFACT_FILENAME);
  }

  private snapshotPath(jobId: string): string {
    return join(this.jobDir(jobId), REVIEW_STATE_ARTIFACT_FILENAME);
  }

  private async withJobLock<T>(
    jobId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(jobId);
    const lock = buildJobLock();
    this.locks.set(jobId, lock.promise);
    try {
      if (previous) {
        await previous;
      }
      return await work();
    } finally {
      lock.release();
      if (this.locks.get(jobId) === lock.promise) {
        this.locks.delete(jobId);
      }
    }
  }

  private async readEnvelope(
    jobId: string,
  ): Promise<PersistedReviewEventsEnvelope | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.eventsPath(jobId), "utf8");
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `review-store: review-events.json for job ${jobId} is not valid JSON`,
      );
    }
    if (!isPersistedEnvelope(parsed)) {
      throw new Error(
        `review-store: review-events.json for job ${jobId} is not a valid envelope`,
      );
    }
    if (parsed.jobId !== jobId) {
      throw new Error(
        `review-store: review-events.json jobId mismatch for ${jobId}`,
      );
    }
    return parsed;
  }

  private async readSnapshotInternal(
    jobId: string,
  ): Promise<ReviewGateSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.snapshotPath(jobId), "utf8");
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `review-store: review-state.json for job ${jobId} is not valid JSON`,
      );
    }
    if (!isReviewGateSnapshot(parsed)) {
      throw new Error(
        `review-store: review-state.json for job ${jobId} is not a valid snapshot`,
      );
    }
    return parsed;
  }

  async seedSnapshot(input: {
    jobId: string;
    generatedAt: string;
    list: GeneratedTestCaseList;
    policy: TestCasePolicyReport;
  }): Promise<ReviewGateSnapshot> {
    return this.withJobLock(input.jobId, async () => {
      const existing = await this.readSnapshotInternal(input.jobId);
      if (existing) return existing;

      await mkdir(this.jobDir(input.jobId), { recursive: true });

      const decisions = new Map<string, TestCasePolicyDecision>();
      for (const decision of input.policy.decisions) {
        decisions.set(decision.testCaseId, decision.decision);
      }

      const events: ReviewEvent[] = [];
      const perTestCase: ReviewSnapshot[] = [];
      let sequence = 1;

      for (const tc of input.list.testCases) {
        const decision: TestCasePolicyDecision =
          decisions.get(tc.id) ?? "needs_review";
        const seedState: ReviewState = seedReviewStateFromPolicy(decision);
        const eventId = randomUUID();
        const seedEvent: ReviewEvent = {
          schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
          contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
          id: eventId,
          jobId: input.jobId,
          testCaseId: tc.id,
          kind: "generated",
          at: input.generatedAt,
          sequence,
          fromState: "generated",
          toState: seedState,
          metadata: { policyDecision: decision },
        };
        sequence += 1;
        events.push(seedEvent);
        perTestCase.push({
          testCaseId: tc.id,
          state: seedState,
          policyDecision: decision,
          lastEventId: eventId,
          lastEventAt: input.generatedAt,
          fourEyesEnforced: false,
          approvers: [],
        });
      }

      const sortedEntries = sortSnapshotEntries(perTestCase);
      const counts = computeCounts(sortedEntries);
      const snapshot: ReviewGateSnapshot = {
        schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        perTestCase: sortedEntries,
        ...counts,
      };

      const envelope: PersistedReviewEventsEnvelope = {
        schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        jobId: input.jobId,
        events,
        nextSequence: sequence,
      };

      await writeAtomicJson(this.eventsPath(input.jobId), envelope);
      await writeAtomicJson(this.snapshotPath(input.jobId), snapshot);

      return snapshot;
    });
  }

  async listEvents(jobId: string): Promise<ReviewEvent[]> {
    const envelope = await this.readEnvelope(jobId);
    return envelope ? envelope.events.slice() : [];
  }

  async readSnapshot(jobId: string): Promise<ReviewGateSnapshot | undefined> {
    return this.readSnapshotInternal(jobId);
  }

  async recordTransition(
    input: RecordTransitionInput,
  ): Promise<RecordTransitionResult> {
    return this.withJobLock(input.jobId, async () => {
      if (input.note !== undefined && input.note.length > NOTE_MAX_LENGTH) {
        return { ok: false, code: "note_too_long" };
      }
      if (input.actor !== undefined && input.actor.length > ACTOR_MAX_LENGTH) {
        return { ok: false, code: "actor_too_long" };
      }
      if (!REVIEW_EVENT_KINDS.has(input.kind)) {
        return { ok: false, code: "kind_unknown" };
      }

      const envelope = await this.readEnvelope(input.jobId);
      const snapshot = await this.readSnapshotInternal(input.jobId);
      if (!envelope || !snapshot) {
        return { ok: false, code: "snapshot_missing" };
      }

      const entries = snapshot.perTestCase.slice();
      let entry: ReviewSnapshot | undefined;

      if (input.kind === "note" && input.testCaseId === undefined) {
        // Job-level note; no transition.
      } else if (input.testCaseId === undefined) {
        return { ok: false, code: "test_case_id_required" };
      } else {
        entry = entries.find((e) => e.testCaseId === input.testCaseId);
        if (!entry) {
          return { ok: false, code: "test_case_unknown" };
        }
      }

      const fromState: ReviewState = entry ? entry.state : "generated";
      const transition = transitionReviewState({
        from: fromState,
        kind: input.kind,
        ...(entry ? { policyDecision: entry.policyDecision } : {}),
      });
      if (!transition.ok) {
        return { ok: false, code: transition.code };
      }
      const toState: ReviewState = transition.to;

      const eventId = randomUUID();
      const event: ReviewEvent = {
        schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        id: eventId,
        jobId: input.jobId,
        ...(input.testCaseId !== undefined
          ? { testCaseId: input.testCaseId }
          : {}),
        kind: input.kind,
        at: input.at,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        fromState,
        toState,
        sequence: envelope.nextSequence,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      };

      const newEvents = envelope.events.concat(event);
      const newEnvelope: PersistedReviewEventsEnvelope = {
        ...envelope,
        events: newEvents,
        nextSequence: envelope.nextSequence + 1,
      };

      let nextEntries: ReviewSnapshot[];
      if (entry && input.kind !== "note") {
        const updated: ReviewSnapshot = {
          ...entry,
          state: toState,
          lastEventId: eventId,
          lastEventAt: input.at,
          ...(input.kind === "approved" && input.actor !== undefined
            ? {
                approvers: entry.approvers.includes(input.actor)
                  ? entry.approvers
                  : [...entry.approvers, input.actor].sort(),
              }
            : {}),
        };
        nextEntries = entries.map((e) =>
          e.testCaseId === entry.testCaseId ? updated : e,
        );
      } else if (entry) {
        // note that includes a per-case touch but does not transition
        const updated: ReviewSnapshot = {
          ...entry,
          lastEventId: eventId,
          lastEventAt: input.at,
        };
        nextEntries = entries.map((e) =>
          e.testCaseId === entry.testCaseId ? updated : e,
        );
      } else {
        nextEntries = entries;
      }

      const sorted = sortSnapshotEntries(nextEntries);
      const counts = computeCounts(sorted);
      const newSnapshot: ReviewGateSnapshot = {
        ...snapshot,
        perTestCase: sorted,
        ...counts,
      };

      await writeAtomicJson(this.eventsPath(input.jobId), newEnvelope);
      await writeAtomicJson(this.snapshotPath(input.jobId), newSnapshot);

      return { ok: true, event, snapshot: newSnapshot };
    });
  }
}

/** Construct a file-system-backed review store rooted at `destinationDir`. */
export const createFileSystemReviewStore = (
  input: CreateFileSystemReviewStoreInput,
): ReviewStore => {
  return new FileSystemReviewStore(input);
};
