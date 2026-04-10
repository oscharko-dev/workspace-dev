import { readFile } from "node:fs/promises";
import path from "node:path";

const ANNOTATION_PATH =
  "integration/fixtures/visual-benchmark/visual-quality.config.json";

// Escape markdown table cell separators and control characters so that a
// hostile fixture id or annotation message cannot break out of the rendered
// table. Pipes become \|, backticks become \`, and newlines become spaces.
const escapeMarkdownCell = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .replace(/`/gu, "\\`")
    .replace(/\r?\n/gu, " ")
    .trim();
};

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
    throw new Error(
      `${label} at '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const safeRelativePath = (filePath) =>
  path.relative(process.cwd(), filePath) || ".";

export const buildUnavailableVisualBenchmarkSummary = (reportPath, reason) => {
  const absolutePath = path.resolve(reportPath);
  const artifactRoot = path.dirname(absolutePath);
  const artifactRootDisplay = safeRelativePath(artifactRoot);
  const details =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim()
      : "benchmark artifacts are unavailable.";
  const markdown = [
    "## Visual Quality Benchmark",
    "",
    "**Status:** unavailable",
    `**Reason:** ${details}`,
    "",
    `Artifacts root: \`${artifactRootDisplay}\``,
  ].join("\n");

  return {
    markdown,
    check: {
      title: "Visual benchmark: unavailable",
      summary: markdown,
      text: `Visual benchmark unavailable.\nReason: ${details}\nArtifacts root: ${artifactRootDisplay}`,
      annotations: [],
    },
    counts: {
      total: 0,
      warn: 0,
      fail: 0,
    },
    unavailable: true,
  };
};

const formatThresholdLabel = (thresholds) => {
  const warn = `warn ${thresholds.warn}`;
  if (typeof thresholds.fail === "number") {
    return `${warn}, fail ${thresholds.fail}`;
  }
  return `${warn}, fail disabled`;
};

const normalizeThresholdResult = (value) => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const verdict = value.verdict;
  if (verdict !== "pass" && verdict !== "warn" && verdict !== "fail") {
    return null;
  }
  const thresholds = value.thresholds;
  if (
    thresholds === null ||
    typeof thresholds !== "object" ||
    !isFiniteNumber(thresholds.warn) ||
    (thresholds.fail !== undefined && !isFiniteNumber(thresholds.fail))
  ) {
    return null;
  }

  return {
    verdict,
    thresholds: {
      warn: thresholds.warn,
      ...(isFiniteNumber(thresholds.fail) ? { fail: thresholds.fail } : {}),
    },
  };
};

const buildAnnotation = (fixture) => {
  if (
    fixture.thresholdResult === null ||
    fixture.thresholdResult.verdict === "pass"
  ) {
    return null;
  }

  const { thresholdResult } = fixture;
  const level = thresholdResult.verdict === "fail" ? "failure" : "warning";
  const safeDisplayName = escapeMarkdownCell(fixture.displayName);
  const safeThresholds = escapeMarkdownCell(
    formatThresholdLabel(thresholdResult.thresholds),
  );
  return {
    path: ANNOTATION_PATH,
    start_line: 1,
    end_line: 1,
    annotation_level: level,
    title:
      thresholdResult.verdict === "fail"
        ? `Visual benchmark failed: ${safeDisplayName}`
        : `Visual benchmark warning: ${safeDisplayName}`,
    message: `Score ${fixture.score} is ${thresholdResult.verdict === "fail" ? "below fail" : "below warn"} threshold (${safeThresholds}).`,
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
    lines.push(
      `- ${fixture.displayName}: score=${fixture.score}, ${thresholdText}; ${artifactText}`,
    );
  }

  return lines.join("\n");
};

