import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const toDisplayName = (fixtureId) =>
  fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const normalizeOptionalString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toDisplayLabel = (
  fixtureId,
  screenName,
  screenId,
  viewportLabel,
  viewportId,
) => {
  const fixtureName = toDisplayName(fixtureId);
  const normalizedScreenName = normalizeOptionalString(screenName);
  const normalizedViewportLabel =
    normalizeOptionalString(viewportLabel) ?? normalizeOptionalString(viewportId);
  const appendViewportLabel = (baseLabel) =>
    normalizedViewportLabel === null
      ? baseLabel
      : `${baseLabel} / ${normalizedViewportLabel}`;
  if (normalizedScreenName !== null) {
    return appendViewportLabel(`${fixtureName} / ${normalizedScreenName}`);
  }
  const normalizedScreenId = normalizeOptionalString(screenId);
  if (normalizedScreenId !== null && normalizedScreenId !== fixtureId) {
    return appendViewportLabel(`${fixtureName} / ${normalizedScreenId}`);
  }
  return appendViewportLabel(fixtureName);
};

const getCompositeKey = (fixtureId, screenId, viewportId) => {
  const normalizedScreenId =
    typeof screenId === "string" && screenId.trim().length > 0
      ? screenId.trim()
      : fixtureId;
  const normalizedViewportId =
    typeof viewportId === "string" && viewportId.trim().length > 0
      ? viewportId.trim()
      : "default";
  return `${fixtureId}::${normalizedScreenId}::${normalizedViewportId}`;
};

const getScreenAggregateKey = (fixtureId, screenId) => {
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
const normalizePathToken = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._-]+$/u.test(value.trim())
    ? value.trim()
    : null;

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
const FULL_PAGE_HEADLINE_WEIGHT = 0.7;
const COMPONENT_HEADLINE_WEIGHT = 0.3;

const scoreEmoji = (score) => {
  if (score >= 90) return "\u2705";
  if (score >= 70) return "\u26A0\uFE0F";
  return "\u274C";
};

const roundToTwo = (n) => Math.round(n * 100) / 100;
const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
const isPlainRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveCompositeReportPath = (reportPath) =>
  path.join(path.dirname(path.resolve(reportPath)), "composite-quality-report.json");

const formatPercent = (value) =>
  isFiniteNumber(value) ? `${Math.round(value * 100)}%` : "\u2014";

const formatScoreOrUnavailable = (value) =>
  isFiniteNumber(value) ? `${formatScore(roundToTwo(value))} / 100` : "unavailable";

const formatMetricOrUnavailable = (value, suffix = "") =>
  isFiniteNumber(value)
    ? `${formatScore(roundToTwo(value))}${suffix}`
    : "unavailable";

const normalizeCompositeAggregateMetrics = (value) => {
  if (!isPlainRecord(value)) {
    return null;
  }
  return {
    fcp_ms: isFiniteNumber(value.fcp_ms) ? roundToTwo(value.fcp_ms) : null,
    lcp_ms: isFiniteNumber(value.lcp_ms) ? roundToTwo(value.lcp_ms) : null,
    cls: isFiniteNumber(value.cls) ? roundToTwo(value.cls) : null,
    tbt_ms: isFiniteNumber(value.tbt_ms) ? roundToTwo(value.tbt_ms) : null,
    speed_index_ms: isFiniteNumber(value.speed_index_ms)
      ? roundToTwo(value.speed_index_ms)
      : null,
  };
};

const loadCompositeQualityReport = async (reportPath) => {
  const compositePath = resolveCompositeReportPath(reportPath);
  const parsed = await readJsonFileOptional(
    compositePath,
    "Composite quality report",
  );
  if (!isPlainRecord(parsed)) {
    return null;
  }

  const weights = isPlainRecord(parsed.weights)
    ? {
        visual: isFiniteNumber(parsed.weights.visual)
          ? parsed.weights.visual
          : null,
        performance: isFiniteNumber(parsed.weights.performance)
          ? parsed.weights.performance
          : null,
      }
    : null;
  const visual = isPlainRecord(parsed.visual)
    ? {
        score: isFiniteNumber(parsed.visual.score)
          ? roundToTwo(parsed.visual.score)
          : null,
      }
    : null;
  const performance = isPlainRecord(parsed.performance)
    ? {
        score: isFiniteNumber(parsed.performance.score)
          ? roundToTwo(parsed.performance.score)
          : null,
        sampleCount: isFiniteNumber(parsed.performance.sampleCount)
          ? parsed.performance.sampleCount
          : 0,
        aggregateMetrics: normalizeCompositeAggregateMetrics(
          parsed.performance.aggregateMetrics,
        ),
      }
    : null;
  const composite = isPlainRecord(parsed.composite)
    ? {
        score: isFiniteNumber(parsed.composite.score)
          ? roundToTwo(parsed.composite.score)
          : null,
      }
    : null;
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter(
        (warning) => typeof warning === "string" && warning.trim().length > 0,
      )
    : [];

  return {
    weights,
    visual,
    performance,
    composite,
    warnings,
  };
};

