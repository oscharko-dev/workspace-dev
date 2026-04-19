import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION,
  FIGMA_STARTER_BUDGET,
  WARNING_THRESHOLD_PCT,
  __resetFigmaMcpCallCounterForTests,
  dismissBannerForMonth,
  getQuotaSnapshot,
  isBannerDismissedForMonth,
  recordMcpCall,
} from "./figma-mcp-call-counter";
import {
  __resetImportGovernanceListenersForTests,
  subscribeToImportGovernanceEvents,
  type ImportGovernanceEvent,
} from "./import-governance-events";

const STORAGE_KEY = "workspace-dev:mcp-call-counter";
const DISMISS_KEY_PREFIX = "workspace-dev:mcp-budget-banner-dismissed:";

function formatMonth(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

beforeEach(() => {
  __resetFigmaMcpCallCounterForTests();
  __resetImportGovernanceListenersForTests();
});

afterEach(() => {
  __resetFigmaMcpCallCounterForTests();
  __resetImportGovernanceListenersForTests();
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
  vi.restoreAllMocks();
});

describe("constants", () => {
  it("uses Figma Starter plan budget of 6 per month", () => {
    expect(FIGMA_STARTER_BUDGET).toBe(6);
  });

  it("warns at 80% threshold", () => {
    expect(WARNING_THRESHOLD_PCT).toBe(80);
  });
});

describe("getQuotaSnapshot — initial state", () => {
  it("returns zero usage with thresholdCrossed=false", () => {
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
    expect(snapshot.budget).toBe(FIGMA_STARTER_BUDGET);
    expect(snapshot.usagePct).toBe(0);
    expect(snapshot.thresholdCrossed).toBe(false);
    expect(snapshot.month).toBe(formatMonth(new Date()));
  });

  it("returns a frozen snapshot that cannot be mutated", () => {
    const snapshot = getQuotaSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

describe("recordMcpCall — usage percentages", () => {
  it("counts call #1 as 17%, thresholdCrossed=false", () => {
    recordMcpCall();
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(1);
    expect(snapshot.usagePct).toBe(17);
    expect(snapshot.thresholdCrossed).toBe(false);
  });

  it("counts call #2 as 33%, thresholdCrossed=false", () => {
    for (let i = 0; i < 2; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(2);
    expect(snapshot.usagePct).toBe(33);
    expect(snapshot.thresholdCrossed).toBe(false);
  });

  it("counts call #3 as 50%, thresholdCrossed=false", () => {
    for (let i = 0; i < 3; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.usagePct).toBe(50);
    expect(snapshot.thresholdCrossed).toBe(false);
  });

  it("counts call #4 as 67%, thresholdCrossed=false", () => {
    for (let i = 0; i < 4; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.usagePct).toBe(67);
    expect(snapshot.thresholdCrossed).toBe(false);
  });

  it("counts call #5 as 83%, thresholdCrossed=true (first crossing)", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(5);
    expect(snapshot.usagePct).toBe(83);
    expect(snapshot.thresholdCrossed).toBe(true);
  });

  it("counts call #6 as 100%, thresholdCrossed=true", () => {
    for (let i = 0; i < 6; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(6);
    expect(snapshot.usagePct).toBe(100);
    expect(snapshot.thresholdCrossed).toBe(true);
  });

  it("keeps counting past the budget (100%+ allowed)", () => {
    for (let i = 0; i < 8; i += 1) {
      recordMcpCall();
    }
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(8);
    expect(snapshot.usagePct).toBe(133);
    expect(snapshot.thresholdCrossed).toBe(true);
  });
});

describe("month rollover", () => {
  it("resets the counter when a new month begins", () => {
    const januaryFirst = new Date(Date.UTC(2026, 0, 5));
    const januarySecond = new Date(Date.UTC(2026, 0, 12));
    const februaryDate = new Date(Date.UTC(2026, 1, 3));

    let currentDate: Date = januaryFirst;
    const now = (): Date => currentDate;

    recordMcpCall({ now });
    currentDate = januarySecond;
    recordMcpCall({ now });

    const january = getQuotaSnapshot({ now });
    expect(january.month).toBe("2026-01");
    expect(january.callsThisMonth).toBe(2);

    currentDate = februaryDate;
    const february = getQuotaSnapshot({ now });
    expect(february.month).toBe("2026-02");
    expect(february.callsThisMonth).toBe(0);

    recordMcpCall({ now });
    const updated = getQuotaSnapshot({ now });
    expect(updated.callsThisMonth).toBe(1);
  });
});

describe("localStorage persistence", () => {
  it("persists counter to localStorage and restores on module reset", () => {
    recordMcpCall();
    recordMcpCall();

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    __resetFigmaMcpCallCounterForTests();
    window.localStorage.setItem(STORAGE_KEY, stored ?? "");

    const restored = getQuotaSnapshot();
    expect(restored.callsThisMonth).toBe(2);
  });

  it("discards malformed JSON and starts fresh without throwing", () => {
    __resetFigmaMcpCallCounterForTests();
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
  });

  it("discards payloads with a different storage version", () => {
    __resetFigmaMcpCallCounterForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION + 99,
        month: formatMonth(new Date()),
        callsThisMonth: 4,
        thresholdDispatchedForMonth: null,
      }),
    );

    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
  });

  it("discards version-zero payloads", () => {
    __resetFigmaMcpCallCounterForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 0,
        month: formatMonth(new Date()),
        callsThisMonth: 99,
        thresholdDispatchedForMonth: null,
      }),
    );

    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
  });

  it("swallows setItem quota errors silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => recordMcpCall()).not.toThrow();
  });

  it("swallows getItem errors silently", () => {
    __resetFigmaMcpCallCounterForTests();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => getQuotaSnapshot()).not.toThrow();
    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
  });

  it("ignores non-finite callsThisMonth values in storage", () => {
    __resetFigmaMcpCallCounterForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION,
        month: formatMonth(new Date()),
        callsThisMonth: Number.NaN,
        thresholdDispatchedForMonth: null,
      }),
    );

    const snapshot = getQuotaSnapshot();
    expect(snapshot.callsThisMonth).toBe(0);
  });
});

