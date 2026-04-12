import { z } from "zod";
import {
  type HistoryRuns,
  type LastRunAggregate,
  type ScreenReport,
  type StandaloneVisualQualityReport,
  type VisualParitySummary,
} from "./types";

const browserIdSchema = z.enum(["chromium", "firefox", "webkit"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);

const scoreEntrySchema = z.object({
  fixtureId: z.string().min(1),
  score: z.number(),
  screenId: z.string().optional(),
  screenName: z.string().optional(),
  viewportId: z.string().optional(),
  viewportLabel: z.string().optional(),
});

const pairwiseDiffSchema = z.object({
  browserA: z.string(),
  browserB: z.string(),
  diffPercent: z.number(),
  diffImagePath: z.string().optional(),
});

const crossBrowserConsistencySchema = z.object({
  browsers: z.array(browserIdSchema),
  consistencyScore: z.number(),
  pairwiseDiffs: z.array(pairwiseDiffSchema),
});

const browserBreakdownSchema = z
  .object({
    chromium: z.number().optional(),
    firefox: z.number().optional(),
    webkit: z.number().optional(),
  })
  .partial();

const lastRunSchema = z.object({
  version: z.literal(2),
  ranAt: z.string().min(1),
  overallScore: z.number().optional(),
  overallBaseline: z.number().optional(),
  overallCurrent: z.number().optional(),
  overallDelta: z.number().optional(),
  screenAggregateScore: z.number().optional(),
  browserBreakdown: browserBreakdownSchema.optional(),
  crossBrowserConsistency: crossBrowserConsistencySchema.optional(),
  scores: z.array(scoreEntrySchema),
  warnings: z.array(z.string()).optional(),
});

const dimensionSchema = z.object({
  name: z.string().min(1),
  weight: z.number(),
  score: z.number(),
  details: z.string().optional(),
});

const hotspotSchema = z.object({
  region: z.string(),
  severity: severitySchema,
  category: z.string(),
  deviationPercent: z.number(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rank: z.number().optional(),
});

const metadataSchema = z
  .object({
    imageWidth: z.number().optional(),
    imageHeight: z.number().optional(),
    diffPixelCount: z.number().optional(),
    totalPixels: z.number().optional(),
    viewport: z
      .object({
        width: z.number(),
        height: z.number(),
        deviceScaleFactor: z.number().optional(),
      })
      .optional(),
  })
  .optional();

const perBrowserSchema = z.object({
  browser: browserIdSchema,
  overallScore: z.number(),
});

const screenReportSchema = z.object({
  status: z.enum(["completed", "failed", "partial"]),
  overallScore: z.number(),
  interpretation: z.string().optional(),
  referenceSource: z.string().optional(),
  capturedAt: z.string().optional(),
  dimensions: z.array(dimensionSchema),
  hotspots: z.array(hotspotSchema).default([]),
  metadata: metadataSchema,
  perBrowser: z.array(perBrowserSchema).optional(),
  browserBreakdown: browserBreakdownSchema.optional(),
  crossBrowserConsistency: crossBrowserConsistencySchema.optional(),
});

const standaloneVisualQualityReportSchema = z.object({
  status: z.enum(["completed", "failed", "not_requested"]),
  referenceSource: z.string().optional(),
  capturedAt: z.string().optional(),
  overallScore: z.number().optional(),
  interpretation: z.string().optional(),
  dimensions: z.array(dimensionSchema).optional(),
  diffImagePath: z.string().optional(),
  hotspots: z.array(hotspotSchema).optional(),
  metadata: z
    .object({
      comparedAt: z.string().optional(),
      imageWidth: z.number().optional(),
      imageHeight: z.number().optional(),
      diffPixelCount: z.number().optional(),
      totalPixels: z.number().optional(),
      configuredWeights: z.record(z.string(), z.number()).optional(),
      viewport: z
        .object({
          width: z.number(),
          height: z.number(),
          deviceScaleFactor: z.number().optional(),
        })
        .optional(),
      versions: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  perBrowser: z
    .array(
      z.object({
        browser: browserIdSchema,
        overallScore: z.number(),
        actualImagePath: z.string().optional(),
        diffImagePath: z.string().optional(),
        reportPath: z.string().optional(),
        warnings: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  browserBreakdown: browserBreakdownSchema.optional(),
  crossBrowserConsistency: crossBrowserConsistencySchema.optional(),
  warnings: z.array(z.string()).optional(),
  message: z.string().optional(),
});

const visualParityReportSchema = z.object({
  status: z.enum(["passed", "warn"]),
  mode: z.enum(["warn", "strict"]),
  baselinePath: z.string().min(1),
  runtimePreviewUrl: z.string().min(1),
  maxDiffPixelRatio: z.number(),
  details: z.string().min(1),
});

const historyScoreEntrySchema = z.object({
  fixtureId: z.string(),
  score: z.number(),
  screenId: z.string().optional(),
  screenName: z.string().optional(),
  viewportId: z.string().optional(),
  viewportLabel: z.string().optional(),
});

const historyEntrySchemaV2 = z.object({
  runAt: z.string(),
  overallScore: z.number().optional(),
  scores: z.array(historyScoreEntrySchema).default([]),
});

const historySchemaV2 = z.object({
  version: z.literal(2),
  entries: z.array(historyEntrySchemaV2),
});

const historyEntrySchemaV1 = z.object({
  runAt: z.string(),
  overallScore: z.number().optional(),
});

const historySchemaV1 = z.object({
  version: z.literal(1),
  entries: z.array(historyEntrySchemaV1),
});

const historySchema = z.union([historySchemaV2, historySchemaV1]);

/**
 * Removes keys whose value is `undefined` so the result is compatible with
 * `exactOptionalPropertyTypes: true`. Zod's `optional()` produces
 * `{ field?: T | undefined }` but our target interfaces use `{ field?: T }`.
 */
function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry === undefined) {
        continue;
      }
      out[key] = stripUndefinedDeep(entry);
    }
    return out;
  }
  return value;
}

/**
 * Parses a `last-run.json` aggregate. Throws a friendly error on failure.
 */
export function parseLastRun(input: unknown): LastRunAggregate {
  const result = lastRunSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid last-run.json: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  const normalized = stripUndefinedDeep(result.data) as Omit<
    LastRunAggregate,
    "overallScore"
  > & { overallScore?: number };

  if (typeof normalized.overallScore !== "number") {
    if (normalized.scores.length === 0) {
      throw new Error(
        "Invalid last-run.json: overallScore is missing and cannot be derived from an empty scores array.",
      );
    }
    const scoreSum = normalized.scores.reduce((sum, score) => sum + score.score, 0);
    normalized.overallScore = scoreSum / normalized.scores.length;
  }

  return normalized as LastRunAggregate;
}

/**
 * Parses a per-screen `report.json`.
 */
export function parseScreenReport(input: unknown): ScreenReport {
  const result = screenReportSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid screen report.json: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return stripUndefinedDeep(result.data) as ScreenReport;
}

/**
 * Parses a top-level `visual-quality/report.json` payload.
 */
export function parseStandaloneVisualQualityReport(
  input: unknown,
): StandaloneVisualQualityReport {
  const result = standaloneVisualQualityReportSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid visual-quality report.json: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return stripUndefinedDeep(result.data) as StandaloneVisualQualityReport;
}

/**
 * Parses a `visual-parity-report.json` summary payload.
 */
export function parseVisualParityReport(input: unknown): VisualParitySummary {
  const result = visualParityReportSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid visual-parity-report.json: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return stripUndefinedDeep(result.data) as VisualParitySummary;
}

/**
 * Parses the optional `history.json`. Supports version 1 (runs only) and
 * version 2 (runs with per-score entries). Returns a normalized v2 shape so
 * callers never have to branch on version.
 */
export function parseHistory(input: unknown): HistoryRuns {
  const result = historySchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid history.json: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  const data = result.data;
  if (data.version === 1) {
    return stripUndefinedDeep({
      version: 1,
      entries: data.entries.map((entry) => ({
        runAt: entry.runAt,
        scores: [],
        overallScore: entry.overallScore,
      })),
    }) as HistoryRuns;
  }
  return stripUndefinedDeep({
    version: 2,
    entries: data.entries.map((entry) => ({
      runAt: entry.runAt,
      scores: entry.scores,
      overallScore: entry.overallScore,
    })),
  }) as HistoryRuns;
}
