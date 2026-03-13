import type { WorkspaceJobStageName } from "../contracts/index.js";
import type { WorkspacePipelineError } from "./types.js";

export const createPipelineError = ({
  code,
  stage,
  message,
  cause
}: {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  cause?: unknown;
}): WorkspacePipelineError => {
  const error = new Error(message) as WorkspacePipelineError;
  error.code = code;
  error.stage = stage;
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return error;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};
