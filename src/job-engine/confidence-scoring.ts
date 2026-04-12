import type { WorkspaceJobDiagnostic } from "../contracts/index.js";

// --- Input types ---

export interface ConfidenceGenerationMetricsInput {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  screenElementCounts: Array<{
    screenId: string;
    screenName: string;
    elements: number;
  }>;
  truncatedScreens: Array<{
    screenId: string;
    screenName: string;
    originalElements: number;
    retainedElements: number;
  }>;
  depthTruncatedScreens?: Array<{
    screenId: string;
    screenName: string;
    maxDepth: number;
    firstTruncatedDepth: number;
    truncatedBranchCount: number;
  }>;
  degradedGeometryNodes: string[];
  classificationFallbacks?: Array<{
    nodeId: string;
    original: string;
    fallback: string;
  }>;
}

export interface ConfidenceComponentMatchEntryInput {
  figmaFamilyKey: string;
  figmaFamilyName: string;
  matchStatus: "matched" | "ambiguous" | "unmatched";
  confidence: "high" | "medium" | "low" | "none";
  confidenceScore: number;
  aliases?: string[];
}

export interface ConfidenceComponentMatchInput {
  totalFigmaFamilies: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  entries: ConfidenceComponentMatchEntryInput[];
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

export interface ConfidenceScreenComponentOwnershipInput {
  screenId: string;
  componentIds: string[];
}

export interface ConfidenceScoringInput {
  diagnostics: WorkspaceJobDiagnostic[];
  generationMetrics?: ConfidenceGenerationMetricsInput;
  componentMatch?: ConfidenceComponentMatchInput;
  screenComponents?: ConfidenceScreenComponentOwnershipInput[];
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

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

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

const average = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return NEUTRAL_VALUE;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    (acc, entry) => acc + entry.confidenceScore / 100,
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
  const contributors: ConfidenceContributor[] = signals.map((signal) => ({
    signal: signal.signal,
    impact: impactFromValue(signal.value),
    weight: signal.weight,
    value: signal.value,
    detail: signal.detail,
  }));

