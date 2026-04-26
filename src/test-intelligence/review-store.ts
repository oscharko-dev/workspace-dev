/**
 * Review-gate persistent store (Issues #1365 / #1376).
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
 *
 * Wave 2 (#1376) adds four-eyes enforcement. The seed accepts a
 * `FourEyesPolicy` plus the optional visual-sidecar validation report
 * and stamps each per-case snapshot with `fourEyesEnforced` /
 * `fourEyesReasons`. `recordTransition` then refuses self-approval,
 * duplicate-principal approval, approving one's own edit, and
 * approve-without-actor. The legacy `approved` event kind is preserved
 * for non-enforced cases and auto-routed to `primary_approved` /
 * `secondary_approved` for enforced ones, so existing UI clients keep
 * working without rewiring.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS,
  ALLOWED_REVIEW_EVENT_KINDS,
  ALLOWED_REVIEW_STATES,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FourEyesEnforcementReason,
  type FourEyesPolicy,
  type GeneratedTestCaseList,
  type ReviewEvent,
  type ReviewEventKind,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type ReviewState,
  type TestCasePolicyDecision,
  type TestCasePolicyReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  cloneFourEyesPolicy,
  evaluateFourEyesEnforcement,
} from "./four-eyes-policy.js";
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
const FOUR_EYES_REASONS_SET: ReadonlySet<FourEyesEnforcementReason> = new Set(
  ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS,
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

/**
 * Refusal codes specific to four-eyes enforcement (#1376). All map to
 * 409 at the handler layer because they reflect a state/principal
 * conflict, not a malformed input.
 */
export type FourEyesRefusalCode =
  | "four_eyes_actor_required"
  | "self_approval_refused"
  | "duplicate_principal_refused"
  | "primary_approval_required"
  | "four_eyes_not_required";

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
        | ReviewTransitionRefusalCode
        | FourEyesRefusalCode;
    };

export interface SeedSnapshotInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  policy: TestCasePolicyReport;
  /**
   * Optional four-eyes policy. When omitted, no case is enforced
   * (preserves Wave 1 single-reviewer flow).
   */
  fourEyesPolicy?: FourEyesPolicy;
  /**
   * Optional visual-sidecar validation report consulted by the
   * four-eyes evaluator. Cases without matching screen records receive
   * no visual-driven enforcement.
   */
  visualReport?: VisualSidecarValidationReport;
}

export interface RefreshPolicyDecisionsInput {
  jobId: string;
  /** Timestamp for the audit note and touched snapshot entries. */
  at: string;
  /** Override-aware policy report produced for the same generated list. */
  policy: TestCasePolicyReport;
}

export type RefreshPolicyDecisionsResult =
  | {
      ok: true;
      snapshot: ReviewGateSnapshot;
      changedCount: number;
      event?: ReviewEvent;
    }
  | {
      ok: false;
      code:
        | "snapshot_missing"
        | "policy_report_job_mismatch"
        | "policy_report_test_case_mismatch";
    };

export interface ReviewStore {
  /**
   * Initialize the store for a job from validation pipeline outputs.
   * If a snapshot already exists for the job, returns it as-is.
   */
  seedSnapshot(input: SeedSnapshotInput): Promise<ReviewGateSnapshot>;
  /** List all events for a job in sequence order. */
  listEvents(jobId: string): Promise<ReviewEvent[]>;
  /** Read the snapshot for a job. */
  readSnapshot(jobId: string): Promise<ReviewGateSnapshot | undefined>;
  /**
   * Refresh per-case policy decisions from a newly evaluated policy report
   * after appending an audit note. Affected entries point at that refresh
   * event so later approvals can be tied to the policy re-evaluation.
   */
  refreshPolicyDecisions(
    input: RefreshPolicyDecisionsInput,
  ): Promise<RefreshPolicyDecisionsResult>;
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
  if (value["fourEyesReasons"] !== undefined) {
    const reasons = value["fourEyesReasons"];
    if (
      !Array.isArray(reasons) ||
      !reasons.every(
        (r) =>
          typeof r === "string" &&
          FOUR_EYES_REASONS_SET.has(r as FourEyesEnforcementReason),
      )
    ) {
      return false;
    }
  }
  for (const optionalString of [
    "primaryReviewer",
    "primaryApprovalAt",
    "secondaryReviewer",
    "secondaryApprovalAt",
    "lastEditor",
  ] as const) {
    const v = value[optionalString];
    if (v !== undefined && typeof v !== "string") {
      return false;
    }
  }
  return true;
};

