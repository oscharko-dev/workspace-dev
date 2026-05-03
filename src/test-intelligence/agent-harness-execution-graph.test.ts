import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION,
  AGENT_HARNESS_GRAPH_RETRY_POLICIES,
  AGENT_TEAM_CONFIG_ARTIFACT_FILENAME,
  AGENT_TEAM_CONFIG_SCHEMA_VERSION,
  AGENT_TEAM_RESULTS_ARTIFACT_FILENAME,
  AGENT_TEAM_RESULTS_SCHEMA_VERSION,
  ALLOWED_AGENT_TEAM_OUTCOMES,
  type AgentHarnessExecutionGraph,
} from "../contracts/index.js";
import {
  AGENT_ROLE_PROFILE_REGISTRY,
  listAgentRoleProfiles,
} from "./agent-role-profile.js";
import { canonicalJson } from "./content-hash.js";
import {
  assertAgentHarnessExecutionGraphInvariants,
  buildAgentHarnessExecutionGraph,
  buildAgentTeamConfigArtifact,
  buildAgentTeamResultsArtifact,
  computeAgentHarnessResumePlan,
  serializeAgentHarnessExecutionGraph,
  writeAgentTeamConfigArtifact,
  writeAgentTeamResultsArtifact,
  type BuildAgentHarnessExecutionGraphInput,
} from "./agent-harness-execution-graph.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

const tinyGraphInput = (): BuildAgentHarnessExecutionGraphInput => ({
  jobId: "job-123",
  nodes: [
    {
      roleStepId: "job-123-generator-1",
      role: "generator",
      blocks: ["job-123-semantic-judge-1"],
      blockedBy: ["job-123-visual-sidecar-1"],
      requiredInputArtifacts: ["test-design-model.json"],
      producedArtifacts: ["generated-test-cases.json"],
      retryPolicy: "retry_from_checkpoint",
    },
    {
      roleStepId: "job-123-semantic-judge-1",
      role: "semantic_judge",
      blocks: [],
      blockedBy: ["job-123-generator-1"],
      requiredInputArtifacts: ["generated-test-cases.json"],
      producedArtifacts: ["judge-panel-verdict.json"],
      retryPolicy: "retry_transient_once",
    },
    {
      roleStepId: "job-123-visual-sidecar-1",
      role: "visual_sidecar",
      blocks: ["job-123-generator-1"],
      blockedBy: [],
      requiredInputArtifacts: [],
      producedArtifacts: ["visual-sidecar-result.json"],
      retryPolicy: "none",
    },
  ],
});

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(join(tmpdir(), "agent-team-"));
  try {
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

test("retry-policy vocabulary is closed and alphabetical", () => {
  assert.deepEqual([...AGENT_HARNESS_GRAPH_RETRY_POLICIES], [
    "none",
    "retry_from_checkpoint",
    "retry_transient_once",
  ]);
});

test("buildAgentHarnessExecutionGraph normalises and freezes a tiny DAG", () => {
  const graph = buildAgentHarnessExecutionGraph(tinyGraphInput());
  assert.equal(
    graph.schemaVersion,
    AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION,
  );
  assert.equal(graph.jobId, "job-123");
  assert.equal(graph.nodes.length, 3);

  // Sorted alphabetically by roleStepId.
  assert.deepEqual(
    graph.nodes.map((n) => n.roleStepId),
    [
      "job-123-generator-1",
      "job-123-semantic-judge-1",
      "job-123-visual-sidecar-1",
    ],
  );

  // graphHash is sha256 of canonicalJson(nodes).
  const expected = createHash("sha256")
    .update(canonicalJson(graph.nodes))
    .digest("hex");
  assert.equal(graph.graphHash, expected);

  // Frozen: cannot mutate nodes or arrays.
  assert.throws(() => {
    (graph as unknown as { jobId: string }).jobId = "other";
  });
  assert.throws(() => {
    (graph.nodes as unknown as string[]).push("nope");
  });
});

test("buildAgentHarnessExecutionGraph is byte-stable for byte-identical inputs", () => {
  const a = buildAgentHarnessExecutionGraph(tinyGraphInput());
  const b = buildAgentHarnessExecutionGraph(tinyGraphInput());
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.graphHash, b.graphHash);

  // Re-ordering edge inputs does not change graphHash because the
  // builder canonicalises edge / artifact lists.
  const reordered: BuildAgentHarnessExecutionGraphInput = {
    jobId: "job-123",
    nodes: [
      {
        ...tinyGraphInput().nodes[2]!,
        producedArtifacts: ["visual-sidecar-result.json"],
      },
      {
        ...tinyGraphInput().nodes[0]!,
        blocks: ["job-123-semantic-judge-1"],
        blockedBy: ["job-123-visual-sidecar-1"],
      },
      tinyGraphInput().nodes[1]!,
    ],
  };
  const c = buildAgentHarnessExecutionGraph(reordered);
  assert.equal(canonicalJson(a), canonicalJson(c));
  assert.equal(a.graphHash, c.graphHash);
});

