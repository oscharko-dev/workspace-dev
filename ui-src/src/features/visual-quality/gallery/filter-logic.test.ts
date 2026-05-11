import { describe, expect, it } from "vitest";
import {
  applyFilters,
  buildPreviousScoreMap,
  DEFAULT_FILTER_STATE,
  deltaFor,
  filterStateFromSearchParams,
  filterStateToSearchParams,
  type FilterState,
  type PreviousScoreMap,
} from "./filter-logic";
import {
  type Hotspot,
  type HotspotSeverity,
  type MergedScreen,
  type ScreenReport,
} from "../data/types";

function hotspot(severity: HotspotSeverity): Hotspot {
  return {
    region: "content",
    severity,
    category: "layout",
    deviationPercent: 1,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };
}

function report(hotspots: Hotspot[]): ScreenReport {
  return { status: "completed", overallScore: 99, dimensions: [], hotspots };
}

function screen(overrides: Partial<MergedScreen>): MergedScreen {
  return {
    key: "alpha/1_1/desktop",
    fixtureId: "alpha",
    screenId: "1:1",
    screenName: "Alpha Home",
    viewportId: "desktop",
    viewportLabel: "Desktop",
    score: 99,
    report: null,
    referenceUrl: null,
    actualUrl: null,
    diffUrl: null,
    worstSeverity: null,
    ...overrides,
  };
}

const screens: MergedScreen[] = [
  screen({
    key: "alpha/1_1/desktop",
    fixtureId: "alpha",
    screenName: "Alpha Home",
    score: 99,
    report: report([hotspot("low")]),
    worstSeverity: "low",
  }),
  screen({
    key: "alpha/1_1/mobile",
    fixtureId: "alpha",
    screenName: "Alpha Home",
    viewportId: "mobile",
    viewportLabel: "Mobile",
    score: 92,
    report: report([hotspot("medium")]),
    worstSeverity: "medium",
  }),
  screen({
    key: "bravo/2_2/desktop",
    fixtureId: "bravo",
    screenName: "Bravo Page",
    screenId: "2:2",
    score: 88,
    report: report([hotspot("critical")]),
    worstSeverity: "critical",
  }),
  screen({
    key: "charlie/3_3/desktop",
    fixtureId: "charlie",
    screenId: "3:3",
    screenName: "Charlie Landing",
    score: 97,
    report: report([]),
    worstSeverity: null,
  }),
];

describe("applyFilters", () => {
  it("returns all screens (sorted by score desc) for the default state", () => {
    const result = applyFilters(screens, DEFAULT_FILTER_STATE);
    expect(result.map((s) => s.key)).toEqual([
      "alpha/1_1/desktop",
      "charlie/3_3/desktop",
      "alpha/1_1/mobile",
      "bravo/2_2/desktop",
    ]);
  });

  it("text query matches fixture id and screen name (case-insensitive)", () => {
    const byFixture = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      query: "ALPHA",
    });
    expect(byFixture.map((s) => s.fixtureId)).toEqual(["alpha", "alpha"]);

    const byScreen = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      query: "bravo",
    });
    expect(byScreen.map((s) => s.key)).toEqual(["bravo/2_2/desktop"]);

    const noMatch = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      query: "zebra",
    });
    expect(noMatch).toHaveLength(0);
  });

  it("filters by multi-select fixture list", () => {
    const result = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      fixtures: ["alpha", "charlie"],
    });
    expect(result.map((s) => s.fixtureId).sort()).toEqual([
      "alpha",
      "alpha",
      "charlie",
    ]);
  });

  it("filters by minimum score", () => {
    const result = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      minScore: 95,
    });
    expect(result.every((s) => s.score >= 95)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("filters by severity union", () => {
    const crit = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      severities: ["critical"],
    });
    expect(crit.map((s) => s.key)).toEqual(["bravo/2_2/desktop"]);

    const lowMed = applyFilters(screens, {
      ...DEFAULT_FILTER_STATE,
      severities: ["low", "medium"],
    });
    expect(lowMed.map((s) => s.key).sort()).toEqual([
      "alpha/1_1/desktop",
      "alpha/1_1/mobile",
    ]);
  });

  it.each([
    [
      "score-asc",
      [
        "bravo/2_2/desktop",
        "alpha/1_1/mobile",
        "charlie/3_3/desktop",
        "alpha/1_1/desktop",
      ],
    ],
    [
      "score-desc",
      [
        "alpha/1_1/desktop",
        "charlie/3_3/desktop",
        "alpha/1_1/mobile",
        "bravo/2_2/desktop",
      ],
    ],
    [
      "fixture-asc",
      [
        "alpha/1_1/desktop",
        "alpha/1_1/mobile",
        "bravo/2_2/desktop",
        "charlie/3_3/desktop",
      ],
    ],
    [
      "fixture-desc",
      [
        "charlie/3_3/desktop",
        "bravo/2_2/desktop",
        "alpha/1_1/desktop",
        "alpha/1_1/mobile",
      ],
    ],
    [
      "screen-asc",
      [
        "alpha/1_1/desktop",
        "alpha/1_1/mobile",
        "bravo/2_2/desktop",
        "charlie/3_3/desktop",
      ],
    ],
    [
      "screen-desc",
      [
        "charlie/3_3/desktop",
        "bravo/2_2/desktop",
        "alpha/1_1/desktop",
        "alpha/1_1/mobile",
      ],
    ],
    [
      "severity-desc",
      [
        "bravo/2_2/desktop",
        "alpha/1_1/mobile",
        "alpha/1_1/desktop",
        "charlie/3_3/desktop",
      ],
    ],
  ] as const)("sorts by %s", (sort, expected) => {
    const result = applyFilters(screens, { ...DEFAULT_FILTER_STATE, sort });
    expect(result.map((s) => s.key)).toEqual(expected);
  });

  it("sorts by delta-desc (worst regression first)", () => {
    const previous: PreviousScoreMap = {
      "alpha/1_1/desktop": 99,
      "alpha/1_1/mobile": 99,
      "bravo/2_2/desktop": 90,
      "charlie/3_3/desktop": 97,
    };
    const result = applyFilters(
      screens,
      { ...DEFAULT_FILTER_STATE, sort: "delta-desc" },
      previous,
    );
    // alpha/1_1/mobile is the worst regression (92 - 99 = -7)
    expect(result[0]?.key).toBe("alpha/1_1/mobile");
  });
});

