import type {
  WorkspaceJobStageName,
  WorkspacePipelineId,
  WorkspacePipelineRequestErrorCode,
} from "../../contracts/index.js";

export class PipelineRequestError extends Error {
  readonly code: WorkspacePipelineRequestErrorCode;
  readonly stage: WorkspaceJobStageName;
  readonly pipelineId?: WorkspacePipelineId;

  constructor({
    code,
    message,
    pipelineId,
    stage = "figma.source",
  }: {
    code: WorkspacePipelineRequestErrorCode;
    message: string;
    pipelineId?: WorkspacePipelineId;
    stage?: WorkspaceJobStageName;
  }) {
    super(message);
    this.name = "PipelineRequestError";
    this.code = code;
    this.stage = stage;
    if (pipelineId !== undefined) {
      this.pipelineId = pipelineId;
    }
  }
}

export const PIPELINE_REQUEST_ERROR_CODES: ReadonlySet<string> = new Set([
  "INVALID_PIPELINE",
  "PIPELINE_UNAVAILABLE",
  "PIPELINE_SOURCE_MODE_UNSUPPORTED",
  "PIPELINE_SCOPE_UNSUPPORTED",
]);

export const isPipelineRequestErrorCode = (
  code: unknown,
): code is WorkspacePipelineRequestErrorCode =>
  typeof code === "string" && PIPELINE_REQUEST_ERROR_CODES.has(code);

export const isPipelineRequestError = (
  error: unknown,
): error is PipelineRequestError =>
  error instanceof Error &&
  "code" in error &&
  isPipelineRequestErrorCode((error as { code?: unknown }).code);
