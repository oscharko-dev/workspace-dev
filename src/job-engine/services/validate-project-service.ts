import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  prepareGenerationDiff,
  saveCurrentSnapshot,
  type GenerationDiffContext,
  writeGenerationDiffReport
} from "../generation-diff.js";
import { runProjectValidation, type ProjectValidationResult } from "../validation.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { createPipelineError } from "../errors.js";
import {
  validateGeneratedProjectCustomerProfile,
  type CustomerProfileValidationSummary
} from "../../customer-profile-validation.js";

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

type ValidationGateStatus = "ok" | "warn" | "failed" | "not_available" | "not_requested";

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
  storybook:
    | {
        status: "ok" | "failed";
        requestedPath: string;
        artifacts: ValidationStorybookArtifactSet;
      }
    | {
        status: "not_requested";
      };
  mapping: {
    status: "ok" | "partial" | "not_available";
    figmaLibraryResolution: ValidationArtifactStatusSummary;
    componentMatchReport: ValidationArtifactStatusSummary;
  };
  style: {
    status: "ok" | "not_available";
    storybook: {
      tokens: ValidationArtifactStatusSummary;
      themes: ValidationArtifactStatusSummary;
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

const toJsonFileContent = (value: unknown): string => {
  return `${JSON.stringify(value, null, 2)}\n`;
};

const resolveSummaryStatus = ({
  generatedApp,
  storybook,
  importSummary
}: {
  generatedApp: ValidationSummaryArtifact["generatedApp"];
  storybook: ValidationSummaryArtifact["storybook"];
  importSummary: ValidationSummaryArtifact["import"];
}): ValidationSummaryArtifact["status"] => {
  const gateStatuses: ValidationGateStatus[] = [generatedApp.status, storybook.status, importSummary.status];
  if (gateStatuses.includes("failed")) {
    return "failed";
  }
  if (gateStatuses.includes("warn")) {
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
  customerProfileSummary
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validatedAt: string;
  validationResult?: ProjectValidationResult;
  customerProfileSummary?: CustomerProfileValidationSummary;
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
        artifacts: storybookArtifacts
      }
    : {
        status: "not_requested"
      };

  const mappingSummary: ValidationSummaryArtifact["mapping"] = {
    status: componentMatchReportFile ? "ok" : figmaLibraryResolutionFile ? "partial" : "not_available",
    figmaLibraryResolution: toArtifactStatusSummary(figmaLibraryResolutionFile),
    componentMatchReport: toArtifactStatusSummary(componentMatchReportFile)
  };

  const styleSummary: ValidationSummaryArtifact["style"] =
    storybookTokensFile && storybookThemesFile
      ? {
          status: "ok",
          storybook: {
            tokens: { status: "ok", filePath: storybookTokensFile },
            themes: { status: "ok", filePath: storybookThemesFile }
          },
          ...(customerProfileSummary
            ? {
                customerProfile: {
                  tokenPolicy: customerProfileSummary.token.policy,
                  matchPolicy: customerProfileSummary.match.policy
                }
              }
            : {})
        }
      : {
          status: "not_available",
          storybook: {
            tokens: toArtifactStatusSummary(storybookTokensFile),
            themes: toArtifactStatusSummary(storybookThemesFile)
          },
          ...(customerProfileSummary
            ? {
                customerProfile: {
                  tokenPolicy: customerProfileSummary.token.policy,
                  matchPolicy: customerProfileSummary.match.policy
                }
              }
            : {})
        };

  const importSummary: ValidationSummaryArtifact["import"] = customerProfileSummary
    ? {
        status: customerProfileSummary.status,
        customerProfile: customerProfileSummary
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

  return {
    status: resolveSummaryStatus({
      generatedApp: generatedAppSummary,
      storybook: storybookSummary,
      importSummary
    }),
    validatedAt,
    generatedApp: generatedAppSummary,
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

      let customerProfileSummary:
        | Awaited<ReturnType<typeof validateGeneratedProjectCustomerProfile>>
        | undefined;
      if (context.resolvedCustomerProfile) {
        customerProfileSummary = await validateGeneratedProjectCustomerProfile({
          generatedProjectDir,
          customerProfile: context.resolvedCustomerProfile
        });
        if (customerProfileSummary.import.issueCount > 0) {
          const logLevel =
            customerProfileSummary.import.policy === "warn"
              ? "warn"
              : customerProfileSummary.import.policy === "error"
                ? "error"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Customer profile import policy reported ${customerProfileSummary.import.issueCount} issue(s) ` +
              `(policy=${customerProfileSummary.import.policy}).`
          });
        }
        if (customerProfileSummary.status === "failed") {
          const summary = await buildValidationSummaryArtifact({
            context,
            validatedAt,
            customerProfileSummary
          });
          await persistValidationSummaryArtifacts({
            context,
            summary
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_IMPORT_POLICY",
            stage: "validate.project",
            message: `Customer profile import policy failed with ${customerProfileSummary.import.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileSummary.import.issues.map((issue) => ({
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
        ...(customerProfileSummary ? { customerProfileSummary } : {})
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
