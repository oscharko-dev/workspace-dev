import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executePersistedGitPr } from "./git-pr-persistence.js";
import { runGitPrFlowWithDeps } from "./git-pr.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import { StageArtifactStore } from "./pipeline/artifact-store.js";
import type { JobRecord } from "./types.js";

interface CommandInvocation {
  step: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

const createJobRecord = (jobId = "11111111-2222-3333-4444-555555555555"): JobRecord => ({
  jobId,
  status: "running",
  submittedAt: new Date().toISOString(),
  request: {
    figmaFileKey: "demo-file",
    enableGitPr: true,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    brandTheme: "derived",
    generationLocale: "de-DE",
    formHandlingMode: "react_hook_form"
  },
  stages: [],
  logs: [],
  artifacts: {
    outputRoot: "/tmp",
    jobDir: "/tmp/job"
  },
  preview: { enabled: true },
  queue: {
    runningCount: 1,
    queuedCount: 0,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 20
  }
});

const assertPathMissing = async (targetPath: string): Promise<void> => {
  await assert.rejects(() => access(targetPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
};

test("executePersistedGitPr loads persisted inputs and stores gitPrStatus", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-persisted-"));
  const jobDir = path.join(tempRoot, "job");
  const generatedProjectDir = path.join(jobDir, "generated");
  const artifactStore = new StageArtifactStore({ jobDir });

  await mkdir(generatedProjectDir, { recursive: true });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: generatedProjectDir
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiff,
    stage: "validate.project",
    value: {
      boardKey: "demo-file",
      currentJobId: "job-1",
      previousJobId: null,
      generatedAt: new Date().toISOString(),
      added: ["README.md"],
      modified: [],
      removed: [],
      unchanged: [],
      summary: "1 added"
    }
  });

  let forwardedCommandStdoutMaxBytes: number | undefined;
  let forwardedCommandStderrMaxBytes: number | undefined;
  const gitPrStatus = await executePersistedGitPr({
    artifactStore,
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "token"
    },
    jobId: "job-1",
    jobDir,
    commandTimeoutMs: 1_000,
    commandStdoutMaxBytes: 8_192,
    commandStderrMaxBytes: 16_384,
    onLog: () => {
      // no-op
    },
    deps: {
      runGitPrFlowFn: async (input) => {
        forwardedCommandStdoutMaxBytes = input.commandStdoutMaxBytes;
        forwardedCommandStderrMaxBytes = input.commandStderrMaxBytes;
        return {
          status: "executed",
          prUrl: "https://example.invalid/pr/1",
          branchName: "feature/test",
          scopePath: "generated/demo-file",
          changedFiles: ["generated/demo-file/README.md"]
        };
      }
    }
  });

  assert.deepEqual(gitPrStatus, {
    status: "executed",
    prUrl: "https://example.invalid/pr/1",
    branchName: "feature/test",
    scopePath: "generated/demo-file",
    changedFiles: ["generated/demo-file/README.md"]
  });

  const reloadedStore = new StageArtifactStore({ jobDir });
  const storedStatus = await reloadedStore.getValue(STAGE_ARTIFACT_KEYS.gitPrStatus);
  assert.deepEqual(storedStatus, gitPrStatus);
  assert.equal(forwardedCommandStdoutMaxBytes, 8_192);
  assert.equal(forwardedCommandStderrMaxBytes, 16_384);
});

test("runGitPrFlowWithDeps validates repo configuration early", async () => {
  const job = createJobRecord();
  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: { figmaFileKey: "demo", figmaAccessToken: "pat", enableGitPr: true },
        jobId: job.jobId,
        generatedProjectDir: "/tmp",
        jobDir: "/tmp",
        onLog: () => {
          // no-op
        }
      }),
    /repoUrl and repoToken are required/
  );

  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://gitlab.com/acme/repo",
          repoToken: "token"
        },
        jobId: job.jobId,
        generatedProjectDir: "/tmp",
        jobDir: "/tmp",
        onLog: () => {
          // no-op
        }
      }),
    /Only GitHub repositories are supported/
  );
});

