import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
  AGENT_ROLE_RUN_SCHEMA_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
} from "../contracts/index.js";
import { writeAgentRoleRunArtifact } from "./agent-role-run-artifact.js";

test("writeAgentRoleRunArtifact persists minimal prompt-run metadata without raw prompts", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "agent-role-run-artifact-"));
  try {
    const hashes = {
      inputHash: "1".repeat(64),
      promptHash: "2".repeat(64),
      schemaHash: "3".repeat(64),
      cacheKey: "4".repeat(64),
      cacheablePrefixHash: "5".repeat(64),
    };
    const { artifactPath, artifact } = await writeAgentRoleRunArtifact({
      runDir,
      jobId: "job-1769",
      roleRunId: "test_generation",
      roleStepId: "test_generation",
      hashes,
    });

    assert.ok(
      artifactPath.endsWith(
        `${AGENT_ROLE_RUN_ARTIFACT_DIRECTORY}/test_generation.json`,
      ),
    );
    assert.equal(artifact.schemaVersion, AGENT_ROLE_RUN_SCHEMA_VERSION);
    assert.equal(
      artifact.promptTemplateVersion,
      TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    );
    assert.equal(artifact.cacheablePrefixHash, hashes.cacheablePrefixHash);
    assert.equal(artifact.rawPromptsIncluded, false);

    const parsed = JSON.parse(await readFile(artifactPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(parsed["cacheablePrefixHash"], hashes.cacheablePrefixHash);
    assert.equal(parsed["rawPromptsIncluded"], false);
    assert.equal("systemPrompt" in parsed, false);
    assert.equal("userPrompt" in parsed, false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
