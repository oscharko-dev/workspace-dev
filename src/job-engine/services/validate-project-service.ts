import path from "node:path";
import { runProjectValidation } from "../validation.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";

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
  isLintAutofixEnabledFn: () => boolean;
  isPerfValidationEnabledFn: () => boolean;
}

export const createValidateProjectService = ({
  runProjectValidationFn = runProjectValidation,
  isLintAutofixEnabledFn = isLintAutofixEnabled,
  isPerfValidationEnabledFn = isPerfValidationEnabled
}: Partial<ValidateProjectServiceDeps> = {}): StageService<void> => {
  return {
    stageName: "validate.project",
    execute: async (_input, context) => {
      const generatedProjectDir = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
      await runProjectValidationFn({
        generatedProjectDir,
        enableLintAutofix: isLintAutofixEnabledFn(),
        enablePerfValidation: isPerfValidationEnabledFn(),
        enableUiValidation: context.runtime.enableUiValidation,
        enableUnitTestValidation: context.runtime.enableUnitTestValidation,
        commandTimeoutMs: context.runtime.commandTimeoutMs,
        installPreferOffline: context.runtime.installPreferOffline,
        skipInstall: context.runtime.skipInstall,
        seedNodeModulesDir: path.join(context.paths.templateRoot, "node_modules"),
        abortSignal: context.abortSignal,
        onLog: (message) => {
          context.log({
            level: "info",
            message
          });
        }
      });

      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.validationSummary,
        stage: "validate.project",
        value: { status: "ok", validatedAt: new Date().toISOString() }
      });
    }
  };
};

export const ValidateProjectService: StageService<void> = createValidateProjectService();