export const buildVisualBenchmarkSummary = async (reportPath) => {
  if (typeof reportPath !== "string" || reportPath.trim().length === 0) {
    throw new Error("A visual benchmark last-run report path is required.");
  }

  const absolutePath = path.resolve(reportPath);
  let lastRun;
  try {
    lastRun = await readJsonFile(
      absolutePath,
      "Visual benchmark last-run report",
    );
  } catch (error) {
    return buildUnavailableVisualBenchmarkSummary(
      absolutePath,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!Array.isArray(lastRun.scores)) {
    return buildUnavailableVisualBenchmarkSummary(
      absolutePath,
      `Visual benchmark last-run report at '${absolutePath}' must contain a scores array.`,
    );
  }

  const artifactRoot = path.dirname(absolutePath);
  const lastRunDir = path.join(artifactRoot, "last-run");
  const fixtures = [];
  const skippedFixtureReasons = [];

  for (const entry of lastRun.scores) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.fixtureId !== "string" ||
      !isFiniteNumber(entry.score)
    ) {
      skippedFixtureReasons.push(
        "A score entry in last-run.json is malformed.",
      );
      continue;
    }

    const fixtureDir = path.join(lastRunDir, entry.fixtureId);
    const manifestPath = path.join(fixtureDir, "manifest.json");
    const reportJsonPath = path.join(fixtureDir, "report.json");
    let manifest;
    let report;
    try {
      manifest = await readJsonFile(
        manifestPath,
        `Visual benchmark manifest for '${entry.fixtureId}'`,
      );
      report = await readJsonFile(
        reportJsonPath,
        `Visual benchmark report for '${entry.fixtureId}'`,
      );
    } catch (error) {
      skippedFixtureReasons.push(
        `Fixture '${entry.fixtureId}' artifacts are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const viewport = manifest.viewport;
    if (
      viewport === null ||
      typeof viewport !== "object" ||
      !isFiniteNumber(viewport.width) ||
      !isFiniteNumber(viewport.height)
    ) {
      skippedFixtureReasons.push(
        `Fixture '${entry.fixtureId}' has an invalid viewport in manifest.json.`,
      );
      continue;
    }
    if (report.status !== "completed" || !isFiniteNumber(report.overallScore)) {
      skippedFixtureReasons.push(
        `Fixture '${entry.fixtureId}' report is not a valid completed result.`,
      );
      continue;
    }

    const thresholdResult = normalizeThresholdResult(manifest.thresholdResult);
    // Invariant: report.diffImagePath originates from our own runner's
    // saveVisualBenchmarkLastRunArtifact, which always writes the diff PNG to
    // fixtureDir/<LAST_RUN_DIFF_FILE_NAME>. path.basename strips any attacker-
    // controlled subpath so we cannot resolve outside fixtureDir even if the
    // on-disk report has been tampered with.
    const diffImagePath =
      typeof report.diffImagePath === "string" &&
      report.diffImagePath.trim().length > 0
        ? path.relative(
            process.cwd(),
            path.resolve(fixtureDir, path.basename(report.diffImagePath)),
          ) || "."
        : null;
    fixtures.push({
      fixtureId: entry.fixtureId,
      displayName: toDisplayName(entry.fixtureId),
      score: entry.score,
      viewport: `${viewport.width}\u00d7${viewport.height}`,
      thresholdResult,
      manifestPath: safeRelativePath(manifestPath),
      reportPath: safeRelativePath(reportJsonPath),
      actualImagePath: safeRelativePath(path.join(fixtureDir, "actual.png")),
      diffImagePath,
    });
  }

  if (fixtures.length === 0) {
    const reason =
      skippedFixtureReasons.length > 0
        ? `No valid fixture benchmark artifacts were available. ${skippedFixtureReasons[0]}`
        : "No benchmark scores were available to summarize.";
    return buildUnavailableVisualBenchmarkSummary(absolutePath, reason);
  }

  const warnedFixtures = fixtures.filter(
    (fixture) => fixture.thresholdResult?.verdict === "warn",
  );
  const failedFixtures = fixtures.filter(
    (fixture) => fixture.thresholdResult?.verdict === "fail",
  );
  const average =
    fixtures.length > 0
      ? fixtures.reduce((sum, fixture) => sum + fixture.score, 0) /
        fixtures.length
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
    const safeDisplayName = escapeMarkdownCell(fixture.displayName);
    const safeThresholdLabel = escapeMarkdownCell(thresholdLabel);
    const safeViewport = escapeMarkdownCell(fixture.viewport);
    lines.push(
      `| ${safeDisplayName} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${safeThresholdLabel} | ${safeViewport} |`,
    );
  }

  lines.push("");
  lines.push(
    "Artifacts include `actual.png`, `diff.png`, and `report.json` for each fixture under `artifacts/visual-benchmark/last-run/`.",
  );
  if (skippedFixtureReasons.length > 0) {
    lines.push("");
    lines.push(
      `_Skipped fixtures: ${skippedFixtureReasons.length} (invalid or missing artifacts)._`,
    );
  }
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
      text: buildCheckText(
        fixtures,
        average,
        path.relative(process.cwd(), artifactRoot) || ".",
      ),
      annotations,
    },
    counts: {
      total: fixtures.length,
      warn: warnedFixtures.length,
      fail: failedFixtures.length,
    },
  };
};
