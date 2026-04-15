import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetImportGovernanceListenersForTests,
  dispatchImportGovernanceEvent,
  subscribeToImportGovernanceEvents,
  toImportGovernanceEvent,
  type ImportGovernanceEvent,
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
    expect(event).toEqual<ImportGovernanceEvent>({
      timestamp: "2026-04-15T12:00:00.000Z",
      scope: "partial",
      selectedNodes: ["a", "b"],
      fileCount: 7,
      nodeCount: 30,
      jobId: "job-1",
      fileKey: "FILE",
    });
  });

  it("does not include userId when not supplied (transport attaches it)", () => {
    const event = toImportGovernanceEvent(makeSession());
    expect(event.userId).toBeUndefined();
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
