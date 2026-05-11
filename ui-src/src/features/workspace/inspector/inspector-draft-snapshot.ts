/**
 * Named snapshot / checkpoint system for Inspector override drafts.
 *
 * Allows users to save the current draft state as a labelled checkpoint and
 * restore it later. Snapshots are bounded to prevent unbounded memory growth
 * during long editing sessions.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/460
 */

import { isScalarPaddingValue } from "./scalar-override-translators";
import type { InspectorOverrideDraft, InspectorOverrideValue } from "./inspector-override-draft";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of snapshots retained per editing session. */
export const MAX_DRAFT_SNAPSHOTS = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single named snapshot of the override draft. */
export interface DraftSnapshot {
  /** Unique identifier for this snapshot. */
  readonly id: string;

  /** User-visible label (auto-generated if not provided). */
  readonly label: string;

  /** ISO-8601 timestamp of when the snapshot was created. */
  readonly createdAt: string;

  /** Deep copy of the draft at snapshot time. */
  readonly draft: InspectorOverrideDraft;
}

/** Immutable container for the snapshot list. */
export interface DraftSnapshotStore {
  /** Ordered list of snapshots (index 0 = oldest). */
  readonly snapshots: readonly DraftSnapshot[];

  /** Maximum number of snapshots retained. */
  readonly maxSnapshots: number;
}

export interface CreateSnapshotResult {
  store: DraftSnapshotStore;
  snapshot: DraftSnapshot;
}

export interface RestoreSnapshotResult {
  store: DraftSnapshotStore;
  draft: InspectorOverrideDraft | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function generateSnapshotId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return `snap-${globalThis.crypto.randomUUID()}`;
  }
  return `snap-${Date.now()}-${Math.trunc(Math.random() * 1_000_000)}`;
}

function cloneOverrideValue(value: InspectorOverrideValue): InspectorOverrideValue {
  return isScalarPaddingValue(value) ? { ...value } : value;
}

function cloneDraft(draft: InspectorOverrideDraft): InspectorOverrideDraft {
  return {
    ...draft,
    entries: draft.entries.map((entry) => ({
      ...entry,
      value: cloneOverrideValue(entry.value)
    }))
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates an empty snapshot store. */
export function createDraftSnapshotStore(
  options?: { maxSnapshots?: number }
): DraftSnapshotStore {
  const maxSnapshots = options?.maxSnapshots ?? MAX_DRAFT_SNAPSHOTS;
  if (maxSnapshots < 1) {
    throw new RangeError("maxSnapshots must be >= 1");
  }

  return {
    snapshots: [],
    maxSnapshots
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Creates a snapshot of the given draft and adds it to the store.
 *
 * - If the store is at capacity, the oldest snapshot is evicted.
 * - Returns the updated store and the created snapshot.
 */
export function createDraftSnapshot(
  store: DraftSnapshotStore,
  draft: InspectorOverrideDraft,
  label?: string
): CreateSnapshotResult {
  const snapshot: DraftSnapshot = {
    id: generateSnapshotId(),
    label: label ?? `Checkpoint ${String(store.snapshots.length + 1)}`,
    createdAt: nowIso(),
    draft: cloneDraft(draft)
  };

  let next = [...store.snapshots, snapshot];

  // Evict oldest if over limit
  if (next.length > store.maxSnapshots) {
    next = next.slice(next.length - store.maxSnapshots);
  }

  return {
    store: {
      ...store,
      snapshots: next
    },
    snapshot
  };
}

/**
 * Restores the draft from a snapshot by id.
 *
 * Returns a deep copy of the stored draft so the caller can mutate freely.
 * The snapshot itself remains in the store. Returns null if the id is not found.
 */
export function restoreDraftSnapshot(
  store: DraftSnapshotStore,
  snapshotId: string
): RestoreSnapshotResult {
  const snapshot = store.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) {
    return { store, draft: null };
  }

  return {
    store,
    draft: cloneDraft(snapshot.draft)
  };
}

/**
 * Removes a snapshot by id from the store.
 */
export function deleteDraftSnapshot(
  store: DraftSnapshotStore,
  snapshotId: string
): DraftSnapshotStore {
  const next = store.snapshots.filter((s) => s.id !== snapshotId);
  if (next.length === store.snapshots.length) {
    return store;
  }

  return {
    ...store,
    snapshots: next
  };
}

/**
 * Clears all snapshots from the store.
 */
export function clearDraftSnapshots(
  store: DraftSnapshotStore
): DraftSnapshotStore {
  if (store.snapshots.length === 0) {
    return store;
  }

  return {
    ...store,
    snapshots: []
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Returns the list of all snapshots in creation order. */
export function listDraftSnapshots(
  store: DraftSnapshotStore
): readonly DraftSnapshot[] {
  return store.snapshots;
}

/** Returns a snapshot by id, or null. */
export function getDraftSnapshot(
  store: DraftSnapshotStore,
  snapshotId: string
): DraftSnapshot | null {
  return store.snapshots.find((s) => s.id === snapshotId) ?? null;
}

/** Returns the number of snapshots currently stored. */
export function snapshotCount(store: DraftSnapshotStore): number {
  return store.snapshots.length;
}

/** Returns whether the store has reached its maximum capacity. */
export function isSnapshotStoreFull(store: DraftSnapshotStore): boolean {
  return store.snapshots.length >= store.maxSnapshots;
}
