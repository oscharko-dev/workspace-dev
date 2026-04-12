import type { WorkspaceJobDiagnostic } from "../contracts/index.js";

// --- Input types ---

export interface ConfidenceGenerationMetricsInput {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  truncatedScreens: Array<{
    screenName: string;
    originalCount: number;
    truncatedCount: number;
  }>;
  depthTruncatedScreens?: Array<{ screenName: string; depthLimit: number }>;
  degradedGeometryNodes: string[];
  classificationFallbacks?: Array<{
    nodeId: string;
    original: string;
    fallback: string;
  }>;
}

export interface ConfidenceComponentMatchInput {
  totalFigmaFamilies: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  entries: Array<{
    figmaFamilyKey: string;
    figmaFamilyName: string;
    matchStatus: "matched" | "ambiguous" | "unmatched";
    confidence: "high" | "medium" | "low" | "none";
    confidenceScore: number;
  }>;
}

export interface ConfidenceVisualQualityInput {
  overallScore?: number;
  dimensions?: Array<{ name: string; score: number; weight: number }>;
  hotspots?: Array<{
    severity: "low" | "medium" | "high" | "critical";
    category: string;
  }>;
  componentAggregateScore?: number;
}

export interface ConfidenceStorybookEvidenceInput {
  entryCount: number;
  evidenceCount: number;
  byReliability: {
    authoritative: number;
    reference_only: number;
    derived: number;
  };
}

export interface ConfidenceScoringInput {
  diagnostics: WorkspaceJobDiagnostic[];
  generationMetrics?: ConfidenceGenerationMetricsInput;
  componentMatch?: ConfidenceComponentMatchInput;
  visualQuality?: ConfidenceVisualQualityInput;
  storybookEvidence?: ConfidenceStorybookEvidenceInput;
  validationPassed: boolean;
}

// --- Output types ---

export type ConfidenceLevel = "high" | "medium" | "low" | "very_low";

export interface ConfidenceContributor {
  signal: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  value: number;
  detail: string;
}

export interface ComponentConfidenceResult {
  componentId: string;
  componentName: string;
  level: ConfidenceLevel;
  score: number;
  contributors: ConfidenceContributor[];
}

export interface ScreenConfidenceResult {
  screenId: string;
  screenName: string;
  level: ConfidenceLevel;
  score: number;
  contributors: ConfidenceContributor[];
  components: ComponentConfidenceResult[];
}

export interface ConfidenceScoringResult {
  level: ConfidenceLevel;
  score: number;
  contributors: ConfidenceContributor[];
  screens: ScreenConfidenceResult[];
  lowConfidenceSummary: string[];
}

// --- Constants ---

const SIGNAL_WEIGHTS = {
  diagnostic_severity: 0.15,
  component_match_rate: 0.25,
  generation_integrity: 0.15,
  visual_quality: 0.25,
  storybook_evidence: 0.1,
  validation_passed: 0.1,
} as const;

const NEUTRAL_VALUE = 0.5;

const GENERATION_PENALTY_CAPS = {
  truncatedScreen: { per: 0.1, max: 0.5 },
  degradedGeometry: { per: 0.05, max: 0.3 },
  classificationFallback: { per: 0.03, max: 0.2 },
  depthTruncatedScreen: { per: 0.1, max: 0.3 },
} as const;

// --- Helpers ---

const round1 = (n: number): number => Math.round(n * 10) / 10;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const levelFromScore = (score: number): ConfidenceLevel => {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "very_low";
};

const impactFromValue = (
  value: number,
): "positive" | "negative" | "neutral" => {
  if (value > 0.6) return "positive";
  if (value < 0.4) return "negative";
  return "neutral";
};

// --- Signal computations ---

const computeDiagnosticSeverity = (
  diagnostics: ReadonlyArray<WorkspaceJobDiagnostic>,
): number => {
  let penalty = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") penalty += 0.15;
    else if (d.severity === "warning") penalty += 0.05;
  }
  return clamp01(1 - penalty);
};

const computeComponentMatchRate = (
  match: ConfidenceComponentMatchInput | undefined,
): number => {
  if (!match || match.entries.length === 0) return NEUTRAL_VALUE;
  const sum = match.entries.reduce(
    (acc, e) => acc + e.confidenceScore / 100,
    0,
  );
  return sum / match.entries.length;
};

