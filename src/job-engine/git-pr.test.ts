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
    generationLocale: "de-DE"
  },
  stages: [],
  logs: [],
  artifacts: {
    outputRoot: "/tmp",
    jobDir: "/tmp/job"
  },
  preview: { enabled: true }
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
