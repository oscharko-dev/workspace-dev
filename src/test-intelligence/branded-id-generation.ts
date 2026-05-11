import { randomBytes } from "node:crypto";

import { validateBrandedIdLabel } from "../contracts/branded-ids.js";
import type {
  AgentRoleProfileId,
  EvidenceArtifactId,
  JobId,
  LessonId,
  RoleStepId,
} from "../contracts/index.js";

const generateBrandedId = <T extends string>(label?: string): T => {
  const normalizedLabel = validateBrandedIdLabel(label);
  const suffix = randomBytes(8).toString("hex");
  return (
    normalizedLabel === null ? `wd-${suffix}` : `wd-${normalizedLabel}-${suffix}`
  ) as T;
};

export const generateJobId = (label?: string): JobId =>
  generateBrandedId<JobId>(label);
export const generateRoleStepId = (label?: string): RoleStepId =>
  generateBrandedId<RoleStepId>(label);
export const generateAgentRoleProfileId = (
  label?: string,
): AgentRoleProfileId => generateBrandedId<AgentRoleProfileId>(label);
export const generateEvidenceArtifactId = (
  label?: string,
): EvidenceArtifactId => generateBrandedId<EvidenceArtifactId>(label);
export const generateLessonId = (label?: string): LessonId =>
  generateBrandedId<LessonId>(label);
