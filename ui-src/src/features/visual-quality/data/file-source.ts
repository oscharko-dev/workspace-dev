import {
  parseHistory,
  parseLastRun,
  parseScreenReport,
  parseStandaloneVisualQualityReport,
  parseVisualParityReport,
} from "./report-schema";
import {
  mergeReport,
  screenKey,
  screenKeyFromToken,
  toScreenIdToken,
  type ScreenArtifacts,
} from "./report-loader";
import {
  type HistoryRuns,
  type LastRunAggregate,
  type MergedReport,
  type ScoreEntry,
  type ScreenReport,
  type StandaloneVisualQualityReport,
  type VisualParitySummary,
} from "./types";

interface PickedFile {
  readonly name: string;
  readonly path: string;
  readonly file: File;
}

interface BenchmarkReferenceMaps {
  readonly fixture: Record<string, string>;
  readonly screen: Record<string, string>;
  readonly viewport: Record<string, string>;
}

interface BenchmarkCollectedArtifacts {
  readonly artifactsByKey: Record<string, ScreenArtifacts>;
  readonly legacyByFixture: Record<string, ScreenArtifacts>;
  readonly references: BenchmarkReferenceMaps;
}

interface BenchmarkArtifactLocation {
  readonly fixtureId: string;
  readonly key?: string;
  readonly legacyFixtureId?: string;
}

interface BenchmarkReferenceLocation {
  readonly fixtureId: string;
  readonly token?: string;
  readonly viewportId?: string;
}

const VISUAL_QUALITY_FIXTURE_ID = "visual-quality";
const VISUAL_QUALITY_SCREEN_ID = "visual-quality";
const VISUAL_PARITY_RAN_AT = "1970-01-01T00:00:00.000Z";

/**
 * Normalizes the best-available path for a File. `webkitRelativePath` is set
 * when the user picks a directory; otherwise we fall back to the file name.
 */
function filePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (typeof relative === "string" && relative.length > 0) {
    return normalizePath(relative);
  }
  return normalizePath(file.name);
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function stripQueryAndHash(input: string): string {
  return input.split(/[?#]/, 1)[0] ?? input;
}

function pathSegments(input: string): string[] {
  return normalizePath(input).split("/").filter((segment) => segment.length > 0);
}

function dirname(input: string): string {
  const normalized = normalizePath(input);
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return "";
  }
  return normalized.slice(0, index);
}

function basename(input: string): string {
  const normalized = normalizePath(stripQueryAndHash(input));
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return normalized;
  }
  return normalized.slice(index + 1);
}

function resolveUrl(baseUrl: string, relativePath: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(baseUrl)) {
    return new URL(relativePath, baseUrl).toString();
  }

  const basePath = stripQueryAndHash(baseUrl);
  const joined = [...pathSegments(dirname(basePath)), ...pathSegments(relativePath)].join("/");
  return basePath.startsWith("/") ? `/${joined}` : joined;
}

function blobUrl(file: File): string {
  return URL.createObjectURL(file);
}

async function readText(file: File): Promise<string> {
  return await file.text();
}

function pickByName(
  pool: PickedFile[],
  needle: string,
): PickedFile | undefined {
  return pool.find((entry) => entry.name === needle);
}

function pickByPredicate(
  pool: PickedFile[],
  predicate: (file: PickedFile) => boolean,
): PickedFile | undefined {
  return pool.find(predicate);
}

function ensureArtifactsEntry(
  pool: Record<string, ScreenArtifacts>,
  key: string,
): ScreenArtifacts {
  let entry = pool[key];
  if (!entry) {
    entry = {};
    pool[key] = entry;
  }
  return entry;
}

