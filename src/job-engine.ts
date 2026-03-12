import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorkspaceFigmaSourceMode,
  WorkspaceGitPrStatus,
  WorkspaceJobArtifacts,
  WorkspaceJobError,
  WorkspaceJobInput,
  WorkspaceJobLog,
  WorkspaceJobResult,
  WorkspaceJobRuntimeStatus,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStageStatus,
  WorkspaceJobStatus,
  WorkspaceLlmCodegenMode,
  WorkspaceSubmitAccepted
} from "./contracts/index.js";
import { generateArtifacts } from "./parity/generator-core.js";
import { figmaToDesignIrWithOptions } from "./parity/ir.js";
import { resolveBoardKey } from "./parity/board-key.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app");
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const LOG_LIMIT = 300;

const STAGE_ORDER: WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr"
];

interface FigmaFileResponse {
  name?: string;
  document?: unknown;
}

interface JobRecord {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  currentStage?: WorkspaceJobStageName;
  submittedAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: WorkspaceJobStatus["request"];
  stages: WorkspaceJobStage[];
  logs: WorkspaceJobLog[];
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  gitPr?: WorkspaceGitPrStatus;
  error?: WorkspaceJobError;
}

interface WorkspacePipelineError extends Error {
  code: string;
  stage: WorkspaceJobStageName;
}

interface JobEnginePaths {
  outputRoot: string;
  jobsRoot: string;
  reprosRoot: string;
}

interface JobEngineRuntime {
  figmaTimeoutMs: number;
  figmaMaxRetries: number;
  previewEnabled: boolean;
  fetchImpl: typeof fetch;
}

interface CreateJobEngineInput {
  resolveBaseUrl: () => string;
  paths: JobEnginePaths;
  runtime: JobEngineRuntime;
}

