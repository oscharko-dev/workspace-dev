import assert from "node:assert/strict";
import test from "node:test";
import { computeConfidenceReport } from "./confidence-scoring.js";
import type {
  ConfidenceScoringInput,
  ConfidenceComponentMatchInput,
  ConfidenceGenerationMetricsInput,
  ConfidenceStorybookEvidenceInput,
  ConfidenceVisualQualityInput,
} from "./confidence-scoring.js";
import type { WorkspaceJobDiagnostic } from "../contracts/index.js";

// --- Test helpers ---

const makeDiagnostic = (
  severity: "error" | "warning" | "info",
): WorkspaceJobDiagnostic => ({
  code: `TEST_${severity.toUpperCase()}`,
  message: `test ${severity}`,
  suggestion: "fix it",
  stage: "generate",
  severity,
});

const makeAllGreenInput = (): ConfidenceScoringInput => ({
  diagnostics: [],
  generationMetrics: {
    fetchedNodes: 100,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    truncatedScreens: [],
    depthTruncatedScreens: [],
    degradedGeometryNodes: [],
    classificationFallbacks: [],
  },
  componentMatch: {
    totalFigmaFamilies: 5,
    matched: 5,
    ambiguous: 0,
    unmatched: 0,
    entries: [
      {
        figmaFamilyKey: "btn",
        figmaFamilyName: "Button",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 95,
      },
      {
        figmaFamilyKey: "inp",
        figmaFamilyName: "Input",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 90,
      },
      {
        figmaFamilyKey: "card",
        figmaFamilyName: "Card",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 92,
      },
      {
        figmaFamilyKey: "nav",
        figmaFamilyName: "Nav",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 88,
      },
      {
        figmaFamilyKey: "modal",
        figmaFamilyName: "Modal",
        matchStatus: "matched",
        confidence: "high",
        confidenceScore: 85,
      },
    ],
  },
  visualQuality: { overallScore: 92 },
  storybookEvidence: {
    entryCount: 10,
    evidenceCount: 10,
    byReliability: { authoritative: 8, reference_only: 1, derived: 1 },
  },
  validationPassed: true,
});

// --- 1. all-green ---

test("confidence: all-green — all signals positive yields score >= 80 and level high", () => {
  const result = computeConfidenceReport(makeAllGreenInput());

  assert.ok(
    result.score >= 80,
    `expected score >= 80, got ${String(result.score)}`,
  );
  assert.equal(result.level, "high");
  assert.ok(result.contributors.length > 0);
});

// --- 2. degraded-geometry ---

test("confidence: degraded-geometry — 10 degraded nodes lower the score", () => {
  const input = makeAllGreenInput();
  input.generationMetrics = {
    ...input.generationMetrics!,
    degradedGeometryNodes: Array.from(
      { length: 10 },
      (_, i) => `node-${String(i)}`,
    ),
  };

  const baseline = computeConfidenceReport(makeAllGreenInput());
  const result = computeConfidenceReport(input);

  assert.ok(
    result.score < baseline.score,
    `expected score < ${String(baseline.score)}, got ${String(result.score)}`,
  );
});

// --- 3. low-component-match ---

test("confidence: low-component-match — all unmatched (score 0) drops score significantly", () => {
  const input = makeAllGreenInput();
  input.componentMatch = {
    totalFigmaFamilies: 5,
    matched: 0,
    ambiguous: 0,
    unmatched: 5,
    entries: [
      {
        figmaFamilyKey: "btn",
        figmaFamilyName: "Button",
        matchStatus: "unmatched",
        confidence: "none",
        confidenceScore: 0,
      },
      {
        figmaFamilyKey: "inp",
        figmaFamilyName: "Input",
        matchStatus: "unmatched",
        confidence: "none",
        confidenceScore: 0,
      },
      {
        figmaFamilyKey: "card",
        figmaFamilyName: "Card",
        matchStatus: "unmatched",
        confidence: "none",
        confidenceScore: 0,
      },
      {
        figmaFamilyKey: "nav",
        figmaFamilyName: "Nav",
        matchStatus: "unmatched",
        confidence: "none",
        confidenceScore: 0,
      },
      {
        figmaFamilyKey: "modal",
        figmaFamilyName: "Modal",
        matchStatus: "unmatched",
        confidence: "none",
        confidenceScore: 0,
      },
    ],
  };

  const baseline = computeConfidenceReport(makeAllGreenInput());
  const result = computeConfidenceReport(input);

  // component_match_rate has weight 0.25, dropping from ~0.9 to 0 is a 22.5-point swing
  assert.ok(
    result.score < baseline.score - 15,
    `expected significant drop, baseline ${String(baseline.score)}, got ${String(result.score)}`,
  );
});

