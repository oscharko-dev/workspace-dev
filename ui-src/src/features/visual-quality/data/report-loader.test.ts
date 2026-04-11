import { describe, expect, it } from "vitest";
import {
  hotspotsMatchSeverity,
  mergeReport,
  screenKey,
  severityRank,
  toScreenIdToken,
  worstSeverityFor,
  type ScreenArtifacts,
} from "./report-loader";
import {
  type Hotspot,
  type LastRunAggregate,
  type ScreenReport,
} from "./types";

function hotspot(overrides: Partial<Hotspot>): Hotspot {
  return {
    region: "header",
    severity: "low",
    category: "spacing",
    deviationPercent: 0.5,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  };
}

function report(overrides: Partial<ScreenReport>): ScreenReport {
  return {
    status: "completed",
    overallScore: 99,
    dimensions: [],
    hotspots: [],
    ...overrides,
  };
}

const aggregate: LastRunAggregate = {
  version: 2,
  ranAt: "2026-04-11T18:00:40.698Z",
  overallScore: 98.5,
  scores: [
    {
      fixtureId: "alpha",
      score: 99,
      screenId: "1:1",
      screenName: "Alpha Home",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
    {
      fixtureId: "alpha",
      score: 97,
      screenId: "1:1",
      screenName: "Alpha Home",
      viewportId: "mobile",
      viewportLabel: "Mobile",
    },
    {
      fixtureId: "bravo",
      score: 95,
      screenId: "2:2",
      screenName: "Bravo Page",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
  ],
};

describe("screenKey", () => {
  it("replaces colons in the screen id with underscores", () => {
    expect(screenKey("alpha", "1:1", "desktop")).toBe("alpha/1_1/desktop");
  });

  it("escapes underscores before replacing colons", () => {
    expect(toScreenIdToken("home_view:1")).toBe("home~uview_1");
    expect(screenKey("alpha", "home_view:1", "desktop")).toBe(
      "alpha/home~uview_1/desktop",
    );
  });

  it("falls back to fixtureId/default when screen id is missing", () => {
    expect(screenKey("alpha", undefined, undefined)).toBe(
      "alpha/alpha/default",
    );
  });
});

describe("worstSeverityFor / severityRank", () => {
  it("returns null when there is no report or no hotspots", () => {
    expect(worstSeverityFor(null)).toBeNull();
    expect(worstSeverityFor(report({ hotspots: [] }))).toBeNull();
  });

  it("returns the worst of several severities", () => {
    expect(
      worstSeverityFor(
        report({
          hotspots: [
            hotspot({ severity: "low" }),
            hotspot({ severity: "high" }),
            hotspot({ severity: "medium" }),
          ],
        }),
      ),
    ).toBe("high");

    expect(
      worstSeverityFor(
        report({
          hotspots: [
            hotspot({ severity: "critical" }),
            hotspot({ severity: "low" }),
          ],
        }),
      ),
    ).toBe("critical");
  });

  it("ranks severities in ascending order of impact", () => {
    expect(severityRank(null)).toBe(0);
    expect(severityRank("low")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("critical"));
  });
});

describe("hotspotsMatchSeverity", () => {
  it("returns true when the selected filter is empty", () => {
    expect(hotspotsMatchSeverity([hotspot({ severity: "low" })], [])).toBe(
      true,
    );
  });

  it("returns true when any hotspot matches the filter", () => {
    const hotspots = [
      hotspot({ severity: "low" }),
      hotspot({ severity: "high" }),
    ];
    expect(hotspotsMatchSeverity(hotspots, ["high"])).toBe(true);
    expect(hotspotsMatchSeverity(hotspots, ["critical", "high"])).toBe(true);
  });

  it("returns false when no hotspot matches", () => {
    expect(
      hotspotsMatchSeverity([hotspot({ severity: "low" })], ["critical"]),
    ).toBe(false);
    expect(hotspotsMatchSeverity([], ["low"])).toBe(false);
  });
});

describe("mergeReport", () => {
  it("groups merged screens by fixture and computes averages", () => {
    const artifacts: Record<string, ScreenArtifacts> = {
      "alpha/1_1/desktop": {
        report: report({
          overallScore: 99,
          hotspots: [hotspot({ severity: "low" })],
        }),
        diffUrl: "blob:diff-a",
      },
    };
    const merged = mergeReport(aggregate, artifacts, null);

    expect(merged.fixtures).toHaveLength(2);
    const alpha = merged.fixtures.find((f) => f.fixtureId === "alpha");
    const bravo = merged.fixtures.find((f) => f.fixtureId === "bravo");
    expect(alpha?.screens).toHaveLength(2);
    expect(bravo?.screens).toHaveLength(1);
    expect(alpha?.averageScore).toBeCloseTo(98, 5);
    expect(bravo?.averageScore).toBeCloseTo(95, 5);
    expect(merged.screensByKey["alpha/1_1/desktop"]?.diffUrl).toBe(
      "blob:diff-a",
    );
    expect(merged.screensByKey["alpha/1_1/mobile"]?.diffUrl).toBeNull();
    expect(merged.hasImages).toBe(true);
  });

  it("marks hasImages as false when no artifacts have image URLs", () => {
    const merged = mergeReport(aggregate, {}, null);
    expect(merged.hasImages).toBe(false);
  });

  it("uses the worst hotspot severity for each merged screen", () => {
    const artifacts: Record<string, ScreenArtifacts> = {
      "bravo/2_2/desktop": {
        report: report({
          hotspots: [
            hotspot({ severity: "medium" }),
            hotspot({ severity: "critical" }),
          ],
        }),
      },
    };
    const merged = mergeReport(aggregate, artifacts, null);
    expect(merged.screensByKey["bravo/2_2/desktop"]?.worstSeverity).toBe(
      "critical",
    );
  });

  it("fills default viewport/screen labels when score entries lack them", () => {
    const minimal: LastRunAggregate = {
      version: 2,
      ranAt: "2026-04-11T00:00:00Z",
      overallScore: 99,
      scores: [{ fixtureId: "alpha", score: 99 }],
    };
    const merged = mergeReport(minimal, {}, null);
    const screen = merged.fixtures[0]?.screens[0];
    expect(screen?.viewportId).toBe("default");
    expect(screen?.viewportLabel).toBe("default");
    expect(screen?.screenId).toBe("alpha");
  });
});