const normalizeBrowserBreakdown = (value) => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const normalized = {};
  for (const browserName of ["chromium", "firefox", "webkit"]) {
    if (isFiniteNumber(value[browserName])) {
      normalized[browserName] = roundToTwo(value[browserName]);
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeCrossBrowserConsistency = (value) => {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.browsers) ||
    !isFiniteNumber(value.consistencyScore) ||
    !Array.isArray(value.pairwiseDiffs)
  ) {
    return null;
  }
  const pairwiseDiffs = value.pairwiseDiffs
    .filter(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.browserA === "string" &&
        typeof entry.browserB === "string" &&
        isFiniteNumber(entry.diffPercent),
    )
    .map((entry) => ({
      browserA: entry.browserA,
      browserB: entry.browserB,
      diffPercent: roundToTwo(entry.diffPercent),
      ...(normalizeOptionalString(entry.diffImagePath)
        ? { diffImagePath: normalizeOptionalString(entry.diffImagePath) }
        : {}),
    }));
  return {
    browsers: value.browsers.filter((browser) => typeof browser === "string"),
    consistencyScore: roundToTwo(value.consistencyScore),
    pairwiseDiffs,
    ...(Array.isArray(value.warnings) && value.warnings.length > 0
      ? {
          warnings: value.warnings.filter(
            (warning) =>
              typeof warning === "string" && warning.trim().length > 0,
          ),
        }
      : {}),
  };
};

const normalizePerBrowserArtifacts = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const normalized = value
    .filter(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.browser === "string" &&
        isFiniteNumber(entry.overallScore),
    )
    .map((entry) => ({
      browser: entry.browser,
      overallScore: roundToTwo(entry.overallScore),
      ...(normalizeOptionalString(entry.actualImagePath)
        ? { actualImagePath: normalizeOptionalString(entry.actualImagePath) }
        : {}),
      ...(normalizeOptionalString(entry.diffImagePath)
        ? { diffImagePath: normalizeOptionalString(entry.diffImagePath) }
        : {}),
      ...(normalizeOptionalString(entry.reportPath)
        ? { reportPath: normalizeOptionalString(entry.reportPath) }
        : {}),
      ...(Array.isArray(entry.warnings) && entry.warnings.length > 0
        ? {
            warnings: entry.warnings.filter(
              (warning) =>
                typeof warning === "string" && warning.trim().length > 0,
            ),
          }
        : {}),
    }));
  return normalized.length > 0 ? normalized : null;
};

const formatBrowserBreakdown = (value) => {
  const normalized = normalizeBrowserBreakdown(value);
  if (normalized === null) {
    return null;
  }
  return Object.entries(normalized)
    .map(([browser, score]) => `${browser}: ${score}`)
    .join(", ");
};

const normalizeViewportList = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    const viewportId = normalizeOptionalString(entry.id);
    if (viewportId === null || seen.has(viewportId)) {
      continue;
    }
    seen.add(viewportId);
    const viewport = { id: viewportId };
    if (isFiniteNumber(entry.weight) && entry.weight > 0) {
      viewport.weight = entry.weight;
    }
    normalized.push(viewport);
  }
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeViewportWeights = (viewports) => {
  if (!Array.isArray(viewports) || viewports.length === 0) {
    return [];
  }
  const withWeight = viewports.filter(
    (viewport) => isFiniteNumber(viewport.weight) && viewport.weight > 0,
  );
  if (withWeight.length > 0 && withWeight.length < viewports.length) {
    return viewports.map((viewport) => ({
      ...viewport,
      weight: 1 / viewports.length,
    }));
  }
  if (withWeight.length === 0) {
    return viewports.map((viewport) => ({
      ...viewport,
      weight: 1 / viewports.length,
    }));
  }
  const total = withWeight.reduce((sum, viewport) => sum + viewport.weight, 0);
  if (!isFiniteNumber(total) || total <= 0) {
    return viewports.map((viewport) => ({
      ...viewport,
      weight: 1 / viewports.length,
    }));
  }
  return viewports.map((viewport) => ({
    ...viewport,
    weight: viewport.weight / total,
  }));
};

const enumerateMetadataScreens = (metadata) => {
  if (
    isPlainRecord(metadata) &&
    Array.isArray(metadata.screens) &&
    metadata.screens.length > 0
  ) {
    const screens = [];
    for (const screen of metadata.screens) {
      if (!isPlainRecord(screen)) {
        continue;
      }
      const screenId = normalizeOptionalString(screen.screenId);
      if (screenId === null) {
        continue;
      }
      screens.push({
        screenId,
        screenName: normalizeOptionalString(screen.screenName),
        viewports: normalizeViewportList(screen.viewports),
      });
    }
    if (screens.length > 0) {
      return screens;
    }
  }

  const fallbackScreenId = normalizeOptionalString(metadata?.source?.nodeId);
  return fallbackScreenId === null
    ? []
    : [
        {
          screenId: fallbackScreenId,
          screenName: normalizeOptionalString(metadata?.source?.nodeName),
          viewports: undefined,
        },
      ];
};