// --- 4. missing-visual-quality ---

test("confidence: missing-visual-quality — no visual data uses 0.5 neutral", () => {
  const input = makeAllGreenInput();
  input.visualQuality = undefined;

  const result = computeConfidenceReport(input);

  const visualContributor = result.contributors.find(
    (c) => c.signal === "visual_quality",
  );
  assert.ok(visualContributor);
  assert.equal(visualContributor.value, 0.5);
  assert.equal(visualContributor.impact, "neutral");
});

// --- 5. missing-storybook ---

test("confidence: missing-storybook — no storybook data uses 0.5 neutral", () => {
  const input = makeAllGreenInput();
  input.storybookEvidence = undefined;

  const result = computeConfidenceReport(input);

  const sbContributor = result.contributors.find(
    (c) => c.signal === "storybook_evidence",
  );
  assert.ok(sbContributor);
  assert.equal(sbContributor.value, 0.5);
  assert.equal(sbContributor.impact, "neutral");
});

// --- 6. failed-validation ---

test("confidence: failed-validation — validationPassed=false applies 10% penalty", () => {
  const input = makeAllGreenInput();
  input.validationPassed = false;

  const baseline = computeConfidenceReport(makeAllGreenInput());
  const result = computeConfidenceReport(input);

  // validation_passed weight=0.10, value goes from 1.0 to 0.0 => 10-point drop
  assert.ok(
    result.score < baseline.score,
    `expected lower score, got ${String(result.score)} vs baseline ${String(baseline.score)}`,
  );

  const valContributor = result.contributors.find(
    (c) => c.signal === "validation_passed",
  );
  assert.ok(valContributor);
  assert.equal(valContributor.value, 0);
  assert.equal(valContributor.impact, "negative");
});

// --- 7. all-bad ---

test("confidence: all-bad — worst case yields level very_low", () => {
  const input: ConfidenceScoringInput = {
    diagnostics: [
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
    ],
    generationMetrics: {
      fetchedNodes: 10,
      skippedHidden: 5,
      skippedPlaceholders: 3,
      truncatedScreens: Array.from({ length: 6 }, (_, i) => ({
        screenName: `Screen${String(i)}`,
        originalCount: 100,
        truncatedCount: 50,
      })),
      depthTruncatedScreens: Array.from({ length: 4 }, (_, i) => ({
        screenName: `DepthScreen${String(i)}`,
        depthLimit: 3,
      })),
      degradedGeometryNodes: Array.from(
        { length: 10 },
        (_, i) => `node-${String(i)}`,
      ),
      classificationFallbacks: Array.from({ length: 8 }, (_, i) => ({
        nodeId: `fb-${String(i)}`,
        original: "button",
        fallback: "container",
      })),
    },
    componentMatch: {
      totalFigmaFamilies: 5,
      matched: 0,
      ambiguous: 0,
      unmatched: 5,
      entries: Array.from({ length: 5 }, (_, i) => ({
        figmaFamilyKey: `comp-${String(i)}`,
        figmaFamilyName: `Component${String(i)}`,
        matchStatus: "unmatched" as const,
        confidence: "none" as const,
        confidenceScore: 0,
      })),
    },
    visualQuality: { overallScore: 10 },
    storybookEvidence: {
      entryCount: 5,
      evidenceCount: 10,
      byReliability: { authoritative: 0, reference_only: 3, derived: 7 },
    },
    validationPassed: false,
  };

  const result = computeConfidenceReport(input);

  assert.equal(result.level, "very_low");
  assert.ok(
    result.score < 40,
    `expected score < 40, got ${String(result.score)}`,
  );
});

// --- 8. empty-diagnostics ---

test("confidence: empty-diagnostics — no diagnostics yields diagnostic_severity = 1.0", () => {
  const input = makeAllGreenInput();
  input.diagnostics = [];

  const result = computeConfidenceReport(input);

  const diagContributor = result.contributors.find(
    (c) => c.signal === "diagnostic_severity",
  );
  assert.ok(diagContributor);
  assert.equal(diagContributor.value, 1.0);
  assert.equal(diagContributor.impact, "positive");
});

