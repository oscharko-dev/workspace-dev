export interface WorkflowErrorInit {
  code: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class WorkflowError extends Error {
  public readonly code: string;
  public readonly stage?: string;
  public readonly retryable: boolean;

  constructor({ code, message, stage, retryable = false, cause }: WorkflowErrorInit) {
    super(message, { cause });
    this.name = "WorkflowError";
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

export const isWorkflowError = (value: unknown): value is WorkflowError => {
  return value instanceof WorkflowError;
};

export const toWorkflowError = (
  value: unknown,
  fallback: { code: string; message: string; stage?: string; retryable?: boolean }
): WorkflowError => {
  if (isWorkflowError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new WorkflowError({
      code: fallback.code,
      message: value.message,
      stage: fallback.stage,
      retryable: fallback.retryable,
      cause: value
    });
  }

  return new WorkflowError({
    code: fallback.code,
    message: fallback.message,
    stage: fallback.stage,
    retryable: fallback.retryable,
    cause: value
  });
};
