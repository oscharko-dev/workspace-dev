/**
 * Unit tests for the workspace quality/token/a11y policy resolver.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_POLICY,
  parseWorkspacePolicyPayload,
  resolveWorkspacePolicy,
} from "./workspace-policy";

describe("resolveWorkspacePolicy", () => {
  it("returns defaults when no input is supplied", () => {
    expect(resolveWorkspacePolicy()).toEqual(DEFAULT_WORKSPACE_POLICY);
    expect(resolveWorkspacePolicy(null)).toEqual(DEFAULT_WORKSPACE_POLICY);
    expect(resolveWorkspacePolicy(undefined)).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it("merges partial quality overrides without dropping defaults", () => {
    const resolved = resolveWorkspacePolicy({
      quality: {
        bandThresholds: { excellent: 95 },
        maxAcceptableDepth: 10,
      },
    });

    expect(resolved.quality.bandThresholds).toEqual({
      excellent: 95,
      good: 70,
      fair: 50,
    });
    expect(resolved.quality.maxAcceptableDepth).toBe(10);
    expect(resolved.quality.maxAcceptableNodes).toBe(
      DEFAULT_WORKSPACE_POLICY.quality.maxAcceptableNodes,
    );
    expect(resolved.quality.weights).toEqual(
      DEFAULT_WORKSPACE_POLICY.quality.weights,
    );
  });

  it("merges risk severity overrides", () => {
    const resolved = resolveWorkspacePolicy({
      quality: {
        riskSeverityOverrides: {
          "deep-nesting": "high",
          custom: "low",
        },
      },
    });
    expect(resolved.quality.riskSeverityOverrides).toEqual({
      "deep-nesting": "high",
      custom: "low",
    });
  });

  it("honours token policy disable + delta thresholds", () => {
    const resolved = resolveWorkspacePolicy({
      tokens: { disabled: true, maxConflictDelta: 5 },
    });
    expect(resolved.tokens.disabled).toBe(true);
    expect(resolved.tokens.maxConflictDelta).toBe(5);
    expect(resolved.tokens.autoAcceptConfidence).toBe(
      DEFAULT_WORKSPACE_POLICY.tokens.autoAcceptConfidence,
    );
  });

  it("upgrades to AAA and accepts disabled rule lists", () => {
    const resolved = resolveWorkspacePolicy({
      a11y: { wcagLevel: "AAA", disabledRules: ["missing-h1"] },
    });
    expect(resolved.a11y.wcagLevel).toBe("AAA");
    expect(resolved.a11y.disabledRules).toEqual(["missing-h1"]);
  });
});

describe("governance policy", () => {
  it("returns default governance values when omitted", () => {
    expect(resolveWorkspacePolicy({}).governance).toEqual(
      DEFAULT_WORKSPACE_POLICY.governance,
    );
    expect(resolveWorkspacePolicy().governance).toEqual(
      DEFAULT_WORKSPACE_POLICY.governance,
    );
  });

  it("merges override values without dropping defaults", () => {
    const resolved = resolveWorkspacePolicy({
      governance: {
        minQualityScoreToApply: 70,
        securitySensitivePatterns: ["password", "ssn"],
        requireNoteOnOverride: false,
      },
    });
    expect(resolved.governance.minQualityScoreToApply).toBe(70);
    expect(resolved.governance.securitySensitivePatterns).toEqual([
      "password",
      "ssn",
    ]);
    expect(resolved.governance.requireNoteOnOverride).toBe(false);
  });

  it("treats null minQualityScoreToApply as no gate", () => {
    const resolved = resolveWorkspacePolicy({
      governance: { minQualityScoreToApply: null },
    });
    expect(resolved.governance.minQualityScoreToApply).toBeNull();
    expect(resolved.governance.requireNoteOnOverride).toBe(
      DEFAULT_WORKSPACE_POLICY.governance.requireNoteOnOverride,
    );
  });
});

describe("parseWorkspacePolicyPayload", () => {
  it("falls back to defaults when the server payload has an invalid nested leaf", () => {
    const result = parseWorkspacePolicyPayload({
      policy: {
        quality: {
          maxAcceptableDepth: "zero",
        },
      },
    });

    expect(result.source).toBe("invalid-server-payload");
    expect(result.policy).toEqual(DEFAULT_WORKSPACE_POLICY);
    expect(result.warning).toContain("invalid");
    expect(result.validation).toEqual({
      state: "rejected",
      diagnostics: [],
    });
  });

  it("preserves valid partial policies and explicit degraded validation warnings", () => {
    const result = parseWorkspacePolicyPayload({
      policy: {
        governance: {
          securitySensitivePatterns: ["password"],
        },
        quality: {
          maxAcceptableDepth: 2,
        },
      },
      warning: "Regex-like governance patterns were dropped.",
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "GOVERNANCE_PATTERN_DROPPED",
            path: "governance.securitySensitivePatterns[1]",
            message: 'Dropped regex-like pattern "auth.".',
            valuePreview: "auth.",
          },
        ],
      },
    });

    expect(result.source).toBe("server");
    expect(result.warning).toBe("Regex-like governance patterns were dropped.");
    expect(result.validation).toEqual({
      state: "degraded",
      diagnostics: [
        {
          severity: "warning",
          code: "GOVERNANCE_PATTERN_DROPPED",
          path: "governance.securitySensitivePatterns[1]",
          message: 'Dropped regex-like pattern "auth.".',
          valuePreview: "auth.",
        },
      ],
    });
    expect(result.policy.quality.maxAcceptableDepth).toBe(2);
    expect(result.policy.governance.securitySensitivePatterns).toEqual([
      "password",
    ]);
    expect(result.policy.tokens).toEqual(DEFAULT_WORKSPACE_POLICY.tokens);
  });

  it("keeps defaults without warning when no server policy is present", () => {
    expect(parseWorkspacePolicyPayload({ policy: null })).toEqual({
      policy: DEFAULT_WORKSPACE_POLICY,
      source: "defaults",
      warning: null,
      validation: {
        state: "absent",
        diagnostics: [],
      },
    });
  });

  it("distinguishes rejected server policy from normal defaults", () => {
    const result = parseWorkspacePolicyPayload({
      policy: null,
      warning:
        "Workspace inspector policy file failed validation and was ignored.",
      validation: {
        state: "rejected",
        diagnostics: [
          {
            severity: "error",
            code: "QUALITY_MAX_DEPTH_INVALID",
            path: "quality.maxAcceptableDepth",
            message: "Expected a finite number at least 0.",
            valuePreview: "deep",
          },
        ],
      },
    });

    expect(result.policy).toEqual(DEFAULT_WORKSPACE_POLICY);
    expect(result.source).toBe("rejected-server-policy");
    expect(result.warning).toBe(
      "Workspace inspector policy file failed validation and was ignored.",
    );
    expect(result.validation).toEqual({
      state: "rejected",
      diagnostics: [
        {
          severity: "error",
          code: "QUALITY_MAX_DEPTH_INVALID",
          path: "quality.maxAcceptableDepth",
          message: "Expected a finite number at least 0.",
          valuePreview: "deep",
        },
      ],
    });
  });

  it("treats legacy warning-only payloads as degraded without discarding the policy", () => {
    const result = parseWorkspacePolicyPayload({
      policy: {
        quality: {
          maxAcceptableDepth: 2,
        },
      },
      warning: "Some policy entries were dropped.",
    });

    expect(result.source).toBe("server");
    expect(result.validation).toEqual({
      state: "degraded",
      diagnostics: [],
    });
    expect(result.policy.quality.maxAcceptableDepth).toBe(2);
    expect(result.warning).toBe("Some policy entries were dropped.");
  });

  it("ignores malformed validation sidecars and keeps a valid policy active", () => {
    const result = parseWorkspacePolicyPayload({
      policy: {
        quality: {
          maxAcceptableDepth: 2,
        },
      },
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "BAD_DIAGNOSTIC",
            message: "Missing path should invalidate the sidecar.",
          },
        ],
      },
    });

    expect(result.source).toBe("server");
    expect(result.policy.quality.maxAcceptableDepth).toBe(2);
    expect(result.validation).toEqual({
      state: "loaded",
      diagnostics: [],
    });
    expect(result.warning).toBeNull();
  });

  it("falls back to inferred rejected state when a null policy has malformed validation metadata", () => {
    const result = parseWorkspacePolicyPayload({
      policy: null,
      warning: "Workspace inspector policy file was ignored.",
      validation: {
        state: "wat",
        diagnostics: "bad",
      },
    });

    expect(result.source).toBe("rejected-server-policy");
    expect(result.policy).toEqual(DEFAULT_WORKSPACE_POLICY);
    expect(result.warning).toBe("Workspace inspector policy file was ignored.");
    expect(result.validation).toEqual({
      state: "rejected",
      diagnostics: [],
    });
  });
});
