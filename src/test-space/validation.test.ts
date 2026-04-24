import assert from "node:assert/strict";
import test from "node:test";
import {
  TestSpaceLlmOutputSchema,
  TestSpaceRunRequestSchema,
  formatTestSpaceValidationError,
} from "./validation.js";

test("Test Space request schema accepts valid local JSON input and trims fields", () => {
  const result = TestSpaceRunRequestSchema.safeParse({
    figmaSourceMode: " local_json ",
    figmaJsonPayload: "{\"document\":{}}",
    testSuiteName: "  Business coverage  ",
    businessContext: {
      summary: "  Customer onboarding flow  ",
      productName: "  Retail Portal  ",
      audience: "  Support agents  ",
      goals: ["  Reduce time-to-complete  "],
      constraints: ["  Must remain accessible  "],
      notes: "  Keep the run deterministic  ",
    },
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPayload, "{\"document\":{}}");
    assert.equal(result.data.testSuiteName, "Business coverage");
    assert.deepEqual(result.data.businessContext, {
      summary: "Customer onboarding flow",
      productName: "Retail Portal",
      audience: "Support agents",
      goals: ["Reduce time-to-complete"],
      constraints: ["Must remain accessible"],
      notes: "Keep the run deterministic",
    });
  }
});

test("Test Space request schema rejects invalid shapes with stable issues", () => {
  const result = TestSpaceRunRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    businessContext: {
      summary: "",
      extra: "ignored",
    },
    figmaJsonPayload: "\"primitive\"",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(formatTestSpaceValidationError(result.error), {
      error: "VALIDATION_ERROR",
      message: "Request validation failed.",
      issues: [
        {
          path: "figmaJsonPayload",
          message: "figmaJsonPayload must contain a JSON object or array.",
        },
        {
          path: "businessContext.extra",
          message: "Unexpected property 'extra'.",
        },
        {
          path: "businessContext.summary",
          message: "summary must not be empty.",
        },
        {
          path: "figmaJsonPath",
          message:
            "figmaJsonPath or figmaJsonPayload is required for Test Space runs.",
        },
      ],
    });
  }
});

test("Test Space request schema rejects rest mode without a local JSON payload or path", () => {
  const result = TestSpaceRunRequestSchema.safeParse({
    figmaSourceMode: "rest",
    figmaFileKey: "abc123",
    businessContext: {
      summary: "Customer onboarding flow",
    },
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(formatTestSpaceValidationError(result.error).issues, [
      {
        path: "figmaJsonPath",
        message:
          "figmaJsonPath or figmaJsonPayload is required for Test Space runs.",
      },
    ]);
  }
});

test("Test Space LLM output schema accepts validated cases and findings", () => {
  const result = TestSpaceLlmOutputSchema.safeParse({
    testCases: [
      {
        id: "TC-001",
        title: "Happy path",
        priority: "P0",
        type: "happy_path",
        preconditions: ["User is authenticated"],
        steps: [
          {
            order: 1,
            action: "Open the screen",
            expectedResult: "The screen loads",
          },
        ],
        expectedResult: "User completes the flow",
        coverageTags: ["smoke"],
      },
    ],
    coverageFindings: [
      {
        id: "CF-001",
        severity: "low",
        message: "Missing edge-state coverage.",
        recommendation: "Add one negative test.",
        relatedCaseIds: ["TC-001"],
      },
    ],
  });

  assert.equal(result.success, true);
});

test("Test Space LLM output schema rejects invalid nested case structures", () => {
  const result = TestSpaceLlmOutputSchema.safeParse({
    testCases: [
      {
        id: "TC-001",
        title: "Broken",
        priority: "P9",
        type: "unknown",
        steps: [],
        expectedResult: "",
        coverageTags: [],
      },
    ],
    coverageFindings: "nope",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["testCases", 0, "expectedResult"],
        message: "expectedResult must not be empty.",
      },
      {
        path: ["testCases", 0, "priority"],
        message: "priority must be one of: P0, P1, P2.",
      },
      {
        path: ["testCases", 0, "type"],
        message:
          "type must be one of: happy_path, validation, edge_case, regression.",
      },
      {
        path: ["testCases", 0, "steps"],
        message: "steps must be a non-empty array.",
      },
      {
        path: ["coverageFindings"],
        message: "coverageFindings must be an array when provided.",
      },
    ]);
  }
});