const computeGenerationIntegrity = (
  metrics: ConfidenceGenerationMetricsInput | undefined,
): number => {
  if (!metrics) return NEUTRAL_VALUE;

  const truncationPenalty = Math.min(
    metrics.truncatedScreens.length *
      GENERATION_PENALTY_CAPS.truncatedScreen.per,
    GENERATION_PENALTY_CAPS.truncatedScreen.max,
  );
  const degradedPenalty = Math.min(
    metrics.degradedGeometryNodes.length *
      GENERATION_PENALTY_CAPS.degradedGeometry.per,
    GENERATION_PENALTY_CAPS.degradedGeometry.max,
  );
  const fallbackPenalty = Math.min(
    (metrics.classificationFallbacks?.length ?? 0) *
      GENERATION_PENALTY_CAPS.classificationFallback.per,
    GENERATION_PENALTY_CAPS.classificationFallback.max,
  );
  const depthPenalty = Math.min(
    (metrics.depthTruncatedScreens?.length ?? 0) *
      GENERATION_PENALTY_CAPS.depthTruncatedScreen.per,
    GENERATION_PENALTY_CAPS.depthTruncatedScreen.max,
  );

  return clamp01(
    1.0 - truncationPenalty - degradedPenalty - fallbackPenalty - depthPenalty,
  );
};

const computeVisualQuality = (
  quality: ConfidenceVisualQualityInput | undefined,
): number => {
  if (!quality || quality.overallScore === undefined) return NEUTRAL_VALUE;
  return quality.overallScore / 100;
};

const computeStorybookEvidence = (
  evidence: ConfidenceStorybookEvidenceInput | undefined,
): number => {
  if (!evidence || evidence.evidenceCount === 0) return NEUTRAL_VALUE;
  return evidence.byReliability.authoritative / evidence.evidenceCount;
};

const computeValidationPassed = (passed: boolean): number =>
  passed ? 1.0 : 0.0;

// --- Contributor building ---

interface SignalResult {
  signal: string;
  weight: number;
  value: number;
  detail: string;
}

const buildSignals = (input: ConfidenceScoringInput): SignalResult[] => [
  {
    signal: "diagnostic_severity",
    weight: SIGNAL_WEIGHTS.diagnostic_severity,
    value: computeDiagnosticSeverity(input.diagnostics),
    detail: `${String(input.diagnostics.filter((d) => d.severity === "error").length)} errors, ${String(input.diagnostics.filter((d) => d.severity === "warning").length)} warnings`,
  },
  {
    signal: "component_match_rate",
    weight: SIGNAL_WEIGHTS.component_match_rate,
    value: computeComponentMatchRate(input.componentMatch),
    detail: input.componentMatch
      ? `${String(input.componentMatch.matched)}/${String(input.componentMatch.totalFigmaFamilies)} matched`
      : "no component data",
  },
  {
    signal: "generation_integrity",
    weight: SIGNAL_WEIGHTS.generation_integrity,
    value: computeGenerationIntegrity(input.generationMetrics),
    detail: input.generationMetrics
      ? `${String(input.generationMetrics.truncatedScreens.length)} truncated, ${String(input.generationMetrics.degradedGeometryNodes.length)} degraded`
      : "no generation data",
  },
  {
    signal: "visual_quality",
    weight: SIGNAL_WEIGHTS.visual_quality,
    value: computeVisualQuality(input.visualQuality),
    detail:
      input.visualQuality?.overallScore !== undefined
        ? `overall ${String(input.visualQuality.overallScore)}/100`
        : "no visual data",
  },
  {
    signal: "storybook_evidence",
    weight: SIGNAL_WEIGHTS.storybook_evidence,
    value: computeStorybookEvidence(input.storybookEvidence),
    detail: input.storybookEvidence
      ? `${String(input.storybookEvidence.byReliability.authoritative)}/${String(input.storybookEvidence.evidenceCount)} authoritative`
      : "no storybook data",
  },
  {
    signal: "validation_passed",
    weight: SIGNAL_WEIGHTS.validation_passed,
    value: computeValidationPassed(input.validationPassed),
    detail: input.validationPassed ? "validation passed" : "validation failed",
  },
];

const signalsToContributors = (
  signals: ReadonlyArray<SignalResult>,
): ConfidenceContributor[] => {
  const contributors: ConfidenceContributor[] = signals.map((s) => ({
    signal: s.signal,
    impact: impactFromValue(s.value),
    weight: s.weight,
    value: s.value,
    detail: s.detail,
  }));

  return contributors.sort(
    (a, b) =>
      b.weight * Math.abs(1 - b.value) - a.weight * Math.abs(1 - a.value),
  );
};

