// ---------------------------------------------------------------------------
// Storage helper unit tests (Issue #1367 follow-up)
//
// The Inspector page persists the reviewer handle to localStorage and the
// bearer token to sessionStorage. Both helpers swallow Storage errors so
// the UI keeps working when storage is unavailable (private browsing, ITP,
// disabled cookies). This test pins the swallow behavior so a future
// refactor cannot regress into throwing during render.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeReadStorage,
  safeWriteStorage,
} from "./inspector/test-intelligence/safe-storage";

const KEY = "ti-storage-test-key";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("safeReadStorage / safeWriteStorage — happy path", () => {
  it("round-trips a value through localStorage by default", () => {
    safeWriteStorage(KEY, "alice");
    expect(safeReadStorage(KEY)).toBe("alice");
  });

  it("round-trips a value through sessionStorage when scope is 'session'", () => {
    safeWriteStorage(KEY, "secret-token", "session");
    expect(safeReadStorage(KEY, "session")).toBe("secret-token");
    expect(safeReadStorage(KEY, "local")).toBe("");
  });

  it("clears the stored value when the empty string is written", () => {
    safeWriteStorage(KEY, "alice");
    safeWriteStorage(KEY, "");
    expect(safeReadStorage(KEY)).toBe("");
  });
});

describe("safeReadStorage — failure swallow", () => {
  it("returns the empty string when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(safeReadStorage(KEY)).toBe("");
  });

  it("returns the empty string when sessionStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sessionStorage disabled");
    });
    expect(safeReadStorage(KEY, "session")).toBe("");
  });
});

describe("safeWriteStorage — failure swallow", () => {
  it("does not throw when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => {
      safeWriteStorage(KEY, "value");
    }).not.toThrow();
  });

  it("does not throw when localStorage.removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage locked");
    });
    expect(() => {
      safeWriteStorage(KEY, "");
    }).not.toThrow();
  });

  it("does not throw when sessionStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("session storage disabled");
    });
    expect(() => {
      safeWriteStorage(KEY, "value", "session");
    }).not.toThrow();
  });
});
