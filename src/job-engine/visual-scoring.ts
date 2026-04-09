import type { VisualDiffRegionResult, VisualDiffResult } from "./visual-diff.js";

export interface VisualScoringWeights {
  layoutAccuracy: number;
  colorFidelity: number;
  typography: number;
  componentStructure: number;
  spacingAlignment: number;
}

export interface VisualScoringConfig {
  weights: VisualScoringWeights;
  hotspotCount: number;
}

export interface VisualDimensionScore {
  name: string;
  weight: number;
  score: number;
  details: string;
}

export interface VisualDeviationHotspot {
  rank: number;
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
  deviationPercent: number;
  severity: "low" | "medium" | "high" | "critical";
  category: "layout" | "color" | "typography" | "component" | "spacing";
}

export interface VisualComparisonMetadata {
  comparedAt: string;
  imageWidth: number;
  imageHeight: number;
  totalPixels: number;
  diffPixelCount: number;
  configuredWeights: VisualScoringWeights;
}

export interface VisualQualityReport {
  overallScore: number;
  interpretation: string;
  dimensions: VisualDimensionScore[];
  hotspots: VisualDeviationHotspot[];
  metadata: VisualComparisonMetadata;
}

export const DEFAULT_SCORING_WEIGHTS: VisualScoringWeights = {
  layoutAccuracy: 0.30,
  colorFidelity: 0.25,
  typography: 0.20,
  componentStructure: 0.15,
  spacingAlignment: 0.10,
};

export const DEFAULT_SCORING_CONFIG: VisualScoringConfig = {
  weights: { ...DEFAULT_SCORING_WEIGHTS },
  hotspotCount: 5,
};

const roundToTwoDecimals = (value: number): number =>
  Math.round(value * 100) / 100;

export const interpretScore = (score: number): string => {
  if (score >= 90) return "Excellent parity — minor sub-pixel or anti-aliasing differences";
  if (score >= 70) return "Good parity — small layout or color deviations";
  if (score >= 50) return "Moderate deviations — visible differences in structure or styling";
  return "Significant deviations — major layout or component mismatches";
};

