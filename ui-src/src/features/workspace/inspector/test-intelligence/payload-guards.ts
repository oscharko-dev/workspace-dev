// ---------------------------------------------------------------------------
// Test Intelligence Inspector — runtime payload guards (Issue #1367 follow-up)
//
// The UI does not blindly trust JSON returned by the server. Each top-level
// envelope returned by the `/workspace/test-intelligence/...` routes goes
// through a structural guard before being assigned to its strict TS type,
// so a future server-side schema drift, downgraded proxy, or hostile
// intermediary cannot poison the React tree with `unknown`-shaped data.
//
// The guards intentionally validate only the structural fields the UI
// actually reads. Optional fields are checked when present; never when
// absent. Each guard returns a `boolean` and is paired with a TS type
// predicate so callers can narrow safely without `as unknown as` casts.
// ---------------------------------------------------------------------------

import type {
  CoverageReport,
  ExportReport,
  GeneratedTestCase,
  GeneratedTestCaseList,
  PolicyReport,
  QcMappingPreviewArtifact,
  ReviewEvent,
  ReviewGateSnapshot,
  ReviewSnapshotEntry,
  TestIntelligenceBundle,
  TestIntelligenceJobSummary,
  ValidationReport,
  VisualSidecarReport,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isFlatMetadata = (
  value: unknown,
): value is Record<string, string | number | boolean | null> => {
  if (!isRecord(value)) return false;
  for (const entry of Object.values(value)) {
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      return false;
    }
  }
  return true;
};

const REVIEW_STATES = new Set([
  "generated",
  "needs_review",
  "pending_secondary_approval",
  "approved",
  "rejected",
  "edited",
  "exported",
  "transferred",
]);

const FOUR_EYES_REASONS = new Set([
  "risk_category",
  "visual_low_confidence",
  "visual_fallback_used",
  "visual_possible_pii",
  "visual_prompt_injection",
  "visual_metadata_conflict",
]);

const POLICY_DECISIONS = new Set(["approved", "needs_review", "blocked"]);
const VISUAL_SIDECAR_OUTCOMES = new Set([
  "ok",
  "schema_invalid",
  "low_confidence",
  "fallback_used",
  "possible_pii",
  "prompt_injection_like_text",
  "conflicts_with_figma_metadata",
  "primary_unavailable",
]);
const VISUAL_SIDECAR_DEPLOYMENTS = new Set([
  "llama-4-maverick-vision",
  "phi-4-multimodal-poc",
  "mock",
]);

const isReviewSnapshotEntry = (
  value: unknown,
): value is ReviewSnapshotEntry => {
  if (!isRecord(value)) return false;
  if (
    !(
      typeof value["testCaseId"] === "string" &&
      typeof value["state"] === "string" &&
      REVIEW_STATES.has(value["state"]) &&
      typeof value["policyDecision"] === "string" &&
      POLICY_DECISIONS.has(value["policyDecision"]) &&
      typeof value["lastEventId"] === "string" &&
      typeof value["lastEventAt"] === "string" &&
      typeof value["fourEyesEnforced"] === "boolean" &&
      isStringArray(value["approvers"])
    )
  ) {
    return false;
  }
  if (value["fourEyesReasons"] !== undefined) {
    if (
      !Array.isArray(value["fourEyesReasons"]) ||
      !value["fourEyesReasons"].every(
        (r) => typeof r === "string" && FOUR_EYES_REASONS.has(r),
      )
    ) {
      return false;
    }
  }
  for (const optionalString of [
    "primaryReviewer",
    "primaryApprovalAt",
    "secondaryReviewer",
    "secondaryApprovalAt",
    "lastEditor",
  ] as const) {
    const v = value[optionalString];
    if (v !== undefined && typeof v !== "string") {
      return false;
    }
  }
  return true;
};

export const isReviewGateSnapshot = (
  value: unknown,
): value is ReviewGateSnapshot => {
  if (!isRecord(value)) return false;
  if (
    !(
      typeof value["jobId"] === "string" &&
      typeof value["generatedAt"] === "string" &&
      typeof value["approvedCount"] === "number" &&
      typeof value["needsReviewCount"] === "number" &&
      typeof value["rejectedCount"] === "number" &&
      Array.isArray(value["perTestCase"]) &&
      value["perTestCase"].every(isReviewSnapshotEntry)
    )
  ) {
    return false;
  }
  if (
    value["pendingSecondaryApprovalCount"] !== undefined &&
    (typeof value["pendingSecondaryApprovalCount"] !== "number" ||
      !Number.isInteger(value["pendingSecondaryApprovalCount"]))
  ) {
    return false;
  }
  return true;
};

