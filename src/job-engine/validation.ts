import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobDiagnostic } from "../contracts/index.js";
import { runCommand as runCommandImpl } from "./command-runner.js";
import { createPipelineError, type PipelineDiagnosticInput, type PipelineDiagnosticLimits } from "./errors.js";
import {
  parseValidationDiagnostics,
  runValidationFeedback as runValidationFeedbackImpl,
  type RetryableValidationStage,
  type ValidationDiagnostic,
  type ValidationFeedbackResult
} from "./validation-feedback.js";
import type { CommandExecutionInput, CommandResult } from "./types.js";

interface ValidationDeps {
  runCommand: (input: CommandExecutionInput) => Promise<CommandResult>;
  runValidationFeedback: (input: {
    generatedProjectDir: string;
    stage: RetryableValidationStage;
    output: string;
    onLog: (message: string) => void;
  }) => Promise<ValidationFeedbackResult>;
}

type ValidationNodeModulesStrategy =
  | "skip_install"
  | "fresh_install"
  | "existing_node_modules"
  | "reused_seeded_node_modules";

export interface ValidationCommandResult {
  status: "passed";
  command: "pnpm";
  args: string[];
  attempt: number;
  timedOut: boolean;
  outputCaptureKey?: string;
}

export interface ValidationLintAutofixResult extends Omit<ValidationCommandResult, "status"> {
  status: "completed" | "failed_ignored";
  changedFiles: string[];
}

export interface ValidationInstallResult {
  status: "completed" | "skipped";
  strategy: ValidationNodeModulesStrategy;
  command?: ValidationCommandResult;
}

export interface ProjectValidationResult {
  attempts: number;
  install: ValidationInstallResult;
  lintAutofix?: ValidationLintAutofixResult;
  lint: ValidationCommandResult;
  typecheck: ValidationCommandResult;
  build: ValidationCommandResult;
  test?: ValidationCommandResult;
  validateUi?: ValidationCommandResult;
  perfAssert?: ValidationCommandResult;
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

const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await lstat(candidatePath);
    return true;
  } catch {
    return false;
  }
};

const prepareValidationNodeModules = async ({
  generatedProjectDir,
  seedNodeModulesDir,
  skipInstall,
  onLog,
  pipelineDiagnosticLimits
}: {
  generatedProjectDir: string;
  seedNodeModulesDir?: string;
  skipInstall: boolean;
  onLog: (message: string) => void;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<{
  installRequired: boolean;
  strategy: ValidationNodeModulesStrategy;
  cleanup?: () => Promise<void>;
}> => {
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");

  if (skipInstall) {
    const nodeModulesExists = await hasExistingNodeModules({ generatedProjectDir });
    if (!nodeModulesExists) {
      throw createPipelineError({
        code: "E_VALIDATE_PROJECT",
        stage: "validate.project",
        message: `skipInstall=true requires an existing node_modules directory at ${nodeModulesDir}.`,
        ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {}),
        diagnostics: [
          {
            code: "E_VALIDATE_PROJECT",
            message: "Validation cannot run because node_modules is missing while skipInstall=true.",
            suggestion: "Either disable skipInstall or ensure dependencies are installed in generated-app/node_modules.",
            stage: "validate.project",
            severity: "error",
            details: {
              generatedProjectDir
            }
          }
        ]
      });
    }
    onLog("Skipping install because skipInstall=true.");
    return {
      installRequired: false,
      strategy: "skip_install"
    };
  }

  if (!seedNodeModulesDir) {
    return {
      installRequired: true,
      strategy: "fresh_install"
    };
  }

  if (await hasExistingNodeModules({ generatedProjectDir })) {
    return {
      installRequired: true,
      strategy: "existing_node_modules"
    };
  }

  let seedNodeModulesMetadata: Awaited<ReturnType<typeof stat>>;
  try {
    seedNodeModulesMetadata = await stat(seedNodeModulesDir);
  } catch {
    return {
      installRequired: true,
      strategy: "fresh_install"
    };
  }

  if (!seedNodeModulesMetadata.isDirectory()) {
    return {
      installRequired: true,
      strategy: "fresh_install"
    };
  }

  if (await pathExists(nodeModulesDir)) {
    await rm(nodeModulesDir, { recursive: true, force: true });
  }

  await symlink(seedNodeModulesDir, nodeModulesDir, process.platform === "win32" ? "junction" : "dir");
  onLog(`Reusing seeded node_modules from ${seedNodeModulesDir}.`);

  return {
    installRequired: false,
    strategy: "reused_seeded_node_modules",
    cleanup: async () => {
      await rm(nodeModulesDir, { recursive: true, force: true });
    }
  };
};

const LINT_RELEVANT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const MAX_LOGGED_CHANGED_FILES = 20;
const MAX_VALIDATION_ATTEMPTS = 3;
const MAX_EMITTED_VALIDATION_DIAGNOSTICS = 8;

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

const toRetryableDiagnosticStage = (commandName: string): RetryableValidationStage | undefined => {
  if (commandName === "lint") {
    return "lint";
  }
  if (commandName === "typecheck") {
    return "typecheck";
  }
  if (commandName === "build") {
    return "build";
  }
  return undefined;
};

const toCodeContext = async ({
  filePath,
  line
}: {
  filePath: string | undefined;
  line: number | undefined;
}): Promise<string | undefined> => {
  if (!filePath || !line || line <= 0) {
    return undefined;
  }
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) {
      return undefined;
    }
    const lineIndex = Math.min(lines.length - 1, line - 1);
    const start = Math.max(0, lineIndex - 1);
    const end = Math.min(lines.length - 1, lineIndex + 1);
    const output: string[] = [];
    for (let index = start; index <= end; index += 1) {
      output.push(`${index + 1}: ${lines[index] ?? ""}`);
    }
    return output.join("\n");
  } catch {
    return undefined;
  }
};