test("runGitPrFlowWithDeps returns executed without commit when no changes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-nochange-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const capturedCommands: CommandInvocation[] = [];
  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const logs: string[] = [];
  const repoToken = "secret";
  const encodedRepoToken = encodeURIComponent(repoToken);

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken
    },
    jobId: createJobRecord().jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ args, env }) => {
        capturedCommands.push({
          step: args[0] ?? "unknown",
          args,
          ...(env ? { env } : {})
        });
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "ls-remote") {
          return {
            success: true,
            code: 0,
            stdout: "ref: refs/heads/main HEAD\n",
            stderr: "",
            combined: ""
          };
        }
        if (args[0] === "diff") {
          return { success: true, code: 0, stdout: "\n", stderr: "", combined: "" };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async () => new Response(JSON.stringify({ html_url: "https://example.invalid/pr/1" }), { status: 201 })
    }
  });

  assert.equal(result.status, "executed");
  assert.deepEqual(result.changedFiles, []);
  assert.ok(logs.some((entry) => entry.includes("No repository delta detected")));

  const authenticatedCommands = capturedCommands.filter((command) => command.step === "ls-remote" || command.step === "clone");
  assert.equal(authenticatedCommands.length, 2);
  for (const command of authenticatedCommands) {
    assert.equal(command.args.some((entry) => entry.includes(repoToken)), false);
    assert.equal(command.args.some((entry) => entry.includes(encodedRepoToken)), false);
    assert.equal(command.args.includes("https://github.com/acme/repo.git"), true);
    assert.equal(typeof command.env?.GIT_ASKPASS, "string");
    assert.equal(command.env?.WORKSPACE_DEV_GIT_USERNAME, "x-access-token");
    assert.equal(command.env?.WORKSPACE_DEV_GIT_TOKEN, repoToken);
  }

  const askPassPath = authenticatedCommands[0]?.env?.GIT_ASKPASS;
  const askPassScriptPath = authenticatedCommands[0]?.env?.WORKSPACE_DEV_GIT_ASKPASS_SCRIPT;
  assert.equal(typeof askPassPath, "string");
  assert.equal(typeof askPassScriptPath, "string");
  await assertPathMissing(repoDir);
  await assertPathMissing(String(askPassPath));
  await assertPathMissing(String(askPassScriptPath));
});

test("runGitPrFlowWithDeps executes full PR flow and redacts failed PR response", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-success-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const capturedCommands: CommandInvocation[] = [];
  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const logs: string[] = [];
  const repoToken = "tok/en?=%25";
  const encodedRepoToken = encodeURIComponent(repoToken);

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken,
      targetPath: "generated"
    },
    jobId: createJobRecord("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ args, env }) => {
        capturedCommands.push({
          step: args[0] ?? "unknown",
          args,
          ...(env ? { env } : {})
        });
        if (args[0] === "ls-remote") {
          return {
            success: true,
            code: 0,
            stdout: "ref: refs/heads/main HEAD\n",
            stderr: "",
            combined: ""
          };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return {
            success: true,
            code: 0,
            stdout: "generated/demo-file-1668f4f0ae/README.md\n",
            stderr: "",
            combined: ""
          };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async () => new Response(`${repoToken} and ${encodedRepoToken} should both be redacted`, { status: 500 })
    }
  });

  assert.equal(result.status, "executed");
  assert.ok(result.branchName.includes("auto/figma/demo-file"));
  assert.equal(result.prUrl, undefined);
  assert.equal(result.changedFiles.length, 1);
  assert.ok(logs.some((entry) => entry.includes("[REDACTED]")));
  assert.equal(logs.some((entry) => entry.includes(repoToken)), false);
  assert.equal(logs.some((entry) => entry.includes(encodedRepoToken)), false);

  const authenticatedCommands = capturedCommands.filter(
    (command) => command.step === "ls-remote" || command.step === "clone" || command.step === "push"
  );
  for (const command of authenticatedCommands) {
    assert.equal(command.args.some((entry) => entry.includes(repoToken)), false);
    assert.equal(command.args.some((entry) => entry.includes(encodedRepoToken)), false);
  }

  await assertPathMissing(repoDir);
});

