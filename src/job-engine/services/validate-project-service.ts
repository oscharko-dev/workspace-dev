import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceVisualAuditResult } from "../../contracts/index.js";
import {
  prepareGenerationDiff,
  saveCurrentSnapshot,
  type GenerationDiffContext,
  writeGenerationDiffReport
} from "../generation-diff.js";
import {
  getUiGateReportPaths,
  runProjectValidation,
  type ProjectValidationResult
} from "../validation.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { createPipelineError } from "../errors.js";
import {
  validateCustomerProfileComponentApiComponentMatchReport,
  validateCustomerProfileComponentMatchReport,
  type CustomerProfileComponentApiValidationSummary,
  type CustomerProfileMatchValidationSummary,
  type CustomerProfileStyleValidationSummary,
  validateGeneratedProjectCustomerProfile,
  validateGeneratedProjectStorybookStyles,
  type CustomerProfileValidationSummary
} from "../../customer-profile-validation.js";
import {
  type ComponentMatchReportArtifact,
  type StorybookEvidenceArtifact,
  type StorybookPublicThemesArtifact,
  type StorybookPublicTokensArtifact
} from "../../storybook/types.js";
import {
  parseStorybookCatalogArtifact,
  parseStorybookComponentsArtifact,
  parseStorybookEvidenceArtifact,
  parseStorybookThemesArtifact,
  parseStorybookTokensArtifact
} from "../../storybook/artifact-validation.js";
import { isWithinRoot } from "../preview.js";
import { captureFromProject } from "../visual-capture.js";
import { comparePngBuffers, writeDiffImage } from "../visual-diff.js";
import { computeVisualQualityReport } from "../visual-scoring.js";

const isPerfValidationEnabled = (): boolean => {
  const raw = process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION ?? process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const isLintAutofixEnabled = (): boolean => {
  const raw = process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
};

interface ValidateProjectServiceDeps {
  runProjectValidationFn: typeof runProjectValidation;
  prepareGenerationDiffFn: typeof prepareGenerationDiff;
  writeGenerationDiffReportFn: typeof writeGenerationDiffReport;
  saveCurrentSnapshotFn: typeof saveCurrentSnapshot;
  captureFromProjectFn: typeof captureFromProject;
  comparePngBuffersFn: typeof comparePngBuffers;
  isLintAutofixEnabledFn: () => boolean;
  isPerfValidationEnabledFn: () => boolean;
}

type ValidationGateStatus = "ok" | "warn" | "failed" | "partial" | "not_available" | "not_requested";

interface ValidationArtifactStatusSummary {
  status: "ok" | "not_available" | "missing" | "invalid";
  filePath?: string;
}

interface ValidationFigmaLibraryResolutionSummary {
  total: number;
  resolved: number;
  partial: number;
  error: number;
  cacheHit: number;
  offlineReused: number;
  bySource: {
    live: number;
    cache: number;
    localCatalog: number;
  };
  entriesWithOriginFileKey: number;
}

interface ValidationFigmaLibraryResolutionStatusSummary extends ValidationArtifactStatusSummary {
  summary?: ValidationFigmaLibraryResolutionSummary;
}

interface ValidationStorybookArtifactSet {
  catalog: ValidationArtifactStatusSummary;
  evidence: ValidationArtifactStatusSummary;
  tokens: ValidationArtifactStatusSummary;
  themes: ValidationArtifactStatusSummary;
  components: ValidationArtifactStatusSummary;
}

interface ValidationStorybookCompositionCoverage {
  totalFigmaFamilies: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  docsOnlyReferenceCount: number;
  docsOnlyFamilyNames: string[];
}

interface ValidationUiA11yCheckSummary {
  name: string;
  status: "passed" | "failed";
  count: number;
  details?: string;
}

interface ValidationUiA11yReportSummary {
  status: "ok" | "warn";
  reportPath: string;
  visualDiffCount: number;
  a11yViolationCount: number;
  interactionViolationCount: number;
  checks: ValidationUiA11yCheckSummary[];
  artifacts: string[];
  summary?: string;
  diagnostics?: string[];
}

type ValidationUiA11ySummary =
  | ValidationUiA11yReportSummary
  | {
      status: "not_requested";
    }
  | {
      status: "not_available";
      reportPath?: string;
      summary?: string;
    };

interface ValidationSummaryArtifact {
  status: "ok" | "warn" | "failed";
  validatedAt: string;
  generatedApp:
    | {
        status: "ok";
        attempts: number;
        install: ProjectValidationResult["install"];
        lintAutofix?: ProjectValidationResult["lintAutofix"];
        lint: ProjectValidationResult["lint"];
        typecheck: ProjectValidationResult["typecheck"];
        build: ProjectValidationResult["build"];
        test?: ProjectValidationResult["test"];
        validateUi?: ProjectValidationResult["validateUi"];
        perfAssert?: ProjectValidationResult["perfAssert"];
      }
    | {
        status: "failed";
        failedCommand: string;
      }
    | {
        status: "not_available";
      };
  uiA11y: ValidationUiA11ySummary;
  visualAudit: WorkspaceVisualAuditResult;
  storybook:
    | {
        status: "ok" | "failed";
        requestedPath: string;
        artifacts: ValidationStorybookArtifactSet;
        composition?: ValidationStorybookCompositionCoverage;
      }
    | {
        status: "not_requested";
      };
  mapping: {
    status: "ok" | "warn" | "failed" | "partial" | "not_available";
    figmaLibraryResolution: ValidationFigmaLibraryResolutionStatusSummary;
    componentMatchReport: ValidationArtifactStatusSummary;
    customerProfileMatch:
      | {
          status: CustomerProfileMatchValidationSummary["status"];
          policy: CustomerProfileMatchValidationSummary["policy"];
          issueCount: number;
          counts: CustomerProfileMatchValidationSummary["counts"];
          issues: CustomerProfileMatchValidationSummary["issues"];
        }
      | {
          status: "not_available";
        };
    componentApi:
      | {
          status: CustomerProfileComponentApiValidationSummary["status"];
          issueCount: number;
          counts: CustomerProfileComponentApiValidationSummary["counts"];
          issues: CustomerProfileComponentApiValidationSummary["issues"];
        }
      | {
          status: "not_available";
        };
  };
  style: {
    status: CustomerProfileStyleValidationSummary["status"];
    issueCount: number;
    issues: CustomerProfileStyleValidationSummary["issues"];
    diagnostics: CustomerProfileStyleValidationSummary["diagnostics"];
    policy?: CustomerProfileStyleValidationSummary["policy"];
    storybook: {
      evidence: ValidationArtifactStatusSummary;
      tokens: ValidationArtifactStatusSummary;
      themes: ValidationArtifactStatusSummary;
      componentMatchReport: ValidationArtifactStatusSummary;
    };
    customerProfile?: {
      tokenPolicy: CustomerProfileValidationSummary["token"]["policy"];
      matchPolicy: CustomerProfileValidationSummary["match"]["policy"];
    };
  };
  import:
    | {
        status: CustomerProfileValidationSummary["status"];
        customerProfile: CustomerProfileValidationSummary;
      }
    | {
        status: "not_available";
  };
}

type StorybookArtifactKey = keyof ValidationStorybookArtifactSet;

type StorybookArtifactDescriptor = {
  key: StorybookArtifactKey;
  label: string;
};

const STORYBOOK_ARTIFACT_DESCRIPTORS: StorybookArtifactDescriptor[] = [
  {
    key: "catalog",
    label: "storybook.catalog"
  },
  {
    key: "evidence",
    label: "storybook.evidence"
  },
  {
    key: "tokens",
    label: "storybook.tokens"
  },
  {
    key: "themes",
    label: "storybook.themes"
  },
  {
    key: "components",
    label: "storybook.components"
  }
];

const isFailedValidationArtifactStatus = (
  status: ValidationArtifactStatusSummary["status"]
): status is "missing" | "invalid" => {
  return status === "missing" || status === "invalid";
};

const listFailedStorybookArtifacts = ({
  artifacts
}: {
  artifacts: ValidationStorybookArtifactSet;
}): Array<StorybookArtifactDescriptor & { status: "missing" | "invalid"; filePath?: string }> => {
  const failedArtifacts: Array<StorybookArtifactDescriptor & { status: "missing" | "invalid"; filePath?: string }> = [];
  for (const descriptor of STORYBOOK_ARTIFACT_DESCRIPTORS) {
    const artifact = artifacts[descriptor.key];
    if (!isFailedValidationArtifactStatus(artifact.status)) {
      continue;
    }
    const status: "missing" | "invalid" = artifact.status;
    failedArtifacts.push({
      ...descriptor,
      status,
      ...(artifact.filePath ? { filePath: artifact.filePath } : {})
    });
  }
  return failedArtifacts;
};

const buildStorybookGateMessage = ({
  artifacts
}: {
  artifacts: Array<StorybookArtifactDescriptor & { status: "missing" | "invalid" }>;
}): string => {
  return (
    "Storybook validation gate failed because required artifacts are missing or invalid: " +
    artifacts.map((artifact) => `${artifact.label} (${artifact.status})`).join(", ") +
    "."
  );
};

const buildStorybookGateDiagnostics = ({
  artifacts
}: {
  artifacts: Array<StorybookArtifactDescriptor & { status: "missing" | "invalid"; filePath?: string }>;
}) => {
  return artifacts.map((artifact) => ({
    code:
      artifact.status === "invalid"
        ? "STORYBOOK_STYLE_ARTIFACT_INVALID"
        : "STORYBOOK_STYLE_ARTIFACT_MISSING",
    message:
      artifact.status === "invalid"
        ? `Required Storybook artifact '${artifact.label}' is unreadable or malformed.`
        : `Required Storybook artifact '${artifact.label}' is missing from validate.project inputs.`,
    suggestion:
      "Generate and persist the Storybook catalog, evidence, tokens, themes, and components artifacts before validate.project runs.",
    stage: "validate.project" as const,
    severity: "error" as const,
    details: {
      artifactKey: artifact.label,
      ...(artifact.filePath ? { filePath: artifact.filePath } : {})
    }
  }));
};

const buildStorybookCompositionCoverage = ({
  artifact
}: {
  artifact: ComponentMatchReportArtifact;
}): ValidationStorybookCompositionCoverage => {
  const docsOnlyFamilyNames: string[] = [];
  for (const entry of artifact.entries) {
    if (entry.match.status !== "matched") {
      continue;
    }
    const hasAuthoritativeEvidence = entry.usedEvidence.some(
      (evidence) => evidence.reliability === "authoritative"
    );
    if (!hasAuthoritativeEvidence && entry.usedEvidence.length > 0) {
      docsOnlyFamilyNames.push(entry.figma.familyName);
    }
  }

  return {
    totalFigmaFamilies: artifact.summary.totalFigmaFamilies,
    matched: artifact.summary.matched,
    ambiguous: artifact.summary.ambiguous,
    unmatched: artifact.summary.unmatched,
    docsOnlyReferenceCount: docsOnlyFamilyNames.length,
    docsOnlyFamilyNames: docsOnlyFamilyNames.sort((a, b) => a.localeCompare(b))
  };
};

const toJsonFileContent = (value: unknown): string => {
  return `${JSON.stringify(value, null, 2)}\n`;
};

const cloneVisualAuditResult = (value: WorkspaceVisualAuditResult): WorkspaceVisualAuditResult => {
  return {
    ...value,
    ...(value.regions
      ? {
          regions: value.regions.map((region) => ({ ...region }))
        }
      : {}),
    ...(value.warnings ? { warnings: [...value.warnings] } : {})
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toUiA11yWarnSummary = ({
  reportPath,
  summary,
  diagnostics
}: {
  reportPath: string;
  summary: string;
  diagnostics?: string[];
}): ValidationUiA11yReportSummary => {
  return {
    status: "warn",
    reportPath,
    visualDiffCount: 0,
    a11yViolationCount: 0,
    interactionViolationCount: 0,
    checks: [],
    artifacts: [],
    summary,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {})
  };
};

const parseUiA11yCheckSummary = ({
  input
}: {
  input: unknown;
}): ValidationUiA11yCheckSummary | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) {
    return undefined;
  }

  const statusRaw = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  if (statusRaw !== "passed" && statusRaw !== "failed") {
    return undefined;
  }

  const count = typeof input.count === "number" && Number.isFinite(input.count) ? Math.max(0, Math.trunc(input.count)) : 0;
  return {
    name,
    status: statusRaw,
    count,
    ...(typeof input.details === "string" && input.details.trim().length > 0 ? { details: input.details.trim() } : {})
  };
};

