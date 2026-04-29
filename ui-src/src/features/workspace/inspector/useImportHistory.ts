import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import {
  createEmptyImportHistory,
  findPreviousImport,
  type FindPreviousImportQuery,
  type PasteImportHistory,
  type PasteImportSession,
} from "./paste-import-history";
import type { WorkspaceJobPipelineMetadataPayload } from "../workspace-page.helpers";

const IMPORT_HISTORY_QUERY_KEY = ["workspace-import-history"] as const;

interface ImportHistoryResponse {
  sessions?: PasteImportSession[];
}

interface DeleteImportSessionResponse {
  sessionId?: string;
  deleted?: boolean;
  jobId?: string;
}

interface ReimportImportSessionResponse {
  sessionId?: string;
  jobId?: string;
  sourceJobId?: string;
  pipelineId?: string;
  pipelineMetadata?: WorkspaceJobPipelineMetadataPayload;
}

export interface ReimportImportSessionResult {
  sessionId: string;
  jobId: string;
  sourceJobId: string | null;
  pipelineId?: string;
  pipelineMetadata?: WorkspaceJobPipelineMetadataPayload;
}

export interface UseImportHistoryResult {
  history: PasteImportHistory;
  warning: string | null;
  removeSession: (sessionId: string) => Promise<void>;
  reimportSession: (
    sessionId: string,
  ) => Promise<ReimportImportSessionResult>;
  findPrevious: (query: FindPreviousImportQuery) => PasteImportSession | null;
}

const toHistory = (payload: unknown): PasteImportHistory => {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "sessions" in payload &&
    Array.isArray((payload as ImportHistoryResponse).sessions)
  ) {
    return {
      entries: (payload as ImportHistoryResponse).sessions ?? [],
    };
  }
  return createEmptyImportHistory();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPipelineMetadata = (
  value: unknown,
): value is WorkspaceJobPipelineMetadataPayload =>
  isRecord(value) &&
  typeof value.pipelineId === "string" &&
  value.pipelineId.length > 0 &&
  typeof value.pipelineDisplayName === "string" &&
  value.pipelineDisplayName.length > 0 &&
  typeof value.templateBundleId === "string" &&
  value.templateBundleId.length > 0 &&
  typeof value.buildProfile === "string" &&
  value.buildProfile.length > 0 &&
  value.deterministic === true;

export function useImportHistory(): UseImportHistoryResult {
  const queryClient = useQueryClient();

  const historyQuery = useQuery({
    queryKey: IMPORT_HISTORY_QUERY_KEY,
    queryFn: async () => {
      return await fetchJson<ImportHistoryResponse>({
        url: "/workspace/import-sessions",
      });
    },
    staleTime: 5_000,
  });

  const removeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return await fetchJson<DeleteImportSessionResponse>({
        url: `/workspace/import-sessions/${encodeURIComponent(sessionId)}`,
        init: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: IMPORT_HISTORY_QUERY_KEY,
      });
    },
  });

  const reimportMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return await fetchJson<ReimportImportSessionResponse>({
        url: `/workspace/import-sessions/${encodeURIComponent(sessionId)}/reimport`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: IMPORT_HISTORY_QUERY_KEY,
      });
    },
  });

  const history = useMemo<PasteImportHistory>(() => {
    if (!historyQuery.data?.ok) {
      return createEmptyImportHistory();
    }
    return toHistory(historyQuery.data.payload);
  }, [historyQuery.data]);

  const warning = useMemo(() => {
    if (historyQuery.isError) {
      return historyQuery.error instanceof Error
        ? historyQuery.error.message
        : "Could not load import history.";
    }
    if (
      historyQuery.data &&
      !historyQuery.data.ok &&
      typeof historyQuery.data.payload === "object" &&
      "message" in historyQuery.data.payload &&
      typeof historyQuery.data.payload.message === "string"
    ) {
      return historyQuery.data.payload.message;
    }
    if (removeMutation.isError) {
      return removeMutation.error instanceof Error
        ? removeMutation.error.message
        : "Could not delete import history entry.";
    }
    if (reimportMutation.isError) {
      return reimportMutation.error instanceof Error
        ? reimportMutation.error.message
        : "Could not re-import history entry.";
    }
    return null;
  }, [
    historyQuery.data,
    historyQuery.error,
    historyQuery.isError,
    removeMutation.error,
    removeMutation.isError,
    reimportMutation.error,
    reimportMutation.isError,
  ]);

  const removeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      await removeMutation.mutateAsync(sessionId);
    },
    [removeMutation],
  );

  const reimportSession = useCallback(
    async (sessionId: string): Promise<ReimportImportSessionResult> => {
      const response = await reimportMutation.mutateAsync(sessionId);
      const payload = response.payload;
      if (
        typeof payload !== "object" ||
        typeof payload.sessionId !== "string" ||
        typeof payload.jobId !== "string"
      ) {
        throw new Error("Re-import response is missing the accepted job id.");
      }
      return {
        sessionId: payload.sessionId,
        jobId: payload.jobId,
        sourceJobId:
          typeof payload.sourceJobId === "string" &&
          payload.sourceJobId.length > 0
            ? payload.sourceJobId
            : null,
        ...(typeof payload.pipelineId === "string" &&
        payload.pipelineId.length > 0
          ? { pipelineId: payload.pipelineId }
          : {}),
        ...(isPipelineMetadata(payload.pipelineMetadata)
          ? { pipelineMetadata: payload.pipelineMetadata }
          : {}),
      };
    },
    [reimportMutation],
  );

  const findPrevious = useCallback(
    (query: FindPreviousImportQuery): PasteImportSession | null =>
      findPreviousImport(history, query),
    [history],
  );

  return {
    history,
    warning,
    removeSession,
    reimportSession,
    findPrevious,
  };
}
