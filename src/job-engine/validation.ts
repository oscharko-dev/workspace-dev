import { runCommand as runCommandImpl } from "./command-runner.js";
import path from "node:path";
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
  enablePerfValidation = false,
  deps
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enablePerfValidation?: boolean;
  deps?: Partial<ValidationDeps>;
}): Promise<void> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const perfArtifactRoot = path.join(generatedProjectDir, ".figmapipe", "performance");

  const commands: Array<{ name: string; args: string[]; env?: NodeJS.ProcessEnv }> = [
    { name: "install", args: ["install", "--frozen-lockfile"] },
    { name: "lint", args: ["lint"] },
    { name: "typecheck", args: ["typecheck"] },
    { name: "build", args: ["build"] }
  ];
  if (enablePerfValidation) {
    commands.push({
      name: "perf-assert",
      args: ["run", "perf:assert"],
      env: {
        ...process.env,
        FIGMAPIPE_PERF_ARTIFACT_DIR: process.env.FIGMAPIPE_PERF_ARTIFACT_DIR ?? perfArtifactRoot,
        FIGMAPIPE_PERF_BASELINE_PATH:
          process.env.FIGMAPIPE_PERF_BASELINE_PATH ?? path.join(perfArtifactRoot, "perf-baseline.json"),
        FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP: process.env.FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP ?? "true"
      }
    });
  }

  for (const command of commands) {
    onLog(`Running ${command.name}`);
    const result = await runCommand({
      cwd: generatedProjectDir,
      command: "pnpm",
      args: command.args,
      env: command.env
    });

    if (!result.success) {
      throw new Error(`${command.name} failed: ${result.combined.slice(0, 2000)}`);
    }
  }
};

export const runProjectValidation = async ({
  generatedProjectDir,
  onLog,
  enablePerfValidation = false
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enablePerfValidation?: boolean;
}): Promise<void> => {
  return await runProjectValidationWithDeps({ generatedProjectDir, onLog, enablePerfValidation });
};