const toValidationDetailDiagnostics = async ({
  diagnostics
}: {
  diagnostics: ValidationDiagnostic[];
}): Promise<WorkspaceJobDiagnostic[]> => {
  const detailed: WorkspaceJobDiagnostic[] = [];
  for (const diagnostic of diagnostics.slice(0, MAX_EMITTED_VALIDATION_DIAGNOSTICS)) {
    const codeContext = await toCodeContext({
      filePath: diagnostic.filePath,
      line: diagnostic.line
    });
    detailed.push({
      code: "E_VALIDATE_PROJECT_DETAIL",
      message:
        diagnostic.message +
        (diagnostic.code ? ` (${diagnostic.code})` : diagnostic.rule ? ` (${diagnostic.rule})` : ""),
      suggestion: "Fix the generated source near the reported location and rerun the job.",
      stage: "validate.project",
      severity: "error",
      details: {
        commandStage: diagnostic.stage,
        ...(diagnostic.filePath ? { filePath: diagnostic.filePath } : {}),
        ...(diagnostic.line ? { line: diagnostic.line } : {}),
        ...(diagnostic.column ? { column: diagnostic.column } : {}),
        ...(diagnostic.code ? { code: diagnostic.code } : {}),
        ...(diagnostic.rule ? { rule: diagnostic.rule } : {}),
        ...(codeContext ? { codeContext } : {})
      }
    });
  }
  return detailed;
};

const toCommandCaptureDetails = ({
  result
}: {
  result: CommandResult;
}): Record<string, unknown> | undefined => {
  const details: Record<string, unknown> = {};

  if (result.stdoutMetadata) {
    details.stdout = result.stdoutMetadata;
  }
  if (result.stderrMetadata) {
    details.stderr = result.stderrMetadata;
  }

  return Object.keys(details).length > 0 ? details : undefined;
};

const toValidationOutputCapture = ({
  jobDir,
  key,
  commandStdoutMaxBytes,
  commandStderrMaxBytes
}: {
  jobDir: string | undefined;
  key: string;
  commandStdoutMaxBytes: number;
  commandStderrMaxBytes: number;
}): CommandExecutionInput["outputCapture"] => {
  if (!jobDir) {
    return undefined;
  }

  return {
    jobDir,
    key,
    stdoutMaxBytes: commandStdoutMaxBytes,
    stderrMaxBytes: commandStderrMaxBytes
  };
};

