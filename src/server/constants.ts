export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 1983;
export const DEFAULT_OUTPUT_ROOT = ".workspace-dev";
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const UI_ROUTE_PREFIX = "/workspace/ui";
export const JOB_ROUTE_PREFIX = "/workspace/jobs/";
export const REPRO_ROUTE_PREFIX = "/workspace/repros/";

export type UiAssetPath = string;

export interface UiAsset {
  contentType: string;
  content: Buffer;
}
