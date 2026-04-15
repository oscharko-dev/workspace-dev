/**
 * Pure state machine + apply-gate logic for the Import Review stepper.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/994
 */

import type { ResolvedWorkspaceGovernancePolicy } from "./workspace-policy";

export type WorkspaceImportSessionStatus =
  | "imported"
  | "reviewing"
  | "approved"
  | "applied"
  | "rejected";

export type WorkspaceImportSessionEventKind =
  | "imported"
  | "review_started"
  | "approved"
  | "applied"
  | "rejected"
  | "apply_blocked"
  | "note";

export interface WorkspaceImportSessionEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: WorkspaceImportSessionEventKind;
  readonly at: string;
  readonly actor?: string;
  readonly note?: string;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

export type ImportReviewStage = "import" | "review" | "approve" | "apply";

export interface ImportReviewState {
  stage: ImportReviewStage;
  status: WorkspaceImportSessionStatus;
  reviewerNote: string;
}

export interface CreateInitialImportReviewStateInput {
  status?: WorkspaceImportSessionStatus;
}

export interface CanApplyInput {
  qualityScore: number | null;
  reviewerNote: string;
  policy: ResolvedWorkspaceGovernancePolicy;
  securitySensitive: boolean;
}

export interface ApplyGate {
  allowed: boolean;
  reason: string | null;
  requiresNote: boolean;
}

const STAGE_ORDER: readonly ImportReviewStage[] = [
  "import",
  "review",
  "approve",
  "apply",
];

const STAGE_STATUS: Record<ImportReviewStage, WorkspaceImportSessionStatus> = {
  import: "imported",
  review: "reviewing",
  approve: "approved",
  apply: "applied",
};

// `rejected` is a terminal status that lives at the "review" stage: the
// reviewer rejected during review, so the stepper surfaces it on review.
function mapStatusToStage(
  status: WorkspaceImportSessionStatus,
): ImportReviewStage {
  switch (status) {
    case "imported":
      return "import";
    case "reviewing":
    case "rejected":
      return "review";
    case "approved":
      return "approve";
    case "applied":
      return "apply";
  }
}

export function createInitialImportReviewState(
  input?: CreateInitialImportReviewStateInput,
): ImportReviewState {
  const status = input?.status ?? "imported";
  return {
    stage: mapStatusToStage(status),
    status,
    reviewerNote: "",
  };
}

export function advanceReviewStage(
  state: ImportReviewState,
  target: ImportReviewStage,
): ImportReviewState {
  if (state.stage === target) {
    return state;
  }
  const fromIndex = STAGE_ORDER.indexOf(state.stage);
  const toIndex = STAGE_ORDER.indexOf(target);
  if (Math.abs(toIndex - fromIndex) !== 1) {
    throw new Error(
      `Invalid review stage transition: ${state.stage} → ${target}`,
    );
  }
  return {
    ...state,
    stage: target,
    status: STAGE_STATUS[target],
  };
}

export function describeApplyGate(input: CanApplyInput): ApplyGate {
  const { qualityScore, reviewerNote, policy, securitySensitive } = input;
  const min = policy.minQualityScoreToApply;
  const noteBlank = reviewerNote.trim().length === 0;

  if (min === null && !securitySensitive) {
    return { allowed: true, reason: null, requiresNote: false };
  }

  if (qualityScore === null && min !== null) {
    return {
      allowed: false,
      reason: "Quality score not yet available.",
      requiresNote: false,
    };
  }

  const belowMin = qualityScore !== null && min !== null && qualityScore < min;

  if (belowMin) {
    if (policy.requireNoteOnOverride && noteBlank) {
      return {
        allowed: false,
        reason: `Score ${qualityScore} is below minimum ${min}. A reviewer note is required to override.`,
        requiresNote: true,
      };
    }
    return { allowed: true, reason: null, requiresNote: true };
  }

  if (securitySensitive) {
    if (policy.requireNoteOnOverride && noteBlank) {
      return {
        allowed: false,
        reason:
          "This import touches security-sensitive components. A reviewer note is required to apply.",
        requiresNote: true,
      };
    }
    return { allowed: true, reason: null, requiresNote: true };
  }

  return { allowed: true, reason: null, requiresNote: false };
}
