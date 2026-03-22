import type { BundledTheme } from "shiki";
import type { HighlightResult } from "./shiki";

export interface HighlightWorkerHighlightRequest {
  type: "highlight";
  requestId: number;
  code: string;
  filePath: string;
  theme: BundledTheme;
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
