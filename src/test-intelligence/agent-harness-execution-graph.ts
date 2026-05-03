/**
 * Multi-agent harness execution graph + team artifacts (Issue #1781,
 * Story MA-3 #1758).
 *
 * The execution graph is a small adjacency-list DAG that the
 * Production Runner state machine consumes to drive role-step
 * ordering. It is *not* a workflow framework — there is no scheduler,
 * no trigger, no conditional. The graph is canonical-JSON-stable for
 * byte-identical inputs (ordering of nodes, edges, and artifact lists
 * is fixed alphabetically) so the resulting `graphHash` is suitable
 * for evidence anchoring and gateway idempotency keys.
 *
 * Resume contract: given an execution graph and the set of
 * `roleStepId`s already accepted by the harness on a previous run
 * (read from `<runDir>/agent-role-runs/<roleStepId>.json` checkpoints
 * by the caller), {@link computeAgentHarnessResumePlan} partitions the
 * graph into `skip`, `runnable`, and `blocked` buckets so that resume
 * never re-executes a completed step.
 *
 * Team artifacts:
 *
 *   - `<runDir>/agent-team-config.json` is written at run start. It
 *     pins the active profile registry (sorted alphabetically by
 *     role), the `graphHash`, and the operator's `policyProfileHash`.
 *   - `<runDir>/agent-team-results.json` is written at run end. It
 *     rolls up the harness step artifacts (only their hashes, terminal
 *     outcomes, error classes, attempt counts, and cost rollups) into
 *     a single anchor.
 *
 * Hard invariants on both artifacts:
 *
 *   - No raw prompts, no chain-of-thought, no model output bytes.
 *   - No secrets, ever — `rawPromptsIncluded: false` is a literal
 *     `false` field that documents the contract.
 *   - Hashes are 64-char lowercase hex (sha256). The validator
 *     refuses anything else.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION,
  AGENT_HARNESS_GRAPH_RETRY_POLICIES,
  AGENT_HARNESS_ROLES,
  AGENT_TEAM_CONFIG_ARTIFACT_FILENAME,
  AGENT_TEAM_CONFIG_SCHEMA_VERSION,
  AGENT_TEAM_RESULTS_ARTIFACT_FILENAME,
  AGENT_TEAM_RESULTS_SCHEMA_VERSION,
  ALLOWED_AGENT_TEAM_OUTCOMES,
  type AgentHarnessExecutionGraph,
  type AgentHarnessGraphNode,
  type AgentHarnessGraphRetryPolicy,
  type AgentHarnessRole,
  type AgentRoleProfile,
  type AgentTeamConfigArtifact,
  type AgentTeamOutcome,
  type AgentTeamResultsArtifact,
  type AgentTeamRoleRunSummary,
  type AgentTeamTotalCost,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const HEX_64 = /^[0-9a-f]{64}$/u;

const isHex64 = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);

const sortStrings = (values: readonly string[]): readonly string[] => {
  const next = [...values];
  next.sort();
  return Object.freeze(next);
};

const dedupSortedStrings = (
  values: readonly string[],
  where: string,
  field: string,
): readonly string[] => {
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(
        `${where}: ${field} entries must be non-empty strings`,
      );
    }
  }
  const sorted = sortStrings(values);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      throw new RangeError(
        `${where}: duplicate ${field} entry "${sorted[i] ?? ""}"`,
      );
    }
  }
  return sorted;
};

// ---------------------------------------------------------------------------
// buildAgentHarnessExecutionGraph
// ---------------------------------------------------------------------------

/**
 * Caller-provided shape for one node. The builder normalises the
 * input by sorting `blocks`, `blockedBy`, `requiredInputArtifacts`,
 * and `producedArtifacts` alphabetically and freezing the node so
 * every materialised graph is byte-stable for byte-identical inputs.
 */
export interface BuildAgentHarnessGraphNodeInput {
  readonly roleStepId: string;
  readonly role: AgentHarnessRole;
  readonly blocks?: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly requiredInputArtifacts?: readonly string[];
  readonly producedArtifacts?: readonly string[];
  readonly retryPolicy: AgentHarnessGraphRetryPolicy;
}

export interface BuildAgentHarnessExecutionGraphInput {
  readonly jobId: string;
  readonly nodes: readonly BuildAgentHarnessGraphNodeInput[];
}