// --- Screen- and component-level scoring ---

const buildScreenResults = (
  input: ConfidenceScoringInput,
  jobScore: number,
): ScreenConfidenceResult[] => {
  const screens: ScreenConfidenceResult[] = [];
  const truncatedSet = new Map<
    string,
    { originalCount: number; truncatedCount: number }
  >();
  const depthTruncatedSet = new Map<string, { depthLimit: number }>();

  if (input.generationMetrics) {
    for (const ts of input.generationMetrics.truncatedScreens) {
      truncatedSet.set(ts.screenName, {
        originalCount: ts.originalCount,
        truncatedCount: ts.truncatedCount,
      });
    }
    for (const ds of input.generationMetrics.depthTruncatedScreens ?? []) {
      depthTruncatedSet.set(ds.screenName, { depthLimit: ds.depthLimit });
    }
  }

  const allScreenNames = new Set<string>([
    ...truncatedSet.keys(),
    ...depthTruncatedSet.keys(),
  ]);

  for (const screenName of allScreenNames) {
    const contributors: ConfidenceContributor[] = [];
    let penalty = 0;

    const truncInfo = truncatedSet.get(screenName);
    if (truncInfo) {
      const truncPenalty = GENERATION_PENALTY_CAPS.truncatedScreen.per;
      penalty += truncPenalty;
      contributors.push({
        signal: "screen_truncation",
        impact: "negative",
        weight: SIGNAL_WEIGHTS.generation_integrity,
        value: 1 - truncPenalty,
        detail: `truncated from ${String(truncInfo.originalCount)} to ${String(truncInfo.truncatedCount)} nodes`,
      });
    }

    const depthInfo = depthTruncatedSet.get(screenName);
    if (depthInfo) {
      const depthPenalty = GENERATION_PENALTY_CAPS.depthTruncatedScreen.per;
      penalty += depthPenalty;
      contributors.push({
        signal: "screen_depth_truncation",
        impact: "negative",
        weight: SIGNAL_WEIGHTS.generation_integrity,
        value: 1 - depthPenalty,
        detail: `depth-truncated at limit ${String(depthInfo.depthLimit)}`,
      });
    }

    const screenScore = round1(Math.max(0, jobScore - penalty * 100));

    screens.push({
      screenId: screenName,
      screenName,
      level: levelFromScore(screenScore),
      score: screenScore,
      contributors,
      components: [],
    });
  }

  return screens;
};

const buildComponentResults = (
  match: ConfidenceComponentMatchInput | undefined,
): ComponentConfidenceResult[] => {
  if (!match) return [];

  return match.entries.map((entry) => {
    const score = round1(entry.confidenceScore);
    const contributors: ConfidenceContributor[] = [
      {
        signal: "component_match",
        impact: impactFromValue(entry.confidenceScore / 100),
        weight: 1.0,
        value: entry.confidenceScore / 100,
        detail: `${entry.matchStatus} (${entry.confidence})`,
      },
    ];

    return {
      componentId: entry.figmaFamilyKey,
      componentName: entry.figmaFamilyName,
      level: levelFromScore(score),
      score,
      contributors,
    };
  });
};

// --- Summary ---

const buildLowConfidenceSummary = (
  contributors: ReadonlyArray<ConfidenceContributor>,
): string[] => {
  return contributors
    .filter((c) => c.impact === "negative")
    .slice(0, 3)
    .map((c) => `${c.signal}: ${c.detail}`);
};

// --- Public API ---

export const computeConfidenceReport = (
  input: ConfidenceScoringInput,
): ConfidenceScoringResult => {
  const signals = buildSignals(input);
  const rawScore = signals.reduce((acc, s) => acc + s.value * s.weight, 0);
  const score = round1(rawScore * 100);
  const level = levelFromScore(score);
  const contributors = signalsToContributors(signals);

  const screens = buildScreenResults(input, score);

  const componentResults = buildComponentResults(input.componentMatch);
  for (const screen of screens) {
    screen.components = componentResults;
  }
  if (screens.length === 0 && componentResults.length > 0) {
    screens.push({
      screenId: "_default",
      screenName: "Default",
      level,
      score,
      contributors: [],
      components: componentResults,
    });
  }

  const lowConfidenceSummary = buildLowConfidenceSummary(contributors);

  return { level, score, contributors, screens, lowConfidenceSummary };
};
