import type { WorkspaceJobDiagnostic, WorkspaceJobStageName } from "../contracts/index.js";

export interface WorkflowErrorInit {
  code: string;
  message: string;
  stage?: WorkspaceJobStageName;
  retryable?: boolean;
  cause?: unknown;
  diagnostics?: WorkspaceJobDiagnostic[];
}

export class WorkflowError extends Error {
  public readonly code: string;
  public readonly stage?: WorkspaceJobStageName;
  public readonly retryable: boolean;
  public readonly diagnostics?: WorkspaceJobDiagnostic[];

  constructor({ code, message, stage, retryable = false, cause, diagnostics }: WorkflowErrorInit) {
    super(message, { cause });
    this.name = "WorkflowError";
    this.code = code;
    if (stage !== undefined) {
      this.stage = stage;
    }
    this.retryable = retryable;
    if (diagnostics !== undefined) {
      this.diagnostics = diagnostics;
    }
  }
}

export const isWorkflowError = (value: unknown): value is WorkflowError => {
  return value instanceof WorkflowError;
};

export const toWorkflowError = (
  value: unknown,
  fallback: {
    code: string;
    message: string;
    stage?: WorkspaceJobStageName;
    retryable?: boolean;
    diagnostics?: WorkspaceJobDiagnostic[];
  }
): WorkflowError => {
  const fallbackWithDefinedOptionals = {
    code: fallback.code,
    ...(fallback.stage !== undefined ? { stage: fallback.stage } : {}),
    ...(fallback.retryable !== undefined ? { retryable: fallback.retryable } : {}),
    ...(fallback.diagnostics !== undefined ? { diagnostics: fallback.diagnostics } : {})
  };

  if (isWorkflowError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new WorkflowError({
      ...fallbackWithDefinedOptionals,
      message: value.message,
      cause: value
    });
  }

  return new WorkflowError({
    ...fallbackWithDefinedOptionals,
    message: fallback.message,
    cause: value
  });
};