describe("SSR safety", () => {
  it("returns a safe default snapshot when window is undefined", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — jsdom has window; simulate SSR by deleting it.
    delete globalThis.window;

    try {
      const snapshot = getQuotaSnapshot({
        now: () => new Date(Date.UTC(2026, 3, 5)),
      });
      expect(snapshot.callsThisMonth).toBe(0);
      expect(snapshot.usagePct).toBe(0);
      expect(snapshot.thresholdCrossed).toBe(false);
      expect(snapshot.month).toBe("2026-04");

      expect(() => recordMcpCall()).not.toThrow();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe("isBannerDismissedForMonth / dismissBannerForMonth", () => {
  it("returns false by default", () => {
    expect(isBannerDismissedForMonth("2026-04")).toBe(false);
  });

  it("returns true after dismissBannerForMonth for the same month", () => {
    dismissBannerForMonth("2026-04");
    expect(isBannerDismissedForMonth("2026-04")).toBe(true);
  });

  it("scopes dismissal per-month — month N+1 is not dismissed", () => {
    dismissBannerForMonth("2026-04");
    expect(isBannerDismissedForMonth("2026-04")).toBe(true);
    expect(isBannerDismissedForMonth("2026-05")).toBe(false);
  });

  it("writes the sessionStorage key with the documented prefix", () => {
    dismissBannerForMonth("2026-04");
    expect(window.sessionStorage.getItem(`${DISMISS_KEY_PREFIX}2026-04`)).toBe(
      "1",
    );
  });

  it("returns false when sessionStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isBannerDismissedForMonth("2026-04")).toBe(false);
  });
});

describe("mcp-budget-threshold-crossed governance event", () => {
  it("fires exactly once per session when the threshold first flips", () => {
    const events: ImportGovernanceEvent[] = [];
    subscribeToImportGovernanceEvents((e) => events.push(e));

    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    recordMcpCall();

    const thresholdEvents = events.filter(
      (e) => e.kind === "mcp-budget-threshold-crossed",
    );
    expect(thresholdEvents).toHaveLength(1);
  });

  it("does not fire below the threshold", () => {
    const events: ImportGovernanceEvent[] = [];
    subscribeToImportGovernanceEvents((e) => events.push(e));

    for (let i = 0; i < 4; i += 1) {
      recordMcpCall();
    }

    const thresholdEvents = events.filter(
      (e) => e.kind === "mcp-budget-threshold-crossed",
    );
    expect(thresholdEvents).toHaveLength(0);
  });

  it("carries callsThisMonth, budget, and month on the event", () => {
    const events: ImportGovernanceEvent[] = [];
    subscribeToImportGovernanceEvents((e) => events.push(e));
    const fixedDate = new Date(Date.UTC(2026, 3, 15));
    const now = (): Date => fixedDate;

    for (let i = 0; i < 5; i += 1) {
      recordMcpCall({ now });
    }

    const thresholdEvent = events.find(
      (e) => e.kind === "mcp-budget-threshold-crossed",
    );
    expect(thresholdEvent).toBeDefined();
    if (thresholdEvent?.kind === "mcp-budget-threshold-crossed") {
      expect(thresholdEvent.callsThisMonth).toBe(5);
      expect(thresholdEvent.budget).toBe(FIGMA_STARTER_BUDGET);
      expect(thresholdEvent.month).toBe("2026-04");
    }
  });
});
