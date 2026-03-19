export interface KpiDurationStats {
  avgMs?: number;
  p95Ms?: number;
}

export interface KpiRateStats {
  completionRate: number;
  failureRate: number;
  warningRate: number;
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
}

export type KpiAlertCode =
  | "ALERT_MAPPING_COVERAGE_DROP"
  | "ALERT_UI_GATE_WARN_SPIKE"
  | "ALERT_RETRY_INFLATION"
  | "ALERT_QUEUE_SATURATION";

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
