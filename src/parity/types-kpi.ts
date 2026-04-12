export interface KpiDurationStats {
  avgMs?: number;
  p95Ms?: number;
}

export interface KpiRateStats {
  completionRate: number;
  failureRate: number;
  warningRate: number;
}

export interface KpiVisualQualityDimensionScores {
  layout?: number;
  color?: number;
  typography?: number;
  component?: number;
  spacing?: number;
}

export interface ProjectKpiSnapshot {
  projectId: string;
  from: string;
  to: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  retriesTotal: number;
  retriesPerJob?: number;
  duration: KpiDurationStats;
  rates: KpiRateStats;
  mappingCoverageAvg?: number;
  uiGateWarnRate?: number;
  visualQualityScoreAvg?: number;
  visualQualityScoreP50?: number;
  visualQualityScoreP95?: number;
  visualQualityDimensions?: KpiVisualQualityDimensionScores;
}

export interface PortfolioKpiSnapshot {
  from: string;
  to: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  retriesTotal: number;
  retriesPerJob?: number;
  duration: KpiDurationStats;
  rates: KpiRateStats;
  mappingCoverageAvg?: number;
  uiGateWarnRate?: number;
  visualQualityScoreAvg?: number;
  projects: Array<{
    projectId: string;
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
  }>;
}

export type KpiBucket = "day" | "week";

export interface KpiTrendBucket {
  bucketStart: string;
  bucketEnd: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  warningRate: number;
  uiGateWarnRate: number;
  retriesPerJob: number;
  mappingCoverageAvg?: number;
  visualQualityScoreAvg?: number;
  duration: KpiDurationStats;
}

export interface KpiBaselineComparison {
  baselineFrom: string;
  baselineTo: string;
  currentFrom: string;
  currentTo: string;
  mappingCoverageDelta?: number;
  uiGateWarnRateDelta?: number;
  retriesPerJobDelta?: number;
  visualQualityScoreDelta?: number;
}

export type KpiAlertCode =
  | "ALERT_MAPPING_COVERAGE_DROP"
  | "ALERT_UI_GATE_WARN_SPIKE"
  | "ALERT_RETRY_INFLATION"
  | "ALERT_QUEUE_SATURATION"
  | "ALERT_VISUAL_QUALITY_DROP"
  | "ALERT_VISUAL_QUALITY_OVERFITTING_RISK"
  | "ALERT_VISUAL_QUALITY_CANONICAL_DIFF_EXCEEDED"
  | "ALERT_VISUAL_QUALITY_CANONICAL_REFERENCE_MISSING"
  | "ALERT_VISUAL_QUALITY_MISSING_SCREEN"
  | "ALERT_VISUAL_QUALITY_ORPHAN_SCREEN_BASELINE"
  | "ALERT_VISUAL_QUALITY_STALE_SCREEN_BASELINE";

export interface KpiAlert {
  code: KpiAlertCode;
  severity: "warn";
  message: string;
  value: number;
  threshold: number;
}

export interface ProjectKpiResponse {
  projectId: string;
  boardKey: string;
  from: string;
  to: string;
  bucket: KpiBucket;
  summary: ProjectKpiSnapshot;
  trend: KpiTrendBucket[];
  baseline?: KpiBaselineComparison;
  alerts: KpiAlert[];
}

export interface PortfolioKpiResponse {
  from: string;
  to: string;
  bucket: KpiBucket;
  summary: PortfolioKpiSnapshot;
  trend: KpiTrendBucket[];
  baseline?: KpiBaselineComparison;
  alerts: KpiAlert[];
}
