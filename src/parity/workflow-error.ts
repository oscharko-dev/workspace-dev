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
    if (stage !== undefined) {
      this.stage = stage;
    }
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
  const fallbackWithDefinedOptionals = {
    code: fallback.code,
    ...(fallback.stage !== undefined ? { stage: fallback.stage } : {}),
    ...(fallback.retryable !== undefined ? { retryable: fallback.retryable } : {})
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
