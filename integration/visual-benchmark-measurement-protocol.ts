import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeVisualBenchmarkDeltas,
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import { loadVisualBenchmarkViewCatalog } from "./visual-benchmark-view-catalog.js";
import {
  checkVisualQualityThreshold,
  loadVisualQualityConfig,
  resolveVisualQualityThresholds,
} from "./visual-quality-config.js";

interface MeasurementRow {
  fixtureId: string;
  label: string;
  fileKey: string;
  nodeId: string;
  currentScore: number | null;
  thresholdWarn: number;
  thresholdFail: number | null;
  verdict: "pass" | "warn" | "fail" | "unavailable";
  baselineScore: number | null;
  delta: number | null;
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

const roundToTwo = (value: number): number => Math.round(value * 100) / 100;

const averageScore = (
  scores: readonly VisualBenchmarkScoreEntry[],
): number | null => {
  if (scores.length === 0) {
    return null;
  }
  const total = scores.reduce((sum, entry) => sum + entry.score, 0);
  return roundToTwo(total / scores.length);
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
  lines.push("| Fixture | Benchmark View | File Key | Node ID | Current | Warn | Fail | Verdict | Baseline | Delta |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |");
  for (const row of protocol.rows) {
    lines.push(
      `| ${row.fixtureId} | ${row.label} | ${row.fileKey} | ${row.nodeId} | ${formatScore(row.currentScore)} | ${row.thresholdWarn.toFixed(2)} | ${row.thresholdFail === null ? "n/a" : row.thresholdFail.toFixed(2)} | ${row.verdict} | ${formatScore(row.baselineScore)} | ${formatDelta(row.delta)} |`,
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

    const baselineDeltas =
      baseline === null
        ? undefined
        : computeVisualBenchmarkDeltas(lastRun.scores, baseline);
    const rows: MeasurementRow[] = catalog.views.map((view) => {
      const currentEntries = lastRun.scores.filter(
        (entry) => entry.fixtureId === view.fixtureId,
      );
      const baselineEntries =
        baseline?.scores.filter((entry) => entry.fixtureId === view.fixtureId) ??
        [];
      const currentScore = averageScore(currentEntries);
      const baselineScore = averageScore(baselineEntries);
      const thresholds = resolveVisualQualityThresholds(qualityConfig, view.fixtureId);
      const thresholdResult =
        currentScore === null
          ? null
          : checkVisualQualityThreshold(currentScore, thresholds);
      return {
        fixtureId: view.fixtureId,
        label: view.label,
        fileKey: view.fileKey,
        nodeId: view.nodeId,
        currentScore,
        thresholdWarn: thresholds.warn,
        thresholdFail: thresholds.fail ?? null,
        verdict: thresholdResult?.verdict ?? "unavailable",
        baselineScore,
        delta:
          currentScore !== null && baselineScore !== null
            ? roundToTwo(currentScore - baselineScore)
            : null,
      };
    });

    const overallThresholds = resolveVisualQualityThresholds(qualityConfig);
    const overallCurrent = lastRun.overallCurrent ?? averageScore(lastRun.scores);
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
  await writeFile(OUTPUT_JSON_PATH, JSON.stringify(protocol, null, 2), "utf8");
  await writeFile(OUTPUT_MD_PATH, buildMarkdown(protocol), "utf8");
  process.stdout.write(
    `Wrote measurement protocol:\n- ${OUTPUT_JSON_PATH}\n- ${OUTPUT_MD_PATH}\n`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