function parseBenchmarkArtifactPath(
  input: string,
): BenchmarkArtifactLocation | null {
  const segments = pathSegments(input);
  const lastRunIndex = segments.indexOf("last-run");
  if (lastRunIndex < 0) {
    return null;
  }
  const fixtureId = segments[lastRunIndex + 1];
  if (!fixtureId) {
    return null;
  }
  const rest = segments.slice(lastRunIndex + 2);
  const leaf = rest.at(-1);
  if (!leaf || !["report.json", "actual.png", "diff.png"].includes(leaf)) {
    return null;
  }

  if (rest.length === 1) {
    return { fixtureId, legacyFixtureId: fixtureId };
  }

  if (rest[0] !== "screens") {
    return null;
  }

  const token = rest[1];
  if (!token) {
    return null;
  }

  if (rest.length === 3) {
    return {
      fixtureId,
      key: screenKeyFromToken(fixtureId, token, "default"),
    };
  }

  if (rest.length === 4) {
    return {
      fixtureId,
      key: screenKeyFromToken(fixtureId, token, rest[2]),
    };
  }

  return null;
}

function parseBenchmarkReferencePath(
  input: string,
): BenchmarkReferenceLocation | null {
  const segments = pathSegments(input);
  const leaf = segments.at(-1);
  if (!leaf || !leaf.endsWith(".png")) {
    return null;
  }
  const screensIndex = segments.indexOf("screens");
  if (screensIndex > 0) {
    const fixtureId = segments[screensIndex - 1];
    const token = segments[screensIndex + 1];
    if (!fixtureId || !token) {
      return null;
    }
    if (leaf === "reference.png") {
      return { fixtureId, token };
    }
    return {
      fixtureId,
      token,
      viewportId: leaf.slice(0, -4),
    };
  }

  if (leaf !== "reference.png") {
    return null;
  }

  const fixtureId = segments.at(-2);
  if (!fixtureId || segments.includes("last-run")) {
    return null;
  }

  return { fixtureId };
}

async function collectBenchmarkArtifacts(
  picked: PickedFile[],
): Promise<BenchmarkCollectedArtifacts> {
  const artifactsByKey: Record<string, ScreenArtifacts> = {};
  const legacyByFixture: Record<string, ScreenArtifacts> = {};
  const references: BenchmarkReferenceMaps = {
    fixture: {},
    screen: {},
    viewport: {},
  };

  for (const item of picked) {
    if (item.name === "last-run.json" || item.name === "history.json") {
      continue;
    }

    const artifactLocation = parseBenchmarkArtifactPath(item.path);
    if (artifactLocation) {
      const target =
        artifactLocation.key !== undefined
          ? ensureArtifactsEntry(artifactsByKey, artifactLocation.key)
          : ensureArtifactsEntry(legacyByFixture, artifactLocation.fixtureId);
      if (item.name === "report.json") {
        try {
          target.report = parseScreenReport(
            JSON.parse(await readText(item.file)) as unknown,
          );
        } catch {
          // Malformed optional per-screen reports should not abort the load.
        }
      } else if (item.name === "actual.png") {
        target.actualUrl = blobUrl(item.file);
      } else if (item.name === "diff.png") {
        target.diffUrl = blobUrl(item.file);
      }
      continue;
    }

    const referenceLocation = parseBenchmarkReferencePath(item.path);
    if (!referenceLocation) {
      continue;
    }
    const url = blobUrl(item.file);
    if (referenceLocation.viewportId && referenceLocation.token) {
      references.viewport[
        screenKeyFromToken(
          referenceLocation.fixtureId,
          referenceLocation.token,
          referenceLocation.viewportId,
        )
      ] = url;
      continue;
    }
    if (referenceLocation.token) {
      references.screen[
        `${referenceLocation.fixtureId}/${referenceLocation.token}`
      ] = url;
      continue;
    }
    references.fixture[referenceLocation.fixtureId] = url;
  }

  return {
    artifactsByKey,
    legacyByFixture,
    references,
  };
}