const isAgentHarnessRole = (value: unknown): value is AgentHarnessRole =>
  typeof value === "string" &&
  (AGENT_HARNESS_ROLES as readonly string[]).includes(value);

const isAgentHarnessGraphRetryPolicy = (
  value: unknown,
): value is AgentHarnessGraphRetryPolicy =>
  typeof value === "string" &&
  (AGENT_HARNESS_GRAPH_RETRY_POLICIES as readonly string[]).includes(value);

const validateNodeInput = (
  input: BuildAgentHarnessGraphNodeInput,
  index: number,
): void => {
  const where = `buildAgentHarnessExecutionGraph: nodes[${index}]`;
  if (typeof input.roleStepId !== "string" || input.roleStepId.length === 0) {
    throw new TypeError(`${where}: roleStepId must be a non-empty string`);
  }
  if (!isAgentHarnessRole(input.role)) {
    throw new RangeError(
      `${where} (${input.roleStepId}): unknown role "${String(input.role)}"`,
    );
  }
  if (!isAgentHarnessGraphRetryPolicy(input.retryPolicy)) {
    throw new RangeError(
      `${where} (${input.roleStepId}): unknown retryPolicy "${String(
        input.retryPolicy,
      )}"`,
    );
  }
};

const freezeNode = (node: AgentHarnessGraphNode): AgentHarnessGraphNode =>
  Object.freeze({
    roleStepId: node.roleStepId,
    role: node.role,
    blocks: node.blocks,
    blockedBy: node.blockedBy,
    requiredInputArtifacts: node.requiredInputArtifacts,
    producedArtifacts: node.producedArtifacts,
    retryPolicy: node.retryPolicy,
  });

/**
 * Build an `AgentHarnessExecutionGraph` from caller-provided node
 * descriptors. The builder:
 *
 *   1. validates each node (role, retry policy, non-empty id),
 *   2. canonicalises edge / artifact lists (sorted, deduped, frozen),
 *   3. asserts the mirror invariant `a.blocks ⇔ b.blockedBy`,
 *   4. asserts the graph is acyclic,
 *   5. computes `graphHash = sha256(canonicalJson(nodes))`,
 *   6. returns a deeply-frozen graph.
 *
 * Calling the builder twice with byte-identical input always returns
 * graphs whose canonical-JSON representations are byte-identical.
 */