const parseUiA11yReportSummary = ({
  input,
  reportPath
}: {
  input: string;
  reportPath: string;
}): ValidationUiA11yReportSummary => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("Expected ui-gate report to be a JSON object.");
  }

  const diagnostics: string[] = [];
  const toViolationCount = ({
    key,
    value
  }: {
    key: "visualDiffCount" | "a11yViolationCount" | "interactionViolationCount";
    value: unknown;
  }): number => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
    diagnostics.push(`Expected '${key}' to be a non-negative number.`);
    return 0;
  };

  const visualDiffCount = toViolationCount({
    key: "visualDiffCount",
    value: parsed.visualDiffCount
  });
  const a11yViolationCount = toViolationCount({
    key: "a11yViolationCount",
    value: parsed.a11yViolationCount
  });
  const interactionViolationCount = toViolationCount({
    key: "interactionViolationCount",
    value: parsed.interactionViolationCount
  });

  const checks = Array.isArray(parsed.checks)
    ? parsed.checks
        .map((entry) => parseUiA11yCheckSummary({ input: entry }))
        .filter((entry): entry is ValidationUiA11yCheckSummary => entry !== undefined)
    : [];
  if (!Array.isArray(parsed.checks)) {
    diagnostics.push("Expected 'checks' to be an array.");
  }

  const artifacts = Array.isArray(parsed.artifacts)
    ? [...new Set(
        parsed.artifacts
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      )]
    : [];
  if (!Array.isArray(parsed.artifacts)) {
    diagnostics.push("Expected 'artifacts' to be an array.");
  }

  const hasFailedChecks = checks.some((entry) => entry.status === "failed");
  const hasViolationCounts = visualDiffCount > 0 || a11yViolationCount > 0 || interactionViolationCount > 0;
  const status: ValidationUiA11yReportSummary["status"] =
    hasFailedChecks || hasViolationCounts || diagnostics.length > 0 ? "warn" : "ok";

  return {
    status,
    reportPath,
    visualDiffCount,
    a11yViolationCount,
    interactionViolationCount,
    checks,
    artifacts,
    ...(typeof parsed.summary === "string" && parsed.summary.trim().length > 0 ? { summary: parsed.summary.trim() } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {})
  };
};

