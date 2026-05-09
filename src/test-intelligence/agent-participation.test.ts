import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  AGENT_PARTICIPATION_ARTIFACT_FILENAME,
  AGENT_PARTICIPATION_ROLES,
  AGENT_PARTICIPATION_SCHEMA_VERSION,
  buildAgentParticipationArtifact,
  writeAgentParticipationArtifact,
} from "./agent-participation.js";
import { classifyTaskBatch } from "./task-classifier-agent.js";

test("schema: bumped to 1.2.0 for routing decisions plus explicit role views (#2028, #2043)", () => {
  assert.equal(AGENT_PARTICIPATION_SCHEMA_VERSION, "1.2.0");
});

test("roles: task_classifier registered alongside the existing roles (#2043)", () => {
  assert.ok(
    (AGENT_PARTICIPATION_ROLES as readonly string[]).includes(
      "task_classifier",
    ),
    "task_classifier must be a known participation role",
  );
});

test("buildAgentParticipationArtifact: omits routingDecisions when absent (legacy byte-shape)", () => {
  const artifact = buildAgentParticipationArtifact({
    jobId: "job-legacy",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [
      {
        role: "generator",
        configurationSource: "default",
        status: "succeeded",
        attemptCount: 1,
        artifactReferences: ["a.json"],
      },
    ],
  });
  assert.equal(artifact.schemaVersion, AGENT_PARTICIPATION_SCHEMA_VERSION);
  assert.equal(artifact.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(artifact.routingDecisions, undefined);
  assert.equal(artifact.roleViews.workflowRoles.length, 1);
  assert.equal(artifact.roleViews.deployedLlmSidecars.length, 1);
});

test("buildAgentParticipationArtifact: role views separate workflow roles from deployed sidecars", () => {
  const artifact = buildAgentParticipationArtifact({
    jobId: "job-views",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [
      {
        role: "action_topology",
        configurationSource: "default",
        status: "succeeded",
        attemptCount: 1,
        artifactReferences: ["workflow-topology.json"],
      },
      {
        role: "judge_secondary",
        configurationSource: "env",
        status: "succeeded",
        attemptCount: 1,
        artifactReferences: ["judge-consensus.json"],
      },
    ],
  });

  assert.deepEqual(
    artifact.roleViews.workflowRoles.map((entry) => entry.role),
    ["action_topology", "judge_secondary"],
  );
  assert.deepEqual(
    artifact.roleViews.deployedLlmSidecars.map((entry) => entry.role),
    ["judge_secondary"],
  );
});

test("buildAgentParticipationArtifact: persists routing decisions sorted by taskId", () => {
  const decisions = classifyTaskBatch([
    { taskId: "z-task", taskKind: "vision" },
    { taskId: "a-task", taskKind: "simple_ui_validation", estimatedInputTokens: 200 },
    { taskId: "m-task", taskKind: "regulatory_inference" },
  ]);
  const artifact = buildAgentParticipationArtifact({
    jobId: "job-routing",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [],
    routingDecisions: decisions,
  });
  assert.ok(artifact.routingDecisions);
  assert.equal(artifact.routingDecisions!.length, 3);
  assert.equal(artifact.routingDecisions![0]!.taskId, "a-task");
  assert.equal(artifact.routingDecisions![1]!.taskId, "m-task");
  assert.equal(artifact.routingDecisions![2]!.taskId, "z-task");
  for (const d of artifact.routingDecisions!) {
    assert.ok(d.rationale.length > 0);
    assert.equal(d.classifierRoleId, "task_classifier");
    assert.equal(d.classifierVersion, "1.0.0");
    assert.ok(d.signals.length >= 1);
  }
});

test("buildAgentParticipationArtifact: zero-length routing decisions is the same as undefined", () => {
  const artifact = buildAgentParticipationArtifact({
    jobId: "job-empty",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [],
    routingDecisions: [],
  });
  assert.equal(artifact.routingDecisions, undefined);
});

test("buildAgentParticipationArtifact: byte-stable for identical input", () => {
  const decisions = classifyTaskBatch([
    { taskId: "a", taskKind: "simple_ui_validation", estimatedInputTokens: 200 },
    { taskId: "b", taskKind: "regulatory_inference" },
  ]);
  const a = buildAgentParticipationArtifact({
    jobId: "job-stable",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [],
    routingDecisions: decisions,
  });
  const b = buildAgentParticipationArtifact({
    jobId: "job-stable",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [],
    routingDecisions: decisions,
  });
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("writeAgentParticipationArtifact: persists with routing decisions", async () => {
  const decisions = classifyTaskBatch([
    { taskId: "t-1", taskKind: "simple_ui_validation", estimatedInputTokens: 200 },
  ]);
  const artifact = buildAgentParticipationArtifact({
    jobId: "job-write",
    generatedAt: "2026-05-08T00:00:00Z",
    roles: [
      {
        role: "task_classifier",
        configurationSource: "default",
        status: "succeeded",
        attemptCount: 1,
        artifactReferences: [],
      },
    ],
    routingDecisions: decisions,
  });
  const dir = await mkdtemp(join(tmpdir(), "agent-participation-"));
  try {
    const result = await writeAgentParticipationArtifact({
      artifact,
      destinationDir: dir,
    });
    assert.equal(
      result.artifactPath,
      join(dir, AGENT_PARTICIPATION_ARTIFACT_FILENAME),
    );
    const persisted = await readFile(result.artifactPath, "utf8");
    const parsed = JSON.parse(persisted);
    assert.equal(parsed.schemaVersion, "1.2.0");
    assert.equal(parsed.routingDecisions.length, 1);
    assert.equal(parsed.routingDecisions[0].taskId, "t-1");
    assert.ok(Array.isArray(parsed.roleViews.workflowRoles));
    assert.ok(Array.isArray(parsed.roleViews.deployedLlmSidecars));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