test("runGitPrFlowWithDeps forwards deterministic output capture keys to git commands", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-output-capture-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const captures: Array<{ step: string; key?: string; stdoutMaxBytes?: number; stderrMaxBytes?: number; cwd: string }> = [];

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "secret"
    },
    jobId: createJobRecord("cccccccc-dddd-eeee-ffff-000000000000").jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: () => {
      // no-op
    },
    commandStdoutMaxBytes: 4_096,
    commandStderrMaxBytes: 2_048,
    deps: {
      runCommand: async ({ cwd, args, outputCapture }) => {
        captures.push({
          step: args[0] ?? "unknown",
          ...(outputCapture
            ? {
                key: outputCapture.key,
                stdoutMaxBytes: outputCapture.stdoutMaxBytes,
                stderrMaxBytes: outputCapture.stderrMaxBytes
              }
            : {}),
          cwd
        });
        if (args[0] === "ls-remote") {
          return {
            success: true,
            code: 0,
            stdout: "ref: refs/heads/main HEAD\n",
            stderr: "",
            combined: ""
          };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return {
            success: true,
            code: 0,
            stdout: "demo-file-1668f4f0ae/README.md\n",
            stderr: "",
            combined: ""
          };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async () => new Response(JSON.stringify({ html_url: "https://github.com/acme/repo/pull/1" }), { status: 201 })
    }
  });

  assert.equal(result.prUrl, "https://github.com/acme/repo/pull/1");
  assert.deepEqual(
    captures
      .filter((entry) => entry.key)
      .map((entry) => ({
        step: entry.step,
        key: entry.key,
        stdoutMaxBytes: entry.stdoutMaxBytes,
        stderrMaxBytes: entry.stderrMaxBytes
      })),
    [
      { step: "ls-remote", key: "git.pr.ls-remote", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "clone", key: "git.pr.clone", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "checkout", key: "git.pr.checkout", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "add", key: "git.pr.add", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "diff", key: "git.pr.diff", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "commit", key: "git.pr.commit", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 },
      { step: "push", key: "git.pr.push", stdoutMaxBytes: 4_096, stderrMaxBytes: 2_048 }
    ]
  );
  await assertPathMissing(repoDir);
});

test("runGitPrFlowWithDeps rejects unsafe targetPath", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-invalid-path-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  await mkdir(generatedProjectDir, { recursive: true });

  for (const targetPath of ["../outside", "generated\0path"]) {
    await assert.rejects(
      () =>
        runGitPrFlowWithDeps({
          input: {
            figmaFileKey: "demo-file",
            figmaAccessToken: "pat",
            enableGitPr: true,
            repoUrl: "https://github.com/acme/repo.git",
            repoToken: "secret",
            targetPath
          },
          jobId: createJobRecord().jobId,
          generatedProjectDir,
          jobDir: path.join(tempRoot, "job"),
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async ({ args }) => {
              if (args[0] === "ls-remote") {
                return {
                  success: true,
                  code: 0,
                  stdout: "ref: refs/heads/main HEAD\n",
                  stderr: "",
                  combined: ""
                };
              }
              if (args[0] === "clone") {
                await mkdir(path.join(tempRoot, "job", "repo"), { recursive: true });
                return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
              }
              return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
            },
            fetchImpl: async () => new Response("", { status: 201 })
          }
        }),
      /Invalid targetPath/
    );
  }
});

test("runGitPrFlowWithDeps supports ssh GitHub URLs, main fallback, and successful PR creation responses", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-ssh-success-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const capturedCommands: CommandInvocation[] = [];
  let requestBody = "";
  let requestUrl = "";
  let requestSignal: AbortSignal | undefined;

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaJsonPath: path.join(tempRoot, "local-board.json"),
      figmaSourceMode: "local_json",
      enableGitPr: true,
      repoUrl: "git@github.com:acme/repo.git",
      repoToken: "ssh-secret"
    },
    jobId: createJobRecord("bbbbbbbb-cccc-dddd-eeee-ffffffffffff").jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: () => {
      // no-op
    },
    generationDiff: {
      boardKey: "demo-board-1234567890",
      currentJobId: "job-current",
      previousJobId: "job-previous",
      generatedAt: new Date().toISOString(),
      added: ["src/App.tsx"],
      modified: [{ file: "src/theme.ts", previousHash: "aaa", currentHash: "bbb" }],
      removed: [],
      unchanged: [],
      summary: "1 file added, 1 file modified"
    },
    deps: {
      runCommand: async ({ args, env }) => {
        capturedCommands.push({
          step: args[0] ?? "unknown",
          args,
          ...(env ? { env } : {})
        });
        if (args[0] === "ls-remote") {
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return {
            success: true,
            code: 0,
            stdout: "local-board-968179d61f/README.md\n",
            stderr: "",
            combined: ""
          };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async (input, init) => {
        requestUrl = typeof input === "string" ? input : input.toString();
        requestBody = String(init?.body ?? "");
        requestSignal = init?.signal;
        return new Response(JSON.stringify({ html_url: "https://github.com/acme/repo/pull/123" }), { status: 201 });
      }
    }
  });

  assert.equal(result.prUrl, "https://github.com/acme/repo/pull/123");
  assert.equal(result.changedFiles.length, 1);
  assert.equal(requestUrl, "https://api.github.com/repos/acme/repo/pulls");
  assert.equal(requestBody.includes("### Generation Diff Report"), true);
  assert.equal(requestBody.includes('"base":"main"'), true);
  assert.equal(requestSignal instanceof AbortSignal, true);

  const lsRemoteCommand = capturedCommands.find((command) => command.step === "ls-remote");
  const cloneCommand = capturedCommands.find((command) => command.step === "clone");
  assert.equal(lsRemoteCommand?.args.includes("https://github.com/acme/repo.git"), true);
  assert.equal(cloneCommand?.args.includes("https://github.com/acme/repo.git"), true);
  await assertPathMissing(repoDir);
});