const toValidationPipelineError = async ({
  commandName,
  timeoutSuffix,
  failureHint,
  output,
  result,
  generatedProjectDir,
  diagnostics,
  summary,
  limits
}: {
  commandName: string;
  timeoutSuffix: string;
  failureHint?: string;
  output: string;
  result?: CommandResult;
  generatedProjectDir: string;
  diagnostics: ValidationDiagnostic[];
  summary: string | undefined;
  limits?: PipelineDiagnosticLimits;
}) => {
  const hintSuffix = failureHint ? ` (${failureHint})` : "";
  const detailDiagnostics = await toValidationDetailDiagnostics({
    diagnostics
  });
  const primaryDiagnostic: PipelineDiagnosticInput = {
    code: "E_VALIDATE_PROJECT",
    message: `${commandName} failed${timeoutSuffix}${hintSuffix}.`,
    suggestion: "Resolve generated-project validation diagnostics and rerun the pipeline.",
    stage: "validate.project",
    severity: "error",
    details: {
      command: commandName,
      ...(summary ? { summary } : {}),
      ...(failureHint ? { failureHint } : {}),
      output: output.slice(0, 2000),
      ...(result ? { outputCapture: toCommandCaptureDetails({ result }) } : {}),
      generatedProjectDir
    }
  };
  return createPipelineError({
    code: "E_VALIDATE_PROJECT",
    stage: "validate.project",
    message: `${commandName} failed${timeoutSuffix}${hintSuffix}: ${output.slice(0, 2000)}`,
    ...(limits ? { limits } : {}),
    diagnostics: [
      primaryDiagnostic,
      ...detailDiagnostics.map((entry) => ({
        code: entry.code,
        message: entry.message,
        suggestion: entry.suggestion,
        stage: entry.stage,
        severity: entry.severity,
        ...(entry.details ? { details: entry.details } : {})
      }))
    ]
  });
};

