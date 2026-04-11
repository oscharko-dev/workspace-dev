import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVisualBenchmarkAbThreeWayDiffRecords,
  DEFAULT_AB_ARTIFACT_ROOT,
  formatVisualBenchmarkAbStatistics,
  formatVisualBenchmarkAbTable,
  loadVisualBenchmarkAbConfig,
  markVisualBenchmarkAbThreeWayDiffSkipped,
  persistVisualBenchmarkAbResult,
  persistVisualBenchmarkAbThreeWayDiffs,
  runVisualBenchmarkAb,
  type RunVisualBenchmarkAbDependencies,
  type VisualBenchmarkAbConfig,
  type VisualBenchmarkAbResult,
  type ThreeWayDiffPersistedRecord,
} from "./visual-benchmark-ab.js";

const USAGE_LINE =
  "Usage: pnpm benchmark:visual:ab --config-a <path> --config-b <path> [--artifact-root <dir>] [--neutral-tolerance <n>] [--enforce-no-regression] [--skip-three-way-diff]";

export interface VisualBenchmarkAbCliResolution {
  configAPath: string;
  configBPath: string;
  artifactRoot: string;
  neutralTolerance?: number;
  enforceNoRegression: boolean;
  skipThreeWayDiff: boolean;
}

const requireValue = (
  args: readonly string[],
  index: number,
  flag: string,
): string => {
  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value.`);
  }
  const value = args[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} requires a non-empty value.`);
  }
  return value;
};

export const resolveVisualBenchmarkAbCliResolution = (
  args: readonly string[],
): VisualBenchmarkAbCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];
  let configAPath: string | undefined;
  let configBPath: string | undefined;
  let artifactRoot = DEFAULT_AB_ARTIFACT_ROOT;
  let neutralTolerance: number | undefined;
  let enforceNoRegression = false;
  let skipThreeWayDiff = false;
  for (let i = 0; i < forwardedArgs.length; i++) {
    const token = forwardedArgs[i];
    if (token === "--config-a") {
      configAPath = requireValue(forwardedArgs, i, "--config-a");
      i++;
      continue;
    }
    if (token === "--config-b") {
      configBPath = requireValue(forwardedArgs, i, "--config-b");
      i++;
      continue;
    }
    if (token === "--artifact-root") {
      artifactRoot = path.resolve(
        process.cwd(),
        requireValue(forwardedArgs, i, "--artifact-root"),
      );
      i++;
      continue;
    }
    if (token === "--neutral-tolerance") {
      const raw = requireValue(forwardedArgs, i, "--neutral-tolerance");
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(
          `--neutral-tolerance must be a finite number between 0 and 100. Received '${raw}'.`,
        );
      }
      neutralTolerance = value;
      i++;
      continue;
    }
    if (token === "--enforce-no-regression") {
      enforceNoRegression = true;
      continue;
    }
    if (token === "--skip-three-way-diff") {
      skipThreeWayDiff = true;
      continue;
    }
    throw new Error(`Unknown argument '${String(token)}'.\n${USAGE_LINE}`);
  }
  if (configAPath === undefined || configBPath === undefined) {
    throw new Error(
      `Both --config-a and --config-b are required.\n${USAGE_LINE}`,
    );
  }
  return {
    configAPath,
    configBPath,
    artifactRoot,
    ...(neutralTolerance !== undefined ? { neutralTolerance } : {}),
    enforceNoRegression,
    skipThreeWayDiff,
  };
};

export interface RunVisualBenchmarkAbCliOptions {
  loadConfig?: (filePath: string) => Promise<VisualBenchmarkAbConfig>;
  runAb?: (
    artifactRoot: string,
    configA: VisualBenchmarkAbConfig,
    configB: VisualBenchmarkAbConfig,
    neutralTolerance: number | undefined,
  ) => Promise<VisualBenchmarkAbResult>;
  persistComparison?: (
    result: VisualBenchmarkAbResult,
    artifactRoot: string,
    table: string,
  ) => Promise<void>;
  persistThreeWayDiffs?: (
    result: VisualBenchmarkAbResult,
    artifactRoot: string,
  ) => Promise<ThreeWayDiffPersistedRecord[]>;
  benchmarkDependencies?: RunVisualBenchmarkAbDependencies;
  output?: (line: string) => void;
}

