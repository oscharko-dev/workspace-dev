import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type AgentSourceLabel,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { TaskClassificationDecision } from "./task-classifier-agent.js";

export const AGENT_PARTICIPATION_ARTIFACT_FILENAME =
  "agent-participation.json" as const;
/**
 * Schema version of the participation artifact. Bumped from `1.0.0`
 * to `1.2.0` for Issue #2028/#2043 — additive views now separate
 * workflow roles from deployed LLM sidecars while preserving the
 * canonical flat `roles` array.
 */
export const AGENT_PARTICIPATION_SCHEMA_VERSION = "1.2.0" as const;

export const AGENT_PARTICIPATION_ROLES = [
  "action_topology",
  "generator",
  "logic_judge",
  "judge_secondary",
  "coverage_planner",
  "risk_ranker",
  "adversarial_critic",
  "visual_primary",
  "visual_fallback",
  "a11y_judge",
  "repair_planner",
  "task_classifier",
  "test_generation_repair",
] as const;

export type AgentParticipationRole =
  (typeof AGENT_PARTICIPATION_ROLES)[number];

export const AGENT_PARTICIPATION_CONFIGURATION_SOURCES = [
  "cli",
  "env",
  "default",
  "disabled",
] as const;

export type AgentParticipationConfigurationSource =
  (typeof AGENT_PARTICIPATION_CONFIGURATION_SOURCES)[number];

export const AGENT_PARTICIPATION_STATUSES = [
  "not_configured",
  "skipped",
  "attempted",
  "succeeded",
  "failed",
] as const;

export type AgentParticipationStatus =
  (typeof AGENT_PARTICIPATION_STATUSES)[number];

export interface AgentParticipationCostAttribution {
  readonly sourceLabel?: AgentSourceLabel;
  readonly deployment?: string;
  readonly callCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly imageBytes: number;
  readonly durationMs: number;
  readonly estimatedCost: number;
}

export interface AgentParticipationEntry {
  readonly role: AgentParticipationRole;
  readonly deployment?: string;
  readonly configurationSource: AgentParticipationConfigurationSource;
  readonly status: AgentParticipationStatus;
  readonly attemptCount: number;
  readonly failureClass?: string;
  readonly remediation?: string;
  readonly artifactReferences: readonly string[];
  readonly costAttribution?: AgentParticipationCostAttribution;
}

/**
 * Persisted shape of a single routing decision (Issue #2043). Stored
 * alongside `roles` so an auditor can reconcile per-role costs with
 * the classifier's tier choice and rationale without reading any
 * other artifact.
 */
export interface AgentParticipationRoutingDecision {
  readonly taskId: string;
  readonly tier: TaskClassificationDecision["tier"];
  readonly resolvedTaskKind: TaskClassificationDecision["resolvedTaskKind"];
  readonly rationale: string;
  readonly classifierVersion: TaskClassificationDecision["classifierVersion"];
  readonly classifierRoleId: TaskClassificationDecision["classifierRoleId"];
  readonly signals: readonly string[];
  readonly role?: string;
}

export interface AgentParticipationArtifact {
  readonly schemaVersion: typeof AGENT_PARTICIPATION_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly roles: readonly AgentParticipationEntry[];
  readonly roleViews: {
    readonly workflowRoles: readonly AgentParticipationEntry[];
    readonly deployedLlmSidecars: readonly AgentParticipationEntry[];
  };
  /**
   * Optional routing decisions persisted for cost-aware routing
   * (Issue #2043). Omitted when the classifier did not run for this
   * job so the artifact byte-shape stays stable for legacy runs.
   */
  readonly routingDecisions?: readonly AgentParticipationRoutingDecision[];
}

export interface BuildAgentParticipationArtifactInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly roles: readonly AgentParticipationEntry[];
  readonly routingDecisions?: readonly TaskClassificationDecision[];
}

export interface WriteAgentParticipationArtifactInput {
  readonly artifact: AgentParticipationArtifact;
  readonly destinationDir: string;
}

