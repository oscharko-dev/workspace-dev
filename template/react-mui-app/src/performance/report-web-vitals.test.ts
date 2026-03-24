import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onCLS = vi.fn();
const onFCP = vi.fn();
const onINP = vi.fn();
const onLCP = vi.fn();
const onTTFB = vi.fn();

vi.mock("web-vitals", () => {
  return {
    onCLS,
    onFCP,
    onINP,
    onLCP,
    onTTFB
  };
});

const createMetric = (name: string) => {
  return {
    delta: 12,
    id: `${name}-metric`,
    name,
    navigationType: "navigate",
    rating: "good",
    value: 120
  };
};

describe("report-web-vitals", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    onCLS.mockReset();
    onFCP.mockReset();
    onINP.mockReset();
    onLCP.mockReset();
    onTTFB.mockReset();
    onCLS.mockImplementation((callback) => callback(createMetric("CLS")));
    onFCP.mockImplementation((callback) => callback(createMetric("FCP")));
    onINP.mockImplementation((callback) => callback(createMetric("INP")));
    onLCP.mockImplementation((callback) => callback(createMetric("LCP")));
    onTTFB.mockImplementation((callback) => callback(createMetric("TTFB")));
    window.location.hash = "#/overview";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("samples once per page load and logs vitals to the console when no endpoint exists", async () => {
    vi.stubEnv("VITE_PERF_SAMPLE_RATE", "0.5");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.2);
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const module = await import("./report-web-vitals");
    module.resetWebVitalsReportingForTests();

    module.startWebVitalsReporting();
    randomSpy.mockReturnValue(0.95);
    module.startWebVitalsReporting();

    expect(onCLS).toHaveBeenCalledTimes(1);
    expect(onFCP).toHaveBeenCalledTimes(1);
    expect(onINP).toHaveBeenCalledTimes(1);
    expect(onLCP).toHaveBeenCalledTimes(1);
    expect(onTTFB).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledTimes(5);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[web-vitals]",
      expect.objectContaining({
        href: expect.stringContaining("#/overview"),
        route: "/overview"
      })
    );
  });

  it("uses sendBeacon with a JSON blob when an endpoint is configured", async () => {
    vi.stubEnv("VITE_PERF_ENDPOINT", "https://metrics.example.com/vitals");
    vi.stubEnv("VITE_PERF_SAMPLE_RATE", "1");
    const sendBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon
    });
    const fetchSpy = vi.spyOn(window, "fetch");

    const module = await import("./report-web-vitals");
    module.resetWebVitalsReportingForTests();
    module.startWebVitalsReporting();

    const firstCall = sendBeacon.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(sendBeacon).toHaveBeenCalled();
    expect(firstCall?.[0]).toBe("https://metrics.example.com/vitals");
    expect(firstCall?.[1]).toBeInstanceOf(Blob);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to fetch when sendBeacon declines the payload", async () => {
    vi.stubEnv("VITE_PERF_ENDPOINT", "https://metrics.example.com/vitals");
    vi.stubEnv("VITE_PERF_SAMPLE_RATE", "1");
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false)
    });
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const module = await import("./report-web-vitals");
    module.resetWebVitalsReportingForTests();
    module.startWebVitalsReporting();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://metrics.example.com/vitals",
      expect.objectContaining({
        body: expect.any(String),
        headers: {
          "content-type": "application/json"
        },
        keepalive: true,
        method: "POST"
      })
    );
  });
});
