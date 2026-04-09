import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualBenchmarkMaintenance } from "./visual-benchmark.update.js";
import { runVisualBenchmark } from "./visual-benchmark-runner.js";
import { loadVisualQualityConfig, type VisualQualityConfig } from "./visual-quality-config.js";

export type VisualBenchmarkCliAction = "benchmark" | "maintenance";

export interface VisualBenchmarkCliResolution {
  action: VisualBenchmarkCliAction;
  forwardedArgs: string[];
  qualityThreshold?: number;
}

const MODULE_FILE = fileURLToPath(import.meta.url);

export const resolveVisualBenchmarkCliResolution = (args: readonly string[]): VisualBenchmarkCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];

  // Extract --quality-threshold if present
  let qualityThreshold: number | undefined;
  const filteredArgs: string[] = [];
  for (let i = 0; i < forwardedArgs.length; i++) {
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
    return { action: "benchmark", forwardedArgs: filteredArgs, qualityThreshold };
  }

  if (
    filteredArgs.length === 1 &&
    (filteredArgs[0] === "--update-fixtures" ||
      filteredArgs[0] === "--update-references" ||
      filteredArgs[0] === "--live" ||
      filteredArgs[0] === "--update-baseline")
  ) {
    return { action: "maintenance", forwardedArgs: filteredArgs, qualityThreshold };
  }

  throw new Error(
    "Usage: pnpm benchmark:visual [--update-fixtures | --update-references | --live | --update-baseline] [--quality-threshold <0-100>]"
  );
};

export const runVisualBenchmarkCli = async (
  args: readonly string[],
  options?: {
    runBenchmark?: (qualityThreshold?: number) => Promise<void>;
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
    await runVisualBenchmark({ qualityConfig: effectiveConfig });
  });
  await runBenchmark(resolution.qualityThreshold);
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
