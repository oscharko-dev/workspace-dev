import type { WorkspaceJobInput } from "../../contracts/index.js";
import { executePersistedGitPr } from "../git-pr-persistence.js";
import { runGitPrFlow } from "../git-pr.js";
import type { StageService } from "../pipeline/stage-service.js";

export type GitPrStageInput = WorkspaceJobInput;

interface GitPrServiceDeps {
  runGitPrFlowFn: typeof runGitPrFlow;
}

export const createGitPrService = ({ runGitPrFlowFn = runGitPrFlow }: Partial<GitPrServiceDeps> = {}): StageService<GitPrStageInput> => {
  return {
    stageName: "git.pr",
    execute: async (input, context) => {
      await executePersistedGitPr({
        artifactStore: context.artifactStore,
        input,
        jobId: context.jobId,
        jobDir: context.paths.jobDir,
        commandTimeoutMs: context.runtime.commandTimeoutMs,
        commandStdoutMaxBytes: context.runtime.commandStdoutMaxBytes,
        commandStderrMaxBytes: context.runtime.commandStderrMaxBytes,
        onLog: (message) => {
          context.log({
            level: "info",
            message
          });
        },
        deps: {
          runGitPrFlowFn
        }
      });
    }
  };
};

export const GitPrService: StageService<GitPrStageInput> = createGitPrService();