const buildUiA11ySummary = async ({
  context,
  validationResult
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validationResult?: ProjectValidationResult;
}): Promise<ValidationUiA11ySummary> => {
  if (!context.runtime.enableUiValidation) {
    return {
      status: "not_requested"
    };
  }

  const { reportPath } = getUiGateReportPaths({
    jobDir: context.paths.jobDir
  });
  if (!validationResult?.validateUi) {
    return {
      status: "not_available",
      reportPath,
      summary: "UI/A11y validation did not run; ui-gate report is not available."
    };
  }

  let reportInput: string;
  try {
    reportInput = await readFile(reportPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toUiA11yWarnSummary({
      reportPath,
      summary: "UI/A11y validation ran but ui-gate report is missing or unreadable.",
      diagnostics: [message]
    });
  }

  try {
    return parseUiA11yReportSummary({
      input: reportInput,
      reportPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toUiA11yWarnSummary({
      reportPath,
      summary: "UI/A11y validation produced a malformed ui-gate report.",
      diagnostics: [message]
    });
  }
};

const parseComponentMatchReportArtifact = ({
  input
}: {
  input: string;
}): ComponentMatchReportArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("artifact" in parsed) ||
    (parsed as Record<string, unknown>).artifact !== "component.match_report" ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error("Expected a component.match_report artifact with an entries array.");
  }
  return parsed as ComponentMatchReportArtifact;
};

const parseFigmaLibraryResolutionSummary = ({
  input
}: {
  input: string;
}): ValidationFigmaLibraryResolutionSummary => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || parsed.artifact !== "figma.library_resolution" || !Array.isArray(parsed.entries) || !isRecord(parsed.summary)) {
    throw new Error("Expected a figma.library_resolution artifact with entries and summary.");
  }
  const summary = parsed.summary;

  const numericField = (
    key: "total" | "resolved" | "partial" | "error" | "cacheHit" | "offlineReused"
  ): number => {
    const value = summary[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  let live = 0;
  let cache = 0;
  let localCatalog = 0;
  let entriesWithOriginFileKey = 0;
  for (const entry of parsed.entries) {
    if (!isRecord(entry)) {
      continue;
    }
    const resolutionSource = typeof entry.resolutionSource === "string" ? entry.resolutionSource : "";
    if (resolutionSource === "live") {
      live += 1;
    } else if (resolutionSource === "cache") {
      cache += 1;
    } else if (resolutionSource === "local_catalog") {
      localCatalog += 1;
    }
    if (typeof entry.originFileKey === "string" && entry.originFileKey.trim().length > 0) {
      entriesWithOriginFileKey += 1;
    }
  }

  return {
    total: numericField("total"),
    resolved: numericField("resolved"),
    partial: numericField("partial"),
    error: numericField("error"),
    cacheHit: numericField("cacheHit"),
    offlineReused: numericField("offlineReused"),
    bySource: {
      live,
      cache,
      localCatalog
    },
    entriesWithOriginFileKey
  };
};

const extractFailedCommandFromPipelineError = (error: unknown): string => {
  if (!isRecord(error)) {
    return "unknown";
  }
  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "unknown";
  }
  const firstDiagnostic: unknown = diagnostics[0];
  if (!isRecord(firstDiagnostic)) {
    return "unknown";
  }
  const details = firstDiagnostic.details;
  if (!isRecord(details)) {
    return "unknown";
  }
  const command = details.command;
  if (typeof command === "string" && command.trim().length > 0) {
    return command;
  }
  return "unknown";
};

const resolveSummaryStatus = ({
  generatedApp,
  uiA11y,
  visualAudit,
  storybook,
  mapping,
  style,
  importSummary
}: {
  generatedApp: ValidationSummaryArtifact["generatedApp"];
  uiA11y: ValidationSummaryArtifact["uiA11y"];
  visualAudit: ValidationSummaryArtifact["visualAudit"];
  storybook: ValidationSummaryArtifact["storybook"];
  mapping: ValidationSummaryArtifact["mapping"];
  style: ValidationSummaryArtifact["style"];
  importSummary: ValidationSummaryArtifact["import"];
}): ValidationSummaryArtifact["status"] => {
  const gateStatuses: ValidationGateStatus[] = [
    generatedApp.status,
    uiA11y.status,
    visualAudit.status,
    storybook.status,
    mapping.status,
    style.status,
    importSummary.status
  ];
  if (gateStatuses.includes("failed")) {
    return "failed";
  }
  if (gateStatuses.includes("warn") || gateStatuses.includes("partial")) {
    return "warn";
  }
  return "ok";
};

const toArtifactStatusSummary = (filePath: string | undefined): ValidationArtifactStatusSummary => {
  return filePath
    ? {
        status: "ok",
        filePath
      }
    : {
        status: "not_available"
    };
};

const toFigmaLibraryResolutionStatusSummary = async ({
  filePath
}: {
  filePath: string | undefined;
}): Promise<ValidationFigmaLibraryResolutionStatusSummary> => {
  if (!filePath) {
    return {
      status: "not_available"
    };
  }

  let input: string;
  try {
    input = await readFile(filePath, "utf8");
  } catch {
    return {
      status: "missing"
    };
  }

  try {
    return {
      status: "ok",
      filePath,
      summary: parseFigmaLibraryResolutionSummary({
        input
      })
    };
  } catch {
    return {
      status: "ok",
      filePath
    };
  }
};

const persistValidationSummaryArtifacts = async ({
  context,
  summary
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  summary: ValidationSummaryArtifact;
}): Promise<string> => {
  const validationSummaryFilePath = path.join(context.paths.jobDir, "validation-summary.json");
  await writeFile(validationSummaryFilePath, toJsonFileContent(summary), "utf8");
  await context.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.validationSummary,
    stage: "validate.project",
    value: summary
  });
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.validationSummaryFile,
    stage: "validate.project",
    absolutePath: validationSummaryFilePath
  });
  return validationSummaryFilePath;
};