function applyBenchmarkReferences(
  aggregate: LastRunAggregate,
  artifactsByKey: Record<string, ScreenArtifacts>,
  legacyByFixture: Record<string, ScreenArtifacts>,
  references: BenchmarkReferenceMaps,
): void {
  const scoresByFixture = new Map<string, ScoreEntry[]>();
  for (const score of aggregate.scores) {
    const existing = scoresByFixture.get(score.fixtureId);
    if (existing) {
      existing.push(score);
    } else {
      scoresByFixture.set(score.fixtureId, [score]);
    }
  }

  for (const score of aggregate.scores) {
    const key = screenKey(score.fixtureId, score.screenId, score.viewportId);
    const token = toScreenIdToken(score.screenId?.trim() || score.fixtureId);
    const entry = ensureArtifactsEntry(artifactsByKey, key);
    const resolvedReference =
      entry.referenceUrl ??
      references.viewport[key] ??
      references.screen[`${score.fixtureId}/${token}`] ??
      references.fixture[score.fixtureId];
    if (resolvedReference) {
      entry.referenceUrl = resolvedReference;
    }
  }

  for (const [fixtureId, legacyArtifacts] of Object.entries(legacyByFixture)) {
    const scores = scoresByFixture.get(fixtureId) ?? [];
    if (scores.length !== 1) {
      continue;
    }
    const score = scores[0];
    if (!score) {
      continue;
    }
    const key = screenKey(score.fixtureId, score.screenId, score.viewportId);
    const entry = ensureArtifactsEntry(artifactsByKey, key);
    if (legacyArtifacts.report) {
      entry.report = legacyArtifacts.report;
    }
    if (legacyArtifacts.actualUrl) {
      entry.actualUrl = legacyArtifacts.actualUrl;
    }
    if (legacyArtifacts.diffUrl) {
      entry.diffUrl = legacyArtifacts.diffUrl;
    }
  }
}

async function parseOptionalHistory(
  file: PickedFile | undefined,
): Promise<HistoryRuns | null> {
  if (!file) {
    return null;
  }
  try {
    return parseHistory(JSON.parse(await readText(file.file)) as unknown);
  } catch {
    return null;
  }
}

async function buildBenchmarkReportFromFiles(
  picked: PickedFile[],
): Promise<MergedReport> {
  const lastRunFile = pickByName(picked, "last-run.json");
  if (!lastRunFile) {
    throw new Error("last-run.json was not found in the selected files.");
  }

  const aggregate = parseLastRun(
    JSON.parse(await readText(lastRunFile.file)) as unknown,
  );
  const history = await parseOptionalHistory(pickByName(picked, "history.json"));
  const collected = await collectBenchmarkArtifacts(picked);
  applyBenchmarkReferences(
    aggregate,
    collected.artifactsByKey,
    collected.legacyByFixture,
    collected.references,
  );
  return {
    ...mergeReport(aggregate, collected.artifactsByKey, history),
    sourceKind: "benchmark",
  };
}

function buildStandaloneWarnings(
  report: StandaloneVisualQualityReport,
): string[] {
  const warnings = [...(report.warnings ?? [])];
  if (report.message) {
    warnings.push(report.message);
  }
  return warnings;
}

