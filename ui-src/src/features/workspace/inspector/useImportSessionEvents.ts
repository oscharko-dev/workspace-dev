/**
 * React Query hook that fetches the audit trail for a single import session
 * (Issue #994). Later waves wire this into the Import History panel.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import type { WorkspaceImportSessionEvent } from "./import-review-state";

export interface UseImportSessionEventsOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

export interface UseImportSessionEventsResult {
  readonly events: readonly WorkspaceImportSessionEvent[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

const EMPTY_EVENTS: readonly WorkspaceImportSessionEvent[] = [];

interface ImportSessionEventsResponse {
  readonly events?: readonly WorkspaceImportSessionEvent[];
}

function toQueryKey(sessionId: string): readonly unknown[] {
  return ["import-session-events", sessionId] as const;
}

function toEventsUrl(baseUrl: string | undefined, sessionId: string): string {
  const prefix = baseUrl ?? "";
  return `${prefix}/workspace/import-sessions/${encodeURIComponent(sessionId)}/events`;
}

export function useImportSessionEvents(
  sessionId: string | null,
  options?: UseImportSessionEventsOptions,
): UseImportSessionEventsResult {
  const queryClient = useQueryClient();
  const fetchImpl = options?.fetchImpl;
  const baseUrl = options?.baseUrl;

  const query = useQuery({
    queryKey:
      sessionId === null
        ? ["import-session-events", null]
        : toQueryKey(sessionId),
    queryFn: async () => {
      if (sessionId === null) {
        return { ok: true, status: 200, payload: { events: EMPTY_EVENTS } };
      }
      const url = toEventsUrl(baseUrl, sessionId);
      if (fetchImpl !== undefined) {
        const response = await fetchImpl(url);
        const text = await response.text();
        let parsed: unknown = {};
        try {
          parsed = text.trim().length > 0 ? JSON.parse(text) : {};
        } catch {
          parsed = {};
        }
        return {
          ok: response.ok,
          status: response.status,
          payload: parsed as ImportSessionEventsResponse,
        };
      }
      return await fetchJson<ImportSessionEventsResponse>({ url });
    },
    enabled: sessionId !== null,
    staleTime: 10_000,
  });

  const events = useMemo<readonly WorkspaceImportSessionEvent[]>(() => {
    if (sessionId === null) {
      return EMPTY_EVENTS;
    }
    const data = query.data;
    if (data === undefined || !data.ok) {
      return EMPTY_EVENTS;
    }
    const payload = data.payload as ImportSessionEventsResponse;
    const entries = payload.events;
    if (!Array.isArray(entries)) {
      return EMPTY_EVENTS;
    }
    return entries as readonly WorkspaceImportSessionEvent[];
  }, [query.data, sessionId]);

  const error = useMemo<string | null>(() => {
    if (sessionId === null) {
      return null;
    }
    if (query.isError) {
      return query.error instanceof Error
        ? query.error.message
        : "Could not load import session events.";
    }
    const data = query.data;
    if (data !== undefined && !data.ok) {
      const payload = data.payload as { message?: unknown };
      if (typeof payload.message === "string") {
        return payload.message;
      }
      return "Could not load import session events.";
    }
    return null;
  }, [query.data, query.error, query.isError, sessionId]);

  const refetch = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: toQueryKey(sessionId) });
  }, [queryClient, sessionId]);

  return {
    events,
    isLoading: sessionId !== null && query.isLoading,
    error,
    refetch,
  };
}
