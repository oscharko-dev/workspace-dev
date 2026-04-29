import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, win32 } from "node:path";

import {
  PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME,
  PIPELINE_QUALITY_PASSPORT_SCHEMA_VERSION,
  type WorkspaceFigmaSourceMode,
  type WorkspaceJobPipelineMetadata,
  type WorkspaceJobStageName,
  type WorkspaceJobStageStatus,
  type WorkspacePipelineQualityCoverageMetric,
  type WorkspacePipelineQualityGeneratedFile,
  type WorkspacePipelineQualityPassport,
  type WorkspacePipelineQualityValidationStatus,
  type WorkspacePipelineQualityWarning,
  type WorkspacePipelineQualityWarningSeverity,
  type WorkspacePipelineScope,
} from "../../contracts/index.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const CANONICAL_STAGE_ORDER: readonly WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr",
] as const;

const STAGE_ORDER_INDEX = new Map(
  CANONICAL_STAGE_ORDER.map((stage, index) => [stage, index] as const),
);

const WARNING_SEVERITY_ORDER: Record<
  WorkspacePipelineQualityWarningSeverity,
  number
> = {
  error: 0,
  warning: 1,
  info: 2,
};

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|credential|figmaAccessToken|llmApiKey|oauth|password|secret|token)/i;
const SECRET_VALUE_PATTERN = /^(?:bearer\s+)?(?:figd_|ghp_|github_pat_|sk-|xox[baprs]-)[^\s]+/i;
const SECRET_TEXT_PATTERN =
  /\b(?:bearer\s+)?(?:figd_|ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_./+=:-]+/gi;

export interface PipelineQualityGeneratedFileInput {
  path: string;
  content?: string | Uint8Array;
  sizeBytes?: number;
  sha256?: string;
}

export interface PipelineQualityCoverageInput {
  covered: number;
  total: number;
  status?: WorkspacePipelineQualityValidationStatus;
}

export interface PipelineQualityStageInput {
  name: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
}

export interface BuildPipelineQualityPassportInput {
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  sourceMode: WorkspaceFigmaSourceMode;
  scope: WorkspacePipelineScope;
  selectedNodeCount?: number;
  generatedFiles: readonly PipelineQualityGeneratedFileInput[];
  validationStages: readonly PipelineQualityStageInput[];
  tokenCoverage: PipelineQualityCoverageInput;
  semanticCoverage: PipelineQualityCoverageInput;
  warnings?: readonly Partial<WorkspacePipelineQualityWarning>[];
  metadata?: Record<string, unknown>;
}

const roundRatio = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const byteLength = (content: string | Uint8Array): number =>
  typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;

const sha256 = (content: string | Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

const isHexSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

const compareString = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const normalizeGeneratedPath = (value: string): string => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    posix.isAbsolute(normalized) ||
    win32.isAbsolute(normalized) ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new RangeError(`Generated file path '${value}' is not a safe relative path.`);
  }
  return normalized;
};

const normalizeGeneratedFile = (
  input: PipelineQualityGeneratedFileInput,
): WorkspacePipelineQualityGeneratedFile => {
  const path = normalizeGeneratedPath(input.path);
  const normalized: WorkspacePipelineQualityGeneratedFile = { path };
  if (input.content !== undefined) {
    normalized.sizeBytes = byteLength(input.content);
    normalized.sha256 = sha256(input.content);
    return normalized;
  }
  const sizeBytes = input.sizeBytes;
  if (
    typeof sizeBytes === "number" &&
    Number.isInteger(sizeBytes) &&
    sizeBytes >= 0
  ) {
    normalized.sizeBytes = sizeBytes;
  }
  if (typeof input.sha256 === "string" && isHexSha256(input.sha256)) {
    normalized.sha256 = input.sha256;
  }
  return normalized;
};

const normalizeGeneratedFiles = (
  files: readonly PipelineQualityGeneratedFileInput[],
): WorkspacePipelineQualityGeneratedFile[] => {
  const normalized = files
    .map(normalizeGeneratedFile)
    .sort((left, right) => compareString(left.path, right.path));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    if (previous.path === current.path) {
      throw new RangeError(
        `Generated file path '${current.path}' appears more than once in the quality passport.`,
      );
    }
  }
  return normalized;
};

const normalizeCoverage = (
  input: PipelineQualityCoverageInput,
): WorkspacePipelineQualityCoverageMetric => {
  const covered = Math.max(0, Math.trunc(input.covered));
  const total = Math.max(0, Math.trunc(input.total));
  const boundedCovered = Math.min(covered, total);
  const ratio = total === 0 ? 0 : roundRatio(boundedCovered / total);
  const status =
    input.status ??
    (total === 0
      ? "not_run"
      : boundedCovered >= total
        ? "passed"
        : boundedCovered > 0
          ? "warning"
          : "failed");

  return {
    status,
    covered: boundedCovered,
    total,
    ratio,
  };
};

const normalizeStageStatus = (
  stages: readonly PipelineQualityStageInput[],
): WorkspacePipelineQualityValidationStatus => {
  if (stages.length === 0) {
    return "not_run";
  }
  if (stages.some((stage) => stage.status === "failed")) {
    return "failed";
  }
  if (stages.some((stage) => stage.status === "skipped")) {
    return "warning";
  }
  return stages.every((stage) => stage.status === "completed")
    ? "passed"
    : "warning";
};

