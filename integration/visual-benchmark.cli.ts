import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualBenchmarkMaintenance } from "./visual-benchmark.update.js";

export type VisualBenchmarkCliAction = "test" | "maintenance";

export interface VisualBenchmarkCliResolution {
  action: VisualBenchmarkCliAction;
  forwardedArgs: string[];
}

const MODULE_FILE = fileURLToPath(import.meta.url);
const TEST_FILES = [
  "integration/visual-benchmark.test.ts"
] as const;

type SpawnVisualBenchmarkCommand = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    shell: boolean;
    stdio: "inherit";
  }
) => SpawnSyncReturns<Buffer>;

export const resolveVisualBenchmarkCliResolution = (args: readonly string[]): VisualBenchmarkCliResolution => {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : [...args];
  if (forwardedArgs.length === 0) {
    return {
      action: "test",
      forwardedArgs
    };
  }

  if (
    forwardedArgs.length === 1 &&
    (forwardedArgs[0] === "--update-fixtures" || forwardedArgs[0] === "--update-references" || forwardedArgs[0] === "--live")
  ) {
    return {
      action: "maintenance",
      forwardedArgs
    };
  }

  throw new Error(
    "Usage: pnpm benchmark:visual [--update-fixtures | --update-references | --live]"
  );
};

export const runVisualBenchmarkCli = async (
  args: readonly string[],
  options?: {
    spawnCommand?: SpawnVisualBenchmarkCommand;
  }
): Promise<number> => {
  const resolution = resolveVisualBenchmarkCliResolution(args);
  if (resolution.action === "maintenance") {
    await runVisualBenchmarkMaintenance(resolution.forwardedArgs);
    return 0;
  }

  const spawnCommand = options?.spawnCommand ?? spawnSync;
  const result = spawnCommand(
    "pnpm",
    ["exec", "tsx", "--test", ...TEST_FILES],
    {
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    }
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
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
