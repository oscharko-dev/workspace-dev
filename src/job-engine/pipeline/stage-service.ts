import type { WorkspaceJobStageName } from "../../contracts/index.js";
import type { StageArtifactKey } from "./artifact-keys.js";
import type { StageRuntimeContext } from "./context.js";

export interface StageArtifactContract {
  reads?: StageArtifactKey[];
  writes?: StageArtifactKey[];
  optionalWrites?: StageArtifactKey[];
}

export interface StageService<TInput = any> {
  stageName: WorkspaceJobStageName;
  execute: (input: TInput, context: StageRuntimeContext) => Promise<void>;
}
