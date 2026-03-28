import type { WorkspaceGenerationDiffReport, WorkspaceJobInput, WorkspaceGitPrStatus } from "../../contracts/index.js";
import { runGitPrFlow } from "../git-pr.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";

export type GitPrStageInput = WorkspaceJobInput;

interface GitPrServiceDeps {
  runGitPrFlowFn: typeof runGitPrFlow;
}

export const createGitPrService = ({ runGitPrFlowFn = runGitPrFlow }: Partial<GitPrServiceDeps> = {}): StageService<GitPrStageInput> => {
  return {
    stageName: "git.pr",
    execute: async (input, context) => {
      const generatedProjectDir = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
      const generationDiff = await context.artifactStore.requireValue<WorkspaceGenerationDiffReport>(
        STAGE_ARTIFACT_KEYS.generationDiff
      );
      const gitResult = await runGitPrFlowFn({
        input,
        jobId: context.jobId,
        generatedProjectDir,
        jobDir: context.paths.jobDir,
        commandTimeoutMs: context.runtime.commandTimeoutMs,
        generationDiff,
        onLog: (message) => {
          context.log({
            level: "info",
            message
          });
        }
      });
      const gitPrStatus: WorkspaceGitPrStatus = {
        status: gitResult.status,
        ...(gitResult.prUrl ? { prUrl: gitResult.prUrl } : {}),
        branchName: gitResult.branchName,
        scopePath: gitResult.scopePath,
        changedFiles: gitResult.changedFiles
      };
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.gitPrStatus,
        stage: "git.pr",
        value: gitPrStatus
      });
    }
  };
};

export const GitPrService: StageService<GitPrStageInput> = createGitPrService();