const isFourEyesPolicy = (value: unknown): value is FourEyesPolicy => {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value["requiredRiskCategories"]) &&
    value["requiredRiskCategories"].every((s) => typeof s === "string") &&
    Array.isArray(value["visualSidecarTriggerOutcomes"]) &&
    value["visualSidecarTriggerOutcomes"].every((s) => typeof s === "string")
  );
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
  if (
    value["pendingSecondaryApprovalCount"] !== undefined &&
    (typeof value["pendingSecondaryApprovalCount"] !== "number" ||
      !Number.isInteger(value["pendingSecondaryApprovalCount"]))
  ) {
    return false;
  }
  if (
    value["fourEyesPolicy"] !== undefined &&
    !isFourEyesPolicy(value["fourEyesPolicy"])
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

interface SnapshotCounts {
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  pendingSecondaryApprovalCount: number;
}

const computeCounts = (perTestCase: ReviewSnapshot[]): SnapshotCounts => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  let pendingSecondaryApprovalCount = 0;
  for (const entry of perTestCase) {
    if (
      entry.state === "approved" ||
      entry.state === "exported" ||
      entry.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (entry.state === "needs_review" || entry.state === "edited") {
      needsReviewCount += 1;
    } else if (entry.state === "pending_secondary_approval") {
      pendingSecondaryApprovalCount += 1;
    } else if (entry.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return {
    approvedCount,
    needsReviewCount,
    rejectedCount,
    pendingSecondaryApprovalCount,
  };
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

  async seedSnapshot(input: SeedSnapshotInput): Promise<ReviewGateSnapshot> {
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

      const fourEyesPolicy = input.fourEyesPolicy;
      const policyMetadata = fourEyesPolicy
        ? cloneFourEyesPolicy(fourEyesPolicy)
        : undefined;

      for (const tc of input.list.testCases) {
        const decision: TestCasePolicyDecision =
          decisions.get(tc.id) ?? "needs_review";
        const seedState: ReviewState = seedReviewStateFromPolicy(decision);
        const eventId = randomUUID();
        const enforcement = fourEyesPolicy
          ? evaluateFourEyesEnforcement({
              testCase: tc,
              policy: fourEyesPolicy,
              ...(input.visualReport
                ? { visualReport: input.visualReport }
                : {}),
            })
          : { enforced: false, reasons: [] as FourEyesEnforcementReason[] };
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
        const entry: ReviewSnapshot = {
          testCaseId: tc.id,
          state: seedState,
          policyDecision: decision,
          lastEventId: eventId,
          lastEventAt: input.generatedAt,
          fourEyesEnforced: enforcement.enforced,
          approvers: [],
          ...(enforcement.reasons.length > 0
            ? { fourEyesReasons: enforcement.reasons.slice() }
            : {}),
        };
        perTestCase.push(entry);
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
        ...(policyMetadata ? { fourEyesPolicy: policyMetadata } : {}),
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

  async refreshPolicyDecisions(
    input: RefreshPolicyDecisionsInput,
  ): Promise<RefreshPolicyDecisionsResult> {
    return this.withJobLock(input.jobId, async () => {
      const envelope = await this.readEnvelope(input.jobId);
      const snapshot = await this.readSnapshotInternal(input.jobId);
      if (!envelope || !snapshot) {
        return { ok: false, code: "snapshot_missing" };
      }

      if (input.policy.jobId !== input.jobId) {
        return { ok: false, code: "policy_report_job_mismatch" };
      }
      if (input.policy.totalTestCases !== snapshot.perTestCase.length) {
        return { ok: false, code: "policy_report_test_case_mismatch" };
      }

      const knownTestCaseIds = new Set(
        snapshot.perTestCase.map((entry) => entry.testCaseId),
      );
      const decisions = new Map<string, TestCasePolicyDecision>();
      for (const decision of input.policy.decisions) {
        if (
          !knownTestCaseIds.has(decision.testCaseId) ||
          decisions.has(decision.testCaseId)
        ) {
          return { ok: false, code: "policy_report_test_case_mismatch" };
        }
        decisions.set(decision.testCaseId, decision.decision);
      }

      const changedEntries: ReviewSnapshot[] = [];
      for (const entry of snapshot.perTestCase) {
        const nextDecision = decisions.get(entry.testCaseId);
        if (nextDecision === undefined) continue;
        if (entry.policyDecision !== nextDecision) {
          changedEntries.push({ ...entry, policyDecision: nextDecision });
        }
      }
      if (changedEntries.length === 0) {
        return { ok: true, snapshot, changedCount: 0 };
      }

      const eventId = randomUUID();
      const event: ReviewEvent = {
        schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        id: eventId,
        jobId: input.jobId,
        kind: "note",
        at: input.at,
        note: "Policy decisions refreshed from override-aware policy report.",
        sequence: envelope.nextSequence,
        metadata: {
          policyDecisionRefresh: "semantic_content_overrides",
          changedCount: changedEntries.length,
          policyProfileId: input.policy.policyProfileId,
          policyProfileVersion: input.policy.policyProfileVersion,
        },
      };
      const changedById = new Map(
        changedEntries.map((entry) => [entry.testCaseId, entry]),
      );
      const nextEntries = snapshot.perTestCase.map((entry) => {
        const changed = changedById.get(entry.testCaseId);
        if (changed === undefined) return entry;
        const next: ReviewSnapshot = {
          ...changed,
          lastEventId: eventId,
          lastEventAt: input.at,
        };
        if (
          next.policyDecision === "blocked" &&
          (next.state === "approved" ||
            next.state === "pending_secondary_approval" ||
            next.state === "edited")
        ) {
          next.state = "needs_review";
          next.approvers = [];
          delete next.primaryReviewer;
          delete next.primaryApprovalAt;
          delete next.secondaryReviewer;
          delete next.secondaryApprovalAt;
        }
        return next;
      });
      const sorted = sortSnapshotEntries(nextEntries);
      const counts = computeCounts(sorted);
      const nextSnapshot: ReviewGateSnapshot = {
        ...snapshot,
        perTestCase: sorted,
        ...counts,
      };
      const nextEnvelope: PersistedReviewEventsEnvelope = {
        ...envelope,
        events: envelope.events.concat(event),
        nextSequence: envelope.nextSequence + 1,
      };

      await writeAtomicJson(this.eventsPath(input.jobId), nextEnvelope);
      await writeAtomicJson(this.snapshotPath(input.jobId), nextSnapshot);

      return {
        ok: true,
        snapshot: nextSnapshot,
        changedCount: changedEntries.length,
        event,
      };
    });
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

      // Resolve the actual event kind. Four-eyes-enforced cases route
      // the legacy `approved` action through `primary_approved` /
      // `secondary_approved`. Non-enforced cases keep `approved`.
      const resolvedKind = resolveEventKind(input.kind, entry);

      // Four-eyes refusals applied BEFORE state-machine consultation so
      // operators see a structured cause rather than `transition_not_allowed`.
      const fourEyesRefusal = applyFourEyesRefusals(input, resolvedKind, entry);
      if (fourEyesRefusal) {
        return { ok: false, code: fourEyesRefusal };
      }

      const transition = transitionReviewState({
        from: fromState,
        kind: resolvedKind,
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
        kind: resolvedKind,
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
      if (entry && resolvedKind !== "note") {
        const updated = applyEntryEffects({
          entry,
          toState,
          eventId,
          eventAt: input.at,
          actor: input.actor,
          kind: resolvedKind,
        });
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

/**
 * Map the inbound `kind` to the actual event kind that should be
 * persisted. Four-eyes-enforced cases reroute `approved` based on the
 * current state so legacy clients do not need to learn the new event
 * kinds.
 */
const resolveEventKind = (
  inbound: ReviewEventKind,
  entry: ReviewSnapshot | undefined,
): ReviewEventKind => {
  if (!entry) return inbound;
  if (inbound !== "approved") return inbound;
  if (!entry.fourEyesEnforced) return "approved";
  if (
    entry.state === "needs_review" ||
    entry.state === "edited" ||
    entry.state === "generated"
  ) {
    return "primary_approved";
  }
  if (entry.state === "pending_secondary_approval") {
    return "secondary_approved";
  }
  // State is approved/exported/transferred/rejected — the state-machine
  // refusal path will reject the request, so we return the inbound kind
  // verbatim and let `transitionReviewState` produce the standard code.
  return "approved";
};

interface ApplyEntryEffectsInput {
  entry: ReviewSnapshot;
  toState: ReviewState;
  eventId: string;
  eventAt: string;
  actor: string | undefined;
  kind: ReviewEventKind;
}

/**
 * Apply the per-case snapshot delta produced by a successful event:
 * state, last-event pointer, approver tracking, four-eyes principal
 * binding, and last-editor tracking.
 */
const applyEntryEffects = (input: ApplyEntryEffectsInput): ReviewSnapshot => {
  const { entry, toState, eventId, eventAt, actor, kind } = input;
  let approvers = entry.approvers;
  if (
    (kind === "approved" ||
      kind === "primary_approved" ||
      kind === "secondary_approved") &&
    actor !== undefined &&
    !approvers.includes(actor)
  ) {
    approvers = [...approvers, actor].sort();
  }
  const updated: ReviewSnapshot = {
    ...entry,
    state: toState,
    lastEventId: eventId,
    lastEventAt: eventAt,
    approvers,
  };
  if (kind === "primary_approved" && actor !== undefined) {
    updated.primaryReviewer = actor;
    updated.primaryApprovalAt = eventAt;
  }
  if (kind === "secondary_approved" && actor !== undefined) {
    updated.secondaryReviewer = actor;
    updated.secondaryApprovalAt = eventAt;
  }
  if (kind === "edited") {
    if (actor !== undefined) {
      updated.lastEditor = actor;
    } else {
      // An edit without an actor identity erases any prior tracked
      // editor so a subsequent approval is not refused on stale data.
      delete updated.lastEditor;
    }
    // Re-edit invalidates the in-progress approval chain.
    delete updated.primaryReviewer;
    delete updated.primaryApprovalAt;
    delete updated.secondaryReviewer;
    delete updated.secondaryApprovalAt;
    updated.approvers = [];
  }
  if (
    kind === "review_started" &&
    (entry.state === "approved" ||
      entry.state === "pending_secondary_approval" ||
      entry.state === "edited")
  ) {
    // Re-opening a case discards its previously collected approvals so a
    // subsequent four-eyes round restarts from zero principals.
    delete updated.primaryReviewer;
    delete updated.primaryApprovalAt;
    delete updated.secondaryReviewer;
    delete updated.secondaryApprovalAt;
    updated.approvers = [];
  }
  return updated;
};

/**
 * Apply four-eyes-specific refusals before consulting the state machine.
 * Returns a refusal code when the request must be denied; otherwise
 * `undefined` and the caller proceeds to the state-machine check.
 */
const applyFourEyesRefusals = (
  input: RecordTransitionInput,
  resolvedKind: ReviewEventKind,
  entry: ReviewSnapshot | undefined,
): FourEyesRefusalCode | undefined => {
  if (!entry) return undefined;

  if (
    resolvedKind === "primary_approved" ||
    resolvedKind === "secondary_approved"
  ) {
    if (!entry.fourEyesEnforced) {
      return "four_eyes_not_required";
    }
    if (input.actor === undefined || input.actor.length === 0) {
      return "four_eyes_actor_required";
    }
  }

  if (resolvedKind === "primary_approved") {
    if (entry.lastEditor !== undefined && entry.lastEditor === input.actor) {
      return "self_approval_refused";
    }
    if (entry.approvers.includes(input.actor as string)) {
      return "duplicate_principal_refused";
    }
  }

  if (resolvedKind === "secondary_approved") {
    if (entry.state !== "pending_secondary_approval") {
      return "primary_approval_required";
    }
    if (
      entry.primaryReviewer !== undefined &&
      entry.primaryReviewer === input.actor
    ) {
      return "self_approval_refused";
    }
    if (entry.approvers.includes(input.actor as string)) {
      return "duplicate_principal_refused";
    }
    if (entry.lastEditor !== undefined && entry.lastEditor === input.actor) {
      return "self_approval_refused";
    }
  }

  return undefined;
};

/** Construct a file-system-backed review store rooted at `destinationDir`. */
export const createFileSystemReviewStore = (
  input: CreateFileSystemReviewStoreInput,
): ReviewStore => {
  return new FileSystemReviewStore(input);
};
