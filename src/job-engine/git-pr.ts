import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceGenerationDiffReport, WorkspaceJobInput } from "../contracts/index.js";
import { resolveBoardKey } from "../parity/board-key.js";
import { redactValue, runCommand as runCommandImpl } from "./command-runner.js";
import { formatDiffForPrDescription } from "./generation-diff.js";
import { sanitizeTargetPath, toScopePath } from "./target-path.js";
import type { CommandExecutionInput, CommandResult, GitPrExecutionResult } from "./types.js";

interface GitPrDeps {
  runCommand: (input: CommandExecutionInput) => Promise<CommandResult>;
  fetchImpl: typeof fetch;
}

interface GithubRepoCoordinates {
  owner: string;
  name: string;
}

interface GitAskPassHelper {
  helperPath: string;
  scriptPath: string;
  env: NodeJS.ProcessEnv;
}

const WORKSPACE_DEV_GIT_USERNAME = "x-access-token";
const WORKSPACE_DEV_GIT_TOKEN_ENV = "WORKSPACE_DEV_GIT_TOKEN";
const WORKSPACE_DEV_GIT_USERNAME_ENV = "WORKSPACE_DEV_GIT_USERNAME";
const WORKSPACE_DEV_GIT_ASKPASS_SCRIPT_ENV = "WORKSPACE_DEV_GIT_ASKPASS_SCRIPT";
const WORKSPACE_DEV_NODE_BINARY_ENV = "WORKSPACE_DEV_NODE_BINARY";

const resolveGitProvider = (repoUrl: string): "github" | "unsupported" => {
  if (/github\.com/i.test(repoUrl)) {
    return "github";
  }
  return "unsupported";
};