const roleRank = (role: AgentParticipationRole): number =>
  AGENT_PARTICIPATION_ROLES.indexOf(role);

const DEPLOYED_LLM_SIDECAR_ROLES = new Set<AgentParticipationRole>([
  "generator",
  "logic_judge",
  "judge_secondary",
  "coverage_planner",
  "risk_ranker",
  "visual_primary",
  "visual_fallback",
  "a11y_judge",
  "adversarial_critic",
  "test_generation_repair",
]);

const normalizeRoutingDecisions = (
  decisions: readonly TaskClassificationDecision[] | undefined,
): readonly AgentParticipationRoutingDecision[] | undefined => {
  if (decisions === undefined) return undefined;
  if (decisions.length === 0) return undefined;
  const normalized: AgentParticipationRoutingDecision[] = decisions.map(
    (decision) => ({
      taskId: decision.taskId,
      tier: decision.tier,
      resolvedTaskKind: decision.resolvedTaskKind,
      rationale: decision.rationale,
      classifierVersion: decision.classifierVersion,
      classifierRoleId: decision.classifierRoleId,
      signals: [...decision.signals],
      ...(decision.role !== undefined ? { role: decision.role } : {}),
    }),
  );
  normalized.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return normalized;
};

export const buildAgentParticipationArtifact = (
  input: BuildAgentParticipationArtifactInput,
): AgentParticipationArtifact => {
  const normalizedRoles = [...input.roles]
    .map((entry) => ({
      role: entry.role,
      ...(entry.deployment !== undefined ? { deployment: entry.deployment } : {}),
      configurationSource: entry.configurationSource,
      status: entry.status,
      attemptCount: entry.attemptCount,
      ...(entry.failureClass !== undefined
        ? { failureClass: entry.failureClass }
        : {}),
      ...(entry.remediation !== undefined
        ? { remediation: entry.remediation }
        : {}),
      artifactReferences: [...new Set(entry.artifactReferences)].sort((a, b) =>
        a.localeCompare(b),
      ),
      ...(entry.costAttribution !== undefined
        ? {
            costAttribution: {
              ...(entry.costAttribution.sourceLabel !== undefined
                ? { sourceLabel: entry.costAttribution.sourceLabel }
                : {}),
              ...(entry.costAttribution.deployment !== undefined
                ? { deployment: entry.costAttribution.deployment }
                : {}),
              callCount: entry.costAttribution.callCount,
              inputTokens: entry.costAttribution.inputTokens,
              outputTokens: entry.costAttribution.outputTokens,
              imageBytes: entry.costAttribution.imageBytes,
              durationMs: entry.costAttribution.durationMs,
              estimatedCost: entry.costAttribution.estimatedCost,
            },
          }
        : {}),
    }))
    .sort(
      (left, right) =>
        roleRank(left.role) - roleRank(right.role) ||
        left.configurationSource.localeCompare(right.configurationSource) ||
        (left.deployment ?? "").localeCompare(right.deployment ?? ""),
    );

  return {
    schemaVersion: AGENT_PARTICIPATION_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    ...(normalizeRoutingDecisions(input.routingDecisions) !== undefined
      ? { routingDecisions: normalizeRoutingDecisions(input.routingDecisions)! }
      : {}),
    roles: normalizedRoles,
    roleViews: {
      workflowRoles: normalizedRoles,
      deployedLlmSidecars: normalizedRoles.filter((entry) =>
        DEPLOYED_LLM_SIDECAR_ROLES.has(entry.role),
      ),
    },
  };
};

export const writeAgentParticipationArtifact = async (
  input: WriteAgentParticipationArtifactInput,
): Promise<{ artifactPath: string; bytes: Uint8Array }> => {
  const artifactPath = join(
    input.destinationDir,
    AGENT_PARTICIPATION_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(input.artifact)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await mkdir(input.destinationDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, bytes };
};