  return contributors.sort(
    (left, right) =>
      right.weight * Math.abs(1 - right.value) -
      left.weight * Math.abs(1 - left.value),
  );
};

// --- Screen- and component-level scoring ---

interface ScreenInventoryEntry {
  screenId: string;
  screenName: string;
}

const buildScreenInventory = (
  input: ConfidenceScoringInput,
): ScreenInventoryEntry[] => {
  const ordered: ScreenInventoryEntry[] = [];
  const byId = new Map<string, ScreenInventoryEntry>();
  const add = (screenId: string, screenName?: string): void => {
    const trimmedId = screenId.trim();
    if (trimmedId.length === 0) {
      return;
    }
    const trimmedName = screenName?.trim();
    const existing = byId.get(trimmedId);
    if (existing) {
      if (
        (!existing.screenName || existing.screenName === existing.screenId) &&
        trimmedName &&
        trimmedName.length > 0
      ) {
        existing.screenName = trimmedName;
      }
      return;
    }
    const entry = {
      screenId: trimmedId,
      screenName:
        trimmedName && trimmedName.length > 0 ? trimmedName : trimmedId,
    };
    byId.set(trimmedId, entry);
    ordered.push(entry);
  };

  for (const screen of input.generationMetrics?.screenElementCounts ?? []) {
    add(screen.screenId, screen.screenName);
  }
  for (const screen of input.generationMetrics?.truncatedScreens ?? []) {
    add(screen.screenId, screen.screenName);
  }
  for (const screen of input.generationMetrics?.depthTruncatedScreens ?? []) {
    add(screen.screenId, screen.screenName);
  }
  const ownership = [...(input.screenComponents ?? [])].sort((left, right) =>
    left.screenId.localeCompare(right.screenId),
  );
  for (const screen of ownership) {
    add(screen.screenId, screen.screenId);
  }

  return ordered;
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

const buildScreenResults = (
  input: ConfidenceScoringInput,
  jobScore: number,
  jobComponentValue: number,
  componentResults: ReadonlyArray<ComponentConfidenceResult>,
): ScreenConfidenceResult[] => {
  const inventory = buildScreenInventory(input);
  if (inventory.length === 0) {
    return [];
  }

  const componentResultsById = new Map(
    componentResults.map((component) => [component.componentId, component] as const),
  );
  const ownershipByScreenId = new Map<string, string[]>();
  for (const screen of input.screenComponents ?? []) {
    ownershipByScreenId.set(
      screen.screenId,
      [...new Set(screen.componentIds)].filter((componentId) =>
        componentResultsById.has(componentId),
      ),
    );
  }

  const truncatedByScreenId = new Map(
    (input.generationMetrics?.truncatedScreens ?? []).map((screen) => [
      screen.screenId,
      screen,
    ] as const),
  );
  const depthTruncatedByScreenId = new Map(
    (input.generationMetrics?.depthTruncatedScreens ?? []).map((screen) => [
      screen.screenId,
      screen,
    ] as const),
  );

  const baseScoreWithoutComponentSignal =
    jobScore - jobComponentValue * SIGNAL_WEIGHTS.component_match_rate * 100;

  return inventory.map((screen) => {
    const contributors: ConfidenceContributor[] = [];
    const components = (ownershipByScreenId.get(screen.screenId) ?? [])
      .map((componentId) => componentResultsById.get(componentId))
      .filter((component): component is ComponentConfidenceResult => Boolean(component));

    const localComponentValue =
      components.length > 0
        ? average(components.map((component) => component.score / 100))
        : jobComponentValue;

    if (input.componentMatch) {
      contributors.push({
        signal: "screen_component_match_rate",
        impact: impactFromValue(localComponentValue),
        weight: SIGNAL_WEIGHTS.component_match_rate,
        value: localComponentValue,
        detail:
          components.length > 0
            ? `${String(components.length)} mapped component(s), average ${String(round1(localComponentValue * 100))}/100`
            : "no screen-specific component mapping; using job-level component match rate",
      });
    }

    let penalty = 0;

    const truncation = truncatedByScreenId.get(screen.screenId);
    if (truncation) {
      const truncationPenalty = GENERATION_PENALTY_CAPS.truncatedScreen.per;
      penalty += truncationPenalty;
      contributors.push({
        signal: "screen_truncation",
        impact: "negative",
        weight: SIGNAL_WEIGHTS.generation_integrity,
        value: 1 - truncationPenalty,
        detail: `truncated from ${String(truncation.originalElements)} to ${String(truncation.retainedElements)} elements`,
      });
    }

    const depthTruncation = depthTruncatedByScreenId.get(screen.screenId);
    if (depthTruncation) {
      const depthPenalty = GENERATION_PENALTY_CAPS.depthTruncatedScreen.per;
      penalty += depthPenalty;
      contributors.push({
        signal: "screen_depth_truncation",
        impact: "negative",
        weight: SIGNAL_WEIGHTS.generation_integrity,
        value: 1 - depthPenalty,
        detail: `${String(depthTruncation.truncatedBranchCount)} branch(es) truncated at max depth ${String(depthTruncation.maxDepth)}`,
      });
    }

    const screenScore = round1(
      clamp100(
        baseScoreWithoutComponentSignal +
          localComponentValue * SIGNAL_WEIGHTS.component_match_rate * 100 -
          penalty * 100,
      ),
    );

    return {
      screenId: screen.screenId,
      screenName: screen.screenName,
      level: levelFromScore(screenScore),
      score: screenScore,
      contributors,
      components,
    };
  });
};

// --- Summary ---

const buildLowConfidenceSummary = (
  contributors: ReadonlyArray<ConfidenceContributor>,
): string[] => {
  return contributors
    .filter((contributor) => contributor.impact === "negative")
    .slice(0, 3)
    .map((contributor) => `${contributor.signal}: ${contributor.detail}`);
};

// --- Public API ---

export const computeConfidenceReport = (
  input: ConfidenceScoringInput,
): ConfidenceScoringResult => {
  const signals = buildSignals(input);
  const rawScore = signals.reduce(
    (sum, signal) => sum + signal.value * signal.weight,
    0,
  );
  const score = round1(rawScore * 100);
  const level = levelFromScore(score);
  const contributors = signalsToContributors(signals);

  const componentSignal =
    signals.find((signal) => signal.signal === "component_match_rate")?.value ??
    NEUTRAL_VALUE;
  const componentResults = buildComponentResults(input.componentMatch);
  const screens = buildScreenResults(
    input,
    score,
    componentSignal,
    componentResults,
  );
  const lowConfidenceSummary = buildLowConfidenceSummary(contributors);

  return { level, score, contributors, screens, lowConfidenceSummary };
};
