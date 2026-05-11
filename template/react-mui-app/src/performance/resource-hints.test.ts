import { beforeEach, describe, expect, it, vi } from "vitest";

const preconnect = vi.fn();
const prefetchDNS = vi.fn();

vi.mock("react-dom", () => {
  return {
    preconnect,
    prefetchDNS
  };
});

describe("resource hints", () => {
  beforeEach(() => {
    preconnect.mockReset();
    prefetchDNS.mockReset();
    vi.resetModules();
    vi.unstubAllEnvs();
    window.location.hash = "#/";
  });

  it("skips hints when no performance endpoint is configured", async () => {
    const module = await import("./resource-hints");
    module.applyRuntimeResourceHints();

    expect(prefetchDNS).not.toHaveBeenCalled();
    expect(preconnect).not.toHaveBeenCalled();
  });

  it("skips hints for same-origin endpoints", async () => {
    vi.stubEnv("VITE_PERF_ENDPOINT", `${window.location.origin}/api/vitals`);

    const module = await import("./resource-hints");
    module.applyRuntimeResourceHints();

    expect(prefetchDNS).not.toHaveBeenCalled();
    expect(preconnect).not.toHaveBeenCalled();
  });

  it("adds cross-origin DNS and preconnect hints for the telemetry origin", async () => {
    vi.stubEnv("VITE_PERF_ENDPOINT", "https://metrics.example.com/vitals");

    const module = await import("./resource-hints");
    module.applyRuntimeResourceHints();

    expect(prefetchDNS).toHaveBeenCalledWith("https://metrics.example.com");
    expect(preconnect).toHaveBeenCalledWith("https://metrics.example.com", { crossOrigin: "" });
  });
});