const buildValidationSummaryArtifact = async ({
  context,
  validatedAt,
  validationResult,
  generatedAppFailure,
  customerProfileImportSummary,
  customerProfileMatchSummary,
  customerProfileComponentApiSummary,
  customerProfileStyleSummary,
  componentMatchReportArtifact,
  storybookArtifactStatusOverrides,
  visualAuditResult
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validatedAt: string;
  validationResult?: ProjectValidationResult;
  generatedAppFailure?: { failedCommand: string };
  customerProfileImportSummary?: CustomerProfileValidationSummary;
  customerProfileMatchSummary?: CustomerProfileMatchValidationSummary;
  customerProfileComponentApiSummary?: CustomerProfileComponentApiValidationSummary;
  customerProfileStyleSummary?: CustomerProfileStyleValidationSummary;
  componentMatchReportArtifact?: ComponentMatchReportArtifact;
  storybookArtifactStatusOverrides?: Partial<Record<StorybookArtifactKey, ValidationArtifactStatusSummary["status"]>>;
  visualAuditResult?: WorkspaceVisualAuditResult;
}): Promise<ValidationSummaryArtifact> => {
  const storybookCatalogFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookCatalog);
  const storybookEvidenceFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence);
  const storybookTokensFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens);
  const storybookThemesFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes);
  const storybookComponentsFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookComponents);
  const figmaLibraryResolutionFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution);
  const componentMatchReportFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
  const figmaLibraryResolutionSummary = await toFigmaLibraryResolutionStatusSummary({
    filePath: figmaLibraryResolutionFile
  });

  const requestedStorybookStaticDir = context.requestedStorybookStaticDir;
  const toRequiredStorybookArtifactStatus = ({
    filePath,
    overrideStatus
  }: {
    filePath: string | undefined;
    overrideStatus?: ValidationArtifactStatusSummary["status"];
  }): ValidationArtifactStatusSummary => {
    if (overrideStatus) {
      return {
        status: overrideStatus,
        ...(filePath ? { filePath } : {})
      };
    }
    return filePath
      ? {
          status: "ok",
          filePath
        }
      : {
          status: "missing"
        };
  };
  const storybookArtifacts: ValidationStorybookArtifactSet = {
    catalog: toRequiredStorybookArtifactStatus({
      filePath: storybookCatalogFile,
      ...(storybookArtifactStatusOverrides?.catalog ? { overrideStatus: storybookArtifactStatusOverrides.catalog } : {})
    }),
    evidence: toRequiredStorybookArtifactStatus({
      filePath: storybookEvidenceFile,
      ...(storybookArtifactStatusOverrides?.evidence ? { overrideStatus: storybookArtifactStatusOverrides.evidence } : {})
    }),
    tokens: toRequiredStorybookArtifactStatus({
      filePath: storybookTokensFile,
      ...(storybookArtifactStatusOverrides?.tokens ? { overrideStatus: storybookArtifactStatusOverrides.tokens } : {})
    }),
    themes: toRequiredStorybookArtifactStatus({
      filePath: storybookThemesFile,
      ...(storybookArtifactStatusOverrides?.themes ? { overrideStatus: storybookArtifactStatusOverrides.themes } : {})
    }),
    components: toRequiredStorybookArtifactStatus({
      filePath: storybookComponentsFile,
      ...(storybookArtifactStatusOverrides?.components ? { overrideStatus: storybookArtifactStatusOverrides.components } : {})
    })
  };

  const compositionCoverage = componentMatchReportArtifact
    ? buildStorybookCompositionCoverage({ artifact: componentMatchReportArtifact })
    : undefined;
  const styleStorybookArtifacts = requestedStorybookStaticDir
    ? {
        evidence: storybookArtifacts.evidence,
        tokens: storybookArtifacts.tokens,
        themes: storybookArtifacts.themes
      }
    : {
        evidence: toArtifactStatusSummary(storybookEvidenceFile),
        tokens: toArtifactStatusSummary(storybookTokensFile),
        themes: toArtifactStatusSummary(storybookThemesFile)
      };

  const storybookSummary: ValidationSummaryArtifact["storybook"] = requestedStorybookStaticDir
    ? {
        status: listFailedStorybookArtifacts({ artifacts: storybookArtifacts }).length === 0 ? "ok" : "failed",
        requestedPath: requestedStorybookStaticDir,
        artifacts: storybookArtifacts,
        ...(compositionCoverage ? { composition: compositionCoverage } : {})
      }
    : {
        status: "not_requested"
      };

  const mappingSummary: ValidationSummaryArtifact["mapping"] = {
    status: customerProfileMatchSummary || customerProfileComponentApiSummary
      ? ([customerProfileMatchSummary?.status, customerProfileComponentApiSummary?.status].includes("failed")
          ? "failed"
          : [customerProfileMatchSummary?.status, customerProfileComponentApiSummary?.status].includes("warn")
            ? "warn"
            : "ok")
      : componentMatchReportFile
        ? "ok"
        : figmaLibraryResolutionFile
          ? "partial"
          : "not_available",
    figmaLibraryResolution: figmaLibraryResolutionSummary,
    componentMatchReport: toArtifactStatusSummary(componentMatchReportFile),
    customerProfileMatch: customerProfileMatchSummary
      ? {
          status: customerProfileMatchSummary.status,
          policy: customerProfileMatchSummary.policy,
          issueCount: customerProfileMatchSummary.issueCount,
          counts: customerProfileMatchSummary.counts,
          issues: customerProfileMatchSummary.issues
        }
      : {
          status: "not_available"
        },
    componentApi: customerProfileComponentApiSummary
      ? {
          status: customerProfileComponentApiSummary.status,
          issueCount: customerProfileComponentApiSummary.issueCount,
          counts: customerProfileComponentApiSummary.counts,
          issues: customerProfileComponentApiSummary.issues
        }
      : {
          status: "not_available"
        }
  };

  const styleSummary: ValidationSummaryArtifact["style"] =
    customerProfileStyleSummary
      ? {
          status: customerProfileStyleSummary.status,
          issueCount: customerProfileStyleSummary.issueCount,
          issues: customerProfileStyleSummary.issues,
          diagnostics: customerProfileStyleSummary.diagnostics,
          policy: customerProfileStyleSummary.policy,
          storybook: {
            evidence: styleStorybookArtifacts.evidence,
            tokens: styleStorybookArtifacts.tokens,
            themes: styleStorybookArtifacts.themes,
            componentMatchReport: toArtifactStatusSummary(componentMatchReportFile)
          },
          ...(context.resolvedCustomerProfile
            ? {
                customerProfile: {
                  tokenPolicy: context.resolvedCustomerProfile.strictness.token,
                  matchPolicy: context.resolvedCustomerProfile.strictness.match
                }
              }
            : {})
        }
      : {
          status: "not_available",
          issueCount: 0,
          issues: [],
          diagnostics: {
            evidence: {
              authoritativeStylingEvidenceCount: 0,
              referenceOnlyStylingEvidenceCount: 0,
              referenceOnlyEvidenceTypes: []
            },
            tokens: {
              diagnosticCount: 0,
              errorCount: 0,
              diagnostics: []
            },
            themes: {
              diagnosticCount: 0,
              errorCount: 0,
              diagnostics: []
            },
            componentMatchReport: {
              resolvedCustomerComponentCount: 0,
              validatedComponentNames: []
            }
          },
          storybook: {
            evidence: styleStorybookArtifacts.evidence,
            tokens: styleStorybookArtifacts.tokens,
            themes: styleStorybookArtifacts.themes,
            componentMatchReport: toArtifactStatusSummary(componentMatchReportFile)
          },
          ...(context.resolvedCustomerProfile
            ? {
                customerProfile: {
                  tokenPolicy: context.resolvedCustomerProfile.strictness.token,
                  matchPolicy: context.resolvedCustomerProfile.strictness.match
                }
              }
            : {})
        };

  const importSummary: ValidationSummaryArtifact["import"] = customerProfileImportSummary
    ? {
        status: customerProfileImportSummary.status,
        customerProfile: customerProfileImportSummary
      }
    : {
        status: "not_available"
      };

  const generatedAppSummary: ValidationSummaryArtifact["generatedApp"] = validationResult
    ? {
        status: "ok",
        attempts: validationResult.attempts,
        install: validationResult.install,
        ...(validationResult.lintAutofix ? { lintAutofix: validationResult.lintAutofix } : {}),
        lint: validationResult.lint,
        typecheck: validationResult.typecheck,
        build: validationResult.build,
        ...(validationResult.test ? { test: validationResult.test } : {}),
        ...(validationResult.validateUi ? { validateUi: validationResult.validateUi } : {}),
        ...(validationResult.perfAssert ? { perfAssert: validationResult.perfAssert } : {})
      }
    : generatedAppFailure
      ? {
          status: "failed",
          failedCommand: generatedAppFailure.failedCommand
        }
      : {
          status: "not_available"
        };
  const uiA11ySummary = await buildUiA11ySummary({
    context,
    ...(validationResult ? { validationResult } : {})
  });
  const resolvedVisualAuditResult = cloneVisualAuditResult(visualAuditResult ?? context.job.visualAudit ?? { status: "not_requested" });

  return {
    status: resolveSummaryStatus({
      generatedApp: generatedAppSummary,
      uiA11y: uiA11ySummary,
      visualAudit: resolvedVisualAuditResult,
      storybook: storybookSummary,
      mapping: mappingSummary,
      style: styleSummary,
      importSummary
    }),
    validatedAt,
    generatedApp: generatedAppSummary,
    uiA11y: uiA11ySummary,
    visualAudit: resolvedVisualAuditResult,
    storybook: storybookSummary,
    mapping: mappingSummary,
    style: styleSummary,
    import: importSummary
  };
};

