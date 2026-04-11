import { mergeReport } from "./report-loader";
import {
  type HistoryRuns,
  type LastRunAggregate,
  type MergedReport,
  type ScreenReport,
} from "./types";
import { type ScreenArtifacts } from "./report-loader";

/**
 * Minimal 1x1 PNG data URLs used by the sample report so the UI has something
 * to render offline without any network / filesystem access. Two tints give
 * the side-by-side and onion-skin overlays visible contrast.
 */
const REFERENCE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";
const ACTUAL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DIFF_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNg+M/wHwAEAgH/QkYdVQAAAABJRU5ErkJggg==";

const sampleAggregate: LastRunAggregate = {
  version: 2,
  ranAt: "2026-04-11T18:00:40.698Z",
  overallScore: 98.4,
  overallBaseline: 96.2,
  overallCurrent: 98.4,
  overallDelta: 2.2,
  screenAggregateScore: 98.4,
  browserBreakdown: {
    chromium: 98.7,
    firefox: 98.2,
    webkit: 98.3,
  },
  scores: [
    {
      fixtureId: "sample-dashboard",
      score: 99.1,
      screenId: "1:1",
      screenName: "Dashboard — Sample",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
    {
      fixtureId: "sample-dashboard",
      score: 98.4,
      screenId: "1:1",
      screenName: "Dashboard — Sample",
      viewportId: "mobile",
      viewportLabel: "Mobile",
    },
    {
      fixtureId: "sample-form",
      score: 96.8,
      screenId: "1:2",
      screenName: "Form — Sample",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
  ],
  warnings: [],
};

function makeReport(score: number, severity: "low" | "medium"): ScreenReport {
  return {
    status: "completed",
    overallScore: score,
    interpretation:
      severity === "low"
        ? "Excellent parity — minor sub-pixel differences"
        : "Moderate parity — layout deviations in content region",
    referenceSource: "sample_inline",
    capturedAt: "2026-04-11T18:00:00.000Z",
    dimensions: [
      {
        name: "Layout Accuracy",
        weight: 0.3,
        score: score - 0.2,
        details: "Sample region",
      },
      {
        name: "Color Fidelity",
        weight: 0.25,
        score: score - 0.1,
        details: "Sample pixel similarity",
      },
      {
        name: "Typography",
        weight: 0.2,
        score: score + 0.1,
        details: "Sample content",
      },
      {
        name: "Component Structure",
        weight: 0.15,
        score: score - 0.3,
        details: "Sample consistency",
      },
      {
        name: "Spacing & Alignment",
        weight: 0.1,
        score: score,
        details: "Sample spacing",
      },
    ],
    hotspots: [
      {
        region: severity === "low" ? "header" : "content-left",
        severity,
        category: severity === "low" ? "spacing" : "layout",
        deviationPercent: severity === "low" ? 0.5 : 4.2,
        x: 0,
        y: severity === "low" ? 0 : 160,
        width: 1280,
        height: severity === "low" ? 120 : 320,
        rank: 1,
      },
    ],
    metadata: {
      imageWidth: 1280,
      imageHeight: 800,
      diffPixelCount: severity === "low" ? 512 : 4096,
      totalPixels: 1024000,
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    },
    browserBreakdown: { chromium: score, firefox: score, webkit: score - 0.1 },
  };
}

const sampleArtifacts: Record<string, ScreenArtifacts> = {
  "sample-dashboard/1_1/desktop": {
    report: makeReport(99.1, "low"),
    referenceUrl: REFERENCE_PNG,
    actualUrl: ACTUAL_PNG,
    diffUrl: DIFF_PNG,
  },
  "sample-dashboard/1_1/mobile": {
    report: makeReport(98.4, "low"),
    referenceUrl: REFERENCE_PNG,
    actualUrl: ACTUAL_PNG,
    diffUrl: DIFF_PNG,
  },
  "sample-form/1_2/desktop": {
    report: makeReport(96.8, "medium"),
    referenceUrl: REFERENCE_PNG,
    actualUrl: ACTUAL_PNG,
    diffUrl: DIFF_PNG,
  },
};

const sampleHistory: HistoryRuns = {
  version: 2,
  entries: [
    {
      runAt: "2026-04-08T12:00:00.000Z",
      overallScore: 96.2,
      scores: [
        {
          fixtureId: "sample-dashboard",
          score: 97.4,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "sample-dashboard",
          score: 96.0,
          screenId: "1:1",
          viewportId: "mobile",
        },
        {
          fixtureId: "sample-form",
          score: 95.1,
          screenId: "1:2",
          viewportId: "desktop",
        },
      ],
    },
    {
      runAt: "2026-04-09T12:00:00.000Z",
      overallScore: 97.0,
      scores: [
        {
          fixtureId: "sample-dashboard",
          score: 98.1,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "sample-dashboard",
          score: 97.2,
          screenId: "1:1",
          viewportId: "mobile",
        },
        {
          fixtureId: "sample-form",
          score: 95.8,
          screenId: "1:2",
          viewportId: "desktop",
        },
      ],
    },
    {
      runAt: "2026-04-10T12:00:00.000Z",
      overallScore: 97.9,
      scores: [
        {
          fixtureId: "sample-dashboard",
          score: 98.8,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "sample-dashboard",
          score: 97.9,
          screenId: "1:1",
          viewportId: "mobile",
        },
        {
          fixtureId: "sample-form",
          score: 96.5,
          screenId: "1:2",
          viewportId: "desktop",
        },
      ],
    },
    {
      runAt: "2026-04-11T18:00:40.698Z",
      overallScore: 98.4,
      scores: [
        {
          fixtureId: "sample-dashboard",
          score: 99.1,
          screenId: "1:1",
          viewportId: "desktop",
        },
        {
          fixtureId: "sample-dashboard",
          score: 98.4,
          screenId: "1:1",
          viewportId: "mobile",
        },
        {
          fixtureId: "sample-form",
          score: 96.8,
          screenId: "1:2",
          viewportId: "desktop",
        },
      ],
    },
  ],
};

/**
 * Returns a fully-hydrated sample `MergedReport` suitable for the empty-state
 * "Load sample" action. Uses only inline data URLs for images so it works
 * offline and in CI without a server.
 */
export function buildSampleReport(): MergedReport {
  return mergeReport(sampleAggregate, sampleArtifacts, sampleHistory);
}