export const runProjectValidationWithDeps = async ({
  generatedProjectDir,
  jobDir,
  onLog,
  enableLintAutofix = true,
  enablePerfValidation = false,
  enableUiValidation = false,
  enableUnitTestValidation = false,
  commandTimeoutMs = 15 * 60_000,
  commandStdoutMaxBytes = 1_048_576,
  commandStderrMaxBytes = 1_048_576,
  installPreferOffline = true,
  skipInstall = false,
  lockfileMutable = false,
  pipelineDiagnosticLimits,
  abortSignal,
  seedNodeModulesDir,
  deps
}: {
  generatedProjectDir: string;
  jobDir?: string;
  onLog: (message: string) => void;
  enableLintAutofix?: boolean;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  enableUnitTestValidation?: boolean;
  commandTimeoutMs?: number;
  commandStdoutMaxBytes?: number;
  commandStderrMaxBytes?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  lockfileMutable?: boolean;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
  abortSignal?: AbortSignal;
  seedNodeModulesDir?: string;
  deps?: Partial<ValidationDeps>;
}): Promise<ProjectValidationResult> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const runValidationFeedback = deps?.runValidationFeedback ?? runValidationFeedbackImpl;
  const perfArtifactRoot = path.join(generatedProjectDir, ".figmapipe", "performance");

  const installArgs = lockfileMutable
    ? ["install", "--reporter", "append-only"]
    : ["install", "--frozen-lockfile", "--reporter", "append-only"];
  if (installPreferOffline) {
    installArgs.push("--prefer-offline");
  }

  const nodeModulesPreparation = await prepareValidationNodeModules({
    generatedProjectDir,
    skipInstall,
    onLog,
    ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {}),
    ...(seedNodeModulesDir ? { seedNodeModulesDir } : {})
  });

  const installCommand: {
    name: string;
    args: string[];
    timeoutMs?: number;
  } | undefined = nodeModulesPreparation.installRequired
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

  const validationResult: Partial<ProjectValidationResult> & Pick<ProjectValidationResult, "install"> = {
    install: {
      status: installCommand ? "completed" : "skipped",
      strategy: nodeModulesPreparation.strategy
    }
  };

  const toSuccessfulCommandResult = ({
    args,
    attempt,
    timedOut,
    outputCaptureKey
  }: {
    args: string[];
    attempt: number;
    timedOut: boolean;
    outputCaptureKey?: string;
  }): ValidationCommandResult => {
    return {
      status: "passed",
      command: "pnpm",
      args,
      attempt,
      timedOut,
      ...(outputCaptureKey ? { outputCaptureKey } : {})
    };
  };

  const throwIfCanceled = (): void => {
    if (!abortSignal?.aborted) {
      return;
    }
    throw new Error("Validation canceled by job cancellation request.");
  };

  try {
    throwIfCanceled();

    if (installCommand) {
      onLog(`Running ${installCommand.name}`);
      throwIfCanceled();
      const installResult = await runCommand({
        cwd: generatedProjectDir,
        command: "pnpm",
        args: installCommand.args,
        ...(installCommand.timeoutMs ? { timeoutMs: installCommand.timeoutMs } : {}),
        ...(jobDir
          ? {
              outputCapture: toValidationOutputCapture({
                jobDir,
                key: "validate.project.install",
                commandStdoutMaxBytes,
                commandStderrMaxBytes
              }) as NonNullable<CommandExecutionInput["outputCapture"]>
            }
          : {}),
        ...(abortSignal ? { abortSignal } : {})
      });
      validationResult.install.command = toSuccessfulCommandResult({
        args: installCommand.args,
        attempt: 1,
        timedOut: installResult.timedOut === true,
        ...(jobDir ? { outputCaptureKey: "validate.project.install" } : {})
      });
      if (installResult.canceled) {
        throw new Error(`${installCommand.name} canceled by job cancellation request.`);
      }
      if (!installResult.success) {
        const timeoutSuffix = installResult.timedOut ? " (command timeout)" : "";
        const outputCaptureDetails = toCommandCaptureDetails({ result: installResult });
        throw createPipelineError({
          code: "E_VALIDATE_PROJECT",
          stage: "validate.project",
          message: `${installCommand.name} failed${timeoutSuffix}: ${installResult.combined.slice(0, 2000)}`,
          ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {}),
          diagnostics: [
            {
              code: "E_VALIDATE_PROJECT",
              message: `${installCommand.name} failed${timeoutSuffix}.`,
              suggestion: "Check dependency resolution/network access and rerun validation.",
              stage: "validate.project",
              severity: "error",
              details: {
                command: installCommand.name,
                output: installResult.combined.slice(0, 2000),
                ...(outputCaptureDetails ? { outputCapture: outputCaptureDetails } : {})
              }
            }
          ]
        });
      }
    }

    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
      validationResult.attempts = attempt;
      onLog(`Validation attempt ${attempt}/${MAX_VALIDATION_ATTEMPTS}`);
      let shouldRetry = false;

      for (const command of attemptCommands) {
        onLog(`Running ${command.name}`);
        throwIfCanceled();

        let beforeAutofix = new Map<string, string>();
        let shouldDiffAutofixChanges = command.name === "lint-autofix";
        let changedFiles: string[] = [];
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
          ...(command.env ? { env: command.env } : {}),
          ...(jobDir
            ? {
                outputCapture: toValidationOutputCapture({
                  jobDir,
                  key: `validate.project.attempt-${attempt}.${command.name}`,
                  commandStdoutMaxBytes,
                  commandStderrMaxBytes
                }) as NonNullable<CommandExecutionInput["outputCapture"]>
              }
            : {}),
          ...(abortSignal ? { abortSignal } : {})
        });
        if (result.canceled) {
          throw new Error(`${command.name} canceled by job cancellation request.`);
        }

        if (command.name === "lint-autofix") {
          if (shouldDiffAutofixChanges) {
            try {
              const afterAutofix = await collectLintRelevantFingerprints({ generatedProjectDir });
              changedFiles = toChangedFiles({ before: beforeAutofix, after: afterAutofix });
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

          validationResult.lintAutofix = {
            command: "pnpm",
            args: command.args,
            attempt,
            timedOut: result.timedOut === true,
            status: result.success ? "completed" : "failed_ignored",
            changedFiles,
            ...(jobDir ? { outputCaptureKey: `validate.project.attempt-${attempt}.lint-autofix` } : {})
          };

          if (!result.success) {
            const timeoutSuffix = result.timedOut ? " (command timeout)" : "";
            const output = result.combined.slice(0, 600);
            onLog(`Lint auto-fix failed${timeoutSuffix}; continuing with final lint check. Output: ${output}`);
          }
        }

        const successfulCommandResult = toSuccessfulCommandResult({
          args: command.args,
          attempt,
          timedOut: result.timedOut === true,
          ...(jobDir ? { outputCaptureKey: `validate.project.attempt-${attempt}.${command.name}` } : {})
        });

        if (result.success) {
          if (command.name === "lint") {
            validationResult.lint = successfulCommandResult;
          } else if (command.name === "typecheck") {
            validationResult.typecheck = successfulCommandResult;
          } else if (command.name === "build") {
            validationResult.build = successfulCommandResult;
          } else if (command.name === "test") {
            validationResult.test = successfulCommandResult;
          } else if (command.name === "validate-ui") {
            validationResult.validateUi = successfulCommandResult;
          } else if (command.name === "perf-assert") {
            validationResult.perfAssert = successfulCommandResult;
          }
        }

        if (result.success || command.ignoreFailure) {
          continue;
        }

        const timeoutSuffix = result.timedOut ? " (command timeout)" : "";
        const retryableStage = toRetryableDiagnosticStage(command.name);
        const parsedDiagnostics =
          retryableStage !== undefined
            ? parseValidationDiagnostics({
                stage: retryableStage,
                output: result.combined,
                generatedProjectDir
              })
            : [];

        if (!isRetryableStage(command.name)) {
          throw await toValidationPipelineError({
            commandName: command.name,
            timeoutSuffix,
            output: result.combined,
            result,
            generatedProjectDir,
            diagnostics: parsedDiagnostics,
            summary: undefined,
            ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
          });
        }

        if (attempt >= MAX_VALIDATION_ATTEMPTS) {
          throw await toValidationPipelineError({
            commandName: command.name,
            timeoutSuffix: `${timeoutSuffix} after ${MAX_VALIDATION_ATTEMPTS} attempts`,
            output: result.combined,
            result,
            generatedProjectDir,
            diagnostics: parsedDiagnostics,
            summary: `Failed after ${MAX_VALIDATION_ATTEMPTS} attempts.`,
            ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
          });
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
          throw await toValidationPipelineError({
            commandName: command.name,
            timeoutSuffix,
            failureHint: "no auto-corrections were applied",
            output: result.combined,
            result,
            generatedProjectDir,
            diagnostics: feedback.diagnostics,
            summary: feedback.summary,
            ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
          });
        }

        onLog(
          `Retrying validation after ${command.name} corrections (${attempt + 1}/${MAX_VALIDATION_ATTEMPTS}).`
        );
        shouldRetry = true;
        break;
      }

      if (!shouldRetry) {
        return validationResult as ProjectValidationResult;
      }
    }
  } finally {
    await nodeModulesPreparation.cleanup?.();
  }

  throw new Error("Validation loop exited without producing a result.");
};

