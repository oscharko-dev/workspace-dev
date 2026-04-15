// ---------------------------------------------------------------------------
// Paste Import History (Issue #1010)
//
// Pure module backing the Inspector "Import History" feature. Tracks past
// paste-pipeline imports so the UI can detect re-imports of the same source
// (matched by server-supplied pasteIdentityKey or by Figma {fileKey,nodeId}).
//
// Persistence mirrors the inspector-override-draft pattern: versioned
// localStorage key, SSR-safe, exceptions swallowed and surfaced as result
// fields rather than thrown.
// ---------------------------------------------------------------------------

import type { WorkspaceImportSessionStatus } from "./import-review-state";

export const PASTE_IMPORT_HISTORY_VERSION = 1;
export const MAX_IMPORT_HISTORY_ENTRIES = 20;

const IMPORT_SESSION_STATUSES: ReadonlySet<WorkspaceImportSessionStatus> =
  new Set<WorkspaceImportSessionStatus>([
    "imported",
    "reviewing",
    "approved",
    "applied",
    "rejected",
  ]);

const PASTE_IMPORT_HISTORY_STORAGE_VERSION = 1;

export interface PasteImportSession {
  /** "paste-import-{timestamp-ms}" */
  readonly id: string;
  /** Figma file key, when known (URL or paste payload). May be empty when only an identity key is available. */
  readonly fileKey: string;
  /** Root node id (e.g. "1:2"). May be empty for full-file imports. */
  readonly nodeId: string;
  /** Display name for the root node ("HomePage"), or fileKey when unknown. */
  readonly nodeName: string;
  /** ISO timestamp of when the import completed. */
  readonly importedAt: string;
  /** Total nodes in the imported tree. */
  readonly nodeCount: number;
  /** Generated files count. */
  readonly fileCount: number;
  /**
   * Node IDs that were included in the generation scope. Convention: an empty
   * array means the import was unscoped (all nodes generated). When `scope` is
   * `"partial"`, this list enumerates exactly which nodes were kept.
   */
  readonly selectedNodes: readonly string[];
  /**
   * Whether the import generated the full tree or a user-selected subset.
   * Disambiguates the empty-array case in `selectedNodes`.
   */
  readonly scope: "all" | "partial";
  /** Number of components mapped (from componentManifest). */
  readonly componentMappings: number;
  /**
   * Figma file version at import time, when known. Optional because the
   * server does not currently expose this field; populated only when the
   * pipeline state carries it.
   */
  readonly version?: string;
  /** Source mode persisted by the server for replay and auditability. */
  readonly sourceMode?: string;
  /** Server-supplied pasteIdentityKey (delta summary) when present \u2014 used for re-import matching. */
  readonly pasteIdentityKey: string | null;
  /** Underlying jobId so callers can re-open the result. */
  readonly jobId: string;
  /** Whether this session can be re-imported directly from history. */
  readonly replayable?: boolean;
  /** Optional explanation shown when replay is disabled. */
  readonly replayDisabledReason?: string;
  /** Persisted quality score (integer 0..100) — optional for backwards compatibility. */
  readonly qualityScore?: number;
  /** Persisted review lifecycle status — optional for backwards compatibility. */
  readonly status?: WorkspaceImportSessionStatus;
}

export interface PasteImportHistory {
  readonly entries: readonly PasteImportSession[];
}

export interface PersistImportHistoryResult {
  ok: boolean;
  error: string | null;
}

export interface RestoreImportHistoryResult {
  history: PasteImportHistory;
  warning: string | null;
}

export function toPasteImportHistoryStorageKey(): string {
  return `workspace-dev:paste-import-history:v${String(PASTE_IMPORT_HISTORY_STORAGE_VERSION)}`;
}

export function createEmptyImportHistory(): PasteImportHistory {
  return { entries: [] };
}

export function generateImportSessionId(now: () => number = Date.now): string {
  return `paste-import-${String(now())}`;
}

export function addImportSession(
  history: PasteImportHistory,
  session: PasteImportSession,
): PasteImportHistory {
  const withoutDuplicate = history.entries.filter(
    (entry) => entry.id !== session.id,
  );
  const appended = [...withoutDuplicate, session];
  const trimmed =
    appended.length > MAX_IMPORT_HISTORY_ENTRIES
      ? appended.slice(appended.length - MAX_IMPORT_HISTORY_ENTRIES)
      : appended;
  return { entries: trimmed };
}

export function removeImportSession(
  history: PasteImportHistory,
  sessionId: string,
): PasteImportHistory {
  const nextEntries = history.entries.filter((entry) => entry.id !== sessionId);
  if (nextEntries.length === history.entries.length) {
    return history;
  }
  return { entries: nextEntries };
}

export interface FindPreviousImportQuery {
  pasteIdentityKey?: string | null;
  fileKey?: string;
  nodeId?: string;
}

