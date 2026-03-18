import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runCommand as runCommandImpl } from "./command-runner.js";
import {
  runValidationFeedback as runValidationFeedbackImpl,
  type RetryableValidationStage,
  type ValidationFeedbackResult
} from "./validation-feedback.js";
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
  runValidationFeedback: (input: {
    generatedProjectDir: string;
    stage: RetryableValidationStage;
    output: string;
    onLog: (message: string) => void;
  }) => Promise<ValidationFeedbackResult>;
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

const LINT_RELEVANT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const MAX_LOGGED_CHANGED_FILES = 20;
const MAX_VALIDATION_ATTEMPTS = 3;

const toPosixPath = (filePath: string): string => {
  return filePath.split(path.sep).join("/");
};

const isLintRelevantFile = ({ relativePath }: { relativePath: string }): boolean => {
  const basename = path.basename(relativePath).toLowerCase();
  if (basename.startsWith(".eslintrc") || basename.startsWith("eslint.config.")) {
    return true;
  }
  return LINT_RELEVANT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
};

const collectLintRelevantFingerprints = async ({
  generatedProjectDir
}: {
  generatedProjectDir: string;
}): Promise<Map<string, string>> => {
  const fingerprints = new Map<string, string>();

  const walk = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".figmapipe") {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPosixPath(path.relative(generatedProjectDir, absolutePath));
      if (!isLintRelevantFile({ relativePath })) {
        continue;
      }

      const content = await readFile(absolutePath);
      const fingerprint = createHash("sha256").update(content).digest("hex");
      fingerprints.set(relativePath, fingerprint);
    }
  };

  await walk(generatedProjectDir);
  return fingerprints;
};

const toChangedFiles = ({
  before,
  after
}: {
  before: Map<string, string>;
  after: Map<string, string>;
}): string[] => {
  const fileSet = new Set([...before.keys(), ...after.keys()]);
  return [...fileSet]
    .filter((filePath) => before.get(filePath) !== after.get(filePath))
    .sort((first, second) => first.localeCompare(second));
};

const formatChangedFilesForLog = ({ changedFiles }: { changedFiles: string[] }): string => {
  if (changedFiles.length <= MAX_LOGGED_CHANGED_FILES) {
    return changedFiles.join(", ");
  }
  const listed = changedFiles.slice(0, MAX_LOGGED_CHANGED_FILES).join(", ");
  const omittedCount = changedFiles.length - MAX_LOGGED_CHANGED_FILES;
  return `${listed} (+${omittedCount} more)`;
};

