import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { planSourceMix } from "./source-mix-planner.js";
import { selectTestDesignHeuristics } from "./test-design-heuristics.js";

const ISO = "2026-05-03T09:00:00.000Z";
const HEX = (seed: string): string => sha256Hex({ seed });

const figmaRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "figma_local_json",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
});

const jiraRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "jira_rest",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
  canonicalIssueKey: "PAY-42",
});

const markdownRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "custom_markdown",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
  redactedMarkdownHash: HEX(`${sourceId}:md`),
  plainTextDerivativeHash: HEX(`${sourceId}:plain`),
});

const buildEnvelope = (
  sources: readonly TestIntentSourceRef[],
): MultiSourceTestIntentEnvelope => ({
  version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  sources: [...sources],
  aggregateContentHash: HEX(sources.map((source) => source.sourceId).join("|")),
  conflictResolutionPolicy: "reviewer_decides",
});

test("selectTestDesignHeuristics returns common baseline heuristics without source mix", () => {
  const heuristics = selectTestDesignHeuristics();
  assert.deepEqual(heuristics.map((heuristic) => heuristic.heuristicId), [
    "screen_baseline_walkthrough",
  ]);
});

test("selectTestDesignHeuristics adds kind and prompt-section heuristics deterministically", () => {
  const sourceMixResult = planSourceMix(
    buildEnvelope([
      figmaRef("figma-primary"),
      jiraRef("jira-42"),
      markdownRef("notes-1"),
    ]),
  );
  assert.equal(sourceMixResult.ok, true);
  if (!sourceMixResult.ok) return;

  const heuristics = selectTestDesignHeuristics({
    sourceMixPlan: sourceMixResult.plan,
  });
  assert.deepEqual(heuristics.map((heuristic) => heuristic.heuristicId), [
    "screen_baseline_walkthrough",
    "stateful_visual_flow_probe",
    "jira_rule_matrix",
    "supporting_context_edge_probe",
    "cross_source_reconciliation",
  ]);
});

test("property: heuristic selection ignores source ordering for equivalent plans", () => {
  fc.assert(
    fc.property(fc.boolean(), (reverse) => {
      const sources = [
        figmaRef("figma-primary"),
        jiraRef("jira-42"),
        markdownRef("notes-1"),
      ];
      const envelope = buildEnvelope(reverse ? [...sources].reverse() : sources);
      const sourceMixResult = planSourceMix(envelope);
      assert.equal(sourceMixResult.ok, true);
      if (!sourceMixResult.ok) return;

      const selected = selectTestDesignHeuristics({
        sourceMixPlan: sourceMixResult.plan,
      });
      assert.deepEqual(selected.map((heuristic) => heuristic.heuristicId), [
        "screen_baseline_walkthrough",
        "stateful_visual_flow_probe",
        "jira_rule_matrix",
        "supporting_context_edge_probe",
        "cross_source_reconciliation",
      ]);
    }),
    { numRuns: 40 },
  );
});

test("property: supporting-context heuristics appear only when prompt sections include custom context", () => {
  fc.assert(
    fc.property(fc.boolean(), (includeMarkdown) => {
      const sources: TestIntentSourceRef[] = [
        figmaRef("figma-primary"),
        jiraRef("jira-42"),
      ];
      if (includeMarkdown) {
        sources.push(markdownRef("notes-1"));
      }
      const sourceMixResult = planSourceMix(buildEnvelope(sources));
      assert.equal(sourceMixResult.ok, true);
      if (!sourceMixResult.ok) return;

      const heuristicIds = selectTestDesignHeuristics({
        sourceMixPlan: sourceMixResult.plan,
      }).map((heuristic) => heuristic.heuristicId);
      assert.equal(
        heuristicIds.includes("supporting_context_edge_probe"),
        includeMarkdown,
      );
    }),
    { numRuns: 40 },
  );
});
