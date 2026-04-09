import { readFile } from "node:fs/promises";
import path from "node:path";

const ANNOTATION_PATH = "integration/fixtures/visual-benchmark/visual-quality.config.json";

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

const readJsonFile = async (filePath, label) => {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} at '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const formatThresholdLabel = (thresholds) => {
  const warn = `warn ${thresholds.warn}`;
  if (typeof thresholds.fail === "number") {
    return `${warn}, fail ${thresholds.fail}`;
  }
  return `${warn}, fail disabled`;
};

const buildAnnotation = (fixture) => {
  if (fixture.thresholdResult === null || fixture.thresholdResult.verdict === "pass") {
    return null;
  }

  const { thresholdResult } = fixture;
  const level = thresholdResult.verdict === "fail" ? "failure" : "warning";
  return {
    path: ANNOTATION_PATH,
    start_line: 1,
    end_line: 1,
    annotation_level: level,
    title:
      thresholdResult.verdict === "fail"
        ? `Visual benchmark failed: ${fixture.displayName}`
        : `Visual benchmark warning: ${fixture.displayName}`,
    message: `Score ${fixture.score} is ${thresholdResult.verdict === "fail" ? "below fail" : "below warn"} threshold (${formatThresholdLabel(thresholdResult.thresholds)}).`,
  };
};

const buildCheckText = (fixtures, average, artifactRoot) => {
  const lines = [
    `Overall average: ${average % 1 === 0 ? average : average.toFixed(1)}`,
    `Artifacts: ${artifactRoot}`,
    "",
    "Fixture details:",
  ];

  for (const fixture of fixtures) {
    const thresholdText =
      fixture.thresholdResult === null
        ? "thresholds unavailable"
        : `${fixture.thresholdResult.verdict} (${formatThresholdLabel(fixture.thresholdResult.thresholds)})`;
    const artifactText = [
      `manifest=${fixture.manifestPath}`,
      `report=${fixture.reportPath}`,
      `actual=${fixture.actualImagePath}`,
      `diff=${fixture.diffImagePath ?? "n/a"}`,
    ].join(", ");
    lines.push(`- ${fixture.displayName}: score=${fixture.score}, ${thresholdText}; ${artifactText}`);
  }

  return lines.join("\n");
};

export const buildVisualBenchmarkSummary = async (reportPath) => {
  if (typeof reportPath !== "string" || reportPath.trim().length === 0) {
    throw new Error("A visual benchmark last-run report path is required.");
  }

  const absolutePath = path.resolve(reportPath);
  const lastRun = await readJsonFile(absolutePath, "Visual benchmark last-run report");
  if (!Array.isArray(lastRun.scores)) {
    throw new Error(`Visual benchmark last-run report at '${absolutePath}' must contain a scores array.`);
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
    const report = await readJsonFile(reportJsonPath, `Visual benchmark report for '${entry.fixtureId}'`);
    const viewport = manifest.viewport;
    if (
      viewport === null ||
      typeof viewport !== "object" ||
      typeof viewport.width !== "number" ||
      typeof viewport.height !== "number"
    ) {
      throw new Error(`Visual benchmark manifest for '${entry.fixtureId}' is missing a valid viewport.`);
    }
    if (report.status !== "completed" || typeof report.overallScore !== "number") {
      throw new Error(`Visual benchmark report for '${entry.fixtureId}' must be completed and contain an overallScore.`);
    }

    const thresholdResult =
      manifest.thresholdResult !== null && typeof manifest.thresholdResult === "object"
        ? manifest.thresholdResult
        : null;
    const diffImagePath =
      typeof report.diffImagePath === "string" && report.diffImagePath.trim().length > 0
        ? path.relative(process.cwd(), path.resolve(fixtureDir, path.basename(report.diffImagePath))) || "."
        : null;
    fixtures.push({
      fixtureId: entry.fixtureId,
      displayName: toDisplayName(entry.fixtureId),
      score: entry.score,
      viewport: `${viewport.width}\u00d7${viewport.height}`,
      thresholdResult,
      manifestPath: path.relative(process.cwd(), manifestPath) || ".",
      reportPath: path.relative(process.cwd(), reportJsonPath) || ".",
      actualImagePath: path.relative(process.cwd(), path.join(fixtureDir, "actual.png")) || ".",
      diffImagePath,
    });
  }

  const warnedFixtures = fixtures.filter((fixture) => fixture.thresholdResult?.verdict === "warn");
  const failedFixtures = fixtures.filter((fixture) => fixture.thresholdResult?.verdict === "fail");
  const average =
    fixtures.length > 0
      ? fixtures.reduce((sum, fixture) => sum + fixture.score, 0) / fixtures.length
      : 0;

  const lines = [
    "## Visual Quality Benchmark",
    "",
    `**Overall Average:** ${average % 1 === 0 ? average : average.toFixed(1)}`,
    `**Warned Fixtures:** ${warnedFixtures.length}`,
    `**Failed Fixtures:** ${failedFixtures.length}`,
    "",
    "| Fixture | Score | Threshold | Viewport |",
    "|---------|-------|-----------|----------|",
  ];

  for (const fixture of fixtures) {
    const thresholdLabel =
      fixture.thresholdResult === null
        ? "\u2014"
        : `${fixture.thresholdResult.verdict} (${formatThresholdLabel(fixture.thresholdResult.thresholds)})`;
    lines.push(`| ${fixture.displayName} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${thresholdLabel} | ${fixture.viewport} |`);
  }

  lines.push("");
  lines.push("Artifacts include `actual.png`, `diff.png`, and `report.json` for each fixture under `artifacts/visual-benchmark/last-run/`.");
  lines.push("");
  lines.push(`_Ran at ${lastRun.ranAt}_`);

  const markdown = lines.join("\n");
  const annotations = fixtures
    .map((fixture) => buildAnnotation(fixture))
    .filter((annotation) => annotation !== null);

  return {
    markdown,
    check: {
      title: `Visual benchmark: ${average % 1 === 0 ? average : average.toFixed(1)} average (${warnedFixtures.length} warn, ${failedFixtures.length} fail)`,
      summary: markdown,
      text: buildCheckText(fixtures, average, path.relative(process.cwd(), artifactRoot) || "."),
      annotations,
    },
    counts: {
      total: fixtures.length,
      warn: warnedFixtures.length,
      fail: failedFixtures.length,
    },
  };
};
