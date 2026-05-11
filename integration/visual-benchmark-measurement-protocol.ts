import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeVisualBenchmarkDeltas,
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  loadVisualBenchmarkLastRunArtifacts,
  type VisualBenchmarkLastRunArtifactEntry,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  loadVisualBenchmarkViewCatalog,
  resolveVisualBenchmarkCanonicalReferencePaths,
  type VisualBenchmarkViewCatalogEntry,
} from "./visual-benchmark-view-catalog.js";
import {
  checkVisualQualityThreshold,
  loadVisualQualityConfig,
  resolveVisualQualityThresholds,
} from "./visual-quality-config.js";

interface MeasurementRow {
  fixtureId: string;
  label: string;
  screenId: string;
  viewportId: string;
  referenceVersion: number;
  viewRef: string;
  currentScore: number | null;
  thresholdWarn: number;
  thresholdFail: number | null;
  verdict: "pass" | "warn" | "fail" | "unavailable";
  baselineScore: number | null;
  delta: number | null;
  figmaScreenshotPath: string;
  workspaceScreenshotPath: string;
  diffPercent: number | null;
}

interface MeasurementProtocol {
  generatedAt: string;
  fixtureCount: number;
  overallCurrent: number | null;
  overallScore: number | null;
  overallThresholdWarn: number;
  overallThresholdFail: number | null;
  overallVerdict: "pass" | "warn" | "fail" | "unavailable";
  qualityGate: {
    pass: number;
    warn: number;
    fail: number;
    unavailable: number;
  };
  baselineTrend?: {
    overallBaseline: number | null;
    overallDelta: number | null;
  };
  rows: MeasurementRow[];
}

const OUTPUT_ROOT = path.resolve(process.cwd(), "artifacts", "visual-benchmark");
const OUTPUT_JSON_PATH = path.join(OUTPUT_ROOT, "measurement-protocol.json");
const OUTPUT_MD_PATH = path.join(OUTPUT_ROOT, "measurement-protocol.md");
const OUTPUT_PAIR_DIR = path.join(OUTPUT_ROOT, "measurement-pairs");

const roundToTwo = (value: number): number => Math.round(value * 100) / 100;

const normalizeViewportId = (value: string | undefined): string =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "default";

const normalizeScreenId = (entry: {
  fixtureId: string;
  screenId?: string;
}): string =>
  typeof entry.screenId === "string" && entry.screenId.trim().length > 0
    ? entry.screenId.trim()
    : entry.fixtureId;

const resolveScoreForView = (
  scores: readonly VisualBenchmarkScoreEntry[],
  view: VisualBenchmarkViewCatalogEntry,
): number | null => {
  const match = scores.find((entry) => {
    if (entry.fixtureId !== view.fixtureId) {
      return false;
    }
    if (normalizeScreenId(entry) !== view.nodeId) {
      return false;
    }
    return normalizeViewportId(entry.viewportId) === view.comparison.viewportId;
  });
  return match === undefined ? null : roundToTwo(match.score);
};

const formatScore = (value: number | null): string =>
  value === null ? "n/a" : value.toFixed(2);

const formatDelta = (value: number | null): string => {
  if (value === null) {
    return "n/a";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
};

const formatDiffPercent = (value: number | null): string =>
  value === null ? "n/a" : `${value.toFixed(2)}%`;

const parseDiffPercentFromReport = async (
  reportPath: string | null,
): Promise<number | null> => {
  if (reportPath === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      await readFile(path.resolve(process.cwd(), reportPath), "utf8"),
    ) as
      | {
          metadata?: {
            diffPixelCount?: unknown;
            totalPixels?: unknown;
          };
        }
      | undefined;
    const diffPixelCount = parsed?.metadata?.diffPixelCount;
    const totalPixels = parsed?.metadata?.totalPixels;
    if (
      typeof diffPixelCount !== "number" ||
      !Number.isFinite(diffPixelCount) ||
      typeof totalPixels !== "number" ||
      !Number.isFinite(totalPixels) ||
      totalPixels <= 0
    ) {
      return null;
    }
    return roundToTwo((diffPixelCount / totalPixels) * 100);
  } catch {
    return null;
  }
};