const defaultRunAb = async (
  artifactRoot: string,
  configA: VisualBenchmarkAbConfig,
  configB: VisualBenchmarkAbConfig,
  neutralTolerance: number | undefined,
  benchmarkDependencies: RunVisualBenchmarkAbDependencies | undefined,
): Promise<VisualBenchmarkAbResult> =>
  runVisualBenchmarkAb(
    {
      configA,
      configB,
      artifactRoot,
      ...(neutralTolerance !== undefined ? { neutralTolerance } : {}),
    },
    benchmarkDependencies,
  );

const defaultPersistComparison = async (
  result: VisualBenchmarkAbResult,
  artifactRoot: string,
  table: string,
): Promise<void> => {
  await persistVisualBenchmarkAbResult({
    result,
    artifactRoot,
    table,
  });
};

const defaultPersistThreeWayDiffs = async (
  result: VisualBenchmarkAbResult,
  artifactRoot: string,
): Promise<ThreeWayDiffPersistedRecord[]> => {
  return persistVisualBenchmarkAbThreeWayDiffs({
    result,
    artifactRoot,
  });
};

const summarizeThreeWayDiffStatuses = (
  result: VisualBenchmarkAbResult,
): string | null => {
  let generated = 0;
  let skippedDisabled = 0;
  let skippedMissingInput = 0;
  let failed = 0;
  for (const entry of result.entries) {
    switch (entry.threeWayDiff?.status) {
      case "generated":
        generated += 1;
        break;
      case "skipped_disabled":
        skippedDisabled += 1;
        break;
      case "skipped_missing_input":
        skippedMissingInput += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default:
        break;
    }
  }
  if (
    generated === 0 &&
    skippedDisabled === 0 &&
    skippedMissingInput === 0 &&
    failed === 0
  ) {
    return null;
  }
  return `Three-way diff status: ${String(generated)} generated, ${String(skippedDisabled)} disabled, ${String(skippedMissingInput)} missing-input, ${String(failed)} failed.`;
};

export const runVisualBenchmarkAbCli = async (
  args: readonly string[],
  options?: RunVisualBenchmarkAbCliOptions,
): Promise<number> => {
  const resolution = resolveVisualBenchmarkAbCliResolution(args);
  const loadConfig = options?.loadConfig ?? loadVisualBenchmarkAbConfig;
  const output =
    options?.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const configA = await loadConfig(resolution.configAPath);
  const configB = await loadConfig(resolution.configBPath);
  const runAb =
    options?.runAb ??
    ((artifactRoot, a, b, neutralTolerance) =>
      defaultRunAb(
        artifactRoot,
        a,
        b,
        neutralTolerance,
        options?.benchmarkDependencies,
      ));
  const result = await runAb(
    resolution.artifactRoot,
    configA,
    configB,
    resolution.neutralTolerance,
  );
  const table = formatVisualBenchmarkAbTable(result);
  const stats = formatVisualBenchmarkAbStatistics(result);
  output(table);
  output("");
  output(stats);
  if (result.warnings && result.warnings.length > 0) {
    output("");
    output("Warnings:");
    for (const warning of result.warnings) {
      output(`  - ${warning}`);
    }
  }
  if (!resolution.skipThreeWayDiff) {
    const persistThreeWayDiffs =
      options?.persistThreeWayDiffs ?? defaultPersistThreeWayDiffs;
    try {
      const records = await persistThreeWayDiffs(result, resolution.artifactRoot);
      applyVisualBenchmarkAbThreeWayDiffRecords(result, records);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of result.entries) {
        entry.threeWayDiff = {
          status: "failed",
          diffImagePath: null,
          referenceImagePath: null,
          outputAImagePath: null,
          outputBImagePath: null,
          reason: message,
        };
      }
      output(`Three-way diff generation failed: ${message}`);
    }
  } else {
    markVisualBenchmarkAbThreeWayDiffSkipped(
      result,
      "Three-way diff generation disabled via --skip-three-way-diff.",
    );
  }
  const threeWaySummary = summarizeThreeWayDiffStatuses(result);
  if (threeWaySummary !== null) {
    output("");
    output(threeWaySummary);
  }
  const persistComparison =
    options?.persistComparison ?? defaultPersistComparison;
  await persistComparison(result, resolution.artifactRoot, table);
  if (resolution.enforceNoRegression && result.statistics.degradedCount > 0) {
    output("");
    output(
      `\u274C ${String(result.statistics.degradedCount)} entry(ies) regressed under config '${result.configB.label}'.`,
    );
    return 1;
  }
  return 0;
};

const MODULE_FILE = fileURLToPath(import.meta.url);
const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualBenchmarkAbCli(process.argv.slice(2))
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