test("runGitPrFlowWithDeps applies fetch timeout signals and cleans temporary auth artifacts on timeout", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-fetch-timeout-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  let askPassPath: string | undefined;
  let askPassScriptPath: string | undefined;

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo-file",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://github.com/acme/repo.git",
          repoToken: "timeout-secret"
        },
        jobId: createJobRecord("dddddddd-eeee-ffff-0000-111111111111").jobId,
        generatedProjectDir,
        jobDir: path.join(tempRoot, "job"),
        onLog: () => {
          // no-op
        },
        commandTimeoutMs: 1_000,
        deps: {
          runCommand: async ({ args, env }) => {
            if (env?.GIT_ASKPASS) {
              askPassPath = env.GIT_ASKPASS;
              askPassScriptPath = env.WORKSPACE_DEV_GIT_ASKPASS_SCRIPT;
            }
            if (args[0] === "ls-remote") {
              return {
                success: true,
                code: 0,
                stdout: "ref: refs/heads/main HEAD\n",
                stderr: "",
                combined: ""
              };
            }
            if (args[0] === "clone") {
              await mkdir(repoDir, { recursive: true });
              return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
            }
            if (args[0] === "diff") {
              return {
                success: true,
                code: 0,
                stdout: "demo-file-1668f4f0ae/README.md\n",
                stderr: "",
                combined: ""
              };
            }
            return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
          },
          fetchImpl: async (_input, init) =>
            await new Promise<Response>((_resolve, reject) => {
              assert.equal(init?.signal instanceof AbortSignal, true);
              const keepAliveHandle = setTimeout(() => {
                reject(new Error("Expected fetch timeout signal to abort"));
              }, 1_500);
              init?.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(keepAliveHandle);
                  reject(new DOMException("timed out", "AbortError"));
                },
                { once: true }
              );
            })
        }
      }),
    /timed out|AbortError/
  );

  assert.equal(typeof askPassPath, "string");
  assert.equal(typeof askPassScriptPath, "string");
  await assertPathMissing(repoDir);
  await assertPathMissing(String(askPassPath));
  await assertPathMissing(String(askPassScriptPath));
});

test("runGitPrFlowWithDeps cleans temporary repo and askpass files after git failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-cleanup-failure-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  let askPassPath: string | undefined;
  let askPassScriptPath: string | undefined;

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo-file",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://github.com/acme/repo.git",
          repoToken: "push-secret"
        },
        jobId: createJobRecord("eeeeeeee-ffff-0000-1111-222222222222").jobId,
        generatedProjectDir,
        jobDir: path.join(tempRoot, "job"),
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args, env }) => {
            if (env?.GIT_ASKPASS) {
              askPassPath = env.GIT_ASKPASS;
              askPassScriptPath = env.WORKSPACE_DEV_GIT_ASKPASS_SCRIPT;
            }
            if (args[0] === "ls-remote") {
              return {
                success: true,
                code: 0,
                stdout: "ref: refs/heads/main HEAD\n",
                stderr: "",
                combined: ""
              };
            }
            if (args[0] === "clone") {
              await mkdir(repoDir, { recursive: true });
              return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
            }
            if (args[0] === "diff") {
              return {
                success: true,
                code: 0,
                stdout: "demo-file-1668f4f0ae/README.md\n",
                stderr: "",
                combined: ""
              };
            }
            if (args[0] === "push") {
              return { success: false, code: 1, stdout: "", stderr: "push failed", combined: "push failed" };
            }
            return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
          },
          fetchImpl: async () => new Response("", { status: 201 })
        }
      }),
    /git push failed/
  );

  assert.equal(typeof askPassPath, "string");
  assert.equal(typeof askPassScriptPath, "string");
  await assertPathMissing(repoDir);
  await assertPathMissing(String(askPassPath));
  await assertPathMissing(String(askPassScriptPath));
});

