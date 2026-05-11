import assert from "node:assert/strict";
import test from "node:test";
import { computeConfidenceReport } from "./confidence-scoring.js";
import type {
  ConfidenceScoringInput,
  ConfidenceGenerationMetricsInput,
} from "./confidence-scoring.js";
import type { WorkspaceJobDiagnostic } from "../contracts/index.js";

const makeDiagnostic = (
  severity: "error" | "warning" | "info",
): WorkspaceJobDiagnostic => ({
  code: `TEST_${severity.toUpperCase()}`,
  message: `test ${severity}`,
  suggestion: "fix it",
  stage: "validate.project",
  severity,
});

const makeGenerationMetrics = (): ConfidenceGenerationMetricsInput => ({
  fetchedNodes: 120,
  skippedHidden: 0,
  skippedPlaceholders: 0,
  screenElementCounts: [
    { screenId: "home", screenName: "Home", elements: 48 },
    { screenId: "checkout", screenName: "Checkout", elements: 61 },
  ],
  truncatedScreens: [],
  depthTruncatedScreens: [],
  degradedGeometryNodes: [],
  classificationFallbacks: [],
});

const makeInput = (): ConfidenceScoringInput => ({
  diagnostics: [],
  generationMetrics: makeGenerationMetrics(),
  componentMatch: {
    totalFigmaFamilies: 2,
    matched: 2,
    ambiguous: 0,
    unmatched: 0,
    entries: [
      {
        figmaFamilyKey: "button-family",
        figmaFamilyName: "Button",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 94,
      },
      {
        figmaFamilyKey: "card-family",
        figmaFamilyName: "Card",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 88,
      },
    ],
  },
  screenComponents: [
    { screenId: "home", componentIds: ["button-family"] },
    { screenId: "checkout", componentIds: ["card-family"] },
  ],
  visualQuality: { overallScore: 93 },
  storybookEvidence: {
    entryCount: 4,
    evidenceCount: 4,
    byReliability: {
      authoritative: 3,
      reference_only: 1,
      derived: 0,
    },
  },
  validationPassed: true,
});

test("confidence scoring uses diagnostics as a live signal", () => {
  const baseline = computeConfidenceReport(makeInput());
  const withDiagnostics = computeConfidenceReport({
    ...makeInput(),
    diagnostics: [makeDiagnostic("warning"), makeDiagnostic("error")],
  });

  assert.ok(withDiagnostics.score < baseline.score);
  const contributor = withDiagnostics.contributors.find(
    (entry) => entry.signal === "diagnostic_severity",
  );
  assert.equal(contributor?.detail, "1 errors, 1 warnings");
  assert.equal(contributor?.impact, "positive");
});

test("confidence scoring creates a screen result for every inventory screen", () => {
  const result = computeConfidenceReport({
    ...makeInput(),
    generationMetrics: {
      ...makeGenerationMetrics(),
      truncatedScreens: [
        {
          screenId: "checkout",
          screenName: "Checkout",
          originalElements: 61,
          retainedElements: 40,
        },
      ],
    },
  });

  assert.equal(result.screens.length, 2);
  assert.deepEqual(
    result.screens.map((screen) => screen.screenId),
    ["home", "checkout"],
  );
});

test("confidence scoring assigns components to their owning screens without duplication", () => {
  const result = computeConfidenceReport(makeInput());

  const home = result.screens.find((screen) => screen.screenId === "home");
  const checkout = result.screens.find(
    (screen) => screen.screenId === "checkout",
  );

  assert.deepEqual(
    home?.components.map((component) => component.componentId),
    ["button-family"],
  );
  assert.deepEqual(
    checkout?.components.map((component) => component.componentId),
    ["card-family"],
  );
});

test("screen scores reflect screen-local component confidence", () => {
  const result = computeConfidenceReport({
    ...makeInput(),
    componentMatch: {
      totalFigmaFamilies: 2,
      matched: 1,
      ambiguous: 0,
      unmatched: 1,
      entries: [
        {
          figmaFamilyKey: "button-family",
          figmaFamilyName: "Button",
          matchStatus: "matched",
          confidence: "high",
          confidenceScore: 96,
        },
        {
          figmaFamilyKey: "card-family",
          figmaFamilyName: "Card",
          matchStatus: "unmatched",
          confidence: "none",
          confidenceScore: 0,
        },
      ],
    },
  });

  const home = result.screens.find((screen) => screen.screenId === "home");
  const checkout = result.screens.find(
    (screen) => screen.screenId === "checkout",
  );

  assert.ok((home?.score ?? 0) > (checkout?.score ?? 0));
  assert.equal(home?.components[0]?.level, "high");
  assert.equal(checkout?.components[0]?.level, "very_low");
});

test("screen truncation only penalizes the affected screen", () => {
  const result = computeConfidenceReport({
    ...makeInput(),
    generationMetrics: {
      ...makeGenerationMetrics(),
      truncatedScreens: [
        {
          screenId: "checkout",
          screenName: "Checkout",
          originalElements: 61,
          retainedElements: 32,
        },
      ],
    },
  });

  const home = result.screens.find((screen) => screen.screenId === "home");
  const checkout = result.screens.find(
    (screen) => screen.screenId === "checkout",
  );

  assert.ok((home?.score ?? 0) > (checkout?.score ?? 0));
  assert.equal(
    checkout?.contributors.some(
      (contributor) => contributor.signal === "screen_truncation",
    ),
    true,
  );
});
