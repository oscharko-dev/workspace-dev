import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ANNOTATION_PATH =
  "integration/fixtures/visual-benchmark/visual-quality.config.json";
const FULL_PAGE_HEADLINE_WEIGHT = 0.7;
const COMPONENT_HEADLINE_WEIGHT = 0.3;

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

const normalizeOptionalString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const roundToTwo = (value) => Math.round(value * 100) / 100;

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

const getScreenAggregateKey = (fixtureId, screenId) => {
  const normalizedScreenId =
    typeof screenId === "string" && screenId.trim().length > 0
      ? screenId.trim()
      : fixtureId;
  return `${fixtureId}::${normalizedScreenId}`;
};

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

const toLegacyScreenIdToken = (screenId) => screenId.replace(/:/gu, "_");
const normalizePathToken = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._-]+$/u.test(value.trim())
    ? value.trim()
    : null;

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
    path: safeRelativePath(compositePath),
    weights,
    visual,
    performance,
    composite,
    warnings,
  };
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

const computeOverallAverageFromFixtures = async (fixtures) => {
  const qualityConfig = await readJsonFileOptional(
    ANNOTATION_PATH,
    "Visual quality config",
  );
  const metadataCache = new Map();
  const screenGroups = new Map();

  for (const fixture of fixtures) {
    const screenKey = getScreenAggregateKey(fixture.fixtureId, fixture.screenId);
    const existing = screenGroups.get(screenKey);
    if (existing !== undefined) {
      existing.rows.push(fixture);
      continue;
    }
    screenGroups.set(screenKey, {
      fixtureId: fixture.fixtureId,
      screenId: normalizeOptionalString(fixture.screenId) ?? fixture.fixtureId,
      screenName: normalizeOptionalString(fixture.screenName),
      rows: [fixture],
    });
  }

  const screenScores = [];
  for (const group of screenGroups.values()) {
    const byViewport = new Map();
    for (const row of group.rows) {
      const viewportId = normalizeOptionalString(row.viewportId) ?? "default";
      byViewport.set(viewportId, row.score);
    }
    if (byViewport.size <= 1) {
      screenScores.push(group.rows[0]?.score ?? 0);
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
      screenScores.push(
        roundToTwo(
          group.rows.reduce((sum, row) => sum + row.score, 0) / group.rows.length,
        ),
      );
      continue;
    }

    const matchedViewportSpecs = viewportSpecs.filter((viewport) =>
      byViewport.has(viewport.id),
    );
    if (matchedViewportSpecs.length !== byViewport.size) {
      screenScores.push(
        roundToTwo(
          group.rows.reduce((sum, row) => sum + row.score, 0) / group.rows.length,
        ),
      );
      continue;
    }

    const normalizedViewports = normalizeViewportWeights(matchedViewportSpecs);
    const weightedScore = normalizedViewports.reduce(
      (sum, viewport) =>
        sum + (byViewport.get(viewport.id) ?? 0) * (viewport.weight ?? 0),
      0,
    );
    screenScores.push(roundToTwo(weightedScore));
  }

  if (screenScores.length === 0) {
    return 0;
  }
  return roundToTwo(
    screenScores.reduce((sum, score) => sum + score, 0) / screenScores.length,
  );
};

