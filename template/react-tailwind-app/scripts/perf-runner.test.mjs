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
});