export const runProjectValidation = async ({
  generatedProjectDir,
  jobDir,
  onLog,
  enableLintAutofix = true,
  enablePerfValidation = false,
  enableUiValidation = false,
  enableUnitTestValidation = false,
  commandTimeoutMs = 15 * 60_000,
  commandStdoutMaxBytes = 1_048_576,
  commandStderrMaxBytes = 1_048_576,
  installPreferOffline = true,
  skipInstall = false,
  lockfileMutable = false,
  pipelineDiagnosticLimits,
  abortSignal,
  seedNodeModulesDir
}: {
  generatedProjectDir: string;
  jobDir?: string;
  onLog: (message: string) => void;
  enableLintAutofix?: boolean;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  enableUnitTestValidation?: boolean;
  commandTimeoutMs?: number;
  commandStdoutMaxBytes?: number;
  commandStderrMaxBytes?: number;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  lockfileMutable?: boolean;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
  abortSignal?: AbortSignal;
  seedNodeModulesDir?: string;
}): Promise<ProjectValidationResult> => {
  return await runProjectValidationWithDeps({
    generatedProjectDir,
    ...(jobDir ? { jobDir } : {}),
    onLog,
    enableLintAutofix,
    enablePerfValidation,
    enableUiValidation,
    enableUnitTestValidation,
    commandTimeoutMs,
    commandStdoutMaxBytes,
    commandStderrMaxBytes,
    installPreferOffline,
    skipInstall,
    lockfileMutable,
    ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {}),
    ...(seedNodeModulesDir ? { seedNodeModulesDir } : {}),
    ...(abortSignal ? { abortSignal } : {})
  });
};
