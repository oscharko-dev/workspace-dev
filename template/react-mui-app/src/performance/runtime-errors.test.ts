import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRootErrorHandlers, resetRuntimeErrorReportingForTests } from "./runtime-errors";

describe("runtime-errors", () => {
  beforeEach(() => {
    window.location.hash = "#/checkout";
    resetRuntimeErrorReportingForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("deduplicates repeated caught errors and preserves raw error details in development", () => {
    vi.stubEnv("DEV", true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("caught render failure");
    const handlers = createRootErrorHandlers();

    handlers.onCaughtError(error, { componentStack: "\n    at RouteShell" });
    handlers.onCaughtError(error, { componentStack: "\n    at RouteShell" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[runtime-error]",
      expect.objectContaining({
        componentStack: "\n    at RouteShell",
        href: expect.stringContaining("#/checkout"),
        message: "caught render failure",
        source: "caught"
      }),
      error
    );
  });

  it("silences all console output in production mode", () => {
    vi.stubEnv("DEV", false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("caught render failure");
    const handlers = createRootErrorHandlers();

    handlers.onCaughtError(error, { componentStack: "\n    at RouteShell" });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("reports uncaught non-Error values once", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createRootErrorHandlers();

    handlers.onUncaughtError("fatal string", { componentStack: "\n    at TemplateRoot" });
    handlers.onUncaughtError("fatal string", { componentStack: "\n    at TemplateRoot" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[runtime-error]",
      expect.objectContaining({
        message: "fatal string",
        name: "UnknownRuntimeError",
        source: "uncaught"
      })
    );
  });
});
