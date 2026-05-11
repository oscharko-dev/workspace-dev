import { describe, expect, it } from "vitest";
import { compareAgainstBaseline } from "./perf-runner.mjs";

describe("perf-runner baseline regression checks", () => {
  it("allows tiny browser timing drift on fast LCP baselines", () => {
    const checks = compareAgainstBaseline({
      aggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 40,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      baselineAggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 36,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      tolerancePct: 10,
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "lcp_p75_ms",
          regressionPct: 8,
          pass: true,
        }),
      ]),
    );
  });

  it("still fails material LCP regressions", () => {
    const checks = compareAgainstBaseline({
      aggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 80,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      baselineAggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 36,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      tolerancePct: 10,
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "lcp_p75_ms",
          regressionPct: 88,
          pass: false,
        }),
      ]),
    );
  });

  it("returns missing-baseline-or-metric for all metrics when baselineAggregate is undefined", () => {
    const checks = compareAgainstBaseline({
      aggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 36,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      baselineAggregate: undefined,
      tolerancePct: 10,
    });

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => !check.pass)).toBe(true);
    expect(
      checks.every((check) => check.reason === "missing-baseline-or-metric"),
    ).toBe(true);
  });

  it("returns missing-baseline-or-metric when a metric is absent from aggregate", () => {
    const checks = compareAgainstBaseline({
      aggregate: {},
      baselineAggregate: {
        inp_p75_ms: 0,
        lcp_p75_ms: 36,
        cls_p75: 0,
        initial_js_kb: 58.79,
        route_transition_ms: 0,
      },
      tolerancePct: 10,
    });

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => !check.pass)).toBe(true);
    expect(
      checks.every((check) => check.reason === "missing-baseline-or-metric"),
    ).toBe(true);
  });
});
