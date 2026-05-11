/**
 * Unit tests for the import review state machine + apply-gate logic.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/994
 */

import { describe, expect, it } from "vitest";
import {
  advanceReviewStage,
  createInitialImportReviewState,
  describeApplyGate,
  type ImportReviewStage,
  type WorkspaceImportSessionStatus,
} from "./import-review-state";
import type { ResolvedWorkspaceGovernancePolicy } from "./workspace-policy";

const NO_GATE_POLICY: ResolvedWorkspaceGovernancePolicy = {
  minQualityScoreToApply: null,
  securitySensitivePatterns: [],
  requireNoteOnOverride: true,
};

const GATED_POLICY: ResolvedWorkspaceGovernancePolicy = {
  minQualityScoreToApply: 70,
  securitySensitivePatterns: [],
  requireNoteOnOverride: true,
};

const GATED_POLICY_NO_NOTE_REQUIRED: ResolvedWorkspaceGovernancePolicy = {
  minQualityScoreToApply: 70,
  securitySensitivePatterns: [],
  requireNoteOnOverride: false,
};

const SENSITIVE_POLICY: ResolvedWorkspaceGovernancePolicy = {
  minQualityScoreToApply: null,
  securitySensitivePatterns: ["password"],
  requireNoteOnOverride: true,
};

describe("createInitialImportReviewState", () => {
  it("defaults to the import stage when no input is supplied", () => {
    expect(createInitialImportReviewState()).toEqual({
      stage: "import",
      status: "imported",
      reviewerNote: "",
    });
  });

  it("maps imported status to the import stage", () => {
    expect(createInitialImportReviewState({ status: "imported" })).toEqual({
      stage: "import",
      status: "imported",
      reviewerNote: "",
    });
  });

  it("maps reviewing status to the review stage", () => {
    expect(createInitialImportReviewState({ status: "reviewing" })).toEqual({
      stage: "review",
      status: "reviewing",
      reviewerNote: "",
    });
  });

  it("maps rejected status to the review stage while preserving the rejected status", () => {
    expect(createInitialImportReviewState({ status: "rejected" })).toEqual({
      stage: "review",
      status: "rejected",
      reviewerNote: "",
    });
  });

  it("maps approved status to the approve stage", () => {
    expect(createInitialImportReviewState({ status: "approved" })).toEqual({
      stage: "approve",
      status: "approved",
      reviewerNote: "",
    });
  });

  it("maps applied status to the apply stage", () => {
    expect(createInitialImportReviewState({ status: "applied" })).toEqual({
      stage: "apply",
      status: "applied",
      reviewerNote: "",
    });
  });
});

describe("advanceReviewStage", () => {
  const forwardTransitions: ReadonlyArray<
    [ImportReviewStage, ImportReviewStage, WorkspaceImportSessionStatus]
  > = [
    ["import", "review", "reviewing"],
    ["review", "approve", "approved"],
    ["approve", "apply", "applied"],
  ];

  const backwardTransitions: ReadonlyArray<
    [ImportReviewStage, ImportReviewStage, WorkspaceImportSessionStatus]
  > = [
    ["apply", "approve", "approved"],
    ["approve", "review", "reviewing"],
    ["review", "import", "imported"],
  ];

  for (const [from, to, status] of forwardTransitions) {
    it(`advances forward from ${from} to ${to} and updates status`, () => {
      const initial = createInitialImportReviewState({
        status: statusForStage(from),
      });
      const next = advanceReviewStage(initial, to);
      expect(next.stage).toBe(to);
      expect(next.status).toBe(status);
      expect(next.reviewerNote).toBe("");
    });
  }

  for (const [from, to, status] of backwardTransitions) {
    it(`moves backward from ${from} to ${to} and updates status`, () => {
      const initial = createInitialImportReviewState({
        status: statusForStage(from),
      });
      const next = advanceReviewStage(initial, to);
      expect(next.stage).toBe(to);
      expect(next.status).toBe(status);
    });
  }

  it("returns the same state object for same-stage no-op", () => {
    const initial = createInitialImportReviewState({ status: "reviewing" });
    expect(advanceReviewStage(initial, "review")).toBe(initial);
  });

  it("preserves the reviewer note across transitions", () => {
    const initial: ReturnType<typeof createInitialImportReviewState> = {
      ...createInitialImportReviewState({ status: "reviewing" }),
      reviewerNote: "Looks fine.",
    };
    const next = advanceReviewStage(initial, "approve");
    expect(next.reviewerNote).toBe("Looks fine.");
  });

  const invalidJumps: ReadonlyArray<[ImportReviewStage, ImportReviewStage]> = [
    ["import", "approve"],
    ["import", "apply"],
    ["review", "apply"],
    ["apply", "review"],
    ["apply", "import"],
    ["approve", "import"],
  ];

  for (const [from, to] of invalidJumps) {
    it(`throws for invalid transition ${from} → ${to}`, () => {
      const initial = createInitialImportReviewState({
        status: statusForStage(from),
      });
      expect(() => advanceReviewStage(initial, to)).toThrow(
        /Invalid review stage transition/,
      );
    });
  }
});