export const isReviewEvent = (value: unknown): value is ReviewEvent => {
  if (!isRecord(value)) return false;
  if (
    typeof value["id"] !== "string" ||
    typeof value["jobId"] !== "string" ||
    typeof value["kind"] !== "string" ||
    typeof value["at"] !== "string" ||
    typeof value["sequence"] !== "number" ||
    !Number.isInteger(value["sequence"])
  ) {
    return false;
  }
  if (
    value["testCaseId"] !== undefined &&
    typeof value["testCaseId"] !== "string"
  ) {
    return false;
  }
  if (value["actor"] !== undefined && typeof value["actor"] !== "string") {
    return false;
  }
  if (value["note"] !== undefined && typeof value["note"] !== "string") {
    return false;
  }
  if (
    value["fromState"] !== undefined &&
    (typeof value["fromState"] !== "string" ||
      !REVIEW_STATES.has(value["fromState"]))
  ) {
    return false;
  }
  if (
    value["toState"] !== undefined &&
    (typeof value["toState"] !== "string" ||
      !REVIEW_STATES.has(value["toState"]))
  ) {
    return false;
  }
  if (value["metadata"] !== undefined && !isFlatMetadata(value["metadata"])) {
    return false;
  }
  return true;
};

const isReviewEventArray = (value: unknown): value is ReviewEvent[] =>
  Array.isArray(value) && value.every(isReviewEvent);

const isGeneratedTestCase = (value: unknown): value is GeneratedTestCase => {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["sourceJobId"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["objective"] === "string" &&
    typeof value["level"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["priority"] === "string" &&
    typeof value["riskCategory"] === "string" &&
    typeof value["technique"] === "string" &&
    isStringArray(value["preconditions"]) &&
    isStringArray(value["testData"]) &&
    Array.isArray(value["steps"]) &&
    isStringArray(value["expectedResults"]) &&
    Array.isArray(value["figmaTraceRefs"]) &&
    isStringArray(value["assumptions"]) &&
    isStringArray(value["openQuestions"]) &&
    isRecord(value["qcMappingPreview"]) &&
    isRecord(value["qualitySignals"]) &&
    typeof value["reviewState"] === "string"
  );
};

const isGeneratedTestCaseList = (
  value: unknown,
): value is GeneratedTestCaseList => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    Array.isArray(value["testCases"]) &&
    value["testCases"].every(isGeneratedTestCase)
  );
};

const isValidationReport = (value: unknown): value is ValidationReport => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    typeof value["errorCount"] === "number" &&
    typeof value["warningCount"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["issues"])
  );
};

const isPolicyReport = (value: unknown): value is PolicyReport => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["policyProfileId"] === "string" &&
    typeof value["policyProfileVersion"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    typeof value["approvedCount"] === "number" &&
    typeof value["blockedCount"] === "number" &&
    typeof value["needsReviewCount"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["decisions"]) &&
    Array.isArray(value["jobLevelViolations"])
  );
};

const isValidationIssue = (
  value: unknown,
): value is ValidationReport["issues"][number] => {
  if (!isRecord(value)) return false;
  return (
    (value["testCaseId"] === undefined ||
      typeof value["testCaseId"] === "string") &&
    typeof value["path"] === "string" &&
    typeof value["code"] === "string" &&
    (value["severity"] === "error" || value["severity"] === "warning") &&
    typeof value["message"] === "string"
  );
};

const isCoverageReport = (value: unknown): value is CoverageReport => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["policyProfileId"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    isRecord(value["fieldCoverage"]) &&
    isRecord(value["actionCoverage"]) &&
    isRecord(value["validationCoverage"]) &&
    isRecord(value["navigationCoverage"]) &&
    isRecord(value["traceCoverage"]) &&
    Array.isArray(value["duplicatePairs"])
  );
};

const isVisualSidecarReport = (
  value: unknown,
): value is VisualSidecarReport => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["totalScreens"] === "number" &&
    typeof value["screensWithFindings"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["records"]) &&
    value["records"].every((record) => {
      if (!isRecord(record)) return false;
      return (
        typeof record["screenId"] === "string" &&
        typeof record["deployment"] === "string" &&
        VISUAL_SIDECAR_DEPLOYMENTS.has(record["deployment"]) &&
        Array.isArray(record["outcomes"]) &&
        record["outcomes"].every(
          (outcome) =>
            typeof outcome === "string" && VISUAL_SIDECAR_OUTCOMES.has(outcome),
        ) &&
        Array.isArray(record["issues"]) &&
        record["issues"].every(isValidationIssue) &&
        typeof record["meanConfidence"] === "number"
      );
    })
  );
};

const isQcMappingEntry = (
  value: unknown,
): value is QcMappingPreviewArtifact["entries"][number] => {
  if (!isRecord(value)) return false;
  if (
    typeof value["testCaseId"] !== "string" ||
    typeof value["externalIdCandidate"] !== "string" ||
    typeof value["testName"] !== "string" ||
    typeof value["objective"] !== "string" ||
    typeof value["priority"] !== "string" ||
    typeof value["riskCategory"] !== "string" ||
    typeof value["targetFolderPath"] !== "string" ||
    typeof value["exportable"] !== "boolean" ||
    !isStringArray(value["blockingReasons"])
  ) {
    return false;
  }
  if (value["visualProvenance"] === undefined) return true;
  if (!isRecord(value["visualProvenance"])) return false;
  return (
    typeof value["visualProvenance"]["deployment"] === "string" &&
    typeof value["visualProvenance"]["fallbackReason"] === "string" &&
    typeof value["visualProvenance"]["confidenceMean"] === "number" &&
    typeof value["visualProvenance"]["ambiguityCount"] === "number" &&
    typeof value["visualProvenance"]["evidenceHash"] === "string"
  );
};

