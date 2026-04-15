import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONTRACT_VERSION,
  type WorkspaceImportSession,
  type WorkspaceImportSessionStatus,
} from "../contracts/index.js";

const IMPORT_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "imported",
  "reviewing",
  "approved",
  "applied",
  "rejected",
]);

const isImportSessionStatus = (
  value: unknown,
): value is WorkspaceImportSessionStatus => {
  return typeof value === "string" && IMPORT_SESSION_STATUSES.has(value);
};

const DEFAULT_MAX_ENTRIES = 20;
const STORE_FILE_NAME = "import-sessions.json";

export interface ImportSessionMatchQuery {
  pasteIdentityKey?: string | null;
  fileKey?: string;
  nodeId?: string;
}

export interface ImportSessionStore {
  list(): Promise<WorkspaceImportSession[]>;
  save(session: WorkspaceImportSession): Promise<void>;
  delete(sessionId: string): Promise<WorkspaceImportSession | undefined>;
  findMatching(
    query: ImportSessionMatchQuery,
  ): Promise<WorkspaceImportSession | undefined>;
}

interface PersistedImportSessionsEnvelope {
  contractVersion: string;
  sessions: WorkspaceImportSession[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
};

const isImportSession = (value: unknown): value is WorkspaceImportSession => {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.jobId !== "string" ||
    typeof value.sourceMode !== "string" ||
    typeof value.fileKey !== "string" ||
    typeof value.nodeId !== "string" ||
    typeof value.nodeName !== "string" ||
    typeof value.importedAt !== "string" ||
    typeof value.nodeCount !== "number" ||
    typeof value.fileCount !== "number" ||
    !isStringArray(value.selectedNodes) ||
    (value.scope !== "all" && value.scope !== "partial") ||
    typeof value.componentMappings !== "number" ||
    typeof value.replayable !== "boolean"
  ) {
    return false;
  }
  if (value.version !== undefined && typeof value.version !== "string") {
    return false;
  }
  if (
    value.pasteIdentityKey !== null &&
    typeof value.pasteIdentityKey !== "string"
  ) {
    return false;
  }
  if (
    value.replayDisabledReason !== undefined &&
    typeof value.replayDisabledReason !== "string"
  ) {
    return false;
  }
  if (value.userId !== undefined && typeof value.userId !== "string") {
    return false;
  }
  if (
    value.qualityScore !== undefined &&
    (typeof value.qualityScore !== "number" ||
      !Number.isInteger(value.qualityScore) ||
      value.qualityScore < 0 ||
      value.qualityScore > 100)
  ) {
    return false;
  }
  if (value.status !== undefined && !isImportSessionStatus(value.status)) {
    return false;
  }
  if (
    value.reviewRequired !== undefined &&
    typeof value.reviewRequired !== "boolean"
  ) {
    return false;
  }
  return true;
};

const isEnvelope = (
  value: unknown,
): value is PersistedImportSessionsEnvelope => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.contractVersion === "string" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isImportSession)
  );
};

const sortNewestFirst = (
  sessions: readonly WorkspaceImportSession[],
): WorkspaceImportSession[] => {
  return [...sessions].sort((left, right) =>
    right.importedAt.localeCompare(left.importedAt),
  );
};

const sanitizeQueryString = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const matchesImportSession = ({
  session,
  query,
}: {
  session: WorkspaceImportSession;
  query: ImportSessionMatchQuery;
}): boolean => {
  const pasteIdentityKey = sanitizeQueryString(query.pasteIdentityKey);
  if (
    pasteIdentityKey !== null &&
    session.pasteIdentityKey === pasteIdentityKey
  ) {
    return true;
  }

  const fileKey = sanitizeQueryString(query.fileKey);
  const nodeId = sanitizeQueryString(query.nodeId);
  if (
    fileKey !== null &&
    nodeId !== null &&
    session.fileKey === fileKey &&
    session.nodeId === nodeId
  ) {
    return true;
  }

  return fileKey !== null && nodeId === null && session.fileKey === fileKey;
};

const readSessionsFile = async ({
  filePath,
}: {
  filePath: string;
}): Promise<WorkspaceImportSession[]> => {
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

  if (!isEnvelope(parsed) || parsed.contractVersion !== CONTRACT_VERSION) {
    return [];
  }

  return sortNewestFirst(parsed.sessions);
};

const writeSessionsFile = async ({
  filePath,
  sessions,
}: {
  filePath: string;
  sessions: readonly WorkspaceImportSession[];
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        contractVersion: CONTRACT_VERSION,
        sessions: sortNewestFirst(sessions),
      } satisfies PersistedImportSessionsEnvelope,
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(temporaryPath, filePath);
};

export const createImportSessionStore = ({
  rootDir,
  maxEntries = DEFAULT_MAX_ENTRIES,
}: {
  rootDir: string;
  maxEntries?: number;
}): ImportSessionStore => {
  const filePath = path.join(rootDir, STORE_FILE_NAME);

  return {
    async list(): Promise<WorkspaceImportSession[]> {
      return await readSessionsFile({ filePath });
    },

    async save(session: WorkspaceImportSession): Promise<void> {
      const current = await readSessionsFile({ filePath });
      const next = [
        session,
        ...current.filter((entry) => entry.id !== session.id),
      ].slice(0, maxEntries);
      await writeSessionsFile({ filePath, sessions: next });
    },

    async delete(
      sessionId: string,
    ): Promise<WorkspaceImportSession | undefined> {
      const current = await readSessionsFile({ filePath });
      const removed = current.find((entry) => entry.id === sessionId);
      if (!removed) {
        return undefined;
      }
      const next = current.filter((entry) => entry.id !== sessionId);
      if (next.length === 0) {
        try {
          await unlink(filePath);
        } catch {
          // Best-effort cleanup.
        }
        return removed;
      }
      await writeSessionsFile({ filePath, sessions: next });
      return removed;
    },

    async findMatching(
      query: ImportSessionMatchQuery,
    ): Promise<WorkspaceImportSession | undefined> {
      const sessions = await readSessionsFile({ filePath });
      return sessions.find((session) =>
        matchesImportSession({ session, query }),
      );
    },
  };
};