const parseGithubRepo = (repoUrl: string): GithubRepoCoordinates | undefined => {
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

const toGithubHttpsUrl = ({ githubRepo }: { githubRepo: GithubRepoCoordinates }): string => {
  return `https://github.com/${githubRepo.owner}/${githubRepo.name}.git`;
};

const parseDefaultBranchFromSymref = (raw: string): string | undefined => {
  const match = raw.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
  return match?.[1];
};

const toGitCommandOutputCapture = ({
  jobDir,
  key,
  commandStdoutMaxBytes,
  commandStderrMaxBytes
}: {
  jobDir: string;
  key: string;
  commandStdoutMaxBytes: number;
  commandStderrMaxBytes: number;
}): NonNullable<CommandExecutionInput["outputCapture"]> => {
  return {
    jobDir,
    key,
    stdoutMaxBytes: commandStdoutMaxBytes,
    stderrMaxBytes: commandStderrMaxBytes
  };
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

const toGitRedactions = ({ repoToken }: { repoToken: string }): string[] => {
  return Array.from(new Set([repoToken, encodeURIComponent(repoToken)].filter((entry) => entry.trim().length > 0)));
};

const redactGitPrValue = ({
  value,
  redactions
}: {
  value: string;
  redactions: string[];
}): string => {
  return redactions.reduce((accumulator, secret) => redactValue({ value: accumulator, secret }), value);
};

const createGitAskPassHelper = async ({
  jobDir,
  repoToken
}: {
  jobDir: string;
  repoToken: string;
}): Promise<GitAskPassHelper> => {
  await mkdir(jobDir, { recursive: true });
  const helperBasePath = path.join(jobDir, "git-askpass");
  const scriptPath = `${helperBasePath}.cjs`;
  const helperPath = `${helperBasePath}${process.platform === "win32" ? ".cmd" : ".sh"}`;

  await writeFile(
    scriptPath,
    `const prompt = process.argv.slice(2).join(" ").toLowerCase();
const username = process.env.${WORKSPACE_DEV_GIT_USERNAME_ENV};
const token = process.env.${WORKSPACE_DEV_GIT_TOKEN_ENV};
if (!username || !token) {
  process.exit(1);
}
process.stdout.write(prompt.includes("username") ? username : token);
`,
    "utf8"
  );

  const helperBody =
    process.platform === "win32"
      ? `@echo off\r\n"%${WORKSPACE_DEV_NODE_BINARY_ENV}%" "%${WORKSPACE_DEV_GIT_ASKPASS_SCRIPT_ENV}%" %*\r\n`
      : `#!/bin/sh\nexec "$${WORKSPACE_DEV_NODE_BINARY_ENV}" "$${WORKSPACE_DEV_GIT_ASKPASS_SCRIPT_ENV}" "$@"\n`;

  await writeFile(helperPath, helperBody, "utf8");
  if (process.platform !== "win32") {
    await chmod(helperPath, 0o700);
  }

  return {
    helperPath,
    scriptPath,
    env: {
      GIT_ASKPASS: helperPath,
      GIT_TERMINAL_PROMPT: "0",
      [WORKSPACE_DEV_NODE_BINARY_ENV]: process.execPath,
      [WORKSPACE_DEV_GIT_ASKPASS_SCRIPT_ENV]: scriptPath,
      [WORKSPACE_DEV_GIT_USERNAME_ENV]: WORKSPACE_DEV_GIT_USERNAME,
      [WORKSPACE_DEV_GIT_TOKEN_ENV]: repoToken
    }
  };
};

export const runGitPrFlowWithDeps = async ({
  input,
  jobId,
  generatedProjectDir,
  jobDir,
  onLog,
  commandTimeoutMs = 15 * 60_000,
  commandStdoutMaxBytes = 1_048_576,
  commandStderrMaxBytes = 1_048_576,
  generationDiff,
  deps
}: {
  input: WorkspaceJobInput;
  jobId: string;
  generatedProjectDir: string;
  jobDir: string;
  onLog: (message: string) => void;
  commandTimeoutMs?: number;
  commandStdoutMaxBytes?: number;
  commandStderrMaxBytes?: number;
  generationDiff?: WorkspaceGenerationDiffReport;
  deps?: Partial<GitPrDeps>;
}): Promise<GitPrExecutionResult> => {
  const runCommand = deps?.runCommand ?? runCommandImpl;
  const fetchImpl = deps?.fetchImpl ?? fetch;

  const repoUrl = input.repoUrl?.trim();
  const repoToken = input.repoToken?.trim();
  const resolvedCommandTimeoutMs = Math.max(1_000, Math.trunc(commandTimeoutMs));

  if (!repoUrl || !repoToken) {
    throw new Error("repoUrl and repoToken are required when enableGitPr=true");
  }

  const provider = resolveGitProvider(repoUrl);
  if (provider !== "github") {
    throw new Error("Only GitHub repositories are supported in workspace-dev git.pr mode.");
  }

  const githubRepo = parseGithubRepo(repoUrl);
  if (!githubRepo) {
    throw new Error("Invalid GitHub repository URL.");
  }

  const boardKeySeed = input.figmaFileKey?.trim() || input.figmaJsonPath?.trim() || "local-json";
  const boardKey = resolveBoardKey(boardKeySeed);
  const repoDir = path.join(jobDir, "repo");
  const gitRemoteUrl = toGithubHttpsUrl({ githubRepo });
  const redactions = toGitRedactions({ repoToken });
  const gitAskPassHelper = await createGitAskPassHelper({
    jobDir,
    repoToken
  });

  try {
    const defaultBranchProbe = await runCommand({
      cwd: jobDir,
      command: "git",
      args: ["ls-remote", "--symref", gitRemoteUrl, "HEAD"],
      env: gitAskPassHelper.env,
      redactions,
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.ls-remote",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
    });

    const defaultBranch = parseDefaultBranchFromSymref(defaultBranchProbe.stdout) ?? "main";

    const cloneResult = await runCommand({
      cwd: jobDir,
      command: "git",
      args: ["clone", "--depth", "1", "--branch", defaultBranch, gitRemoteUrl, repoDir],
      env: gitAskPassHelper.env,
      redactions,
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.clone",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
    });

    if (!cloneResult.success) {
      throw new Error(`git clone failed: ${cloneResult.combined.slice(0, 2000)}`);
    }

    const branchName = `auto/figma/${boardKey}-${jobId.slice(0, 8)}`;
    const checkoutResult = await runCommand({
      cwd: repoDir,
      command: "git",
      args: ["checkout", "-b", branchName],
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.checkout",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
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
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.add",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
    });
    if (!addResult.success) {
      throw new Error(`git add failed: ${addResult.combined.slice(0, 2000)}`);
    }

    const changedFilesResult = await runCommand({
      cwd: repoDir,
      command: "git",
      args: ["diff", "--cached", "--name-only"],
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.diff",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
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
      timeoutMs: resolvedCommandTimeoutMs
    });
    await runCommand({
      cwd: repoDir,
      command: "git",
      args: ["config", "user.email", "workspace-dev@workspace-dev.local"],
      timeoutMs: resolvedCommandTimeoutMs
    });

    const commitResult = await runCommand({
      cwd: repoDir,
      command: "git",
      args: ["commit", "-m", `chore(figma): deterministic update ${boardKey}`],
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.commit",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
    });
    if (!commitResult.success) {
      throw new Error(`git commit failed: ${commitResult.combined.slice(0, 2000)}`);
    }

    const pushResult = await runCommand({
      cwd: repoDir,
      command: "git",
      args: ["push", "-u", "origin", branchName],
      env: gitAskPassHelper.env,
      redactions,
      timeoutMs: resolvedCommandTimeoutMs,
      ...{
        outputCapture: toGitCommandOutputCapture({
          jobDir,
          key: "git.pr.push",
          commandStdoutMaxBytes,
          commandStderrMaxBytes
        })
      }
    });
    if (!pushResult.success) {
      throw new Error(`git push failed: ${pushResult.combined.slice(0, 2000)}`);
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
          ? `Generated by workspace-dev job ${jobId}.\n\n${formatDiffForPrDescription(generationDiff)}`
          : `Generated by workspace-dev job ${jobId}.`,
        head: branchName,
        base: defaultBranch
      }),
      signal: AbortSignal.timeout(resolvedCommandTimeoutMs)
    });

    let prUrl: string | undefined;
    if (prResponse.ok) {
      try {
        const payload = (await prResponse.json()) as { html_url?: string };
        prUrl = payload.html_url;
      } catch {
        onLog(`PR created (${prResponse.status}) but response body could not be parsed; prUrl unavailable.`);
      }
    } else {
      const failureText = (await prResponse.text()).slice(0, 500);
      onLog(`PR creation failed (${prResponse.status}): ${redactGitPrValue({ value: failureText, redactions })}`);
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
  } finally {
    await Promise.allSettled([
      rm(repoDir, { recursive: true, force: true }),
      rm(gitAskPassHelper.helperPath, { force: true }),
      rm(gitAskPassHelper.scriptPath, { force: true })
    ]);
  }
};

export const runGitPrFlow = async ({
  input,
  jobId,
  generatedProjectDir,
  jobDir,
  onLog,
  commandTimeoutMs = 15 * 60_000,
  commandStdoutMaxBytes = 1_048_576,
  commandStderrMaxBytes = 1_048_576,
  generationDiff
}: {
  input: WorkspaceJobInput;
  jobId: string;
  generatedProjectDir: string;
  jobDir: string;
  onLog: (message: string) => void;
  commandTimeoutMs?: number;
  commandStdoutMaxBytes?: number;
  commandStderrMaxBytes?: number;
  generationDiff?: WorkspaceGenerationDiffReport;
}): Promise<GitPrExecutionResult> => {
  return await runGitPrFlowWithDeps({
    input,
    jobId,
    generatedProjectDir,
    jobDir,
    onLog,
    commandTimeoutMs,
    commandStdoutMaxBytes,
    commandStderrMaxBytes,
    ...(generationDiff ? { generationDiff } : {})
  });
};
