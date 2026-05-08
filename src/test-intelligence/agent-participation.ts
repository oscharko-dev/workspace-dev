import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type AgentSourceLabel,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export const AGENT_PARTICIPATION_ARTIFACT_FILENAME =
  "agent-participation.json" as const;
export const AGENT_PARTICIPATION_SCHEMA_VERSION = "1.0.0" as const;

export const AGENT_PARTICIPATION_ROLES = [
  "action_topology",
  "generator",
  "logic_judge",
  "coverage_planner",
  "risk_ranker",
  "adversarial_critic",
  "visual_primary",
  "visual_fallback",
  "a11y_judge",
  "repair_planner",
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

export interface AgentParticipationArtifact {
  readonly schemaVersion: typeof AGENT_PARTICIPATION_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly roles: readonly AgentParticipationEntry[];
}

export interface BuildAgentParticipationArtifactInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly roles: readonly AgentParticipationEntry[];
}

export interface WriteAgentParticipationArtifactInput {
  readonly artifact: AgentParticipationArtifact;
  readonly destinationDir: string;
}

const roleRank = (role: AgentParticipationRole): number =>
  AGENT_PARTICIPATION_ROLES.indexOf(role);

export const buildAgentParticipationArtifact = (
  input: BuildAgentParticipationArtifactInput,
): AgentParticipationArtifact => ({
  schemaVersion: AGENT_PARTICIPATION_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  roles: [...input.roles]
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
    ),
});

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
