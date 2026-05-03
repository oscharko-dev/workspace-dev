export type JobId = string & { readonly __brand: "JobId" };
export type RoleStepId = string & { readonly __brand: "RoleStepId" };
export type AgentRoleProfileId = string & {
  readonly __brand: "AgentRoleProfileId";
};
export type EvidenceArtifactId = string & {
  readonly __brand: "EvidenceArtifactId";
};
export type LessonId = string & { readonly __brand: "LessonId" };

export const MAX_ROLE_LINEAGE_DEPTH = 10 as const;

const ID_BODY_RE = "[0-9a-f]{16}";
const LABEL_RE = "[a-z0-9]+(?:-[a-z0-9]+)*";
const BRANDED_ID_RE = new RegExp(
  `^wd-(?:${LABEL_RE}-)?${ID_BODY_RE}$`,
  "u",
);
const LABEL_ONLY_RE = new RegExp(`^${LABEL_RE}$`, "u");

const asBrand = <T extends string>(value: string): T => value as T;

const normalizeLabel = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return LABEL_ONLY_RE.test(trimmed) ? trimmed : null;
};

const toBrandedId = <T extends string>(value: string): T | null =>
  BRANDED_ID_RE.test(value) ? asBrand<T>(value) : null;

export const isBrandedId = (value: string): boolean => BRANDED_ID_RE.test(value);

export const toJobId = (value: string): JobId | null => toBrandedId<JobId>(value);
export const toRoleStepId = (value: string): RoleStepId | null =>
  toBrandedId<RoleStepId>(value);
export const toAgentRoleProfileId = (
  value: string,
): AgentRoleProfileId | null => toBrandedId<AgentRoleProfileId>(value);
export const toEvidenceArtifactId = (
  value: string,
): EvidenceArtifactId | null => toBrandedId<EvidenceArtifactId>(value);
export const toLessonId = (value: string): LessonId | null =>
  toBrandedId<LessonId>(value);

export const validateBrandedIdLabel = (value: string | undefined): string | null =>
  normalizeLabel(value);

export const isRoleLineageDepth = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_ROLE_LINEAGE_DEPTH;

export const assertRoleLineageDepth = (
  value: number | undefined,
  context: string,
): void => {
  if (value === undefined) {
    return;
  }
  if (!isRoleLineageDepth(value)) {
    throw new RangeError(
      `${context}: roleLineageDepth must be an integer in [0, ${MAX_ROLE_LINEAGE_DEPTH}]`,
    );
  }
};
