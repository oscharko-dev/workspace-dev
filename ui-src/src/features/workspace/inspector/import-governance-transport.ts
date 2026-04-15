/**
 * Client governance transport (Issue #994).
 *
 * Subscribes to in-memory governance events and forwards them to the
 * server-side audit endpoint introduced in Wave 2. The transport is
 * best-effort: network errors and non-2xx responses are swallowed so a
 * flaky audit log never breaks the Inspector flow.
 */

import type {
  ImportGovernanceEvent,
  ImportGovernanceListener,
} from "./import-governance-events";
import type { WorkspaceImportSessionEventKind } from "./import-review-state";

export interface ImportGovernanceTransportOptions {
  /** Base URL of the workspace server. Defaults to same-origin. */
  readonly baseUrl?: string;
  /** Override `fetch` (for tests). Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Called with the error + event when a POST fails or the server returns a
   * non-2xx response. Defaults to no-op.
   */
  readonly onError?: (error: unknown, event: ImportGovernanceEvent) => void;
}

interface GovernancePostBody {
  readonly kind: WorkspaceImportSessionEventKind;
  readonly actor?: string;
  readonly metadata: Record<string, string | number | boolean | null>;
}

function buildMetadata(
  event: ImportGovernanceEvent,
): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = {
    jobId: event.jobId,
    fileKey: event.fileKey,
    scope: event.scope,
    fileCount: event.fileCount,
    nodeCount: event.nodeCount,
  };
  if (event.qualityScore !== undefined) {
    metadata.qualityScore = event.qualityScore;
  }
  return metadata;
}

function buildBody(event: ImportGovernanceEvent): GovernancePostBody {
  const body: GovernancePostBody = {
    kind: "imported",
    metadata: buildMetadata(event),
  };
  if (event.userId !== undefined) {
    return { ...body, actor: event.userId };
  }
  return body;
}

function toEndpoint(baseUrl: string | undefined, sessionId: string): string {
  const prefix = baseUrl ?? "";
  return `${prefix}/workspace/import-sessions/${encodeURIComponent(sessionId)}/events`;
}

/**
 * Create a governance-event listener that forwards each event to the
 * `/workspace/import-sessions/:id/events` endpoint. Events with no
 * `sessionId` are silently skipped (no network call is made).
 */
export function createImportGovernanceTransport(
  options?: ImportGovernanceTransportOptions,
): ImportGovernanceListener {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const onError = options?.onError;
  const baseUrl = options?.baseUrl;

  return (event: ImportGovernanceEvent): void => {
    if (event.sessionId === undefined || event.sessionId.length === 0) {
      return;
    }
    const url = toEndpoint(baseUrl, event.sessionId);
    const body = buildBody(event);

    void (async (): Promise<void> => {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          onError?.(
            new Error(
              `Governance transport received non-2xx response: ${String(response.status)}`,
            ),
            event,
          );
        }
      } catch (error) {
        onError?.(error, event);
      }
    })();
  };
}
