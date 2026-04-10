import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const toDisplayName = (fixtureId) =>
  fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const normalizeOptionalString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toDisplayLabel = (fixtureId, screenName, screenId) => {
  const fixtureName = toDisplayName(fixtureId);
  const normalizedScreenName = normalizeOptionalString(screenName);
  if (normalizedScreenName !== null) {
    return `${fixtureName} / ${normalizedScreenName}`;
  }
  const normalizedScreenId = normalizeOptionalString(screenId);
  if (normalizedScreenId !== null && normalizedScreenId !== fixtureId) {
    return `${fixtureName} / ${normalizedScreenId}`;
  }
  return fixtureName;
};

const getCompositeKey = (fixtureId, screenId) => {
  const normalizedScreenId =
    typeof screenId === "string" && screenId.trim().length > 0
      ? screenId.trim()
      : fixtureId;
  return `${fixtureId}::${normalizedScreenId}`;
};

// Mirrors integration/visual-benchmark.helpers.ts:toScreenIdToken — replaces
// only `:` with `_`. Kept in sync so pr-comment.mjs can reconstruct per-screen
// artifact paths without importing TypeScript sources.
const toLegacyScreenIdToken = (screenId) => screenId.replace(/:/gu, "_");

// Resolves the on-disk last-run artifact directory for a score entry. Legacy
// single-screen entries (no screenId) still resolve to `<lastRunDir>/<fixture>`;
// multi-screen entries resolve to `<lastRunDir>/<fixture>/screens/<token>`.
// Mirrors resolveVisualBenchmarkLastRunArtifactPaths in the TS runner.
const getLastRunFixtureDir = (lastRunDir, fixtureId, screenId) => {
  const fixtureRoot = path.join(lastRunDir, fixtureId);
  if (typeof screenId !== "string" || screenId.trim().length === 0) {
    return fixtureRoot;
  }
  return path.join(fixtureRoot, "screens", toLegacyScreenIdToken(screenId));
};

// Comment body soft limit — stay under 60KB of the GitHub 65KB hard limit.
const MAX_COMMENT_BODY_CHARS = 60_000;

const scoreEmoji = (score) => {
  if (score >= 90) return "\u2705";
  if (score >= 70) return "\u26A0\uFE0F";
  return "\u274C";
};

const roundToTwo = (n) => Math.round(n * 100) / 100;
const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const escapeMarkdownCell = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ");

const escapeMarkdownHeading = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .trim();

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

