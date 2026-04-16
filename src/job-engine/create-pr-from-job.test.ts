import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import { StageArtifactStore } from "./pipeline/artifact-store.js";
import { ensureTemplateValidationSeedNodeModules } from "./test-validation-seed.js";

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 300_000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed" || status.status === "canceled")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

test.before(async () => {
  await ensureTemplateValidationSeedNodeModules();
});

const createLocalFigmaPayload = () => ({
  name: "PR Test Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Test Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                characters: "Hello World",
                absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
                style: { fontSize: 24, fontWeight: 400, lineHeightPx: 32 },
                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }]
              }
            ]
          }
        ]
      }
    ]
  }
});

const createFastJobEngine = ({ tempRoot }: { tempRoot: string }) =>
  createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000
    })
  });

const assertPathMissing = async (targetPath: string): Promise<void> => {
  await assert.rejects(() => access(targetPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
};

const writeFakeGitBinary = async ({
  tempRoot
}: {
  tempRoot: string;
}): Promise<{ binDir: string; argsLogPath: string; envLogPath: string }> => {
  const binDir = path.join(tempRoot, "bin");
  const gitPath = path.join(binDir, "git");
  const argsLogPath = path.join(tempRoot, "git-args.log");
  const envLogPath = path.join(tempRoot, "git-env.log");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    gitPath,
    `#!/bin/sh
set -eu
args_log_path=${JSON.stringify(argsLogPath)}
env_log_path=${JSON.stringify(envLogPath)}
cmd="$1"
printf '%s\\n' "$*" >> "$args_log_path"
printf 'GIT_ASKPASS=%s | WORKSPACE_DEV_GIT_USERNAME=%s | WORKSPACE_DEV_GIT_ASKPASS_SCRIPT=%s\\n' "\${GIT_ASKPASS-}" "\${WORKSPACE_DEV_GIT_USERNAME-}" "\${WORKSPACE_DEV_GIT_ASKPASS_SCRIPT-}" >> "$env_log_path"
case "$cmd" in
  ls-remote)
    printf 'ref: refs/heads/main HEAD\\n'
    ;;
  clone)
    repo_dir=""
    for arg in "$@"; do
      repo_dir="$arg"
    done
    mkdir -p "$repo_dir/.git"
    printf '[remote "origin"]\\n\turl = %s\\n' "$6" > "$repo_dir/.git/config"
    ;;
  diff)
    printf 'generated/manual-pr/README.md\\n'
    ;;
  *)
    ;;
esac
`,
    "utf8"
  );
  await chmod(gitPath, 0o755);
  return {
    binDir,
    argsLogPath,
    envLogPath
  };
};

test("createPrFromJob throws E_PR_JOB_NOT_FOUND when job does not exist", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-createpr-notfound-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: false })
  });

  await assert.rejects(
    () =>
      engine.createPrFromJob({
        jobId: "nonexistent",
        prInput: { repoUrl: "https://github.com/acme/repo", repoToken: "token" }
      }),
    (error: Error & { code?: string }) => error.code === "E_PR_JOB_NOT_FOUND"
  );
});

test("createPrFromJob throws E_PR_NOT_REGENERATION_JOB for non-regeneration completed job", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-createpr-notregen-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const accepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });

  const status = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: accepted.jobId
  });
  assert.equal(status.status, "completed");

  await assert.rejects(
    () =>
      engine.createPrFromJob({
        jobId: accepted.jobId,
        prInput: { repoUrl: "https://github.com/acme/repo", repoToken: "token" }
      }),
    (error: Error & { code?: string }) => error.code === "E_PR_NOT_REGENERATION_JOB"
  );
});

test("createPrFromJob throws E_PR_JOB_NOT_COMPLETED for running job", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-createpr-notcompleted-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }
        })
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });

  await assert.rejects(
    () =>
      engine.createPrFromJob({
        jobId: accepted.jobId,
        prInput: { repoUrl: "https://github.com/acme/repo", repoToken: "token" }
      }),
    (error: Error & { code?: string }) => error.code === "E_PR_JOB_NOT_COMPLETED"
  );

  engine.cancelJob({ jobId: accepted.jobId });
});