const isQcMappingPreview = (
  value: unknown,
): value is QcMappingPreviewArtifact => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["profileId"] === "string" &&
    typeof value["profileVersion"] === "string" &&
    Array.isArray(value["entries"]) &&
    value["entries"].every(isQcMappingEntry)
  );
};

const isExportReport = (value: unknown): value is ExportReport => {
  if (!isRecord(value)) return false;
  return (
    typeof value["jobId"] === "string" &&
    typeof value["profileId"] === "string" &&
    typeof value["profileVersion"] === "string" &&
    typeof value["refused"] === "boolean" &&
    Array.isArray(value["refusalCodes"]) &&
    Array.isArray(value["artifacts"]) &&
    Array.isArray(value["visualEvidenceHashes"]) &&
    value["rawScreenshotsIncluded"] === false
  );
};

const optionalGuard = <T>(
  value: unknown,
  guard: (v: unknown) => v is T,
):
  | { present: false }
  | { present: true; value: T }
  | { present: "invalid" } => {
  if (value === undefined) return { present: false };
  if (guard(value)) return { present: true, value };
  return { present: "invalid" };
};

/**
 * Validate the composite bundle returned by `GET /workspace/test-intelligence/jobs/:jobId`.
 * Top-level shape (jobId, assembledAt, parseErrors[]) must be present;
 * every optional artifact slot is validated only when present.
 */
export const isTestIntelligenceBundle = (
  value: unknown,
): value is TestIntelligenceBundle => {
  if (!isRecord(value)) return false;
  if (
    typeof value["jobId"] !== "string" ||
    typeof value["assembledAt"] !== "string" ||
    !Array.isArray(value["parseErrors"])
  ) {
    return false;
  }

  const slots: { key: string; guard: (v: unknown) => v is unknown }[] = [
    {
      key: "generatedTestCases",
      guard: isGeneratedTestCaseList as (v: unknown) => v is unknown,
    },
    {
      key: "validationReport",
      guard: isValidationReport as (v: unknown) => v is unknown,
    },
    {
      key: "policyReport",
      guard: isPolicyReport as (v: unknown) => v is unknown,
    },
    {
      key: "coverageReport",
      guard: isCoverageReport as (v: unknown) => v is unknown,
    },
    {
      key: "visualSidecarReport",
      guard: isVisualSidecarReport as (v: unknown) => v is unknown,
    },
    {
      key: "qcMappingPreview",
      guard: isQcMappingPreview as (v: unknown) => v is unknown,
    },
    {
      key: "exportReport",
      guard: isExportReport as (v: unknown) => v is unknown,
    },
    {
      key: "reviewSnapshot",
      guard: isReviewGateSnapshot as (v: unknown) => v is unknown,
    },
    {
      key: "reviewEvents",
      guard: isReviewEventArray as (v: unknown) => v is unknown,
    },
  ];

  for (const slot of slots) {
    const result = optionalGuard(value[slot.key], slot.guard);
    if (result.present === "invalid") return false;
  }
  return true;
};

const isTestIntelligenceJobSummary = (
  value: unknown,
): value is TestIntelligenceJobSummary => {
  if (!isRecord(value)) return false;
  if (typeof value["jobId"] !== "string") return false;
  if (!isRecord(value["hasArtifacts"])) return false;
  for (const flag of Object.values(value["hasArtifacts"])) {
    if (typeof flag !== "boolean") return false;
  }
  return true;
};

export const isTestIntelligenceJobSummaryArray = (
  value: unknown,
): value is TestIntelligenceJobSummary[] =>
  Array.isArray(value) && value.every(isTestIntelligenceJobSummary);

/** Envelope returned by `GET /workspace/test-intelligence/review/:jobId/state`. */
export interface ReviewStateEnvelope {
  snapshot: ReviewGateSnapshot;
  events: ReviewEvent[];
}

export const isReviewStateEnvelope = (
  value: unknown,
): value is ReviewStateEnvelope => {
  if (!isRecord(value)) return false;
  return (
    isReviewGateSnapshot(value["snapshot"]) &&
    isReviewEventArray(value["events"])
  );
};

/** Envelope returned by `POST /workspace/test-intelligence/review/:jobId/:action[/:testCaseId]`. */
export interface ReviewActionEnvelope {
  ok: true;
  snapshot: ReviewGateSnapshot;
  event: ReviewEvent;
}

export const isReviewActionEnvelope = (
  value: unknown,
): value is ReviewActionEnvelope => {
  if (!isRecord(value)) return false;
  return (
    value["ok"] === true &&
    isReviewGateSnapshot(value["snapshot"]) &&
    isReviewEvent(value["event"])
  );
};
