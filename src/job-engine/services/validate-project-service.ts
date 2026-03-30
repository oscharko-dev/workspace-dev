import path from "node:path";
import {
  prepareGenerationDiff,
  saveCurrentSnapshot,
  type GenerationDiffContext,
  writeGenerationDiffReport
} from "../generation-diff.js";
import { runProjectValidation } from "../validation.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { createPipelineError } from "../errors.js";
import { validateGeneratedProjectCustomerProfile } from "../../customer-profile-validation.js";

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
          await context.artifactStore.setValue({
            key: STAGE_ARTIFACT_KEYS.validationSummary,
            stage: "validate.project",
            value: {
              status: "failed",
              validatedAt,
              customerProfile: customerProfileSummary
            }
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

      await runProjectValidationFn({
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
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.validationSummary,
        stage: "validate.project",
        value: {
          status: customerProfileSummary?.status === "warn" ? "warn" : "ok",
          validatedAt,
          ...(customerProfileSummary ? { customerProfile: customerProfileSummary } : {})
        }
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
