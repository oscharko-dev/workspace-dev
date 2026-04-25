// ---------------------------------------------------------------------------
// Test Intelligence Inspector — UI types (Issue #1367)
//
// These types mirror the server contract exposed at
// `/workspace/test-intelligence/...`. We intentionally re-declare them inside
// `ui-src/` rather than importing from `src/contracts/` because the UI is
// built as an independent Vite bundle with its own tsconfig and must not
// pull server-side artifact-emitter helpers into the browser bundle.
// ---------------------------------------------------------------------------

export type ReviewState =
  | "generated"
  | "needs_review"
  | "approved"
  | "rejected"
  | "edited"
  | "exported"
  | "transferred";

export type PolicyDecision = "approved" | "needs_review" | "blocked";

export type TestCaseLevel =
  | "unit"
  | "component"
  | "integration"
  | "system"
  | "acceptance";

export type TestCaseType =
  | "functional"
  | "negative"
  | "boundary"
  | "validation"
  | "navigation"
  | "regression"
  | "exploratory"
  | "accessibility";

export type TestCasePriority = "p0" | "p1" | "p2" | "p3";

export type TestCaseRiskCategory =
  | "low"
  | "medium"
  | "high"
  | "regulated_data"
  | "financial_transaction";

export interface TestCaseStep {
  index: number;
  action: string;
  data?: string;
  expected?: string;
}

export interface FigmaTraceRef {
  screenId: string;
  nodeId?: string;
  nodeName?: string;
  nodePath?: string;
}

export interface QcMappingPreview {
  folderHint?: string;
  mappingProfileId?: string;
  exportable: boolean;
  blockingReasons?: string[];
}

export interface AmbiguityNote {
  reason: string;
}

export interface QualitySignals {
  coveredFieldIds: string[];
  coveredActionIds: string[];
  coveredValidationIds: string[];
  coveredNavigationIds: string[];
  confidence: number;
  ambiguity?: AmbiguityNote;
}

export interface GeneratedTestCase {
  id: string;
  sourceJobId: string;
  title: string;
  objective: string;
  level: TestCaseLevel;
  type: TestCaseType;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  technique: string;
  preconditions: string[];
  testData: string[];
  steps: TestCaseStep[];
  expectedResults: string[];
  figmaTraceRefs: FigmaTraceRef[];
  assumptions: string[];
  openQuestions: string[];
  qcMappingPreview: QcMappingPreview;
  qualitySignals: QualitySignals;
  reviewState: "draft" | "auto_approved" | "needs_review" | "rejected";
}

export interface GeneratedTestCaseList {
  jobId: string;
  testCases: GeneratedTestCase[];
}

export interface PolicyViolation {
  rule: string;
  outcome: string;
  severity: "error" | "warning";
  reason: string;
  path?: string;
}

export interface PolicyDecisionRecord {
  testCaseId: string;
  decision: PolicyDecision;
  violations: PolicyViolation[];
}

export interface PolicyReport {
  jobId: string;
  policyProfileId: string;
  policyProfileVersion: string;
  totalTestCases: number;
  approvedCount: number;
  blockedCount: number;
  needsReviewCount: number;
  blocked: boolean;
  decisions: PolicyDecisionRecord[];
  jobLevelViolations: PolicyViolation[];
}

export interface ValidationIssue {
  testCaseId?: string;
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationReport {
  jobId: string;
  totalTestCases: number;
  errorCount: number;
  warningCount: number;
  blocked: boolean;
  issues: ValidationIssue[];
}

export interface CoverageBucket {
  total: number;
  covered: number;
  ratio: number;
  uncoveredIds: string[];
}

export interface DuplicatePair {
  leftTestCaseId: string;
  rightTestCaseId: string;
  similarity: number;
}

export interface CoverageReport {
  jobId: string;
  policyProfileId: string;
  totalTestCases: number;
  fieldCoverage: CoverageBucket;
  actionCoverage: CoverageBucket;
  validationCoverage: CoverageBucket;
  navigationCoverage: CoverageBucket;
  traceCoverage: { total: number; withTrace: number; ratio: number };
  negativeCaseCount: number;
  validationCaseCount: number;
  boundaryCaseCount: number;
  accessibilityCaseCount: number;
  workflowCaseCount: number;
  positiveCaseCount: number;
  assumptionsRatio: number;
  openQuestionsCount: number;
  duplicatePairs: DuplicatePair[];
  rubricScore?: number;
}

export type VisualSidecarOutcome =
  | "ok"
  | "schema_invalid"
  | "low_confidence"
  | "fallback_used"
  | "possible_pii"
  | "prompt_injection_like_text"
  | "conflicts_with_figma_metadata"
  | "primary_unavailable";

export interface VisualSidecarRecord {
  screenId: string;
  deployment: "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock";
  outcomes: VisualSidecarOutcome[];
  meanConfidence: number;
}

export interface VisualSidecarReport {
  jobId: string;
  totalScreens: number;
  screensWithFindings: number;
  blocked: boolean;
  records: VisualSidecarRecord[];
}

export interface ReviewSnapshotEntry {
  testCaseId: string;
  state: ReviewState;
  policyDecision: PolicyDecision;
  lastEventId: string;
  lastEventAt: string;
  fourEyesEnforced: boolean;
  approvers: string[];
}

export interface ReviewGateSnapshot {
  jobId: string;
  generatedAt: string;
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  perTestCase: ReviewSnapshotEntry[];
}

export interface ReviewEvent {
  id: string;
  jobId: string;
  testCaseId?: string;
  kind: string;
  at: string;
  sequence: number;
  fromState?: ReviewState;
  toState?: ReviewState;
  actor?: string;
  note?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ExportArtifactRecord {
  filename: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface ExportReport {
  jobId: string;
  profileId: string;
  profileVersion: string;
  exportedTestCaseCount: number;
  refused: boolean;
  refusalCodes: string[];
  artifacts: ExportArtifactRecord[];
  visualEvidenceHashes: string[];
  rawScreenshotsIncluded: false;
}

export interface QcMappingPreviewEntry {
  testCaseId: string;
  externalIdCandidate: string;
  testName: string;
  objective: string;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  targetFolderPath: string;
  exportable: boolean;
  blockingReasons: string[];
  visualProvenance?: {
    deployment: string;
    fallbackReason: string;
    confidenceMean: number;
    ambiguityCount: number;
    evidenceHash: string;
  };
}

export interface QcMappingPreviewArtifact {
  jobId: string;
  profileId: string;
  profileVersion: string;
  entries: QcMappingPreviewEntry[];
}

export interface BundleParseError {
  artifact: string;
  filename: string;
  reason: "invalid_json" | "schema_mismatch" | "io_error";
  message: string;
}

export interface TestIntelligenceBundle {
  jobId: string;
  assembledAt: string;
  generatedTestCases?: GeneratedTestCaseList;
  validationReport?: ValidationReport;
  policyReport?: PolicyReport;
  coverageReport?: CoverageReport;
  visualSidecarReport?: VisualSidecarReport;
  qcMappingPreview?: QcMappingPreviewArtifact;
  exportReport?: ExportReport;
  reviewSnapshot?: ReviewGateSnapshot;
  reviewEvents?: ReviewEvent[];
  parseErrors: BundleParseError[];
}

export interface TestIntelligenceJobSummary {
  jobId: string;
  hasArtifacts: Record<string, boolean>;
}

export interface ReviewActionInput {
  jobId: string;
  testCaseId?: string;
  action: "approve" | "reject" | "edit" | "review-started" | "note";
  actor?: string;
  note?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