export const createValidateProjectService = ({
  runProjectValidationFn = runProjectValidation,
  prepareGenerationDiffFn = prepareGenerationDiff,
  writeGenerationDiffReportFn = writeGenerationDiffReport,
  saveCurrentSnapshotFn = saveCurrentSnapshot,
  captureFromProjectFn = captureFromProject,
  comparePngBuffersFn = comparePngBuffers,
  isLintAutofixEnabledFn = isLintAutofixEnabled,
  isPerfValidationEnabledFn = isPerfValidationEnabled
}: Partial<ValidateProjectServiceDeps> = {}): StageService<void> => {
  return {
    stageName: "validate.project",
    execute: async (_input, context) => {
      const generatedProjectDir = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
      const validatedAt = new Date().toISOString();

      let customerProfileMatchSummary: CustomerProfileMatchValidationSummary | undefined;
      let customerProfileComponentApiSummary: CustomerProfileComponentApiValidationSummary | undefined;
      let customerProfileStyleSummary: CustomerProfileStyleValidationSummary | undefined;
      let customerProfileImportSummary:
        | Awaited<ReturnType<typeof validateGeneratedProjectCustomerProfile>>
        | undefined;
      let componentMatchReportArtifact: ComponentMatchReportArtifact | undefined;
      let storybookEvidenceArtifact: StorybookEvidenceArtifact | undefined;
      let storybookTokensArtifact: StorybookPublicTokensArtifact | undefined;
      let storybookThemesArtifact: StorybookPublicThemesArtifact | undefined;
      let validationResult: ProjectValidationResult | undefined;

      const visualAuditRequest = context.job.request.visualAudit;
      let visualAuditResult: WorkspaceVisualAuditResult = visualAuditRequest
        ? {
            status: "failed",
            baselineImagePath: visualAuditRequest.baselineImagePath,
            warnings: ["Visual audit did not complete because validate.project exited before the audit step finished."]
          }
        : {
            status: "not_requested"
          };
      if (!visualAuditRequest) {
        context.job.visualAudit = { status: "not_requested" };
      }
      let visualAuditReferenceImagePath: string | undefined;
      let visualAuditActualImagePath: string | undefined;
      let visualAuditDiffImagePath: string | undefined;
      let visualAuditReportPath: string | undefined;

      const buildSummary = async ({
        generatedAppFailure,
        storybookArtifactStatusOverrides
      }: {
        generatedAppFailure?: { failedCommand: string };
        storybookArtifactStatusOverrides?: Partial<Record<StorybookArtifactKey, ValidationArtifactStatusSummary["status"]>>;
      } = {}): Promise<ValidationSummaryArtifact> => {
        context.job.visualAudit = cloneVisualAuditResult(visualAuditResult);
        return buildValidationSummaryArtifact({
          context,
          validatedAt,
          ...(validationResult ? { validationResult } : {}),
          ...(generatedAppFailure ? { generatedAppFailure } : {}),
          ...(customerProfileImportSummary ? { customerProfileImportSummary } : {}),
          ...(customerProfileMatchSummary ? { customerProfileMatchSummary } : {}),
          ...(customerProfileComponentApiSummary ? { customerProfileComponentApiSummary } : {}),
          ...(customerProfileStyleSummary ? { customerProfileStyleSummary } : {}),
          ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {}),
          ...(storybookArtifactStatusOverrides ? { storybookArtifactStatusOverrides } : {}),
          visualAuditResult
        });
      };

      const setVisualAuditJobArtifactPath = ({
        key,
        absolutePath
      }: {
        key:
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReferenceImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditActualImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditDiffImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReport;
        absolutePath: string;
      }): void => {
        switch (key) {
          case STAGE_ARTIFACT_KEYS.visualAuditReferenceImage:
            visualAuditReferenceImagePath = absolutePath;
            context.job.artifacts.visualAuditReferenceImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditActualImage:
            visualAuditActualImagePath = absolutePath;
            context.job.artifacts.visualAuditActualImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditDiffImage:
            visualAuditDiffImagePath = absolutePath;
            context.job.artifacts.visualAuditDiffImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditReport:
            visualAuditReportPath = absolutePath;
            context.job.artifacts.visualAuditReportFile = absolutePath;
            break;
        }
      };

      const persistVisualAuditArtifactPath = async ({
        key,
        absolutePath
      }: {
        key:
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReferenceImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditActualImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditDiffImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReport;
        absolutePath: string;
      }): Promise<void> => {
        setVisualAuditJobArtifactPath({ key, absolutePath });
        await context.artifactStore.setPath({
          key,
          stage: "validate.project",
          absolutePath
        });
      };

      const persistVisualAuditResult = async (result: WorkspaceVisualAuditResult): Promise<WorkspaceVisualAuditResult> => {
        const clonedResult = cloneVisualAuditResult(result);
        visualAuditResult = clonedResult;
        context.job.visualAudit = cloneVisualAuditResult(clonedResult);
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.visualAuditResult,
          stage: "validate.project",
          value: cloneVisualAuditResult(clonedResult)
        });
        return clonedResult;
      };

      const failVisualAudit = async ({
        code,
        message,
        suggestion,
        details,
        cause
      }: {
        code: string;
        message: string;
        suggestion: string;
        details?: Record<string, unknown>;
        cause?: unknown;
      }): Promise<never> => {
        const warnings = [
          message,
          ...(visualAuditResult.warnings ?? []).filter((warning) => warning !== message)
        ];
        await persistVisualAuditResult({
          status: "failed",
          ...(visualAuditRequest ? { baselineImagePath: visualAuditRequest.baselineImagePath } : {}),
          ...(visualAuditReferenceImagePath ? { referenceImagePath: visualAuditReferenceImagePath } : {}),
          ...(visualAuditActualImagePath ? { actualImagePath: visualAuditActualImagePath } : {}),
          ...(visualAuditDiffImagePath ? { diffImagePath: visualAuditDiffImagePath } : {}),
          ...(visualAuditReportPath ? { reportPath: visualAuditReportPath } : {}),
          warnings
        });
        const summary = await buildSummary();
        await persistValidationSummaryArtifacts({
          context,
          summary
        });
        throw createPipelineError({
          code,
          stage: "validate.project",
          message,
          cause,
          limits: context.runtime.pipelineDiagnosticLimits,
          diagnostics: [
            {
              code,
              message,
              suggestion,
              stage: "validate.project",
              severity: "error",
              ...(details ? { details } : {})
            }
          ]
        });
      };

      const componentMatchReportPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
      const storybookCatalogPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookCatalog);
      const storybookEvidencePath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence);
      const storybookTokensPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens);
      const storybookThemesPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes);
      const storybookComponentsPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookComponents);
      const isStorybookRequested = Boolean(context.requestedStorybookStaticDir);
      if (componentMatchReportPath) {
        try {
          componentMatchReportArtifact = parseComponentMatchReportArtifact({
            input: await readFile(componentMatchReportPath, "utf8")
          });
        } catch (error) {
          throw createPipelineError({
            code: "E_COMPONENT_MATCH_REPORT_INVALID",
            stage: "validate.project",
            message: "component.match_report is unreadable or malformed.",
            cause: error,
            limits: context.runtime.pipelineDiagnosticLimits
          });
        }

        const compositionCoverage = buildStorybookCompositionCoverage({ artifact: componentMatchReportArtifact });
        if (compositionCoverage.unmatched > 0) {
          context.log({
            level: "warn",
            message:
              `Storybook composition: ${compositionCoverage.unmatched} of ${compositionCoverage.totalFigmaFamilies} ` +
              `Figma familie(s) have no Storybook match.`
          });
        }
        if (compositionCoverage.ambiguous > 0) {
          context.log({
            level: "warn",
            message:
              `Storybook composition: ${compositionCoverage.ambiguous} Figma familie(s) have ambiguous Storybook matches.`
          });
        }
        if (compositionCoverage.docsOnlyReferenceCount > 0) {
          context.log({
            level: "warn",
            message:
              `Storybook composition: ${compositionCoverage.docsOnlyReferenceCount} matched familie(s) rely on ` +
              `docs-only references without authoritative evidence: ${compositionCoverage.docsOnlyFamilyNames.join(", ")}.`
          });
        }
      }

      if (isStorybookRequested) {
        const storybookArtifactPaths: Record<StorybookArtifactKey, string | undefined> = {
          catalog: storybookCatalogPath,
          evidence: storybookEvidencePath,
          tokens: storybookTokensPath,
          themes: storybookThemesPath,
          components: storybookComponentsPath
        };
        const persistAndThrowInvalidStorybookArtifact = async ({
          artifactKey,
          cause
        }: {
          artifactKey: StorybookArtifactKey;
          cause: unknown;
        }): Promise<never> => {
          const summary = await buildSummary({
            storybookArtifactStatusOverrides: {
              [artifactKey]: "invalid"
            }
          });
          await persistValidationSummaryArtifacts({
            context,
            summary
          });
          const failedArtifacts = listFailedStorybookArtifacts({
            artifacts: summary.storybook.status === "not_requested" ? {
              catalog: { status: "not_available" },
              evidence: { status: "not_available" },
              tokens: { status: "not_available" },
              themes: { status: "not_available" },
              components: { status: "not_available" }
            } : summary.storybook.artifacts
          });
          throw createPipelineError({
            code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
            stage: "validate.project",
            message: "Storybook artifacts are unreadable or malformed.",
            cause,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: buildStorybookGateDiagnostics({
              artifacts: failedArtifacts
            })
          });
        };
        const parseStorybookArtifact = async <T>({
          artifactKey,
          filePath,
          parse
        }: {
          artifactKey: StorybookArtifactKey;
          filePath: string | undefined;
          parse: ({ input }: { input: string }) => T;
        }): Promise<T | undefined> => {
          if (!filePath) {
            return undefined;
          }
          try {
            return parse({
              input: await readFile(filePath, "utf8")
            });
          } catch (error) {
            return persistAndThrowInvalidStorybookArtifact({
              artifactKey,
              cause: error
            });
          }
        };
        await parseStorybookArtifact({
          artifactKey: "catalog",
          filePath: storybookCatalogPath,
          parse: parseStorybookCatalogArtifact
        });
        storybookEvidenceArtifact = await parseStorybookArtifact({
          artifactKey: "evidence",
          filePath: storybookEvidencePath,
          parse: parseStorybookEvidenceArtifact
        });
        storybookTokensArtifact = await parseStorybookArtifact({
          artifactKey: "tokens",
          filePath: storybookTokensPath,
          parse: parseStorybookTokensArtifact
        });
        storybookThemesArtifact = await parseStorybookArtifact({
          artifactKey: "themes",
          filePath: storybookThemesPath,
          parse: parseStorybookThemesArtifact
        });
        await parseStorybookArtifact({
          artifactKey: "components",
          filePath: storybookComponentsPath,
          parse: parseStorybookComponentsArtifact
        });

        const missingRequiredStorybookArtifacts = STORYBOOK_ARTIFACT_DESCRIPTORS.filter(
          ({ key }) => !storybookArtifactPaths[key]
        );
        if (missingRequiredStorybookArtifacts.length > 0) {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary
          });
          throw createPipelineError({
            code: "E_STORYBOOK_VALIDATION_FAILED",
            stage: "validate.project",
            message: buildStorybookGateMessage({
              artifacts: missingRequiredStorybookArtifacts.map((artifact) => ({
                ...artifact,
                status: "missing" as const
              }))
            }),
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: buildStorybookGateDiagnostics({
              artifacts: missingRequiredStorybookArtifacts.map((artifact) => ({
                ...artifact,
                status: "missing" as const
              }))
            })
          });
        }
      }

      if (context.resolvedCustomerProfile && componentMatchReportArtifact) {
          customerProfileMatchSummary = validateCustomerProfileComponentMatchReport({
            artifact: componentMatchReportArtifact,
            customerProfile: context.resolvedCustomerProfile
          });
          customerProfileComponentApiSummary = validateCustomerProfileComponentApiComponentMatchReport({
            artifact: componentMatchReportArtifact,
            customerProfile: context.resolvedCustomerProfile
          });
          if (customerProfileMatchSummary.issueCount > 0) {
            const logLevel =
              customerProfileMatchSummary.policy === "warn"
                ? "warn"
                : customerProfileMatchSummary.policy === "error"
                  ? "error"
                  : "info";
            context.log({
              level: logLevel,
              message:
                `Customer profile match policy reported ${customerProfileMatchSummary.issueCount} issue(s) ` +
                `(policy=${customerProfileMatchSummary.policy}).`
            });
          }
          if (customerProfileComponentApiSummary.issueCount > 0) {
            const logLevel = customerProfileComponentApiSummary.status === "failed" ? "error" : "warn";
            context.log({
              level: logLevel,
              message:
                `Customer profile component API gate reported ${customerProfileComponentApiSummary.issueCount} issue(s) ` +
                `(status=${customerProfileComponentApiSummary.status}).`
            });
          }
          if (customerProfileMatchSummary.status === "failed") {
            const summary = await buildSummary();
            await persistValidationSummaryArtifacts({
              context,
              summary
            });
            throw createPipelineError({
              code: "E_CUSTOMER_PROFILE_MATCH_POLICY",
              stage: "validate.project",
              message: `Customer profile match policy failed with ${customerProfileMatchSummary.issueCount} issue(s).`,
              limits: context.runtime.pipelineDiagnosticLimits,
              diagnostics: customerProfileMatchSummary.issues.map((issue) => ({
                code: "E_CUSTOMER_PROFILE_MATCH_POLICY",
                message: issue.message,
                suggestion:
                  "Fix the Storybook tier aliases, customer profile component import matrix, or fallback policy so the match report resolves deterministically.",
                stage: "validate.project",
                severity: "error",
                details: {
                  figmaFamilyKey: issue.figmaFamilyKey,
                  figmaFamilyName: issue.figmaFamilyName,
                  status: issue.status,
                  reason: issue.reason,
                  ...(issue.componentKey ? { componentKey: issue.componentKey } : {}),
                  ...(issue.storybookTier ? { storybookTier: issue.storybookTier } : {}),
                  ...(issue.profileFamily ? { profileFamily: issue.profileFamily } : {})
                }
              }))
            });
          }
          if (customerProfileComponentApiSummary.status === "failed") {
            const summary = await buildSummary();
            await persistValidationSummaryArtifacts({
              context,
              summary
            });
            throw createPipelineError({
              code: "E_CUSTOMER_PROFILE_COMPONENT_API_POLICY",
              stage: "validate.project",
              message:
                `Customer profile component API gate failed with ${customerProfileComponentApiSummary.issueCount} issue(s).`,
              limits: context.runtime.pipelineDiagnosticLimits,
              diagnostics: customerProfileComponentApiSummary.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                suggestion:
                  "Align the customer component contract with the Storybook public API, or allow explicit MUI fallback for that component.",
                stage: "validate.project",
                severity: issue.severity === "error" ? "error" : "warning",
                details: {
                  figmaFamilyKey: issue.figmaFamilyKey,
                  figmaFamilyName: issue.figmaFamilyName,
                  ...(issue.componentKey ? { componentKey: issue.componentKey } : {}),
                  ...(issue.sourceProp ? { sourceProp: issue.sourceProp } : {}),
                  ...(issue.targetProp ? { targetProp: issue.targetProp } : {})
                }
              }))
            });
          }
      }

      if (context.resolvedCustomerProfile) {
        if (!storybookEvidenceArtifact) {
          try {
            storybookEvidenceArtifact = storybookEvidencePath
              ? parseStorybookEvidenceArtifact({
                  input: await readFile(storybookEvidencePath, "utf8")
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits
            });
          }
        }
        if (!storybookTokensArtifact) {
          try {
            storybookTokensArtifact = storybookTokensPath
              ? parseStorybookTokensArtifact({
                  input: await readFile(storybookTokensPath, "utf8")
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits
            });
          }
        }
        if (!storybookThemesArtifact) {
          try {
            storybookThemesArtifact = storybookThemesPath
              ? parseStorybookThemesArtifact({
                  input: await readFile(storybookThemesPath, "utf8")
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits
            });
          }
        }
        customerProfileStyleSummary = await validateGeneratedProjectStorybookStyles({
          generatedProjectDir,
          customerProfile: context.resolvedCustomerProfile,
          isStorybookFirstRequested: Boolean(context.requestedStorybookStaticDir ?? context.resolvedStorybookStaticDir),
          ...(storybookEvidenceArtifact ? { storybookEvidenceArtifact } : {}),
          ...(storybookTokensArtifact ? { storybookTokensArtifact } : {}),
          ...(storybookThemesArtifact ? { storybookThemesArtifact } : {}),
          ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {})
        });
        if (customerProfileStyleSummary.issueCount > 0) {
          const logLevel =
            customerProfileStyleSummary.status === "failed"
              ? "error"
              : customerProfileStyleSummary.status === "warn"
                ? "warn"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Storybook-first style guard reported ${customerProfileStyleSummary.issueCount} issue(s) ` +
              `(policy=${customerProfileStyleSummary.policy}, status=${customerProfileStyleSummary.status}).`
          });
        }
        if (customerProfileStyleSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_STYLE_POLICY",
            stage: "validate.project",
            message:
              `Storybook-first style guard failed with ${customerProfileStyleSummary.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileStyleSummary.issues.map((issue) => ({
              code: issue.diagnosticCode ?? issue.category,
              message: issue.message,
              suggestion:
                "Use Storybook-derived theme or token references, and only forward props allowed by the resolved customer component API.",
              stage: "validate.project",
              severity: issue.severity,
              details: {
                category: issue.category,
                ...(issue.filePath ? { filePath: issue.filePath } : {}),
                ...(issue.line ? { line: issue.line } : {}),
                ...(issue.column ? { column: issue.column } : {}),
                ...(issue.componentName ? { componentName: issue.componentName } : {}),
                ...(issue.propName ? { propName: issue.propName } : {}),
                ...(issue.themeId ? { themeId: issue.themeId } : {}),
                ...(issue.tokenPath ? { tokenPath: issue.tokenPath } : {}),
                ...(issue.artifact ? { artifact: issue.artifact } : {}),
                ...(issue.evidenceTypes ? { evidenceTypes: issue.evidenceTypes } : {})
              }
            }))
          });
        }
      }

      if (context.resolvedCustomerProfile) {
        customerProfileImportSummary = await validateGeneratedProjectCustomerProfile({
          generatedProjectDir,
          customerProfile: context.resolvedCustomerProfile
        });
        if (customerProfileImportSummary.import.issueCount > 0) {
          const logLevel =
            customerProfileImportSummary.import.policy === "warn"
              ? "warn"
              : customerProfileImportSummary.import.policy === "error"
                ? "error"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Customer profile import policy reported ${customerProfileImportSummary.import.issueCount} issue(s) ` +
              `(policy=${customerProfileImportSummary.import.policy}).`
          });
        }
        if (customerProfileImportSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_IMPORT_POLICY",
            stage: "validate.project",
            message: `Customer profile import policy failed with ${customerProfileImportSummary.import.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileImportSummary.import.issues.map((issue) => ({
              code: issue.code,
              message: issue.message,
              suggestion: "Update the customer profile import matrix, template config, or generated imports so they agree.",
              stage: "validate.project",
              severity: "error",
              details: {
                ...(issue.filePath ? { filePath: issue.filePath } : {}),
                ...(issue.modulePath ? { modulePath: issue.modulePath } : {})
              }
            }))
          });
        }
      }

      const hasCustomerProfileDeps = context.resolvedCustomerProfile
        ? Object.keys(context.resolvedCustomerProfile.template.dependencies).length > 0 ||
          Object.keys(context.resolvedCustomerProfile.template.devDependencies).length > 0
        : false;

      try {
        validationResult = await runProjectValidationFn({
          generatedProjectDir,
          jobDir: context.paths.jobDir,
          enableLintAutofix: isLintAutofixEnabledFn(),
          enablePerfValidation: isPerfValidationEnabledFn(),
          enableUiValidation: context.runtime.enableUiValidation,
          enableUnitTestValidation: context.runtime.enableUnitTestValidation,
          unitTestIgnoreFailure: context.runtime.unitTestIgnoreFailure,
          commandTimeoutMs: context.runtime.commandTimeoutMs,
          commandStdoutMaxBytes: context.runtime.commandStdoutMaxBytes,
          commandStderrMaxBytes: context.runtime.commandStderrMaxBytes,
          installPreferOffline: context.runtime.installPreferOffline,
          skipInstall: context.runtime.skipInstall,
          lockfileMutable: hasCustomerProfileDeps,
          pipelineDiagnosticLimits: context.runtime.pipelineDiagnosticLimits,
          seedNodeModulesDir: path.join(context.paths.templateRoot, "node_modules"),
          abortSignal: context.abortSignal,
          onLog: (message) => {
            context.log({
              level: "info",
              message
            });
          }
        });
      } catch (error) {
        const failedCommand = extractFailedCommandFromPipelineError(error);
        await persistVisualAuditResult({
          status: visualAuditRequest ? "failed" : "not_requested",
          ...(visualAuditRequest
            ? {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                warnings: ["Visual audit did not run because generated-project validation failed before the audit step."]
              }
            : {})
        });
        const failureSummary = await buildSummary({
          generatedAppFailure: { failedCommand }
        });
        await persistValidationSummaryArtifacts({
          context,
          summary: failureSummary
        });
        throw error;
      }
      if (!visualAuditRequest) {
        await persistVisualAuditResult({
          status: "not_requested"
        });
      } else {
        const resolvedBaselineSourcePath = path.resolve(
          context.resolvedWorkspaceRoot,
          visualAuditRequest.baselineImagePath
        );
        if (!isWithinRoot({ candidatePath: resolvedBaselineSourcePath, rootPath: context.resolvedWorkspaceRoot })) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_BASELINE_PATH_INVALID",
            message:
              `Visual audit baseline '${visualAuditRequest.baselineImagePath}' resolves outside the workspace root.`,
            suggestion: "Provide a baseline image path that stays inside the workspace root.",
            details: {
              baselineImagePath: visualAuditRequest.baselineImagePath,
              resolvedBaselinePath: resolvedBaselineSourcePath,
              workspaceRoot: context.resolvedWorkspaceRoot
            }
          });
        }

        const referenceBuffer = await (async (): Promise<Buffer> => {
          try {
            return await readFile(resolvedBaselineSourcePath);
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_BASELINE_MISSING",
              message: `Visual audit baseline '${visualAuditRequest.baselineImagePath}' is missing or unreadable.`,
              suggestion: "Add the baseline PNG inside the workspace root before running validate.project.",
              details: {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                resolvedBaselinePath: resolvedBaselineSourcePath
              },
              cause: error
            });
          }
        })();

        const visualAuditDir = path.join(context.paths.jobDir, "visual-audit");
        try {
          await mkdir(visualAuditDir, { recursive: true });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_ARTIFACT_DIR_FAILED",
            message: "Visual audit artifact directory could not be created.",
            suggestion: "Ensure the job output directory is writable before running validate.project.",
            details: {
              visualAuditDir
            },
            cause: error
          });
        }

        const referenceImagePath = path.join(visualAuditDir, "reference.png");
        try {
          await writeFile(referenceImagePath, referenceBuffer);
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
            absolutePath: referenceImagePath
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_REFERENCE_WRITE_FAILED",
            message: "Visual audit reference image could not be written.",
            suggestion: "Ensure the job output directory is writable before running validate.project.",
            details: {
              referenceImagePath,
              resolvedBaselinePath: resolvedBaselineSourcePath
            },
            cause: error
          });
        }

        const distDir = path.join(generatedProjectDir, "dist");
        const distIndexPath = path.join(distDir, "index.html");
        try {
          await access(distIndexPath);
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_BUILD_OUTPUT_MISSING",
            message: "Visual audit requires build output at 'dist/index.html', but that file is missing.",
            suggestion: "Make sure the generated project build writes a static dist bundle before the visual audit runs.",
            details: {
              distDir,
              distIndexPath,
              generatedProjectDir
            },
            cause: error
          });
        }

        const captureConfig = visualAuditRequest.capture as Parameters<typeof captureFromProjectFn>[0]["config"] | undefined;
        const captureResult = await (async (): Promise<Awaited<ReturnType<typeof captureFromProjectFn>>> => {
          try {
            return await captureFromProjectFn({
              projectDir: distDir,
              ...(captureConfig ? { config: captureConfig } : {}),
              onLog: (message) => {
                context.log({
                  level: "info",
                  message: `Visual audit capture: ${message}`
                });
              }
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_CAPTURE_FAILED",
              message: "Visual audit could not capture the generated dist bundle.",
              suggestion: "Inspect the built dist bundle and capture settings, then rerun validate.project.",
              details: {
                distDir,
                distIndexPath
              },
              cause: error
            });
          }
        })();

        const actualImagePath = path.join(visualAuditDir, "actual.png");
        try {
          await writeFile(actualImagePath, captureResult.screenshotBuffer);
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditActualImage,
            absolutePath: actualImagePath
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_ACTUAL_WRITE_FAILED",
            message: "Visual audit captured a screenshot but could not persist it.",
            suggestion: "Ensure the job output directory is writable before running validate.project.",
            details: {
              actualImagePath
            },
            cause: error
          });
        }

        const compareConfig = visualAuditRequest.diff as Parameters<typeof comparePngBuffersFn>[0]["config"] | undefined;
        const compareRegions = visualAuditRequest.regions as Parameters<typeof comparePngBuffersFn>[0]["regions"] | undefined;
        const diffResult = await (async (): Promise<ReturnType<typeof comparePngBuffersFn>> => {
          try {
            return comparePngBuffersFn({
              referenceBuffer,
              testBuffer: captureResult.screenshotBuffer,
              ...(compareConfig ? { config: compareConfig } : {}),
              ...(compareRegions ? { regions: compareRegions } : {})
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_COMPARE_FAILED",
              message: "Visual audit could not compare the baseline and captured screenshots.",
              suggestion: "Align the baseline image and capture configuration so both images are comparable.",
              details: {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                referenceImagePath,
                actualImagePath
              },
              cause: error
            });
          }
        })();

        const diffImagePath = path.join(visualAuditDir, "diff.png");
        try {
          await writeDiffImage({
            diffImageBuffer: diffResult.diffImageBuffer,
            outputPath: diffImagePath
          });
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
            absolutePath: diffImagePath
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_DIFF_WRITE_FAILED",
            message: "Visual audit computed a diff image but could not persist it.",
            suggestion: "Ensure the job output directory is writable before running validate.project.",
            details: {
              diffImagePath
            },
            cause: error
          });
        }

        const finalizedVisualAuditResult = cloneVisualAuditResult({
          status: diffResult.diffPixelCount > 0 ? "warn" : "ok",
          baselineImagePath: visualAuditRequest.baselineImagePath,
          referenceImagePath,
          actualImagePath,
          diffImagePath,
          similarityScore: diffResult.similarityScore,
          diffPixelCount: diffResult.diffPixelCount,
          totalPixels: diffResult.totalPixels,
          regions: diffResult.regions.map((region) => ({ ...region })),
          ...(diffResult.diffPixelCount > 0
            ? {
                warnings: [
                  `Visual audit detected ${String(diffResult.diffPixelCount)} differing pixel(s) across ${String(diffResult.totalPixels)} total pixel(s).`
                ]
              }
            : {})
        });

        const reportPath = path.join(visualAuditDir, "report.json");
        const visualQualityReport = (() => {
          try {
            return computeVisualQualityReport({
              diffResult,
              comparedAt: validatedAt,
              diffImagePath,
              viewport: captureResult.viewport
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_REPORT_BUILD_FAILED",
              message: "Visual audit completed, but the structured quality report could not be generated.",
              suggestion: "Inspect the visual scoring configuration and report metadata inputs, then rerun validate.project.",
              details: {
                diffImagePath,
                actualImagePath,
                referenceImagePath
              },
              cause: error
            });
          }
        })();
        try {
          await writeFile(reportPath, toJsonFileContent(await visualQualityReport), "utf8");
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditReport,
            absolutePath: reportPath
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_REPORT_WRITE_FAILED",
            message: "Visual audit completed but could not persist the JSON report.",
            suggestion: "Ensure the job output directory is writable before running validate.project.",
            details: {
              reportPath
            },
            cause: error
          });
        }

        finalizedVisualAuditResult.reportPath = reportPath;
        await persistVisualAuditResult(finalizedVisualAuditResult);
        context.log({
          level: finalizedVisualAuditResult.status === "warn" ? "warn" : "info",
          message:
            finalizedVisualAuditResult.status === "warn"
              ? `Visual audit detected ${String(diffResult.diffPixelCount)} differing pixel(s).`
              : "Visual audit completed without detected pixel differences."
        });
      }
      const summary = await buildSummary();
      await persistValidationSummaryArtifacts({
        context,
        summary
      });
      const failedStorybookArtifacts =
        summary.storybook.status === "failed"
          ? listFailedStorybookArtifacts({
              artifacts: summary.storybook.artifacts
            })
          : [];
      if (failedStorybookArtifacts.length > 0) {
        throw createPipelineError({
          code: "E_STORYBOOK_VALIDATION_FAILED",
          stage: "validate.project",
          message: buildStorybookGateMessage({
            artifacts: failedStorybookArtifacts
          }),
          limits: context.runtime.pipelineDiagnosticLimits,
          diagnostics: buildStorybookGateDiagnostics({
            artifacts: failedStorybookArtifacts
          })
        });
      }

      const diffContext = await context.artifactStore.requireValue<GenerationDiffContext>(
        STAGE_ARTIFACT_KEYS.generationDiffContext
      );
      const preparedDiff = await prepareGenerationDiffFn({
        generatedProjectDir,
        outputRoot: context.resolvedPaths.outputRoot,
        boardKey: diffContext.boardKey,
        jobId: context.jobId
      });
      const diffReportPath = await writeGenerationDiffReportFn({
        jobDir: context.paths.jobDir,
        report: preparedDiff.report
      });
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.generationDiff,
        stage: "validate.project",
        value: preparedDiff.report
      });
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.generationDiffFile,
        stage: "validate.project",
        absolutePath: diffReportPath
      });
      await saveCurrentSnapshotFn({
        outputRoot: context.resolvedPaths.outputRoot,
        snapshot: preparedDiff.snapshot
      });
      context.log({
        level: "info",
        message: `Post-validation generation diff: ${preparedDiff.report.summary}`
      });
    }
  };
};

export const ValidateProjectService: StageService<void> = createValidateProjectService();