test("buildAgentHarnessExecutionGraph rejects empty inputs", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({ jobId: "", nodes: tinyGraphInput().nodes }),
    /jobId/u,
  );
  assert.throws(
    () => buildAgentHarnessExecutionGraph({ jobId: "x", nodes: [] }),
    /nodes/u,
  );
});

test("buildAgentHarnessExecutionGraph rejects mirror-violating edges", () => {
  // a.blocks = [b], but b.blockedBy = [] — mirror invariant violated.
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: ["b"],
            blockedBy: [],
            retryPolicy: "none",
          },
          {
            roleStepId: "b",
            role: "semantic_judge",
            blocks: [],
            blockedBy: [],
            retryPolicy: "none",
          },
        ],
      }),
    /mirror/u,
  );
});

test("buildAgentHarnessExecutionGraph rejects unknown edge targets", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: ["ghost"],
            blockedBy: [],
            retryPolicy: "none",
          },
        ],
      }),
    /unknown/u,
  );
});

test("buildAgentHarnessExecutionGraph rejects self-references", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: ["a"],
            blockedBy: [],
            retryPolicy: "none",
          },
        ],
      }),
    /self/u,
  );
});

test("buildAgentHarnessExecutionGraph detects cycles", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: ["b"],
            blockedBy: ["b"],
            retryPolicy: "none",
          },
          {
            roleStepId: "b",
            role: "semantic_judge",
            blocks: ["a"],
            blockedBy: ["a"],
            retryPolicy: "none",
          },
        ],
      }),
    /cycle/u,
  );
});

test("buildAgentHarnessExecutionGraph rejects duplicate roleStepIds", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: [],
            blockedBy: [],
            retryPolicy: "none",
          },
          {
            roleStepId: "a",
            role: "semantic_judge",
            blocks: [],
            blockedBy: [],
            retryPolicy: "none",
          },
        ],
      }),
    /duplicate/u,
  );
});

test("buildAgentHarnessExecutionGraph rejects unknown roles and policies", () => {
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "not_a_role" as never,
            blocks: [],
            blockedBy: [],
            retryPolicy: "none",
          },
        ],
      }),
    /role/u,
  );
  assert.throws(
    () =>
      buildAgentHarnessExecutionGraph({
        jobId: "j",
        nodes: [
          {
            roleStepId: "a",
            role: "generator",
            blocks: [],
            blockedBy: [],
            retryPolicy: "loop_forever" as never,
          },
        ],
      }),
    /retryPolicy/u,
  );
});

test("assertAgentHarnessExecutionGraphInvariants flags graphHash mismatch", () => {
  const graph = buildAgentHarnessExecutionGraph(tinyGraphInput());
  const tampered: AgentHarnessExecutionGraph = {
    ...graph,
    graphHash: HEX_A,
  };
  assert.throws(
    () => assertAgentHarnessExecutionGraphInvariants(tampered),
    /graphHash/u,
  );
});

test("assertAgentHarnessExecutionGraphInvariants flags out-of-order nodes", () => {
  const graph = buildAgentHarnessExecutionGraph(tinyGraphInput());
  const reversedNodes = [...graph.nodes].reverse();
  const reversed: AgentHarnessExecutionGraph = {
    ...graph,
    nodes: reversedNodes,
    graphHash: createHash("sha256")
      .update(canonicalJson(reversedNodes))
      .digest("hex"),
  };
  assert.throws(
    () => assertAgentHarnessExecutionGraphInvariants(reversed),
    /sorted alphabetically/u,
  );
});

test("serializeAgentHarnessExecutionGraph round-trips via JSON.parse", () => {
  const graph = buildAgentHarnessExecutionGraph(tinyGraphInput());
  const text = serializeAgentHarnessExecutionGraph(graph);
  assert.match(text, /\n$/u);
  const parsed = JSON.parse(text) as AgentHarnessExecutionGraph;
  assert.equal(parsed.graphHash, graph.graphHash);
  assert.equal(parsed.nodes.length, graph.nodes.length);
});