const resolveConfiguredViewports = (
  qualityConfig,
  fixtureId,
  screenId,
  screenName,
) => {
  if (!isPlainRecord(qualityConfig)) {
    return undefined;
  }
  const fixtures = isPlainRecord(qualityConfig.fixtures)
    ? qualityConfig.fixtures
    : undefined;
  const fixtureConfig =
    fixtures !== undefined && isPlainRecord(fixtures[fixtureId])
      ? fixtures[fixtureId]
      : undefined;
  const screenConfigs = isPlainRecord(fixtureConfig?.screens)
    ? fixtureConfig.screens
    : undefined;
  const byScreenId =
    screenConfigs !== undefined &&
    typeof screenId === "string" &&
    screenId.trim().length > 0 &&
    isPlainRecord(screenConfigs[screenId])
      ? normalizeViewportList(screenConfigs[screenId].viewports)
      : undefined;
  const byScreenName =
    screenConfigs !== undefined &&
    typeof screenName === "string" &&
    screenName.trim().length > 0 &&
    isPlainRecord(screenConfigs[screenName])
      ? normalizeViewportList(screenConfigs[screenName].viewports)
      : undefined;
  const fixtureLevel = normalizeViewportList(fixtureConfig?.viewports);
  const globalLevel = normalizeViewportList(qualityConfig.viewports);
  return byScreenId ?? byScreenName ?? fixtureLevel ?? globalLevel;
};

const resolveScreenViewportSpecs = (
  metadata,
  qualityConfig,
  fixtureId,
  screenId,
  screenName,
) => {
  const screens = enumerateMetadataScreens(metadata);
  const normalizedScreenId = normalizeOptionalString(screenId) ?? fixtureId;
  const matchedScreen =
    screens.find((screen) => screen.screenId === normalizedScreenId) ??
    screens.find((screen) => screen.screenName === normalizeOptionalString(screenName));
  if (matchedScreen?.viewports !== undefined && matchedScreen.viewports.length > 0) {
    return matchedScreen.viewports;
  }
  return resolveConfiguredViewports(
    qualityConfig,
    fixtureId,
    normalizedScreenId,
    normalizeOptionalString(screenName) ?? matchedScreen?.screenName ?? undefined,
  );
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

const formatScore = (value) =>
  value % 1 === 0 ? String(value) : value.toFixed(1);

const normalizeSkipReasonCounts = (value) => {
  if (!isPlainRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([reason, count]) =>
          typeof reason === "string" &&
          reason.trim().length > 0 &&
          isFiniteNumber(count) &&
          count >= 0,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};

const normalizeComponentCoverage = (value) => {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (
    !isFiniteNumber(value.comparedCount) ||
    !isFiniteNumber(value.skippedCount) ||
    !isFiniteNumber(value.coveragePercent)
  ) {
    return null;
  }
  return {
    comparedCount: value.comparedCount,
    skippedCount: value.skippedCount,
    coveragePercent: roundToTwo(value.coveragePercent),
    bySkipReason: normalizeSkipReasonCounts(value.bySkipReason),
  };
};

const normalizeWarnings = (value) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const warnings = value
    .filter((warning) => typeof warning === "string" && warning.trim().length > 0)
    .map((warning) => warning.trim());
  return warnings.length > 0 ? warnings : undefined;
};

const normalizeComponentEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    const componentId = normalizeOptionalString(entry.componentId);
    const componentName = normalizeOptionalString(entry.componentName);
    if (componentId === null || componentName === null) {
      continue;
    }
    const status = entry.status;
    if (status !== "compared" && status !== "skipped") {
      continue;
    }
    const warnings = normalizeWarnings(entry.warnings);
    normalized.push({
      componentId,
      componentName,
      status,
      ...(isFiniteNumber(entry.score) ? { score: roundToTwo(entry.score) } : {}),
      ...(normalizeOptionalString(entry.diffImagePath)
        ? { diffImagePath: normalizeOptionalString(entry.diffImagePath) }
        : {}),
      ...(normalizeOptionalString(entry.reportPath)
        ? { reportPath: normalizeOptionalString(entry.reportPath) }
        : {}),
      ...(normalizeOptionalString(entry.skipReason)
        ? { skipReason: normalizeOptionalString(entry.skipReason) }
        : {}),
      ...(normalizeOptionalString(entry.storyEntryId)
        ? { storyEntryId: normalizeOptionalString(entry.storyEntryId) }
        : {}),
      ...(normalizeOptionalString(entry.referenceNodeId)
        ? { referenceNodeId: normalizeOptionalString(entry.referenceNodeId) }
        : {}),
      ...(warnings ? { warnings } : {}),
    });
  }
  return normalized;
};

const createComponentSummary = () => ({
  componentAggregateScore: null,
  componentCoverage: null,
  components: [],
});

const mergeComponentSummary = (summary, value) => {
  if (!isPlainRecord(value)) {
    return summary;
  }
  if (
    summary.componentAggregateScore === null &&
    isFiniteNumber(value.componentAggregateScore)
  ) {
    summary.componentAggregateScore = roundToTwo(value.componentAggregateScore);
  }
  if (summary.componentCoverage === null) {
    const coverage = normalizeComponentCoverage(value.componentCoverage);
    if (coverage !== null) {
      summary.componentCoverage = coverage;
    }
  }
  for (const component of normalizeComponentEntries(value.components)) {
    const existingIndex = summary.components.findIndex(
      (entry) => entry.componentId === component.componentId,
    );
    if (existingIndex === -1) {
      summary.components.push(component);
      continue;
    }
    summary.components.splice(existingIndex, 1, {
      ...summary.components[existingIndex],
      ...component,
      ...(component.warnings ? { warnings: [...component.warnings] } : {}),
    });
  }
  return summary;
};

