import type {
  WorkspaceFigmaSourceMode,
  WorkspaceJobRetryStage,
  WorkspacePipelineDescriptor,
  WorkspacePipelineId,
  WorkspacePipelineScope,
} from "../../contracts/index.js";
import type { PipelineExecutionMode } from "./context.js";
import type { PipelineStagePlanEntry } from "./orchestrator.js";

export interface PipelinePlanContext {
  mode: PipelineExecutionMode;
  retryStage?: WorkspaceJobRetryStage;
}

export interface PipelineDefinition {
  id: WorkspacePipelineId;
  displayName: string;
  description: string;
  supportedSourceModes: readonly WorkspaceFigmaSourceMode[];
  supportedScopes: readonly WorkspacePipelineScope[];
  buildSubmissionPlan(context: PipelinePlanContext): PipelineStagePlanEntry[];
  buildRegenerationPlan(context: PipelinePlanContext): PipelineStagePlanEntry[];
  buildRetryPlan(context: PipelinePlanContext & {
    retryStage: WorkspaceJobRetryStage;
  }): PipelineStagePlanEntry[];
}

export const toPipelineDescriptor = (
  definition: PipelineDefinition,
): WorkspacePipelineDescriptor => ({
  id: definition.id,
  displayName: definition.displayName,
  description: definition.description,
  supportedSourceModes: [...definition.supportedSourceModes],
  supportedScopes: [...definition.supportedScopes],
});
