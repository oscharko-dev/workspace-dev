import type { WorkspacePipelineId } from "../../contracts/index.js";

type BuildProfileId = "default" | "rocket" | "default-rocket";

const normalizeBuildProfile = (
  rawProfile: string | undefined,
): { id: BuildProfileId; pipelineIds: readonly WorkspacePipelineId[] } => {
  const normalized = rawProfile?.trim() || "default,rocket";
  if (normalized === "default") {
    return { id: "default", pipelineIds: ["default"] };
  }
  if (normalized === "rocket") {
    return { id: "rocket", pipelineIds: ["rocket"] };
  }
  if (normalized === "default,rocket" || normalized === "default-rocket") {
    return { id: "default-rocket", pipelineIds: ["default", "rocket"] };
  }
  throw new Error(
    `Unsupported WORKSPACE_DEV_PIPELINES value '${normalized}'. Expected 'default', 'rocket', or 'default,rocket'.`,
  );
};

const CURRENT_BUILD_PROFILE = normalizeBuildProfile(
  process.env.WORKSPACE_DEV_PIPELINES,
);

export const CURRENT_BUILD_PROFILE_PIPELINE_IDS: readonly WorkspacePipelineId[] =
  CURRENT_BUILD_PROFILE.pipelineIds;

export const CURRENT_BUILD_PROFILE_ID: BuildProfileId =
  CURRENT_BUILD_PROFILE.id;