interface CommandResult {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

interface GitPrExecutionResult {
  status: "executed";
  prUrl?: string;
  branchName: string;
  scopePath: string;
  changedFiles: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toFileSystemSafe = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "generated";
};

const nowIso = (): string => new Date().toISOString();

const createPipelineError = ({
  code,
  stage,
  message,
  cause
}: {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  cause?: unknown;
}): WorkspacePipelineError => {
  const error = new Error(message) as WorkspacePipelineError;
  error.code = code;
  error.stage = stage;
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return error;
};

const createInitialStages = (): WorkspaceJobStage[] => {
  return STAGE_ORDER.map((name) => ({
    name,
    status: "queued"
  }));
};

const parseFigmaStatus = (status: number): { code: string; retryable: boolean } => {
  if (status === 401 || status === 403) {
    return { code: "E_FIGMA_AUTH", retryable: false };
  }
  if (status === 404) {
    return { code: "E_FIGMA_NOT_FOUND", retryable: false };
  }
  if (status === 429) {
    return { code: "E_FIGMA_RATE_LIMIT", retryable: true };
  }
  if (status >= 500) {
    return { code: "E_FIGMA_UPSTREAM", retryable: true };
  }
  return { code: "E_FIGMA_HTTP", retryable: false };
};

const waitFor = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const fetchWithTimeout = async ({
  fetchImpl,
  url,
  headers,
  timeoutMs
}: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<Response> => {
  return await fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("timeout");
};

const toRetryDelay = ({ attempt }: { attempt: number }): number => {
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

const fetchFigmaFile = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
}): Promise<FigmaFileResponse> => {
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?geometry=paths`;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout({
        fetchImpl,
        url,
        timeoutMs,
        headers: {
          "X-Figma-Token": accessToken,
          Accept: "application/json"
        }
      });

      if (response.status === 403) {
        const bodyText = (await response.clone().text()).toLowerCase();
        if (bodyText.includes("invalid token")) {
          onLog("Figma PAT rejected, retrying request with Bearer authorization header.");
          response = await fetchWithTimeout({
            fetchImpl,
            url,
            timeoutMs,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          });
        }
      }
    } catch (error) {
      const shouldRetry = attempt < maxRetries;
      if (shouldRetry) {
        const delayMs = toRetryDelay({ attempt });
        onLog(
          `Figma request failed (${isTimeoutError(error) ? "timeout" : "network"}), retrying in ${delayMs}ms (${attempt}/${maxRetries}).`
        );
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: isTimeoutError(error) ? "E_FIGMA_TIMEOUT" : "E_FIGMA_NETWORK",
        stage: "figma.source",
        message: `Figma REST request failed: ${getErrorMessage(error)}`,
        cause: error
      });
    }

    if (!response.ok) {
      const failureBody = (await response.text()).slice(0, 500);
      const status = parseFigmaStatus(response.status);
      if (status.retryable && attempt < maxRetries) {
        const delayMs = toRetryDelay({ attempt });
        onLog(`Figma API responded ${response.status}, retrying in ${delayMs}ms (${attempt}/${maxRetries}).`);
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: status.code,
        stage: "figma.source",
        message: `Figma API error (${response.status}): ${failureBody || "no response body"}`
      });
    }

    try {
      const parsed = await response.json();
      if (!isRecord(parsed)) {
        throw new Error("Response is not an object.");
      }
      return parsed as FigmaFileResponse;
    } catch (error) {
      throw createPipelineError({
        code: "E_FIGMA_PARSE",
        stage: "figma.source",
        message: `Could not parse Figma API response: ${getErrorMessage(error)}`,
        cause: error
      });
    }
  }

  throw createPipelineError({
    code: "E_FIGMA_RETRY_EXHAUSTED",
    stage: "figma.source",
    message: "Figma REST retries exhausted."
  });
};

const resolveAbsoluteOutputRoot = ({ outputRoot }: { outputRoot: string }): JobEnginePaths => {
  return {
    outputRoot,
    jobsRoot: path.join(outputRoot, "jobs"),
    reprosRoot: path.join(outputRoot, "repros")
  };
};

const copyDir = async ({
  sourceDir,
  targetDir,
  filter
}: {
  sourceDir: string;
  targetDir: string;
  filter?: (sourcePath: string) => boolean;
}): Promise<void> => {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter
  });
};

const getContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
};

const normalizePathPart = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized;
};

const redactValue = ({ value, secret }: { value: string; secret?: string }): string => {
  if (!secret || !secret.trim()) {
    return value;
  }
  return value.split(secret).join("[REDACTED]");
};

const runCommand = async ({
  cwd,
  command,
  args,
  env,
  redactions
}: {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactions?: string[];
}): Promise<CommandResult> => {
  const safeRedactions = (redactions ?? []).filter((entry) => entry.trim().length > 0);

  return await new Promise<CommandResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
        NO_COLOR: process.env.NO_COLOR ?? "1",
        TERM: process.env.TERM ?? "dumb",
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const sanitizedStdout = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stdout);
      const sanitizedStderr = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stderr);
      const combined = [sanitizedStdout, sanitizedStderr].filter((part) => part.trim().length > 0).join("\n").trim();

      resolve({
        success: code === 0,
        code,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        combined
      });
    });

    child.on("error", (error) => {
      resolve({
        success: false,
        code: null,
        stdout: "",
        stderr: error.message,
        combined: error.message
      });
    });
  });
};

const resolveGitProvider = (repoUrl: string): "github" | "unsupported" => {
  if (/github\.com/i.test(repoUrl)) {
    return "github";
  }
  return "unsupported";
};

const parseGithubRepo = (repoUrl: string): { owner: string; name: string } | undefined => {
  const httpsMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      name: httpsMatch[2]
    };
  }

  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      name: sshMatch[2]
    };
  }

  return undefined;
};

const toGithubAuthedUrl = ({ repoUrl, token }: { repoUrl: string; token: string }): string => {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    throw new Error("Invalid GitHub repository URL.");
  }
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${parsed.owner}/${parsed.name}.git`;
};

const parseDefaultBranchFromSymref = (raw: string): string | undefined => {
  const match = raw.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
  return match?.[1];
};

const sanitizeTargetPath = (rawTargetPath: string | undefined): string => {
  const candidate = rawTargetPath && rawTargetPath.trim().length > 0 ? rawTargetPath.trim() : "figma-generated";
  const normalized = path.posix.normalize(candidate.replace(/\\/g, "/"));

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized.includes("..\\")
  ) {
    throw new Error(`Invalid targetPath '${candidate}'. Expected a safe relative path.`);
  }

  return normalized;
};

const copyGeneratedProjectIntoRepo = async ({
  generatedProjectDir,
  destinationDir
}: {
  generatedProjectDir: string;
  destinationDir: string;
}): Promise<void> => {
  await mkdir(path.dirname(destinationDir), { recursive: true });
  await cp(generatedProjectDir, destinationDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      if (sourcePath.includes(`${path.sep}node_modules`)) {
        return false;
      }
      return true;
    }
  });
};

