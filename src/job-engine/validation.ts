import { stat } from "node:fs/promises";
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
    timeoutMs?: number;
  }) => Promise<CommandResult>;
}

const hasExistingNodeModules = async ({ generatedProjectDir }: { generatedProjectDir: string }): Promise<boolean> => {
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");
  try {
    const metadata = await stat(nodeModulesDir);
    return metadata.isDirectory();
  } catch {
    return false;
  }
};

export const runProjectValidationWithDeps = async ({
  generatedProjectDir,
  onLog,
  enablePerfValidation = false,
  enableUiValidation = false,
  commandTimeoutMs = 15 * 60_000,
  installPreferOffline = true,
  skipInstall = false,
  deps
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  commandTimeoutMs?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  deps?: Partial<ValidationDeps>;
}): Promise<void> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const perfArtifactRoot = path.join(generatedProjectDir, ".figmapipe", "performance");

  const installArgs = ["install", "--frozen-lockfile", "--reporter", "append-only"];
  if (installPreferOffline) {
    installArgs.push("--prefer-offline");
  }

  if (skipInstall) {
    const nodeModulesExists = await hasExistingNodeModules({ generatedProjectDir });
    if (!nodeModulesExists) {
      throw new Error(
        `skipInstall=true requires an existing node_modules directory at ${path.join(generatedProjectDir, "node_modules")}.`
      );
    }
    onLog("Skipping install because skipInstall=true.");
  }

  const commands: Array<{ name: string; args: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number }> = [
    { name: "lint", args: ["lint"], timeoutMs: commandTimeoutMs },
    { name: "typecheck", args: ["typecheck"], timeoutMs: commandTimeoutMs },
    { name: "build", args: ["build"], timeoutMs: commandTimeoutMs }
  ];
  if (!skipInstall) {
    commands.unshift({ name: "install", args: installArgs, timeoutMs: Math.max(commandTimeoutMs, 20 * 60_000) });
  }

  if (enableUiValidation) {
    commands.push({
      name: "validate-ui",
      args: ["run", "validate:ui"],
      timeoutMs: commandTimeoutMs
    });
  }

  if (enablePerfValidation) {
    commands.push({
      name: "perf-assert",
      args: ["run", "perf:assert"],
      timeoutMs: Math.max(commandTimeoutMs, 20 * 60_000),
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
      ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
      ...(command.env ? { env: command.env } : {})
    });

    if (!result.success) {
      const timeoutSuffix = result.timedOut ? " (command timeout)" : "";
      throw new Error(`${command.name} failed${timeoutSuffix}: ${result.combined.slice(0, 2000)}`);
    }
  }
};

export const runProjectValidation = async ({
  generatedProjectDir,
  onLog,
  enablePerfValidation = false,
  enableUiValidation = false,
  commandTimeoutMs = 15 * 60_000,
  installPreferOffline = true,
  skipInstall = false
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  commandTimeoutMs?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
}): Promise<void> => {
  return await runProjectValidationWithDeps({
    generatedProjectDir,
    onLog,
    enablePerfValidation,
    enableUiValidation,
    commandTimeoutMs,
    installPreferOffline,
    skipInstall
  });
};
