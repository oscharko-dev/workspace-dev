import { describe, expect, it } from "vitest";
import {
  parseJobConfidence,
  parseJobConfidenceEnvelope,
  parseHistory,
  parseLastRun,
  parseScreenReport,
  parseStandaloneVisualQualityReport,
  parseVisualParityReport,
} from "./report-schema";

describe("parseLastRun", () => {
  it("parses a representative last-run.json aggregate", () => {
    const parsed = parseLastRun({
      version: 2,
      ranAt: "2026-04-11T12:00:00.000Z",
      overallScore: 97.3,
      scores: [
        { fixtureId: "simple-form", score: 98.1 },
        { fixtureId: "navigation-sidebar", score: 96.5 },
      ],
      failedFixtures: [],
    });
    expect(parsed.version).toBe(2);
    expect(parsed.scores.length).toBeGreaterThan(0);
    expect(parsed.overallScore).toBeGreaterThan(0);
    expect(parsed.ranAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects input missing required fields", () => {
    expect(() => parseLastRun({})).toThrow(/Invalid last-run/);
    expect(() => parseLastRun({ version: 2, ranAt: "x" })).toThrow(
      /Invalid last-run/,
    );
  });

  it("rejects wrong version number", () => {
    expect(() =>
      parseLastRun({
        version: 1,
        ranAt: "2026-04-11T00:00:00Z",
        overallScore: 99,
        scores: [],
      }),
    ).toThrow(/Invalid last-run/);
  });

  it("derives overallScore from score entries when legacy aggregates omit it", () => {
    const parsed = parseLastRun({
      version: 2,
      ranAt: "2026-04-11T00:00:00Z",
      scores: [
        { fixtureId: "a", score: 80 },
        { fixtureId: "b", score: 100 },
      ],
    });
    expect(parsed.overallScore).toBe(90);
  });

  it("rejects missing overallScore when scores are empty", () => {
    expect(() =>
      parseLastRun({
        version: 2,
        ranAt: "2026-04-11T00:00:00Z",
        scores: [],
      }),
    ).toThrow(/overallScore is missing/);
  });
});

describe("parseScreenReport", () => {
  it("parses a representative per-screen report payload", () => {
    const parsed = parseScreenReport({
      status: "completed",
      overallScore: 98.2,
      dimensions: [
        { name: "layoutAccuracy", weight: 0.35, score: 99 },
        { name: "spacingAlignment", weight: 0.15, score: 97.4 },
      ],
      hotspots: [
        {
          region: "top-right",
          x: 24,
          y: 16,
          width: 120,
          height: 64,
          severity: "low",
          category: "anti-aliasing",
          deviationPercent: 0.7,
        },
      ],
      metadata: {
        imageWidth: 1280,
        imageHeight: 800,
      },
    });
    expect(parsed.status).toBe("completed");
    expect(parsed.dimensions.length).toBeGreaterThan(0);
    expect(parsed.hotspots.length).toBeGreaterThanOrEqual(0);
    expect(parsed.metadata?.imageWidth).toBeTypeOf("number");
  });

  it("defaults hotspots to an empty array when omitted", () => {
    const parsed = parseScreenReport({
      status: "completed",
      overallScore: 99,
      dimensions: [],
    });
    expect(parsed.hotspots).toEqual([]);
  });

  it("rejects a malformed report", () => {
    expect(() => parseScreenReport({ status: "bogus" })).toThrow(
      /Invalid screen report/,
    );
  });
});

describe("parseHistory", () => {
  it("parses a v2 history with per-score entries", () => {
    const parsed = parseHistory({
      version: 2,
      entries: [
        {
          runAt: "2026-04-10T00:00:00Z",
          overallScore: 98.2,
          scores: [{ fixtureId: "x", score: 99 }],
        },
      ],
    });
    expect(parsed.version).toBe(2);
    expect(parsed.entries[0]?.scores).toHaveLength(1);
    expect(parsed.entries[0]?.overallScore).toBe(98.2);
  });

  it("normalizes a v1 history (no per-score entries) into an empty scores array", () => {
    const parsed = parseHistory({
      version: 1,
      entries: [{ runAt: "2026-04-10T00:00:00Z", overallScore: 97 }],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.entries[0]?.scores).toEqual([]);
    expect(parsed.entries[0]?.overallScore).toBe(97);
  });

  it("tolerates v2 entries with no overallScore", () => {
    const parsed = parseHistory({
      version: 2,
      entries: [{ runAt: "2026-04-10T00:00:00Z", scores: [] }],
    });
    expect(parsed.entries[0]?.overallScore).toBeUndefined();
  });

  it("rejects unsupported versions", () => {
    expect(() => parseHistory({ version: 7, entries: [] })).toThrow(
      /Invalid history/,
    );
  });
});

describe("parseStandaloneVisualQualityReport", () => {
  it("parses a completed top-level visual-quality report", () => {
    const parsed = parseStandaloneVisualQualityReport({
      status: "completed",
      referenceSource: "frozen_fixture",
      capturedAt: "2026-04-10T00:00:00.000Z",
      overallScore: 98.4,
      interpretation: "Excellent parity",
      dimensions: [],
      hotspots: [],
      metadata: {
        imageWidth: 1280,
        imageHeight: 800,
      },
      warnings: ["sample warning"],
    });

    expect(parsed.status).toBe("completed");
    expect(parsed.overallScore).toBe(98.4);
    expect(parsed.referenceSource).toBe("frozen_fixture");
    expect(parsed.warnings).toEqual(["sample warning"]);
  });

  it("rejects malformed standalone reports", () => {
    expect(() =>
      parseStandaloneVisualQualityReport({
        status: "bogus",
      }),
    ).toThrow(/Invalid visual-quality report/);
  });
});

describe("parseVisualParityReport", () => {
  it("parses a visual-parity-report.json payload", () => {
    const parsed = parseVisualParityReport({
      status: "warn",
      mode: "strict",
      baselinePath: "/tmp/baseline.png",
      runtimePreviewUrl: "http://127.0.0.1:19835/workspace/repros/job-1/",
      maxDiffPixelRatio: 0.2,
      details: "Visual difference exceeded threshold.",
    });

    expect(parsed.status).toBe("warn");
    expect(parsed.mode).toBe("strict");
    expect(parsed.maxDiffPixelRatio).toBe(0.2);
  });

  it("rejects malformed parity summaries", () => {
    expect(() =>
      parseVisualParityReport({
        status: "bad",
      }),
    ).toThrow(/Invalid visual-parity-report/);
  });
});

describe("confidence parsing", () => {
  it("parses a standalone job confidence payload", () => {
    const parsed = parseJobConfidence({
      status: "completed",
      level: "medium",
      score: 74.5,
      contributors: [
        {
          signal: "diagnostic_severity",
          impact: "negative",
          weight: 0.2,
          value: 0.4,
          detail: "2 warnings",
        },
      ],
      screens: [
        {
          screenId: "1:1",
          screenName: "Dashboard",
          level: "low",
          score: 66.7,
          contributors: [],
          components: [],
        },
      ],
      lowConfidenceSummary: ["Dashboard confidence dropped because of warnings"],
    });

    expect(parsed.status).toBe("completed");
    expect(parsed.level).toBe("medium");
    expect(parsed.screens?.[0]?.screenId).toBe("1:1");
  });

  it("parses confidence from a job status/result envelope", () => {
    const parsed = parseJobConfidenceEnvelope({
      jobId: "job-123",
      status: "completed",
      confidence: {
        status: "completed",
        level: "high",
        score: 98,
      },
    });
    expect(parsed?.status).toBe("completed");
    expect(parsed?.level).toBe("high");
  });

  it("returns null when confidence is not present", () => {
    expect(parseJobConfidenceEnvelope({ jobId: "job-123" })).toBeNull();
  });
});
