import assert from "node:assert/strict";
import test from "node:test";

import { analyzeContextBudget } from "./context-budget-analyzer.js";

const hash = (seed: string): string => seed.repeat(64).slice(0, 64);

const baseInput = () => ({
  jobId: "job-1768",
  roleStepId: "test_generation",
  modelBinding: "gpt-oss-120b@production-runner-1.0",
  maxInputTokens: 2_000,
  systemPrompt: "You are a deterministic test-design assistant.",
  responseSchema: {
    type: "object",
    properties: {
      testCases: { type: "array" },
    },
  },
  categories: [
    {
      kind: "business_intent_ir" as const,
      priority: "required" as const,
      promptPayload: "BUSINESS_TEST_INTENT_IR\n" + "A".repeat(2_000),
      artifactHashes: [hash("a")],
      compactible: false,
      droppable: false,
    },
    {
      kind: "source_context" as const,
      priority: "optional" as const,
      promptPayload: "SOURCE_CONTEXT\n" + "B".repeat(1_600),
      artifactHashes: [hash("b"), hash("c")],
      compactible: true,
      droppable: true,
    },
    {
      kind: "repair_history" as const,
      priority: "optional" as const,
      promptPayload: "REPAIR_HISTORY\n" + "C".repeat(1_600),
      artifactHashes: [hash("d")],
      compactible: true,
      droppable: true,
    },
  ],
});

test("context-budget analyzer returns none when the full prompt fits", () => {
  const result = analyzeContextBudget({
    ...baseInput(),
    maxInputTokens: 3_000,
    categories: [
      {
        kind: "business_intent_ir",
        priority: "required",
        promptPayload: "BUSINESS_TEST_INTENT_IR\nsmall",
        artifactHashes: [hash("a")],
        compactible: false,
        droppable: false,
      },
    ],
  });

  assert.equal(result.report.action, "none");
  assert.equal(result.report.categories[0]?.kind, "system_instructions");
  assert.equal(result.report.categories[1]?.status, "included");
  assert.equal(result.report.compactedFromArtifactHashes.length, 0);
});

test("context-budget analyzer compacts prompt payloads before dropping context", () => {
  const result = analyzeContextBudget({
    ...baseInput(),
    maxInputTokens: 800,
  });

  assert.equal(result.report.action, "compact_prompt_payload");
  assert.equal(
    result.report.categories.find((category) => category.kind === "repair_history")
      ?.status,
    "compacted",
  );
  assert.ok(result.report.compactedFromArtifactHashes.includes(hash("d")));
  assert.match(
    result.renderedUserPrompt,
    /REPAIR_HISTORY compacted from prompt payload due to context budget\./u,
  );
  assert.equal(result.renderedUserPrompt.includes("C".repeat(128)), false);
});

test("context-budget analyzer drops optional context when compaction is insufficient", () => {
  const result = analyzeContextBudget({
    ...baseInput(),
    maxInputTokens: 650,
    categories: [
      {
        kind: "business_intent_ir",
        priority: "required",
        promptPayload: "BUSINESS_TEST_INTENT_IR\n" + "A".repeat(1_600),
        artifactHashes: [hash("a")],
        compactible: false,
        droppable: false,
      },
      {
        kind: "source_context",
        priority: "optional",
        promptPayload: "SOURCE_CONTEXT\n" + "B".repeat(1_400),
        artifactHashes: [hash("b")],
        compactible: false,
        droppable: true,
      },
      {
        kind: "repair_history",
        priority: "optional",
        promptPayload: "REPAIR_HISTORY\n" + "C".repeat(1_200),
        artifactHashes: [hash("c")],
        compactible: true,
        droppable: true,
      },
    ],
  });

  assert.equal(result.report.action, "drop_optional_context");
  assert.equal(
    result.report.categories.find((category) => category.kind === "source_context")
      ?.status,
    "dropped",
  );
  assert.equal(result.renderedUserPrompt.includes("SOURCE_CONTEXT"), false);
});

test("context-budget analyzer returns needs_review when required context still cannot fit", () => {
  const result = analyzeContextBudget({
    ...baseInput(),
    maxInputTokens: 100,
    categories: [
      {
        kind: "business_intent_ir",
        priority: "required",
        promptPayload: "BUSINESS_TEST_INTENT_IR\n" + "A".repeat(4_000),
        artifactHashes: [hash("a")],
        compactible: false,
        droppable: false,
      },
    ],
  });

  assert.equal(result.report.action, "needs_review");
  assert.equal(result.report.categories[1]?.status, "included");
  assert.equal(result.report.compactedFromArtifactHashes.length, 0);
});

test("context-budget analyzer report excludes raw prompt payload", () => {
  const result = analyzeContextBudget({
    ...baseInput(),
    maxInputTokens: 1_200,
  });

  const serialized = JSON.stringify(result.report);
  assert.equal(serialized.includes("BUSINESS_TEST_INTENT_IR"), false);
  assert.equal(serialized.includes("SOURCE_CONTEXT"), false);
  assert.equal(serialized.includes("REPAIR_HISTORY"), false);
});
