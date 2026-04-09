import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualBenchmarkMaintenance } from "./visual-benchmark.update.js";
import { runVisualBenchmark, type VisualBenchmarkResult } from "./visual-benchmark-runner.js";
import { loadVisualQualityConfig, type VisualQualityConfig } from "./visual-quality-config.js";

export type VisualBenchmarkCliAction = "benchmark" | "maintenance";

export interface VisualBenchmarkCliResolution {
  action: VisualBenchmarkCliAction;
  forwardedArgs: string[];
  qualityThreshold?: number;
  ci?: boolean;
}

const MODULE_FILE = fileURLToPath(import.meta.url);

export const resolveVisualBenchmarkCliResolution = (args: readonly string[]): VisualBenchmarkCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];

  // Extract --ci and --quality-threshold if present
  let ci: boolean | undefined;
  let qualityThreshold: number | undefined;
  const filteredArgs: string[] = [];
  for (let i = 0; i < forwardedArgs.length; i++) {
    if (forwardedArgs[i] === "--ci") {
      ci = true;
      continue;
    }
    if (forwardedArgs[i] === "--quality-threshold") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error("--quality-threshold requires a numeric value (0-100).");
      }
      const value = Number(forwardedArgs[i + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`--quality-threshold must be a number between 0 and 100. Received '${forwardedArgs[i + 1]}'.`);
      }
      qualityThreshold = value;
      i++; // skip the value
      continue;
    }
    filteredArgs.push(forwardedArgs[i]);
  }

  if (filteredArgs.length === 0) {
    return { action: "benchmark", forwardedArgs: filteredArgs, qualityThreshold, ci };
  }

  if (
    filteredArgs.length === 1 &&
    (filteredArgs[0] === "--update-fixtures" ||
      filteredArgs[0] === "--update-references" ||
      filteredArgs[0] === "--live" ||
      filteredArgs[0] === "--update-baseline")
  ) {
    return { action: "maintenance", forwardedArgs: filteredArgs, qualityThreshold, ci };
  }

  throw new Error(
    "Usage: pnpm benchmark:visual [--update-fixtures | --update-references | --live | --update-baseline] [--quality-threshold <0-100>] [--ci]"
  );
};

export const runVisualBenchmarkCli = async (
  args: readonly string[],
  options?: {
    runBenchmark?: (qualityThreshold?: number) => Promise<VisualBenchmarkResult>;
  }
): Promise<number> => {
  const resolution = resolveVisualBenchmarkCliResolution(args);
  if (resolution.action === "maintenance") {
    await runVisualBenchmarkMaintenance(resolution.forwardedArgs);
    return 0;
  }

  const runBenchmark = options?.runBenchmark ?? (async (threshold?: number) => {
    // Load config and apply CLI threshold override
    const config = await loadVisualQualityConfig();
    const effectiveConfig: VisualQualityConfig = threshold !== undefined
      ? { ...config, thresholds: { ...config.thresholds, warn: threshold } }
      : config;
    return runVisualBenchmark({ qualityConfig: effectiveConfig });
  });
  const result = await runBenchmark(resolution.qualityThreshold);

  if (resolution.ci && result.deltas.some((d) => d.thresholdResult?.verdict === "fail")) {
    return 1;
  }

  return 0;
};

const isDirectExecution = process.argv[1] !== undefined && path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualBenchmarkCli(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
