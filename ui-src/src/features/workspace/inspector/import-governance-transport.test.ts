import { describe, expect, it, vi } from "vitest";
import type {
  ImportGovernanceEvent,
  ImportSessionGovernanceEvent,
  McpBudgetThresholdCrossedEvent,
} from "./import-governance-events";
import { createImportGovernanceTransport } from "./import-governance-transport";

function makeEvent(
  overrides: Partial<ImportSessionGovernanceEvent> = {},
): ImportSessionGovernanceEvent {
  return {
    kind: "imported",
    timestamp: "2026-04-15T10:00:00.000Z",
    scope: "all",
    selectedNodes: [],
    fileCount: 3,
    nodeCount: 12,
    jobId: "job-1",
    fileKey: "FILE",
    sessionId: "paste-import-1",
    ...overrides,
  };
}

function jsonResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flush(): Promise<void> {
  // Allow the fire-and-forget async POST inside the listener to resolve.
  await Promise.resolve();
  await Promise.resolve();
}

describe("createImportGovernanceTransport", () => {
  it("POSTs to /workspace/import-sessions/:id/events with a governance body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(
      makeEvent({
        sessionId: "paste-import-42",
        qualityScore: 88,
      }),
    );
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/workspace/import-sessions/paste-import-42/events");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    expect(parsed.kind).toBe("imported");
    expect(parsed.at).toBe("2026-04-15T10:00:00.000Z");
    expect(parsed.metadata).toEqual({
      jobId: "job-1",
      fileKey: "FILE",
      scope: "all",
      selectedNodes: "[]",
      fileCount: 3,
      nodeCount: 12,
      qualityScore: 88,
    });
  });

  it("includes the actor when the event carries a userId", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(makeEvent({ userId: "user-1" }));
    await flush();

    const bodyInit = fetchImpl.mock.calls[0]?.[1]?.body;
    const bodyText = typeof bodyInit === "string" ? bodyInit : "";
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    expect(body.actor).toBe("user-1");
  });

  it("forwards note and reviewRequired when present on the event", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(
      makeEvent({
        kind: "applied",
        selectedNodes: ["node-1", "node-2"],
        reviewRequired: true,
        note: "Override approved by reviewer.",
      }),
    );
    await flush();

    const bodyInit = fetchImpl.mock.calls[0]?.[1]?.body;
    const bodyText = typeof bodyInit === "string" ? bodyInit : "";
    const body = JSON.parse(bodyText) as {
      kind: string;
      note?: string;
      metadata: Record<string, unknown>;
    };
    expect(body.kind).toBe("applied");
    expect(body.note).toBe("Override approved by reviewer.");
    expect(body.metadata.reviewRequired).toBe(true);
    expect(body.metadata.selectedNodes).toBe('["node-1","node-2"]');
  });

  it("omits qualityScore from metadata when the event has none", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(makeEvent());
    await flush();

    const bodyInit = fetchImpl.mock.calls[0]?.[1]?.body;
    const bodyText = typeof bodyInit === "string" ? bodyInit : "";
    const body = JSON.parse(bodyText) as { metadata: Record<string, unknown> };
    expect(body.metadata.qualityScore).toBeUndefined();
  });

  it("swallows non-2xx responses and invokes onError", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(422));
    const onError = vi.fn();
    const listener = createImportGovernanceTransport({ fetchImpl, onError });

    expect(() => {
      listener(makeEvent());
    }).not.toThrow();
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, event] = onError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("422");
    expect(event).toMatchObject({ sessionId: "paste-import-1" });
  });

  it("swallows a rejected fetch (network error) and invokes onError", async () => {
    const boom = new Error("network down");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(boom);
    const onError = vi.fn();
    const listener = createImportGovernanceTransport({ fetchImpl, onError });

    expect(() => {
      listener(makeEvent());
    }).not.toThrow();
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0] ?? [];
    expect(error).toBe(boom);
  });

  it("never throws even when onError is not provided", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("boom"));
    const listener = createImportGovernanceTransport({ fetchImpl });

    expect(() => {
      listener(makeEvent());
    }).not.toThrow();
    await flush();
  });

  it("does not call fetch when sessionId is undefined", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });
    const { sessionId: _omit, ...rest } = makeEvent();
    void _omit;

    listener(rest as ImportGovernanceEvent);
    await flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call fetch when sessionId is an empty string", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(makeEvent({ sessionId: "" }));
    await flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prefixes the URL with baseUrl when provided", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({
      fetchImpl,
      baseUrl: "https://audit.example",
    });

    listener(makeEvent({ sessionId: "sess-1" }));
    await flush();

    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://audit.example/workspace/import-sessions/sess-1/events",
    );
  });

  it("URL-encodes the sessionId segment", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    listener(makeEvent({ sessionId: "paste import/42" }));
    await flush();

    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/workspace/import-sessions/paste%20import%2F42/events");
  });

  it("ignores mcp-budget-threshold-crossed events (no fetch, no body)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200));
    const listener = createImportGovernanceTransport({ fetchImpl });

    const event: McpBudgetThresholdCrossedEvent = {
      kind: "mcp-budget-threshold-crossed",
      callsThisMonth: 5,
      budget: 6,
      month: "2026-04",
    };
    listener(event);
    await flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