export const buildAgentHarnessExecutionGraph = (
  input: BuildAgentHarnessExecutionGraphInput,
): AgentHarnessExecutionGraph => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildAgentHarnessExecutionGraph: jobId must be a non-empty string",
    );
  }
  if (input.nodes.length === 0) {
    throw new TypeError(
      "buildAgentHarnessExecutionGraph: nodes must be a non-empty array",
    );
  }

  const rawNodes: readonly BuildAgentHarnessGraphNodeInput[] = input.nodes;
  for (let i = 0; i < rawNodes.length; i++) {
    const candidate = rawNodes[i];
    if (candidate === undefined) {
      throw new TypeError(
        `buildAgentHarnessExecutionGraph: nodes[${i}] is undefined`,
      );
    }
    validateNodeInput(candidate, i);
  }

  const seenRoleStepIds = new Set<string>();
  for (const node of rawNodes) {
    if (seenRoleStepIds.has(node.roleStepId)) {
      throw new RangeError(
        `buildAgentHarnessExecutionGraph: duplicate roleStepId "${node.roleStepId}"`,
      );
    }
    seenRoleStepIds.add(node.roleStepId);
  }

  const normalisedById = new Map<string, AgentHarnessGraphNode>();
  for (const raw of rawNodes) {
    const where = `buildAgentHarnessExecutionGraph: node "${raw.roleStepId}"`;
    const blocks = dedupSortedStrings(raw.blocks ?? [], where, "blocks");
    const blockedBy = dedupSortedStrings(
      raw.blockedBy ?? [],
      where,
      "blockedBy",
    );
    const requiredInputArtifacts = dedupSortedStrings(
      raw.requiredInputArtifacts ?? [],
      where,
      "requiredInputArtifacts",
    );
    const producedArtifacts = dedupSortedStrings(
      raw.producedArtifacts ?? [],
      where,
      "producedArtifacts",
    );

    if (blocks.includes(raw.roleStepId)) {
      throw new RangeError(`${where}: blocks may not reference self`);
    }
    if (blockedBy.includes(raw.roleStepId)) {
      throw new RangeError(`${where}: blockedBy may not reference self`);
    }

    normalisedById.set(
      raw.roleStepId,
      freezeNode({
        roleStepId: raw.roleStepId,
        role: raw.role,
        blocks,
        blockedBy,
        requiredInputArtifacts,
        producedArtifacts,
        retryPolicy: raw.retryPolicy,
      }),
    );
  }

  for (const node of normalisedById.values()) {
    for (const target of node.blocks) {
      if (!normalisedById.has(target)) {
        throw new RangeError(
          `buildAgentHarnessExecutionGraph: node "${node.roleStepId}" blocks unknown roleStepId "${target}"`,
        );
      }
      const downstream = normalisedById.get(target);
      if (downstream === undefined || !downstream.blockedBy.includes(node.roleStepId)) {
        throw new RangeError(
          `buildAgentHarnessExecutionGraph: edge mirror violated — "${node.roleStepId}" → "${target}" not present in target.blockedBy`,
        );
      }
    }
    for (const upstream of node.blockedBy) {
      if (!normalisedById.has(upstream)) {
        throw new RangeError(
          `buildAgentHarnessExecutionGraph: node "${node.roleStepId}" blockedBy unknown roleStepId "${upstream}"`,
        );
      }
      const upstreamNode = normalisedById.get(upstream);
      if (upstreamNode === undefined || !upstreamNode.blocks.includes(node.roleStepId)) {
        throw new RangeError(
          `buildAgentHarnessExecutionGraph: edge mirror violated — "${upstream}" → "${node.roleStepId}" not present in upstream.blocks`,
        );
      }
    }
  }

  const sortedIds = [...normalisedById.keys()].sort();
  const sortedNodes: readonly AgentHarnessGraphNode[] = Object.freeze(
    sortedIds.map((id) => normalisedById.get(id) as AgentHarnessGraphNode),
  );

  assertAcyclic(sortedNodes);

  const graphHash = createHash("sha256")
    .update(canonicalJson(sortedNodes))
    .digest("hex");

  const graph: AgentHarnessExecutionGraph = Object.freeze({
    schemaVersion: AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION,
    jobId: input.jobId,
    graphHash,
    nodes: sortedNodes,
  });
  return graph;
};

const assertAcyclic = (nodes: readonly AgentHarnessGraphNode[]): void => {
  const adjacency = new Map<string, readonly string[]>();
  for (const node of nodes) {
    adjacency.set(node.roleStepId, node.blocks);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of nodes) {
    colour.set(node.roleStepId, WHITE);
  }

  const visit = (id: string, stack: readonly string[]): void => {
    if (colour.get(id) === GRAY) {
      throw new RangeError(
        `buildAgentHarnessExecutionGraph: cycle detected via [${[
          ...stack,
          id,
        ].join(" -> ")}]`,
      );
    }
    if (colour.get(id) === BLACK) {
      return;
    }
    colour.set(id, GRAY);
    const next = adjacency.get(id) ?? [];
    for (const neighbour of next) {
      visit(neighbour, [...stack, id]);
    }
    colour.set(id, BLACK);
  };

  for (const node of nodes) {
    if (colour.get(node.roleStepId) === WHITE) {
      visit(node.roleStepId, []);
    }
  }
};

// ---------------------------------------------------------------------------
// assertAgentHarnessExecutionGraphInvariants
// ---------------------------------------------------------------------------

/**
 * Validate an already-materialised graph (e.g., reloaded from disk).
 * This is the boundary check the Production Runner runs on resume
 * before consuming any step. Throws on any structural violation;
 * does not mutate input.
 */