test("createPrFromJob requires approval and persists gitPr state through stage artifacts and rehydration", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-createpr-persisted-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createFastJobEngine({ tempRoot });
  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 30 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed");
  assert.equal(regenStatus.gitPr?.status, "skipped");

  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId
  );
  assert.ok(sourceImportSession);
  assert.equal(sourceImportSession.status, "imported");
  assert.equal(sourceImportSession.reviewRequired, true);
  await assert.rejects(
    () =>
      engine.createPrFromJob({
        jobId: regenAccepted.jobId,
        prInput: {
          repoUrl: "https://github.com/acme/repo.git",
          repoToken: "secret-token",
          targetPath: "generated",
          reviewerNote: "Approved for PR creation."
        }
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_PR_IMPORT_REVIEW_REQUIRED"
  );
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "review_started",
      at: "",
    }
  });
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "approved",
      at: "",
    }
  });

  const { binDir: fakeGitBin, argsLogPath, envLogPath } = await writeFakeGitBinary({ tempRoot });
  const originalPath = process.env.PATH;
  const originalFetch = globalThis.fetch;
  process.env.PATH = `${fakeGitBin}:${originalPath ?? ""}`;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ html_url: "https://example.invalid/pr/123" }), {
      status: 201,
      headers: {
        "content-type": "application/json"
      }
    });

  try {
    const result = await engine.createPrFromJob({
      jobId: regenAccepted.jobId,
      prInput: {
        repoUrl: "https://github.com/acme/repo.git",
        repoToken: "secret-token",
        targetPath: "generated",
        reviewerNote: "Approved for PR creation."
      }
    });

    assert.equal(result.gitPr.status, "executed");
    assert.equal(result.gitPr.prUrl, "https://example.invalid/pr/123");
    assert.equal(
      result.gitPr.branchName?.includes(sourceImportSession.id.slice(0, 8)),
      true
    );
    assert.equal(
      result.gitPr.branchName?.includes(regenAccepted.jobId.slice(0, 8)) ?? false,
      false
    );

    const artifactStore = new StageArtifactStore({ jobDir: String(regenStatus.artifacts.jobDir) });
    const storedGitPr = await artifactStore.getValue(STAGE_ARTIFACT_KEYS.gitPrStatus);
    assert.deepEqual(storedGitPr, result.gitPr);

    const auditTrail = await engine.listImportSessionEvents({
      sessionId: sourceImportSession.id
    });
    const approvedEvents = auditTrail.filter((event) => event.kind === "approved");
    assert.equal(auditTrail.some((event) => event.kind === "note"), true);
    const prAuditEvent = auditTrail.findLast((event) => event.kind === "note");
    assert.equal(approvedEvents.length, 1);
    assert.equal(
      prAuditEvent?.note,
      "PR created from regeneration job. Reviewer note: Approved for PR creation."
    );
    assert.equal(prAuditEvent?.metadata?.jobId, regenAccepted.jobId);
    assert.equal(prAuditEvent?.metadata?.sourceJobId, sourceAccepted.jobId);
    assert.equal(prAuditEvent?.metadata?.branchName, result.gitPr.branchName);
    assert.equal(prAuditEvent?.metadata?.prUrl, "https://example.invalid/pr/123");

    const stageTimings = JSON.parse(await readFile(String(regenStatus.artifacts.stageTimingsFile), "utf8")) as {
      snapshotVersion?: number;
      gitPr?: { prUrl?: string; status?: string };
      stages?: Array<{ name?: string; status?: string; message?: string }>;
    };
    assert.equal(stageTimings.snapshotVersion, 1);
    assert.equal(stageTimings.gitPr?.status, "executed");
    assert.equal(stageTimings.gitPr?.prUrl, "https://example.invalid/pr/123");
    assert.equal(
      stageTimings.stages?.some(
        (stage) => stage.name === "git.pr" && stage.status === "completed" && stage.message?.includes("PR created:")
      ),
      true
    );

    const rehydratedEngine = createFastJobEngine({ tempRoot });
    const rehydrated = rehydratedEngine.getJob(regenAccepted.jobId);
    assert.equal(rehydrated?.gitPr?.status, "executed");
    assert.equal(rehydrated?.gitPr?.prUrl, "https://example.invalid/pr/123");
    assert.equal(
      rehydrated?.stages.some(
        (stage) => stage.name === "git.pr" && stage.status === "completed" && stage.message?.includes("PR created:")
      ),
      true
    );

    const gitArgsLog = await readFile(argsLogPath, "utf8");
    const gitEnvLog = await readFile(envLogPath, "utf8");
    assert.equal(gitArgsLog.includes("secret-token"), false);
    assert.equal(gitArgsLog.includes("x-access-token"), false);
    assert.equal(gitArgsLog.includes("https://github.com/acme/repo.git"), true);
    assert.equal(gitEnvLog.includes("GIT_ASKPASS="), true);
    assert.equal(gitEnvLog.includes("WORKSPACE_DEV_GIT_USERNAME=x-access-token"), true);
    await assertPathMissing(path.join(String(regenStatus.artifacts.jobDir), "repo"));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.PATH = originalPath;
  }
});