const formatComponentCoverageText = (coverage) =>
  `${coverage.comparedCount} compared, ${coverage.skippedCount} skipped (${formatScore(coverage.coveragePercent)}%)`;

const formatSkipReasonSummary = (coverage) => {
  const reasons = Object.entries(coverage.bySkipReason);
  if (reasons.length === 0) {
    return null;
  }
  return reasons.map(([reason, count]) => `${reason}: ${count}`).join(", ");
};

const formatComponentNotes = (component) => {
  const notes = [];
  if (typeof component.skipReason === "string") {
    notes.push(component.skipReason);
  }
  if (Array.isArray(component.warnings) && component.warnings.length > 0) {
    notes.push(component.warnings.join("; "));
  }
  return notes.length > 0 ? notes.join(" | ") : "\u2014";
};

const isStorybookComponentArtifact = (manifest) =>
  manifest !== null &&
  typeof manifest === "object" &&
  manifest.mode === "storybook_component";

const resolveHeadlineScore = ({
  lastRun,
  viewAverage,
  componentAggregateScore,
  hasViewScores,
}) => {
  if (isFiniteNumber(lastRun.overallScore)) {
    return roundToTwo(lastRun.overallScore);
  }
  if (isFiniteNumber(lastRun.overallCurrent)) {
    return roundToTwo(lastRun.overallCurrent);
  }
  if (componentAggregateScore !== null && hasViewScores) {
    return roundToTwo(
      viewAverage * FULL_PAGE_HEADLINE_WEIGHT +
        componentAggregateScore * COMPONENT_HEADLINE_WEIGHT,
    );
  }
  if (componentAggregateScore !== null) {
    return componentAggregateScore;
  }
  return viewAverage;
};

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

const formatEscapedWarnings = (warnings, separator = "; ") =>
  warnings.map((warning) => escapeMarkdownCell(warning)).join(separator);

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