// --- 9. truncated-screens ---

test("confidence: truncated-screens — 3 truncated screens penalise generation_integrity and create screen entries", () => {
  const input = makeAllGreenInput();
  input.generationMetrics = {
    ...input.generationMetrics!,
    truncatedScreens: [
      { screenName: "Home", originalCount: 200, truncatedCount: 100 },
      { screenName: "Profile", originalCount: 150, truncatedCount: 80 },
      { screenName: "Settings", originalCount: 180, truncatedCount: 90 },
    ],
  };

  const baseline = computeConfidenceReport(makeAllGreenInput());
  const result = computeConfidenceReport(input);

  assert.ok(result.score < baseline.score);

  // 3 truncated screens => 3 screen entries
  assert.equal(result.screens.length, 3);
  const screenNames = result.screens.map((s) => s.screenName).sort();
  assert.deepEqual(screenNames, ["Home", "Profile", "Settings"]);

  // Each screen should have a truncation contributor
  for (const screen of result.screens) {
    const truncContrib = screen.contributors.find(
      (c) => c.signal === "screen_truncation",
    );
    assert.ok(
      truncContrib,
      `screen ${screen.screenName} missing truncation contributor`,
    );
    assert.equal(truncContrib.impact, "negative");
  }
});

// --- 10. determinism ---

test("confidence: determinism — same input twice yields exact same output", () => {
  const input = makeAllGreenInput();

  const result1 = computeConfidenceReport(input);
  const result2 = computeConfidenceReport(input);

  assert.deepEqual(result1, result2);
});

// --- 11. score-rounding ---

test("confidence: score-rounding — score is rounded to 1 decimal place", () => {
  const input = makeAllGreenInput();
  const result = computeConfidenceReport(input);

  // round1(n) = Math.round(n * 10) / 10, so at most 1 decimal
  const decimalPart = String(result.score).split(".")[1];
  assert.ok(
    decimalPart === undefined || decimalPart.length <= 1,
    `expected at most 1 decimal, got ${String(result.score)}`,
  );

  // Verify the rounding formula directly
  const expectedRounded = Math.round(result.score * 10) / 10;
  assert.equal(result.score, expectedRounded);
});

// --- 12. contributor-ordering ---

test("confidence: contributor-ordering — sorted by absolute impact (weight * |1-value|) descending", () => {
  // Use a mixed input to get varied contributor values
  const input = makeAllGreenInput();
  input.validationPassed = false; // value=0 => impact = 0.10 * |1-0| = 0.10
  input.visualQuality = { overallScore: 30 }; // value=0.3 => impact = 0.25 * |1-0.3| = 0.175

  const result = computeConfidenceReport(input);

  for (let i = 0; i < result.contributors.length - 1; i++) {
    const currentImpact =
      result.contributors[i]!.weight *
      Math.abs(1 - result.contributors[i]!.value);
    const nextImpact =
      result.contributors[i + 1]!.weight *
      Math.abs(1 - result.contributors[i + 1]!.value);
    assert.ok(
      currentImpact >= nextImpact,
      `contributor ${String(i)} impact ${String(currentImpact)} should be >= contributor ${String(i + 1)} impact ${String(nextImpact)}`,
    );
  }
});

// --- 13. low-confidence-summary ---

