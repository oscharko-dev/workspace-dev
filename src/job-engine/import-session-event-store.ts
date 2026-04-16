import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONTRACT_VERSION,
  type WorkspaceImportSessionEvent,
  type WorkspaceImportSessionEventKind,
} from "../contracts/index.js";

const DEFAULT_MAX_EVENTS_PER_SESSION = 200;
const EVENTS_DIR_NAME = "import-session-events";
const NOTE_MAX_LENGTH = 1024;

const EVENT_KINDS: ReadonlySet<string> =
  new Set<WorkspaceImportSessionEventKind>([
    "imported",
    "review_started",
    "approved",
    "applied",
    "rejected",
    "apply_blocked",
    "note",
  ]);

export interface ImportSessionEventStore {
  list(sessionId: string): Promise<WorkspaceImportSessionEvent[]>;
  append(event: WorkspaceImportSessionEvent): Promise<void>;
  deleteAllForSession(sessionId: string): Promise<void>;
}

interface PersistedImportSessionEventsEnvelope {
  contractVersion: string;
  sessionId: string;
  events: WorkspaceImportSessionEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isEventKind = (
  value: unknown,
): value is WorkspaceImportSessionEventKind => {
  return typeof value === "string" && EVENT_KINDS.has(value);
};

const isFlatMetadata = (
  value: unknown,
): value is Record<string, string | number | boolean | null> => {
  if (!isRecord(value)) {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      return false;
    }
  }
  return true;
};

const isImportSessionEvent = (
  value: unknown,
  sessionId: string,
): value is WorkspaceImportSessionEvent => {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return false;
  }
  if (
    typeof value.sessionId !== "string" ||
    value.sessionId.length === 0 ||
    value.sessionId !== sessionId
  ) {
    return false;
  }
  if (!isEventKind(value.kind)) {
    return false;
  }
  if (typeof value.at !== "string" || value.at.length === 0) {
    return false;
  }
  if (value.actor !== undefined && typeof value.actor !== "string") {
    return false;
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    return false;
  }
  if (value.metadata !== undefined && !isFlatMetadata(value.metadata)) {
    return false;
  }
  return true;
};

/**
 * Reject session IDs that could traverse or break the on-disk layout.
 * Throws a descriptive error rather than silently coercing.
 */
const sanitizeSessionId = (sessionId: string): string => {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string.");
  }
  if (
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    sessionId.includes("..") ||
    sessionId.includes("\0")
  ) {
    throw new Error(
      `sessionId '${sessionId}' contains forbidden characters (/, \\, .., or NUL).`,
    );
  }
  return sessionId;
};

const truncateNote = (note: string): string => {
  return note.length > NOTE_MAX_LENGTH ? note.slice(0, NOTE_MAX_LENGTH) : note;
};

const isMaterialEvent = (event: WorkspaceImportSessionEvent): boolean => {
  return event.kind !== "note";
};

const trimEventsForRetention = ({
  events,
  maxEventsPerSession,
}: {
  events: readonly WorkspaceImportSessionEvent[];
  maxEventsPerSession: number;
}): WorkspaceImportSessionEvent[] => {
  if (maxEventsPerSession <= 0) {
    return [];
  }
  if (events.length <= maxEventsPerSession) {
    return [...events];
  }

  const indexedEvents = events.map((event, index) => ({ event, index }));
  const materialEvents = indexedEvents.filter(({ event }) =>
    isMaterialEvent(event),
  );
  const retainedMaterialEvents = materialEvents.slice(
    Math.max(0, materialEvents.length - maxEventsPerSession),
  );
  const remainingSlots = Math.max(
    0,
    maxEventsPerSession - retainedMaterialEvents.length,
  );
  const retainedNotes =
    remainingSlots === 0
      ? []
      : indexedEvents
          .filter(({ event }) => !isMaterialEvent(event))
          .slice(-remainingSlots);

  return [...retainedMaterialEvents, ...retainedNotes]
    .sort((left, right) => left.index - right.index)
    .map(({ event }) => event);
};

const normalizeEventForWrite = (
  event: WorkspaceImportSessionEvent,
): WorkspaceImportSessionEvent => {
  const normalized: WorkspaceImportSessionEvent = {
    id: event.id,
    sessionId: event.sessionId,
    kind: event.kind,
    at: event.at,
  };
  if (event.actor !== undefined) {
    normalized.actor = event.actor;
  }
  if (event.note !== undefined) {
    normalized.note = truncateNote(event.note);
  }
  if (event.metadata !== undefined) {
    normalized.metadata = { ...event.metadata };
  }
  return normalized;
};

const resolveSessionFilePath = ({
  rootDir,
  sessionId,
}: {
  rootDir: string;
  sessionId: string;
}): string => {
  return path.join(rootDir, EVENTS_DIR_NAME, `${sessionId}.json`);
};

const readEventsFile = async ({
  filePath,
  sessionId,
}: {
  filePath: string;
  sessionId: string;
}): Promise<WorkspaceImportSessionEvent[]> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) {
    return [];
  }
  if (parsed.contractVersion !== CONTRACT_VERSION) {
    return [];
  }
  if (parsed.sessionId !== sessionId) {
    return [];
  }
  if (!Array.isArray(parsed.events)) {
    return [];
  }

  const accepted: WorkspaceImportSessionEvent[] = [];
  for (const entry of parsed.events) {
    if (isImportSessionEvent(entry, sessionId)) {
      accepted.push(entry);
    }
  }
  return accepted;
};

const writeEventsFile = async ({
  filePath,
  sessionId,
  events,
}: {
  filePath: string;
  sessionId: string;
  events: readonly WorkspaceImportSessionEvent[];
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const envelope: PersistedImportSessionEventsEnvelope = {
    contractVersion: CONTRACT_VERSION,
    sessionId,
    events: [...events],
  };
  await writeFile(
    temporaryPath,
    `${JSON.stringify(envelope, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, filePath);
};

export const createImportSessionEventStore = ({
  rootDir,
  maxEventsPerSession = DEFAULT_MAX_EVENTS_PER_SESSION,
}: {
  rootDir: string;
  maxEventsPerSession?: number;
}): ImportSessionEventStore => {
  const resolvePath = (sessionId: string): string =>
    resolveSessionFilePath({ rootDir, sessionId });

  return {
    async list(sessionId: string): Promise<WorkspaceImportSessionEvent[]> {
      const safeSessionId = sanitizeSessionId(sessionId);
      return await readEventsFile({
        filePath: resolvePath(safeSessionId),
        sessionId: safeSessionId,
      });
    },

    async append(event: WorkspaceImportSessionEvent): Promise<void> {
      const safeSessionId = sanitizeSessionId(event.sessionId);
      const normalized = normalizeEventForWrite({
        ...event,
        sessionId: safeSessionId,
      });
      const filePath = resolvePath(safeSessionId);
      const current = await readEventsFile({
        filePath,
        sessionId: safeSessionId,
      });
      const combined = [...current, normalized];
      const trimmed = trimEventsForRetention({
        events: combined,
        maxEventsPerSession,
      });
      await writeEventsFile({
        filePath,
        sessionId: safeSessionId,
        events: trimmed,
      });
    },

    async deleteAllForSession(sessionId: string): Promise<void> {
      const safeSessionId = sanitizeSessionId(sessionId);
      const filePath = resolvePath(safeSessionId);
      try {
        await unlink(filePath);
      } catch {
        // Best-effort cleanup; file may not exist.
      }
    },
  };
};
