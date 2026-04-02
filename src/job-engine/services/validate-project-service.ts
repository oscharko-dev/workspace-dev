import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  STORYBOOK_PUBLIC_EXTENSION_KEY,
  type ComponentMatchReportArtifact,
  type StorybookEvidenceArtifact,
  type StorybookPublicThemesArtifact,
  type StorybookPublicTokensArtifact
} from "../../storybook/types.js";

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
  isLintAutofixEnabledFn: () => boolean;
  isPerfValidationEnabledFn: () => boolean;
}

type ValidationGateStatus = "ok" | "warn" | "failed" | "partial" | "not_available" | "not_requested";

interface ValidationArtifactStatusSummary {
  status: "ok" | "not_available" | "missing";
  filePath?: string;
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
        status: "not_available";
      };
  uiA11y: ValidationUiA11ySummary;
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
    figmaLibraryResolution: ValidationArtifactStatusSummary;
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

const parseStorybookEvidenceArtifact = ({
  input
}: {
  input: string;
}): StorybookEvidenceArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    !isRecord(parsed) ||
    parsed.artifact !== "storybook.evidence" ||
    !Array.isArray(parsed.evidence)
  ) {
    throw new Error("Expected a storybook.evidence artifact with an evidence array.");
  }
  return parsed as unknown as StorybookEvidenceArtifact;
};

const parseStorybookTokensArtifact = ({
  input
}: {
  input: string;
}): StorybookPublicTokensArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("Expected a storybook.tokens artifact object.");
  }
  const extensions = parsed.$extensions;
  if (
    !isRecord(extensions) ||
    !isRecord(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY]) ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].artifact !== "storybook.tokens" ||
    !Array.isArray(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics)
  ) {
    throw new Error("Expected a storybook.tokens artifact extension payload.");
  }
  return parsed as unknown as StorybookPublicTokensArtifact;
};

const parseStorybookThemesArtifact = ({
  input
}: {
  input: string;
}): StorybookPublicThemesArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || parsed.name !== "storybook.themes") {
    throw new Error("Expected a storybook.themes artifact object.");
  }
  const extensions = parsed.$extensions;
  if (
    !isRecord(extensions) ||
    !isRecord(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY]) ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].artifact !== "storybook.themes" ||
    !Array.isArray(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics)
  ) {
    throw new Error("Expected a storybook.themes artifact extension payload.");
  }
  return parsed as unknown as StorybookPublicThemesArtifact;
};