function toStandaloneScreenReport(
  report: StandaloneVisualQualityReport,
): ScreenReport {
  const metadata = report.metadata
    ? {
        ...(report.metadata.imageWidth !== undefined
          ? { imageWidth: report.metadata.imageWidth }
          : {}),
        ...(report.metadata.imageHeight !== undefined
          ? { imageHeight: report.metadata.imageHeight }
          : {}),
        ...(report.metadata.diffPixelCount !== undefined
          ? { diffPixelCount: report.metadata.diffPixelCount }
          : {}),
        ...(report.metadata.totalPixels !== undefined
          ? { totalPixels: report.metadata.totalPixels }
          : {}),
        ...(report.metadata.viewport !== undefined
          ? { viewport: report.metadata.viewport }
          : {}),
      }
    : undefined;
  const perBrowser = report.perBrowser?.map((entry) => ({
    browser: entry.browser,
    overallScore: entry.overallScore,
  }));
  return {
    status: report.status === "not_requested" ? "failed" : report.status,
    overallScore:
      report.overallScore ?? (report.status === "completed" ? 100 : 0),
    dimensions: report.dimensions ?? [],
    hotspots: report.hotspots ?? [],
    ...(report.interpretation ?? report.message
      ? { interpretation: report.interpretation ?? report.message }
      : {}),
    ...(report.referenceSource ? { referenceSource: report.referenceSource } : {}),
    ...(report.capturedAt ? { capturedAt: report.capturedAt } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(perBrowser ? { perBrowser } : {}),
    ...(report.browserBreakdown ? { browserBreakdown: report.browserBreakdown } : {}),
    ...(report.crossBrowserConsistency
      ? { crossBrowserConsistency: report.crossBrowserConsistency }
      : {}),
  };
}

function buildStandaloneAggregate(
  report: StandaloneVisualQualityReport,
): LastRunAggregate {
  const viewport = report.metadata?.viewport;
  return {
    version: 2,
    ranAt:
      report.capturedAt ??
      report.metadata?.comparedAt ??
      VISUAL_PARITY_RAN_AT,
    overallScore:
      report.overallScore ?? (report.status === "completed" ? 100 : 0),
    scores: [
      {
        fixtureId: VISUAL_QUALITY_FIXTURE_ID,
        score: report.overallScore ?? (report.status === "completed" ? 100 : 0),
        screenId: VISUAL_QUALITY_SCREEN_ID,
        screenName: "Visual Quality",
        viewportId: "default",
        viewportLabel:
          viewport !== undefined
            ? `${String(viewport.width)}×${String(viewport.height)}`
            : "Default",
      },
    ],
    ...(buildStandaloneWarnings(report).length > 0
      ? { warnings: buildStandaloneWarnings(report) }
      : {}),
  };
}

function buildStandaloneArtifacts(
  report: StandaloneVisualQualityReport,
  assets: {
    referenceUrl?: string;
    actualUrl?: string;
    diffUrl?: string;
  },
): Record<string, ScreenArtifacts> {
  return {
    [screenKey(
      VISUAL_QUALITY_FIXTURE_ID,
      VISUAL_QUALITY_SCREEN_ID,
      "default",
    )]: {
      report: toStandaloneScreenReport(report),
      ...(assets.referenceUrl ? { referenceUrl: assets.referenceUrl } : {}),
      ...(assets.actualUrl ? { actualUrl: assets.actualUrl } : {}),
      ...(assets.diffUrl ? { diffUrl: assets.diffUrl } : {}),
    },
  };
}

function buildStandaloneReport(
  report: StandaloneVisualQualityReport,
  assets: {
    referenceUrl?: string;
    actualUrl?: string;
    diffUrl?: string;
  },
): MergedReport {
  return {
    ...mergeReport(
      buildStandaloneAggregate(report),
      buildStandaloneArtifacts(report, assets),
      null,
    ),
    sourceKind: "visual-quality",
  };
}

function buildVisualParityReport(
  report: VisualParitySummary,
): MergedReport {
  return {
    aggregate: {
      version: 2,
      ranAt: VISUAL_PARITY_RAN_AT,
      overallScore: report.status === "passed" ? 100 : 0,
      scores: [],
    },
    fixtures: [],
    screensByKey: {},
    history: null,
    hasImages: false,
    sourceKind: "visual-parity",
    paritySummary: report,
    notices: [
      "Per-screen overlays are unavailable for visual-parity-report.json because it does not include image artifacts.",
    ],
  };
}

function pickStandaloneReportFile(picked: PickedFile[]): PickedFile | undefined {
  return (
    pickByPredicate(picked, (entry) =>
      entry.path.endsWith("/visual-quality/report.json"),
    ) ??
    pickByPredicate(picked, (entry) => entry.name === "report.json")
  );
}

function siblingFile(
  picked: PickedFile[],
  parentDir: string,
  fileName: string,
): PickedFile | undefined {
  return pickByPredicate(
    picked,
    (entry) => dirname(entry.path) === parentDir && entry.name === fileName,
  );
}

async function buildStandaloneReportFromFiles(
  picked: PickedFile[],
): Promise<MergedReport> {
  const reportFile = pickStandaloneReportFile(picked);
  if (!reportFile) {
    throw new Error("visual-quality/report.json was not found in the selected files.");
  }
  const report = parseStandaloneVisualQualityReport(
    JSON.parse(await readText(reportFile.file)) as unknown,
  );
  const parentDir = dirname(reportFile.path);
  const referenceFile = siblingFile(picked, parentDir, "reference.png");
  const actualFile = siblingFile(picked, parentDir, "actual.png");
  const diffFile = siblingFile(picked, parentDir, "diff.png");
  return buildStandaloneReport(report, {
    ...(referenceFile ? { referenceUrl: blobUrl(referenceFile.file) } : {}),
    ...(actualFile ? { actualUrl: blobUrl(actualFile.file) } : {}),
    ...(diffFile ? { diffUrl: blobUrl(diffFile.file) } : {}),
  });
}

async function buildVisualParityReportFromFiles(
  picked: PickedFile[],
): Promise<MergedReport> {
  const parityFile = pickByName(picked, "visual-parity-report.json");
  if (!parityFile) {
    throw new Error(
      "visual-parity-report.json was not found in the selected files.",
    );
  }
  return buildVisualParityReport(
    parseVisualParityReport(
      JSON.parse(await readText(parityFile.file)) as unknown,
    ),
  );
}

function benchmarkAssetPrefix(score: ScoreEntry): string {
  const token = toScreenIdToken(score.screenId?.trim() || score.fixtureId);
  const viewportId = score.viewportId?.trim();
  if (viewportId && viewportId.length > 0) {
    return ["last-run", score.fixtureId, "screens", token, viewportId].join("/");
  }
  return ["last-run", score.fixtureId, "screens", token].join("/");
}

async function fetchOptionalJson<T>(
  inputUrl: string,
  parser: (input: unknown) => T,
): Promise<T | null> {
  const response = await fetch(inputUrl);
  if (!response.ok) {
    return null;
  }
  const raw: unknown = await response.json();
  try {
    return parser(raw);
  } catch {
    return null;
  }
}

async function buildBenchmarkArtifactsFromUrl(
  aggregate: LastRunAggregate,
  reportUrl: string,
): Promise<Record<string, ScreenArtifacts>> {
  const artifactsByKey: Record<string, ScreenArtifacts> = {};

  await Promise.all(
    aggregate.scores.map(async (score) => {
      const prefix = benchmarkAssetPrefix(score);
      const key = screenKey(score.fixtureId, score.screenId, score.viewportId);
      const entry = ensureArtifactsEntry(artifactsByKey, key);
      entry.actualUrl = resolveUrl(reportUrl, `${prefix}/actual.png`);
      entry.diffUrl = resolveUrl(reportUrl, `${prefix}/diff.png`);
      const screenReport = await fetchOptionalJson(
        resolveUrl(reportUrl, `${prefix}/report.json`),
        parseScreenReport,
      );
      if (screenReport) {
        entry.report = screenReport;
      }
    }),
  );

  return artifactsByKey;
}

async function buildBenchmarkReportFromUrl(
  reportUrl: string,
  raw: unknown,
): Promise<MergedReport> {
  const aggregate = parseLastRun(raw);
  const history = await fetchOptionalJson(
    resolveUrl(reportUrl, "history.json"),
    parseHistory,
  );
  const artifactsByKey = await buildBenchmarkArtifactsFromUrl(
    aggregate,
    reportUrl,
  );
  return {
    ...mergeReport(aggregate, artifactsByKey, history),
    sourceKind: "benchmark",
  };
}

async function buildStandaloneReportFromUrl(
  reportUrl: string,
  raw: unknown,
): Promise<MergedReport> {
  const report = parseStandaloneVisualQualityReport(raw);
  return buildStandaloneReport(report, {
    referenceUrl: resolveUrl(reportUrl, "reference.png"),
    actualUrl: resolveUrl(reportUrl, "actual.png"),
    diffUrl: resolveUrl(reportUrl, "diff.png"),
  });
}

function detectRemoteMode(
  reportUrl: string,
): "benchmark" | "standalone" | "parity" {
  const name = basename(reportUrl);
  if (name === "last-run.json") {
    return "benchmark";
  }
  if (name === "visual-parity-report.json") {
    return "parity";
  }
  return "standalone";
}

/**
 * Consumes a set of dropped files (which may include a directory tree) and
 * produces a `MergedReport` from benchmark, standalone visual-quality, or
 * visual-parity artifacts.
 */
export async function loadReportFromFiles(
  files: File[],
): Promise<MergedReport> {
  const picked: PickedFile[] = files.map((file) => ({
    name: file.name,
    path: filePath(file),
    file,
  }));

  if (pickByName(picked, "last-run.json")) {
    return await buildBenchmarkReportFromFiles(picked);
  }
  if (pickStandaloneReportFile(picked)) {
    return await buildStandaloneReportFromFiles(picked);
  }
  if (pickByName(picked, "visual-parity-report.json")) {
    return await buildVisualParityReportFromFiles(picked);
  }

  throw new Error(
    "No supported visual quality report was found. Select last-run.json, visual-quality/report.json, or visual-parity-report.json.",
  );
}

/**
 * Extracts a `File[]` from a `DataTransfer` (drag-and-drop event). Supports
 * both the flat `files` list and the tree-walking `items.webkitGetAsEntry()`
 * API so users can drop an entire benchmark or job-artifact directory.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const items = dt.items;

  type FileSystemEntryShim = {
    isFile: boolean;
    isDirectory: boolean;
    fullPath: string;
    file?: (cb: (file: File) => void, err: (error: Error) => void) => void;
    createReader?: () => {
      readEntries: (
        cb: (entries: FileSystemEntryShim[]) => void,
        err: (error: Error) => void,
      ) => void;
    };
  };

  async function readDirectoryEntries(
    entry: FileSystemEntryShim,
  ): Promise<FileSystemEntryShim[]> {
    if (!entry.createReader) {
      return [];
    }
    const reader = entry.createReader();
    const output: FileSystemEntryShim[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntryShim[]>(
        (resolve, reject) => {
          reader.readEntries(resolve, reject);
        },
      );
      if (batch.length === 0) {
        break;
      }
      output.push(...batch);
    }
    return output;
  }

  async function readEntry(entry: FileSystemEntryShim): Promise<void> {
    if (entry.isFile && typeof entry.file === "function") {
      const fileFn = entry.file.bind(entry);
      await new Promise<void>((resolve, reject) => {
        fileFn(
          (file) => {
            try {
              Object.defineProperty(file, "webkitRelativePath", {
                value: entry.fullPath.replace(/^\//, ""),
                configurable: true,
              });
            } catch {
              // Some implementations do not allow override; tolerate silently.
            }
            collected.push(file);
            resolve();
          },
          reject,
        );
      });
      return;
    }
    if (entry.isDirectory) {
      const children = await readDirectoryEntries(entry);
      for (const child of children) {
        await readEntry(child);
      }
    }
  }

  const entries: FileSystemEntryShim[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    const maybeGet = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryShim | null;
      }
    ).webkitGetAsEntry;
    if (typeof maybeGet === "function") {
      const entry = maybeGet.call(item);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await readEntry(entry);
    }
    if (collected.length > 0) {
      return collected;
    }
  }

  const flat = dt.files;
  for (let i = 0; i < flat.length; i += 1) {
    const file = flat.item(i);
    if (file) {
      collected.push(file);
    }
  }
  return collected;
}

/**
 * Fetches a remote report URL and hydrates the best-supported merged view.
 */
export async function loadReportFromUrl(
  reportUrl: string,
): Promise<MergedReport> {
  const response = await fetch(reportUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch report from ${reportUrl}: HTTP ${String(response.status)}`,
    );
  }

  const raw: unknown = await response.json();
  switch (detectRemoteMode(reportUrl)) {
    case "benchmark":
      return await buildBenchmarkReportFromUrl(reportUrl, raw);
    case "parity":
      return buildVisualParityReport(parseVisualParityReport(raw));
    case "standalone":
      return await buildStandaloneReportFromUrl(reportUrl, raw);
  }
}

export { screenKey };
