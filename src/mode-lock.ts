/**
 * Mode-lock enforcement for workspace-dev.
 *
 * Only `figmaSourceMode=rest|local_json` and `llmCodegenMode=deterministic` are allowed.
 * All other modes are blocked with explicit error messages.
 */

const ALLOWED_FIGMA_SOURCE_MODE_DEFAULT = "rest" as const;
const ALLOWED_FIGMA_SOURCE_MODES = ["rest", "local_json"] as const;
const ALLOWED_LLM_CODEGEN_MODE = "deterministic" as const;

const BLOCKED_FIGMA_MODES: readonly string[] = ["mcp", "hybrid"];
const BLOCKED_CODEGEN_MODES: readonly string[] = ["hybrid", "llm_strict"];

export interface ModeLockValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateModeLock(input: {
  figmaSourceMode?: string;
  llmCodegenMode?: string;
}): ModeLockValidationResult {
  const errors: string[] = [];

  const figmaMode = input.figmaSourceMode?.trim().toLowerCase();
  if (figmaMode && !ALLOWED_FIGMA_SOURCE_MODES.includes(figmaMode as (typeof ALLOWED_FIGMA_SOURCE_MODES)[number])) {
    const isKnownBlocked = BLOCKED_FIGMA_MODES.includes(figmaMode);
    if (isKnownBlocked) {
      errors.push(
        `Mode '${figmaMode}' is not available in workspace-dev. ` +
        `Only 'rest' and 'local_json' are supported. MCP and hybrid modes require the full Workspace Dev platform deployment.`
      );
    } else {
      errors.push(
        `Unknown figmaSourceMode '${figmaMode}'. ` +
        `workspace-dev supports only 'rest' and 'local_json'.`
      );
    }
  }

  const codegenMode = input.llmCodegenMode?.trim().toLowerCase();
  if (codegenMode && codegenMode !== ALLOWED_LLM_CODEGEN_MODE) {
    const isKnownBlocked = BLOCKED_CODEGEN_MODES.includes(codegenMode);
    if (isKnownBlocked) {
      errors.push(
        `Mode '${codegenMode}' is not available in workspace-dev. ` +
        `Only 'deterministic' is supported. LLM-based codegen modes require the full Workspace Dev platform deployment.`
      );
    } else {
      errors.push(
        `Unknown llmCodegenMode '${codegenMode}'. ` +
        `workspace-dev supports only 'deterministic'.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function enforceModeLock(input: {
  figmaSourceMode?: string;
  llmCodegenMode?: string;
}): void {
  const result = validateModeLock(input);
  if (!result.valid) {
    throw new Error(
      `Mode-lock violation in workspace-dev:\n${result.errors.map((entry) => `  • ${entry}`).join("\n")}`
    );
  }
}

export function getWorkspaceDefaults(): {
  figmaSourceMode: typeof ALLOWED_FIGMA_SOURCE_MODE_DEFAULT;
  llmCodegenMode: typeof ALLOWED_LLM_CODEGEN_MODE;
} {
  return {
    figmaSourceMode: ALLOWED_FIGMA_SOURCE_MODE_DEFAULT,
    llmCodegenMode: ALLOWED_LLM_CODEGEN_MODE
  };
}
