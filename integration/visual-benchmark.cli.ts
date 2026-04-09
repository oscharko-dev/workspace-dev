import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualBenchmarkMaintenance } from "./visual-benchmark.update.js";
import { runVisualBenchmark } from "./visual-benchmark-runner.js";

export type VisualBenchmarkCliAction = "benchmark" | "maintenance";

export interface VisualBenchmarkCliResolution {
  action: VisualBenchmarkCliAction;
  forwardedArgs: string[];
}

const MODULE_FILE = fileURLToPath(import.meta.url);

export const resolveVisualBenchmarkCliResolution = (args: readonly string[]): VisualBenchmarkCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];
  if (forwardedArgs.length === 0) {
    return {
      action: "benchmark",
      forwardedArgs
    };
  }

  if (
    forwardedArgs.length === 1 &&
    (forwardedArgs[0] === "--update-fixtures" ||
      forwardedArgs[0] === "--update-references" ||
      forwardedArgs[0] === "--live" ||
      forwardedArgs[0] === "--update-baseline")
  ) {
    return {
      action: "maintenance",
      forwardedArgs
    };
  }

  throw new Error(
    "Usage: pnpm benchmark:visual [--update-fixtures | --update-references | --live | --update-baseline]"
  );
};

export const runVisualBenchmarkCli = async (
  args: readonly string[],
  options?: {
    runBenchmark?: () => Promise<void>;
  }
): Promise<number> => {
  const resolution = resolveVisualBenchmarkCliResolution(args);
  if (resolution.action === "maintenance") {
    await runVisualBenchmarkMaintenance(resolution.forwardedArgs);
    return 0;
  }

  const runBenchmark = options?.runBenchmark ?? (async () => {
    await runVisualBenchmark();
  });
  await runBenchmark();
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