const readJsonFileOptional = async (filePath, label) => {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      /** @type {any} */ (error).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${label} at '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const resolveFixtureArtifactDir = async (lastRunDir, fixtureId, screenId) => {
  const normalizedScreenId = normalizeOptionalString(screenId);
  if (normalizedScreenId === null) {
    return getLastRunFixtureDir(lastRunDir, fixtureId);
  }

  const legacyDir = getLastRunFixtureDir(
    lastRunDir,
    fixtureId,
    normalizedScreenId,
  );
  const legacyManifest = await readJsonFileOptional(
    path.join(legacyDir, "manifest.json"),
    `Visual benchmark manifest for '${fixtureId}' screen '${normalizedScreenId}'`,
  );
  if (
    legacyManifest !== null &&
    normalizeOptionalString(legacyManifest.screenId) === normalizedScreenId
  ) {
    return legacyDir;
  }

  const screensDir = path.join(lastRunDir, fixtureId, "screens");
  let screenEntries = [];
  try {
    screenEntries = await readdir(screensDir, { withFileTypes: true });
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        /** @type {any} */ (error).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  for (const entry of screenEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateDir = path.join(screensDir, entry.name);
    const manifest = await readJsonFileOptional(
      path.join(candidateDir, "manifest.json"),
      `Visual benchmark manifest for '${fixtureId}' screen '${normalizedScreenId}'`,
    );
    if (
      manifest !== null &&
      normalizeOptionalString(manifest.screenId) === normalizedScreenId
    ) {
      return candidateDir;
    }
  }

  return legacyDir;
};

const joinLines = (lines) => lines.join("\n");

const buildBoundedCommentBody = ({
  headerLines,
  tableHeaderLines,
  tableRowLines,
  diffSectionHeaderLines,
  diffRowLines,
  detailBlocks,
  footerLines,
}) => {
  const lines = [...headerLines, ...tableHeaderLines];
  let truncated = false;

  const noticeLines = [
    "",
    `_Additional benchmark details were omitted to keep this comment under ${MAX_COMMENT_BODY_CHARS.toLocaleString()} characters._`,
  ];

  const getReservedLength = (needsNotice) =>
    joinLines(needsNotice ? [...noticeLines, ...footerLines] : footerLines)
      .length + 1;

  const canAppend = (candidateLines, needsNotice) =>
    joinLines([...lines, ...candidateLines]).length + getReservedLength(needsNotice) <=
    MAX_COMMENT_BODY_CHARS;

  for (const rowLines of tableRowLines) {
    if (!canAppend(rowLines, true)) {
      truncated = true;
      break;
    }
    lines.push(...rowLines);
  }

  if (!truncated && diffSectionHeaderLines.length > 0 && diffRowLines.length > 0) {
    let diffHeaderAdded = false;
    for (const rowLines of diffRowLines) {
      const candidateLines = diffHeaderAdded
        ? rowLines
        : [...diffSectionHeaderLines, ...rowLines];
      if (!canAppend(candidateLines, true)) {
        truncated = true;
        break;
      }
      if (!diffHeaderAdded) {
        lines.push(...diffSectionHeaderLines);
        diffHeaderAdded = true;
      }
      lines.push(...rowLines);
    }
  }

  if (!truncated && detailBlocks.length > 0) {
    const detailsOpenLines = ["", "<details>", "<summary>Full Metric Breakdown</summary>"];
    const detailsCloseLines = ["", "</details>"];
    let detailsOpened = false;

    for (const blockLines of detailBlocks) {
      const candidateLines = detailsOpened
        ? blockLines
        : [...detailsOpenLines, ...blockLines];
      if (
        joinLines([...lines, ...candidateLines, ...detailsCloseLines]).length +
          getReservedLength(true) >
        MAX_COMMENT_BODY_CHARS
      ) {
        truncated = true;
        break;
      }
      if (!detailsOpened) {
        lines.push(...detailsOpenLines);
        detailsOpened = true;
      }
      lines.push(...blockLines);
    }

    if (detailsOpened) {
      lines.push(...detailsCloseLines);
    }
  }

  if (truncated) {
    lines.push(...noticeLines);
  }
  lines.push(...footerLines);
  return joinLines(lines);
};

export const VISUAL_BENCHMARK_PR_COMMENT_MARKER =
  "<!-- workspace-dev-visual-benchmark -->";

export const buildVisualBenchmarkPrComment = async (reportPath, options) => {
  if (typeof reportPath !== "string" || reportPath.trim().length === 0) {
    throw new Error("A visual benchmark last-run report path is required.");
  }

  const { baselinePath, artifactUrl } = options ?? {};

  const absolutePath = path.resolve(reportPath);
  const lastRun = await readJsonFile(
    absolutePath,
    "Visual benchmark last-run report",
  );
  if (!Array.isArray(lastRun.scores)) {
    throw new Error(
      `Visual benchmark last-run report at '${absolutePath}' must contain a scores array.`,
    );
  }

  let baseline = null;
  if (typeof baselinePath === "string" && baselinePath.trim().length > 0) {
    baseline = await readJsonFileOptional(
      path.resolve(baselinePath),
      "Visual benchmark baseline",
    );
  }

  // H4 fix: baseline entries are composite-keyed (fixtureId + screenId) so
  // that multi-screen fixtures do not collide. Single-screen v1 fixtures map
  // to `${fixtureId}::${fixtureId}` via getCompositeKey's fallback.
  const baselineScoreMap = new Map();
  if (baseline !== null && Array.isArray(baseline.scores)) {
    for (const entry of baseline.scores) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.fixtureId === "string" &&
        isFiniteNumber(entry.score)
      ) {
        const key = getCompositeKey(entry.fixtureId, entry.screenId);
        baselineScoreMap.set(key, entry.score);
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
      !isFiniteNumber(entry.score)
    ) {
      throw new Error(
        `Visual benchmark last-run report at '${absolutePath}' contains an invalid score entry.`,
      );
    }

    const fixtureDir = await resolveFixtureArtifactDir(
      lastRunDir,
      entry.fixtureId,
      entry.screenId,
    );
    const manifestPath = path.join(fixtureDir, "manifest.json");
    const reportJsonPath = path.join(fixtureDir, "report.json");

    const manifest = await readJsonFile(
      manifestPath,
      `Visual benchmark manifest for '${entry.fixtureId}'`,
    );
    const viewport = manifest.viewport;
    if (
      viewport === null ||
      typeof viewport !== "object" ||
      !isFiniteNumber(viewport.width) ||
      !isFiniteNumber(viewport.height)
    ) {
      throw new Error(
        `Visual benchmark manifest for '${entry.fixtureId}' is missing a valid viewport.`,
      );
    }

    let reportDimensions = null;
    const reportRaw = await readJsonFileOptional(
      reportJsonPath,
      `Visual benchmark report for '${entry.fixtureId}'`,
    );
    if (
      reportRaw !== null &&
      reportRaw.status === "completed" &&
      Array.isArray(reportRaw.dimensions)
    ) {
      const validDimensions = [];
      for (const dim of reportRaw.dimensions) {
        if (
          dim !== null &&
          typeof dim === "object" &&
          typeof dim.name === "string" &&
          isFiniteNumber(dim.weight) &&
          isFiniteNumber(dim.score)
        ) {
          validDimensions.push({
            name: dim.name,
            weight: dim.weight,
            score: dim.score,
          });
        }
      }
      if (validDimensions.length > 0) {
        reportDimensions = validDimensions;
      }
    }

    const compositeKey = getCompositeKey(entry.fixtureId, entry.screenId);
    const baselineScore = baselineScoreMap.has(compositeKey)
      ? baselineScoreMap.get(compositeKey)
      : null;
    let delta = null;
    let indicator = "unavailable";
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
      screenId: normalizeOptionalString(entry.screenId ?? manifest.screenId),
      screenName: normalizeOptionalString(
        entry.screenName ?? manifest.screenName,
      ),
      displayLabel: toDisplayLabel(
        entry.fixtureId,
        entry.screenName ?? manifest.screenName,
        entry.screenId ?? manifest.screenId,
      ),
      score: entry.score,
      baselineScore,
      delta,
      indicator,
      thresholdResult:
        manifest.thresholdResult !== null &&
        typeof manifest.thresholdResult === "object"
          ? manifest.thresholdResult
          : null,
      reportDimensions,
      diffArtifactPath:
        path.relative(artifactRoot, path.join(fixtureDir, "diff.png")) || ".",
    });
  }

  if (fixtures.length === 0) {
    throw new Error(
      `Visual benchmark last-run report at '${absolutePath}' contains no valid score entries.`,
    );
  }

  const overallAverage = roundToTwo(
    fixtures.reduce((sum, fixture) => sum + fixture.score, 0) / fixtures.length,
  );

  const baselineFixtures = fixtures.filter(
    (fixture) => fixture.baselineScore !== null && fixture.delta !== null,
  );
  const overallBaselineAvg =
    baselineFixtures.length > 0
      ? roundToTwo(
          baselineFixtures.reduce(
            (sum, fixture) => sum + fixture.baselineScore,
            0,
          ) / baselineFixtures.length,
        )
      : null;
  const comparableCurrentAvg =
    baselineFixtures.length > 0
      ? roundToTwo(
          baselineFixtures.reduce((sum, fixture) => sum + fixture.score, 0) /
            baselineFixtures.length,
        )
      : null;

  const overallDelta =
    overallBaselineAvg !== null && comparableCurrentAvg !== null
      ? roundToTwo(comparableCurrentAvg - overallBaselineAvg)
      : null;
  const excludedFixtureCount = fixtures.length - baselineFixtures.length;

  let overallDeltaText;
  if (overallDelta !== null) {
    const trendArrow =
      Math.abs(overallDelta) <= 1
        ? "\u2192"
        : overallDelta > 0
          ? "\u2191"
          : "\u2193";
    const sign = overallDelta > 0 ? "+" : "";
    const comparableText =
      baselineFixtures.length === 1
        ? "across 1 comparable view"
        : `across ${baselineFixtures.length} comparable views`;
    const excludedText =
      excludedFixtureCount > 0
        ? excludedFixtureCount === 1
          ? "; 1 view excluded (no baseline)"
          : `; ${excludedFixtureCount} views excluded (no baseline)`
        : "";
    overallDeltaText = ` (${trendArrow} ${sign}${overallDelta} vs baseline ${overallBaselineAvg} ${comparableText}${excludedText})`;
  } else {
    overallDeltaText = " (no comparable baseline)";
  }

  const trendText = (indicator) => {
    if (indicator === "improved") return "\u2191 improved";
    if (indicator === "degraded") return "\u2193 regressed";
    if (indicator === "unavailable") return "\u2014 no baseline";
    return "\u2192 stable";
  };

  const headerLines = [
    VISUAL_BENCHMARK_PR_COMMENT_MARKER,
    "## Visual Quality Benchmark",
    "",
    `${scoreEmoji(overallAverage)} **Overall Score:** ${overallAverage} / 100${overallDeltaText}`,
    "",
  ];

  const tableHeaderLines = [
    "| View | Score | Baseline | Delta | Trend |",
    "|------|-------|----------|-------|-------|",
  ];

  const tableRowLines = [];
  for (const fixture of fixtures) {
    const baselineText =
      fixture.baselineScore !== null ? String(fixture.baselineScore) : "\u2014";
    const deltaText =
      fixture.delta !== null
        ? `${fixture.delta > 0 ? "+" : ""}${fixture.delta}`
        : "\u2014";
    const trend = trendText(fixture.indicator);
    tableRowLines.push([
      `| ${escapeMarkdownCell(fixture.displayLabel)} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${escapeMarkdownCell(baselineText)} | ${escapeMarkdownCell(deltaText)} | ${escapeMarkdownCell(trend)} |`,
    ]);
  }

  const diffSectionHeaderLines =
    artifactUrl && fixtures.length > 0
      ? ["", "### Diff Images", "", "| View | Diff |", "|------|------|"]
      : [];
  const diffRowLines = artifactUrl
    ? fixtures.map((fixture) => [
        `| ${escapeMarkdownCell(fixture.displayLabel)} | [View diff](${artifactUrl}) \`${escapeMarkdownCell(fixture.diffArtifactPath)}\` |`,
      ])
    : [];

  const fixturesWithDimensions = fixtures.filter(
    (fixture) =>
      Array.isArray(fixture.reportDimensions) &&
      fixture.reportDimensions.length > 0,
  );
  const detailBlocks = fixturesWithDimensions.map((fixture) => {
    const blockLines = [
      "",
      `#### ${escapeMarkdownHeading(fixture.displayLabel)} (score: ${fixture.score})`,
      "",
      "| Dimension | Weight | Score |",
      "|-----------|--------|-------|",
    ];
    for (const dim of fixture.reportDimensions) {
      blockLines.push(
        `| ${escapeMarkdownCell(dim.name)} | ${escapeMarkdownCell(`${(dim.weight * 100).toFixed(0)}%`)} | ${escapeMarkdownCell(dim.score)} |`,
      );
    }
    return blockLines;
  });

  const artifactLinkText = artifactUrl
    ? ` | [Download artifacts](${artifactUrl})`
    : "";
  const footerLines = [
    "",
    `_Benchmark ran at ${lastRun.ranAt}${artifactLinkText}_`,
  ];

  const body = buildBoundedCommentBody({
    headerLines,
    tableHeaderLines,
    tableRowLines,
    diffSectionHeaderLines,
    diffRowLines,
    detailBlocks,
    footerLines,
  });

  return {
    marker: VISUAL_BENCHMARK_PR_COMMENT_MARKER,
    body,
  };
};
