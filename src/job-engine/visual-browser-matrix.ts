import type { WorkspaceVisualBrowserName } from "../contracts/index.js";
import { comparePngBuffers } from "./visual-diff.js";

export type VisualBrowserName = WorkspaceVisualBrowserName;

export const VISUAL_BROWSER_NAMES: readonly VisualBrowserName[] = [
  "chromium",
  "firefox",
  "webkit",
] as const;

export const DEFAULT_VISUAL_BROWSER: VisualBrowserName = "chromium";

const CROSS_BROWSER_CONSISTENCY_WARN_THRESHOLD = 95;

export interface CrossBrowserPairwiseDiff {
  browserA: VisualBrowserName;
  browserB: VisualBrowserName;
  diffPercent: number;
  diffBuffer: Buffer | null;
}

export interface CrossBrowserConsistencyResult {
  browsers: VisualBrowserName[];
  pairwiseDiffs: CrossBrowserPairwiseDiff[];
  consistencyScore: number;
  warnings: string[];
}

export interface CrossBrowserComputeInput {
  browser: VisualBrowserName;
  screenshotBuffer: Buffer;
}

export const isVisualBrowserName = (
  value: unknown,
): value is VisualBrowserName => {
  return (
    typeof value === "string" &&
    (VISUAL_BROWSER_NAMES as readonly string[]).includes(value)
  );
};

export const assertVisualBrowserName = (value: unknown): VisualBrowserName => {
  if (!isVisualBrowserName(value)) {
    throw new Error(
      `Unknown browser '${String(value)}'. Allowed values: ${VISUAL_BROWSER_NAMES.join(", ")}.`,
    );
  }
  return value;
};

/**
 * Coerce a list of arbitrary string-shaped browser identifiers (e.g. CLI
 * tokens, env-var splits) into a deduplicated list of validated
 * {@link VisualBrowserName}s. Each entry is run through
 * {@link assertVisualBrowserName} so a typo throws with the allowed values.
 * Empty/undefined/null inputs default to {@link DEFAULT_VISUAL_BROWSER}.
 */
export const normalizeVisualBrowserNames = (
  value: readonly string[] | undefined | null,
): VisualBrowserName[] => {
  if (value === undefined || value === null || value.length === 0) {
    return [DEFAULT_VISUAL_BROWSER];
  }
  const seen = new Set<VisualBrowserName>();
  const ordered: VisualBrowserName[] = [];
  for (const entry of value) {
    const validated = assertVisualBrowserName(entry);
    if (!seen.has(validated)) {
      seen.add(validated);
      ordered.push(validated);
    }
  }
  return ordered.length > 0 ? ordered : [DEFAULT_VISUAL_BROWSER];
};

export const parseVisualBrowserList = (
  value: string,
  flagName = "browser list",
): VisualBrowserName[] => {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new Error(
      `${flagName} requires a non-empty comma-separated list (e.g. chromium,firefox,webkit).`,
    );
  }
  return normalizeVisualBrowserNames(tokens);
};

const roundToTwoDecimals = (value: number): number =>
  Math.round(value * 100) / 100;

export const computeCrossBrowserConsistencyScore = (
  entries: readonly CrossBrowserComputeInput[],
): CrossBrowserConsistencyResult => {
  if (entries.length === 0) {
    throw new Error(
      "computeCrossBrowserConsistencyScore requires at least one browser entry.",
    );
  }

  const browsers = entries.map((entry) => entry.browser);
  if (entries.length === 1) {
    return {
      browsers,
      pairwiseDiffs: [],
      consistencyScore: 100,
      warnings: [],
    };
  }

  const pairwiseDiffs: CrossBrowserPairwiseDiff[] = [];
  let worstDiffFraction = 0;
  const warnings: string[] = [];
  const warningDiffPercentThreshold =
    100 - CROSS_BROWSER_CONSISTENCY_WARN_THRESHOLD;

  for (let i = 0; i < entries.length; i += 1) {
    const left = entries[i]!;
    for (let j = i + 1; j < entries.length; j += 1) {
      const right = entries[j]!;
      const diff = comparePngBuffers({
        referenceBuffer: left.screenshotBuffer,
        testBuffer: right.screenshotBuffer,
      });
      const diffFraction =
        diff.totalPixels === 0 ? 0 : diff.diffPixelCount / diff.totalPixels;
      const diffPercent = roundToTwoDecimals(diffFraction * 100);
      worstDiffFraction = Math.max(worstDiffFraction, diffFraction);
      pairwiseDiffs.push({
        browserA: left.browser,
        browserB: right.browser,
        diffPercent,
        diffBuffer: diff.diffImageBuffer,
      });
    }
  }

  const consistencyScore = Math.round((1 - worstDiffFraction) * 100);
  if (consistencyScore < CROSS_BROWSER_CONSISTENCY_WARN_THRESHOLD) {
    for (const pair of pairwiseDiffs) {
      if (pair.diffPercent >= warningDiffPercentThreshold) {
        warnings.push(
          `${pair.browserA} vs ${pair.browserB}: rendering differs by ${pair.diffPercent}%`,
        );
      }
    }
  }

  return {
    browsers,
    pairwiseDiffs,
    consistencyScore,
    warnings,
  };
};
