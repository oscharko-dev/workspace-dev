import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPOSITE_QUALITY_PR_COMMENT_MARKER,
  DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE,
  appendCompositeQualityHistoryEntry,
  buildCompositeQualityReport,
  computePerformanceScore,
  loadCompositeQualityHistory,
  loadLighthouseSamplesFromPerfReport,
  loadVisualBenchmarkScoreFromLastRun,
  resolveCompositeQualityHistoryPath,
  renderCompositeQualityMarkdown,
  resolveCompositeQualityWeights,
  saveCompositeQualityHistory,
  type CompositeQualityWeights,
  type PerformanceScoreBreakdown,
  type VisualScoreInput,
} from "../integration/composite-quality.js";
import { toStableJsonString } from "../integration/visual-benchmark.helpers.js";

interface CompositeQualityCliOptions {
  visualLastRun: string;
  perfReport: string;
  perfArtifactDir: string;
  output: string;
  history: string | null;
  prCommentOutput: string | null;
  weightsVisual: number | null;
  weightsPerformance: number | null;
  configPath: string | null;
  maxHistory: number;
}

const DEFAULT_VISUAL_LAST_RUN = "artifacts/visual-benchmark/last-run.json";
const DEFAULT_PERF_REPORT =
  "template/react-mui-app/artifacts/performance/perf-assert-report.json";
const DEFAULT_HISTORY_PATH = resolveCompositeQualityHistoryPath("artifacts");

const usage = (): string =>
  [
    "Usage: tsx scripts/compute-composite-quality.ts [options]",
    "",
    "Options:",
    "  --visual-last-run <path>     Path to visual benchmark last-run.json",
    `                               (default: ${DEFAULT_VISUAL_LAST_RUN})`,
    "  --perf-report <path>         Path to perf-assert-report.json or perf-baseline.json",
    `                               (default: ${DEFAULT_PERF_REPORT})`,
    "  --perf-artifact-dir <path>   Directory that contains the perf report + raw LHR files",
    "                               (default: dirname of --perf-report)",
    "  --output <path>              Composite report JSON output path (REQUIRED)",
    "  --history <path>             Historical tracking JSON file",
    `                               (default: ${DEFAULT_HISTORY_PATH})`,
    "  --pr-comment-output <path>   Markdown PR comment payload output file",
    "  --weights-visual <number>    Visual dimension weight (0..1)",
    "  --weights-performance <num>  Performance dimension weight (0..1)",
    "  --config <path>              JSON config file with { weights: { visual, performance } }",
    "  --max-history <number>       Max history entries to retain (default 20)",
  ].join("\n");

