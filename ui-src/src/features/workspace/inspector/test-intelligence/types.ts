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
  | "pending_secondary_approval"
  | "approved"
  | "rejected"
  | "edited"
  | "exported"
  | "transferred";

/**
 * Reasons four-eyes review is enforced for a single test case (#1376).
 * Mirrors the server-side `FourEyesEnforcementReason` discriminant.
 */
export type FourEyesEnforcementReason =
  | "risk_category"
  | "visual_low_confidence"
  | "visual_fallback_used"
  | "visual_possible_pii"
  | "visual_prompt_injection"
  | "visual_metadata_conflict"
  | "multi_source_conflict_present";

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
  regulatoryRelevance?: RegulatoryRelevance;
}

export type RegulatoryRelevanceDomain = "banking" | "insurance" | "general";

export interface RegulatoryRelevance {
  domain: RegulatoryRelevanceDomain;
  rationale?: string;
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

export interface CoverageRequirement {
  requirementId: string;
  technique: string;
  reasonCode: string;
  screenId?: string;
  targetIds: string[];
  sourceRefs: string[];
  visualRefs: string[];
}

export interface CoveragePlan {
  schemaVersion: string;
  jobId: string;
  minimumCases: CoverageRequirement[];
  recommendedCases: CoverageRequirement[];
  techniques: string[];
  mutationKillRateTarget: number;
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

export interface VisualSidecarIssue {
  testCaseId?: string;
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface VisualSidecarRecord {
  screenId: string;
  deployment: "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock";
  outcomes: VisualSidecarOutcome[];
  issues: VisualSidecarIssue[];
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
  fourEyesReasons?: FourEyesEnforcementReason[];
  primaryReviewer?: string;
  primaryApprovalAt?: string;
  secondaryReviewer?: string;
  secondaryApprovalAt?: string;
  lastEditor?: string;
}

export interface ReviewGateSnapshot {
  jobId: string;
  generatedAt: string;
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  pendingSecondaryApprovalCount?: number;
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

export interface JudgePanelPerJudgeVerdictRecord {
  judgeId: string;
  modelBinding: string;
  score: number;
  calibratedScore: number;
  verdict: "fail" | "pass" | "uncertain";
  reason: string;
}

export interface JudgePanelVerdict {
  schemaVersion: string;
  testCaseId: string;
  criterion: string;
  perJudge: JudgePanelPerJudgeVerdictRecord[];
  agreement: "both_fail" | "both_pass" | "disagree";
  resolvedSeverity: "critical" | "downgraded_disagreement" | "major" | "minor";
  escalationRoute: "accept" | "downgrade" | "needs_review";
}

export interface AdversarialGapFinding {
  schemaVersion: string;
  findingId: string;
  kind: string;
  severity: "major";
  summary: string;
  sourceRefs: string[];
  ruleRefs: string[];
  relatedMutationIds: string[];
  missingCaseType: "boundary" | "negative" | "navigation";
}

export interface AgentIterationRecord {
  iteration: number;
  roleStepId: string;
  startedAt: string;
  completedAt: string;
  outcome: "exhausted" | "halted" | "needs_repair" | "passed";
  findingsCount: number;
  repairPlanId?: string;
  parentHash: string;
}

export interface AgentIterationsArtifact {
  schemaVersion: string;
  contractVersion: string;
  jobId: string;
  generatedAt: string;
  iterations: AgentIterationRecord[];
}

export interface EvidenceVerifyCheck {
  kind:
    | "artifact_sha256"
    | "manifest_metadata"
    | "manifest_digest_witness"
    | "visual_sidecar_evidence"
    | "attestation_envelope"
    | "attestation_signatures";
  ok: boolean;
  reference: string;
  failureCode?: string;
  signingMode?: string;
}

export interface EvidenceVerifyFailure {
  code: string;
  reference: string;
  message: string;
}

export interface EvidenceVerifyResponse {
  schemaVersion: string;
  verifiedAt: string;
  jobId: string;
  ok: boolean;
  manifestSha256: string;
  manifestSchemaVersion?: string;
  testIntelligenceContractVersion?: string;
  modelDeployments?: {
    testGeneration: string;
    visualPrimary?: string;
    visualFallback?: string;
  };
  visualSidecar?: {
    selectedDeployment?: string;
    fallbackUsed: boolean;
    resultArtifactSha256?: string;
    captureIdentityCount?: number;
  };
  attestation?: {
    present: boolean;
    signingMode: string;
    signatureCount: number;
    signaturesVerified: boolean;
  };
  checks: EvidenceVerifyCheck[];
  failures: EvidenceVerifyFailure[];
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

export type TestIntentSourceKind =
  | "figma_local_json"
  | "figma_plugin"
  | "figma_rest"
  | "jira_rest"
  | "jira_paste"
  | "custom_text"
  | "custom_structured";

export interface InspectorSourceRecord {
  sourceId: string;
  kind: TestIntentSourceKind;
  capturedAt: string;
  contentHash: string;
  role: "primary" | "supporting";
  label: string;
  authorHandle?: string;
  inputFormat?: "plain_text" | "markdown" | "structured_json";
  canonicalIssueKey?: string;
}

export interface MultiSourceEnvelope {
  aggregateContentHash: string;
  conflictResolutionPolicy: "priority" | "reviewer_decides" | "keep_both";
  priorityOrder?: TestIntentSourceKind[];
}

export interface MultiSourceConflict {
  conflictId: string;
  kind: string;
  participatingSourceIds: string[];
  normalizedValues: string[];
  effectiveState?: "resolved" | "unresolved";
  resolution:
    | "auto_priority"
    | "deferred_to_reviewer"
    | "kept_both"
    | "unresolved";
  affectedElementIds?: string[];
  affectedScreenIds?: string[];
  detail?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface MultiSourceReconciliationReport {
  envelopeHash: string;
  conflicts: MultiSourceConflict[];
  unmatchedSources: string[];
  contributingSourcesPerCase: Array<{
    testCaseId: string;
    sourceIds: string[];
  }>;
  policyApplied: "priority" | "reviewer_decides" | "keep_both";
}

export interface InspectorConflictDecisionSnapshot {
  conflictId: string;
  state: "approved" | "rejected";
  lastEventId: string;
  lastEventAt: string;
  actor: string;
  selectedSourceId?: string;
  selectedNormalizedValue?: string;
  note?: string;
}

export interface InspectorTestCaseProvenance {
  testCaseId: string;
  allSourceIds: string[];
  fieldSourceIds: string[];
  actionSourceIds: string[];
  validationSourceIds: string[];
  navigationSourceIds: string[];
}

export interface TestIntelligenceBundle {
  jobId: string;
  assembledAt: string;
  generatedTestCases?: GeneratedTestCaseList;
  validationReport?: ValidationReport;
  policyReport?: PolicyReport;
  coverageReport?: CoverageReport;
  coveragePlan?: CoveragePlan;
  visualSidecarReport?: VisualSidecarReport;
  qcMappingPreview?: QcMappingPreviewArtifact;
  exportReport?: ExportReport;
  reviewSnapshot?: ReviewGateSnapshot;
  reviewEvents?: ReviewEvent[];
  sourceEnvelope?: MultiSourceEnvelope;
  sourceRefs?: InspectorSourceRecord[];
  multiSourceReconciliation?: MultiSourceReconciliationReport;
  conflictDecisions?: Record<string, InspectorConflictDecisionSnapshot>;
  testCaseProvenance?: Record<string, InspectorTestCaseProvenance>;
  judgePanelVerdicts?: JudgePanelVerdict[];
  adversarialGapFindings?: AdversarialGapFinding[];
  agentIterations?: AgentIterationsArtifact;
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

export interface FetchSourcesResponse {
  jobId: string;
  sources: InspectorSourceRecord[];
}

export interface ResolveConflictInput {
  jobId: string;
  conflictId: string;
  action: "approve" | "reject";
  selectedSourceId?: string;
  selectedNormalizedValue?: string;
  note?: string;
}

export interface ResolveConflictResponse {
  snapshot: InspectorConflictDecisionSnapshot;
}
