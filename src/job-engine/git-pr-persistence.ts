import type { WorkspaceGenerationDiffReport, WorkspaceGitPrStatus, WorkspaceJobInput } from "../contracts/index.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import type { StageArtifactStore } from "./pipeline/artifact-store.js";
import { runGitPrFlow } from "./git-pr.js";

interface ExecutePersistedGitPrDeps {
  runGitPrFlowFn?: typeof runGitPrFlow;
}

export const toGitPrStatus = ({
  result
}: {
  result: Awaited<ReturnType<typeof runGitPrFlow>>;
}): WorkspaceGitPrStatus => {
  return {
    status: result.status,
    ...(result.prUrl ? { prUrl: result.prUrl } : {}),
    branchName: result.branchName,
    scopePath: result.scopePath,
    changedFiles: result.changedFiles
  };
};

export const executePersistedGitPr = async ({
  artifactStore,
  input,
  jobId,
  importSessionId,
  jobDir,
  commandTimeoutMs,
  commandStdoutMaxBytes,
  commandStderrMaxBytes,
  onLog,
  deps
}: {
  artifactStore: StageArtifactStore;
  input: WorkspaceJobInput;
  jobId: string;
  importSessionId?: string;
  jobDir: string;
  commandTimeoutMs: number;
  commandStdoutMaxBytes: number;
  commandStderrMaxBytes: number;
  onLog: (message: string) => void;
  deps?: ExecutePersistedGitPrDeps;
}): Promise<WorkspaceGitPrStatus> => {
  const generatedProjectDir = await artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
  const generationDiff = await artifactStore.requireValue<WorkspaceGenerationDiffReport>(STAGE_ARTIFACT_KEYS.generationDiff);
  const result = await (deps?.runGitPrFlowFn ?? runGitPrFlow)({
    input,
    jobId,
    ...(importSessionId ? { importSessionId } : {}),
    generatedProjectDir,
    jobDir,
    commandTimeoutMs,
    commandStdoutMaxBytes,
    commandStderrMaxBytes,
    generationDiff,
    onLog
  });
  const gitPrStatus = toGitPrStatus({ result });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.gitPrStatus,
    stage: "git.pr",
    value: gitPrStatus
  });
  return gitPrStatus;
};

export const toGitPrStageMessage = ({
  gitPrStatus
}: {
  gitPrStatus: WorkspaceGitPrStatus;
}): string => {
  return gitPrStatus.prUrl ? `PR created: ${gitPrStatus.prUrl}` : `Branch pushed: ${gitPrStatus.branchName ?? "unknown"}`;
};
