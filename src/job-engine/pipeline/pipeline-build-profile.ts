import type { WorkspacePipelineId } from "../../contracts/index.js";

export const CURRENT_BUILD_PROFILE_PIPELINE_IDS: readonly WorkspacePipelineId[] =
  ["rocket"] as const;

export const CURRENT_BUILD_PROFILE_ID = "rocket" as const;