test("runGitPrFlowWithDeps rejects malformed GitHub repository URLs before running git commands", async () => {
  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo-file",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://github.com/acme",
          repoToken: "secret"
        },
        jobId: createJobRecord().jobId,
        generatedProjectDir: "/tmp/generated",
        jobDir: "/tmp/job",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async () => {
            throw new Error("runCommand should not be called for malformed GitHub URLs");
          },
          fetchImpl: async () => new Response("", { status: 201 })
        }
      }),
    /Invalid GitHub repository URL/
  );
});

test("runGitPrFlowWithDeps surfaces deterministic git step failures", async (t) => {
  const scenarios = [
    { step: "clone", expected: /git clone failed/ },
    { step: "checkout", expected: /git checkout failed/ },
    { step: "add", expected: /git add failed/ },
    { step: "diff", expected: /git diff failed/ },
    { step: "commit", expected: /git commit failed/ },
    { step: "push", expected: /git push failed/ }
  ] as const;

  for (const scenario of scenarios) {
    await t.test(scenario.step, async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-gitpr-${scenario.step}-`));
      const generatedProjectDir = path.join(tempRoot, "generated");
      const repoDir = path.join(tempRoot, "job", "repo");
      await mkdir(generatedProjectDir, { recursive: true });
      await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

      await assert.rejects(
        () =>
          runGitPrFlowWithDeps({
            input: {
              figmaFileKey: "demo-file",
              figmaAccessToken: "pat",
              enableGitPr: true,
              repoUrl: "https://github.com/acme/repo.git",
              repoToken: "secret"
            },
            jobId: createJobRecord().jobId,
            generatedProjectDir,
            jobDir: path.join(tempRoot, "job"),
            onLog: () => {
              // no-op
            },
            deps: {
              runCommand: async ({ args }) => {
                if (args[0] === "ls-remote") {
                  return {
                    success: true,
                    code: 0,
                    stdout: "ref: refs/heads/main HEAD\n",
                    stderr: "",
                    combined: ""
                  };
                }
                if (args[0] === "clone") {
                  if (scenario.step === "clone") {
                    return { success: false, code: 1, stdout: "", stderr: "clone failed", combined: "clone failed" };
                  }
                  await mkdir(repoDir, { recursive: true });
                  return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
                }
                if (args[0] === "checkout" && scenario.step === "checkout") {
                  return { success: false, code: 1, stdout: "", stderr: "checkout failed", combined: "checkout failed" };
                }
                if (args[0] === "add" && scenario.step === "add") {
                  return { success: false, code: 1, stdout: "", stderr: "add failed", combined: "add failed" };
                }
                if (args[0] === "diff") {
                  if (scenario.step === "diff") {
                    return { success: false, code: 1, stdout: "", stderr: "diff failed", combined: "diff failed" };
                  }
                  return {
                    success: true,
                    code: 0,
                    stdout: "demo-file-1668f4f0ae/README.md\n",
                    stderr: "",
                    combined: ""
                  };
                }
                if (args[0] === "commit" && scenario.step === "commit") {
                  return { success: false, code: 1, stdout: "", stderr: "commit failed", combined: "commit failed" };
                }
                if (args[0] === "push" && scenario.step === "push") {
                  return { success: false, code: 1, stdout: "", stderr: "push failed", combined: "push failed" };
                }
                return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
              },
              fetchImpl: async () => new Response(JSON.stringify({ html_url: "https://github.com/acme/repo/pull/1" }), { status: 201 })
            }
          }),
        scenario.expected
      );
    });
  }
});

test("runGitPrFlowWithDeps includes artifact hints in truncated git-step failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-truncated-failure-"));
  const generatedProjectDir = path.join(tempRoot, "generated");

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const artifactPath = path.join(tempRoot, "job", ".stage-store", "cmd-output", "git_pr_clone.stdout.log");

  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo-file",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://github.com/acme/repo.git",
          repoToken: "secret"
        },
        jobId: createJobRecord().jobId,
        generatedProjectDir,
        jobDir: path.join(tempRoot, "job"),
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "ls-remote") {
              return {
                success: true,
                code: 0,
                stdout: "ref: refs/heads/main HEAD\n",
                stderr: "",
                combined: ""
              };
            }
            if (args[0] === "clone") {
              return {
                success: false,
                code: 1,
                stdout: "clone failed prefix",
                stderr: "",
                combined: [
                  "clone failed prefix",
                  `stdout truncated after retaining 64 of 256 bytes; full output stored at ${artifactPath}`
                ].join("\n"),
                stdoutMetadata: {
                  observedBytes: 256,
                  retainedBytes: 64,
                  truncated: true,
                  artifactPath
                }
              };
            }
            return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
          },
          fetchImpl: async () => new Response("", { status: 201 })
        }
      }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal(String((error as Error).message).includes("git clone failed"), true);
      assert.equal(String((error as Error).message).includes(artifactPath), true);
      return true;
    }
  );
});

test("runGitPrFlowWithDeps handles malformed PR response body without throwing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-malformed-pr-response-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const logs: string[] = [];

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "secret"
    },
    jobId: createJobRecord("ffffffff-0000-1111-2222-333333333333").jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ args }) => {
        if (args[0] === "ls-remote") {
          return { success: true, code: 0, stdout: "ref: refs/heads/main HEAD\n", stderr: "", combined: "" };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return { success: true, code: 0, stdout: "demo-file-1668f4f0ae/README.md\n", stderr: "", combined: "" };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async () => new Response("not-json", { status: 201 })
    }
  });

  assert.equal(result.status, "executed");
  assert.equal(result.prUrl, undefined);
  assert.ok(logs.some((entry) => entry.includes("response body could not be parsed")));
  await assertPathMissing(repoDir);
});

test("runGitPrFlowWithDeps logs GitHub PR rate limits and returns branch metadata without prUrl", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-rate-limit-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  const logs: string[] = [];

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "secret"
    },
    jobId: createJobRecord("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ args }) => {
        if (args[0] === "ls-remote") {
          return { success: true, code: 0, stdout: "ref: refs/heads/main HEAD\n", stderr: "", combined: "" };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return { success: true, code: 0, stdout: "demo-file-1668f4f0ae/README.md\n", stderr: "", combined: "" };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async () =>
        new Response('{"message":"secondary rate limit"}', { status: 429 })
    }
  });

  assert.equal(result.status, "executed");
  assert.equal(result.prUrl, undefined);
  assert.equal(result.branchName.startsWith("auto/figma/demo-file-"), true);
  assert.ok(logs.some((entry) => entry.includes("PR creation failed (429)")));
  await assertPathMissing(repoDir);
});

test("runGitPrFlowWithDeps enforces minimum timeout of 1000ms", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-min-timeout-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  let capturedSignal: AbortSignal | undefined;

  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "secret"
    },
    jobId: createJobRecord().jobId,
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: () => {
      // no-op
    },
    commandTimeoutMs: 50,
    deps: {
      runCommand: async ({ args }) => {
        if (args[0] === "ls-remote") {
          return { success: true, code: 0, stdout: "ref: refs/heads/main HEAD\n", stderr: "", combined: "" };
        }
        if (args[0] === "clone") {
          await mkdir(repoDir, { recursive: true });
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        }
        if (args[0] === "diff") {
          return { success: true, code: 0, stdout: "demo-file-1668f4f0ae/README.md\n", stderr: "", combined: "" };
        }
        return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
      },
      fetchImpl: async (_input, init) => {
        capturedSignal = init?.signal;
        return new Response(JSON.stringify({ html_url: "https://github.com/acme/repo/pull/1" }), { status: 201 });
      }
    }
  });

  assert.equal(result.status, "executed");
  assert.equal(result.prUrl, "https://github.com/acme/repo/pull/1");
  assert.equal(capturedSignal instanceof AbortSignal, true);
  assert.equal(capturedSignal?.aborted, false);
  await assertPathMissing(repoDir);
});