const collectArtifactCandidates = async (rootDir, maxDepth) => {
  const candidates = [];
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const manifest = await readJsonFileOptional(
      path.join(current.dir, "manifest.json"),
      `Visual benchmark manifest in '${current.dir}'`,
    );
    if (manifest !== null) {
      candidates.push({ dir: current.dir, manifest });
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    let entries = [];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
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
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      queue.push({
        dir: path.join(current.dir, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return candidates;
};

const scoreArtifactCandidate = (candidate, fixtureId, screenId, viewportId) => {
  const manifestFixtureId = normalizeOptionalString(candidate.manifest.fixtureId);
  if (manifestFixtureId !== fixtureId) {
    return null;
  }

  const normalizedScreenId = normalizeOptionalString(screenId);
  const normalizedViewportId = normalizeOptionalString(viewportId);
  const manifestScreenId = normalizeOptionalString(candidate.manifest.screenId);
  const manifestViewportId = normalizeOptionalString(candidate.manifest.viewportId);
  const candidateDirToken = path.basename(candidate.dir);
  let score = 0;

  if (normalizedScreenId !== null) {
    if (manifestScreenId === normalizedScreenId) {
      score += 8;
    } else if (manifestScreenId !== null) {
      return null;
    }
  }

  if (normalizedViewportId !== null) {
    if (manifestViewportId === normalizedViewportId) {
      score += 16;
    } else if (manifestViewportId !== null) {
      return null;
    } else if (candidateDirToken === normalizedViewportId) {
      score += 12;
    }
  } else if (manifestViewportId === null) {
    score += 2;
  }

  return score;
};

const resolveFixtureArtifactDir = async (
  lastRunDir,
  fixtureId,
  screenId,
  viewportId,
) => {
  const normalizedScreenId = normalizeOptionalString(screenId);
  const normalizedViewportId = normalizeOptionalString(viewportId);
  const fixtureRoot = path.join(lastRunDir, fixtureId);
  const candidateDirs = [];

  if (normalizedScreenId === null) {
    candidateDirs.push(fixtureRoot);
    const viewportToken = normalizePathToken(normalizedViewportId);
    if (viewportToken !== null) {
      candidateDirs.unshift(path.join(fixtureRoot, viewportToken));
    }
  } else {
    const legacyDir = getLastRunFixtureDir(
      lastRunDir,
      fixtureId,
      normalizedScreenId,
    );
    candidateDirs.push(legacyDir);
    const viewportToken = normalizePathToken(normalizedViewportId);
    if (viewportToken !== null) {
      candidateDirs.unshift(path.join(legacyDir, viewportToken));
    }
  }

  let bestCandidate = null;
  for (const dir of candidateDirs) {
    const manifest = await readJsonFileOptional(
      path.join(dir, "manifest.json"),
      `Visual benchmark manifest for '${fixtureId}'`,
    );
    if (manifest === null) {
      continue;
    }
    const score = scoreArtifactCandidate(
      { dir, manifest },
      fixtureId,
      normalizedScreenId,
      normalizedViewportId,
    );
    if (score !== null && (bestCandidate === null || score > bestCandidate.score)) {
      bestCandidate = { dir, score };
    }
  }

  if (bestCandidate !== null) {
    return bestCandidate.dir;
  }

  const searchRoot =
    normalizedScreenId === null ? fixtureRoot : path.join(fixtureRoot, "screens");
  const searchDepth = normalizedScreenId === null ? 1 : 2;
  const candidates = await collectArtifactCandidates(searchRoot, searchDepth);
  for (const candidate of candidates) {
    const score = scoreArtifactCandidate(
      candidate,
      fixtureId,
      normalizedScreenId,
      normalizedViewportId,
    );
    if (score === null) {
      continue;
    }
    if (bestCandidate === null || score > bestCandidate.score) {
      bestCandidate = {
        dir: candidate.dir,
        score,
      };
    }
  }

  if (bestCandidate !== null) {
    return bestCandidate.dir;
  }
  return candidateDirs[0] ?? fixtureRoot;
};

const joinLines = (lines) => lines.join("\n");

const buildBoundedCommentBody = ({
  headerLines,
  tableHeaderLines,
  tableRowLines,
  componentSectionLines,
  crossBrowserSectionLines,
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

  if (!truncated && componentSectionLines.length > 0) {
    if (!canAppend(componentSectionLines, true)) {
      truncated = true;
    } else {
      lines.push(...componentSectionLines);
    }
  }

  if (!truncated && crossBrowserSectionLines.length > 0) {
    if (!canAppend(crossBrowserSectionLines, true)) {
      truncated = true;
    } else {
      lines.push(...crossBrowserSectionLines);
    }
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

const computeScreenAggregateMap = async ({
  rows,
  qualityConfig,
  metadataCache,
}) => {
  const groupedRows = new Map();
  for (const row of rows) {
    const key = getScreenAggregateKey(row.fixtureId, row.screenId);
    const existing = groupedRows.get(key);
    if (existing !== undefined) {
      existing.rows.push(row);
      continue;
    }
    groupedRows.set(key, {
      fixtureId: row.fixtureId,
      screenId: normalizeOptionalString(row.screenId) ?? row.fixtureId,
      screenName: normalizeOptionalString(row.screenName),
      rows: [row],
    });
  }

  const aggregateMap = new Map();
  for (const [screenKey, group] of groupedRows.entries()) {
    const byViewport = new Map();
    for (const row of group.rows) {
      const viewportId = normalizeOptionalString(row.viewportId) ?? "default";
      byViewport.set(viewportId, row.score);
    }
    if (byViewport.size <= 1) {
      aggregateMap.set(screenKey, {
        fixtureId: group.fixtureId,
        screenId: group.screenId,
        screenName: group.screenName,
        score: group.rows[0]?.score ?? 0,
      });
      continue;
    }

    let metadata = metadataCache.get(group.fixtureId);
    if (metadata === undefined) {
      const metadataPath = path.join(
        "integration",
        "fixtures",
        "visual-benchmark",
        group.fixtureId,
        "metadata.json",
      );
      metadata = await readJsonFileOptional(
        metadataPath,
        `Visual benchmark metadata for '${group.fixtureId}'`,
      );
      metadataCache.set(group.fixtureId, metadata);
    }

    const viewportSpecs = resolveScreenViewportSpecs(
      metadata,
      qualityConfig,
      group.fixtureId,
      group.screenId,
      group.screenName,
    );
    if (!Array.isArray(viewportSpecs) || viewportSpecs.length === 0) {
      aggregateMap.set(screenKey, {
        fixtureId: group.fixtureId,
        screenId: group.screenId,
        screenName: group.screenName,
        score: roundToTwo(
          group.rows.reduce((sum, row) => sum + row.score, 0) /
            group.rows.length,
        ),
      });
      continue;
    }

    const matchedSpecs = viewportSpecs.filter((viewport) =>
      byViewport.has(viewport.id),
    );
    if (matchedSpecs.length !== byViewport.size) {
      aggregateMap.set(screenKey, {
        fixtureId: group.fixtureId,
        screenId: group.screenId,
        screenName: group.screenName,
        score: roundToTwo(
          group.rows.reduce((sum, row) => sum + row.score, 0) /
            group.rows.length,
        ),
      });
      continue;
    }

    const normalizedSpecs = normalizeViewportWeights(matchedSpecs);
    const weightedScore = normalizedSpecs.reduce(
      (sum, viewport) =>
        sum + (byViewport.get(viewport.id) ?? 0) * (viewport.weight ?? 0),
      0,
    );
    aggregateMap.set(screenKey, {
      fixtureId: group.fixtureId,
      screenId: group.screenId,
      screenName: group.screenName,
      score: roundToTwo(weightedScore),
    });
  }

  return aggregateMap;
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

  // H4/#838 fix: baseline entries are composite-keyed by fixture, screen, and
  // viewport so multi-screen and multi-viewport rows cannot collide.
  const baselineScoreMap = new Map();
  if (baseline !== null && Array.isArray(baseline.scores)) {
    for (const entry of baseline.scores) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.fixtureId === "string" &&
        isFiniteNumber(entry.score)
      ) {
        const key = getCompositeKey(
          entry.fixtureId,
          entry.screenId,
          entry.viewportId,
        );
        baselineScoreMap.set(key, entry.score);
      }
    }
  }

  const artifactRoot = path.dirname(absolutePath);
  const lastRunDir = path.join(artifactRoot, "last-run");
  const isPublicSummaryArtifact =
    path.basename(absolutePath) === "last-run.public.json" ||
    absolutePath.includes(`${path.sep}public-summary${path.sep}`);
  const fullPageFixtures = [];
  const componentSummary = mergeComponentSummary(
    createComponentSummary(),
    lastRun,
  );

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

    let manifest = null;
    let reportDimensions = null;
    let diffArtifactPath = null;
    let reportRaw = null;
    let viewportText = "\u2014";
    try {
      const fixtureDir = await resolveFixtureArtifactDir(
        lastRunDir,
        entry.fixtureId,
        entry.screenId,
        entry.viewportId,
      );
      const manifestPath = path.join(fixtureDir, "manifest.json");
      const reportJsonPath = path.join(fixtureDir, "report.json");

      manifest = await readJsonFile(
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
      viewportText = `${viewport.width}\u00d7${viewport.height}`;

      diffArtifactPath =
        path.relative(artifactRoot, path.join(fixtureDir, "diff.png")) || ".";
      reportRaw = await readJsonFileOptional(
        reportJsonPath,
        `Visual benchmark report for '${entry.fixtureId}'`,
      );
      if (
        reportRaw !== null &&
        typeof reportRaw.diffImagePath === "string" &&
        reportRaw.diffImagePath.trim().length > 0
      ) {
        diffArtifactPath =
          path.relative(
            artifactRoot,
            path.resolve(fixtureDir, path.basename(reportRaw.diffImagePath)),
          ) || ".";
      }
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
      if (reportRaw !== null) {
        mergeComponentSummary(componentSummary, reportRaw);
      }
    } catch (error) {
      if (!isPublicSummaryArtifact) {
        throw error;
      }
    }

    const compositeKey = getCompositeKey(
      entry.fixtureId,
      entry.screenId,
      entry.viewportId,
    );
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

    const fixtureSummary = {
      fixtureId: entry.fixtureId,
      screenId: normalizeOptionalString(entry.screenId ?? manifest?.screenId),
      screenName: normalizeOptionalString(
        entry.screenName ?? manifest?.screenName,
      ),
      viewportId: normalizeOptionalString(entry.viewportId ?? manifest?.viewportId),
      viewportLabel: normalizeOptionalString(
        entry.viewportLabel ?? manifest?.viewportLabel,
      ),
      displayLabel: toDisplayLabel(
        entry.fixtureId,
        entry.screenName ?? manifest?.screenName,
        entry.screenId ?? manifest?.screenId,
        entry.viewportLabel ?? manifest?.viewportLabel,
        entry.viewportId ?? manifest?.viewportId,
      ),
      score: entry.score,
      baselineScore,
      delta,
      indicator,
      thresholdResult: normalizeThresholdResult(manifest?.thresholdResult),
      reportDimensions,
      viewport: viewportText,
      diffArtifactPath,
      browserBreakdown: normalizeBrowserBreakdown(manifest?.browserBreakdown),
      crossBrowserConsistency: normalizeCrossBrowserConsistency(
        manifest?.crossBrowserConsistency,
      ),
      perBrowser: normalizePerBrowserArtifacts(manifest?.perBrowser),
    };
    if (!isStorybookComponentArtifact(manifest)) {
      fullPageFixtures.push(fixtureSummary);
    }
  }

  const hasComponentResults =
    componentSummary.componentAggregateScore !== null ||
    componentSummary.components.length > 0;
  if (fullPageFixtures.length === 0 && !hasComponentResults) {
    throw new Error(
      `Visual benchmark last-run report at '${absolutePath}' contains no valid score entries.`,
    );
  }

  const qualityConfig = await readJsonFileOptional(
    path.join(
      "integration",
      "fixtures",
      "visual-benchmark",
      "visual-quality.config.json",
    ),
    "Visual quality config",
  );
  const metadataCache = new Map();
  const currentScreenAggregateMap = await computeScreenAggregateMap({
    rows: fullPageFixtures,
    qualityConfig,
    metadataCache,
  });
  const baselineRowsForAggregation =
    baseline !== null && Array.isArray(baseline.scores)
      ? baseline.scores.filter(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.fixtureId === "string" &&
            isFiniteNumber(entry.score),
        )
      : [];
  const baselineScreenAggregateMap = await computeScreenAggregateMap({
    rows: baselineRowsForAggregation,
    qualityConfig,
    metadataCache,
  });

  const viewAverage =
    isFiniteNumber(lastRun.screenAggregateScore)
      ? roundToTwo(lastRun.screenAggregateScore)
      : currentScreenAggregateMap.size > 0
      ? roundToTwo(
          Array.from(currentScreenAggregateMap.values()).reduce(
            (sum, fixture) => sum + fixture.score,
            0,
          ) / currentScreenAggregateMap.size,
        )
      : 0;
  const overallAverage = resolveHeadlineScore({
    lastRun,
    viewAverage,
    componentAggregateScore: componentSummary.componentAggregateScore,
    hasViewScores: fullPageFixtures.length > 0,
  });
  const overallBrowserBreakdown = formatBrowserBreakdown(lastRun.browserBreakdown);
  const overallCrossBrowserConsistency = normalizeCrossBrowserConsistency(
    lastRun.crossBrowserConsistency,
  );

  const comparablePairs = [];
  for (const [screenKey, currentScreen] of currentScreenAggregateMap.entries()) {
    const baselineScreen = baselineScreenAggregateMap.get(screenKey);
    if (baselineScreen === undefined) {
      continue;
    }
    comparablePairs.push({
      current: currentScreen.score,
      baseline: baselineScreen.score,
    });
  }
  const overallBaselineAvg =
    comparablePairs.length > 0
      ? roundToTwo(
          comparablePairs.reduce((sum, pair) => sum + pair.baseline, 0) /
            comparablePairs.length,
        )
      : null;
  const comparableCurrentAvg =
    comparablePairs.length > 0
      ? roundToTwo(
          comparablePairs.reduce((sum, pair) => sum + pair.current, 0) /
            comparablePairs.length,
        )
      : null;
  const compositeQuality = await loadCompositeQualityReport(absolutePath);

  const overallDelta =
    overallBaselineAvg !== null && comparableCurrentAvg !== null
      ? roundToTwo(comparableCurrentAvg - overallBaselineAvg)
      : null;
  const excludedFixtureCount =
    currentScreenAggregateMap.size - comparablePairs.length;

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
      comparablePairs.length === 1
        ? "across 1 comparable view"
        : `across ${comparablePairs.length} comparable views`;
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
    `${scoreEmoji(overallAverage)} **Overall Score:** ${formatScore(overallAverage)} / 100${overallDeltaText}`,
  ];

  if (
    componentSummary.componentAggregateScore !== null &&
    fullPageFixtures.length > 0
  ) {
    headerLines.push(
      `**Full-Page Average:** ${formatScore(viewAverage)} / 100`,
    );
  }
  if (componentSummary.componentAggregateScore !== null) {
    headerLines.push(
      `**Component Aggregate:** ${formatScore(componentSummary.componentAggregateScore)} / 100`,
    );
  }
  if (componentSummary.componentCoverage !== null) {
    headerLines.push(
      `**Component Coverage:** ${formatComponentCoverageText(componentSummary.componentCoverage)}`,
    );
    headerLines.push(
      `**Skipped Components:** ${componentSummary.componentCoverage.skippedCount}`,
    );
    const skipReasonSummary = formatSkipReasonSummary(
      componentSummary.componentCoverage,
    );
    if (skipReasonSummary !== null) {
      headerLines.push(`**Skipped By Reason:** ${skipReasonSummary}`);
    }
  }
  if (overallBrowserBreakdown !== null) {
    headerLines.push(`**Per-Browser Averages:** ${overallBrowserBreakdown}`);
  }
  if (overallCrossBrowserConsistency !== null) {
    headerLines.push(
      `**Cross-Browser Consistency:** ${overallCrossBrowserConsistency.consistencyScore} / 100`,
    );
  }
  if (compositeQuality !== null) {
    headerLines.push(
      "",
      "### Combined Visual + Performance Quality",
      "",
      `**Visual Score:** ${formatScoreOrUnavailable(compositeQuality.visual?.score ?? null)}`,
      `**Performance Score:** ${formatScoreOrUnavailable(compositeQuality.performance?.score ?? null)}`,
      `**Composite Score:** ${formatScoreOrUnavailable(compositeQuality.composite?.score ?? null)}`,
    );
    if (compositeQuality.weights !== null) {
      headerLines.push(
        `**Weights:** visual ${formatPercent(compositeQuality.weights.visual)}, performance ${formatPercent(compositeQuality.weights.performance)}`,
      );
    }
    if (compositeQuality.performance?.aggregateMetrics != null) {
      const metrics = compositeQuality.performance.aggregateMetrics;
      headerLines.push(
        `**Lighthouse Metrics:** FCP ${formatMetricOrUnavailable(metrics.fcp_ms, " ms")}, LCP ${formatMetricOrUnavailable(metrics.lcp_ms, " ms")}, CLS ${formatMetricOrUnavailable(metrics.cls)}, TBT ${formatMetricOrUnavailable(metrics.tbt_ms, " ms")}, Speed Index ${formatMetricOrUnavailable(metrics.speed_index_ms, " ms")}`,
      );
    }
    if (compositeQuality.warnings.length > 0) {
      headerLines.push(
        `**Composite Warnings:** ${formatEscapedWarnings(compositeQuality.warnings)}`,
      );
    }
  }
  headerLines.push("");

  const tableHeaderLines =
    fullPageFixtures.length > 0
      ? [
          "| View | Score | Baseline | Delta | Trend | Threshold | Viewport |",
          "|------|-------|----------|-------|-------|-----------|----------|",
        ]
      : [];

  const tableRowLines = [];
  for (const fixture of fullPageFixtures) {
    const baselineText =
      fixture.baselineScore !== null ? String(fixture.baselineScore) : "\u2014";
    const deltaText =
      fixture.delta !== null
        ? `${fixture.delta > 0 ? "+" : ""}${fixture.delta}`
        : "\u2014";
    const trend = trendText(fixture.indicator);
    const thresholdText =
      fixture.thresholdResult === null
        ? "\u2014"
        : `${fixture.thresholdResult.verdict} (${formatThresholdLabel(fixture.thresholdResult.thresholds)})`;
    tableRowLines.push([
      `| ${escapeMarkdownCell(fixture.displayLabel)} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${escapeMarkdownCell(baselineText)} | ${escapeMarkdownCell(deltaText)} | ${escapeMarkdownCell(trend)} | ${escapeMarkdownCell(thresholdText)} | ${escapeMarkdownCell(fixture.viewport)} |`,
      ]);
  }

  const componentSectionLines = [];
  if (componentSummary.components.length > 0) {
    componentSectionLines.push(
      "",
      "### Component Results",
      "",
      "| Component | Status | Score | Story | Notes |",
      "|-----------|--------|-------|-------|-------|",
    );
    for (const component of componentSummary.components) {
      const scoreText =
        component.status === "compared" && isFiniteNumber(component.score)
          ? `${scoreEmoji(component.score)} ${formatScore(component.score)}`
          : "\u2014";
      componentSectionLines.push(
        `| ${escapeMarkdownCell(component.componentName)} | ${escapeMarkdownCell(component.status)} | ${escapeMarkdownCell(scoreText)} | ${escapeMarkdownCell(component.storyEntryId ?? "\u2014")} | ${escapeMarkdownCell(formatComponentNotes(component))} |`,
      );
    }
  }

  const browserAwareFixtures = fullPageFixtures.filter(
    (fixture) =>
      fixture.browserBreakdown !== null ||
      fixture.crossBrowserConsistency !== null ||
      fixture.perBrowser !== null,
  );
  const crossBrowserSectionLines = [];
  if (browserAwareFixtures.length > 0) {
    crossBrowserSectionLines.push("", "### Cross-Browser Details", "");
    for (const fixture of browserAwareFixtures) {
      const detailParts = [];
      const fixtureBreakdown = formatBrowserBreakdown(fixture.browserBreakdown);
      if (fixtureBreakdown !== null) {
        detailParts.push(`scores ${fixtureBreakdown}`);
      }
      if (fixture.crossBrowserConsistency !== null) {
        detailParts.push(
          `consistency ${fixture.crossBrowserConsistency.consistencyScore} / 100`,
        );
        if (
          Array.isArray(fixture.crossBrowserConsistency.warnings) &&
          fixture.crossBrowserConsistency.warnings.length > 0
        ) {
          detailParts.push(
            `warnings ${formatEscapedWarnings(
              fixture.crossBrowserConsistency.warnings,
              ", ",
            )}`,
          );
        }
        if (fixture.crossBrowserConsistency.pairwiseDiffs.length > 0) {
          detailParts.push(
            `pairwise ${fixture.crossBrowserConsistency.pairwiseDiffs
              .map((pair) => {
                const pathText = pair.diffImagePath
                  ? artifactUrl
                    ? ` ([View pair diff](${artifactUrl}) \`${escapeMarkdownCell(pair.diffImagePath)}\`)`
                    : ` (\`${escapeMarkdownCell(pair.diffImagePath)}\`)`
                  : "";
                return `${pair.browserA}/${pair.browserB}: ${pair.diffPercent}%${pathText}`;
              })
              .join(", ")}`,
          );
        }
      }
      if (fixture.perBrowser !== null) {
        detailParts.push(
          `artifacts ${fixture.perBrowser
            .map((entry) => {
              const refs = [
                entry.actualImagePath
                  ? artifactUrl
                    ? `[actual](${artifactUrl}) \`${escapeMarkdownCell(entry.actualImagePath)}\``
                    : `actual \`${escapeMarkdownCell(entry.actualImagePath)}\``
                  : null,
                entry.diffImagePath
                  ? artifactUrl
                    ? `[diff](${artifactUrl}) \`${escapeMarkdownCell(entry.diffImagePath)}\``
                    : `diff \`${escapeMarkdownCell(entry.diffImagePath)}\``
                  : null,
                entry.reportPath
                  ? artifactUrl
                    ? `[report](${artifactUrl}) \`${escapeMarkdownCell(entry.reportPath)}\``
                    : `report \`${escapeMarkdownCell(entry.reportPath)}\``
                  : null,
              ].filter((value) => value !== null);
              const warningText =
                Array.isArray(entry.warnings) && entry.warnings.length > 0
                  ? ` warnings ${formatEscapedWarnings(entry.warnings, ", ")}`
                  : "";
              return `${entry.browser}: ${entry.overallScore}${refs.length > 0 ? ` (${refs.join(", ")})` : ""}${warningText}`;
            })
            .join("; ")}`,
        );
      }
      crossBrowserSectionLines.push(
        `- ${escapeMarkdownCell(fixture.displayLabel)}: ${detailParts.join("; ")}`,
      );
    }
  }

  const diffSectionHeaderLines =
    artifactUrl &&
    fullPageFixtures.some(
      (fixture) =>
        typeof fixture.diffArtifactPath === "string" &&
        fixture.diffArtifactPath.length > 0,
    )
      ? ["", "### Diff Images", "", "| View | Diff |", "|------|------|"]
      : [];
  const diffRowLines = artifactUrl
    ? fullPageFixtures
        .filter(
          (fixture) =>
            typeof fixture.diffArtifactPath === "string" &&
            fixture.diffArtifactPath.length > 0,
        )
        .map((fixture) => [
          `| ${escapeMarkdownCell(fixture.displayLabel)} | [View diff](${artifactUrl}) \`${escapeMarkdownCell(fixture.diffArtifactPath)}\` |`,
        ])
    : [];

  const fixturesWithDimensions = fullPageFixtures.filter(
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
    componentSectionLines,
    crossBrowserSectionLines,
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
