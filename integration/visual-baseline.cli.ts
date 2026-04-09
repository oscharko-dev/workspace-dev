import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  updateVisualBaselines,
  approveVisualBaseline,
  computeVisualBaselineStatus,
  computeVisualBaselineDiff,
  formatVisualBaselineStatusTable,
  formatVisualBaselineDiffTable,
} from "./visual-baseline.js";

const MODULE_FILE = fileURLToPath(import.meta.url);

export type VisualBaselineCommand = "update" | "approve" | "status" | "diff";

export interface VisualBaselineCliOptions {
  command: VisualBaselineCommand;
  fixture?: string;
  screen?: string;
  json: boolean;
}

const VALID_COMMANDS: readonly VisualBaselineCommand[] = ["update", "approve", "status", "diff"];

const USAGE = "Usage: pnpm visual:baseline <update|approve|status|diff> [options]";

export const parseVisualBaselineCliArgs = (args: readonly string[]): VisualBaselineCliOptions => {
  const filtered = args[0] === "--" ? args.slice(1) : [...args];

  if (filtered.length === 0) {
    throw new Error(USAGE);
  }

  const command = filtered[0];
  if (!VALID_COMMANDS.includes(command as VisualBaselineCommand)) {
    throw new Error(`Unknown command '${command}'. ${USAGE}`);
  }

  let fixture: string | undefined;
  let screen: string | undefined;
  let json = false;

  for (let i = 1; i < filtered.length; i++) {
    const arg = filtered[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--fixture" && i + 1 < filtered.length) {
      fixture = filtered[++i];
    } else if (arg === "--screen" && i + 1 < filtered.length) {
      screen = filtered[++i];
    } else {
      throw new Error(`Unknown option '${arg}'. ${USAGE}`);
    }
  }

  if (command === "approve" && (screen === undefined || screen.trim().length === 0)) {
    throw new Error(`--screen <name> is required for approve command. ${USAGE}`);
  }

  return {
    command: command as VisualBaselineCommand,
    fixture,
    screen,
    json,
  };
};

export const runVisualBaselineCli = async (
  args: readonly string[],
  options?: {
    runCommand?: (command: VisualBaselineCommand, cliOptions: VisualBaselineCliOptions) => Promise<void>;
  },
): Promise<number> => {
  const cliOptions = parseVisualBaselineCliArgs(args);

  if (options?.runCommand) {
    await options.runCommand(cliOptions.command, cliOptions);
    return 0;
  }

  switch (cliOptions.command) {
    case "update": {
      const result = await updateVisualBaselines({ fixtureId: cliOptions.fixture });
      if (cliOptions.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
      return 0;
    }
    case "approve": {
      const result = await approveVisualBaseline(cliOptions.screen!);
      if (cliOptions.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`Approved '${result.fixtureId}': ${result.previousScore !== null ? String(result.previousScore) : "\u2014"} \u2192 ${result.newScore}\n`);
      }
      return 0;
    }
    case "status": {
      const result = await computeVisualBaselineStatus();
      if (cliOptions.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatVisualBaselineStatusTable(result)}\n`);
      }
      return 0;
    }
    case "diff": {
      const result = await computeVisualBaselineDiff();
      if (cliOptions.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        if (!result.hasPendingDiffs) {
          process.stdout.write("No pending diffs.\n");
        } else {
          process.stdout.write(`${formatVisualBaselineDiffTable(result)}\n`);
        }
      }
      return 0;
    }
  }
};

const isDirectExecution = process.argv[1] !== undefined && path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualBaselineCli(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