const resolveScoringConfig = (partial?: Partial<VisualScoringConfig>): VisualScoringConfig => {
  if (!partial) {
    return { ...DEFAULT_SCORING_CONFIG, weights: { ...DEFAULT_SCORING_WEIGHTS } };
  }
  const weights: VisualScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...(partial.weights ?? {}) };
  const sum =
    weights.layoutAccuracy +
    weights.colorFidelity +
    weights.typography +
    weights.componentStructure +
    weights.spacingAlignment;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Scoring weights must sum to 1.0. Received ${String(sum)}.`);
  }
  return {
    weights,
    hotspotCount: partial.hotspotCount ?? DEFAULT_SCORING_CONFIG.hotspotCount,
  };
};

const computeLayoutAccuracy = (regions: VisualDiffRegionResult[], fallback: number): number => {
  if (regions.length === 0) return roundToTwoDecimals(fallback);
  const totalRegionPixels = regions.reduce((acc, r) => acc + r.totalPixels, 0);
  if (totalRegionPixels === 0) return roundToTwoDecimals(fallback);
  const weighted = regions.reduce((acc, r) => {
    const regionScore = 100 - r.deviationPercent;
    return acc + regionScore * (r.totalPixels / totalRegionPixels);
  }, 0);
  return roundToTwoDecimals(weighted);
};

const computeColorFidelity = (similarityScore: number): number =>
  roundToTwoDecimals(similarityScore);

const computeTypography = (regions: VisualDiffRegionResult[], fallback: number): number => {
  const contentRegions = regions.filter(
    (r) =>
      r.name === "content-left" ||
      r.name === "content-center" ||
      r.name === "content-right",
  );
  if (contentRegions.length === 0) return roundToTwoDecimals(fallback);
  const totalPixels = contentRegions.reduce((acc, r) => acc + r.totalPixels, 0);
  if (totalPixels === 0) return roundToTwoDecimals(fallback);
  const weighted = contentRegions.reduce((acc, r) => {
    const regionScore = 100 - r.deviationPercent;
    return acc + regionScore * (r.totalPixels / totalPixels);
  }, 0);
  return roundToTwoDecimals(weighted);
};

const computeComponentStructure = (regions: VisualDiffRegionResult[], fallback: number): number => {
  if (regions.length <= 1) return roundToTwoDecimals(fallback);
  const scores = regions.map((r) => 100 - r.deviationPercent);
  const mean = scores.reduce((acc, s) => acc + s, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  return roundToTwoDecimals(100 - Math.min(100, stdDev * 2));
};

const computeSpacingAlignment = (regions: VisualDiffRegionResult[], fallback: number): number => {
  const edgeRegions = regions.filter(
    (r) => r.name === "header" || r.name === "footer",
  );
  if (edgeRegions.length === 0) return roundToTwoDecimals(fallback);
  const avg =
    edgeRegions.reduce((acc, r) => acc + (100 - r.deviationPercent), 0) /
    edgeRegions.length;
  return roundToTwoDecimals(avg);
};

const classifySeverity = (
  deviationPercent: number,
): "low" | "medium" | "high" | "critical" => {
  if (deviationPercent >= 50) return "critical";
  if (deviationPercent >= 20) return "high";
  if (deviationPercent >= 5) return "medium";
  return "low";
};

const classifyCategory = (
  regionName: string,
): "layout" | "color" | "typography" | "component" | "spacing" => {
  if (regionName === "header" || regionName === "footer") return "spacing";
  if (
    regionName === "content-left" ||
    regionName === "content-center" ||
    regionName === "content-right"
  ) {
    return "layout";
  }
  return "color";
};

const detectHotspots = (
  regions: VisualDiffRegionResult[],
  count: number,
): VisualDeviationHotspot[] => {
  const sorted = [...regions]
    .filter((r) => r.deviationPercent > 0)
    .sort((a, b) => b.deviationPercent - a.deviationPercent);
  return sorted.slice(0, count).map((r, i) => ({
    rank: i + 1,
    region: r.name,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    deviationPercent: roundToTwoDecimals(r.deviationPercent),
    severity: classifySeverity(r.deviationPercent),
    category: classifyCategory(r.name),
  }));
};

export const computeVisualQualityReport = (input: {
  diffResult: VisualDiffResult;
  config?: Partial<VisualScoringConfig>;
  comparedAt?: string;
}): VisualQualityReport => {
  const config = resolveScoringConfig(input.config);
  const { diffResult } = input;
  const { regions, similarityScore } = diffResult;
  const fallback = similarityScore;

  const layoutScore = computeLayoutAccuracy(regions, fallback);
  const colorScore = computeColorFidelity(similarityScore);
  const typographyScore = computeTypography(regions, fallback);
  const componentScore = computeComponentStructure(regions, fallback);
  const spacingScore = computeSpacingAlignment(regions, fallback);

  const dimensions: VisualDimensionScore[] = [
    {
      name: "Layout Accuracy",
      weight: config.weights.layoutAccuracy,
      score: layoutScore,
      details:
        regions.length > 0
          ? `Area-weighted average of ${String(regions.length)} region scores`
          : "No regions available — used overall similarity",
    },
    {
      name: "Color Fidelity",
      weight: config.weights.colorFidelity,
      score: colorScore,
      details: `Overall pixel similarity score: ${String(colorScore)}%`,
    },
    {
      name: "Typography",
      weight: config.weights.typography,
      score: typographyScore,
      details:
        regions.filter(
          (r) =>
            r.name === "content-left" ||
            r.name === "content-center" ||
            r.name === "content-right",
        ).length > 0
          ? "Weighted average of content region scores"
          : "No content regions — used overall similarity",
    },
    {
      name: "Component Structure",
      weight: config.weights.componentStructure,
      score: componentScore,
      details:
        regions.length > 1
          ? "Cross-region deviation consistency measure"
          : "Insufficient regions for variance — used overall similarity",
    },
    {
      name: "Spacing & Alignment",
      weight: config.weights.spacingAlignment,
      score: spacingScore,
      details:
        regions.filter((r) => r.name === "header" || r.name === "footer")
          .length > 0
          ? "Average of header and footer region scores"
          : "No header/footer regions — used overall similarity",
    },
  ];

  const overallScore = roundToTwoDecimals(
    layoutScore * config.weights.layoutAccuracy +
      colorScore * config.weights.colorFidelity +
      typographyScore * config.weights.typography +
      componentScore * config.weights.componentStructure +
      spacingScore * config.weights.spacingAlignment,
  );

  const hotspots = detectHotspots(regions, config.hotspotCount);

  return {
    overallScore,
    interpretation: interpretScore(overallScore),
    dimensions,
    hotspots,
    metadata: {
      comparedAt: input.comparedAt ?? new Date().toISOString(),
      imageWidth: diffResult.width,
      imageHeight: diffResult.height,
      totalPixels: diffResult.totalPixels,
      diffPixelCount: diffResult.diffPixelCount,
      configuredWeights: { ...config.weights },
    },
  };
};