const parseArgs = (argv: readonly string[]): CompositeQualityCliOptions => {
  let visualLastRun = DEFAULT_VISUAL_LAST_RUN;
  let perfReport = DEFAULT_PERF_REPORT;
  let perfArtifactDir: string | null = null;
  let output: string | null = null;
  let history: string | null = DEFAULT_HISTORY_PATH;
  let prCommentOutput: string | null = null;
  let weightsVisual: number | null = null;
  let weightsPerformance: number | null = null;
  let configPath: string | null = null;
  let maxHistory: number = DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE;

  const consumeValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

  const parseNumber = (value: string, flag: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${flag} must be a finite number (received ${value}).`);
    }
    return parsed;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    switch (arg) {
      case "--visual-last-run":
        visualLastRun = consumeValue(i, arg);
        i += 1;
        break;
      case "--perf-report":
        perfReport = consumeValue(i, arg);
        i += 1;
        break;
      case "--perf-artifact-dir":
        perfArtifactDir = consumeValue(i, arg);
        i += 1;
        break;
      case "--output":
        output = consumeValue(i, arg);
        i += 1;
        break;
      case "--history":
        history = consumeValue(i, arg);
        i += 1;
        break;
      case "--no-history":
        history = null;
        break;
      case "--pr-comment-output":
        prCommentOutput = consumeValue(i, arg);
        i += 1;
        break;
      case "--weights-visual":
        weightsVisual = parseNumber(consumeValue(i, arg), arg);
        i += 1;
        break;
      case "--weights-performance":
        weightsPerformance = parseNumber(consumeValue(i, arg), arg);
        i += 1;
        break;
      case "--config":
        configPath = consumeValue(i, arg);
        i += 1;
        break;
      case "--max-history": {
        const raw = parseNumber(consumeValue(i, arg), arg);
        if (!Number.isInteger(raw) || raw <= 0) {
          throw new Error("--max-history must be a positive integer.");
        }
        maxHistory = raw;
        i += 1;
        break;
      }
      default:
        if (arg !== undefined && arg.startsWith("--")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        break;
    }
  }

  if (output === null) {
    throw new Error("--output <path> is required.");
  }

  return {
    visualLastRun,
    perfReport,
    perfArtifactDir: perfArtifactDir ?? path.dirname(perfReport),
    output,
    history,
    prCommentOutput,
    weightsVisual,
    weightsPerformance,
    configPath,
    maxHistory,
  };
};

const loadWeightsFromConfig = async (
  configPath: string,
): Promise<{ visual?: number; performance?: number }> => {
  const content = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(content);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `composite-quality: config at ${configPath} must be a JSON object.`,
    );
  }
  const weights = (parsed as Record<string, unknown>)["weights"];
  if (weights === undefined) {
    return {};
  }
  if (
    weights === null ||
    typeof weights !== "object" ||
    Array.isArray(weights)
  ) {
    throw new Error(
      `composite-quality: config at ${configPath} weights must be an object.`,
    );
  }
  const record = weights as Record<string, unknown>;
  const out: { visual?: number; performance?: number } = {};
  if (typeof record["visual"] === "number") {
    out.visual = record["visual"];
  }
  if (typeof record["performance"] === "number") {
    out.performance = record["performance"];
  }
  return out;
};

const resolveWeights = async (
  options: CompositeQualityCliOptions,
): Promise<CompositeQualityWeights> => {
  let input: { visual?: number; performance?: number } = {};
  if (options.configPath !== null) {
    input = await loadWeightsFromConfig(options.configPath);
  }
  if (options.weightsVisual !== null) {
    input = { ...input, visual: options.weightsVisual };
  }
  if (options.weightsPerformance !== null) {
    input = { ...input, performance: options.weightsPerformance };
  }
  return resolveCompositeQualityWeights(input);
};

const writeOutputFile = async (
  filePath: string,
  content: string,
): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const loadVisualSafe = async (
  lastRunPath: string,
): Promise<{ visual: VisualScoreInput | null; warning: string | null }> => {
  try {
    const visual = await loadVisualBenchmarkScoreFromLastRun(lastRunPath);
    if (visual === null) {
      return {
        visual: null,
        warning: `visual benchmark last-run not found at ${lastRunPath}`,
      };
    }
    return { visual, warning: null };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      visual: null,
      warning: `visual benchmark load failed: ${reason}`,
    };
  }
};

const loadPerformanceSafe = async (
  perfReport: string,
  perfArtifactDir: string,
): Promise<{
  breakdown: PerformanceScoreBreakdown | null;
  sourceWarning: string | null;
  sourcePath: string | null;
}> => {
  try {
    const result = await loadLighthouseSamplesFromPerfReport({
      artifactDir: perfArtifactDir,
      perfReportPath: perfReport,
    });
    if (result.sourcePath === null && result.samples.length === 0) {
      return {
        breakdown: null,
        sourceWarning: result.warnings[0] ?? "performance report not found",
        sourcePath: null,
      };
    }
    const breakdown = computePerformanceScore(result.samples);
    if (result.warnings.length > 0) {
      breakdown.warnings = [...result.warnings, ...breakdown.warnings];
    }
    return {
      breakdown,
      sourceWarning: null,
      sourcePath: result.sourcePath,
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      breakdown: null,
      sourceWarning: `performance load failed: ${reason}`,
      sourcePath: null,
    };
  }
};

const main = async (argv: readonly string[]): Promise<number> => {
  let options: CompositeQualityCliOptions;
  try {
    options = parseArgs(argv);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[composite-quality] ${reason}\n${usage()}\n`);
    return 1;
  }

  let weights: CompositeQualityWeights;
  try {
    weights = await resolveWeights(options);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[composite-quality] ${reason}\n`);
    return 1;
  }

  const visualResult = await loadVisualSafe(options.visualLastRun);
  const performanceResult = await loadPerformanceSafe(
    options.perfReport,
    options.perfArtifactDir,
  );

  const report = buildCompositeQualityReport({
    visual: visualResult.visual,
    performance: performanceResult.breakdown,
    weights,
  });

  if (visualResult.warning !== null) {
    report.warnings.unshift(visualResult.warning);
  }
  if (performanceResult.sourceWarning !== null) {
    report.warnings.unshift(performanceResult.sourceWarning);
  }

  try {
    await writeOutputFile(options.output, toStableJsonString(report));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[composite-quality] failed to write output ${options.output}: ${reason}\n`,
    );
    return 1;
  }

  if (options.history !== null) {
    try {
      const existing = await loadCompositeQualityHistory(options.history);
      const updated = appendCompositeQualityHistoryEntry(
        existing,
        {
          runAt: report.generatedAt,
          weights: report.weights,
          visualScore: report.visual?.score ?? null,
          performanceScore: report.performance?.score ?? null,
          compositeScore: report.composite.score,
        },
        options.maxHistory,
      );
      await saveCompositeQualityHistory(options.history, updated);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[composite-quality] failed to update history ${options.history}: ${reason}\n`,
      );
      return 1;
    }
  }

  const markdownBody = renderCompositeQualityMarkdown(report);
  if (options.prCommentOutput !== null) {
    try {
      await writeOutputFile(
        options.prCommentOutput,
        `${JSON.stringify(
          { marker: COMPOSITE_QUALITY_PR_COMMENT_MARKER, body: markdownBody },
          null,
          2,
        )}\n`,
      );
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[composite-quality] failed to write PR comment ${options.prCommentOutput}: ${reason}\n`,
      );
      return 1;
    }
  }

  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath !== undefined && summaryPath.length > 0) {
    try {
      await appendFile(summaryPath, `${markdownBody}\n`, "utf8");
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[composite-quality] failed to append GITHUB_STEP_SUMMARY: ${reason}\n`,
      );
    }
  }

  const visualStr =
    report.visual === null ? "missing" : String(report.visual.score);
  const performanceStr =
    report.performance === null || report.performance.score === null
      ? "missing"
      : String(report.performance.score);
  const compositeStr =
    report.composite.score === null ? "null" : String(report.composite.score);
  const sources = report.composite.includedDimensions.join(",");
  process.stdout.write(
    `[composite-quality] visual=${visualStr} performance=${performanceStr} composite=${compositeStr} sources=${sources || "none"}\n`,
  );
  if (report.warnings.length > 0) {
    for (const warning of report.warnings) {
      process.stdout.write(`[composite-quality] warning: ${warning}\n`);
    }
  }

  return 0;
};

const MODULE_FILE = fileURLToPath(import.meta.url);
const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void main(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}

export { main as runCompositeQualityCli };