describe("describeApplyGate", () => {
  it("allows apply when there is no score gate and no security sensitivity", () => {
    expect(
      describeApplyGate({
        qualityScore: 42,
        reviewerNote: "",
        policy: NO_GATE_POLICY,
        securitySensitive: false,
      }),
    ).toEqual({ allowed: true, reason: null, requiresNote: false });
  });

  it("blocks when the score is unknown but a gate is set", () => {
    expect(
      describeApplyGate({
        qualityScore: null,
        reviewerNote: "",
        policy: GATED_POLICY,
        securitySensitive: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "Quality score not yet available.",
      requiresNote: false,
    });
  });

  it("blocks when below minimum with a blank note and requireNote true", () => {
    const gate = describeApplyGate({
      qualityScore: 55,
      reviewerNote: "",
      policy: GATED_POLICY,
      securitySensitive: false,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.requiresNote).toBe(true);
    expect(gate.reason).toBe(
      "Score 55 is below minimum 70. A reviewer note is required to override.",
    );
  });

  it("treats whitespace-only notes as blank", () => {
    const gate = describeApplyGate({
      qualityScore: 55,
      reviewerNote: "   \t\n  ",
      policy: GATED_POLICY,
      securitySensitive: false,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.requiresNote).toBe(true);
  });

  it("allows override when below minimum with a non-blank note", () => {
    expect(
      describeApplyGate({
        qualityScore: 55,
        reviewerNote: "Acceptable for this spike.",
        policy: GATED_POLICY,
        securitySensitive: false,
      }),
    ).toEqual({ allowed: true, reason: null, requiresNote: true });
  });

  it("allows override when below minimum with requireNote false, even with a blank note", () => {
    expect(
      describeApplyGate({
        qualityScore: 55,
        reviewerNote: "",
        policy: GATED_POLICY_NO_NOTE_REQUIRED,
        securitySensitive: false,
      }),
    ).toEqual({ allowed: true, reason: null, requiresNote: true });
  });

  it("blocks security-sensitive imports when the note is blank", () => {
    const gate = describeApplyGate({
      qualityScore: 95,
      reviewerNote: "",
      policy: SENSITIVE_POLICY,
      securitySensitive: true,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.requiresNote).toBe(true);
    expect(gate.reason).toBe(
      "This import touches security-sensitive components. A reviewer note is required to apply.",
    );
  });

  it("allows security-sensitive imports when a note is provided", () => {
    expect(
      describeApplyGate({
        qualityScore: 95,
        reviewerNote: "Reviewed with security team.",
        policy: SENSITIVE_POLICY,
        securitySensitive: true,
      }),
    ).toEqual({ allowed: true, reason: null, requiresNote: true });
  });

  it("allows apply when the score meets the minimum and no sensitivity", () => {
    expect(
      describeApplyGate({
        qualityScore: 85,
        reviewerNote: "",
        policy: GATED_POLICY,
        securitySensitive: false,
      }),
    ).toEqual({ allowed: true, reason: null, requiresNote: false });
  });
});

function statusForStage(
  stage: ImportReviewStage,
): WorkspaceImportSessionStatus {
  switch (stage) {
    case "import":
      return "imported";
    case "review":
      return "reviewing";
    case "approve":
      return "approved";
    case "apply":
      return "applied";
  }
}