export function findPreviousImport(
  history: PasteImportHistory,
  query: FindPreviousImportQuery,
): PasteImportSession | null {
  const queryKey =
    typeof query.pasteIdentityKey === "string" &&
    query.pasteIdentityKey.length > 0
      ? query.pasteIdentityKey
      : null;
  const queryFileKey = typeof query.fileKey === "string" ? query.fileKey : "";
  const queryNodeId = typeof query.nodeId === "string" ? query.nodeId : "";
  const canMatchByLocator = queryFileKey.length > 0 && queryNodeId.length > 0;

  // Iterate from most recent (end) to oldest (start) and return first match.
  for (let index = history.entries.length - 1; index >= 0; index -= 1) {
    const entry = history.entries[index];
    if (entry === undefined) {
      continue;
    }
    if (queryKey !== null && entry.pasteIdentityKey === queryKey) {
      return entry;
    }
    if (
      canMatchByLocator &&
      entry.fileKey === queryFileKey &&
      entry.nodeId === queryNodeId
    ) {
      return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface PersistedImportHistoryEnvelope {
  version: number;
  entries: readonly PasteImportSession[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isWorkspaceImportSessionStatus(
  value: unknown,
): value is WorkspaceImportSessionStatus {
  return (
    typeof value === "string" &&
    IMPORT_SESSION_STATUSES.has(value as WorkspaceImportSessionStatus)
  );
}

function isPasteImportSession(value: unknown): value is PasteImportSession {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.fileKey !== "string" ||
    typeof value.nodeId !== "string" ||
    typeof value.nodeName !== "string" ||
    typeof value.importedAt !== "string" ||
    typeof value.jobId !== "string"
  ) {
    return false;
  }
  if (
    !isFiniteNonNegativeInteger(value.nodeCount) ||
    !isFiniteNonNegativeInteger(value.fileCount) ||
    !isFiniteNonNegativeInteger(value.componentMappings)
  ) {
    return false;
  }
  if (!isStringArray(value.selectedNodes)) {
    return false;
  }
  if (value.scope !== "all" && value.scope !== "partial") {
    return false;
  }
  if (value.version !== undefined && typeof value.version !== "string") {
    return false;
  }
  if (value.sourceMode !== undefined && typeof value.sourceMode !== "string") {
    return false;
  }
  if (
    value.pasteIdentityKey !== null &&
    typeof value.pasteIdentityKey !== "string"
  ) {
    return false;
  }
  if (value.replayable !== undefined && typeof value.replayable !== "boolean") {
    return false;
  }
  if (
    value.replayDisabledReason !== undefined &&
    typeof value.replayDisabledReason !== "string"
  ) {
    return false;
  }
  if (
    value.qualityScore !== undefined &&
    !isIntegerInRange(value.qualityScore, 0, 100)
  ) {
    return false;
  }
  if (
    value.status !== undefined &&
    !isWorkspaceImportSessionStatus(value.status)
  ) {
    return false;
  }
  return true;
}

function toPersistedEnvelope(
  history: PasteImportHistory,
): PersistedImportHistoryEnvelope {
  return {
    version: PASTE_IMPORT_HISTORY_VERSION,
    entries: history.entries,
  };
}

export function persistImportHistory(
  history: PasteImportHistory,
): PersistImportHistoryResult {
  if (typeof window === "undefined") {
    return { ok: true, error: null };
  }

  try {
    window.localStorage.setItem(
      toPasteImportHistoryStorageKey(),
      JSON.stringify(toPersistedEnvelope(history)),
    );
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error:
        "Could not persist paste import history. In-memory history is still active.",
    };
  }
}

export function restoreImportHistory(): RestoreImportHistoryResult {
  if (typeof window === "undefined") {
    return { history: createEmptyImportHistory(), warning: null };
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(toPasteImportHistoryStorageKey());
  } catch {
    return {
      history: createEmptyImportHistory(),
      warning:
        "Paste import history storage is unavailable in this browser context.",
    };
  }

  if (raw === null) {
    return { history: createEmptyImportHistory(), warning: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      history: createEmptyImportHistory(),
      warning: "Stored paste import history is invalid JSON and was ignored.",
    };
  }

  if (!isRecord(parsed)) {
    return {
      history: createEmptyImportHistory(),
      warning:
        "Stored paste import history is incompatible with the current schema and was ignored.",
    };
  }

  if (parsed.version !== PASTE_IMPORT_HISTORY_VERSION) {
    return {
      history: createEmptyImportHistory(),
      warning: `Stored paste import history version ${String(parsed.version)} is unsupported and was ignored.`,
    };
  }

  if (!Array.isArray(parsed.entries)) {
    return {
      history: createEmptyImportHistory(),
      warning:
        "Stored paste import history is incompatible with the current schema and was ignored.",
    };
  }

  const validEntries: PasteImportSession[] = [];
  for (const entry of parsed.entries) {
    if (isPasteImportSession(entry)) {
      validEntries.push(entry);
    }
  }

  return { history: { entries: validEntries }, warning: null };
}
