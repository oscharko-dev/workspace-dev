import { runCommand as runCommandImpl } from "./command-runner.js";
import type { CommandResult } from "./types.js";

interface ValidationDeps {
  runCommand: (input: {
    cwd: string;
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
    redactions?: string[];
  }) => Promise<CommandResult>;
}

export const runProjectValidationWithDeps = async ({
  generatedProjectDir,
  onLog,
  deps
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  deps?: Partial<ValidationDeps>;
}): Promise<void> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;

  const commands: Array<{ name: string; args: string[] }> = [
    { name: "install", args: ["install", "--frozen-lockfile"] },
    { name: "lint", args: ["lint"] },
    { name: "typecheck", args: ["typecheck"] },
    { name: "build", args: ["build"] }
  ];

  for (const command of commands) {
    onLog(`Running ${command.name}`);
    const result = await runCommand({
      cwd: generatedProjectDir,
      command: "pnpm",
      args: command.args
    });

    if (!result.success) {
      throw new Error(`${command.name} failed: ${result.combined.slice(0, 2000)}`);
    }
  }
};

export const runProjectValidation = async ({
  generatedProjectDir,
  onLog
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
}): Promise<void> => {
  return await runProjectValidationWithDeps({ generatedProjectDir, onLog });
};
