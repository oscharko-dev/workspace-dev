import type { HighlightResult, HighlightTheme } from "./shiki-shared";

export interface HighlightWorkerHighlightRequest {
  type: "highlight";
  requestId: number;
  code: string;
  filePath: string;
  theme: HighlightTheme;
}

export interface HighlightWorkerCancelRequest {
  type: "cancel";
  requestId: number;
}

export type HighlightWorkerRequestMessage =
  | HighlightWorkerHighlightRequest
  | HighlightWorkerCancelRequest;

export interface HighlightWorkerResultResponse {
  type: "result";
  requestId: number;
  result: HighlightResult | null;
}

export interface HighlightWorkerErrorResponse {
  type: "error";
  requestId: number;
  errorMessage: string;
}

export type HighlightWorkerResponseMessage =
  | HighlightWorkerResultResponse
  | HighlightWorkerErrorResponse;