describe("deltaFor", () => {
  it("returns +Infinity when no previous score exists (sorts last)", () => {
    const result = deltaFor(
      screen({ key: "alpha/1_1/desktop", score: 99 }),
      {},
    );
    expect(result).toBe(Number.POSITIVE_INFINITY);
  });

  it("computes current - previous", () => {
    const result = deltaFor(screen({ key: "alpha/1_1/desktop", score: 90 }), {
      "alpha/1_1/desktop": 99,
    });
    expect(result).toBe(-9);
  });
});

describe("filterStateToSearchParams / filterStateFromSearchParams", () => {
  it("round-trips a non-default state", () => {
    const state: FilterState = {
      query: "dashboard",
      fixtures: ["alpha", "bravo"],
      minScore: 95,
      severities: ["high", "critical"],
      sort: "score-asc",
    };
    const params = filterStateToSearchParams(state);
    expect(params.get("q")).toBe("dashboard");
    expect(params.get("fixture")).toBe("alpha,bravo");
    expect(params.get("minScore")).toBe("95");
    expect(params.get("severity")).toBe("high,critical");
    expect(params.get("sort")).toBe("score-asc");

    const parsed = filterStateFromSearchParams(params);
    expect(parsed).toEqual(state);
  });

  it("omits default fields from the serialized params", () => {
    const params = filterStateToSearchParams(DEFAULT_FILTER_STATE);
    expect(params.toString()).toBe("");
  });

  it("falls back to defaults for missing or invalid fields", () => {
    const parsed = filterStateFromSearchParams(
      new URLSearchParams("minScore=abc&sort=bogus&severity=nope"),
    );
    expect(parsed.minScore).toBe(0);
    expect(parsed.sort).toBe(DEFAULT_FILTER_STATE.sort);
    expect(parsed.severities).toEqual([]);
  });

  it("clamps minScore to 0..100", () => {
    expect(
      filterStateFromSearchParams(new URLSearchParams("minScore=-50")).minScore,
    ).toBe(0);
    expect(
      filterStateFromSearchParams(new URLSearchParams("minScore=150")).minScore,
    ).toBe(100);
  });
});

describe("buildPreviousScoreMap", () => {
  const entries = [
    {
      runAt: "2026-04-08T00:00:00Z",
      scores: [
        {
          fixtureId: "alpha",
          score: 97,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "alpha",
          score: 96,
          screenId: "1:1",
          viewportId: "mobile",
        },
      ],
    },
    {
      runAt: "2026-04-10T00:00:00Z",
      scores: [
        {
          fixtureId: "alpha",
          score: 98,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "alpha",
          score: 97.5,
          screenId: "1:1",
          viewportId: "mobile",
        },
      ],
    },
    {
      runAt: "2026-04-11T00:00:00Z",
      scores: [
        {
          fixtureId: "alpha",
          score: 99,
          screenId: "1:1",
          viewportId: "desktop",
        },
      ],
    },
  ];

  it("picks scores from the most recent run before the current one", () => {
    const map = buildPreviousScoreMap(entries, "2026-04-11T00:00:00Z");
    expect(map["alpha/1_1/desktop"]).toBe(98);
    expect(map["alpha/1_1/mobile"]).toBe(97.5);
  });

  it("returns an empty map when there is no earlier run", () => {
    const map = buildPreviousScoreMap(entries, "2026-04-01T00:00:00Z");
    expect(map).toEqual({});
  });
});
