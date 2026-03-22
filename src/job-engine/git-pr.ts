import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceGenerationDiffReport, WorkspaceJobInput } from "../contracts/index.js";
import { resolveBoardKey } from "../parity/board-key.js";
import { redactValue, runCommand as runCommandImpl } from "./command-runner.js";
import { formatDiffForPrDescription } from "./generation-diff.js";
import { sanitizeTargetPath, toScopePath } from "./target-path.js";
import type { CommandResult, GitPrExecutionResult, JobRecord } from "./types.js";

interface GitPrDeps {
  runCommand: (input: {
    cwd: string;
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
    redactions?: string[];
    timeoutMs?: number;
  }) => Promise<CommandResult>;
  fetchImpl: typeof fetch;
}

const resolveGitProvider = (repoUrl: string): "github" | "unsupported" => {
  if (/github\.com/i.test(repoUrl)) {
    return "github";
  }
  return "unsupported";
};

const parseGithubRepo = (repoUrl: string): { owner: string; name: string } | undefined => {
  const httpsMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/i);
  if (httpsMatch) {
    const [, owner, name] = httpsMatch;
    if (!owner || !name) {
      return undefined;
    }
    return {
      owner,
      name
    };
  }

  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    const [, owner, name] = sshMatch;
    if (!owner || !name) {
      return undefined;
    }
    return {
      owner,
      name
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

export const runGitPrFlowWithDeps = async ({
  input,
  job,
  generatedProjectDir,
  jobDir,
  onLog,
  commandTimeoutMs = 15 * 60_000,
  generationDiff,
  deps
}: {
  input: WorkspaceJobInput;
  job: JobRecord;
  generatedProjectDir: string;
  jobDir: string;
  onLog: (message: string) => void;
  commandTimeoutMs?: number;
  generationDiff?: WorkspaceGenerationDiffReport;
  deps?: Partial<GitPrDeps>;
}): Promise<GitPrExecutionResult> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const fetchImpl = deps?.fetchImpl ?? fetch;

  const repoUrl = input.repoUrl?.trim();
  const repoToken = input.repoToken?.trim();

  if (!repoUrl || !repoToken) {
    throw new Error("repoUrl and repoToken are required when enableGitPr=true");
  }

  const provider = resolveGitProvider(repoUrl);
  if (provider !== "github") {
    throw new Error("Only GitHub repositories are supported in workspace-dev git.pr mode.");
  }

  const boardKeySeed = input.figmaFileKey?.trim() || input.figmaJsonPath?.trim() || "local-json";
  const boardKey = resolveBoardKey(boardKeySeed);
  const repoDir = path.join(jobDir, "repo");
  const redactions = [repoToken];
  const authedUrl = toGithubAuthedUrl({ repoUrl, token: repoToken });

  const defaultBranchProbe = await runCommand({
    cwd: jobDir,
    command: "git",
    args: ["ls-remote", "--symref", authedUrl, "HEAD"],
    redactions,
    timeoutMs: commandTimeoutMs
  });

  const defaultBranch = parseDefaultBranchFromSymref(defaultBranchProbe.stdout) ?? "main";

  const cloneResult = await runCommand({
    cwd: jobDir,
    command: "git",
    args: ["clone", "--depth", "1", "--branch", defaultBranch, authedUrl, repoDir],
    redactions,
    timeoutMs: commandTimeoutMs
  });

  if (!cloneResult.success) {
    throw new Error(`git clone failed: ${cloneResult.combined.slice(0, 2000)}`);
  }

  const branchName = `auto/figma/${boardKey}-${job.jobId.slice(0, 8)}`;
  const checkoutResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["checkout", "-b", branchName],
    timeoutMs: commandTimeoutMs
  });
  if (!checkoutResult.success) {
    throw new Error(`git checkout failed: ${checkoutResult.combined.slice(0, 2000)}`);
  }

  const targetPath = sanitizeTargetPath(input.targetPath);
  const scopePath = toScopePath({ targetPath, boardKey });
  const destinationDir = path.join(repoDir, scopePath);

  await copyGeneratedProjectIntoRepo({
    generatedProjectDir,
    destinationDir
  });

  const addResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["add", "-A", scopePath],
    timeoutMs: commandTimeoutMs
  });
  if (!addResult.success) {
    throw new Error(`git add failed: ${addResult.combined.slice(0, 2000)}`);
  }

  const changedFilesResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["diff", "--cached", "--name-only"],
    timeoutMs: commandTimeoutMs
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
    args: ["config", "user.name", "workspace-dev bot"],
    timeoutMs: commandTimeoutMs
  });
  await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["config", "user.email", "workspace-dev@workspace-dev.local"],
    timeoutMs: commandTimeoutMs
  });

  const commitResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["commit", "-m", `chore(figma): deterministic update ${boardKey}`],
    timeoutMs: commandTimeoutMs
  });
  if (!commitResult.success) {
    throw new Error(`git commit failed: ${commitResult.combined.slice(0, 2000)}`);
  }

  const pushResult = await runCommand({
    cwd: repoDir,
    command: "git",
    args: ["push", "-u", "origin", branchName],
    redactions,
    timeoutMs: commandTimeoutMs
  });
  if (!pushResult.success) {
    throw new Error(`git push failed: ${pushResult.combined.slice(0, 2000)}`);
  }

  const githubRepo = parseGithubRepo(repoUrl);
  if (!githubRepo) {
    throw new Error("Could not parse GitHub repository owner/name.");
  }

  const prResponse = await fetchImpl(`https://api.github.com/repos/${githubRepo.owner}/${githubRepo.name}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${repoToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: `chore(figma): deterministic update ${boardKey}`,
      body: generationDiff
        ? `Generated by workspace-dev job ${job.jobId}.\n\n${formatDiffForPrDescription(generationDiff)}`
        : `Generated by workspace-dev job ${job.jobId}.`,
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

  const result: GitPrExecutionResult = {
    status: "executed",
    branchName,
    scopePath,
    changedFiles
  };
  if (prUrl) {
    result.prUrl = prUrl;
  }
  return result;
};

export const runGitPrFlow = async ({
  input,
  job,
  generatedProjectDir,
  jobDir,
  onLog,
  commandTimeoutMs = 15 * 60_000,
  generationDiff
}: {
  input: WorkspaceJobInput;
  job: JobRecord;
  generatedProjectDir: string;
  jobDir: string;
  onLog: (message: string) => void;
  commandTimeoutMs?: number;
  generationDiff?: WorkspaceGenerationDiffReport;
}): Promise<GitPrExecutionResult> => {
  return await runGitPrFlowWithDeps({
    input,
    job,
    generatedProjectDir,
    jobDir,
    onLog,
    commandTimeoutMs,
    ...(generationDiff ? { generationDiff } : {})
  });
};