const resolveSummaryStatus = ({
  generatedApp,
  uiA11y,
  storybook,
  mapping,
  style,
  importSummary
}: {
  generatedApp: ValidationSummaryArtifact["generatedApp"];
  uiA11y: ValidationSummaryArtifact["uiA11y"];
  storybook: ValidationSummaryArtifact["storybook"];
  mapping: ValidationSummaryArtifact["mapping"];
  style: ValidationSummaryArtifact["style"];
  importSummary: ValidationSummaryArtifact["import"];
}): ValidationSummaryArtifact["status"] => {
  const gateStatuses: ValidationGateStatus[] = [
    generatedApp.status,
    uiA11y.status,
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
  customerProfileImportSummary,
  customerProfileMatchSummary,
  customerProfileComponentApiSummary,
  customerProfileStyleSummary,
  componentMatchReportArtifact
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validatedAt: string;
  validationResult?: ProjectValidationResult;
  customerProfileImportSummary?: CustomerProfileValidationSummary;
  customerProfileMatchSummary?: CustomerProfileMatchValidationSummary;
  customerProfileComponentApiSummary?: CustomerProfileComponentApiValidationSummary;
  customerProfileStyleSummary?: CustomerProfileStyleValidationSummary;
  componentMatchReportArtifact?: ComponentMatchReportArtifact;
}): Promise<ValidationSummaryArtifact> => {
  const storybookCatalogFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookCatalog);
  const storybookEvidenceFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence);
  const storybookTokensFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens);
  const storybookThemesFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes);
  const storybookComponentsFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookComponents);
  const figmaLibraryResolutionFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution);
  const componentMatchReportFile = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);

  const requestedStorybookStaticDir = context.requestedStorybookStaticDir;
  const toRequiredStorybookArtifactStatus = (filePath: string | undefined): ValidationArtifactStatusSummary => {
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
    catalog: toRequiredStorybookArtifactStatus(storybookCatalogFile),
    evidence: toRequiredStorybookArtifactStatus(storybookEvidenceFile),
    tokens: toRequiredStorybookArtifactStatus(storybookTokensFile),
    themes: toRequiredStorybookArtifactStatus(storybookThemesFile),
    components: toRequiredStorybookArtifactStatus(storybookComponentsFile)
  };

  const compositionCoverage = componentMatchReportArtifact
    ? buildStorybookCompositionCoverage({ artifact: componentMatchReportArtifact })
    : undefined;

  const storybookSummary: ValidationSummaryArtifact["storybook"] = requestedStorybookStaticDir
    ? {
        status:
          storybookCatalogFile &&
          storybookEvidenceFile &&
          storybookTokensFile &&
          storybookThemesFile &&
          storybookComponentsFile
            ? "ok"
            : "failed",
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
    figmaLibraryResolution: toArtifactStatusSummary(figmaLibraryResolutionFile),
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
            evidence: toArtifactStatusSummary(storybookEvidenceFile),
            tokens: toArtifactStatusSummary(storybookTokensFile),
            themes: toArtifactStatusSummary(storybookThemesFile),
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
            evidence: toArtifactStatusSummary(storybookEvidenceFile),
            tokens: toArtifactStatusSummary(storybookTokensFile),
            themes: toArtifactStatusSummary(storybookThemesFile),
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
    : {
        status: "not_available"
      };
  const uiA11ySummary = await buildUiA11ySummary({
    context,
    ...(validationResult ? { validationResult } : {})
  });

  return {
    status: resolveSummaryStatus({
      generatedApp: generatedAppSummary,
      uiA11y: uiA11ySummary,
      storybook: storybookSummary,
      mapping: mappingSummary,
      style: styleSummary,
      importSummary
    }),
    validatedAt,
    generatedApp: generatedAppSummary,
    uiA11y: uiA11ySummary,
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
      let componentMatchReportArtifact: ComponentMatchReportArtifact | undefined;

      const componentMatchReportPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
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
            const summary = await buildValidationSummaryArtifact({
              context,
              validatedAt,
              customerProfileMatchSummary,
              customerProfileComponentApiSummary,
              componentMatchReportArtifact
            });
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
            const summary = await buildValidationSummaryArtifact({
              context,
              validatedAt,
              customerProfileMatchSummary,
              customerProfileComponentApiSummary,
              componentMatchReportArtifact
            });
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

      let customerProfileStyleSummary: CustomerProfileStyleValidationSummary | undefined;
      if (context.resolvedCustomerProfile) {
        const storybookEvidencePath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence);
        const storybookTokensPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens);
        const storybookThemesPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes);

        let storybookEvidenceArtifact: StorybookEvidenceArtifact | undefined;
        let storybookTokensArtifact: StorybookPublicTokensArtifact | undefined;
        let storybookThemesArtifact: StorybookPublicThemesArtifact | undefined;

        try {
          storybookEvidenceArtifact = storybookEvidencePath
            ? parseStorybookEvidenceArtifact({
                input: await readFile(storybookEvidencePath, "utf8")
              })
            : undefined;
          storybookTokensArtifact = storybookTokensPath
            ? parseStorybookTokensArtifact({
                input: await readFile(storybookTokensPath, "utf8")
              })
            : undefined;
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

        customerProfileStyleSummary = await validateGeneratedProjectStorybookStyles({
          generatedProjectDir,
          customerProfile: context.resolvedCustomerProfile,
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
          const summary = await buildValidationSummaryArtifact({
            context,
            validatedAt,
            ...(customerProfileMatchSummary ? { customerProfileMatchSummary } : {}),
            ...(customerProfileComponentApiSummary ? { customerProfileComponentApiSummary } : {}),
            customerProfileStyleSummary,
            ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {})
          });
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

      let customerProfileImportSummary:
        | Awaited<ReturnType<typeof validateGeneratedProjectCustomerProfile>>
        | undefined;
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
          const summary = await buildValidationSummaryArtifact({
            context,
            validatedAt,
            customerProfileImportSummary,
            ...(customerProfileMatchSummary ? { customerProfileMatchSummary } : {}),
            ...(customerProfileComponentApiSummary ? { customerProfileComponentApiSummary } : {}),
            ...(customerProfileStyleSummary ? { customerProfileStyleSummary } : {}),
            ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {})
          });
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

      const validationResult = await runProjectValidationFn({
        generatedProjectDir,
        jobDir: context.paths.jobDir,
        enableLintAutofix: isLintAutofixEnabledFn(),
        enablePerfValidation: isPerfValidationEnabledFn(),
        enableUiValidation: context.runtime.enableUiValidation,
        enableUnitTestValidation: context.runtime.enableUnitTestValidation,
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
      const summary = await buildValidationSummaryArtifact({
        context,
        validatedAt,
        validationResult,
        ...(customerProfileImportSummary ? { customerProfileImportSummary } : {}),
        ...(customerProfileMatchSummary ? { customerProfileMatchSummary } : {}),
        ...(customerProfileComponentApiSummary ? { customerProfileComponentApiSummary } : {}),
        ...(customerProfileStyleSummary ? { customerProfileStyleSummary } : {}),
        ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {})
      });
      await persistValidationSummaryArtifacts({
        context,
        summary
      });

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
