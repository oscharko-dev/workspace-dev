import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetImportGovernanceListenersForTests,
  dispatchImportGovernanceEvent,
  isImportSessionGovernanceEvent,
  subscribeToImportGovernanceEvents,
  toImportGovernanceEvent,
  type ImportGovernanceEvent,
  type ImportSessionGovernanceEvent,
  type McpBudgetThresholdCrossedEvent,
} from "./import-governance-events";
import type { PasteImportSession } from "./paste-import-history";

afterEach(() => {
  __resetImportGovernanceListenersForTests();
});

function makeSession(
  overrides: Partial<PasteImportSession> = {},
): PasteImportSession {
  return {
    id: "paste-import-1",
    fileKey: "FILE",
    nodeId: "1-2",
    nodeName: "Home",
    importedAt: "2026-04-15T12:00:00.000Z",
    nodeCount: 30,
    fileCount: 7,
    selectedNodes: [],
    scope: "all",
    componentMappings: 4,
    pasteIdentityKey: null,
    jobId: "job-1",
    reviewRequired: true,
    ...overrides,
  };
}

describe("toImportGovernanceEvent", () => {
  it("derives an event matching the session's audit-relevant fields", () => {
    const session = makeSession({
      scope: "partial",
      selectedNodes: ["a", "b"],
    });
    const event = toImportGovernanceEvent(session);
    expect(event).toEqual<ImportSessionGovernanceEvent>({
      kind: "imported",
      timestamp: "2026-04-15T12:00:00.000Z",
      scope: "partial",
      selectedNodes: ["a", "b"],
      fileCount: 7,
      nodeCount: 30,
      jobId: "job-1",
      fileKey: "FILE",
      sessionId: "paste-import-1",
      reviewRequired: true,
    });
  });

  it("does not include userId when not supplied (transport attaches it)", () => {
    const event = toImportGovernanceEvent(makeSession());
    expect(event.userId).toBeUndefined();
  });

  it("forwards session.id as sessionId on the emitted event", () => {
    const event = toImportGovernanceEvent(
      makeSession({ id: "paste-import-forwarded" }),
    );
    expect(event.sessionId).toBe("paste-import-forwarded");
  });

  it("forwards qualityScore when present on the session", () => {
    const event = toImportGovernanceEvent(makeSession({ qualityScore: 87 }));
    expect(event.qualityScore).toBe(87);
  });

  it("omits qualityScore when the session does not carry one", () => {
    const event = toImportGovernanceEvent(makeSession());
    expect(event.qualityScore).toBeUndefined();
  });

  it("omits reviewRequired when the session does not carry it", () => {
    const session = makeSession();
    const { reviewRequired, ...legacySession } = session;
    void reviewRequired;
    const event = toImportGovernanceEvent(legacySession);
    expect(event.reviewRequired).toBeUndefined();
  });
});

describe("subscribeToImportGovernanceEvents", () => {
  it("invokes registered listeners in registration order", () => {
    const calls: string[] = [];
    subscribeToImportGovernanceEvents(() => {
      calls.push("a");
    });
    subscribeToImportGovernanceEvents(() => {
      calls.push("b");
    });

    dispatchImportGovernanceEvent(toImportGovernanceEvent(makeSession()));
    expect(calls).toEqual(["a", "b"]);
  });

  it("returns an unsubscribe function that detaches the listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToImportGovernanceEvents(listener);
    unsubscribe();
    dispatchImportGovernanceEvent(toImportGovernanceEvent(makeSession()));
    expect(listener).not.toHaveBeenCalled();
  });

  it("isolates listener exceptions so other listeners still fire", () => {
    const survivor = vi.fn();
    subscribeToImportGovernanceEvents(() => {
      throw new Error("boom");
    });
    subscribeToImportGovernanceEvents(survivor);
    dispatchImportGovernanceEvent(toImportGovernanceEvent(makeSession()));
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("default state has no listeners registered (no-op dispatch)", () => {
    expect(() =>
      dispatchImportGovernanceEvent(toImportGovernanceEvent(makeSession())),
    ).not.toThrow();
  });
});

describe("McpBudgetThresholdCrossedEvent — union flow (#1093)", () => {
  it("flows through the listener as a discriminated union variant", () => {
    const received: ImportGovernanceEvent[] = [];
    subscribeToImportGovernanceEvents((event) => received.push(event));

    const mcpEvent: McpBudgetThresholdCrossedEvent = {
      kind: "mcp-budget-threshold-crossed",
      callsThisMonth: 5,
      budget: 6,
      month: "2026-04",
    };
    dispatchImportGovernanceEvent(mcpEvent);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(mcpEvent);
  });

  it("isImportSessionGovernanceEvent narrows the mcp variant to false", () => {
    const mcpEvent: ImportGovernanceEvent = {
      kind: "mcp-budget-threshold-crossed",
      callsThisMonth: 6,
      budget: 6,
      month: "2026-04",
    };
    expect(isImportSessionGovernanceEvent(mcpEvent)).toBe(false);
  });

  it("isImportSessionGovernanceEvent narrows the session variant to true", () => {
    const session = toImportGovernanceEvent(makeSession());
    expect(isImportSessionGovernanceEvent(session)).toBe(true);
  });
});
