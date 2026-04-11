import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualBenchmarkMaintenance } from "./visual-benchmark.update.js";
import {
  runVisualBenchmark,
  type VisualBenchmarkResult,
} from "./visual-benchmark-runner.js";
import { assertAllowedViewportId } from "./visual-benchmark.helpers.js";
import {
  assertBenchmarkBrowserName,
  type BenchmarkBrowserName,
} from "./visual-benchmark.execution.js";
import {
  loadVisualQualityConfig,
  type VisualQualityConfig,
} from "./visual-quality-config.js";

export type VisualBenchmarkCliAction = "benchmark" | "maintenance";

export interface VisualBenchmarkCliResolution {
  action: VisualBenchmarkCliAction;
  forwardedArgs: string[];
  qualityThreshold?: number;
  ci?: boolean;
  enforceThresholds?: boolean;
  viewportId?: string;
  componentVisualCatalogFile?: string;
  storybookStaticDir?: string;
  browsers?: BenchmarkBrowserName[];
}

const parseBrowsersFlagValue = (value: string): BenchmarkBrowserName[] => {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new Error(
      "--browsers requires a non-empty comma-separated list (e.g. chromium,firefox,webkit).",
    );
  }
  const seen = new Set<BenchmarkBrowserName>();
  const ordered: BenchmarkBrowserName[] = [];
  for (const token of tokens) {
    const validated = assertBenchmarkBrowserName(token);
    if (!seen.has(validated)) {
      seen.add(validated);
      ordered.push(validated);
    }
  }
  return ordered;
};

const MODULE_FILE = fileURLToPath(import.meta.url);

export const resolveVisualBenchmarkCliResolution = (
  args: readonly string[],
): VisualBenchmarkCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];

  // Extract --ci and --quality-threshold if present
  let ci: boolean | undefined;
  let enforceThresholds: boolean | undefined;
  let qualityThreshold: number | undefined;
  let viewportId: string | undefined;
  let componentVisualCatalogFile: string | undefined;
  let storybookStaticDir: string | undefined;
  let browsers: BenchmarkBrowserName[] | undefined;
  const filteredArgs: string[] = [];
  for (let i = 0; i < forwardedArgs.length; i++) {
    if (forwardedArgs[i] === "--ci") {
      ci = true;
      continue;
    }
    if (forwardedArgs[i] === "--enforce-thresholds") {
      enforceThresholds = true;
      continue;
    }
    if (forwardedArgs[i] === "--quality-threshold") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error(
          "--quality-threshold requires a numeric value (0-100).",
        );
      }
      const value = Number(forwardedArgs[i + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(
          `--quality-threshold must be a number between 0 and 100. Received '${forwardedArgs[i + 1]}'.`,
        );
      }
      qualityThreshold = value;
      i++; // skip the value
      continue;
    }
    if (forwardedArgs[i] === "--viewport") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error("--viewport requires a value.");
      }
      viewportId = assertAllowedViewportId(forwardedArgs[i + 1]);
      i++; // skip the value
      continue;
    }
    if (forwardedArgs[i] === "--storybook-component-catalog") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error("--storybook-component-catalog requires a path.");
      }
      componentVisualCatalogFile = forwardedArgs[i + 1];
      i++;
      continue;
    }
    if (forwardedArgs[i] === "--storybook-static-dir") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error("--storybook-static-dir requires a path.");
      }
      storybookStaticDir = forwardedArgs[i + 1];
      i++;
      continue;
    }
    if (forwardedArgs[i] === "--browsers") {
      if (i + 1 >= forwardedArgs.length) {
        throw new Error("--browsers requires a value.");
      }
      const rawValue = forwardedArgs[i + 1];
      if (rawValue === undefined) {
        throw new Error("--browsers requires a value.");
      }
      browsers = parseBrowsersFlagValue(rawValue);
      i++;
      continue;
    }
    filteredArgs.push(forwardedArgs[i]);
  }

  if (filteredArgs.length === 0) {
    return {
      action: "benchmark",
      forwardedArgs: filteredArgs,
      qualityThreshold,
      ci,
      enforceThresholds,
      viewportId,
      componentVisualCatalogFile,
      storybookStaticDir,
      browsers,
    };
  }

  if (
    filteredArgs.length === 1 &&
    (filteredArgs[0] === "--update-fixtures" ||
      filteredArgs[0] === "--update-references" ||
      filteredArgs[0] === "--live" ||
      filteredArgs[0] === "--update-baseline")
  ) {
    return {
      action: "maintenance",
      forwardedArgs: filteredArgs,
      qualityThreshold,
      ci,
      enforceThresholds,
      viewportId,
      componentVisualCatalogFile,
      storybookStaticDir,
      browsers,
    };
  }

  throw new Error(
    "Usage: pnpm benchmark:visual [--update-fixtures | --update-references | --live | --update-baseline] [--viewport <id>] [--quality-threshold <0-100>] [--storybook-component-catalog <path>] [--storybook-static-dir <path>] [--browsers <chromium,firefox,webkit>] [--ci] [--enforce-thresholds]",
  );
};

export const runVisualBenchmarkCli = async (
  args: readonly string[],
  options?: {
    runBenchmark?: (input?: {
      qualityThreshold?: number;
      viewportId?: string;
      componentVisualCatalogFile?: string;
      storybookStaticDir?: string;
      browsers?: BenchmarkBrowserName[];
    }) => Promise<VisualBenchmarkResult>;
  },
): Promise<number> => {
  const resolution = resolveVisualBenchmarkCliResolution(args);
  if (resolution.action === "maintenance") {
    await runVisualBenchmarkMaintenance(resolution.forwardedArgs);
    return 0;
  }

  const runBenchmark =
    options?.runBenchmark ??
    (async (input?: {
      qualityThreshold?: number;
      viewportId?: string;
      componentVisualCatalogFile?: string;
      storybookStaticDir?: string;
      browsers?: BenchmarkBrowserName[];
    }) => {
      // Load config and apply CLI threshold override
      const config = await loadVisualQualityConfig();
      const effectiveConfig: VisualQualityConfig =
        input?.qualityThreshold !== undefined
          ? {
              ...config,
              thresholds: {
                ...config.thresholds,
                warn: input.qualityThreshold,
              },
            }
          : config;
      return runVisualBenchmark({
        qualityConfig: effectiveConfig,
        viewportId: input?.viewportId,
        componentVisualCatalogFile: input?.componentVisualCatalogFile,
        storybookStaticDir: input?.storybookStaticDir,
        browsers: input?.browsers,
      });
    });
  const threshold = resolution.qualityThreshold;
  const result = await runBenchmark({
    qualityThreshold: threshold,
    viewportId: resolution.viewportId,
    componentVisualCatalogFile: resolution.componentVisualCatalogFile,
    storybookStaticDir: resolution.storybookStaticDir,
    browsers: resolution.browsers,
  });

  if (
    resolution.enforceThresholds &&
    result.deltas.some((d) => d.thresholdResult?.verdict === "fail")
  ) {
    return 1;
  }

  return 0;
};

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualBenchmarkCli(process.argv.slice(2))
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
