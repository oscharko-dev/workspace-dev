import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runGitPrFlowWithDeps } from "./git-pr.js";
import type { JobRecord } from "./types.js";

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

test("runGitPrFlowWithDeps validates repo configuration early", async () => {
  const job = createJobRecord();
  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: { figmaFileKey: "demo", figmaAccessToken: "pat", enableGitPr: true },
        job,
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
        job,
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
  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const logs: string[] = [];

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "secret"
    },
    job: createJobRecord(),
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ args }) => {
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
});

test("runGitPrFlowWithDeps executes full PR flow and redacts failed PR response", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-success-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  await mkdir(generatedProjectDir, { recursive: true });
  await writeFile(path.join(generatedProjectDir, "README.md"), "content\n", "utf8");

  const logs: string[] = [];

  const result = await runGitPrFlowWithDeps({
    input: {
      figmaFileKey: "demo-file",
      figmaAccessToken: "pat",
      enableGitPr: true,
      repoUrl: "https://github.com/acme/repo.git",
      repoToken: "my-secret-token",
      targetPath: "generated"
    },
    job: createJobRecord("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    generatedProjectDir,
    jobDir: path.join(tempRoot, "job"),
    onLog: (message) => {
      logs.push(message);
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
      fetchImpl: async () => new Response("my-secret-token should be redacted", { status: 500 })
    }
  });

  assert.equal(result.status, "executed");
  assert.ok(result.branchName.includes("auto/figma/demo-file"));
  assert.equal(result.prUrl, undefined);
  assert.equal(result.changedFiles.length, 1);
  assert.ok(logs.some((entry) => entry.includes("[REDACTED]")));
});

test("runGitPrFlowWithDeps rejects unsafe targetPath", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-invalid-path-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  await mkdir(generatedProjectDir, { recursive: true });

  await assert.rejects(
    () =>
      runGitPrFlowWithDeps({
        input: {
          figmaFileKey: "demo-file",
          figmaAccessToken: "pat",
          enableGitPr: true,
          repoUrl: "https://github.com/acme/repo.git",
          repoToken: "secret",
          targetPath: "../outside"
        },
        job: createJobRecord(),
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
});

test("runGitPrFlowWithDeps supports ssh GitHub URLs, main fallback, and successful PR creation responses", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gitpr-ssh-success-"));
  const generatedProjectDir = path.join(tempRoot, "generated");
  const repoDir = path.join(tempRoot, "job", "repo");
  let requestBody = "";
  let requestUrl = "";

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
    job: createJobRecord("bbbbbbbb-cccc-dddd-eeee-ffffffffffff"),
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
      runCommand: async ({ args }) => {
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
        return new Response(JSON.stringify({ html_url: "https://github.com/acme/repo/pull/123" }), { status: 201 });
      }
    }
  });

  assert.equal(result.prUrl, "https://github.com/acme/repo/pull/123");
  assert.equal(result.changedFiles.length, 1);
  assert.equal(requestUrl, "https://api.github.com/repos/acme/repo/pulls");
  assert.equal(requestBody.includes("### Generation Diff Report"), true);
  assert.equal(requestBody.includes('"base":"main"'), true);
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
        job: createJobRecord(),
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
            job: createJobRecord(),
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
