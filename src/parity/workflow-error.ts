import type {
  WorkspaceJobDiagnostic,
  WorkspaceJobStageName,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

export interface WorkflowErrorInit {
  code: string;
  message: string;
  stage?: WorkspaceJobStageName;
  retryable?: boolean;
  cause?: unknown;
  diagnostics?: WorkspaceJobDiagnostic[];
}

export const PARITY_WORKFLOW_ERROR_CODES = {
  invalidFigmaPayload: "E_PARITY_INVALID_FIGMA_PAYLOAD",
  noScreens: "E_PARITY_NO_SCREENS",
  invalidGeneratedJsxFragment: "E_PARITY_INVALID_GENERATED_JSX_FRAGMENT",
  invalidGeneratedSourceFile: "E_PARITY_INVALID_GENERATED_SOURCE_FILE",
} as const;

export type ParityWorkflowErrorCode =
  (typeof PARITY_WORKFLOW_ERROR_CODES)[keyof typeof PARITY_WORKFLOW_ERROR_CODES];

export class WorkflowError extends Error {
  public readonly code: string;
  public readonly stage?: WorkspaceJobStageName;
  public readonly retryable: boolean;
  public readonly diagnostics?: WorkspaceJobDiagnostic[];

  constructor({
    code,
    message,
    stage,
    retryable = false,
    cause,
    diagnostics,
  }: WorkflowErrorInit) {
    const sanitizedMessage = redactHighRiskSecrets(
      message,
      "[redacted-secret]",
    );

    super(sanitizedMessage, cause === undefined ? undefined : { cause });
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

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      ...(this.stage !== undefined && { stage: this.stage }),
      retryable: this.retryable,
      ...(this.diagnostics !== undefined && { diagnostics: this.diagnostics }),
    };
  }
}

export const isWorkflowError = (value: unknown): value is WorkflowError => {
  return value instanceof WorkflowError;
};

export const hasWorkflowErrorCode = <TCode extends string>(
  value: unknown,
  code: TCode,
): value is WorkflowError & { code: TCode } => {
  return isWorkflowError(value) && value.code === code;
};

export const isParityNoScreensWorkflowError = (
  value: unknown,
): value is WorkflowError & {
  code: typeof PARITY_WORKFLOW_ERROR_CODES.noScreens;
} => {
  return hasWorkflowErrorCode(value, PARITY_WORKFLOW_ERROR_CODES.noScreens);
};

export const toWorkflowError = (
  value: unknown,
  fallback: {
    code: string;
    message: string;
    stage?: WorkspaceJobStageName;
    retryable?: boolean;
    diagnostics?: WorkspaceJobDiagnostic[];
  },
): WorkflowError => {
  const fallbackWithDefinedOptionals = {
    code: fallback.code,
    ...(fallback.stage !== undefined ? { stage: fallback.stage } : {}),
    ...(fallback.retryable !== undefined
      ? { retryable: fallback.retryable }
      : {}),
    ...(fallback.diagnostics !== undefined
      ? { diagnostics: fallback.diagnostics }
      : {}),
  };

  if (isWorkflowError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new WorkflowError({
      ...fallbackWithDefinedOptionals,
      message: value.message,
      cause: value,
    });
  }

  return new WorkflowError({
    ...fallbackWithDefinedOptionals,
    message: fallback.message,
    cause: value,
  });
};
