export const TEST_SPACE_ROUTE_PREFIX = "/workspace/test-space";
export const TEST_SPACE_RUNS_ROUTE_PREFIX: string = `${TEST_SPACE_ROUTE_PREFIX}/runs`;
export const TEST_SPACE_UI_ALIAS_ROUTE_PREFIX: string = "/ui/test-space";

export const DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT = "gpt-oss-120b" as const;
export const DEFAULT_TEST_SPACE_QC_WRITE_ENABLED = false as const;

export const WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV =
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT";
export const WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV =
  "WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT";
export const WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV =
  "WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN";

function readTrimmedEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveWorkspaceTestSpaceModelDeployment(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readTrimmedEnvValue(env, WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV) ??
    DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT
  );
}

export const WORKSPACE_TEST_SPACE_QC_BASE_URL_ENV =
  "WORKSPACE_TEST_SPACE_QC_BASE_URL";
export const WORKSPACE_TEST_SPACE_QC_DOMAIN_ENV =
  "WORKSPACE_TEST_SPACE_QC_DOMAIN";
export const WORKSPACE_TEST_SPACE_QC_PROJECT_ENV =
  "WORKSPACE_TEST_SPACE_QC_PROJECT";
export const WORKSPACE_TEST_SPACE_QC_CLIENT_ID_ENV =
  "WORKSPACE_TEST_SPACE_QC_CLIENT_ID";
export const WORKSPACE_TEST_SPACE_QC_CLIENT_SECRET_ENV =
  "WORKSPACE_TEST_SPACE_QC_CLIENT_SECRET";
export const WORKSPACE_TEST_SPACE_QC_WRITE_ENABLED_ENV =
  "WORKSPACE_TEST_SPACE_QC_WRITE_ENABLED";