export const assertAgentHarnessExecutionGraphInvariants = (
  graph: AgentHarnessExecutionGraph,
): void => {
  const schemaVersion: string = graph.schemaVersion;
  if (schemaVersion !== AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION) {
    throw new TypeError(
      `AgentHarnessExecutionGraph: schemaVersion must be "${AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  if (typeof graph.jobId !== "string" || graph.jobId.length === 0) {
    throw new TypeError(
      "AgentHarnessExecutionGraph: jobId must be a non-empty string",
    );
  }
  if (!isHex64(graph.graphHash)) {
    throw new TypeError(
      "AgentHarnessExecutionGraph: graphHash must be a 64-char lowercase hex digest",
    );
  }
  if (graph.nodes.length === 0) {
    throw new TypeError(
      "AgentHarnessExecutionGraph: nodes must be a non-empty array",
    );
  }
  const nodes: readonly AgentHarnessGraphNode[] = graph.nodes;

  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    if (prev === undefined || cur === undefined) {
      throw new TypeError(
        `AgentHarnessExecutionGraph: nodes[${i - 1}] or nodes[${i}] is undefined`,
      );
    }
    if (prev.roleStepId >= cur.roleStepId) {
      throw new RangeError(
        `AgentHarnessExecutionGraph: nodes must be sorted alphabetically by roleStepId; "${prev.roleStepId}" before "${cur.roleStepId}"`,
      );
    }
  }

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.roleStepId)) {
      throw new RangeError(
        `AgentHarnessExecutionGraph: duplicate roleStepId "${node.roleStepId}"`,
      );
    }
    ids.add(node.roleStepId);
    if (!isAgentHarnessRole(node.role)) {
      throw new RangeError(
        `AgentHarnessExecutionGraph: node "${node.roleStepId}" has unknown role "${String(node.role)}"`,
      );
    }
    if (!isAgentHarnessGraphRetryPolicy(node.retryPolicy)) {
      throw new RangeError(
        `AgentHarnessExecutionGraph: node "${node.roleStepId}" has unknown retryPolicy "${String(node.retryPolicy)}"`,
      );
    }
  }

  const expectedHash = createHash("sha256")
    .update(canonicalJson(graph.nodes))
    .digest("hex");
  if (expectedHash !== graph.graphHash) {
    throw new RangeError(
      `AgentHarnessExecutionGraph: graphHash mismatch — expected ${expectedHash}, got ${graph.graphHash}`,
    );
  }
};

/**
 * Serialise an execution graph to canonical JSON (with trailing
 * newline). Round-tripping through `JSON.parse` yields a
 * structurally-equal graph, and the byte sequence is stable for
 * byte-identical inputs.
 */
export const serializeAgentHarnessExecutionGraph = (
  graph: AgentHarnessExecutionGraph,
): string => `${canonicalJson(graph)}\n`;

// ---------------------------------------------------------------------------
// computeAgentHarnessResumePlan
// ---------------------------------------------------------------------------

/**
 * Resume bucket for a single node, computed by
 * {@link computeAgentHarnessResumePlan}.
 *
 *   - `skip`     — already accepted by a previous run and not
 *                  scheduled for retry.
 *   - `runnable` — eligible to run now: every upstream `blockedBy` has
 *                  already been completed (or the node has no
 *                  upstreams).
 *   - `blocked`  — at least one upstream `blockedBy` has not yet been
 *                  completed.
 */
export type AgentHarnessResumeBucket = "blocked" | "runnable" | "skip";

export interface AgentHarnessResumePlan {
  readonly skip: readonly string[];
  readonly runnable: readonly string[];
  readonly blocked: readonly string[];
  readonly bucketByRoleStepId: Readonly<
    Record<string, AgentHarnessResumeBucket>
  >;
}

/**
 * Partition the graph into `skip` / `runnable` / `blocked` buckets
 * given the set of `roleStepId`s already completed by a previous
 * harness run (read from per-step checkpoint artifacts by the
 * caller). Already-completed steps are skipped; nodes whose
 * `blockedBy` set is fully covered by the completed set become
 * runnable; the rest stay blocked.
 *
 * The function is deterministic: the returned arrays are sorted
 * alphabetically. Unknown ids in `completedRoleStepIds` are
 * tolerated (the caller may pass a superset of the graph), but ids
 * that are only required to be in the *graph* are validated.
 */
export const computeAgentHarnessResumePlan = (
  graph: AgentHarnessExecutionGraph,
  completedRoleStepIds: ReadonlySet<string> | readonly string[],
): AgentHarnessResumePlan => {
  assertAgentHarnessExecutionGraphInvariants(graph);
  const completed =
    completedRoleStepIds instanceof Set
      ? completedRoleStepIds
      : new Set(completedRoleStepIds);

  const skip: string[] = [];
  const runnable: string[] = [];
  const blocked: string[] = [];
  const bucketByRoleStepId: Record<string, AgentHarnessResumeBucket> = {};

  for (const node of graph.nodes) {
    if (completed.has(node.roleStepId)) {
      skip.push(node.roleStepId);
      bucketByRoleStepId[node.roleStepId] = "skip";
      continue;
    }
    const upstreamPending = node.blockedBy.some(
      (upstream) => !completed.has(upstream),
    );
    if (upstreamPending) {
      blocked.push(node.roleStepId);
      bucketByRoleStepId[node.roleStepId] = "blocked";
    } else {
      runnable.push(node.roleStepId);
      bucketByRoleStepId[node.roleStepId] = "runnable";
    }
  }

  skip.sort();
  runnable.sort();
  blocked.sort();

  return Object.freeze({
    skip: Object.freeze(skip),
    runnable: Object.freeze(runnable),
    blocked: Object.freeze(blocked),
    bucketByRoleStepId: Object.freeze(bucketByRoleStepId),
  });
};

// ---------------------------------------------------------------------------
// Team artifacts
// ---------------------------------------------------------------------------

const isAgentTeamOutcome = (value: unknown): value is AgentTeamOutcome =>
  typeof value === "string" &&
  (ALLOWED_AGENT_TEAM_OUTCOMES as readonly string[]).includes(value);

const persistArtifact = async (
  runDir: string,
  filename: string,
  serialised: string,
): Promise<string> => {
  const finalPath = join(runDir, filename);
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(runDir, { recursive: true });
  await writeFile(tmpPath, serialised, "utf8");
  await rename(tmpPath, finalPath);
  return finalPath;
};

export interface BuildAgentTeamConfigInput {
  readonly jobId: string;
  readonly profiles: readonly AgentRoleProfile[];
  readonly graphHash: string;
  readonly policyProfileHash: string;
}

const sortProfilesByRole = (
  profiles: readonly AgentRoleProfile[],
): readonly AgentRoleProfile[] => {
  const next = [...profiles];
  next.sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
  return Object.freeze(next);
};

/**
 * Build a frozen, validated {@link AgentTeamConfigArtifact}. The
 * profiles are sorted alphabetically by role for canonical-JSON
 * stability; both hashes must be 64-char lowercase hex digests.
 */
export const buildAgentTeamConfigArtifact = (
  input: BuildAgentTeamConfigInput,
): AgentTeamConfigArtifact => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildAgentTeamConfigArtifact: jobId must be a non-empty string",
    );
  }
  if (input.profiles.length === 0) {
    throw new TypeError(
      "buildAgentTeamConfigArtifact: profiles must be a non-empty array",
    );
  }
  if (!isHex64(input.graphHash)) {
    throw new TypeError(
      "buildAgentTeamConfigArtifact: graphHash must be a 64-char lowercase hex digest",
    );
  }
  if (!isHex64(input.policyProfileHash)) {
    throw new TypeError(
      "buildAgentTeamConfigArtifact: policyProfileHash must be a 64-char lowercase hex digest",
    );
  }
  const profilesIn: readonly AgentRoleProfile[] = input.profiles;

  const seenRoles = new Set<string>();
  for (const profile of profilesIn) {
    if (!isAgentHarnessRole(profile.role)) {
      throw new RangeError(
        `buildAgentTeamConfigArtifact: unknown profile.role "${String(profile.role)}"`,
      );
    }
    if (seenRoles.has(profile.role)) {
      throw new RangeError(
        `buildAgentTeamConfigArtifact: duplicate profile for role "${profile.role}"`,
      );
    }
    seenRoles.add(profile.role);
  }

  const profiles = sortProfilesByRole(profilesIn);

  return Object.freeze({
    schemaVersion: AGENT_TEAM_CONFIG_SCHEMA_VERSION,
    jobId: input.jobId,
    profiles,
    graphHash: input.graphHash,
    policyProfileHash: input.policyProfileHash,
    rawPromptsIncluded: false,
  });
};

export interface WriteAgentTeamConfigInput extends BuildAgentTeamConfigInput {
  readonly runDir: string;
}

export interface WriteAgentTeamConfigResult {
  readonly artifact: AgentTeamConfigArtifact;
  readonly artifactPath: string;
  readonly serialised: string;
}

/**
 * Build, serialise, and atomically write an
 * {@link AgentTeamConfigArtifact} to
 * `<runDir>/agent-team-config.json`. Uses the same temp-file +
 * rename pattern as the per-step artifact writer so a crash never
 * leaves a half-written file behind.
 */
export const writeAgentTeamConfigArtifact = async (
  input: WriteAgentTeamConfigInput,
): Promise<WriteAgentTeamConfigResult> => {
  if (typeof input.runDir !== "string" || input.runDir.trim().length === 0) {
    throw new TypeError(
      "writeAgentTeamConfigArtifact: runDir must be a non-empty string",
    );
  }
  const artifact = buildAgentTeamConfigArtifact(input);
  const serialised = `${canonicalJson(artifact)}\n`;
  const artifactPath = await persistArtifact(
    input.runDir,
    AGENT_TEAM_CONFIG_ARTIFACT_FILENAME,
    serialised,
  );
  return { artifact, artifactPath, serialised };
};

export interface BuildAgentTeamRoleRunInput {
  readonly roleStepId: string;
  readonly role: AgentHarnessRole;
  readonly outcome: AgentTeamOutcome;
  readonly errorClass: string;
  readonly mappedJobStatus: AgentTeamRoleRunSummary["mappedJobStatus"];
  readonly attemptsConsumed: number;
  readonly artifactHash: string;
  readonly costsRollup: AgentTeamRoleRunSummary["costsRollup"];
}

export interface BuildAgentTeamResultsInput {
  readonly jobId: string;
  readonly graphHash: string;
  readonly outcome: AgentTeamOutcome;
  readonly roleRuns: readonly BuildAgentTeamRoleRunInput[];
}

const validateRoleRunInput = (
  input: BuildAgentTeamRoleRunInput,
  index: number,
): AgentTeamRoleRunSummary => {
  const where = `buildAgentTeamResultsArtifact: roleRuns[${index}]`;
  if (typeof input.roleStepId !== "string" || input.roleStepId.length === 0) {
    throw new TypeError(`${where}: roleStepId must be a non-empty string`);
  }
  if (!isAgentHarnessRole(input.role)) {
    throw new RangeError(
      `${where} (${input.roleStepId}): unknown role "${String(input.role)}"`,
    );
  }
  if (!isAgentTeamOutcome(input.outcome)) {
    throw new RangeError(
      `${where} (${input.roleStepId}): unknown outcome "${String(input.outcome)}"`,
    );
  }
  if (typeof input.errorClass !== "string" || input.errorClass.length === 0) {
    throw new TypeError(
      `${where} (${input.roleStepId}): errorClass must be a non-empty string`,
    );
  }
  const mappedJobStatus: string = input.mappedJobStatus;
  if (
    mappedJobStatus !== "completed" &&
    mappedJobStatus !== "failed" &&
    mappedJobStatus !== "partial"
  ) {
    throw new RangeError(
      `${where} (${input.roleStepId}): unknown mappedJobStatus "${mappedJobStatus}"`,
    );
  }
  if (
    !Number.isInteger(input.attemptsConsumed) ||
    input.attemptsConsumed < 0
  ) {
    throw new TypeError(
      `${where} (${input.roleStepId}): attemptsConsumed must be a non-negative integer`,
    );
  }
  if (!isHex64(input.artifactHash)) {
    throw new TypeError(
      `${where} (${input.roleStepId}): artifactHash must be a 64-char lowercase hex digest`,
    );
  }
  const cr = input.costsRollup;
  if (
    !Number.isInteger(cr.inputTokens) ||
    cr.inputTokens < 0 ||
    !Number.isInteger(cr.outputTokens) ||
    cr.outputTokens < 0 ||
    !Number.isInteger(cr.totalLatencyMs) ||
    cr.totalLatencyMs < 0
  ) {
    throw new TypeError(
      `${where} (${input.roleStepId}): costsRollup must contain non-negative integer fields {inputTokens, outputTokens, totalLatencyMs}`,
    );
  }

  return Object.freeze({
    roleStepId: input.roleStepId,
    role: input.role,
    outcome: input.outcome,
    errorClass: input.errorClass,
    mappedJobStatus: input.mappedJobStatus,
    attemptsConsumed: input.attemptsConsumed,
    artifactHash: input.artifactHash,
    costsRollup: Object.freeze({
      inputTokens: cr.inputTokens,
      outputTokens: cr.outputTokens,
      totalLatencyMs: cr.totalLatencyMs,
    }),
  });
};

const sumTotalCost = (
  runs: readonly AgentTeamRoleRunSummary[],
): AgentTeamTotalCost => {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalLatencyMs = 0;
  for (const run of runs) {
    inputTokens += run.costsRollup.inputTokens;
    outputTokens += run.costsRollup.outputTokens;
    totalLatencyMs += run.costsRollup.totalLatencyMs;
  }
  return Object.freeze({ inputTokens, outputTokens, totalLatencyMs });
};

/**
 * Build a frozen, validated {@link AgentTeamResultsArtifact}. Role
 * runs are sorted alphabetically by `roleStepId`; the total cost is
 * the unconditional sum of every role-run rollup. No raw prompts,
 * no chain-of-thought, no secrets are ever surfaced — the artifact
 * carries hashes and aggregates only.
 */
export const buildAgentTeamResultsArtifact = (
  input: BuildAgentTeamResultsInput,
): AgentTeamResultsArtifact => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildAgentTeamResultsArtifact: jobId must be a non-empty string",
    );
  }
  if (!isHex64(input.graphHash)) {
    throw new TypeError(
      "buildAgentTeamResultsArtifact: graphHash must be a 64-char lowercase hex digest",
    );
  }
  if (!isAgentTeamOutcome(input.outcome)) {
    throw new RangeError(
      `buildAgentTeamResultsArtifact: unknown outcome "${String(input.outcome)}"`,
    );
  }
  const roleRunsIn: readonly BuildAgentTeamRoleRunInput[] = input.roleRuns;
  const summaries = roleRunsIn.map((run, idx) =>
    validateRoleRunInput(run, idx),
  );
  const seenRoleStepIds = new Set<string>();
  for (const summary of summaries) {
    if (seenRoleStepIds.has(summary.roleStepId)) {
      throw new RangeError(
        `buildAgentTeamResultsArtifact: duplicate roleStepId "${summary.roleStepId}"`,
      );
    }
    seenRoleStepIds.add(summary.roleStepId);
  }

  summaries.sort((a, b) =>
    a.roleStepId < b.roleStepId ? -1 : a.roleStepId > b.roleStepId ? 1 : 0,
  );
  const frozenRuns: readonly AgentTeamRoleRunSummary[] =
    Object.freeze(summaries);
  const totalCost = sumTotalCost(frozenRuns);

  return Object.freeze({
    schemaVersion: AGENT_TEAM_RESULTS_SCHEMA_VERSION,
    jobId: input.jobId,
    graphHash: input.graphHash,
    outcome: input.outcome,
    roleRuns: frozenRuns,
    totalCost,
    rawPromptsIncluded: false,
  });
};

export interface WriteAgentTeamResultsInput
  extends BuildAgentTeamResultsInput {
  readonly runDir: string;
}

export interface WriteAgentTeamResultsResult {
  readonly artifact: AgentTeamResultsArtifact;
  readonly artifactPath: string;
  readonly serialised: string;
}

/**
 * Build, serialise, and atomically write an
 * {@link AgentTeamResultsArtifact} to
 * `<runDir>/agent-team-results.json`.
 */
export const writeAgentTeamResultsArtifact = async (
  input: WriteAgentTeamResultsInput,
): Promise<WriteAgentTeamResultsResult> => {
  if (typeof input.runDir !== "string" || input.runDir.trim().length === 0) {
    throw new TypeError(
      "writeAgentTeamResultsArtifact: runDir must be a non-empty string",
    );
  }
  const artifact = buildAgentTeamResultsArtifact(input);
  const serialised = `${canonicalJson(artifact)}\n`;
  const artifactPath = await persistArtifact(
    input.runDir,
    AGENT_TEAM_RESULTS_ARTIFACT_FILENAME,
    serialised,
  );
  return { artifact, artifactPath, serialised };
};