const normalizeStages = (
  stages: readonly PipelineQualityStageInput[],
): PipelineQualityStageInput[] =>
  [...stages].sort((left, right) => {
    const leftIndex = STAGE_ORDER_INDEX.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = STAGE_ORDER_INDEX.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || compareString(left.name, right.name);
  });

const normalizeWarningSeverity = (
  value: unknown,
): WorkspacePipelineQualityWarningSeverity =>
  value === "error" || value === "info" || value === "warning"
    ? value
    : "warning";

const redactSecretText = (value: string): string =>
  value.replace(SECRET_TEXT_PATTERN, "[REDACTED]");

const normalizeWarnings = (
  warnings: readonly Partial<WorkspacePipelineQualityWarning>[] | undefined,
): WorkspacePipelineQualityWarning[] => {
  const byKey = new Map<string, WorkspacePipelineQualityWarning>();
  for (const warning of warnings ?? []) {
    const code = typeof warning.code === "string" ? warning.code.trim() : "";
    const message =
      typeof warning.message === "string" ? warning.message.trim() : "";
    if (code.length === 0 || message.length === 0) {
      continue;
    }
    const normalized: WorkspacePipelineQualityWarning = {
      code: redactSecretText(code),
      severity: normalizeWarningSeverity(warning.severity),
      message: redactSecretText(message),
      ...(typeof warning.source === "string" && warning.source.trim().length > 0
        ? { source: redactSecretText(warning.source.trim()) }
        : {}),
    };
    byKey.set(
      `${normalized.severity}\0${normalized.code}\0${normalized.source ?? ""}\0${normalized.message}`,
      normalized,
    );
  }
  return [...byKey.values()].sort(
    (left, right) =>
      WARNING_SEVERITY_ORDER[left.severity] -
        WARNING_SEVERITY_ORDER[right.severity] ||
      compareString(left.code, right.code) ||
      compareString(left.source ?? "", right.source ?? "") ||
      compareString(left.message, right.message),
  );
};

const isSecretString = (value: string): boolean =>
  SECRET_VALUE_PATTERN.test(value.trim());

const toMetadataJsonValue = (
  value: unknown,
  keyPath: readonly string[],
): JsonValue | undefined => {
  const key = keyPath.at(-1) ?? "";
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return isSecretString(value) ? "[REDACTED]" : redactSecretText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => toMetadataJsonValue(entry, [...keyPath, String(index)]) ?? null);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const projected: { [key: string]: JsonValue } = {};
    for (const childKey of Object.keys(record).sort()) {
      const projectedValue = toMetadataJsonValue(record[childKey], [
        ...keyPath,
        childKey,
      ]);
      if (projectedValue !== undefined) {
        projected[childKey] = projectedValue;
      }
    }
    return projected;
  }
  return undefined;
};

export const projectQualityPassportMetadata = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const projected = toMetadataJsonValue(metadata ?? {}, ["metadata"]);
  return typeof projected === "object" && projected !== null && !Array.isArray(projected)
    ? projected
    : {};
};

const sortJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key] as JsonValue);
    }
    return sorted;
  }
  return value;
};

export const serializePipelineQualityPassport = (
  passport: WorkspacePipelineQualityPassport,
): string => `${JSON.stringify(sortJsonValue(passport as unknown as JsonValue))}\n`;

export const buildPipelineQualityPassport = ({
  pipelineMetadata,
  sourceMode,
  scope,
  selectedNodeCount = 0,
  generatedFiles,
  validationStages,
  tokenCoverage,
  semanticCoverage,
  warnings,
  metadata,
}: BuildPipelineQualityPassportInput): WorkspacePipelineQualityPassport => {
  const stages = normalizeStages(validationStages);
  return {
    schemaVersion: PIPELINE_QUALITY_PASSPORT_SCHEMA_VERSION,
    pipelineId: pipelineMetadata.pipelineId,
    templateBundleId: pipelineMetadata.templateBundleId,
    buildProfile: pipelineMetadata.buildProfile,
    scope: {
      sourceMode,
      scope,
      selectedNodeCount: Math.max(0, Math.trunc(selectedNodeCount)),
    },
    generatedFiles: normalizeGeneratedFiles(generatedFiles),
    validation: {
      status: normalizeStageStatus(stages),
      stages,
    },
    coverage: {
      token: normalizeCoverage(tokenCoverage),
      semantic: normalizeCoverage(semanticCoverage),
    },
    warnings: normalizeWarnings(warnings),
    metadata: projectQualityPassportMetadata(metadata),
  };
};

export const writePipelineQualityPassport = async ({
  passport,
  destinationDir,
}: {
  passport: WorkspacePipelineQualityPassport;
  destinationDir: string;
}): Promise<string> => {
  await mkdir(destinationDir, { recursive: true });
  const destination = join(
    destinationDir,
    PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME,
  );
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, serializePipelineQualityPassport(passport), "utf8");
  await rename(temporary, destination);
  return destination;
};
