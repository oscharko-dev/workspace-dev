import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_SCORING_WEIGHTS,
  interpretScore,
  type VisualDimensionScore,
  type VisualScoringWeights,
} from "../src/job-engine/visual-scoring.js";
import type {
  WorkspaceVisualDimensionScore,
  WorkspaceVisualQualityReport,
} from "../src/contracts/index.js";
import {
  getVisualBenchmarkFixtureRoot,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";

export const VisualQualityThresholdsSchema = z.object({
  warn: z.number().min(0).max(100).optional(),
  fail: z.number().min(0).max(100).optional(),
});

export const VisualQualityScoringWeightsSchema = z.object({
  layoutAccuracy: z.number().min(0).max(1).optional(),
  colorFidelity: z.number().min(0).max(1).optional(),
  typography: z.number().min(0).max(1).optional(),
  componentStructure: z.number().min(0).max(1).optional(),
  spacingAlignment: z.number().min(0).max(1).optional(),
});

export const VisualQualityScreenConfigSchema = z.object({
  thresholds: VisualQualityThresholdsSchema.optional(),
});

export const VisualQualityFixtureConfigSchema = z.object({
  thresholds: VisualQualityThresholdsSchema.optional(),
  screens: z.record(z.string(), VisualQualityScreenConfigSchema).optional(),
});

export const VisualQualityRegressionConfigSchema = z.object({
  maxScoreDropPercent: z.number().min(0).max(100).optional(),
  neutralTolerance: z.number().min(0).max(100).optional(),
  historySize: z.number().int().min(1).max(1000).optional(),
});

export const VisualQualityConfigSchema = z.object({
  thresholds: VisualQualityThresholdsSchema.optional(),
  weights: VisualQualityScoringWeightsSchema.optional(),
  fixtures: z.record(z.string(), VisualQualityFixtureConfigSchema).optional(),
  regression: VisualQualityRegressionConfigSchema.optional(),
});

export type VisualQualityThresholds = z.infer<
  typeof VisualQualityThresholdsSchema
>;
export type VisualQualityScreenConfig = z.infer<
  typeof VisualQualityScreenConfigSchema
>;
export type VisualQualityFixtureConfig = z.infer<
  typeof VisualQualityFixtureConfigSchema
>;
export type VisualQualityRegressionConfig = z.infer<
  typeof VisualQualityRegressionConfigSchema
>;
export type VisualQualityConfig = z.infer<typeof VisualQualityConfigSchema>;

export interface VisualQualityResolvedRegressionConfig {
  maxScoreDropPercent: number;
  neutralTolerance: number;
  historySize: number;
}

export const DEFAULT_RESOLVED_REGRESSION_CONFIG: VisualQualityResolvedRegressionConfig =
  {
    maxScoreDropPercent: 5,
    neutralTolerance: 1,
    historySize: 20,
  };

export const resolveVisualQualityRegressionConfig = (
  config?: VisualQualityConfig,
): VisualQualityResolvedRegressionConfig => {
  const regression = config?.regression ?? {};
  return {
    maxScoreDropPercent:
      regression.maxScoreDropPercent ??
      DEFAULT_RESOLVED_REGRESSION_CONFIG.maxScoreDropPercent,
    neutralTolerance:
      regression.neutralTolerance ??
      DEFAULT_RESOLVED_REGRESSION_CONFIG.neutralTolerance,
    historySize:
      regression.historySize ?? DEFAULT_RESOLVED_REGRESSION_CONFIG.historySize,
  };
};

export interface VisualQualityResolvedThresholds {
  warn: number;
  fail?: number;
}

export type VisualQualityThresholdVerdict = "pass" | "warn" | "fail";

export interface VisualQualityThresholdResult {
  score: number;
  verdict: VisualQualityThresholdVerdict;
  thresholds: VisualQualityResolvedThresholds;
}

export interface VisualQualityScreenContext {
  screenId?: string;
  screenName?: string;
}

const CONFIG_FILE_NAME = "visual-quality.config.json";

export const DEFAULT_THRESHOLDS: VisualQualityResolvedThresholds = {
  warn: 80,
};

const validateThresholdOrder = (
  thresholds: VisualQualityThresholds | undefined,
  path: string,
): void => {
  if (
    thresholds?.warn !== undefined &&
    thresholds?.fail !== undefined &&
    thresholds.warn < thresholds.fail
  ) {
    throw new Error(
      `${path}: warn threshold (${String(thresholds.warn)}) must be >= fail threshold (${String(thresholds.fail)}).`,
    );
  }
};

export const parseVisualQualityConfig = (
  input: unknown,
): VisualQualityConfig => {
  const result = VisualQualityConfigSchema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid visual quality config: ${messages}`);
  }
  const config = result.data;

  if (config.weights) {
    const provided = config.weights;
    const allPresent =
      provided.layoutAccuracy !== undefined &&
      provided.colorFidelity !== undefined &&
      provided.typography !== undefined &&
      provided.componentStructure !== undefined &&
      provided.spacingAlignment !== undefined;
    if (allPresent) {
      const sum =
        provided.layoutAccuracy! +
        provided.colorFidelity! +
        provided.typography! +
        provided.componentStructure! +
        provided.spacingAlignment!;
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new Error(
          `Scoring weights must sum to 1.0 (100%). Received ${String(sum)}.`,
        );
      }
    }
  }

  validateThresholdOrder(config.thresholds, "thresholds");
  if (config.fixtures) {
    for (const [fixtureId, fixtureConfig] of Object.entries(config.fixtures)) {
      validateThresholdOrder(
        fixtureConfig.thresholds,
        `fixtures.${fixtureId}.thresholds`,
      );
      if (fixtureConfig.screens) {
        for (const [screenId, screenConfig] of Object.entries(
          fixtureConfig.screens,
        )) {
          validateThresholdOrder(
            screenConfig.thresholds,
            `fixtures.${fixtureId}.screens.${screenId}.thresholds`,
          );
        }
      }
    }
  }

  return config;
};

export const loadVisualQualityConfig = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualQualityConfig> => {
  const root = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  const configPath = path.join(root, CONFIG_FILE_NAME);
  try {
    const content = await readFile(configPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    return parseVisualQualityConfig(parsed);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
};

export const resolveVisualQualityWeights = (
  config?: VisualQualityConfig,
): VisualScoringWeights => {
  if (!config?.weights) {
    return { ...DEFAULT_SCORING_WEIGHTS };
  }
  const merged: VisualScoringWeights = {
    layoutAccuracy:
      config.weights.layoutAccuracy ?? DEFAULT_SCORING_WEIGHTS.layoutAccuracy,
    colorFidelity:
      config.weights.colorFidelity ?? DEFAULT_SCORING_WEIGHTS.colorFidelity,
    typography: config.weights.typography ?? DEFAULT_SCORING_WEIGHTS.typography,
    componentStructure:
      config.weights.componentStructure ??
      DEFAULT_SCORING_WEIGHTS.componentStructure,
    spacingAlignment:
      config.weights.spacingAlignment ??
      DEFAULT_SCORING_WEIGHTS.spacingAlignment,
  };
  const sum =
    merged.layoutAccuracy +
    merged.colorFidelity +
    merged.typography +
    merged.componentStructure +
    merged.spacingAlignment;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `Resolved scoring weights must sum to 1.0 (100%). Got ${String(sum)}.`,
    );
  }
  return merged;
};

export const resolveVisualQualityThresholds = (
  config?: VisualQualityConfig,
  fixtureId?: string,
  screenContext?: VisualQualityScreenContext,
): VisualQualityResolvedThresholds => {
  const globalThresholds = config?.thresholds ?? {};
  const fixtureThresholds =
    fixtureId !== undefined
      ? (config?.fixtures?.[fixtureId]?.thresholds ?? {})
      : {};
  const screenConfigs =
    fixtureId !== undefined
      ? config?.fixtures?.[fixtureId]?.screens
      : undefined;
  const normalizedScreenName =
    typeof screenContext?.screenName === "string" &&
    screenContext.screenName.trim().length > 0
      ? screenContext.screenName.trim()
      : undefined;
  const normalizedScreenId =
    typeof screenContext?.screenId === "string" &&
    screenContext.screenId.trim().length > 0
      ? screenContext.screenId.trim()
      : undefined;
  const screenNameThresholds =
    normalizedScreenName !== undefined
      ? (screenConfigs?.[normalizedScreenName]?.thresholds ?? {})
      : {};
  const screenIdThresholds =
    normalizedScreenId !== undefined
      ? (screenConfigs?.[normalizedScreenId]?.thresholds ?? {})
      : {};
  const screenThresholds: VisualQualityThresholds = {
    warn: screenIdThresholds.warn ?? screenNameThresholds.warn,
    fail: screenIdThresholds.fail ?? screenNameThresholds.fail,
  };

  return {
    warn:
      screenThresholds.warn ??
      fixtureThresholds.warn ??
      globalThresholds.warn ??
      DEFAULT_THRESHOLDS.warn,
    fail:
      screenThresholds.fail ??
      fixtureThresholds.fail ??
      globalThresholds.fail ??
      DEFAULT_THRESHOLDS.fail,
  };
};

export const checkVisualQualityThreshold = (
  score: number,
  thresholds: VisualQualityResolvedThresholds,
): VisualQualityThresholdResult => {
  let verdict: VisualQualityThresholdVerdict;
  if (thresholds.fail !== undefined && score < thresholds.fail) {
    verdict = "fail";
  } else if (score < thresholds.warn) {
    verdict = "warn";
  } else {
    verdict = "pass";
  }
  return { score, verdict, thresholds };
};

const DIMENSION_KEY_MAP: Record<string, keyof VisualScoringWeights> = {
  "Layout Accuracy": "layoutAccuracy",
  "Color Fidelity": "colorFidelity",
  Typography: "typography",
  "Component Structure": "componentStructure",
  "Spacing & Alignment": "spacingAlignment",
};

export const recomputeVisualQualityScore = (
  dimensions: VisualDimensionScore[],
  weights: VisualScoringWeights,
): number => {
  let score = 0;
  for (const dim of dimensions) {
    const key = DIMENSION_KEY_MAP[dim.name];
    if (key === undefined) {
      continue;
    }
    score += dim.score * weights[key];
  }
  return Math.round(score * 100) / 100;
};

export const applyVisualQualityConfigToReport = (
  report: WorkspaceVisualQualityReport,
  config?: VisualQualityConfig,
): WorkspaceVisualQualityReport => {
  if (
    report.status !== "completed" ||
    report.dimensions === undefined ||
    report.metadata === undefined
  ) {
    return report;
  }

  const weights = resolveVisualQualityWeights(config);
  const patchedDimensions: WorkspaceVisualDimensionScore[] =
    report.dimensions.map((dimension) => {
      const key = DIMENSION_KEY_MAP[dimension.name];
      if (key === undefined) {
        return { ...dimension };
      }
      return {
        ...dimension,
        weight: weights[key],
      };
    });
  const overallScore = recomputeVisualQualityScore(patchedDimensions, weights);

  return {
    ...report,
    overallScore,
    interpretation: interpretScore(overallScore),
    dimensions: patchedDimensions,
    metadata: {
      ...report.metadata,
      configuredWeights: { ...weights },
    },
  };
};