test("computeAgentHarnessResumePlan partitions nodes by completion + dependency state", () => {
  const graph = buildAgentHarnessExecutionGraph(tinyGraphInput());

  const empty = computeAgentHarnessResumePlan(graph, new Set<string>());
  assert.deepEqual(empty.skip, []);
  assert.deepEqual(empty.runnable, ["job-123-visual-sidecar-1"]);
  assert.deepEqual(empty.blocked, [
    "job-123-generator-1",
    "job-123-semantic-judge-1",
  ]);
  assert.equal(
    empty.bucketByRoleStepId["job-123-visual-sidecar-1"],
    "runnable",
  );

  const visualDone = computeAgentHarnessResumePlan(
    graph,
    new Set(["job-123-visual-sidecar-1"]),
  );
  assert.deepEqual(visualDone.skip, ["job-123-visual-sidecar-1"]);
  assert.deepEqual(visualDone.runnable, ["job-123-generator-1"]);
  assert.deepEqual(visualDone.blocked, ["job-123-semantic-judge-1"]);

  const allDone = computeAgentHarnessResumePlan(
    graph,
    new Set(graph.nodes.map((n) => n.roleStepId)),
  );
  assert.equal(allDone.skip.length, 3);
  assert.equal(allDone.runnable.length, 0);
  assert.equal(allDone.blocked.length, 0);

  // Completed superset including unknown ids is tolerated.
  const withUnknown = computeAgentHarnessResumePlan(graph, [
    "job-123-visual-sidecar-1",
    "ghost",
  ]);
  assert.deepEqual(withUnknown.skip, ["job-123-visual-sidecar-1"]);
});

test("buildAgentTeamConfigArtifact pins schema, sorts profiles, validates hashes", () => {
  const profiles = listAgentRoleProfiles();
  const artifact = buildAgentTeamConfigArtifact({
    jobId: "job-team",
    profiles,
    graphHash: HEX_A,
    policyProfileHash: HEX_B,
  });
  assert.equal(artifact.schemaVersion, AGENT_TEAM_CONFIG_SCHEMA_VERSION);
  assert.equal(artifact.rawPromptsIncluded, false);
  assert.deepEqual(
    artifact.profiles.map((p) => p.role),
    [...profiles].map((p) => p.role).sort(),
  );

  assert.throws(
    () =>
      buildAgentTeamConfigArtifact({
        jobId: "job-team",
        profiles,
        graphHash: "not-hex",
        policyProfileHash: HEX_B,
      }),
    /graphHash/u,
  );
  assert.throws(
    () =>
      buildAgentTeamConfigArtifact({
        jobId: "job-team",
        profiles,
        graphHash: HEX_A,
        policyProfileHash: "short",
      }),
    /policyProfileHash/u,
  );
  assert.throws(
    () =>
      buildAgentTeamConfigArtifact({
        jobId: "job-team",
        profiles: [
          AGENT_ROLE_PROFILE_REGISTRY.generator,
          AGENT_ROLE_PROFILE_REGISTRY.generator,
        ],
        graphHash: HEX_A,
        policyProfileHash: HEX_B,
      }),
    /duplicate/u,
  );
});

test("buildAgentTeamResultsArtifact sums totals and sorts role-runs", () => {
  const artifact = buildAgentTeamResultsArtifact({
    jobId: "job-team",
    graphHash: HEX_C,
    outcome: "accepted",
    roleRuns: [
      {
        roleStepId: "job-team-semantic-judge-1",
        role: "semantic_judge",
        outcome: "accepted",
        errorClass: "none",
        mappedJobStatus: "completed",
        attemptsConsumed: 1,
        artifactHash: HEX_A,
        costsRollup: { inputTokens: 10, outputTokens: 5, totalLatencyMs: 25 },
      },
      {
        roleStepId: "job-team-generator-1",
        role: "generator",
        outcome: "needs_review",
        errorClass: "judge_rejection",
        mappedJobStatus: "partial",
        attemptsConsumed: 3,
        artifactHash: HEX_B,
        costsRollup: { inputTokens: 100, outputTokens: 200, totalLatencyMs: 50 },
      },
    ],
  });

  assert.equal(artifact.schemaVersion, AGENT_TEAM_RESULTS_SCHEMA_VERSION);
  assert.equal(artifact.rawPromptsIncluded, false);
  assert.deepEqual(
    artifact.roleRuns.map((r) => r.roleStepId),
    ["job-team-generator-1", "job-team-semantic-judge-1"],
  );
  assert.deepEqual(artifact.totalCost, {
    inputTokens: 110,
    outputTokens: 205,
    totalLatencyMs: 75,
  });
  assert.ok(
    (ALLOWED_AGENT_TEAM_OUTCOMES as readonly string[]).includes(
      artifact.outcome,
    ),
  );
});

