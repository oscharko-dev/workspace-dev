/**
 * Import session governance events for issue #1010 — the integration surface
 * that issue #994 (team auditability) plugs into.
 *
 * The Inspector emits a structured event for every paste-import session that
 * reaches a successful (`ready` / `partial`) state. The default consumer is a
 * no-op so the runtime stays self-contained; #994 swaps in a transport that
 * forwards events to the team-admin audit log.
 *
 * Pure module — no React, no DOM, no fetches.
 */

import type { PasteImportSession } from "./paste-import-history";

export interface ImportGovernanceEvent {
  /** ISO timestamp when the import completed (mirrors session.importedAt). */
  readonly timestamp: string;
  /** "all" when unscoped; "partial" when the user generated a subset. */
  readonly scope: "all" | "partial";
  /** Selected node ids (empty when scope === "all"). */
  readonly selectedNodes: readonly string[];
  /** Generated files count. */
  readonly fileCount: number;
  /** Total imported nodes. */
  readonly nodeCount: number;
  /** Underlying jobId. */
  readonly jobId: string;
  /** Identifier for the source design (Figma file key or local fallback). */
  readonly fileKey: string;
  /**
   * Persisted session id, when known. Forwarded from `session.id` so the
   * #994 transport can route the audit event to the correct server record.
   */
  readonly sessionId?: string;
  /**
   * Derived quality score (integer 0..100) at the moment the event fired.
   * Optional because callers may not have computed a score yet.
   */
  readonly qualityScore?: number;
  /**
   * User identity. Optional — populated by the transport when known. The
   * Inspector does not have first-class user identity in v1, so this is
   * left undefined; #994 attaches a session principal at dispatch time.
   */
  readonly userId?: string;
}

export type ImportGovernanceListener = (event: ImportGovernanceEvent) => void;

/**
 * Convert a recorded session into a governance event suitable for emission.
 * Returns a stable, structurally-cloneable plain object.
 */
export function toImportGovernanceEvent(
  session: PasteImportSession,
): ImportGovernanceEvent {
  const base: ImportGovernanceEvent = {
    timestamp: session.importedAt,
    scope: session.scope,
    selectedNodes: session.selectedNodes,
    fileCount: session.fileCount,
    nodeCount: session.nodeCount,
    jobId: session.jobId,
    fileKey: session.fileKey,
  };
  return {
    ...base,
    sessionId: session.id,
    ...(session.qualityScore !== undefined
      ? { qualityScore: session.qualityScore }
      : {}),
  };
}

const listeners = new Set<ImportGovernanceListener>();

/**
 * Subscribe to import governance events. Returns an unsubscribe function.
 * #994 calls this from its workspace-level setup to forward events to the
 * audit log endpoint.
 */
export function subscribeToImportGovernanceEvents(
  listener: ImportGovernanceListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Dispatch a governance event to every registered listener. Listener errors
 * are swallowed so a faulty consumer cannot break the Inspector flow.
 */
export function dispatchImportGovernanceEvent(
  event: ImportGovernanceEvent,
): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Intentionally ignored — governance is best-effort and must never
      // surface as a runtime error in the Inspector.
    }
  }
}

/**
 * Test-only escape hatch to drop all subscribers. Not exported as part of the
 * production API; used by vitest setup to keep tests isolated.
 */
export function __resetImportGovernanceListenersForTests(): void {
  listeners.clear();
}