test("confidence: low-confidence-summary — top 3 negative contributors as human-readable strings", () => {
  const input: ConfidenceScoringInput = {
    diagnostics: [
      makeDiagnostic("error"),
      makeDiagnostic("error"),
      makeDiagnostic("error"),
    ],
    generationMetrics: {
      fetchedNodes: 10,
      skippedHidden: 0,
      skippedPlaceholders: 0,
      truncatedScreens: [
        { screenName: "A", originalCount: 100, truncatedCount: 50 },
      ],
      degradedGeometryNodes: ["n1", "n2", "n3", "n4", "n5", "n6"],
      classificationFallbacks: [],
    },
    componentMatch: {
      totalFigmaFamilies: 3,
      matched: 0,
      ambiguous: 0,
      unmatched: 3,
      entries: [
        {
          figmaFamilyKey: "a",
          figmaFamilyName: "A",
          matchStatus: "unmatched",
          confidence: "none",
          confidenceScore: 0,
        },
        {
          figmaFamilyKey: "b",
          figmaFamilyName: "B",
          matchStatus: "unmatched",
          confidence: "none",
          confidenceScore: 0,
        },
        {
          figmaFamilyKey: "c",
          figmaFamilyName: "C",
          matchStatus: "unmatched",
          confidence: "none",
          confidenceScore: 0,
        },
      ],
    },
    visualQuality: { overallScore: 20 },
    storybookEvidence: {
      entryCount: 5,
      evidenceCount: 5,
      byReliability: { authoritative: 0, reference_only: 5, derived: 0 },
    },
    validationPassed: false,
  };

  const result = computeConfidenceReport(input);

  assert.ok(
    result.lowConfidenceSummary.length <= 3,
    `expected at most 3 items, got ${String(result.lowConfidenceSummary.length)}`,
  );
  assert.ok(
    result.lowConfidenceSummary.length > 0,
    "expected at least 1 negative summary entry",
  );

  // Each entry follows "signal: detail" format
  for (const entry of result.lowConfidenceSummary) {
    assert.ok(
      entry.includes(":"),
      `summary entry should contain colon: "${entry}"`,
    );
  }

  // All entries correspond to negative contributors
  const negativeSignals = result.contributors
    .filter((c) => c.impact === "negative")
    .map((c) => c.signal);
  for (const entry of result.lowConfidenceSummary) {
    const signal = entry.split(":")[0]!;
    assert.ok(
      negativeSignals.includes(signal),
      `summary signal "${signal}" should be a negative contributor`,
    );
  }
});

// --- 14. component-level ---

test("confidence: component-level — per-component scores and levels from match entries", () => {
  const input = makeAllGreenInput();
  input.generationMetrics = {
    ...input.generationMetrics!,
    truncatedScreens: [
      { screenName: "Main", originalCount: 100, truncatedCount: 50 },
    ],
  };

  const result = computeConfidenceReport(input);

  // Screens exist from truncatedScreens
  assert.ok(result.screens.length >= 1);
  const screen = result.screens[0]!;
  assert.equal(screen.components.length, 5);

  // Verify each component has correct score and level mapping
  for (const comp of screen.components) {
    assert.ok(comp.score >= 0 && comp.score <= 100);
    assert.ok(["high", "medium", "low", "very_low"].includes(comp.level));
    assert.ok(comp.contributors.length > 0);

    // Level should match score thresholds
    if (comp.score >= 80) assert.equal(comp.level, "high");
    else if (comp.score >= 60) assert.equal(comp.level, "medium");
    else if (comp.score >= 40) assert.equal(comp.level, "low");
    else assert.equal(comp.level, "very_low");
  }

  // Check specific component names match input
  const compNames = screen.components.map((c) => c.componentName).sort();
  assert.deepEqual(compNames, ["Button", "Card", "Input", "Modal", "Nav"]);
});

// --- 15. single-component-screen ---

test("confidence: single-component-screen — edge case with 1 truncated screen and 1 component", () => {
  const input: ConfidenceScoringInput = {
    diagnostics: [],
    generationMetrics: {
      fetchedNodes: 20,
      skippedHidden: 0,
      skippedPlaceholders: 0,
      truncatedScreens: [
        { screenName: "Solo", originalCount: 50, truncatedCount: 25 },
      ],
      degradedGeometryNodes: [],
      classificationFallbacks: [],
    },
    componentMatch: {
      totalFigmaFamilies: 1,
      matched: 1,
      ambiguous: 0,
      unmatched: 0,
      entries: [
        {
          figmaFamilyKey: "only-btn",
          figmaFamilyName: "OnlyButton",
          matchStatus: "matched",
          confidence: "high",
          confidenceScore: 80,
        },
      ],
    },
    visualQuality: { overallScore: 75 },
    storybookEvidence: {
      entryCount: 1,
      evidenceCount: 1,
      byReliability: { authoritative: 1, reference_only: 0, derived: 0 },
    },
    validationPassed: true,
  };

  const result = computeConfidenceReport(input);

  assert.equal(result.screens.length, 1);
  assert.equal(result.screens[0]!.screenName, "Solo");
  assert.equal(result.screens[0]!.components.length, 1);
  assert.equal(result.screens[0]!.components[0]!.componentName, "OnlyButton");
  assert.equal(result.screens[0]!.components[0]!.score, 80);
  assert.equal(result.screens[0]!.components[0]!.level, "high");

  // Screen score should be job score minus truncation penalty (0.1 * 100 = 10)
  assert.ok(
    result.screens[0]!.score < result.score,
    "screen score should be below job score due to truncation",
  );
});