const copyPairImageOrThrow = async (input: {
  sourcePath: string;
  targetPath: string;
  label: string;
}): Promise<string> => {
  const sourceAbsolutePath = path.resolve(process.cwd(), input.sourcePath);
  try {
    await cp(sourceAbsolutePath, input.targetPath, { force: true });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Missing ${input.label} image at '${input.sourcePath}'.`,
      );
    }
    throw error;
  }
  return path.relative(process.cwd(), input.targetPath) || ".";
};

const selectArtifactForView = (
  artifacts: readonly VisualBenchmarkLastRunArtifactEntry[],
  view: VisualBenchmarkViewCatalogEntry,
): VisualBenchmarkLastRunArtifactEntry | null => {
  const match = artifacts.find((artifact) => {
    if (normalizeScreenId(artifact) !== view.nodeId) {
      return false;
    }
    return normalizeViewportId(artifact.viewportId) === view.comparison.viewportId;
  });
  return match ?? null;
};

const buildMarkdown = (protocol: MeasurementProtocol): string => {
  const lines: string[] = [];
  lines.push("# Visual Benchmark Measurement Protocol");
  lines.push("");
  lines.push(`Generated at: ${protocol.generatedAt}`);
  lines.push(`Fixture count: ${String(protocol.fixtureCount)}`);
  lines.push(`Overall current (screen benchmark): ${formatScore(protocol.overallCurrent)}`);
  lines.push(`Overall headline score: ${formatScore(protocol.overallScore)}`);
  lines.push(
    `Overall thresholds: warn=${protocol.overallThresholdWarn.toFixed(2)} fail=${protocol.overallThresholdFail === null ? "n/a" : protocol.overallThresholdFail.toFixed(2)}`,
  );
  lines.push(`Overall verdict: ${protocol.overallVerdict}`);
  lines.push(
    `Quality gate: pass=${String(protocol.qualityGate.pass)} warn=${String(protocol.qualityGate.warn)} fail=${String(protocol.qualityGate.fail)} unavailable=${String(protocol.qualityGate.unavailable)}`,
  );
  if (protocol.baselineTrend) {
    lines.push(`Overall baseline: ${formatScore(protocol.baselineTrend.overallBaseline)}`);
    lines.push(`Overall delta: ${formatDelta(protocol.baselineTrend.overallDelta)}`);
  }
  lines.push("");
  lines.push("| Fixture | Benchmark View | Screen ID | Viewport | Ref Ver | View Ref | Current | Warn | Fail | Verdict | Baseline | Delta | Diff % | Figma PNG | WorkspaceDev PNG |");
  lines.push("| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |");
  for (const row of protocol.rows) {
    lines.push(
      `| ${row.fixtureId} | ${row.label} | ${row.screenId} | ${row.viewportId} | ${String(row.referenceVersion)} | ${row.viewRef} | ${formatScore(row.currentScore)} | ${row.thresholdWarn.toFixed(2)} | ${row.thresholdFail === null ? "n/a" : row.thresholdFail.toFixed(2)} | ${row.verdict} | ${formatScore(row.baselineScore)} | ${formatDelta(row.delta)} | ${formatDiffPercent(row.diffPercent)} | ${row.figmaScreenshotPath} | ${row.workspaceScreenshotPath} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

export const generateVisualBenchmarkMeasurementProtocol =
  async (): Promise<MeasurementProtocol> => {
    const [catalog, lastRun, baseline, qualityConfig] = await Promise.all([
      loadVisualBenchmarkViewCatalog(),
      loadVisualBenchmarkLastRun(),
      loadVisualBenchmarkBaseline(),
      loadVisualQualityConfig(),
    ]);
    if (lastRun === null) {
      throw new Error(
        "No visual benchmark last-run.json found. Run 'pnpm benchmark:visual' first.",
      );
    }

    await mkdir(OUTPUT_PAIR_DIR, { recursive: true });
    const baselineDeltas =
      baseline === null
        ? undefined
        : computeVisualBenchmarkDeltas(lastRun.scores, baseline);
    const rows: MeasurementRow[] = [];

    for (const view of catalog.views) {
      const currentScore = resolveScoreForView(lastRun.scores, view);
      const baselineScore =
        baseline === null ? null : resolveScoreForView(baseline.scores, view);
      const thresholds = resolveVisualQualityThresholds(
        qualityConfig,
        view.fixtureId,
        { screenId: view.nodeId, screenName: view.nodeName },
      );
      const thresholdResult =
        currentScore === null
          ? null
          : checkVisualQualityThreshold(currentScore, thresholds);
      const artifacts = await loadVisualBenchmarkLastRunArtifacts(view.fixtureId);
      const selectedArtifact = selectArtifactForView(artifacts, view);
      if (selectedArtifact === null) {
        throw new Error(
          `No last-run artifact found for fixture '${view.fixtureId}' screen '${view.nodeId}' viewport '${view.comparison.viewportId}'.`,
        );
      }

      const canonicalReferencePath = path.relative(
        process.cwd(),
        resolveVisualBenchmarkCanonicalReferencePaths(view).figmaPngPath,
      );
      const workspaceActualPath = selectedArtifact.actualImagePath;
      if (
        path.resolve(process.cwd(), canonicalReferencePath) ===
        path.resolve(process.cwd(), workspaceActualPath)
      ) {
        throw new Error(
          `Invalid benchmark pair for fixture '${view.fixtureId}': canonical Figma path equals WorkspaceDev actual path.`,
        );
      }

      const labelSlug = view.label.replace(/\s+/g, "");
      const figmaTargetPath = path.join(
        OUTPUT_PAIR_DIR,
        `${labelSlug}-Figma-v${String(view.referenceVersion)}.png`,
      );
      const workspaceTargetPath = path.join(
        OUTPUT_PAIR_DIR,
        `${labelSlug}-WorkspaceDev-${view.comparison.viewportId}.png`,
      );
      const figmaScreenshotPath = await copyPairImageOrThrow({
        sourcePath: canonicalReferencePath,
        targetPath: figmaTargetPath,
        label: "canonical Figma reference",
      });
      const workspaceScreenshotPath = await copyPairImageOrThrow({
        sourcePath: workspaceActualPath,
        targetPath: workspaceTargetPath,
        label: "WorkspaceDev screenshot",
      });
      const diffPercent = await parseDiffPercentFromReport(
        selectedArtifact.reportPath ?? null,
      );

      rows.push({
        fixtureId: view.fixtureId,
        label: view.label,
        screenId: view.nodeId,
        viewportId: view.comparison.viewportId,
        referenceVersion: view.referenceVersion,
        viewRef: `${view.nodeId}@${view.comparison.viewportId}`,
        currentScore,
        thresholdWarn: thresholds.warn,
        thresholdFail: thresholds.fail ?? null,
        verdict: thresholdResult?.verdict ?? "unavailable",
        baselineScore,
        delta:
          currentScore !== null && baselineScore !== null
            ? roundToTwo(currentScore - baselineScore)
            : null,
        figmaScreenshotPath,
        workspaceScreenshotPath,
        diffPercent,
      });
    }

    const overallThresholds = resolveVisualQualityThresholds(qualityConfig);
    const overallCurrent = lastRun.overallCurrent ?? null;
    const overallScore =
      typeof lastRun.overallScore === "number"
        ? lastRun.overallScore
        : overallCurrent;
    const overallVerdict =
      overallScore === null
        ? "unavailable"
        : checkVisualQualityThreshold(overallScore, overallThresholds).verdict;

    return {
      generatedAt: new Date().toISOString(),
      fixtureCount: catalog.views.length,
      overallCurrent,
      overallScore,
      overallThresholdWarn: overallThresholds.warn,
      overallThresholdFail: overallThresholds.fail ?? null,
      overallVerdict,
      qualityGate: rows.reduce(
        (acc, row) => {
          acc[row.verdict] += 1;
          return acc;
        },
        { pass: 0, warn: 0, fail: 0, unavailable: 0 },
      ),
      ...(baselineDeltas !== undefined
        ? {
            baselineTrend: {
              overallBaseline: baselineDeltas.overallBaseline,
              overallDelta: baselineDeltas.overallDelta,
            },
          }
        : {}),
      rows,
    };
  };

const main = async (): Promise<void> => {
  const protocol = await generateVisualBenchmarkMeasurementProtocol();
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(protocol, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD_PATH, buildMarkdown(protocol), "utf8");
  process.stdout.write(
    `Wrote measurement protocol:\n- ${OUTPUT_JSON_PATH}\n- ${OUTPUT_MD_PATH}\n- ${OUTPUT_PAIR_DIR}\n`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
