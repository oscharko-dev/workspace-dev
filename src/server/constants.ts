export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 1983;
export const DEFAULT_OUTPUT_ROOT = ".workspace-dev";
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const MAX_SUBMIT_BODY_BYTES = 4_194_304;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_CONTENT_SECURITY_POLICY = "frame-ancestors 'self'";
export const WORKSPACE_UI_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
export const UI_ROUTE_PREFIX = "/workspace/ui";
export const JOB_ROUTE_PREFIX = "/workspace/jobs/";
export const REPRO_ROUTE_PREFIX = "/workspace/repros/";

export type UiAssetPath = string;

export interface UiAsset {
  contentType: string;
  content: Buffer;
}