export const runProjectValidationWithDeps = async ({
  generatedProjectDir,
  onLog,
  enableLintAutofix = true,
  enablePerfValidation = false,
  enableUiValidation = false,
  enableUnitTestValidation = false,
  commandTimeoutMs = 15 * 60_000,
  installPreferOffline = true,
  skipInstall = false,
  deps
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enableLintAutofix?: boolean;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  enableUnitTestValidation?: boolean;
  commandTimeoutMs?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  deps?: Partial<ValidationDeps>;
}): Promise<void> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const runValidationFeedback = deps?.runValidationFeedback ?? runValidationFeedbackImpl;
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

  const installCommand: {
    name: string;
    args: string[];
    timeoutMs?: number;
  } | undefined = !skipInstall
    ? { name: "install", args: installArgs, timeoutMs: Math.max(commandTimeoutMs, 20 * 60_000) }
    : undefined;

  const attemptCommands: Array<{
    name: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    ignoreFailure?: boolean;
  }> = [];
  if (enableLintAutofix) {
    attemptCommands.push({
      name: "lint-autofix",
      args: ["lint", "--fix"],
      timeoutMs: commandTimeoutMs,
      ignoreFailure: true
    });
  }
  attemptCommands.push({ name: "lint", args: ["lint"], timeoutMs: commandTimeoutMs });
  attemptCommands.push({ name: "typecheck", args: ["typecheck"], timeoutMs: commandTimeoutMs });
  attemptCommands.push({ name: "build", args: ["build"], timeoutMs: commandTimeoutMs });
  if (enableUnitTestValidation) {
    attemptCommands.push({ name: "test", args: ["run", "test"], timeoutMs: commandTimeoutMs });
  }

  if (enableUiValidation) {
    attemptCommands.push({
      name: "validate-ui",
      args: ["run", "validate:ui"],
      timeoutMs: commandTimeoutMs
    });
  }

  if (enablePerfValidation) {
    attemptCommands.push({
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

  const isRetryableStage = (value: string): value is RetryableValidationStage => {
    return value === "lint" || value === "typecheck" || value === "build";
  };

  if (installCommand) {
    onLog(`Running ${installCommand.name}`);
    const installResult = await runCommand({
      cwd: generatedProjectDir,
      command: "pnpm",
      args: installCommand.args,
      ...(installCommand.timeoutMs ? { timeoutMs: installCommand.timeoutMs } : {})
    });
    if (!installResult.success) {
      const timeoutSuffix = installResult.timedOut ? " (command timeout)" : "";
      throw new Error(`${installCommand.name} failed${timeoutSuffix}: ${installResult.combined.slice(0, 2000)}`);
    }
  }

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
    onLog(`Validation attempt ${attempt}/${MAX_VALIDATION_ATTEMPTS}`);
    let shouldRetry = false;

    for (const command of attemptCommands) {
      onLog(`Running ${command.name}`);

      let beforeAutofix = new Map<string, string>();
      let shouldDiffAutofixChanges = command.name === "lint-autofix";
      if (command.name === "lint-autofix") {
        try {
          beforeAutofix = await collectLintRelevantFingerprints({ generatedProjectDir });
        } catch (error) {
          shouldDiffAutofixChanges = false;
          const message = error instanceof Error ? error.message : String(error);
          onLog(`Lint auto-fix file-diff pre-scan failed: ${message}`);
        }
      }

      const result = await runCommand({
        cwd: generatedProjectDir,
        command: "pnpm",
        args: command.args,
        ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
        ...(command.env ? { env: command.env } : {})
      });

      if (command.name === "lint-autofix") {
        if (shouldDiffAutofixChanges) {
          try {
            const afterAutofix = await collectLintRelevantFingerprints({ generatedProjectDir });
            const changedFiles = toChangedFiles({ before: beforeAutofix, after: afterAutofix });
            if (changedFiles.length === 0) {
              onLog("Lint auto-fix changed 0 lint-relevant file(s).");
            } else {
              onLog(
                `Lint auto-fix changed ${changedFiles.length} lint-relevant file(s): ${formatChangedFilesForLog({ changedFiles })}`
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onLog(`Lint auto-fix file-diff post-scan failed: ${message}`);
          }
        }

        if (!result.success) {
          const timeoutSuffix = result.timedOut ? " (command timeout)" : "";
          const output = result.combined.slice(0, 600);
          onLog(`Lint auto-fix failed${timeoutSuffix}; continuing with final lint check. Output: ${output}`);
        }
      }

      if (result.success || command.ignoreFailure) {
        continue;
      }

      const timeoutSuffix = result.timedOut ? " (command timeout)" : "";
      const truncatedOutput = result.combined.slice(0, 2000);

      if (!isRetryableStage(command.name)) {
        throw new Error(`${command.name} failed${timeoutSuffix}: ${truncatedOutput}`);
      }

      if (attempt >= MAX_VALIDATION_ATTEMPTS) {
        throw new Error(
          `${command.name} failed${timeoutSuffix} after ${MAX_VALIDATION_ATTEMPTS} attempts: ${truncatedOutput}`
        );
      }

      const feedback = await runValidationFeedback({
        generatedProjectDir,
        stage: command.name,
        output: result.combined,
        onLog
      });

      onLog(
        `Applied ${feedback.correctionsApplied} correction edit(s) across ${feedback.changedFiles.length} file(s) after ${command.name} failure.`
      );

      if (feedback.changedFiles.length === 0) {
        throw new Error(
          `${command.name} failed${timeoutSuffix}; no auto-corrections were applied. Diagnostics: ${feedback.summary}. Output: ${truncatedOutput}`
        );
      }

      onLog(
        `Retrying validation after ${command.name} corrections (${attempt + 1}/${MAX_VALIDATION_ATTEMPTS}).`
      );
      shouldRetry = true;
      break;
    }

    if (!shouldRetry) {
      return;
    }
  }
};

export const runProjectValidation = async ({
  generatedProjectDir,
  onLog,
  enableLintAutofix = true,
  enablePerfValidation = false,
  enableUiValidation = false,
  enableUnitTestValidation = false,
  commandTimeoutMs = 15 * 60_000,
  installPreferOffline = true,
  skipInstall = false
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
  enableLintAutofix?: boolean;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  enableUnitTestValidation?: boolean;
  commandTimeoutMs?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
}): Promise<void> => {
  return await runProjectValidationWithDeps({
    generatedProjectDir,
    onLog,
    enableLintAutofix,
    enablePerfValidation,
    enableUiValidation,
    enableUnitTestValidation,
    commandTimeoutMs,
    installPreferOffline,
    skipInstall
  });
};