const safeRelativePath = (filePath) =>
  path.relative(process.cwd(), filePath) || ".";

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
  const fixtureRoot = path.join(lastRunDir, fixtureId);
  const normalizedScreenId = normalizeOptionalString(screenId);
  const normalizedViewportId = normalizeOptionalString(viewportId);

  const candidateDirs = [];
  if (normalizedScreenId === null) {
    candidateDirs.push(fixtureRoot);
    const viewportToken = normalizePathToken(normalizedViewportId);
    if (viewportToken !== null) {
      candidateDirs.unshift(path.join(fixtureRoot, viewportToken));
    }
  } else {
    const screensDir = path.join(fixtureRoot, "screens");
    const legacyDir = path.join(
      screensDir,
      toLegacyScreenIdToken(normalizedScreenId),
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

const resolveHeadlineAverage = ({
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

const buildAnnotation = (fixture) => {
  if (
    fixture.thresholdResult === null ||
    fixture.thresholdResult.verdict === "pass"
  ) {
    return null;
  }

  const { thresholdResult } = fixture;
  const level = thresholdResult.verdict === "fail" ? "failure" : "warning";
  const safeDisplayName = escapeMarkdownCell(fixture.displayLabel);
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
    message: `${safeDisplayName} scored ${fixture.score} and is ${thresholdResult.verdict === "fail" ? "below fail" : "below warn"} threshold (${safeThresholds}).`,
  };
};

const buildCheckText = (
  fixtures,
  average,
  artifactRoot,
  componentSummary,
  viewAverage,
  compositeQuality,
) => {
  const lines = [
    `Overall average: ${formatScore(average)}`,
  ];

  if (componentSummary.componentAggregateScore !== null && fixtures.length > 0) {
    lines.push(`Full-page average: ${formatScore(viewAverage)}`);
  }
  if (componentSummary.componentAggregateScore !== null) {
    lines.push(
      `Component aggregate: ${formatScore(componentSummary.componentAggregateScore)}`,
    );
  }
  if (componentSummary.componentCoverage !== null) {
    lines.push(
      `Component coverage: ${formatComponentCoverageText(componentSummary.componentCoverage)}`,
    );
    const skipReasonSummary = formatSkipReasonSummary(
      componentSummary.componentCoverage,
    );
    if (skipReasonSummary !== null) {
      lines.push(`Skipped component reasons: ${skipReasonSummary}`);
    }
  }

  lines.push(`Artifacts: ${artifactRoot}`, "", "View details:");

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
      `- ${fixture.displayLabel}: score=${fixture.score}, ${thresholdText}; ${artifactText}`,
    );
  }

  if (componentSummary.components.length > 0) {
    lines.push("", "Component details:");
    for (const component of componentSummary.components) {
      lines.push(
        `- ${component.componentName}: status=${component.status}, score=${
          isFiniteNumber(component.score) ? formatScore(component.score) : "n/a"
        }, story=${component.storyEntryId ?? "n/a"}, reference=${
          component.referenceNodeId ?? "n/a"
        }, notes=${formatComponentNotes(component)}`,
      );
    }
  }

  if (compositeQuality !== null) {
    lines.push("", "Composite quality:");
    lines.push(
      `- Visual score: ${formatScoreOrUnavailable(compositeQuality.visual?.score ?? null)}`,
    );
    lines.push(
      `- Performance score: ${formatScoreOrUnavailable(compositeQuality.performance?.score ?? null)}`,
    );
    lines.push(
      `- Composite score: ${formatScoreOrUnavailable(compositeQuality.composite?.score ?? null)}`,
    );
    if (compositeQuality.weights !== null) {
      lines.push(
        `- Weights: visual ${formatPercent(compositeQuality.weights.visual)}, performance ${formatPercent(compositeQuality.weights.performance)}`,
      );
    }
    if (compositeQuality.performance?.aggregateMetrics != null) {
      const metrics = compositeQuality.performance.aggregateMetrics;
      lines.push(
        `- Lighthouse metrics: FCP ${formatMetricOrUnavailable(metrics.fcp_ms, " ms")}, LCP ${formatMetricOrUnavailable(metrics.lcp_ms, " ms")}, CLS ${formatMetricOrUnavailable(metrics.cls)}, TBT ${formatMetricOrUnavailable(metrics.tbt_ms, " ms")}, Speed Index ${formatMetricOrUnavailable(metrics.speed_index_ms, " ms")}`,
      );
    }
    if (compositeQuality.warnings.length > 0) {
      lines.push(
        `- Warnings: ${compositeQuality.warnings.join("; ")}`,
      );
    }
    lines.push(`- Report: ${compositeQuality.path}`);
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
  const fullPageFixtures = [];
  const skippedFixtureReasons = [];
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
      skippedFixtureReasons.push(
        "A score entry in last-run.json is malformed.",
      );
      continue;
    }

    const fixtureDir = await resolveFixtureArtifactDir(
      lastRunDir,
      entry.fixtureId,
      entry.screenId,
      entry.viewportId,
    );
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
    const fixtureSummary = {
      fixtureId: entry.fixtureId,
      screenId: normalizeOptionalString(entry.screenId ?? manifest.screenId),
      screenName: normalizeOptionalString(entry.screenName ?? manifest.screenName),
      displayLabel: toDisplayLabel(
        entry.fixtureId,
        entry.screenName ?? manifest.screenName,
        entry.screenId ?? manifest.screenId,
        entry.viewportLabel ?? manifest.viewportLabel,
        entry.viewportId ?? manifest.viewportId,
      ),
      score: entry.score,
      viewportId:
        normalizeOptionalString(entry.viewportId ?? manifest.viewportId) ??
        "default",
      viewport: `${viewport.width}\u00d7${viewport.height}`,
      thresholdResult,
      manifestPath: safeRelativePath(manifestPath),
      reportPath: safeRelativePath(reportJsonPath),
      actualImagePath: safeRelativePath(path.join(fixtureDir, "actual.png")),
      diffImagePath,
      browserBreakdown: normalizeBrowserBreakdown(manifest.browserBreakdown),
      crossBrowserConsistency: normalizeCrossBrowserConsistency(
        manifest.crossBrowserConsistency,
      ),
      perBrowser: normalizePerBrowserArtifacts(manifest.perBrowser),
    };
    if (!isStorybookComponentArtifact(manifest)) {
      fullPageFixtures.push(fixtureSummary);
    }
    mergeComponentSummary(componentSummary, report);
  }

  const hasComponentResults =
    componentSummary.componentAggregateScore !== null ||
    componentSummary.components.length > 0;
  if (fullPageFixtures.length === 0 && !hasComponentResults) {
    const reason =
      skippedFixtureReasons.length > 0
        ? `No valid fixture benchmark artifacts were available. ${skippedFixtureReasons[0]}`
        : "No benchmark scores were available to summarize.";
    return buildUnavailableVisualBenchmarkSummary(absolutePath, reason);
  }

  const warnedFixtures = fullPageFixtures.filter(
    (fixture) => fixture.thresholdResult?.verdict === "warn",
  );
  const failedFixtures = fullPageFixtures.filter(
    (fixture) => fixture.thresholdResult?.verdict === "fail",
  );
  const compositeQuality = await loadCompositeQualityReport(absolutePath);
  const viewAverage = isFiniteNumber(lastRun.screenAggregateScore)
    ? roundToTwo(lastRun.screenAggregateScore)
    : fullPageFixtures.length > 0
      ? await computeOverallAverageFromFixtures(fullPageFixtures)
      : 0;
  const average = resolveHeadlineAverage({
    lastRun,
    viewAverage,
    componentAggregateScore: componentSummary.componentAggregateScore,
    hasViewScores: fullPageFixtures.length > 0,
  });

  const lines = [
    "## Visual Quality Benchmark",
    "",
    `**Overall Average:** ${formatScore(average)}`,
    `**Warned Views:** ${warnedFixtures.length}`,
    `**Failed Views:** ${failedFixtures.length}`,
  ];

  if (
    componentSummary.componentAggregateScore !== null &&
    fullPageFixtures.length > 0
  ) {
    lines.push(`**Full-Page Average:** ${formatScore(viewAverage)}`);
  }
  if (componentSummary.componentAggregateScore !== null) {
    lines.push(
      `**Component Aggregate:** ${formatScore(componentSummary.componentAggregateScore)}`,
    );
  }
  if (componentSummary.componentCoverage !== null) {
    lines.push(
      `**Component Coverage:** ${formatComponentCoverageText(componentSummary.componentCoverage)}`,
    );
    lines.push(
      `**Skipped Components:** ${componentSummary.componentCoverage.skippedCount}`,
    );
    const skipReasonSummary = formatSkipReasonSummary(
      componentSummary.componentCoverage,
    );
    if (skipReasonSummary !== null) {
      lines.push(`**Skipped By Reason:** ${skipReasonSummary}`);
    }
  }
  const overallBrowserBreakdown = formatBrowserBreakdown(lastRun.browserBreakdown);
  if (overallBrowserBreakdown !== null) {
    lines.push(`**Per-Browser Averages:** ${overallBrowserBreakdown}`);
  }
  const overallCrossBrowserConsistency = normalizeCrossBrowserConsistency(
    lastRun.crossBrowserConsistency,
  );
  if (overallCrossBrowserConsistency !== null) {
    lines.push(
      `**Cross-Browser Consistency:** ${overallCrossBrowserConsistency.consistencyScore} / 100`,
    );
  }
  if (compositeQuality !== null) {
    lines.push("");
    lines.push("### Combined Visual + Performance Quality");
    lines.push("");
    lines.push(
      `**Visual Score:** ${formatScoreOrUnavailable(compositeQuality.visual?.score ?? null)}`,
    );
    lines.push(
      `**Performance Score:** ${formatScoreOrUnavailable(compositeQuality.performance?.score ?? null)}`,
    );
    lines.push(
      `**Composite Score:** ${formatScoreOrUnavailable(compositeQuality.composite?.score ?? null)}`,
    );
    if (compositeQuality.weights !== null) {
      lines.push(
        `**Weights:** visual ${formatPercent(compositeQuality.weights.visual)}, performance ${formatPercent(compositeQuality.weights.performance)}`,
      );
    }
    if (compositeQuality.performance?.aggregateMetrics != null) {
      const metrics = compositeQuality.performance.aggregateMetrics;
      lines.push(
        `**Lighthouse Metrics:** FCP ${formatMetricOrUnavailable(metrics.fcp_ms, " ms")}, LCP ${formatMetricOrUnavailable(metrics.lcp_ms, " ms")}, CLS ${formatMetricOrUnavailable(metrics.cls)}, TBT ${formatMetricOrUnavailable(metrics.tbt_ms, " ms")}, Speed Index ${formatMetricOrUnavailable(metrics.speed_index_ms, " ms")}`,
      );
    }
    if (compositeQuality.warnings.length > 0) {
      lines.push(
        `**Composite Warnings:** ${compositeQuality.warnings.join("; ")}`,
      );
    }
  }

  if (fullPageFixtures.length > 0) {
    lines.push(
      "",
      "| View | Score | Threshold | Viewport |",
      "|------|-------|-----------|----------|",
    );

    for (const fixture of fullPageFixtures) {
      const thresholdLabel =
        fixture.thresholdResult === null
          ? "\u2014"
          : `${fixture.thresholdResult.verdict} (${formatThresholdLabel(fixture.thresholdResult.thresholds)})`;
      const safeDisplayName = escapeMarkdownCell(fixture.displayLabel);
      const safeThresholdLabel = escapeMarkdownCell(thresholdLabel);
      const safeViewport = escapeMarkdownCell(fixture.viewport);
      lines.push(
        `| ${safeDisplayName} | ${scoreEmoji(fixture.score)} ${fixture.score} | ${safeThresholdLabel} | ${safeViewport} |`,
      );
    }
  }

  lines.push("");
  lines.push(
    fullPageFixtures.length > 0
      ? "Artifacts include `actual.png`, `diff.png`, and `report.json` for each benchmark artifact under `artifacts/visual-benchmark/last-run/`."
      : "Artifacts include `actual.png`, `diff.png`, and `report.json` for benchmark artifacts under `artifacts/visual-benchmark/last-run/`.",
  );
  const browserAwareFixtures = fullPageFixtures.filter(
    (fixture) =>
      fixture.browserBreakdown !== null ||
      fixture.crossBrowserConsistency !== null ||
      fixture.perBrowser !== null,
  );
  if (browserAwareFixtures.length > 0) {
    lines.push("", "### Cross-Browser Details", "");
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
            `warnings ${fixture.crossBrowserConsistency.warnings.join(", ")}`,
          );
        }
        if (fixture.crossBrowserConsistency.pairwiseDiffs.length > 0) {
          detailParts.push(
            `pairwise ${fixture.crossBrowserConsistency.pairwiseDiffs
              .map((pair) =>
                `${pair.browserA}/${pair.browserB}: ${pair.diffPercent}%${pair.diffImagePath ? ` (${pair.diffImagePath})` : ""}`,
              )
              .join(", ")}`,
          );
        }
      }
      if (fixture.perBrowser !== null) {
        detailParts.push(
          `artifacts ${fixture.perBrowser
            .map((entry) =>
              `${entry.browser}: ${entry.overallScore}${entry.diffImagePath ? ` (${entry.diffImagePath})` : entry.actualImagePath ? ` (${entry.actualImagePath})` : ""}`,
            )
            .join(", ")}`,
        );
      }
      lines.push(
        `- ${escapeMarkdownCell(fixture.displayLabel)}: ${detailParts.join("; ")}`,
      );
    }
  }
  if (componentSummary.components.length > 0) {
    lines.push("");
    lines.push("### Component Results");
    lines.push("");
    lines.push("| Component | Status | Score | Story | Notes |");
    lines.push("|-----------|--------|-------|-------|-------|");
    for (const component of componentSummary.components) {
      const scoreText =
        component.status === "compared" && isFiniteNumber(component.score)
          ? `${scoreEmoji(component.score)} ${formatScore(component.score)}`
          : "\u2014";
      lines.push(
        `| ${escapeMarkdownCell(component.componentName)} | ${escapeMarkdownCell(component.status)} | ${escapeMarkdownCell(scoreText)} | ${escapeMarkdownCell(component.storyEntryId ?? "\u2014")} | ${escapeMarkdownCell(formatComponentNotes(component))} |`,
      );
    }
  }
  if (skippedFixtureReasons.length > 0) {
    lines.push("");
    lines.push(
      `_Skipped views: ${skippedFixtureReasons.length} (invalid or missing artifacts)._`,
    );
  }
  lines.push("");
  lines.push(`_Ran at ${lastRun.ranAt}_`);

  const markdown = lines.join("\n");
  const annotations = fullPageFixtures
    .map((fixture) => buildAnnotation(fixture))
    .filter((annotation) => annotation !== null);

  return {
    markdown,
    check: {
      title: `Visual benchmark: ${formatScore(average)} average (${warnedFixtures.length} warn, ${failedFixtures.length} fail)`,
      summary: markdown,
      text: buildCheckText(
        fullPageFixtures,
        average,
        path.relative(process.cwd(), artifactRoot) || ".",
        componentSummary,
        viewAverage,
        compositeQuality,
      ),
      annotations,
    },
    counts: {
      total: fullPageFixtures.length,
      warn: warnedFixtures.length,
      fail: failedFixtures.length,
    },
  };
};
