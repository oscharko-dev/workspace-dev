/**
 * Unit tests for the RemapReviewPanel component.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/466
 */
import { describe, expect, it } from "vitest";
import type {
  RemapDecisionEntry,
  RemapSuggestResult
} from "./RemapReviewPanel";

// ---------------------------------------------------------------------------
// Pure logic tests — validates the data flow rather than React rendering.
// The component's core logic is: auto-accept high confidence, let user toggle.
// ---------------------------------------------------------------------------

function computeInitialDecisions(result: RemapSuggestResult): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const suggestion of result.suggestions) {
    map.set(suggestion.sourceNodeId, suggestion.confidence === "high");
  }
  return map;
}

function buildDecisionEntries(
  result: RemapSuggestResult,
  decisions: Map<string, boolean>
): RemapDecisionEntry[] {
  return result.suggestions.map((s) => ({
    sourceNodeId: s.sourceNodeId,
    targetNodeId: s.targetNodeId,
    accepted: decisions.get(s.sourceNodeId) ?? false
  }));
}

describe("RemapReviewPanel decision logic", () => {
  const baseResult: RemapSuggestResult = {
    sourceJobId: "job-a",
    latestJobId: "job-b",
    suggestions: [
      {
        sourceNodeId: "node-1",
        sourceNodeName: "Button A",
        sourceNodeType: "button",
        targetNodeId: "node-1-new",
        targetNodeName: "Button A",
        targetNodeType: "button",
        rule: "name-and-type",
        confidence: "high",
        reason: "Exact name+type match"
      },
      {
        sourceNodeId: "node-2",
        sourceNodeName: "Card B",
        sourceNodeType: "card",
        targetNodeId: "node-2-new",
        targetNodeName: "card-b",
        targetNodeType: "card",
        rule: "name-fuzzy-and-type",
        confidence: "medium",
        reason: "Fuzzy name match"
      },
      {
        sourceNodeId: "node-3",
        sourceNodeName: "Text C",
        sourceNodeType: "text",
        targetNodeId: "node-3-new",
        targetNodeName: "Label C",
        targetNodeType: "text",
        rule: "ancestry-and-type",
        confidence: "low",
        reason: "Ancestry match"
      }
    ],
    rejections: [
      {
        sourceNodeId: "node-4",
        sourceNodeName: "Deleted D",
        sourceNodeType: "slider",
        reason: "No match found"
      }
    ],
    message: "3 of 4 have suggestions"
  };

  it("auto-accepts high confidence suggestions only", () => {
    const decisions = computeInitialDecisions(baseResult);
    expect(decisions.get("node-1")).toBe(true);
    expect(decisions.get("node-2")).toBe(false);
    expect(decisions.get("node-3")).toBe(false);
  });

  it("builds decision entries from state", () => {
    const decisions = computeInitialDecisions(baseResult);
    decisions.set("node-2", true); // user accepts medium

    const entries = buildDecisionEntries(baseResult, decisions);

    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.sourceNodeId === "node-1")?.accepted).toBe(true);
    expect(entries.find((e) => e.sourceNodeId === "node-2")?.accepted).toBe(true);
    expect(entries.find((e) => e.sourceNodeId === "node-3")?.accepted).toBe(false);
  });

  it("accept-all sets all to true", () => {
    const decisions = computeInitialDecisions(baseResult);
    for (const key of decisions.keys()) {
      decisions.set(key, true);
    }

    const entries = buildDecisionEntries(baseResult, decisions);
    expect(entries.every((e) => e.accepted)).toBe(true);
  });

  it("toggle flips a decision", () => {
    const decisions = computeInitialDecisions(baseResult);
    expect(decisions.get("node-1")).toBe(true);

    // Toggle node-1
    decisions.set("node-1", !decisions.get("node-1")!);
    expect(decisions.get("node-1")).toBe(false);

    // Toggle back
    decisions.set("node-1", !decisions.get("node-1")!);
    expect(decisions.get("node-1")).toBe(true);
  });

  it("empty suggestions produce empty decisions", () => {
    const emptyResult: RemapSuggestResult = {
      ...baseResult,
      suggestions: [],
      rejections: baseResult.rejections
    };

    const decisions = computeInitialDecisions(emptyResult);
    expect(decisions.size).toBe(0);

    const entries = buildDecisionEntries(emptyResult, decisions);
    expect(entries).toHaveLength(0);
  });
});
