import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
  AGENT_ROLE_RUN_SCHEMA_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type AgentRoleRunArtifact,
  type CompiledPromptHashes,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export interface WriteAgentRoleRunArtifactInput {
  runDir: string;
  jobId: string;
  roleRunId: string;
  roleStepId: string;
  hashes: CompiledPromptHashes;
}

export interface WriteAgentRoleRunArtifactResult {
  artifactPath: string;
  artifact: AgentRoleRunArtifact;
}

export const writeAgentRoleRunArtifact = async (
  input: WriteAgentRoleRunArtifactInput,
): Promise<WriteAgentRoleRunArtifactResult> => {
  if (input.runDir.trim().length === 0) {
    throw new TypeError("writeAgentRoleRunArtifact: runDir must be non-empty");
  }
  if (input.roleRunId.trim().length === 0) {
    throw new TypeError(
      "writeAgentRoleRunArtifact: roleRunId must be non-empty",
    );
  }
  if (input.roleStepId.trim().length === 0) {
    throw new TypeError(
      "writeAgentRoleRunArtifact: roleStepId must be non-empty",
    );
  }

  const artifact: AgentRoleRunArtifact = {
    schemaVersion: AGENT_ROLE_RUN_SCHEMA_VERSION,
    jobId: input.jobId,
    roleRunId: input.roleRunId,
    roleStepId: input.roleStepId,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    cacheablePrefixHash: input.hashes.cacheablePrefixHash,
    promptHash: input.hashes.promptHash,
    schemaHash: input.hashes.schemaHash,
    inputHash: input.hashes.inputHash,
    cacheKeyDigest: input.hashes.cacheKey,
    rawPromptsIncluded: false,
  };

  const artifactDir = join(input.runDir, AGENT_ROLE_RUN_ARTIFACT_DIRECTORY);
  const artifactPath = join(artifactDir, `${input.roleRunId}.json`);
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(artifactDir, { recursive: true });
  await writeFile(tmpPath, `${canonicalJson(artifact)}\n`, "utf8");
  await rename(tmpPath, artifactPath);

  return { artifactPath, artifact };
};