const runGitPrFlow = async ({
  input,
  job,
  generatedProjectDir,
  jobDir,
  onLog
}: {
  input: WorkspaceJobInput;
  job: JobRecord;
  generatedProjectDir: string;
  jobDir: string;
  onLog: (message: string) => void;
}): Promise<GitPrExecutionResult> => {
  const repoUrl = input.repoUrl?.trim();
  const repoToken = input.repoToken?.trim();

  if (!repoUrl || !repoToken) {
    throw new Error("repoUrl and repoToken are required when enableGitPr=true");
  }

  const provider = resolveGitProvider(repoUrl);
  if (provider !== "github") {
    throw new Error("Only GitHub repositories are supported in workspace-dev git.pr mode.");
  }

  const boardKey = resolveBoardKey(input.figmaFileKey);
  const repoDir = path.join(jobDir, "repo");
  const redactions = [repoToken];
  const authedUrl = toGithubAuthedUrl({ repoUrl, token: repoToken });

  const defaultBranchProbe = await runCommand({
    cwd: jobDir,
    command: "git",
    args: ["ls-remote", "--symref", authedUrl, "HEAD"],
    redactions
  });

  const defaultBranch = parseDefaultBranchFromSymref(defaultBranchProbe.stdout) ?? "main";

  const cloneResult = await runCommand({
    cwd: jobDir,
    command: "git",
    args: ["clone", "--depth", "1", "--branch", defaultBranch, authedUrl, repoDir],
    redactions
  });

  if (!cloneResult.success) {
    throw new Error(`git clone failed: ${cloneResult.combined.slice(0, 2000)}`);
  }

  const branchName = `auto/figma/${boardKey}-${job.jobId.slice(0, 8)}`;
  const checkoutResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["checkout", "-b", branchName]
  });
  if (!checkoutResult.success) {
    throw new Error(`git checkout failed: ${checkoutResult.combined.slice(0, 2000)}`);
  }

  const targetPath = sanitizeTargetPath(input.targetPath);
  const scopePath = path.posix.join(targetPath, boardKey);
  const destinationDir = path.join(repoDir, scopePath);

  await copyGeneratedProjectIntoRepo({
    generatedProjectDir,
    destinationDir
  });

  const addResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["add", "-A", scopePath]
  });
  if (!addResult.success) {
    throw new Error(`git add failed: ${addResult.combined.slice(0, 2000)}`);
  }

  const changedFilesResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["diff", "--cached", "--name-only"]
  });
  if (!changedFilesResult.success) {
    throw new Error(`git diff failed: ${changedFilesResult.combined.slice(0, 2000)}`);
  }

  const changedFiles = changedFilesResult.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (changedFiles.length === 0) {
    onLog("No repository delta detected; git.pr completed without commit.");
    return {
      status: "executed",
      branchName,
      scopePath,
      changedFiles: []
    };
  }

  await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["config", "user.name", "workspace-dev bot"]
  });
  await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["config", "user.email", "workspace-dev@figmapipe.local"]
  });

  const commitResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["commit", "-m", `chore(figma): deterministic update ${boardKey}`]
  });
  if (!commitResult.success) {
    throw new Error(`git commit failed: ${commitResult.combined.slice(0, 2000)}`);
  }

  const pushResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["push", "-u", "origin", branchName],
    redactions
  });
  if (!pushResult.success) {
    throw new Error(`git push failed: ${pushResult.combined.slice(0, 2000)}`);
  }

  const githubRepo = parseGithubRepo(repoUrl);
  if (!githubRepo) {
    throw new Error("Could not parse GitHub repository owner/name.");
  }

  const prResponse = await fetch(`https://api.github.com/repos/${githubRepo.owner}/${githubRepo.name}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${repoToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: `chore(figma): deterministic update ${boardKey}`,
      body: `Generated by workspace-dev job ${job.jobId}.`,
      head: branchName,
      base: defaultBranch
    })
  });

  let prUrl: string | undefined;
  if (prResponse.ok) {
    const payload = (await prResponse.json()) as { html_url?: string };
    prUrl = payload.html_url;
  } else {
    const failureText = (await prResponse.text()).slice(0, 500);
    onLog(`PR creation failed (${prResponse.status}): ${redactValue({ value: failureText, secret: repoToken })}`);
  }

  return {
    status: "executed",
    prUrl,
    branchName,
    scopePath,
    changedFiles
  };
};

const toAcceptedModes = (): {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
} => {
  return {
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  };
};

const updateStage = ({
  job,
  stage,
  status,
  message
}: {
  job: JobRecord;
  stage: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  message?: string;
}): void => {
  const stageEntry = job.stages.find((entry) => entry.name === stage);
  if (!stageEntry) {
    return;
  }

  if (status === "running") {
    stageEntry.startedAt = nowIso();
  }

  if (status === "completed" || status === "failed" || status === "skipped") {
    stageEntry.completedAt = nowIso();
    if (stageEntry.startedAt) {
      const startedAtMs = Date.parse(stageEntry.startedAt);
      const completedAtMs = Date.parse(stageEntry.completedAt);
      if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)) {
        stageEntry.durationMs = Math.max(0, completedAtMs - startedAtMs);
      }
    }
  }

  stageEntry.status = status;
  stageEntry.message = message;
};

const pushLog = ({
  job,
  level,
  message,
  stage
}: {
  job: JobRecord;
  level: WorkspaceJobLog["level"];
  message: string;
  stage?: WorkspaceJobStageName;
}): void => {
  const redactedMessage = message
    .replace(/(token\s*=\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(x-access-token:)([^@\s]+)/gi, "$1[REDACTED]");

  job.logs.push({
    at: nowIso(),
    level,
    stage,
    message: redactedMessage
  });
  if (job.logs.length > LOG_LIMIT) {
    job.logs.splice(0, job.logs.length - LOG_LIMIT);
  }
};

const toPublicJob = (job: JobRecord): WorkspaceJobStatus => {
  return {
    jobId: job.jobId,
    status: job.status,
    currentStage: job.currentStage,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    request: { ...job.request },
    stages: job.stages.map((stage) => ({ ...stage })),
    logs: job.logs.map((entry) => ({ ...entry })),
    artifacts: { ...job.artifacts },
    preview: { ...job.preview },
    gitPr: job.gitPr ? { ...job.gitPr } : undefined,
    error: job.error ? { ...job.error } : undefined
  };
};

const toJobSummary = (job: JobRecord): string => {
  if (job.status === "completed") {
    const count = job.stages.filter((stage) => stage.status === "completed").length;
    return `Job completed successfully. ${count}/${job.stages.length} stages completed.`;
  }
  if (job.status === "failed") {
    const stage = job.error?.stage ?? job.currentStage ?? "unknown";
    return `Job failed during stage '${stage}'.`;
  }
  return `Job is currently ${job.status}.`;
};

const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await stat(candidatePath);
    return true;
  } catch {
    return false;
  }
};

const runProjectValidation = async ({
  generatedProjectDir,
  onLog
}: {
  generatedProjectDir: string;
  onLog: (message: string) => void;
}): Promise<void> => {
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

export interface JobEngine {
  submitJob: (input: WorkspaceJobInput) => WorkspaceSubmitAccepted;
  getJob: (jobId: string) => WorkspaceJobStatus | undefined;
  getJobResult: (jobId: string) => WorkspaceJobResult | undefined;
  resolvePreviewAsset: (jobId: string, previewPath: string) => Promise<{ content: Buffer; contentType: string } | undefined>;
}

export const createJobEngine = ({ resolveBaseUrl, paths, runtime }: CreateJobEngineInput): JobEngine => {
  const resolvedPaths = resolveAbsoluteOutputRoot({ outputRoot: paths.outputRoot });
  const jobs = new Map<string, JobRecord>();

  const markStageSkipped = ({
    job,
    stage,
    message
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
    message: string;
  }): void => {
    updateStage({ job, stage, status: "skipped", message });
    pushLog({ job, level: "info", stage, message });
  };

  const runStage = async <T>({
    job,
    stage,
    action
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
    action: () => Promise<T>;
  }): Promise<T> => {
    job.currentStage = stage;
    updateStage({ job, stage, status: "running" });
    pushLog({ job, level: "info", stage, message: `Starting stage '${stage}'.` });

    try {
      const result = await action();
      updateStage({ job, stage, status: "completed" });
      pushLog({ job, level: "info", stage, message: `Completed stage '${stage}'.` });
      return result;
    } catch (error) {
      const typedError =
        error instanceof Error && "stage" in error && "code" in error
          ? (error as WorkspacePipelineError)
          : createPipelineError({
              code: "E_PIPELINE_UNKNOWN",
              stage,
              message: getErrorMessage(error),
              cause: error
            });
      updateStage({
        job,
        stage,
        status: "failed",
        message: typedError.message
      });
      pushLog({
        job,
        level: "error",
        stage,
        message: `${typedError.code}: ${typedError.message}`
      });
      throw typedError;
    }
  };

  const runJob = async (job: JobRecord, input: WorkspaceJobInput): Promise<void> => {
    job.status = "running";
    job.startedAt = nowIso();

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.figmaJsonFile = figmaJsonFile;
    job.artifacts.designIrFile = designIrFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    try {
      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.jobsRoot, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      const figmaFile = await runStage({
        job,
        stage: "figma.source",
        action: async () => {
          const file = await fetchFigmaFile({
            fileKey: input.figmaFileKey,
            accessToken: input.figmaAccessToken,
            timeoutMs: runtime.figmaTimeoutMs,
            maxRetries: runtime.figmaMaxRetries,
            fetchImpl: runtime.fetchImpl,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "figma.source",
                message
              });
            }
          });
          await writeFile(figmaJsonFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");
          return file;
        }
      });

      const ir = await runStage({
        job,
        stage: "ir.derive",
        action: async () => {
          const derived = figmaToDesignIrWithOptions(figmaFile, {});
          if (!Array.isArray(derived.screens) || derived.screens.length === 0) {
            throw createPipelineError({
              code: "E_IR_EMPTY",
              stage: "ir.derive",
              message: "No screen found in IR"
            });
          }
          await writeFile(designIrFile, `${JSON.stringify(derived, null, 2)}\n`, "utf8");
          pushLog({
            job,
            level: "info",
            stage: "ir.derive",
            message: `Derived Design IR with ${derived.screens.length} screens.`
          });
          return derived;
        }
      });

      await runStage({
        job,
        stage: "template.prepare",
        action: async () => {
          const templateExists = await pathExists(TEMPLATE_ROOT);
          if (!templateExists) {
            throw createPipelineError({
              code: "E_TEMPLATE_MISSING",
              stage: "template.prepare",
              message: `Template not found at ${TEMPLATE_ROOT}`
            });
          }

          await rm(generatedProjectDir, { recursive: true, force: true });
          await cp(TEMPLATE_ROOT, generatedProjectDir, { recursive: true });
        }
      });

      const generationSummary = await runStage({
        job,
        stage: "codegen.generate",
        action: async () => {
          return await generateArtifacts({
            projectDir: generatedProjectDir,
            ir,
            llmModelName: "deterministic",
            llmCodegenMode: "deterministic",
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "codegen.generate",
                message
              });
            }
          });
        }
      });

      await runStage({
        job,
        stage: "validate.project",
        action: async () => {
          await runProjectValidation({
            generatedProjectDir,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "validate.project",
                message
              });
            }
          });
        }
      });

      if (!runtime.previewEnabled) {
        markStageSkipped({
          job,
          stage: "repro.export",
          message: "Preview disabled by runtime configuration."
        });
      } else {
        await runStage({
          job,
          stage: "repro.export",
          action: async () => {
            await rm(reproDir, { recursive: true, force: true });
            await mkdir(path.dirname(reproDir), { recursive: true });
            await copyDir({
              sourceDir: path.join(generatedProjectDir, "dist"),
              targetDir: reproDir
            });
          }
        });
      }

      if (!input.enableGitPr) {
        job.gitPr = {
          status: "skipped",
          reason: "enableGitPr=false"
        };
        markStageSkipped({
          job,
          stage: "git.pr",
          message: "Git/PR flow disabled by request."
        });
      } else {
        const gitResult = await runStage({
          job,
          stage: "git.pr",
          action: async () => {
            return await runGitPrFlow({
              input,
              job,
              generatedProjectDir,
              jobDir,
              onLog: (message) => {
                pushLog({
                  job,
                  level: "info",
                  stage: "git.pr",
                  message
                });
              }
            });
          }
        });

        job.gitPr = {
          status: "executed",
          prUrl: gitResult.prUrl,
          branchName: gitResult.branchName,
          scopePath: gitResult.scopePath,
          changedFiles: gitResult.changedFiles
        };
      }

      job.status = "completed";
      job.finishedAt = nowIso();
      job.currentStage = undefined;
      pushLog({
        job,
        level: "info",
        message: `Job completed. Generated output at ${generatedProjectDir} (${generationSummary.generatedPaths.length} artifacts).`
      });
    } catch (error) {
      const typedError =
        error instanceof Error && "stage" in error && "code" in error
          ? (error as WorkspacePipelineError)
          : createPipelineError({
              code: "E_PIPELINE_UNKNOWN",
              stage: job.currentStage ?? "figma.source",
              message: getErrorMessage(error),
              cause: error
            });

      job.status = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message
      };
      job.currentStage = typedError.stage;
      pushLog({
        job,
        level: "error",
        stage: typedError.stage,
        message: `Job failed: ${typedError.code} ${typedError.message}`
      });
    }
  };

  const submitJob = (input: WorkspaceJobInput): WorkspaceSubmitAccepted => {
    const jobId = randomUUID();
    const acceptedModes = toAcceptedModes();
    const job: JobRecord = {
      jobId,
      status: "queued",
      submittedAt: nowIso(),
      request: {
        figmaFileKey: input.figmaFileKey,
        repoUrl: input.repoUrl,
        enableGitPr: input.enableGitPr === true,
        figmaSourceMode: acceptedModes.figmaSourceMode,
        llmCodegenMode: acceptedModes.llmCodegenMode,
        projectName: input.projectName,
        targetPath: input.targetPath
      },
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: resolvedPaths.outputRoot,
        jobDir: path.join(resolvedPaths.jobsRoot, jobId)
      },
      preview: {
        enabled: runtime.previewEnabled
      }
    };

    jobs.set(jobId, job);

    pushLog({ job, level: "info", message: "Job accepted by workspace-dev runtime." });

    queueMicrotask(() => {
      void runJob(job, input);
    });

    return {
      jobId,
      status: "queued",
      acceptedModes
    };
  };

  const getJob = (jobId: string): WorkspaceJobStatus | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }
    return toPublicJob(job);
  };

  const getJobResult = (jobId: string): WorkspaceJobResult | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    return {
      jobId: job.jobId,
      status: job.status,
      summary: toJobSummary(job),
      artifacts: { ...job.artifacts },
      preview: { ...job.preview },
      gitPr: job.gitPr ? { ...job.gitPr } : undefined,
      error: job.error ? { ...job.error } : undefined
    };
  };

  const resolvePreviewAsset = async (
    jobId: string,
    previewPath: string
  ): Promise<{ content: Buffer; contentType: string } | undefined> => {
    const safeJobId = toFileSystemSafe(jobId);
    if (safeJobId !== jobId) {
      return undefined;
    }

    const normalizedPart = normalizePathPart(previewPath || "index.html");
    const fallbackPath = normalizedPart.length > 0 ? normalizedPart : "index.html";
    const candidatePath = path.normalize(path.join(resolvedPaths.reprosRoot, safeJobId, fallbackPath));
    const expectedPrefix = path.normalize(path.join(resolvedPaths.reprosRoot, safeJobId));

    if (!candidatePath.startsWith(expectedPrefix)) {
      return undefined;
    }

    try {
      const content = await readFile(candidatePath);
      return {
        content,
        contentType: getContentType(candidatePath)
      };
    } catch {
      if (fallbackPath !== "index.html") {
        const indexPath = path.join(resolvedPaths.reprosRoot, safeJobId, "index.html");
        try {
          const content = await readFile(indexPath);
          return {
            content,
            contentType: "text/html; charset=utf-8"
          };
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  };

  return {
    submitJob,
    getJob,
    getJobResult,
    resolvePreviewAsset
  };
};

export const resolveRuntimeSettings = ({
  figmaRequestTimeoutMs,
  figmaMaxRetries,
  enablePreview,
  fetchImpl
}: {
  figmaRequestTimeoutMs?: number;
  figmaMaxRetries?: number;
  enablePreview?: boolean;
  fetchImpl?: typeof fetch;
}): JobEngineRuntime => {
  return {
    figmaTimeoutMs:
      typeof figmaRequestTimeoutMs === "number" && Number.isFinite(figmaRequestTimeoutMs)
        ? Math.max(1_000, Math.trunc(figmaRequestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
    figmaMaxRetries:
      typeof figmaMaxRetries === "number" && Number.isFinite(figmaMaxRetries)
        ? Math.max(1, Math.min(10, Math.trunc(figmaMaxRetries)))
        : DEFAULT_MAX_RETRIES,
    previewEnabled: enablePreview !== false,
    fetchImpl: fetchImpl ?? fetch
  };
};
