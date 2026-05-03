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
import { assertRoleLineageDepth } from "../contracts/branded-ids.js";
import { canonicalJson } from "./content-hash.js";

export interface WriteAgentRoleRunArtifactInput {
  runDir: string;
  jobId: string;
  roleRunId: string;
  roleStepId: string;
  parentJobId?: string;
  roleLineageDepth?: number;
  hashes: CompiledPromptHashes;
}

export interface WriteAgentRoleRunArtifactResult {
  artifactPath: string;
  artifact: AgentRoleRunArtifact;
  bytes: Uint8Array;
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
  assertRoleLineageDepth(
    input.roleLineageDepth,
    "writeAgentRoleRunArtifact",
  );

  const artifact: AgentRoleRunArtifact = {
    schemaVersion: AGENT_ROLE_RUN_SCHEMA_VERSION,
    jobId: input.jobId,
    roleRunId: input.roleRunId,
    roleStepId: input.roleStepId,
    ...(input.parentJobId !== undefined
      ? { parentJobId: input.parentJobId }
      : {}),
    ...(input.roleLineageDepth !== undefined
      ? { roleLineageDepth: input.roleLineageDepth }
      : {}),
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
  const serialized = `${canonicalJson(artifact)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);

  return { artifactPath, artifact, bytes };
};
