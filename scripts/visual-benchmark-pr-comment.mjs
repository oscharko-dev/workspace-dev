import { readFile } from "node:fs/promises";
import path from "node:path";

const toDisplayName = (fixtureId) =>
  fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const scoreEmoji = (score) => {
  if (score >= 90) return "\u2705";
  if (score >= 70) return "\u26A0\uFE0F";
  return "\u274C";
};

const roundToTwo = (n) => Math.round(n * 100) / 100;

const readJsonFile = async (filePath, label) => {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} at '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readJsonFileOptional = async (filePath, label) => {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && /** @type {any} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} at '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const MARKER = "<!-- workspace-dev-visual-benchmark -->";

export const buildVisualBenchmarkPrComment = async (reportPath, options) => {
  if (typeof reportPath !== "string" || reportPath.trim().length === 0) {
    throw new Error("A visual benchmark last-run report path is required.");
  }

  const { baselinePath, artifactUrl } = options ?? {};

  const absolutePath = path.resolve(reportPath);
  const lastRun = await readJsonFile(absolutePath, "Visual benchmark last-run report");
  if (!Array.isArray(lastRun.scores)) {
    throw new Error(`Visual benchmark last-run report at '${absolutePath}' must contain a scores array.`);
  }

  let baseline = null;
  if (typeof baselinePath === "string" && baselinePath.trim().length > 0) {
    baseline = await readJsonFileOptional(path.resolve(baselinePath), "Visual benchmark baseline");
  }

  const baselineScoreMap = new Map();
  if (baseline !== null && Array.isArray(baseline.scores)) {
    for (const entry of baseline.scores) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.fixtureId === "string" &&
        typeof entry.score === "number"
      ) {
        baselineScoreMap.set(entry.fixtureId, entry.score);
      }
    }
  }

  const artifactRoot = path.dirname(absolutePath);
  const lastRunDir = path.join(artifactRoot, "last-run");
  const fixtures = [];

  for (const entry of lastRun.scores) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.fixtureId !== "string" ||
      typeof entry.score !== "number"
    ) {
      throw new Error(`Visual benchmark last-run report at '${absolutePath}' contains an invalid score entry.`);
    }

    const fixtureDir = path.join(lastRunDir, entry.fixtureId);
    const manifestPath = path.join(fixtureDir, "manifest.json");
    const reportJsonPath = path.join(fixtureDir, "report.json");

    const manifest = await readJsonFile(manifestPath, `Visual benchmark manifest for '${entry.fixtureId}'`);
    const viewport = manifest.viewport;
    if (
      viewport === null ||
      typeof viewport !== "object" ||
      typeof viewport.width !== "number" ||
      typeof viewport.height !== "number"
    ) {
      throw new Error(`Visual benchmark manifest for '${entry.fixtureId}' is missing a valid viewport.`);
    }

    let report = null;
    const reportRaw = await readJsonFileOptional(reportJsonPath, `Visual benchmark report for '${entry.fixtureId}'`);
    if (reportRaw !== null && reportRaw.status === "completed") {
      report = reportRaw;
    }

    const baselineScore = baselineScoreMap.has(entry.fixtureId) ? baselineScoreMap.get(entry.fixtureId) : null;
    let delta = null;
    let indicator = "neutral";
    if (baselineScore !== null) {
      delta = roundToTwo(entry.score - baselineScore);
      if (Math.abs(delta) <= 1) {
        indicator = "neutral";
      } else if (delta > 0) {
        indicator = "improved";
      } else {
        indicator = "degraded";
      }
    }

    fixtures.push({
      fixtureId: entry.fixtureId,
      displayName: toDisplayName(entry.fixtureId),
      score: entry.score,
      baselineScore,
      delta,
      indicator,
      thresholdResult:
        manifest.thresholdResult !== null && typeof manifest.thresholdResult === "object"
          ? manifest.thresholdResult
          : null,
      report,
    });
  }

  const overallAverage =
    fixtures.length > 0
      ? roundToTwo(fixtures.reduce((sum, f) => sum + f.score, 0) / fixtures.length)
      : 0;

  const baselineFixtures = fixtures.filter((f) => f.baselineScore !== null);
  const overallBaselineAvg =
    baselineFixtures.length > 0
      ? roundToTwo(baselineFixtures.reduce((sum, f) => sum + f.baselineScore, 0) / baselineFixtures.length)
      : null;

  const overallDelta = overallBaselineAvg !== null ? roundToTwo(overallAverage - overallBaselineAvg) : null;

  let overallDeltaText;
  if (overallDelta !== null) {
    const trendArrow =
      Math.abs(overallDelta) <= 1 ? "\u2192" : overallDelta > 0 ? "\u2191" : "\u2193";
    const sign = overallDelta > 0 ? "+" : "";
    overallDeltaText = ` (${trendArrow} ${sign}${overallDelta} vs baseline ${overallBaselineAvg})`;
  } else {
    overallDeltaText = " (no baseline)";
  }

  const trendText = (indicator) => {
    if (indicator === "improved") return "\u2191 improved";
    if (indicator === "degraded") return "\u2193 regressed";
    return "\u2192 stable";
  };

  const lines = [
    MARKER,
    "## Visual Quality Benchmark",
    "",
    `${scoreEmoji(overallAverage)} **Overall Score:** ${overallAverage} / 100${overallDeltaText}`,
    "",
    "| Fixture | Score | Baseline | Delta | Trend |",
    "|---------|-------|----------|-------|-------|",
  ];

  for (const fixture of fixtures) {
    const baselineText = fixture.baselineScore !== null ? String(fixture.baselineScore) : "\u2014";
    const deltaText = fixture.delta !== null ? `${fixture.delta > 0 ? "+" : ""}${fixture.delta}` : "\u2014";
    const trend = trendText(fixture.indicator);
    lines.push(`| ${fixture.displayName} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${baselineText} | ${deltaText} | ${trend} |`);
  }

  if (artifactUrl) {
    lines.push("");
    lines.push("### Diff Images");
    lines.push("");
    lines.push("| Fixture | Diff |");
    lines.push("|---------|------|");
    for (const fixture of fixtures) {
      lines.push(`| ${fixture.displayName} | [View diff](${artifactUrl}) \`last-run/${fixture.fixtureId}/diff.png\` |`);
    }
  }

  const fixturesWithDimensions = fixtures.filter(
    (f) => f.report !== null && Array.isArray(f.report.dimensions) && f.report.dimensions.length > 0,
  );

  if (fixturesWithDimensions.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Full Metric Breakdown</summary>");

    for (const fixture of fixturesWithDimensions) {
      lines.push("");
      lines.push(`#### ${fixture.displayName} (score: ${fixture.score})`);
      lines.push("");
      lines.push("| Dimension | Weight | Score |");
      lines.push("|-----------|--------|-------|");
      for (const dim of fixture.report.dimensions) {
        lines.push(`| ${dim.name} | ${(dim.weight * 100).toFixed(0)}% | ${dim.score} |`);
      }
    }

    lines.push("");
    lines.push("</details>");
  }

  const artifactLinkText = artifactUrl ? ` | [Download artifacts](${artifactUrl})` : "";
  lines.push("");
  lines.push(`_Benchmark ran at ${lastRun.ranAt}${artifactLinkText}_`);

  const body = lines.join("\n");

  return {
    marker: MARKER,
    body,
  };
};
