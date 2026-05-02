import { describe, expect, it } from "vitest";

import {
  FINOPS_AMBER_THRESHOLD,
  FINOPS_RED_THRESHOLD,
  classifyUsageBand,
  formatTokens,
} from "./finops-cost-card-model";

describe("classifyUsageBand", () => {
  it("returns green for ratios at or below 60%", () => {
    expect(classifyUsageBand(0)).toBe("green");
    expect(classifyUsageBand(0.3)).toBe("green");
    expect(classifyUsageBand(FINOPS_AMBER_THRESHOLD)).toBe("green");
  });

  it("returns amber strictly above 60% and at-or-below 85%", () => {
    expect(classifyUsageBand(0.61)).toBe("amber");
    expect(classifyUsageBand(0.75)).toBe("amber");
    expect(classifyUsageBand(FINOPS_RED_THRESHOLD)).toBe("amber");
  });

  it("returns red strictly above 85%", () => {
    expect(classifyUsageBand(0.86)).toBe("red");
    expect(classifyUsageBand(1)).toBe("red");
  });

  it("clamps inputs outside [0, 1]", () => {
    expect(classifyUsageBand(-0.5)).toBe("green");
    expect(classifyUsageBand(2)).toBe("red");
  });

  it("treats non-finite ratios as green (0)", () => {
    expect(classifyUsageBand(Number.NaN)).toBe("green");
    expect(classifyUsageBand(Infinity)).toBe("green");
  });
});

describe("formatTokens", () => {
  it("formats positive integers with thousands separators", () => {
    expect(formatTokens(1234)).toBe("1,234");
    expect(formatTokens(1_000_000)).toBe("1,000,000");
  });

  it("rounds to the nearest integer", () => {
    expect(formatTokens(123.4)).toBe("123");
    expect(formatTokens(123.6)).toBe("124");
  });

  it("returns '0' for negative or non-finite values", () => {
    expect(formatTokens(-1)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(Infinity)).toBe("0");
  });
});
