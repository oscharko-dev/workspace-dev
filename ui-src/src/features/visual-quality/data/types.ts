/**
 * Local type shapes for the visual-quality gallery view.
 *
 * These mirror the subset of `WorkspaceVisualQualityReport` from
 * `src/contracts/index.ts` that the UI needs. We duplicate them here because
 * the Inspector UI has no import boundary into `src/` and we must not add one.
 */

export type BrowserId = "chromium" | "firefox" | "webkit";
export type HotspotSeverity = "low" | "medium" | "high" | "critical";
export type ReportStatus = "completed" | "failed" | "partial";
export type VisualQualityStatus = "completed" | "failed" | "not_requested";

export interface ScoreEntry {
  fixtureId: string;
  score: number;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
}

export interface PairwiseDiff {
  browserA: string;
  browserB: string;
  diffPercent: number;
  diffImagePath?: string;
}

export interface CrossBrowserConsistency {
  browsers: BrowserId[];
  consistencyScore: number;
  pairwiseDiffs: PairwiseDiff[];
}

export type BrowserBreakdown = Partial<Record<BrowserId, number>>;

export interface LastRunAggregate {
  version: 2;
  ranAt: string;
  overallScore: number;
  overallBaseline?: number;
  overallCurrent?: number;
  overallDelta?: number;
  screenAggregateScore?: number;
  browserBreakdown?: BrowserBreakdown;
  crossBrowserConsistency?: CrossBrowserConsistency;
  scores: ScoreEntry[];
  warnings?: string[];
}

export interface DimensionScore {
  name: string;
  weight: number;
  score: number;
  details?: string;
}

export interface Hotspot {
  region: string;
  severity: HotspotSeverity;
  category: string;
  deviationPercent: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rank?: number;
}

export interface ReportMetadata {
  imageWidth?: number;
  imageHeight?: number;
  diffPixelCount?: number;
  totalPixels?: number;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
}

export interface PerBrowserEntry {
  browser: BrowserId;
  overallScore: number;
}

export interface StandaloneVisualQualityBrowserEntry extends PerBrowserEntry {
  actualImagePath?: string;
  diffImagePath?: string;
  reportPath?: string;
  warnings?: string[];
}

export interface ScreenReport {
  status: ReportStatus;
  overallScore: number;
  interpretation?: string;
  referenceSource?: string;
  capturedAt?: string;
  dimensions: DimensionScore[];
  hotspots: Hotspot[];
  metadata?: ReportMetadata;
  perBrowser?: PerBrowserEntry[];
  browserBreakdown?: BrowserBreakdown;
  crossBrowserConsistency?: CrossBrowserConsistency;
}

export interface StandaloneVisualQualityReport {
  status: VisualQualityStatus;
  referenceSource?: string;
  capturedAt?: string;
  overallScore?: number;
  interpretation?: string;
  dimensions?: DimensionScore[];
  diffImagePath?: string;
  hotspots?: Hotspot[];
  metadata?: ReportMetadata & {
    comparedAt?: string;
    configuredWeights?: Record<string, number>;
    versions?: Record<string, string>;
  };
  browserBreakdown?: BrowserBreakdown;
  crossBrowserConsistency?: CrossBrowserConsistency;
  perBrowser?: StandaloneVisualQualityBrowserEntry[];
  warnings?: string[];
  message?: string;
}

export interface VisualParitySummary {
  status: "passed" | "warn";
  mode: "warn" | "strict";
  baselinePath: string;
  runtimePreviewUrl: string;
  maxDiffPixelRatio: number;
  details: string;
}

export interface HistoryScoreEntry {
  fixtureId: string;
  score: number;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
}

export interface HistoryRunEntry {
  runAt: string;
  overallScore?: number;
  scores: HistoryScoreEntry[];
}

export interface HistoryRuns {
  version: 1 | 2;
  entries: HistoryRunEntry[];
}

/**
 * A fully-merged screen combining its score entry, its per-screen report
 * (if available), and any image URLs that were attached during loading.
 */
export interface MergedScreen {
  key: string;
  fixtureId: string;
  screenId: string;
  screenName: string;
  viewportId: string;
  viewportLabel: string;
  score: number;
  report: ScreenReport | null;
  referenceUrl: string | null;
  actualUrl: string | null;
  diffUrl: string | null;
  worstSeverity: HotspotSeverity | null;
}

/**
 * A grouping of merged screens by fixture, used by the gallery view.
 */
export interface MergedFixture {
  fixtureId: string;
  averageScore: number;
  screens: MergedScreen[];
}

/**
 * Top-level report hydrated by `report-loader` and rendered by the page.
 */
export interface MergedReport {
  aggregate: LastRunAggregate;
  fixtures: MergedFixture[];
  screensByKey: Record<string, MergedScreen>;
  history: HistoryRuns | null;
  hasImages: boolean;
  sourceKind?: "benchmark" | "visual-quality" | "visual-parity";
  paritySummary?: VisualParitySummary;
  notices?: string[];
}

// ---------------------------------------------------------------------------
// Generation confidence model types (#849)
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low" | "very_low";

export interface ConfidenceContributor {
  signal: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  value: number;
  detail: string;
}

export interface ComponentConfidence {
  componentId: string;
  componentName: string;
  level: ConfidenceLevel;
  score: number;
  contributors: ConfidenceContributor[];
}

export interface ScreenConfidence {
  screenId: string;
  screenName: string;
  level: ConfidenceLevel;
  score: number;
  contributors: ConfidenceContributor[];
  components: ComponentConfidence[];
}

export interface JobConfidence {
  status: "completed" | "failed" | "not_requested";
  generatedAt?: string;
  level?: ConfidenceLevel;
  score?: number;
  contributors?: ConfidenceContributor[];
  screens?: ScreenConfidence[];
  lowConfidenceSummary?: string[];
  message?: string;
}
