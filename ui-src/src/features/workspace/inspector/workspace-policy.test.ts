/**
 * Unit tests for the workspace quality/token/a11y policy resolver.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_POLICY,
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
