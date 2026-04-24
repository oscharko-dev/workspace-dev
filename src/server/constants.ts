export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 1983;
export const DEFAULT_OUTPUT_ROOT = ".workspace-dev";
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const MAX_SUBMIT_BODY_BYTES = 8_388_608;
export const DEFAULT_FIGMA_PASTE_MAX_BYTES: number = 6 * 1024 * 1024;
export const FIGMA_PASTE_MAX_BYTES_ENV = "WORKSPACE_FIGMA_PASTE_MAX_BYTES";
export const ENABLE_HSTS_ENV = "FIGMAPIPE_WORKSPACE_ENABLE_HSTS";
export const DEFAULT_STRICT_TRANSPORT_SECURITY = "max-age=31536000";
export function resolveFigmaPasteMaxBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[FIGMA_PASTE_MAX_BYTES_ENV];
  if (raw !== undefined && /^\d+$/.test(raw)) {
    const parsed = parseInt(raw, 10);
    if (parsed > 0) return parsed;
  }
  return DEFAULT_FIGMA_PASTE_MAX_BYTES;
}
export const RATE_LIMIT_WINDOW_MS = 60_000;
export function resolveStrictTransportSecurity(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[ENABLE_HSTS_ENV];
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return undefined;
  }

  return DEFAULT_STRICT_TRANSPORT_SECURITY;
}
export const DEFAULT_CONTENT_SECURITY_POLICY = "frame-ancestors 'self'";
export const WORKSPACE_UI_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
export const UI_ROUTE_PREFIX = "/workspace/ui";
export const TEST_SPACE_UI_ROUTE_PREFIX = "/ui/test-space";
export const TEST_SPACE_RUNS_ROUTE_PREFIX = "/workspace/test-space/runs";
export const JOB_ROUTE_PREFIX = "/workspace/jobs/";
export const REPRO_ROUTE_PREFIX = "/workspace/repros/";

export type UiAssetPath = string;

export interface UiAsset {
  contentType: string;
  content: Buffer;
}