test("buildAgentTeamResultsArtifact rejects bad inputs", () => {
  const baseRun = {
    roleStepId: "s",
    role: "generator" as const,
    outcome: "accepted" as const,
    errorClass: "none",
    mappedJobStatus: "completed" as const,
    attemptsConsumed: 1,
    artifactHash: HEX_A,
    costsRollup: { inputTokens: 0, outputTokens: 0, totalLatencyMs: 0 },
  };
  assert.throws(
    () =>
      buildAgentTeamResultsArtifact({
        jobId: "j",
        graphHash: "nope",
        outcome: "accepted",
        roleRuns: [baseRun],
      }),
    /graphHash/u,
  );
  assert.throws(
    () =>
      buildAgentTeamResultsArtifact({
        jobId: "j",
        graphHash: HEX_A,
        outcome: "weird" as never,
        roleRuns: [baseRun],
      }),
    /outcome/u,
  );
  assert.throws(
    () =>
      buildAgentTeamResultsArtifact({
        jobId: "j",
        graphHash: HEX_A,
        outcome: "accepted",
        roleRuns: [baseRun, baseRun],
      }),
    /duplicate/u,
  );
  assert.throws(
    () =>
      buildAgentTeamResultsArtifact({
        jobId: "j",
        graphHash: HEX_A,
        outcome: "accepted",
        roleRuns: [{ ...baseRun, attemptsConsumed: -1 }],
      }),
    /attemptsConsumed/u,
  );
  assert.throws(
    () =>
      buildAgentTeamResultsArtifact({
        jobId: "j",
        graphHash: HEX_A,
        outcome: "accepted",
        roleRuns: [{ ...baseRun, artifactHash: "boom" }],
      }),
    /artifactHash/u,
  );
});

test("writeAgentTeamConfigArtifact and writeAgentTeamResultsArtifact persist canonical bytes", async () => {
  await withRunDir(async (runDir) => {
    const profiles = listAgentRoleProfiles();
    const cfg = await writeAgentTeamConfigArtifact({
      runDir,
      jobId: "job-write",
      profiles,
      graphHash: HEX_A,
      policyProfileHash: HEX_B,
    });
    assert.equal(
      cfg.artifactPath,
      join(runDir, AGENT_TEAM_CONFIG_ARTIFACT_FILENAME),
    );
    const cfgBytes = await readFile(cfg.artifactPath, "utf8");
    assert.equal(cfgBytes, cfg.serialised);
    const cfgParsed = JSON.parse(cfgBytes) as { rawPromptsIncluded: false };
    assert.equal(cfgParsed.rawPromptsIncluded, false);

    const res = await writeAgentTeamResultsArtifact({
      runDir,
      jobId: "job-write",
      graphHash: HEX_A,
      outcome: "accepted",
      roleRuns: [
        {
          roleStepId: "job-write-generator-1",
          role: "generator",
          outcome: "accepted",
          errorClass: "none",
          mappedJobStatus: "completed",
          attemptsConsumed: 1,
          artifactHash: HEX_C,
          costsRollup: {
            inputTokens: 100,
            outputTokens: 50,
            totalLatencyMs: 25,
          },
        },
      ],
    });
    assert.equal(
      res.artifactPath,
      join(runDir, AGENT_TEAM_RESULTS_ARTIFACT_FILENAME),
    );
    const resBytes = await readFile(res.artifactPath, "utf8");
    assert.equal(resBytes, res.serialised);

    // Byte-stable: a second write with byte-identical inputs produces
    // the same serialised payload.
    const resTwo = await writeAgentTeamResultsArtifact({
      runDir: await mkdtemp(join(tmpdir(), "agent-team-2-")),
      jobId: "job-write",
      graphHash: HEX_A,
      outcome: "accepted",
      roleRuns: [
        {
          roleStepId: "job-write-generator-1",
          role: "generator",
          outcome: "accepted",
          errorClass: "none",
          mappedJobStatus: "completed",
          attemptsConsumed: 1,
          artifactHash: HEX_C,
          costsRollup: {
            inputTokens: 100,
            outputTokens: 50,
            totalLatencyMs: 25,
          },
        },
      ],
    });
    try {
      assert.equal(resTwo.serialised, res.serialised);
    } finally {
      await rm(resTwo.artifactPath.replace(/\/[^/]+$/u, ""), {
        recursive: true,
        force: true,
      });
    }
  });
});

test("team artifacts redact secrets — assert only hashes/metadata are present", () => {
  const artifact = buildAgentTeamConfigArtifact({
    jobId: "job-secret",
    profiles: listAgentRoleProfiles(),
    graphHash: HEX_A,
    policyProfileHash: HEX_B,
  });
  const text = canonicalJson(artifact);
  // No bearer tokens, raw prompts, or chain-of-thought sneak through.
  assert.doesNotMatch(text, /bearer/iu);
  assert.doesNotMatch(text, /password/iu);
  assert.doesNotMatch(text, /promptText/iu);
  assert.doesNotMatch(text, /chainOfThought/iu);
});
