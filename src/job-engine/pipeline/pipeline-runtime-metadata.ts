import type {
  WorkspaceJobPipelineMetadata,
  WorkspacePipelineId,
} from "../../contracts/index.js";
import type { JobRecord } from "../types.js";
import { CURRENT_BUILD_PROFILE_ID } from "./pipeline-build-profile.js";

interface PipelineMetadataSource {
  id: WorkspacePipelineId;
  displayName: string;
  deterministic: true;
  template: {
    bundleId: string;
  };
}

type BuiltInPipelineId = "default" | "rocket";

const BUILTIN_PIPELINE_METADATA: Record<
  BuiltInPipelineId,
  WorkspaceJobPipelineMetadata
> = {
  default: {
    pipelineId: "default",
    pipelineDisplayName: "Default",
    templateBundleId: "react-tailwind-app",
    buildProfile: CURRENT_BUILD_PROFILE_ID,
    deterministic: true,
  },
  rocket: {
    pipelineId: "rocket",
    pipelineDisplayName: "Rocket",
    templateBundleId: "react-mui-app",
    buildProfile: CURRENT_BUILD_PROFILE_ID,
    deterministic: true,
  },
};

export const toPipelineRuntimeMetadata = (
  definition: PipelineMetadataSource,
): WorkspaceJobPipelineMetadata => ({
  pipelineId: definition.id,
  pipelineDisplayName: definition.displayName,
  templateBundleId: definition.template.bundleId,
  buildProfile: CURRENT_BUILD_PROFILE_ID,
  deterministic: definition.deterministic,
});

const LEGACY_ROCKET_PIPELINE_METADATA = BUILTIN_PIPELINE_METADATA.rocket;

export const clonePipelineMetadata = (
  metadata: WorkspaceJobPipelineMetadata,
): WorkspaceJobPipelineMetadata => ({ ...metadata });

export const resolveJobPipelineMetadata = (
  job: Pick<JobRecord, "request"> & {
    pipelineMetadata?: WorkspaceJobPipelineMetadata;
  },
): WorkspaceJobPipelineMetadata => {
  if (job.pipelineMetadata) {
    return clonePipelineMetadata(job.pipelineMetadata);
  }
  if (job.request.pipelineMetadata) {
    return clonePipelineMetadata(job.request.pipelineMetadata);
  }
  const requestPipelineId = job.request.pipelineId?.trim();
  if (requestPipelineId === "default" || requestPipelineId === "rocket") {
    return clonePipelineMetadata(BUILTIN_PIPELINE_METADATA[requestPipelineId]);
  }
  return clonePipelineMetadata(LEGACY_ROCKET_PIPELINE_METADATA);
};
